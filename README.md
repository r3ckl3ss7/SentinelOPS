# SentinelOps AI - Autonomous Self-Healing SRE Agent

> [!NOTE]
> **SentinelOps AI** is an autonomous Site Reliability Engineer that detects, diagnoses, remediates, and verifies production incidents without human intervention. 

This repository simulates a full microservice environment, exposes a real-time diagnostics monitoring system, routes active system alerts to an AI Agent SRE layer powered by a **Local LLM (Ollama / Qwen2.5:3b)** via **LangGraph**, heals the cluster, and automatically compiles incident post-mortems.

---

## 🚀 Key Features

* **Simulated Cluster Architecture**: Gateway, User, Order, Payment, and Notification services.
* **Fault Injection Control Console**: Inject memory leaks, CPU spikes, or HTTP 500 error storms into live services.
* **AlertManager Webhook Integration**: Simulates full real-time Prometheus alert routing loops.
* **LangGraph SRE Diagnostics Engine**: Run an SRE ReAct loop locally using **Ollama** and `qwen2.5:3b`.
* **Live Operations Log Console**: Watch the agent think, execute Docker/API commands, analyze logs, and verify system restoration.
* **Post-Mortem Auto-Generation**: Automatically downloads Markdown post-mortems detailing incident root cause, resolution action, and MTTR.

---

## 🛠️ Quick Start (Localhost Running)

You can run the entire system directly on your Windows host without Docker!

### Prerequisites
1. Install [Ollama](https://ollama.com/) and run:
   ```bash
   ollama pull qwen2.5:3b
   ```
2. Python 3.10+ and Node.js 18+ installed on your host.

### Startup
1. Double-click `start_local.bat` or run:
   ```powershell
   ./start_local.ps1
   ```
2. Open your browser:
   * **Control Dashboard**: [http://localhost:3000](http://localhost:3000)
   * **SRE Backend API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🐳 Running with Docker Compose

If Docker Desktop is running on your host machine:

1. Build and boot the stack:
   ```bash
   docker compose up --build
   ```
2. Open [http://localhost:3000](http://localhost:3000).

---

## 🔬 Incident Walkthrough Flow

1. Open [http://localhost:3000](http://localhost:3000). You'll see all 5 microservices running in a stable **HEALTHY** baseline.
2. Click **"Leak Memory"** under `payment-service`.
3. Memory usage starts growing. When it crosses 80MB, Prometheus rules match, AlertManager catches the alert, and sends a webhook to the SRE Agent.
4. An active incident appears in the feed. Click it to open the **SRE Agent Console**.
5. Watch the Agent invoke telemetry tools to inspect CPU, memory, and container stdout, diagnose the `java.lang.OutOfMemoryError`, and call `restart_service`.
6. Once the service resets, the agent runs smoke tests, observes a `200 OK` health status, updates the incident to **RESOLVED**, and publishes a downloadable incident post-mortem report!