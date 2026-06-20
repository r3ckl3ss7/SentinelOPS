import os
import re
import json
import time
import logging
from typing import TypedDict, List, Optional
from datetime import datetime

from sqlalchemy.orm import Session
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END

from app.database import SessionLocal, Incident, IncidentLog
from app.tools import (
    get_container_logs, 
    get_service_metrics, 
    check_service_health, 
    restart_service, 
    rollback_deployment, 
    scale_service
)
from app.sre_system_prompt import (
    SRE_SYSTEM_PROMPT, 
    build_investigation_prompt,
    AUDITOR_SYSTEM_PROMPT,
    build_audit_report_prompt,
    GOVERNANCE_SYSTEM_PROMPT,
    build_governance_prompt
)

# Logger setup
logger = logging.getLogger("sentinel-agent")

# LLM Setup
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
# Normalize base url for OpenAI SDK
base_url = OLLAMA_HOST if OLLAMA_HOST.endswith("/v1") else f"{OLLAMA_HOST}/v1"

# Initialize LLM
try:
    llm = ChatOpenAI(
        base_url=base_url,
        api_key="ollama",  # Ollama doesn't validate keys
        model="qwen2.5:3b",
        temperature=0.0,
        timeout=120.0
    )
    logger.info(f"LLM initialized pointing to {base_url} using model qwen2.5:3b")
except Exception as e:
    logger.error(f"Failed to initialize LLM: {str(e)}")
    llm = None

# Runbook name mapping
RUNBOOK_TO_ACTION = {
    "RESTART_SERVICE": "RESTART",
    "ROLLBACK_DEPLOYMENT": "ROLLBACK",
    "SCALE_SERVICE": "SCALE",
    "CLEAR_STUCK_JOBS": "CLEAR_STUCK_JOBS",
    "RESTART_DEPENDENCY": "RESTART_DEPENDENCY",
    "NO_ACTION": "NO_ACTION",
    "DESTROY_AND_REBUILD_DATABASE": "DESTROY",
}

MAX_TRIES = 3

# Graph State Schema
class AgentState(TypedDict):
    incident_id: str
    service: str
    alert_name: str
    status: str
    root_cause: Optional[str]
    confidence: Optional[int]
    severity: Optional[str]
    risk_level: Optional[str]
    evidence: Optional[List[str]]
    affected_services: Optional[List[str]]
    reasoning_summary: Optional[str]
    remediation_choice: Optional[str]
    remediation_result: Optional[str]
    verification_success: Optional[bool]
    incident_report: Optional[str]
    # Multi-agent routing state and collected telemetry cache
    next_agent: Optional[str]
    analyzer_logs: Optional[str]
    analyzer_metrics: Optional[str]
    analyzer_health: Optional[str]
    # Safety and Governance fields
    governance_approved: Optional[bool]
    governance_reason: Optional[str]

# Database logging helpers
def log_step(incident_id: str, message: str, level: str = "INFO"):
    db = SessionLocal()
    try:
        log_entry = IncidentLog(
            incident_id=incident_id,
            level=level,
            message=message,
            timestamp=datetime.utcnow()
        )
        db.add(log_entry)
        db.commit()
        logger.info(f"[{incident_id}] [{level}] {message}")
    except Exception as e:
        logger.error(f"Failed to log step to DB: {str(e)}")
    finally:
        db.close()

def update_incident_status(incident_id: str, status: str, root_cause: str = None,
                           action: str = None, confidence: int = None,
                           risk_level: str = None, evidence: list = None,
                           affected_services: list = None,
                           reasoning_summary: str = None):
    db = SessionLocal()
    try:
        incident = db.query(Incident).filter(Incident.id == incident_id).first()
        if incident:
            incident.status = status
            if root_cause is not None:
                incident.root_cause = root_cause
            if action is not None:
                incident.resolution_action = action
            if confidence is not None:
                incident.confidence = confidence
            if risk_level is not None:
                incident.risk_level = risk_level
            if evidence is not None:
                incident.evidence = json.dumps(evidence)
            if affected_services is not None:
                incident.affected_services = json.dumps(affected_services)
            if reasoning_summary is not None:
                incident.reasoning_summary = reasoning_summary
            incident.updated_at = datetime.utcnow()
            db.commit()
    except Exception as e:
        logger.error(f"Failed to update incident: {str(e)}")
    finally:
        db.close()

