import os
import uuid
import time
import logging
import threading
import asyncio
from typing import Dict, Any, List
from datetime import datetime

from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session
import requests

from app.database import init_db, get_db, SessionLocal, Incident, IncidentLog
from app.agent import agent_app, log_step, send_admin_failure_email, MAX_TRIES

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sentinel-backend")

app = FastAPI(title="SentinelOps AI - SRE Backend")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local development ease
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Built-in Health Monitor ──────────────────────────────────────────────
# Replaces Prometheus + AlertManager when they are not available (local dev).
# Polls every service every 5 seconds for anomalies and triggers the agent.

MONITOR_INTERVAL = 5  # seconds
MEMORY_THRESHOLD_MB = 50.0  # trigger alert above this
CPU_THRESHOLD = 0.80  # trigger alert above this

# Will be populated after LOCAL_PORTS is defined further below
_monitor_thread = None

def _has_active_incident(db, service_name: str, alert_name: str) -> bool:
    """Check if there is already an active incident for this service/alert."""
    return db.query(Incident).filter(
        Incident.service == service_name,
        Incident.alert_name == alert_name,
        Incident.status.in_(["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING"])
    ).first() is not None

def check_max_tries_exceeded(db, service_name: str, alert_name: str, max_tries: int = MAX_TRIES) -> bool:
    """Check if the number of consecutive failed incidents for this service/alert has reached or exceeded max_tries."""
    incidents = db.query(Incident).filter(
        Incident.service == service_name,
        Incident.alert_name == alert_name
    ).order_by(Incident.created_at.desc()).all()
    
    consecutive_failures = 0
    for inc in incidents:
        if inc.status == "FAILED":
            consecutive_failures += 1
        elif inc.status == "RESOLVED":
            break
            
    return consecutive_failures >= max_tries

def _create_and_run_incident(service_name: str, alert_name: str, severity: str):
    """Create an incident record and run the agent workflow synchronously."""
    db = SessionLocal()
    try:
        # Double-check dedup inside the monitor thread
        if _has_active_incident(db, service_name, alert_name):
            return

        # Check if max tries has been reached for consecutive failures
        if check_max_tries_exceeded(db, service_name, alert_name, MAX_TRIES):
            logger.warning(
                f"[HealthMonitor] Alert '{alert_name}' on service '{service_name}' has exceeded maximum tries ({MAX_TRIES}). Automatic self-healing suspended."
            )
            return

        incident_id = f"INC-{datetime.utcnow().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        new_incident = Incident(
            id=incident_id,
            service=service_name,
            alert_name=alert_name,
            severity=severity,
            status="INVESTIGATING",
            created_at=datetime.utcnow()
        )
        db.add(new_incident)
        db.commit()

        log_entry = IncidentLog(
            incident_id=incident_id,
            level="WARNING",
            message=f"[HealthMonitor] Alert '{alert_name}' (severity: {severity}) auto-detected on service '{service_name}'",
            timestamp=datetime.utcnow()
        )
        db.add(log_entry)
        db.commit()
    except Exception as e:
        logger.error(f"Monitor: failed to create incident: {e}")
        return
    finally:
        db.close()

    logger.info(f"Monitor: triggering agent workflow for {incident_id}")
    try:
        run_agent_workflow(incident_id, service_name, alert_name)
    except Exception as e:
        logger.error(f"Monitor: agent workflow crashed for {incident_id}: {e}")

def _health_monitor_loop():
    """Background thread that continuously polls services for anomalies."""
    # Wait a few seconds for services to come online
    time.sleep(8)
    logger.info("Background health monitor started – polling every %ds", MONITOR_INTERVAL)

    while True:
        try:
            for service_name, port in LOCAL_PORTS.items():
                url = get_service_url(service_name)
                try:
                    # ── Check metrics ────────────────────────────────
                    memory_mb = 0.0
                    cpu = 0.0
                    metric_resp = requests.get(f"{url}/metrics", timeout=0.8)
                    if metric_resp.status_code == 200:
                        for line in metric_resp.text.split("\n"):
                            if line.startswith("service_memory_usage_bytes") and not line.startswith("#"):
                                try:
                                    memory_mb = float(line.split()[1]) / (1024 * 1024)
                                except (ValueError, IndexError):
                                    pass
                            elif line.startswith("service_cpu_usage_ratio") and not line.startswith("#"):
                                try:
                                    cpu = float(line.split()[1])
                                except (ValueError, IndexError):
                                    pass

                    # ── Check health ─────────────────────────────────
                    health_ok = False
                    try:
                        health_resp = requests.get(f"{url}/health", timeout=0.8)
                        health_ok = health_resp.status_code == 200
                    except Exception:
                        pass

                    # ── Decide if alert should fire ──────────────────
                    if memory_mb > MEMORY_THRESHOLD_MB:
                        alert_name = "HighMemoryUsage"
                        severity = "critical"
                    elif cpu > CPU_THRESHOLD:
                        alert_name = "HighCpuUsage"
                        severity = "warning"
                    elif not health_ok:
                        alert_name = "HttpErrorSpike"
                        severity = "critical"
                    else:
                        continue  # service is healthy, move on

                    # Fire in a separate thread so monitor keeps polling
                    threading.Thread(
                        target=_create_and_run_incident,
                        args=(service_name, alert_name, severity),
                        daemon=True
                    ).start()

                except Exception as e:
                    # Service unreachable – skip it silently
                    pass
        except Exception as e:
            logger.error(f"Monitor loop error: {e}")

        time.sleep(MONITOR_INTERVAL)

