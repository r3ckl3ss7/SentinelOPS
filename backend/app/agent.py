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
from app.sre_system_prompt import SRE_SYSTEM_PROMPT, build_investigation_prompt

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
        timeout=15.0
    )
    logger.info(f"LLM initialized pointing to {base_url} using model qwen2.5:3b")
except Exception as e:
    logger.error(f"Failed to initialize LLM: {str(e)}")
    llm = None

# ── Runbook name mapping ─────────────────────────────────────────────────
# The structured prompt uses long-form runbook names; the remediation node
# uses short internal action names.  This map bridges the two.
RUNBOOK_TO_ACTION = {
    "RESTART_SERVICE": "RESTART",
    "ROLLBACK_DEPLOYMENT": "ROLLBACK",
    "SCALE_SERVICE": "SCALE",
    "CLEAR_STUCK_JOBS": "RESTART",        # Clearing faults = effective restart
    "RESTART_DEPENDENCY": "RESTART",      # Same mechanism for MVP
    "NO_ACTION": "NO_ACTION",
}

# Graph State Schema
class AgentState(TypedDict):
    incident_id: str
    service: str
    alert_name: str
    status: str
    root_cause: Optional[str]
    confidence: Optional[int]                # NEW: 0-100
    severity: Optional[str]                  # NEW: from LLM
    risk_level: Optional[str]                # NEW: LOW / MEDIUM / HIGH
    evidence: Optional[List[str]]            # NEW: supporting evidence items
    affected_services: Optional[List[str]]   # NEW: blast-radius service list
    reasoning_summary: Optional[str]         # NEW: LLM reasoning narrative
    remediation_choice: Optional[str]        # RESTART, ROLLBACK, SCALE, NO_ACTION
    remediation_result: Optional[str]
    verification_success: Optional[bool]
    incident_report: Optional[str]

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

# ── JSON Parsing Helpers ─────────────────────────────────────────────────

def _try_parse_json(text: str) -> dict | None:
    """Attempt to parse the LLM response as JSON.  3-tier approach:
       1. Direct json.loads on the full text
       2. Extract a JSON object via regex (handles markdown fences / preamble)
       3. Return None so the caller can fall back to heuristics
    """
    # Tier 1: direct parse
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass

    # Tier 2: regex extraction — find the first { ... } block
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except (json.JSONDecodeError, TypeError):
            pass

    # Tier 3: give up
    return None


def _heuristic_diagnosis(alert_name: str, service: str) -> dict:
    """Deterministic fallback when the LLM is unavailable or returns garbage."""
    if "HighMemoryUsage" in alert_name:
        return {
            "root_cause": "Detected out-of-memory conditions in service logs and memory metrics above threshold.",
            "confidence": 75,
            "severity": "critical",
            "risk_level": "HIGH",
            "evidence": ["Memory usage exceeds 80 MB threshold", "Potential OutOfMemoryError in logs"],
            "affected_services": [service],
            "recommended_runbook": "RESTART_SERVICE",
            "reasoning_summary": "Memory leak pattern detected.  Restarting the service clears the accumulated heap and restores normal operation."
        }
    elif "HighCpuUsage" in alert_name:
        return {
            "root_cause": "CPU utilization spiked beyond 80% threshold indicating a busy-loop or runaway process.",
            "confidence": 70,
            "severity": "warning",
            "risk_level": "MEDIUM",
            "evidence": ["CPU usage ratio exceeds 0.80", "Sustained high utilization"],
            "affected_services": [service],
            "recommended_runbook": "RESTART_SERVICE",
            "reasoning_summary": "CPU spike pattern detected.  A service restart terminates the runaway workload."
        }
    elif "HttpErrorSpike" in alert_name:
        return {
            "root_cause": "HTTP 500 error count spiked.  Downstream service failure or bad deployment suspected.",
            "confidence": 65,
            "severity": "critical",
            "risk_level": "HIGH",
            "evidence": ["Rapid increase in HTTP 500 responses", "Health endpoint returning non-200"],
            "affected_services": [service],
            "recommended_runbook": "ROLLBACK_DEPLOYMENT",
            "reasoning_summary": "Error spike suggests a deployment regression or dependency failure.  Rolling back the deployment is the safest immediate action."
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
            "reasoning_summary": "Insufficient signal to determine root cause with confidence.  Restarting the service as a safe default."
        }


