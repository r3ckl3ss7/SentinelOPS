@echo off
title SentinelOps AI - Local Startup
echo ==========================================================
echo              SENTINELOPS AI LOCAL STARTUP                  
echo ==========================================================

echo [*] Installing python dependencies for mock services...
pip install -r simulation/mock-services/requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Failed to install mock service dependencies. Make sure python is in your PATH.
)

echo [*] Installing python dependencies for SRE backend...
pip install -r backend/requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Failed to install SRE backend dependencies.
)

echo [*] Launching simulated microservice cluster...
start /min "SentinelOps: Notification Service" cmd /c "set SERVICE_NAME=notification-service&&set PORT=8005&&python simulation/mock-services/app.py"
start /min "SentinelOps: Payment Service" cmd /c "set SERVICE_NAME=payment-service&&set PORT=8004&&set DOWNSTREAM_URLS=http://localhost:8005&&python simulation/mock-services/app.py"
start /min "SentinelOps: Order Service" cmd /c "set SERVICE_NAME=order-service&&set PORT=8003&&set DOWNSTREAM_URLS=http://localhost:8004&&python simulation/mock-services/app.py"
start /min "SentinelOps: User Service" cmd /c "set SERVICE_NAME=user-service&&set PORT=8002&&python simulation/mock-services/app.py"
start /min "SentinelOps: API Gateway" cmd /c "set SERVICE_NAME=api-gateway&&set PORT=8001&&set DOWNSTREAM_URLS=http://localhost:8002,http://localhost:8003&&python simulation/mock-services/app.py"

echo [+] Mock cluster running (api-gateway:8001, user:8002, order:8003, payment:8004, notification:8005)

echo [*] Launching FastAPI SRE Backend...
cd backend
start "SentinelOps: FastAPI SRE Agent" cmd /c "set DATABASE_URL=sqlite:///./sentinelops.db&&set OLLAMA_HOST=http://localhost:11434&&python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
cd ..

echo [+] FastAPI backend is starting...

echo [*] Launching Next.js Control Dashboard...
cd frontend
start "SentinelOps: Next.js Dashboard" cmd /c "npm run dev"
cd ..

echo [+] Next.js dev server is starting...
echo ==========================================================
echo  SETUP COMPLETE!
echo  -> SRE Backend API: http://localhost:8000
echo  -> SRE Dashboard: http://localhost:3000
echo  -> Ensure Ollama is running and has qwen2.5:3b pulled:
echo     ollama pull qwen2.5:3b
echo ==========================================================
pause