def send_admin_failure_email(incident_id: str, service: str, alert_name: str, reason: str,
                             action: str = None, confidence: int = None, risk_level: str = None):
    """
    Simulates sending an email notification to the administrator and SRE leads when an incident fails.
    Also creates a Markdown file artifact in the workspace.
    """
    db = SessionLocal()
    consecutive_failures = 0
    try:
        incidents = db.query(Incident).filter(
            Incident.service == service,
            Incident.alert_name == alert_name
        ).order_by(Incident.created_at.desc()).all()
        
        for inc in incidents:
            if inc.status == "FAILED":
                consecutive_failures += 1
            elif inc.status == "RESOLVED":
                break
    except Exception as e:
        logger.error(f"Failed to query consecutive failures for email: {e}")
        consecutive_failures = 1
    finally:
        db.close()

    email_recipient = "admin@company.com"
    email_subject = f"[SentinelOps Outage Alert] Incident {incident_id} Resolution FAILED"
    
    action_str = action if action else "Unknown Action"
    risk_str = risk_level if risk_level else "Unknown Risk"
    conf_str = f"{confidence}%" if isinstance(confidence, int) else str(confidence)
    
    email_body = (
        f"Dear Administrator,\n\n"
        f"The SRE Agent has failed to resolve the following incident.\n\n"
        f"Incident ID: {incident_id}\n"
        f"Service: {service}\n"
        f"Trigger Alert: {alert_name}\n"
        f"Proposed Remediation: {action_str}\n"
        f"RCA Confidence: {conf_str}\n"
        f"Risk Level: {risk_str}\n"
        f"Failure Reason: {reason}\n"
        f"Consecutive Failures: {consecutive_failures}/3\n\n"
    )
    if consecutive_failures >= 3:
        email_body += "WARNING: Maximum retry limit (3) reached. Automatic self-healing is now suspended. Immediate manual intervention is required!\n"
    else:
        email_body += "The SRE Agent will retry remediation in the next monitoring cycle.\n"

    log_step(incident_id, f"[Auditor] Simulating failure email notification to {email_recipient}...", "INFO")

    # Write Markdown failure notification artifact to the workspace
    try:
        artifact_content = (
            f"# SentinelOps Admin Alert - Incident FAILED - {incident_id}\n\n"
            f"> [!CAUTION]\n"
            f"> **Automated remediation failed. Manual intervention may be required.**\n\n"
            f"## Incident Details\n"
            f"* **Incident ID:** `{incident_id}`\n"
            f"* **Affected Service:** `{service}`\n"
            f"* **Fired Alert:** `{alert_name}`\n"
            f"* **RCA Confidence:** `{conf_str}`\n"
            f"* **Risk Level:** `{risk_str}`\n"
            f"* **Consecutive Failures:** `{consecutive_failures} of 3`\n\n"
            f"## Status Update\n"
            f"{'**CRITICAL:** Maximum retry limit reached. Automatic remediation suspended.' if consecutive_failures >= 3 else 'The agent will attempt self-healing again.'}\n\n"
            f"## Simulated Notification\n"
            f"```text\n"
            f"To: {email_recipient}\n"
            f"Subject: {email_subject}\n\n"
            f"{email_body}\n"
            f"```\n"
        )
        filepath = f"c:/Coding/Web/Hackathons/SentinalOPS/admin_notification_{incident_id}.md"
        with open(filepath, "w", encoding="utf-8") as art_f:
            art_f.write(artifact_content)
        log_step(incident_id, f"[Auditor] Created admin notification artifact at '{filepath}'", "INFO")
    except Exception as ex:
        log_step(incident_id, f"[Auditor] Failed to write admin notification artifact: {str(ex)}", "WARNING")

# JSON Parsing Helpers
def _try_parse_json(text: str) -> dict | None:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass

    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except (json.JSONDecodeError, TypeError):
            pass

    return None

def _heuristic_diagnosis(alert_name: str, service: str) -> dict:
    if "DatabaseCorruptionAlert" in alert_name:
        return {
            "root_cause": "Database integrity check failed. Block corruption detected in postgres storage files.",
            "confidence": 50,
            "severity": "critical",
            "risk_level": "CRITICAL",
            "evidence": ["Checksum validation failed on table users", "Disk block 0x4f32 invalid read"],
            "affected_services": ["database-service", "order-service", "payment-service"],
            "recommended_runbook": "DESTROY_AND_REBUILD_DATABASE",
            "reasoning_summary": "Block corruption requires rebuilding database and running recovery from latest snapshot."
        }
    elif "LowPriorityWarning" in alert_name:
        return {
            "root_cause": "Routine health check latency warning.",
            "confidence": 95,
            "severity": "warning",
            "risk_level": "LOW",
            "evidence": ["Latency briefly touched 250ms"],
            "affected_services": [service],
            "recommended_runbook": "RESTART_SERVICE",
            "reasoning_summary": "Routine warning. Restarting service to restore normal telemetry."
        }
    elif "HighMemoryUsage" in alert_name:
        return {
            "root_cause": "Detected out-of-memory conditions in service logs and memory metrics above threshold.",
            "confidence": 75,
            "severity": "critical",
            "risk_level": "HIGH",
            "evidence": ["Memory usage exceeds 80 MB threshold", "Potential OutOfMemoryError in logs"],
            "affected_services": [service],
            "recommended_runbook": "RESTART_SERVICE",
            "reasoning_summary": "Memory leak pattern detected. Restarting the service clears the accumulated heap and restores normal operation."
        }
    elif "HighCpuUsage" in alert_name:
        return {
            "root_cause": "CPU utilization spiked beyond 80% threshold indicating a busy-loop or runaway process.",
            "confidence": 90,
            "severity": "warning",
            "risk_level": "MEDIUM",
            "evidence": ["CPU usage ratio exceeds 0.80", "Sustained high utilization"],
            "affected_services": [service],
            "recommended_runbook": "RESTART_SERVICE",
            "reasoning_summary": "CPU spike pattern detected. A service restart terminates the runaway workload."
        }
    elif "HttpErrorSpike" in alert_name:
        return {
            "root_cause": "HTTP 500 error count spiked. Downstream service failure or bad deployment suspected.",
            "confidence": 65,
            "severity": "critical",
            "risk_level": "HIGH",
            "evidence": ["Rapid increase in HTTP 500 responses", "Health endpoint returning non-200"],
            "affected_services": [service],
            "recommended_runbook": "ROLLBACK_DEPLOYMENT",
            "reasoning_summary": "Error spike suggests a deployment regression or dependency failure. Rolling back the deployment is the safest immediate action."
        }
    elif "DependencyFailure" in alert_name:
        return {
            "root_cause": "A downstream microservice dependency is down or failing to respond to API requests.",
            "confidence": 90,
            "severity": "critical",
            "risk_level": "HIGH",
            "evidence": ["Downstream connection refused", "HTTP 503 from dependency"],
            "affected_services": [service, "payment-service"],
            "recommended_runbook": "RESTART_DEPENDENCY",
            "reasoning_summary": "Downstream service is unreachable. Restarting the failing downstream dependency to restore communication chain."
        }
    elif "DatabaseSaturation" in alert_name:
        return {
            "root_cause": "The database connection pool is exhausted or queries are locking resources.",
            "confidence": 85,
            "severity": "critical",
            "risk_level": "CRITICAL",
            "evidence": ["Connection pool checkouts timed out", "Database connection queue size > 50"],
            "affected_services": [service, "database-service"],
            "recommended_runbook": "CLEAR_STUCK_JOBS",
            "reasoning_summary": "High DB connection pool utilization. Running CLEAR_STUCK_JOBS to release locks and terminate orphaned sessions."
        }
    elif "NetworkPartition" in alert_name:
        return {
            "root_cause": "Network connectivity is broken, isolating the service from dependencies.",
            "confidence": 80,
            "severity": "critical",
            "risk_level": "HIGH",
            "evidence": ["Network is unreachable", "Gateway timeout 504 on downstream calls"],
            "affected_services": [service],
            "recommended_runbook": "RESTART_SERVICE",
            "reasoning_summary": "A network partition has isolated the service. Restarting the service to reset its networking state."
        }
    elif "CascadingFailure" in alert_name:
        return {
            "root_cause": "Domino effect where a downstream outage saturates the upstream request queue.",
            "confidence": 85,
            "severity": "critical",
            "risk_level": "HIGH",
            "evidence": ["Downstream returned 500", "Backpressure queue saturated", "High request latency"],
            "affected_services": [service, "order-service", "payment-service"],
            "recommended_runbook": "SCALE_SERVICE",
            "reasoning_summary": "Cascading failure detected due to backpressure. Scaling the service to absorb queue saturation and buffer requests."
        }
    elif "ConfigurationDrift" in alert_name:
        return {
            "root_cause": "Service configuration parameters have drifted from the standard baseline.",
            "confidence": 95,
            "severity": "warning",
            "risk_level": "HIGH",
            "evidence": ["Configuration parameter drifted", "Invalid database host config"],
            "affected_services": [service],
            "recommended_runbook": "ROLLBACK_DEPLOYMENT",
            "reasoning_summary": "Configuration drift detected. Rolling back the deployment to the last known stable configuration."
        }
    elif "CertificateExpiration" in alert_name:
        return {
            "root_cause": "The SSL/TLS certificate for the service has expired.",
            "confidence": 95,
            "severity": "critical",
            "risk_level": "MEDIUM",
            "evidence": ["SSL: CERTIFICATE_VERIFY_FAILED", "Certificate expired error"],
            "affected_services": [service],
            "recommended_runbook": "RESTART_SERVICE",
            "reasoning_summary": "SSL certificate has expired. Restarting the service to reload the renewed certificate from disk."
        }
    else:
        return {
            "root_cause": "General metric warning trigger — unable to determine specific cause.",
            "confidence": 40,
            "severity": "warning",
            "risk_level": "LOW",
            "evidence": ["Alert threshold crossed"],
            "affected_services": [service],
            "recommended_runbook": "RESTART_SERVICE",
            "reasoning_summary": "Insufficient signal to determine root cause with confidence. Restarting the service as a safe default."
        }


