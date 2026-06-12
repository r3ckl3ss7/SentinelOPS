# SentinelOps AI: Autonomous Site Reliability Engineering Agent

SentinelOps AI is an autonomous, self-healing Site Reliability Engineering (SRE) agent system. It is designed to detect, diagnose, remediate, and verify microservice failures automatically. By combining real-time observability telemetry, a localized LLM-driven reasoning loop, and targeted infrastructure remediation tools, the system reduces the Mean Time to Recovery (MTTR) of simulated production incidents to seconds.

The project runs in two modes: a host-native local environment (using an SQLite database and a built-in background health monitor thread) or a containerized multi-service Docker Compose environment (using PostgreSQL, Prometheus, AlertManager, and container socket orchestration).

---

## System Architecture

The project consists of five primary layers:

1. **Frontend Layer (Next.js Dashboard)**: A TypeScript-based interface built with Next.js and TailwindCSS. It visualizes the microservice topology, registers live CPU and memory metrics, hosts a console to inject simulated service faults, streams SRE agent execution logs in a terminal-like environment, and provides a portal to download incident post-mortem reports.
2. **Autonomous SRE Backend (FastAPI)**: A Python FastAPI application that processes incoming webhook alerts from AlertManager, lists incident history, proxies fault injection requests, and manages the database. It contains a built-in health monitor thread to check service metrics and health endpoints when Prometheus is offline.
3. **LangGraph SRE Agent Engine**: A state machine built using LangGraph that orchestrates the incident life cycle. It pulls container logs, metrics, and health states, prompts a local LLM to deduce the root cause, triggers infrastructure remediation tools, verifies recovery, and auto-compiles Markdown post-mortem reports.
4. **Microservices Simulation Layer**: A suite of five mock FastAPI microservices representing an order placement workflow:
   - `api-gateway` (Port 8001)
   - `user-service` (Port 8002)
   - `order-service` (Port 8003)
   - `payment-service` (Port 8004)
   - `notification-service` (Port 8005)
5. **Monitoring and Telemetry Stack**: In Docker mode, a Prometheus instance scrapes metrics from all microservices, processes custom alert threshold definitions, and sends alerts to AlertManager, which targets the SRE backend's webhook endpoint.

```
       [ Next.js Control Dashboard ]
               |             ^
        Inject |             | Live Logs & Telemetry
        Faults v             |
    [----------------- SRE FastAPI Backend -----------------]
     |           |                       |            ^
     | Database  | Run Agent             | Telemetry  | Alert Webhook
     v           v                       v            |
  [ DB ]    [ LangGraph ] -------> [ Microservices ] -+
                 |    |   Query/Fix (api, user, order, |
                 |    +----------->  payment, notify)  | Scrape
                 v                                     v
       [ Ollama (Qwen2.5:3b) ]                   [ Prometheus ]
                                                       |
                                                       v
                                                [ AlertManager ]
```

---

## Agent Workflow (State Machine)

The SRE agent is designed as a LangGraph state machine (`backend/app/agent.py`) with four main sequential nodes:

### 1. Investigate
The agent fetches real-time telemetry from the target microservice:
- Last 30 lines of container stdout logs.
- Memory usage metrics.
- CPU usage metrics.
- Health endpoint `/health` response.

This collected context is passed to the local LLM (`qwen2.5:3b`) with a system prompt outlining structured reasoning. The LLM performs a 6-step root cause analysis (RCA) and returns a JSON response containing:
- `root_cause`: A detailed diagnostic statement.
- `confidence`: An estimated confidence score (0-100%).
- `severity`: Alert severity (warning, critical).
- `risk_level`: Estimated remediation risk (LOW, MEDIUM, HIGH).
- `evidence`: Specific logs or metric thresholds validating the diagnosis.
- `affected_services`: The calculated blast radius.
- `recommended_runbook`: The recovery action to run (`RESTART_SERVICE`, `ROLLBACK_DEPLOYMENT`, `SCALE_SERVICE`, or `NO_ACTION`).

If the LLM output is malformed or times out, the agent falls back to a deterministic, heuristic diagnostic mapping based on the alert type.

### 2. Remediate
Based on the recommended runbook, the agent executes the corresponding infrastructure action tool (`backend/app/tools.py`):
- **RESTART**: Clears service faults and restarts the Docker container. In local host mode, it clears the service's internal fault memory state.
- **ROLLBACK**: Rolls back deployment configurations and restarts the target service.
- **SCALE**: Scales container replicas to allocate extra capacity (mock behavior).
- **NO_ACTION**: Skips remediation if the issue is self-resolving or not actionable.

### 3. Verify
The agent pauses for 5 seconds to allow the service to converge. It then queries the health endpoint and metrics of the service. Verification succeeds if:
- The service `/health` endpoint returns an HTTP 200 OK status.
- A secondary LLM check evaluates the post-remediation metrics and reports that the service is operational.

### 4. Report
The agent calculates the Mean Time to Recovery (MTTR) by measuring the elapsed time since incident creation. It requests the LLM to write a comprehensive incident post-mortem in Markdown format, writes the report to the database, and updates the incident status to `RESOLVED` (or `FAILED` if verification did not succeed).

---

## Tech Stack

- **Backend**: Python, FastAPI, LangGraph, LangChain, SQLAlchemy
- **Frontend**: Next.js, TypeScript, TailwindCSS
- **Databases**: SQLite (local mode), PostgreSQL (Docker mode)
- **observability**: Prometheus (scraping & rules), AlertManager (routing)
- **Containerization**: Docker, Docker Compose
- **LLM Engine**: Ollama (Qwen2.5:3b)

---

## Repository Structure