# Initialize database on startup and launch the health monitor
@app.on_event("startup")
def startup_event():
    global _monitor_thread
    logger.info("Initializing database...")
    init_db()
    logger.info("Database initialized.")

    # Start background health monitor thread
    _monitor_thread = threading.Thread(target=_health_monitor_loop, daemon=True)
    _monitor_thread.start()
    logger.info("Background health monitor thread launched.")

# Pydantic Schemas
class FaultInjectionRequest(BaseModel):
    service: str
    fault: str # memory-leak, cpu-spike, error-spike

# Helper to run LangGraph Agent
def run_agent_workflow(incident_id: str, service: str, alert_name: str):
    logger.info(f"Starting background LangGraph workflow for incident {incident_id}")
    try:
        initial_state = {
            "incident_id": incident_id,
            "service": service,
            "alert_name": alert_name,
            "status": "INVESTIGATING",
            "root_cause": None,
            "confidence": None,
            "severity": None,
            "risk_level": None,
            "evidence": None,
            "affected_services": None,
            "reasoning_summary": None,
            "remediation_choice": None,
            "remediation_result": None,
            "verification_success": None,
            "incident_report": None
        }
        # Execute compiled LangGraph workflow
        agent_app.invoke(initial_state)
    except Exception as e:
        logger.error(f"Error executing agent workflow for {incident_id}: {str(e)}")
        log_step(incident_id, f"Agent workflow execution crashed: {str(e)}", "ERROR")
        
        # Mark incident failed
        db = SessionLocal()
        try:
            incident = db.query(Incident).filter(Incident.id == incident_id).first()
            if incident:
                incident.status = "FAILED"
                db.commit()
        except Exception as db_err:
            logger.error(f"Failed to update crashed incident status: {db_err}")
        finally:
            db.close()
            
        # Send admin failure email
        send_admin_failure_email(
            incident_id=incident_id,
            service=service,
            alert_name=alert_name,
            reason=f"Agent workflow execution crashed: {str(e)}"
        )

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

manager = ConnectionManager()