# ── MULTI-AGENT SUBAGENTS (LANGGRAPH NODES) ───────────────────────────────

def incident_commander_node(state: AgentState) -> AgentState:
    """
    Incident Commander Subagent:
    - Central director of the SRE team.
    - Manages lifecycle coordination, logs step delegation, and makes routing choices based on achievements in state.
    """
    incident_id = state["incident_id"]
    service = state["service"]
    
    # 1. Telemetry check
    has_telemetry = state.get("analyzer_logs") is not None or state.get("analyzer_metrics") is not None
    if not has_telemetry:
        log_step(incident_id, f"[Incident Commander] Initializing SRE Multi-Agent team response for incident: {incident_id}.", "INFO")
        update_incident_status(incident_id, "INVESTIGATING")
        log_step(incident_id, "[Incident Commander] Action: Routing control to Metrics/Log Analyzer for telemetry collection.", "AGENT_THOUGHT")
        return {
            **state,
            "next_agent": "metrics_log_analyzer",
            "status": "INVESTIGATING"
        }
        
    # 2. Diagnostics check
    has_diagnosis = state.get("root_cause") is not None
    if not has_diagnosis:
        log_step(incident_id, "[Incident Commander] Telemetry collection completed. Routing control to Diagnostics Agent for root-cause analysis.", "AGENT_THOUGHT")
        return {
            **state,
            "next_agent": "diagnostics_agent"
        }
        
    # 3. Governance & Safety check
    remediation_choice = state.get("remediation_choice")
    needs_remediation = remediation_choice is not None and remediation_choice != "NO_ACTION"
    governance_approved = state.get("governance_approved")
    has_remediation = state.get("remediation_result") is not None
    
    if needs_remediation and governance_approved is None:
        log_step(incident_id, "[Incident Commander] Diagnostics completed. Routing to Governance & Safety Agent for risk evaluation.", "AGENT_THOUGHT")
        return {
            **state,
            "next_agent": "governance_safety"
        }
        
    if needs_remediation and governance_approved is True and not has_remediation:
        log_step(incident_id, f"[Incident Commander] Governance approved. Routing to Remediation Executor to deploy plan: {remediation_choice}.", "AGENT_THOUGHT")
        return {
            **state,
            "next_agent": "remediation_executor"
        }
        
    if needs_remediation and governance_approved is False and not has_remediation and state.get("verification_success") is None:
        log_step(incident_id, "[Incident Commander] Governance safety check suspended / flagged for approval. Routing directly to Auditor to freeze SRE execution.", "INFO")
        return {
            **state,
            "next_agent": "auditor",
            "status": "PENDING_APPROVAL"
        }
        
    # 4. Verification/Audit check
    has_verification = state.get("verification_success") is not None
    if not has_verification:
        if not needs_remediation:
            log_step(incident_id, f"[Incident Commander] Diagnostics completed: root cause is '{state.get('root_cause')}' ({state.get('confidence', 0)}% confidence). Recommended runbook: NO_ACTION.", "INFO")
            log_step(incident_id, "[Incident Commander] Action: Bypassing remediation (NO_ACTION). Routing directly to Auditor.", "AGENT_THOUGHT")
        elif governance_approved is False:
            log_step(incident_id, "[Incident Commander] Bypassing remediation due to governance suspension. Routing to Auditor.", "AGENT_THOUGHT")
        else:
            log_step(incident_id, "[Incident Commander] Remediation successfully deployed. Routing control to Auditor for recovery verification.", "AGENT_THOUGHT")
            
        return {
            **state,
            "next_agent": "auditor"
        }
        
    # 5. Final report check (already done by auditor)
    success = state.get("verification_success", False)
    if governance_approved is False:
        log_step(incident_id, f"[Incident Commander] Incident workflow paused at PENDING_APPROVAL. Waiting for administrative action.", "INFO")
        return {
            **state,
            "next_agent": "end",
            "status": "PENDING_APPROVAL"
        }
        
    status_val = "RESOLVED" if success else "FAILED"
    log_step(incident_id, f"[Incident Commander] SRE verification & post-mortem complete. Closing incident lifecycle as {status_val}.", "INFO")
    return {
        **state,
        "next_agent": "end"
    }


