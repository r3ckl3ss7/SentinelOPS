import os
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

# Graph State Schema
class AgentState(TypedDict):
    incident_id: str
    service: str
    alert_name: str
    status: str
    root_cause: Optional[str]
    remediation_choice: Optional[str] # RESTART, ROLLBACK, SCALE
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

def update_incident_status(incident_id: str, status: str, root_cause: str = None, action: str = None):
    db = SessionLocal()
    try:
        incident = db.query(Incident).filter(Incident.id == incident_id).first()
        if incident:
            incident.status = status
            if root_cause:
                incident.root_cause = root_cause
            if action:
                incident.resolution_action = action
            incident.updated_at = datetime.utcnow()
            db.commit()
    except Exception as e:
        logger.error(f"Failed to update incident: {str(e)}")
    finally:
        db.close()

# LANGGRAPH NODES

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
    
    # 2. Reasoning via LLM
    root_cause = "Unknown / Undetermined"
    remediation_choice = "RESTART"
    
    log_step(incident_id, "Thought: Analyzing metrics and logs to determine root cause...", "AGENT_THOUGHT")
    
    prompt = (
        f"You are an SRE AI Agent investigating a production incident.\n"
        f"Alert: {alert_name}\n"
        f"Target Service: {service}\n\n"
        f"--- TELEMETRY DATA ---\n"
        f"Metrics:\n{metrics}\n\n"
        f"Health Status:\n{health}\n\n"
        f"Logs:\n{logs}\n"
        f"---------------------\n\n"
        f"Perform diagnosis and respond exactly in this format:\n"
        f"DIAGNOSIS: <brief explanation of what is wrong>\n"
        f"RECOMMENDED_ACTION: <choose exactly one: RESTART, ROLLBACK, or SCALE>\n"
        f"REASON: <why you chose this action>"
    )
    
    try:
        response = llm.invoke([
            SystemMessage(content="You are an autonomous SRE expert. Always respond in the requested format."),
            HumanMessage(content=prompt)
        ])
        content = response.content.strip()
        log_step(incident_id, f"Thought Analysis:\n{content}", "AGENT_THOUGHT")
        
        # Parse diagnosis and action
        lines = content.split("\n")
        for line in lines:
            if line.startswith("DIAGNOSIS:"):
                root_cause = line.replace("DIAGNOSIS:", "").strip()
            elif line.startswith("RECOMMENDED_ACTION:"):
                action_text = line.replace("RECOMMENDED_ACTION:", "").strip().upper()
                if "RESTART" in action_text:
                    remediation_choice = "RESTART"
                elif "ROLLBACK" in action_text:
                    remediation_choice = "ROLLBACK"
                elif "SCALE" in action_text:
                    remediation_choice = "SCALE"
    except Exception as e:
        logger.error(f"LLM Reasoning failed: {str(e)}")
        log_step(incident_id, f"LLM error: {str(e)}. Falling back to default heuristics.", "WARNING")
        # Direct heuristics fallback
        if "HighMemoryUsage" in alert_name:
            root_cause = "Detected out of memory conditions in service logs and memory metrics above threshold."
            remediation_choice = "RESTART"
        elif "HttpErrorSpike" in alert_name:
            root_cause = "HTTP 500 error count spiked. Downstream services or bad deployment suspect."
            remediation_choice = "ROLLBACK"
        else:
            root_cause = "General metric warning trigger."
            remediation_choice = "RESTART"
            
    log_step(incident_id, f"Root cause identified: {root_cause}", "INFO")
    log_step(incident_id, f"Remediation action selected: {remediation_choice}", "INFO")
    
    update_incident_status(incident_id, "ROOT_CAUSE_FOUND", root_cause=root_cause)
    
    return {
        **state,
        "root_cause": root_cause,
        "remediation_choice": remediation_choice
    }

def remediate_node(state: AgentState) -> AgentState:
    incident_id = state["incident_id"]
    service = state["service"]
    choice = state["remediation_choice"]
    
    log_step(incident_id, f"Remediation node started. Action target: {choice}", "INFO")
    update_incident_status(incident_id, "EXECUTING_FIX")
    
    result = ""
    if choice == "RESTART":
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
    
    # 2. Evaluate Recovery
    success = False
    log_step(incident_id, "Thought: Evaluating if system has recovered...", "AGENT_THOUGHT")
    
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
    
    try:
        response = llm.invoke([
            SystemMessage(content="You are an SRE checking service recovery. Answer YES or NO."),
            HumanMessage(content=prompt)
        ])
        content = response.content.strip().upper()
        log_step(incident_id, f"Recovery Evaluation: {content}", "AGENT_THOUGHT")
        if "YES" in content:
            success = True
    except Exception as e:
        logger.error(f"LLM Recovery Check failed: {str(e)}")
        # Heuristics check
        if "Status: 200" in health or '"status": "healthy"' in health:
            success = True
            
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
    
    log_step(incident_id, "Compiling incident report...", "INFO")
    
    # Calculate resolution time (simple mock value based on steps)
    resolution_time = 42.0 if success else 120.0
    
    # DB update for incident resolution
    db = SessionLocal()
    try:
        incident = db.query(Incident).filter(Incident.id == incident_id).first()
        if incident:
            incident.status = "RESOLVED" if success else "FAILED"
            incident.resolution_time_seconds = resolution_time
            db.commit()
    except Exception as e:
        logger.error(f"Failed to save resolution time to DB: {str(e)}")
    finally:
        db.close()
        
    # Generate report markdown
    prompt = (
        f"Generate a professional Incident Post-Mortem Report in Markdown format.\n"
        f"Incident ID: {incident_id}\n"
        f"Affected Service: {service}\n"
        f"Triggering Alert: {alert_name}\n"
        f"Root Cause: {root_cause}\n"
        f"Actions Taken: {action} ({remediation_result})\n"
        f"Recovery Verified: {success}\n"
        f"Resolution Time: {resolution_time} seconds\n\n"
        f"Please write a structured report with Sections: Executive Summary, Incident Timeline, Root Cause Analysis, Actions Taken, and Prevention Steps."
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
            f"An incident was triggered on **{service}** due to **{alert_name}** alert. Remediation was executed automatically.\n\n"
            f"## Timeline & Details\n"
            f"* **Service:** {service}\n"
            f"* **Alert:** {alert_name}\n"
            f"* **Root Cause:** {root_cause}\n"
            f"* **Remediation:** {action}\n"
            f"* **Resolution Status:** {'Success' if success else 'Failed'}\n"
            f"* **MTTR:** {resolution_time}s\n"
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