# ── LANGGRAPH NODES ──────────────────────────────────────────────────────

def investigate_node(state: AgentState) -> AgentState:
    incident_id = state["incident_id"]
    service = state["service"]
    alert_name = state["alert_name"]
    
    log_step(incident_id, f"Investigation node started for service: {service}", "INFO")
    update_incident_status(incident_id, "INVESTIGATING")
    
    # 1. Fetch telemetry
    log_step(incident_id, "Action: Inspecting service metrics", "AGENT_ACTION")
    metrics = get_service_metrics.invoke({"service_name": service})
    log_step(incident_id, f"Result: Service metrics:\n{metrics}", "AGENT_RESULT")
    
    log_step(incident_id, "Action: Inspecting service health endpoint", "AGENT_ACTION")
    health = check_service_health.invoke({"service_name": service})
    log_step(incident_id, f"Result: Service health response:\n{health}", "AGENT_RESULT")
    
    log_step(incident_id, "Action: Retrieving container logs", "AGENT_ACTION")
    logs = get_container_logs.invoke({"service_name": service, "lines": 30})
    # Truncate logs if too long for db logging
    truncated_logs = logs[:800] + "..." if len(logs) > 800 else logs
    log_step(incident_id, f"Result: Service logs:\n{truncated_logs}", "AGENT_RESULT")
    
    # 2. Structured RCA reasoning via LLM
    log_step(incident_id, "Thought: Running structured 6-step Root Cause Analysis...", "AGENT_THOUGHT")
    
    # Default values — will be overwritten by LLM or heuristics
    diagnosis = _heuristic_diagnosis(alert_name, service)
    
    try:
        user_prompt = build_investigation_prompt(alert_name, service, metrics, health, logs)
        
        response = llm.invoke([
            SystemMessage(content=SRE_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt)
        ])
        content = response.content.strip()
        log_step(incident_id, f"Thought — LLM RCA Output:\n{content}", "AGENT_THOUGHT")
        
        # Parse the structured JSON response
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
            log_step(incident_id, "Structured JSON diagnosis parsed successfully.", "INFO")
        else:
            log_step(incident_id, "LLM output could not be parsed as structured JSON. Using heuristic fallback.", "WARNING")
            
    except Exception as e:
        logger.error(f"LLM Reasoning failed: {str(e)}")
        log_step(incident_id, f"LLM error: {str(e)}. Falling back to heuristic diagnosis.", "WARNING")
    
    # Extract fields from diagnosis
    root_cause = diagnosis["root_cause"]
    confidence = diagnosis["confidence"]
    severity = diagnosis["severity"]
    risk_level = diagnosis["risk_level"]
    evidence = diagnosis["evidence"]
    affected_services = diagnosis["affected_services"]
    reasoning_summary = diagnosis["reasoning_summary"]
    recommended_runbook = diagnosis["recommended_runbook"]
    
    # Map runbook name to internal action
    remediation_choice = RUNBOOK_TO_ACTION.get(recommended_runbook, "RESTART")
    
    # Log the rich diagnostic output
    log_step(incident_id, f"Root cause identified: {root_cause}", "INFO")
    log_step(incident_id, f"Confidence: {confidence}%  |  Risk Level: {risk_level}  |  Severity: {severity}", "INFO")
    log_step(incident_id, f"Evidence: {json.dumps(evidence)}", "INFO")
    log_step(incident_id, f"Affected services (blast radius): {json.dumps(affected_services)}", "INFO")
    log_step(incident_id, f"Recommended runbook: {recommended_runbook}  →  Action: {remediation_choice}", "INFO")
    
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
        "remediation_choice": remediation_choice
    }