def metrics_log_analyzer_node(state: AgentState) -> AgentState:
    """
    Metrics/Log Analyzer Subagent:
    - Queries Prometheus metrics and container log streams.
    - Writes telemetry results to State cache for downstream consumption.
    """
    incident_id = state["incident_id"]
    service = state["service"]
    
    log_step(incident_id, f"[Metrics/Log Analyzer] Collecting diagnostic context for '{service}'.", "INFO")
    
    log_step(incident_id, f"[Metrics/Log Analyzer] Action: Scrape raw metrics telemetry for {service}", "AGENT_ACTION")
    metrics = get_service_metrics.invoke({"service_name": service})
    log_step(incident_id, f"[Metrics/Log Analyzer] Result: Telemetry values returned:\n{metrics}", "AGENT_RESULT")
    
    log_step(incident_id, f"[Metrics/Log Analyzer] Action: Query health endpoint /health for {service}", "AGENT_ACTION")
    health = check_service_health.invoke({"service_name": service})
    log_step(incident_id, f"[Metrics/Log Analyzer] Result: Health endpoint output:\n{health}", "AGENT_RESULT")
    
    log_step(incident_id, f"[Metrics/Log Analyzer] Action: Pull container stdout logs for {service}", "AGENT_ACTION")
    logs = get_container_logs.invoke({"service_name": service, "lines": 30})
    truncated_logs = logs[:800] + "..." if len(logs) > 800 else logs
    log_step(incident_id, f"[Metrics/Log Analyzer] Result: Logs retrieved:\n{truncated_logs}", "AGENT_RESULT")
    
    log_step(incident_id, "[Metrics/Log Analyzer] Telemetry parsing completed. Routing control back to Incident Commander.", "INFO")
    return {
        **state,
        "analyzer_logs": logs,
        "analyzer_metrics": metrics,
        "analyzer_health": health,
        "next_agent": "incident_commander"
    }


def diagnostics_agent_node(state: AgentState) -> AgentState:
    """
    Diagnostics Agent Subagent:
    - Analyzes telemetry data collected by the Metrics/Log Analyzer.
    - Decides on root cause, severity, blast radius, risk level, and runbook.
    """
    incident_id = state["incident_id"]
    service = state["service"]
    alert_name = state["alert_name"]
    
    logs = state.get("analyzer_logs") or ""
    metrics = state.get("analyzer_metrics") or ""
    health = state.get("analyzer_health") or ""
    
    log_step(incident_id, f"[Diagnostics Agent] Starting incident diagnosis for service: {service}.", "INFO")
    update_incident_status(incident_id, "ROOT_CAUSE_FOUND")
    
    log_step(incident_id, "[Diagnostics Agent] Thought: Performing correlations between metrics and log failure traces...", "AGENT_THOUGHT")
    
    diagnosis = _heuristic_diagnosis(alert_name, service)
    
    try:
        if llm:
            user_prompt = build_investigation_prompt(alert_name, service, metrics, health, logs)
            response = llm.invoke([
                SystemMessage(content=SRE_SYSTEM_PROMPT),
                HumanMessage(content=user_prompt)
            ])
            content = response.content.strip()
            log_step(incident_id, f"[Diagnostics Agent] Thought — LLM RCA Output:\n{content}", "AGENT_THOUGHT")
            
            parsed = _try_parse_json(content)
            if parsed and "root_cause" in parsed:
                diagnosis = {
                    "root_cause": parsed.get("root_cause", diagnosis["root_cause"]),
                    "confidence": int(parsed.get("confidence", diagnosis["confidence"])),
                    "severity": str(parsed.get("severity", diagnosis["severity"])).lower(),
                    "risk_level": str(parsed.get("risk_level", diagnosis["risk_level"])).upper(),
                    "evidence": parsed.get("evidence", diagnosis["evidence"]),
                    "affected_services": parsed.get("affected_services", diagnosis["affected_services"]),
                    "recommended_runbook": str(parsed.get("recommended_runbook", diagnosis["recommended_runbook"])).upper(),
                    "reasoning_summary": parsed.get("reasoning_summary", diagnosis["reasoning_summary"]),
                }
                log_step(incident_id, "[Diagnostics Agent] Structured JSON diagnosis parsed successfully.", "INFO")
            else:
                log_step(incident_id, "[Diagnostics Agent] LLM output could not be parsed as structured JSON. Using heuristic fallback.", "WARNING")
        else:
            log_step(incident_id, "[Diagnostics Agent] LLM unavailable. Using heuristic fallback.", "WARNING")
            
    except Exception as e:
        logger.error(f"Diagnostics Agent LLM reasoning failed: {str(e)}")
        log_step(incident_id, f"[Diagnostics Agent] LLM error: {str(e)}. Falling back to heuristic diagnosis.", "WARNING")
        
    root_cause = diagnosis["root_cause"]
    confidence = diagnosis["confidence"]
    severity = diagnosis["severity"]
    risk_level = diagnosis["risk_level"]
    evidence = diagnosis["evidence"]
    affected_services = diagnosis["affected_services"]
    reasoning_summary = diagnosis["reasoning_summary"]
    recommended_runbook = diagnosis["recommended_runbook"]
    
    remediation_choice = RUNBOOK_TO_ACTION.get(recommended_runbook, "RESTART")
    
    log_step(incident_id, f"[Diagnostics Agent] Root cause: {root_cause}", "INFO")
    log_step(incident_id, f"[Diagnostics Agent] Confidence: {confidence}% | Risk Level: {risk_level} | Blast Radius: {json.dumps(affected_services)}", "INFO")
    
    update_incident_status(
        incident_id, "ROOT_CAUSE_FOUND",
        root_cause=root_cause,
        confidence=confidence,
        risk_level=risk_level,
        evidence=evidence,
        affected_services=affected_services,
        reasoning_summary=reasoning_summary
    )
    
    return {
        **state,
        "root_cause": root_cause,
        "confidence": confidence,
        "severity": severity,
        "risk_level": risk_level,
        "evidence": evidence,
        "affected_services": affected_services,
        "reasoning_summary": reasoning_summary,
        "remediation_choice": remediation_choice,
        "next_agent": "incident_commander"
    }