```
├── backend/                  # SRE FastAPI Backend
│   ├── app/
│   │   ├── __init__.py
│   │   ├── agent.py          # LangGraph state machine & LLM orchestration
│   │   ├── database.py       # SQLAlchemy DB models & sessions
│   │   ├── main.py           # FastAPI REST API & background tasks
│   │   ├── sre_system_prompt.py # Prompts & structured JSON instructions
│   │   └── tools.py          # Docker SDK & HTTP telemetry tools
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                 # Next.js Dashboard App
│   ├── src/                  # Next.js page routes, terminal logs component, and state
│   ├── package.json
│   └── Dockerfile
├── simulation/               # Microservices & Monitoring Configurations
│   ├── mock-services/
│   │   ├── app.py            # Simulated microservice codebase with fault injections
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── prometheus/
│       ├── alert_rules.yml   # Threshold rules (CPU, memory, HTTP errors)
│       ├── alertmanager.yml  # Route configurations to FastAPI backend webhook
│       └── prometheus.yml    # Scrape configurations for simulation services
├── docker-compose.yml        # Orchestrates the database, monitoring, mock cluster, & backend
├── start_local.bat           # Local startup script for Windows Command Prompt
├── start_local.ps1           # Local startup script for PowerShell
└── README.md
```

---

## Setup and Installation

### Prerequisites
1. **Ollama**: Install [Ollama](https://ollama.com/) on your host machine.
2. **Model**: Pull the required model:
   ```bash
   ollama pull qwen2.5:3b
   ```
3. **Database & Services**: Ensure port `8000` (FastAPI backend), `3000` (Next.js dashboard), and ports `8001-8005` (simulated microservices) are free on your host.

---

### Option A: Local Host-Native Execution

This mode runs the backend, frontend, and five microservices on your local machine using an SQLite database and a background health monitor thread (no local Docker required for mock services).

1. Execute the local startup script:
   - On Windows Command Prompt: Double-click `start_local.bat` or run:
     ```cmd
     start_local.bat
     ```
   - On PowerShell: Run:
     ```powershell
     ./start_local.ps1
     ```
2. The script will:
   - Create a Python virtual environment (`.venv`) and install dependencies.
   - Spawn the five mock services on ports `8001` through `8005`.
   - Start the FastAPI backend on `http://localhost:8000`.
   - Boot the Next.js dev server on `http://localhost:3000`.
3. Open your browser to `http://localhost:3000` to interact with the system.

---

### Option B: Docker Compose Containerization

This mode boots all components inside Docker containers. The backend mounts the host's `/var/run/docker.sock` to allow the SRE agent to programmatically restart and scale containers.

1. Build and launch all services:
   ```bash
   docker compose up --build
   ```
2. Access the control dashboard at `http://localhost:3000`.
3. Prometheus is accessible at `http://localhost:9090` and AlertManager is at `http://localhost:9093`.
4. Ensure Ollama is running on your host machine. The backend container communicates with Ollama on your host via the `host.docker.internal` gateway on port `11434`.

---

## Simulation & Fault Injection Lifecycle

The system exposes three faults that can be injected to verify the agent's self-healing loop:

- **Memory Leak**: Simulates heap allocation growth by spawning a thread that appends 15MB chunks to memory every second. When memory usage exceeds the 80MB threshold, it triggers a `HighMemoryUsage` alert.
- **CPU Spike**: Launches busy-loop threads to maximize CPU usage. It triggers a `HighCpuUsage` alert when usage exceeds 80%.
- **Error Spike**: Configures the service to immediately return HTTP 500 statuses, triggering an `HttpErrorSpike` alert.

### End-to-End Resolution Process:

1. **Injection**: Click "Leak Memory" on `payment-service` via the dashboard.
2. **Detection**:
   - *Docker Mode*: Prometheus scrapes metrics, evaluates alert rules, and posts alert metadata to AlertManager, which calls the backend's webhook.
   - *Local Mode*: The backend's background `_health_monitor_loop` detects that memory has crossed the threshold and initiates a workflow.
3. **Execution**:
   - An incident is queued in the SQLite/PostgreSQL database.
   - The LangGraph state machine starts. The UI terminal starts streaming execution progress logs.
   - The agent reads logs, retrieves current memory metrics, and determines that `payment-service` is suffering from a heap memory issue.
   - The agent executes `restart_service` to reset the container or clear the service fault state.
4. **Verification & Post-Mortem**:
   - The agent waits 5 seconds, performs a health check query, and verifies that the metrics have stabilized.
   - The agent writes a post-mortem Markdown report and marks the incident as `RESOLVED`.
   - You can download the completed report directly from the incident log feed.

---

## API Reference

The FastAPI SRE backend provides the following endpoints:

### Alerts Webhook
- **`POST /api/v1/alerts/webhook`**
  Receives alert notification objects from AlertManager. Evaluates active status, deduplicates alerts, and runs the LangGraph worker in a background thread.

### Incident Management
- **`GET /api/v1/incidents`**: Returns a list of all active and historical incidents.
- **`GET /api/v1/incidents/{incident_id}`**: Returns details of a specific incident, including root cause and generated post-mortem.
- **`GET /api/v1/incidents/{incident_id}/logs`**: Returns the step-by-step SRE execution timeline logs for the incident.

### Simulation Control
- **`POST /api/v1/simulation/inject`**: Injects a fault into a service.
  Request Body:
  ```json
  {
    "service": "payment-service",
    "fault": "memory-leak"
  }
  ```
- **`POST /api/v1/simulation/clear`**: Clears all active faults on all services.
- **`GET /api/v1/simulation/status`**: Aggregates and returns current metrics, health statuses, and fault states for all five mock services.