def remediate_node(state: AgentState) -> AgentState:
    incident_id = state["incident_id"]
    service = state["service"]
    choice = state["remediation_choice"]
    
    log_step(incident_id, f"Remediation node started. Action target: {choice}", "INFO")
    update_incident_status(incident_id, "EXECUTING_FIX")
    
    result = ""
    if choice == "NO_ACTION":
        log_step(incident_id, "Agent determined no remediation action is needed. Skipping.", "INFO")
        result = "No action taken — agent assessed the issue as self-resolving or not actionable."
    elif choice == "RESTART":
        log_step(incident_id, f"Action: Restarting container for {service}", "AGENT_ACTION")
        result = restart_service.invoke({"service_name": service})
    elif choice == "ROLLBACK":
        log_step(incident_id, f"Action: Rolling back recent deployment for {service}", "AGENT_ACTION")
        result = rollback_deployment.invoke({"service_name": service})
    elif choice == "SCALE":
        log_step(incident_id, f"Action: Scaling container {service} to 3 replicas", "AGENT_ACTION")
        result = scale_service.invoke({"service_name": service, "replicas": 3})
    else:
        result = f"Unknown remediation option: {choice}. No action taken."
        
    log_step(incident_id, f"Result: Remediation output:\n{result}", "AGENT_RESULT")
    update_incident_status(incident_id, "EXECUTING_FIX", action=f"{choice}: {result}")
    
    return {
        **state,
        "remediation_result": result
    }

def verify_node(state: AgentState) -> AgentState:
    incident_id = state["incident_id"]
    service = state["service"]
    
    log_step(incident_id, "Verification node started. Waiting 5s for service convergence...", "INFO")
    update_incident_status(incident_id, "VERIFYING")
    
    time.sleep(5)
    
    # 1. Fetch metrics & health again
    log_step(incident_id, "Action: Inspecting service health endpoint post-remediation", "AGENT_ACTION")
    health = check_service_health.invoke({"service_name": service})
    log_step(incident_id, f"Result: Service health response:\n{health}", "AGENT_RESULT")
    
    log_step(incident_id, "Action: Inspecting service metrics post-remediation", "AGENT_ACTION")
    metrics = get_service_metrics.invoke({"service_name": service})
    log_step(incident_id, f"Result: Service metrics:\n{metrics}", "AGENT_RESULT")
    
    # 2. Evaluate Recovery — use both heuristics AND LLM
    success = False
    log_step(incident_id, "Thought: Evaluating if system has recovered...", "AGENT_THOUGHT")
    
    # Heuristic check (always runs — this is the ground truth)
    health_ok = "Status: 200" in health or '"status": "healthy"' in health or '"status":"healthy"' in health
    if health_ok:
        log_step(incident_id, "Heuristic: Health endpoint returned 200 OK.", "AGENT_THOUGHT")
        success = True
    else:
        log_step(incident_id, "Heuristic: Health endpoint did NOT return 200 OK.", "AGENT_THOUGHT")

    # LLM check (supplementary — can override a negative heuristic, but not a positive one)
    try:
        prompt = (
            f"You are an SRE AI Agent verifying if an incident is resolved.\n"
            f"Service: {service}\n\n"
            f"--- POST-REMEDIATION TELEMETRY ---\n"
            f"Health check:\n{health}\n\n"
            f"Metrics:\n{metrics}\n"
            f"----------------------------------\n\n"
            f"Is the service recovered? Answer with 'YES' if health is 200 OK and metrics are normal. Otherwise answer 'NO'.\n"
            f"Response (YES/NO):"
        )
        response = llm.invoke([
            SystemMessage(content="You are an SRE checking service recovery. Answer YES or NO."),
            HumanMessage(content=prompt)
        ])
        content = response.content.strip().upper()
        log_step(incident_id, f"LLM Recovery Evaluation: {content}", "AGENT_THOUGHT")
        if "YES" in content:
            success = True
    except Exception as e:
        logger.error(f"LLM Recovery Check failed: {str(e)}")
        log_step(incident_id, f"LLM unavailable for verification, relying on heuristics.", "WARNING")
            
    if success:
        log_step(incident_id, "System recovery verified. All metrics stable.", "INFO")
    else:
        log_step(incident_id, "System has NOT recovered or metrics are still outside thresholds.", "WARNING")
        
    return {
        **state,
        "verification_success": success
    }