def remediation_executor_node(state: AgentState) -> AgentState:
    """
    Remediation Executor Subagent:
    - Dispatches infrastructure recovery procedures matching the remediation_choice.
    """
    incident_id = state["incident_id"]
    service = state["service"]
    choice = state["remediation_choice"]
    
    log_step(incident_id, f"[Remediation Executor] Starting recovery script execution for service: {service}.", "INFO")
    update_incident_status(incident_id, "EXECUTING_FIX")
    
    result = ""
    if choice == "NO_ACTION":
        log_step(incident_id, "[Remediation Executor] Action: Skipping execution (NO_ACTION recommended).", "INFO")
        result = "No action taken — agent assessed the issue as self-resolving or not actionable."
    elif choice == "RESTART":
        log_step(incident_id, f"[Remediation Executor] Action: restart_service({service})", "AGENT_ACTION")
        result = restart_service.invoke({"service_name": service})
    elif choice == "CLEAR_STUCK_JOBS":
        log_step(incident_id, f"[Remediation Executor] Action: clear_stuck_jobs({service}) - resetting connection state", "AGENT_ACTION")
        result = restart_service.invoke({"service_name": service})
    elif choice == "RESTART_DEPENDENCY":
        # Find downstream dependency to restart
        dep_service = None
        if service == "api-gateway":
            dep_service = "order-service"
        elif service == "order-service":
            dep_service = "payment-service"
        elif service == "payment-service":
            dep_service = "notification-service"
        
        if not dep_service:
            dep_service = service
            
        log_step(incident_id, f"[Remediation Executor] Action: restart_service({dep_service}) (Restarting failing dependency)", "AGENT_ACTION")
        result = restart_service.invoke({"service_name": dep_service})
    elif choice == "ROLLBACK":
        log_step(incident_id, f"[Remediation Executor] Action: rollback_deployment({service})", "AGENT_ACTION")
        result = rollback_deployment.invoke({"service_name": service})
    elif choice == "SCALE":
        log_step(incident_id, f"[Remediation Executor] Action: scale_service({service}, replicas=3)", "AGENT_ACTION")
        result = scale_service.invoke({"service_name": service, "replicas": 3})
    else:
        result = f"Unknown action selection: {choice}. Execution skipped."
        
    log_step(incident_id, f"[Remediation Executor] Result: Output from recovery tool:\n{result}", "AGENT_RESULT")
    update_incident_status(incident_id, "EXECUTING_FIX", action=f"{choice}: {result}")
    
    return {
        **state,
        "remediation_result": result,
        "next_agent": "incident_commander"
    }


