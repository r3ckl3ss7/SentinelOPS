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
from app.agent import agent_app, log_step

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

def _create_and_run_incident(service_name: str, alert_name: str, severity: str):
    """Create an incident record and run the agent workflow synchronously."""
    db = SessionLocal()
    try:
        # Double-check dedup inside the monitor thread
        if _has_active_incident(db, service_name, alert_name):
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
        db = next(get_db())
        incident = db.query(Incident).filter(Incident.id == incident_id).first()
        if incident:
            incident.status = "FAILED"
            db.commit()

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