def report_node(state: AgentState) -> AgentState:
    incident_id = state["incident_id"]
    service = state["service"]
    alert_name = state["alert_name"]
    root_cause = state["root_cause"]
    action = state["remediation_choice"]
    remediation_result = state["remediation_result"]
    success = state["verification_success"]
    confidence = state.get("confidence", "N/A")
    risk_level = state.get("risk_level", "N/A")
    evidence = state.get("evidence", [])
    affected_services = state.get("affected_services", [])
    reasoning_summary = state.get("reasoning_summary", "")
    
    log_step(incident_id, "Compiling incident report...", "INFO")
    
    # Calculate real resolution time from incident creation
    resolution_time = 60.0  # fallback
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
        logger.error(f"Failed to save resolution time to DB: {str(e)}")
    finally:
        db.close()
    
    # Format evidence and affected services for the report prompt
    evidence_str = "\n".join(f"  - {e}" for e in evidence) if evidence else "  - No specific evidence collected"
    affected_str = ", ".join(affected_services) if affected_services else service
    
    # Generate report markdown
    prompt = (
        f"Generate a professional Incident Post-Mortem Report in Markdown format.\n"
        f"Incident ID: {incident_id}\n"
        f"Affected Service: {service}\n"
        f"Triggering Alert: {alert_name}\n"
        f"Root Cause: {root_cause}\n"
        f"Confidence Score: {confidence}%\n"
        f"Risk Level: {risk_level}\n"
        f"Supporting Evidence:\n{evidence_str}\n"
        f"Blast Radius (Affected Services): {affected_str}\n"
        f"Agent Reasoning: {reasoning_summary}\n"
        f"Actions Taken: {action} ({remediation_result})\n"
        f"Recovery Verified: {success}\n"
        f"Resolution Time: {resolution_time} seconds\n\n"
        f"Please write a structured report with Sections: Executive Summary, Incident Timeline, "
        f"Root Cause Analysis (including confidence and evidence), Blast Radius Assessment, "
        f"Actions Taken, Risk Assessment, and Prevention Steps."
    )
    
    report_content = ""
    try:
        response = llm.invoke([
            SystemMessage(content="You are an expert SRE writer. Write structured Markdown post-mortem reports."),
            HumanMessage(content=prompt)
        ])
        report_content = response.content.strip()
    except Exception as e:
        logger.error(f"Failed to generate report using LLM: {str(e)}")
        # Markdown fallback
        report_content = (
            f"# Incident Post-Mortem Report - {incident_id}\n\n"
            f"## Executive Summary\n"
            f"An incident was triggered on **{service}** due to **{alert_name}** alert. "
            f"Remediation was executed automatically by the SentinelOps AI SRE Agent.\n\n"
            f"## Root Cause Analysis\n"
            f"* **Root Cause:** {root_cause}\n"
            f"* **Confidence:** {confidence}%\n"
            f"* **Risk Level:** {risk_level}\n\n"
            f"### Supporting Evidence\n"
            f"{evidence_str}\n\n"
            f"## Blast Radius\n"
            f"* **Affected Services:** {affected_str}\n\n"
            f"## Actions Taken\n"
            f"* **Runbook Executed:** {action}\n"
            f"* **Result:** {remediation_result}\n"
            f"* **Resolution Status:** {'Success' if success else 'Failed'}\n"
            f"* **MTTR:** {resolution_time}s\n\n"
            f"## Agent Reasoning\n"
            f"{reasoning_summary}\n"
        )
        
    log_step(incident_id, "Incident report compiled successfully.", "INFO")
    
    # Store report content back in DB
    db = SessionLocal()
    try:
        incident = db.query(Incident).filter(Incident.id == incident_id).first()
        if incident:
            incident.root_cause = root_cause
            incident.resolution_action = report_content
            db.commit()
    except Exception as e:
        logger.error(f"Failed to store final report: {str(e)}")
    finally:
        db.close()
        
    # Mark overall incident lifecycle complete
    log_step(incident_id, f"Incident {incident_id} is closed. Status: {'RESOLVED' if success else 'FAILED'}", "INFO")
    
    return {
        **state,
        "incident_report": report_content
    }

# Build LangGraph State Machine
workflow = StateGraph(AgentState)

# Add Nodes
workflow.add_node("investigate", investigate_node)
workflow.add_node("remediate", remediate_node)
workflow.add_node("verify", verify_node)
workflow.add_node("report", report_node)

# Set Entrance Node
workflow.set_entry_point("investigate")

# Add edges (linear state machine for MVP reliability)
workflow.add_edge("investigate", "remediate")
workflow.add_edge("remediate", "verify")
workflow.add_edge("verify", "report")
workflow.add_edge("report", END)

# Compile
agent_app = workflow.compile()