def auditor_node(state: AgentState) -> AgentState:
    """
    Auditor Subagent:
    - Verifies recovery status of the microservice.
    - Evaluates process compliance, runs LLM audit summaries, and stores the Markdown report.
    """
    incident_id = state["incident_id"]
    service = state["service"]
    alert_name = state["alert_name"]
    root_cause = state["root_cause"]
    action = state["remediation_choice"]
    remediation_result = state.get("remediation_result") or "No action taken — halted by safety policy."
    confidence = state.get("confidence", "N/A")
    risk_level = state.get("risk_level", "N/A")
    evidence = state.get("evidence", [])
    affected_services = state.get("affected_services", [])
    reasoning_summary = state.get("reasoning_summary", "")
    governance_approved = state.get("governance_approved")
    
    if governance_approved is False:
        log_step(incident_id, f"[Auditor] Governance safety check suspended execution. Bypassing health checks & metrics checks.", "INFO")
        resolution_time = 0.0
        success = False
        report_content = (
            f"# SRE Incident Post-Mortem and Audit Report - {incident_id}\n\n"
            f"## Executive Summary\n"
            f"An incident was triggered on **{service}** due to **{alert_name}** alert.\n"
            f"The SRE safety system determined this action is **{risk_level} RISK** and suspended automatic execution.\n\n"
            f"## Safety Policy Details\n"
            f"* **Governance Status:** PENDING HUMAN APPROVAL\n"
            f"* **Proposed Remediation:** {action}\n"
            f"* **Governance Reason:** {state.get('governance_reason')}\n\n"
            f"## Root Cause Analysis\n"
            f"* **Root Cause:** {root_cause}\n"
            f"* **Confidence:** {confidence}%\n"
            f"* **Affected Services:** {', '.join(affected_services)}\n"
        )
        db = SessionLocal()
        try:
            incident = db.query(Incident).filter(Incident.id == incident_id).first()
            if incident:
                incident.status = "PENDING_APPROVAL"
                incident.resolution_action = report_content
                db.commit()
        except Exception as e:
            logger.error(f"Auditor failed writing safety report to DB: {str(e)}")
        finally:
            db.close()
            
        log_step(incident_id, f"[Auditor] Safety report compiled. Workflow suspended pending manual approval.", "INFO")
        return {
            **state,
            "verification_success": False,
            "incident_report": report_content,
            "next_agent": "incident_commander"
        }
        
    log_step(incident_id, "[Auditor] Verification loop initialized. Sleeping 5 seconds for service convergence...", "INFO")
    update_incident_status(incident_id, "VERIFYING")
    
    time.sleep(5)
    
    log_step(incident_id, f"[Auditor] Action: check_service_health({service})", "AGENT_ACTION")
    health = check_service_health.invoke({"service_name": service})
    log_step(incident_id, f"[Auditor] Result: Health status probe output:\n{health}", "AGENT_RESULT")
    
    log_step(incident_id, f"[Auditor] Action: get_service_metrics({service})", "AGENT_ACTION")
    metrics = get_service_metrics.invoke({"service_name": service})
    log_step(incident_id, f"[Auditor] Result: Metrics values retrieved:\n{metrics}", "AGENT_RESULT")
    
    success = False
    log_step(incident_id, "[Auditor] Thought: Evaluating post-healing telemetry rules...", "AGENT_THOUGHT")
    
    health_ok = "Status: 200" in health or '"status": "healthy"' in health or '"status":"healthy"' in health
    if health_ok:
        log_step(incident_id, "[Auditor] Heuristics Check: Service returned healthy status code.", "AGENT_THOUGHT")
        success = True
    else:
        log_step(incident_id, "[Auditor] Heuristics Check: Service returned unhealthy status code.", "AGENT_THOUGHT")
        
    try:
        if llm:
            prompt = (
                f"You are the SRE Auditor checking service recovery.\n"
                f"Service: {service}\n\n"
                f"--- POST-REMEDIATION TELEMETRY ---\n"
                f"Health check:\n{health}\n\n"
                f"Metrics:\n{metrics}\n"
                f"----------------------------------\n\n"
                f"Is the service recovered? Answer with 'YES' if health is 200 OK. Otherwise answer 'NO'.\n"
                f"Response (YES/NO):"
            )
            response = llm.invoke([
                SystemMessage(content="You are an SRE checking service recovery. Answer YES or NO."),
                HumanMessage(content=prompt)
            ])
            content = response.content.strip().upper()
            log_step(incident_id, f"[Auditor] LLM recovery check: {content}", "AGENT_THOUGHT")
            if "YES" in content:
                success = True
    except Exception as e:
        logger.error(f"Auditor LLM verification check failed: {str(e)}")
        log_step(incident_id, "[Auditor] LLM validation check error. Relying on heuristics.", "WARNING")
        
    resolution_time = 60.0
    db = SessionLocal()
    try:
        incident = db.query(Incident).filter(Incident.id == incident_id).first()
        if incident:
            delta = datetime.utcnow() - incident.created_at
            resolution_time = round(delta.total_seconds(), 1)
            incident.status = "RESOLVED" if success else "FAILED"
            incident.resolution_time_seconds = resolution_time
            db.commit()
    except Exception as e:
        logger.error(f"Auditor failed writing status info to DB: {str(e)}")
    finally:
        db.close()
        
    if not success:
        send_admin_failure_email(
            incident_id=incident_id,
            service=service,
            alert_name=alert_name,
            reason="Service verification failed after remediation. Health check returned unhealthy status code.",
            action=action,
            confidence=confidence,
            risk_level=risk_level
        )
        
    log_step(incident_id, "[Auditor] Action: Compiling final Markdown Post-Mortem Report", "INFO")
    evidence_str = "\n".join(f"  - {e}" for e in evidence) if evidence else "  - No specific evidence collected"
    affected_str = ", ".join(affected_services) if affected_services else service
    
    report_content = ""
    try:
        if llm:
            audit_prompt = build_audit_report_prompt(
                incident_id=incident_id,
                service=service,
                alert_name=alert_name,
                root_cause=root_cause,
                confidence=confidence,
                risk_level=risk_level,
                evidence_str=evidence_str,
                affected_str=affected_str,
                reasoning_summary=reasoning_summary,
                action=action,
                remediation_result=remediation_result,
                success=success,
                resolution_time=resolution_time
            )
            response = llm.invoke([
                SystemMessage(content=AUDITOR_SYSTEM_PROMPT),
                HumanMessage(content=audit_prompt)
            ])
            report_content = response.content.strip()
        else:
            raise Exception("LLM unavailable")
    except Exception as e:
        logger.warning(f"Auditor failed compiling LLM report: {str(e)}. Writing markdown fallback report.")
        report_content = (
            f"# SRE Incident Post-Mortem and Audit Report - {incident_id}\n\n"
            f"## Executive Summary\n"
            f"An incident was triggered on **{service}** due to **{alert_name}** alert.\n"
            f"Remediation choice '{action}' was executed by SRE team.\n\n"
            f"## Root Cause Analysis\n"
            f"* **Root Cause:** {root_cause}\n"
            f"* **Confidence:** {confidence}%\n\n"
            f"## Actions & Remediation Audit\n"
            f"* **Action Choice:** {action}\n"
            f"* **Result:** {remediation_result}\n"
            f"* **Compliance Risk Level:** {risk_level}\n\n"
            f"## Verification & Resolution Summary\n"
            f"* **Success:** {success}\n"
            f"* **MTTR:** {resolution_time}s\n"
        )
        
    db = SessionLocal()
    try:
        incident = db.query(Incident).filter(Incident.id == incident_id).first()
        if incident:
            incident.resolution_action = report_content
            db.commit()
    except Exception as e:
        logger.error(f"Auditor failed storing post-mortem in DB: {str(e)}")
    finally:
        db.close()
        
    log_step(incident_id, f"[Auditor] Markdown Post-Mortem compiled successfully. Verification result: {'SUCCESS' if success else 'FAILED'}.", "INFO")
    
    return {
        **state,
        "verification_success": success,
        "incident_report": report_content,
        "next_agent": "incident_commander"
    }