@app.websocket("/api/v1/simulation/ws")
async def simulation_websocket(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Poll status safely in threadpool without blocking fastapi event loop
            status = await run_in_threadpool(get_simulation_status)
            await websocket.send_json(status)
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# REST Endpoints

class TestIncidentRequest(BaseModel):
    risk_level: str  # "low", "medium", "high", "critical"

@app.post("/api/v1/simulation/trigger_test_incident")
def trigger_test_incident(req: TestIncidentRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    risk = req.risk_level.lower()
    logger.info(f"Triggering simulated test incident for risk level: {risk}")
    
    # Define parameters based on target risk level
    if risk == "low":
        service_name = "notification-service"
        alert_name = "LowPriorityWarning"
        severity = "warning"
    elif risk == "medium":
        service_name = "order-service"
        alert_name = "HighCpuUsage"
        severity = "warning"
    elif risk == "high":
        service_name = "user-service"  # Auth subsystem triggers HIGH minimum
        alert_name = "HttpErrorSpike"
        severity = "critical"
    elif risk == "critical":
        service_name = "database-service"  # DB subsystem + Destructive runbook triggers CRITICAL
        alert_name = "DatabaseCorruptionAlert"
        severity = "critical"
    else:
        raise HTTPException(status_code=400, detail=f"Invalid risk level: {req.risk_level}. Choose from low, medium, high, critical.")
        
    # Check deduplication
    active_incident = db.query(Incident).filter(
        Incident.service == service_name,
        Incident.alert_name == alert_name,
        Incident.status.in_(["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING", "PENDING_APPROVAL"])
    ).first()
    
    if active_incident:
        logger.info(f"Active incident {active_incident.id} already exists for {service_name}/{alert_name}. Skipping duplicate.")
        return {"status": "ignored", "message": f"An active incident already exists for {service_name}.", "incident_id": active_incident.id}
        
    # Check if max tries has been reached for consecutive failures
    if check_max_tries_exceeded(db, service_name, alert_name, MAX_TRIES):
        raise HTTPException(
            status_code=400,
            detail=f"Service '{service_name}' Alert '{alert_name}' has exceeded maximum tries ({MAX_TRIES}). Clear faults or reset cluster to retry."
        )
        
    # Create new incident entry
    incident_id = f"INC-{datetime.utcnow().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    new_incident = Incident(
        id=incident_id,
        service=service_name,
        alert_name=alert_name,
        severity=severity,
        status="INVESTIGATING",
        created_at=datetime.utcnow()
    )
    db.add(new_incident)
    db.commit()
    
    # Log initial alert event
    log_entry = IncidentLog(
        incident_id=incident_id,
        level="WARNING",
        message=f"[Simulation] Triggered test incident for {risk.upper()} risk: '{alert_name}' on service '{service_name}'",
        timestamp=datetime.utcnow()
    )
    db.add(log_entry)
    db.commit()
    
    # Queue the agent running loop in background
    background_tasks.add_task(run_agent_workflow, incident_id, service_name, alert_name)
    
    return {"status": "success", "message": f"Simulated {risk.upper()} risk incident triggered.", "incident_id": incident_id}

@app.get("/")
def read_root():
    return {"message": "SentinelOps SRE API is running."}

@app.post("/api/v1/alerts/webhook")
def alerts_webhook(payload: Dict[str, Any], background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Receives AlertManager alerts, parses them, and runs the SRE agent in background."""
    logger.info(f"Received alert webhook payload: {payload}")
    
    alerts = payload.get("alerts", [])
    if not alerts:
        return {"status": "ignored", "message": "No active alerts found in payload"}
        
    for alert in alerts:
        # Check if the alert is firing (we ignore resolved alerts since the agent fixes them)
        status = alert.get("status")
        if status == "resolved":
            logger.info("Ignoring resolved alert notification.")
            continue
            
        labels = alert.get("labels", {})
        alert_name = labels.get("alertname", "UnknownAlert")
        
        # Parse service name from instance label (e.g. payment-service:8000 -> payment-service)
        instance = labels.get("instance", "")
        service_name = instance.split(":")[0] if ":" in instance else instance
        
        # Fallback mappings if instance is empty or localhost/prometheus
        if not service_name or service_name in ["prometheus", "localhost", "127.0.0.1"]:
            service_name = labels.get("service") or labels.get("job") or "payment-service"
            
        severity = labels.get("severity", "warning")
        
        # Deduplicate: Check if there's an active incident for this service/alert
        active_incident = db.query(Incident).filter(
            Incident.service == service_name,
            Incident.alert_name == alert_name,
            Incident.status.in_(["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING"])
        ).first()
        
        if active_incident:
            logger.info(f"Active incident {active_incident.id} already exists for {service_name}/{alert_name}. Skipping duplicate workflow.")
            continue
            
        # Check if max tries has been reached for consecutive failures
        if check_max_tries_exceeded(db, service_name, alert_name, MAX_TRIES):
            logger.warning(
                f"[AlertWebhook] Alert '{alert_name}' on service '{service_name}' has exceeded maximum tries ({MAX_TRIES}). Automatic self-healing suspended."
            )
            continue
            
        # Create new incident entry
        incident_id = f"INC-{datetime.utcnow().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        new_incident = Incident(
            id=incident_id,
            service=service_name,
            alert_name=alert_name,
            severity=severity,
            status="INVESTIGATING",
            created_at=datetime.utcnow()
        )
        db.add(new_incident)
        db.commit()
        
        # Log initial alert event
        log_entry = IncidentLog(
            incident_id=incident_id,
            level="WARNING",
            message=f"Alert '{alert_name}' (severity: {severity}) triggered on service '{service_name}'",
            timestamp=datetime.utcnow()
        )
        db.add(log_entry)
        db.commit()
        
        # Queue the agent running loop in background
        background_tasks.add_task(run_agent_workflow, incident_id, service_name, alert_name)
        
    return {"status": "processed", "message": "Triggered background SRE agents for alerts."}

@app.get("/api/v1/incidents")
def list_incidents(db: Session = Depends(get_db)):
    """Lists all past and active SRE incidents."""
    incidents = db.query(Incident).order_by(Incident.created_at.desc()).all()
    return incidents

@app.get("/api/v1/incidents/{incident_id}")
def get_incident_details(incident_id: str, db: Session = Depends(get_db)):
    """Gets details for a single incident."""
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident

@app.get("/api/v1/incidents/{incident_id}/logs")
def get_incident_logs(incident_id: str, db: Session = Depends(get_db)):
    """Gets the execution log timeline for a single incident."""
    logs = db.query(IncidentLog).filter(IncidentLog.incident_id == incident_id).order_by(IncidentLog.timestamp.asc()).all()
    return logs

@app.get("/api/v1/benchmarks")
def get_benchmarks(db: Session = Depends(get_db)):
    """Computes real benchmark metrics from historical incident data."""
    all_incidents = db.query(Incident).all()

    if not all_incidents:
        return {
            "total_incidents": 0,
            "summary": {
                "avg_mttr": 0,
                "recovery_success_rate": 0,
                "false_positive_rate": 0,
                "agent_accuracy": 0,
                "total_resolved": 0,
                "total_failed": 0,
                "total_pending": 0,
            },
            "by_alert_type": []
        }

    # Count by status
    resolved = [i for i in all_incidents if i.status == "RESOLVED"]
    failed = [i for i in all_incidents if i.status == "FAILED"]
    pending = [i for i in all_incidents if i.status == "PENDING_APPROVAL"]
    terminal = resolved + failed  # Only completed incidents count for rates

    # Overall MTTR (only from resolved incidents with timing data)
    mttr_values = [i.resolution_time_seconds for i in resolved if i.resolution_time_seconds is not None]
    avg_mttr = round(sum(mttr_values) / len(mttr_values), 1) if mttr_values else 0

    # Recovery success rate = resolved / (resolved + failed)
    success_rate = round(len(resolved) / len(terminal) * 100, 1) if terminal else 0

    # False positive rate: incidents where the resolution action mentions NO_ACTION
    # or where confidence was below 50 (agent was unsure and likely triggered needlessly)
    false_positives = [
        i for i in all_incidents
        if (i.resolution_action and "NO_ACTION" in (i.resolution_action or "").upper())
        or (i.confidence is not None and i.confidence < 50)
    ]
    fp_rate = round(len(false_positives) / len(all_incidents) * 100, 1) if all_incidents else 0

    # Agent accuracy: average RCA confidence across all incidents that have a confidence score
    confidence_values = [i.confidence for i in all_incidents if i.confidence is not None]
    avg_accuracy = round(sum(confidence_values) / len(confidence_values), 1) if confidence_values else 0

    # Breakdown by alert_name
    alert_types: Dict[str, list] = {}
    for inc in all_incidents:
        name = inc.alert_name or "Unknown"
        alert_types.setdefault(name, []).append(inc)

    by_alert = []
    for alert_name, incidents_list in alert_types.items():
        a_resolved = [i for i in incidents_list if i.status == "RESOLVED"]
        a_failed = [i for i in incidents_list if i.status == "FAILED"]
        a_terminal = a_resolved + a_failed
        a_mttr_vals = [i.resolution_time_seconds for i in a_resolved if i.resolution_time_seconds is not None]
        a_conf_vals = [i.confidence for i in incidents_list if i.confidence is not None]
        a_fp = [
            i for i in incidents_list
            if (i.resolution_action and "NO_ACTION" in (i.resolution_action or "").upper())
            or (i.confidence is not None and i.confidence < 50)
        ]

        by_alert.append({
            "alert_name": alert_name,
            "total": len(incidents_list),
            "resolved": len(a_resolved),
            "failed": len(a_failed),
            "avg_mttr": round(sum(a_mttr_vals) / len(a_mttr_vals), 1) if a_mttr_vals else 0,
            "success_rate": round(len(a_resolved) / len(a_terminal) * 100, 1) if a_terminal else 0,
            "false_positive_rate": round(len(a_fp) / len(incidents_list) * 100, 1) if incidents_list else 0,
            "avg_confidence": round(sum(a_conf_vals) / len(a_conf_vals), 1) if a_conf_vals else 0,
        })

    return {
        "total_incidents": len(all_incidents),
        "summary": {
            "avg_mttr": avg_mttr,
            "recovery_success_rate": success_rate,
            "false_positive_rate": fp_rate,
            "agent_accuracy": avg_accuracy,
            "total_resolved": len(resolved),
            "total_failed": len(failed),
            "total_pending": len(pending),
        },
        "by_alert_type": by_alert
    }

# Simulation Fault Control Proxy Endpoints
LOCAL_PORTS = {
    "api-gateway": 8001,
    "user-service": 8002,
    "order-service": 8003,
    "payment-service": 8004,
    "notification-service": 8005
}

def get_service_url(service: str) -> str:
    """Helper to try accessing service in container, with localhost fallback."""
    # Try container host DNS
    url = f"http://{service}:8000"
    try:
        resp = requests.get(f"{url}/health", timeout=0.15)
        if resp.status_code == 200:
            return url
    except Exception:
        pass
    
    # Try local port fallback
    local_port = LOCAL_PORTS.get(service)
    if local_port:
        return f"http://localhost:{local_port}"
    return url

@app.post("/api/v1/simulation/inject")
def inject_simulation_fault(req: FaultInjectionRequest):
    """Triggers fault injection in a simulated service."""
    service = req.service
    fault = req.fault
    logger.info(f"Requesting fault injection: {fault} on {service}")
    
    url = f"{get_service_url(service)}/fault/{fault}"
    try:
        resp = requests.post(url, timeout=3.0)
        if resp.status_code == 200:
            return {"status": "success", "message": f"Fault '{fault}' injected into '{service}'."}
        else:
            raise HTTPException(status_code=500, detail=f"Service returned error code {resp.status_code}: {resp.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not connect to mock service '{service}' at {url}: {str(e)}")

@app.post("/api/v1/simulation/clear")
def clear_simulation_faults():
    """Clears all faults across all services."""
    services = ["api-gateway", "user-service", "order-service", "payment-service", "notification-service"]
    results = {}
    for service in services:
        url = f"{get_service_url(service)}/fault/clear"
        try:
            resp = requests.post(url, timeout=1.5)
            results[service] = "Cleared" if resp.status_code == 200 else f"Error: {resp.status_code}"
        except Exception as e:
            results[service] = f"Connection failed: {str(e)}"
            
    # Reset consecutive failure counters in db by marking FAILED incidents as RESOLVED
    db = SessionLocal()
    try:
        failed_incidents = db.query(Incident).filter(Incident.status == "FAILED").all()
        for inc in failed_incidents:
            inc.status = "RESOLVED"
            inc.resolution_action = (inc.resolution_action or "") + "\n\n---\nIncident manually cleared/resolved by admin."
        db.commit()
        logger.info(f"Marked {len(failed_incidents)} FAILED incidents as RESOLVED due to manual cluster reset.")
    except Exception as e:
        logger.error(f"Failed to clear failed incidents on reset: {e}")
    finally:
        db.close()
            
    return {"status": "success", "cleared_services": results}

@app.get("/api/v1/simulation/status")
def get_simulation_status():
    """Aggregates metrics and health checks for all simulated microservices."""
    services = ["api-gateway", "user-service", "order-service", "payment-service", "notification-service"]
    status_data = {}
    
    for service in services:
        status_data[service] = {
            "name": service,
            "status": "healthy",
            "cpu": 0.05,
            "memory": 20.0,  # MB
            "faults_injected": False
        }
        
        url = get_service_url(service)
        
        try:
            # Check metrics
            metric_resp = requests.get(f"{url}/metrics", timeout=0.5)
            if metric_resp.status_code == 200:
                for line in metric_resp.text.split("\n"):
                    if line.startswith("service_memory_usage_bytes"):
                        status_data[service]["memory"] = float(line.split()[1]) / (1024 * 1024)
                    elif line.startswith("service_cpu_usage_ratio"):
                        status_data[service]["cpu"] = float(line.split()[1])
            
            # Check health
            health_resp = requests.get(f"{url}/health", timeout=0.5)
            if health_resp.status_code != 200:
                status_data[service]["status"] = "unhealthy"
            
            # Detect active faults in metric values
            if status_data[service]["memory"] > 50.0 or status_data[service]["cpu"] > 0.5 or health_resp.status_code != 200:
                status_data[service]["faults_injected"] = True
                
        except Exception:
            status_data[service]["status"] = "offline"
            status_data[service]["cpu"] = 0.0
            status_data[service]["memory"] = 0.0
            status_data[service]["faults_injected"] = False
            
    return status_data