def governance_safety_agent_node(state: AgentState) -> AgentState:
    """
    Governance & Safety Agent Node:
    - Evaluates proposed remediation action based on risk level, confidence, impacted services, and service type.
    - Classifies the proposed action into LOW, MEDIUM, HIGH, or CRITICAL risk.
    - Decides whether it can execute automatically or requires human approval.
    """
    incident_id = state["incident_id"]
    service = state["service"]
    root_cause = state.get("root_cause") or "Unknown"
    confidence = state.get("confidence") or 100
    remediation_choice = state.get("remediation_choice") or "RESTART"
    affected_services = state.get("affected_services") or [service]
    alert_name = state.get("alert_name") or "UnknownAlert"
    logs = state.get("analyzer_logs") or "No logs available"
    metrics = state.get("analyzer_metrics") or "No metrics available"

    log_step(incident_id, f"[Governance & Safety Agent] Evaluating remediation action '{remediation_choice}' for service '{service}'.", "INFO")

    # Sensitive systems and database checks
    is_db_op = any(kw in service.lower() for kw in ["db", "database", "postgres", "sql"])
    is_auth_service = any(kw in service.lower() for kw in ["auth", "login", "jwt", "session"])
    is_user_service = "user-service" in service.lower() or service.lower() == "user"
    is_payment_service = "payment-service" in service.lower() or service.lower() == "payment"
    is_security_sensitive = any(kw in service.lower() for kw in ["vault", "secret", "security"])
    is_sensitive = is_db_op or is_auth_service or is_user_service or is_payment_service or is_security_sensitive

    critical_triggers = []
    # Database operations, Data deletion, Schema changes, Rebuild actions, DESTROY action
    is_destructive_action = remediation_choice in ["DESTROY", "DESTROY_AND_REBUILD_DATABASE"]
    if is_db_op and is_destructive_action:
        critical_triggers.append("Database operations / Destructive action on DB")
    elif is_destructive_action:
        critical_triggers.append("Remediation action is destructive / rebuild / destroy")
    elif is_db_op and any(kw in remediation_choice.lower() for kw in ["rebuild", "schema", "delete"]):
        critical_triggers.append("Destructive schema/rebuild database operation")
        
    # More than 3 services affected
    if len(affected_services) > 3:
        critical_triggers.append(f"More than 3 services affected: {len(affected_services)} services")
        
    # Potential customer data loss
    if is_db_op and is_destructive_action:
        critical_triggers.append("Potential customer data loss (database destroy/rebuild)")
        
    # Potential security incident
    if is_security_sensitive and "leak" in alert_name.lower():
        critical_triggers.append("Potential security incident on sensitive system")
        
    # Unknown remediation outcome
    if remediation_choice not in ["RESTART", "ROLLBACK", "SCALE", "NO_ACTION", "DESTROY"]:
        critical_triggers.append(f"Unknown remediation outcome for action: {remediation_choice}")

    high_triggers = []
    # Confidence < 85%
    if confidence < 85:
        high_triggers.append(f"Diagnosis confidence below 85% ({confidence}%)")
        
    # Root cause uncertain
    if "unable to determine" in root_cause.lower() or "uncertain" in root_cause.lower() or confidence < 85:
        high_triggers.append("Root cause is uncertain")
        
    # More than 1 service affected
    if len(affected_services) > 1:
        high_triggers.append(f"Blast radius: {len(affected_services)} services affected")
        
    # Action = ROLLBACK
    if remediation_choice in ["ROLLBACK", "ROLLBACK_DEPLOYMENT"]:
        high_triggers.append("Remediation action is ROLLBACK")
        
    # Authentication service involved
    if is_auth_service:
        high_triggers.append(f"Authentication service involved: '{service}'")
        
    # User service involved
    if is_user_service:
        high_triggers.append(f"User service involved: '{service}'")
        
    # Payment service involved
    if is_payment_service:
        high_triggers.append(f"Payment service involved: '{service}'")
        
    # External API dependency involved
    if "external" in service.lower() or "api-gateway" in service.lower() or "gateway" in service.lower():
        high_triggers.append(f"External API dependency / Gateway service involved: '{service}'")
        
    # Data consistency risk exists
    if "consistency" in root_cause.lower() or "integrity" in root_cause.lower() or "corruption" in root_cause.lower():
        high_triggers.append("Data consistency / integrity risk exists")

    medium_triggers = []
    # Confidence between 85 and 95
    if 85 <= confidence < 95:
        medium_triggers.append(f"Diagnosis confidence is between 85% and 95% ({confidence}%)")
        
    # Action modifies configuration
    if "config" in remediation_choice.lower() or "modify" in remediation_choice.lower():
        medium_triggers.append("Remediation action modifies configuration")
        
    # Scale up/down operations
    if remediation_choice in ["SCALE", "SCALE_SERVICE"]:
        medium_triggers.append("Remediation action is SCALE")
        
    # Cache reset
    if "cache" in root_cause.lower() or "clear" in remediation_choice.lower() or remediation_choice == "CLEAR_STUCK_JOBS":
        medium_triggers.append("Remediation action is cache reset / job clearing")

    # Determine risk level based on triggers (highest priority first)
    if critical_triggers:
        risk_level = "CRITICAL"
        blocking_reasons = critical_triggers
    elif high_triggers:
        risk_level = "HIGH"
        blocking_reasons = high_triggers
    elif medium_triggers or confidence < 95 or len(affected_services) > 1 or remediation_choice not in ["RESTART", "NO_ACTION"] or is_sensitive:
        risk_level = "MEDIUM"
        blocking_reasons = medium_triggers if medium_triggers else ["General medium risk (does not meet strict LOW criteria)"]
    else:
        risk_level = "LOW"
        blocking_reasons = []

    # Heuristic approval decision based on conservative policy
    approved = (
        risk_level == "LOW" and
        confidence >= 95 and
        len(affected_services) == 1 and
        remediation_choice in ["RESTART", "NO_ACTION"] and
        not is_sensitive
    )
    reason_str = f"Auto-approved: proposed action '{remediation_choice}' poses {risk_level} risk." if approved else f"Halted: proposed action requires human review."

    # Perform LLM validation if available
    try:
        if llm:
            gov_prompt = build_governance_prompt(
                incident_id=incident_id,
                alert_name=alert_name,
                service=service,
                confidence=confidence,
                root_cause=root_cause,
                action=remediation_choice,
                affected_services=affected_services,
                logs=logs,
                metrics=metrics
            )
            response = llm.invoke([
                SystemMessage(content=GOVERNANCE_SYSTEM_PROMPT),
                HumanMessage(content=gov_prompt)
            ])
            content = response.content.strip()
            log_step(incident_id, f"[Governance & Safety Agent] LLM review output:\n{content}", "AGENT_THOUGHT")
            parsed = _try_parse_json(content)
            if parsed and "risk_level" in parsed:
                risk_level = parsed.get("risk_level", risk_level).upper()
                approved = parsed.get("governance_approved", False)
                # Enforce safety constraints regardless of LLM errors
                if risk_level != "LOW":
                    approved = False
                reason_str = parsed.get("governance_reason", reason_str)
                log_step(incident_id, "[Governance & Safety Agent] Successfully parsed LLM safety assessment.", "INFO")
            else:
                # LLM output could not be parsed, fallback to heuristic approval
                approved = (
                    risk_level == "LOW" and
                    confidence >= 95 and
                    len(affected_services) == 1 and
                    remediation_choice in ["RESTART", "NO_ACTION"] and
                    not is_sensitive
                )
                reason_str = f"Halted: proposed action '{remediation_choice}' poses {risk_level} risk. "
                if blocking_reasons:
                    reason_str += "Triggers: " + "; ".join(blocking_reasons)
                else:
                    reason_str += "Base runbook classification."
        else:
            raise Exception("LLM unavailable")
    except Exception as e:
        logger.warning(f"Governance LLM call failed or unavailable ({str(e)}). Using heuristic safety assessment.")
        approved = (
            risk_level == "LOW" and
            confidence >= 95 and
            len(affected_services) == 1 and
            remediation_choice in ["RESTART", "NO_ACTION"] and
            not is_sensitive
        )
        reason_str = f"Halted: proposed action '{remediation_choice}' poses {risk_level} risk. "
        if blocking_reasons:
            reason_str += "Triggers: " + "; ".join(blocking_reasons)
        else:
            reason_str += "Base runbook classification."

    log_step(incident_id, f"[Governance & Safety Agent] Risk classification: {risk_level}. Approved: {approved}.", "INFO")
    if not approved:
        log_step(incident_id, f"[Governance & Safety Agent] Reason: {reason_str}", "WARNING")

        # Simulate sending email notification
        email_recipient = "sre-leads@company.com"
        email_subject = f"[SentinelOps Safety Alert] Approval Required for Incident {incident_id}"
        email_body = (
            f"Dear SRE Lead,\n\n"
            f"An automated SRE agent has proposed a recovery action that requires human confirmation.\n\n"
            f"Incident ID: {incident_id}\n"
            f"Service: {service}\n"
            f"Trigger Alert: {alert_name}\n"
            f"Proposed Remediation: {remediation_choice}\n"
            f"Blast Radius: {', '.join(affected_services)}\n"
            f"Confidence: {confidence}%\n"
            f"Risk Level: {risk_level}\n"
            f"Safety Warning: {reason_str}\n\n"
            f"Please approve or deny this action in the SentinelOps console.\n"
        )
        log_step(incident_id, f"[Governance & Safety Agent] Simulating email notification to {email_recipient}...", "INFO")
        
        # Write Markdown approval request artifact to the workspace
        try:
            artifact_content = (
                f"# SentinelOps Approval Request - {incident_id}\n\n"
                f"> [!IMPORTANT]\n"
                f"> **Action approval is required before execution.**\n\n"
                f"## Incident Details\n"
                f"* **Incident ID:** `{incident_id}`\n"
                f"* **Affected Service:** `{service}`\n"
                f"* **Fired Alert:** `{alert_name}`\n"
                f"* **RCA Confidence:** `{confidence}%`\n"
                f"* **Impacted Services (Blast Radius):** `{', '.join(affected_services)}`\n\n"
                f"## Risk Assessment & Safety Node Review\n"
                f"* **Assessed Risk Level:** `{risk_level}`\n"
                f"* **Proposed Remediation:** `{remediation_choice}`\n"
                f"* **Reason for Review:** {reason_str}\n\n"
                f"## Simulated Notification\n"
                f"```text\n"
                f"To: {email_recipient}\n"
                f"Subject: {email_subject}\n\n"
                f"{email_body}\n"
                f"```\n"
            )
            filepath = f"c:/Coding/Web/Hackathons/SentinalOPS/approval_request_{incident_id}.md"
            with open(filepath, "w", encoding="utf-8") as art_f:
                art_f.write(artifact_content)
            log_step(incident_id, f"[Governance & Safety Agent] Created approval request artifact at '{filepath}'", "INFO")
        except Exception as ex:
            log_step(incident_id, f"[Governance & Safety Agent] Failed to write approval request artifact: {str(ex)}", "WARNING")

    # Update database risk level
    update_incident_status(
        incident_id, 
        status="PENDING_APPROVAL" if not approved else "INVESTIGATING",
        risk_level=risk_level
    )

    return {
        **state,
        "governance_approved": approved,
        "governance_reason": reason_str,
        "risk_level": risk_level,
        "next_agent": "incident_commander"
    }


# ── LANGGRAPH ROUTING LOGIC ───────────────────────────────────────────────

def route_commander(state: AgentState):
    next_step = state.get("next_agent")
    if next_step == "metrics_log_analyzer":
        return "metrics_log_analyzer"
    elif next_step == "diagnostics_agent":
        return "diagnostics_agent"
    elif next_step == "governance_safety":
        return "governance_safety"
    elif next_step == "remediation_executor":
        return "remediation_executor"
    elif next_step == "auditor":
        return "auditor"
    else:
        return END


# ── BUILD LANGGRAPH STATE MACHINE ─────────────────────────────────────────

workflow = StateGraph(AgentState)

# Add Nodes
workflow.add_node("incident_commander", incident_commander_node)
workflow.add_node("metrics_log_analyzer", metrics_log_analyzer_node)
workflow.add_node("diagnostics_agent", diagnostics_agent_node)
workflow.add_node("governance_safety", governance_safety_agent_node)
workflow.add_node("remediation_executor", remediation_executor_node)
workflow.add_node("auditor", auditor_node)

# Set entry point
workflow.set_entry_point("incident_commander")

# Register edges back to Incident Commander hub
workflow.add_edge("metrics_log_analyzer", "incident_commander")
workflow.add_edge("diagnostics_agent", "incident_commander")
workflow.add_edge("governance_safety", "incident_commander")
workflow.add_edge("remediation_executor", "incident_commander")
workflow.add_edge("auditor", "incident_commander")

# Add conditional edges from Incident Commander
workflow.add_conditional_edges(
    "incident_commander",
    route_commander,
    {
        "metrics_log_analyzer": "metrics_log_analyzer",
        "diagnostics_agent": "diagnostics_agent",
        "governance_safety": "governance_safety",
        "remediation_executor": "remediation_executor",
        "auditor": "auditor",
        END: END
    }
)

# Compile SRE agent app
agent_app = workflow.compile()

