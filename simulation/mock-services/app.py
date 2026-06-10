import os
import time
import uuid
import threading
import logging
from fastapi import FastAPI, Response, HTTPException
from prometheus_client import start_http_server, Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
import requests

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mock-service")

SERVICE_NAME = os.getenv("SERVICE_NAME", "mock-service")
PORT = int(os.getenv("PORT", "8000"))
DOWNSTREAM_URLS = os.getenv("DOWNSTREAM_URLS", "").split(",")
DOWNSTREAM_URLS = [url.strip() for url in DOWNSTREAM_URLS if url.strip()]

app = FastAPI(title=SERVICE_NAME)

# Prometheus Metrics
REQUESTS = Counter(
    "http_requests_total", 
    "Total HTTP requests", 
    ["method", "endpoint", "status"]
)
LATENCY = Histogram(
    "http_request_duration_seconds", 
    "HTTP request latency in seconds", 
    ["method", "endpoint"]
)
MEMORY_GAUGE = Gauge(
    "service_memory_usage_bytes",
    "Simulated or actual resident memory usage in bytes"
)
CPU_GAUGE = Gauge(
    "service_cpu_usage_ratio",
    "Simulated or actual CPU usage ratio (0.0 to 1.0)"
)

# Fault States
FAULT_MEMORY_LEAK = False
FAULT_CPU_SPIKE = False
FAULT_ERROR_SPIKE = False

# Memory leak storage
memory_leak_holder = []
cpu_threads = []
stop_cpu_threads = False

def memory_leak_worker():
    global FAULT_MEMORY_LEAK, memory_leak_holder
    logger.info("Starting memory leak worker thread...")
    while FAULT_MEMORY_LEAK:
        # Allocate ~15MB of data every second
        data = bytearray(15 * 1024 * 1024)
        memory_leak_holder.append(data)
        current_mem = len(memory_leak_holder) * 15 * 1024 * 1024 + 10 * 1024 * 1024
        MEMORY_GAUGE.set(current_mem)
        logger.info(f"Memory leak active. Simulated usage: {current_mem / (1024*1024):.1f} MB")
        time.sleep(1)

def cpu_spike_worker():
    global FAULT_CPU_SPIKE, stop_cpu_threads
    logger.info("Starting CPU spike worker thread...")
    while not stop_cpu_threads and FAULT_CPU_SPIKE:
        # Busy loop
        _ = 12345 * 54321
        # Periodically yield to avoid locking the system completely
        time.sleep(0.001)

@app.on_event("startup")
def startup_event():
    # Set default values for metrics
    MEMORY_GAUGE.set(20 * 1024 * 1024)  # 20MB baseline
    CPU_GAUGE.set(0.05)  # 5% baseline

@app.get("/health")
def health():
    if FAULT_ERROR_SPIKE:
        REQUESTS.labels(method="GET", endpoint="/health", status="500").inc()
        raise HTTPException(status_code=500, detail="Service Unhealthy (Error Spike Injected)")
    
    REQUESTS.labels(method="GET", endpoint="/health", status="200").inc()
    return {"status": "healthy", "service": SERVICE_NAME}

@app.get("/metrics")
def metrics():
    # Update simulated metrics based on status
    if not FAULT_MEMORY_LEAK:
        # Normal baseline memory drift
        MEMORY_GAUGE.set(20 * 1024 * 1024 + (int(time.time()) % 100) * 1024)
    if not FAULT_CPU_SPIKE:
        CPU_GAUGE.set(0.05 + (int(time.time()) % 5) / 100.0)
    else:
        CPU_GAUGE.set(0.95)

    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/")
def handle_request():
    start_time = time.time()
    
    # 1. Error Spike Check
    if FAULT_ERROR_SPIKE:
        REQUESTS.labels(method="GET", endpoint="/", status="500").inc()
        raise HTTPException(status_code=500, detail=f"Internal Server Error in {SERVICE_NAME}")

    # 2. Call Downstream Services
    downstream_results = {}
    for url in DOWNSTREAM_URLS:
        try:
            logger.info(f"{SERVICE_NAME} calling downstream: {url}")
            resp = requests.get(url, timeout=3.0)
            if resp.status_code != 200:
                raise HTTPException(status_code=500, detail=f"Downstream service {url} failed: {resp.text}")
            downstream_results[url] = resp.json()
        except Exception as e:
            logger.error(f"Downstream call failed: {str(e)}")
            REQUESTS.labels(method="GET", endpoint="/", status="500").inc()
            LATENCY.labels(method="GET", endpoint="/").observe(time.time() - start_time)
            raise HTTPException(status_code=500, detail=f"Error contacting downstream: {str(e)}")

    duration = time.time() - start_time
    LATENCY.labels(method="GET", endpoint="/").observe(duration)
    REQUESTS.labels(method="GET", endpoint="/", status="200").inc()
    
    return {
        "service": SERVICE_NAME,
        "status": "success",
        "timestamp": time.time(),
        "downstream": downstream_results
    }

# Fault Injection Endpoints
@app.post("/fault/memory-leak")
def inject_memory_leak():
    global FAULT_MEMORY_LEAK
    if not FAULT_MEMORY_LEAK:
        FAULT_MEMORY_LEAK = True
        threading.Thread(target=memory_leak_worker, daemon=True).start()
        logger.warning(f"Injected MEMORY LEAK into {SERVICE_NAME}")
    return {"message": f"Memory leak injected into {SERVICE_NAME}"}

@app.post("/fault/cpu-spike")
def inject_cpu_spike():
    global FAULT_CPU_SPIKE, stop_cpu_threads, cpu_threads
    if not FAULT_CPU_SPIKE:
        FAULT_CPU_SPIKE = True
        stop_cpu_threads = False
        cpu_threads = []
        # Start a thread per CPU core (or just 4 threads to make it spike)
        for i in range(4):
            t = threading.Thread(target=cpu_spike_worker, daemon=True)
            t.start()
            cpu_threads.append(t)
        logger.warning(f"Injected CPU SPIKE into {SERVICE_NAME}")
    return {"message": f"CPU spike injected into {SERVICE_NAME}"}

@app.post("/fault/error-spike")
def inject_error_spike():
    global FAULT_ERROR_SPIKE
    FAULT_ERROR_SPIKE = True
    logger.warning(f"Injected ERROR SPIKE into {SERVICE_NAME}")
    return {"message": f"Error spike injected into {SERVICE_NAME}"}

@app.post("/fault/clear")
def clear_faults():
    global FAULT_MEMORY_LEAK, FAULT_CPU_SPIKE, FAULT_ERROR_SPIKE, memory_leak_holder, stop_cpu_threads, cpu_threads
    logger.info(f"Clearing all faults for {SERVICE_NAME}")
    FAULT_MEMORY_LEAK = False
    FAULT_CPU_SPIKE = False
    FAULT_ERROR_SPIKE = False
    stop_cpu_threads = True
    
    # Wait for CPU threads to stop
    for t in cpu_threads:
        t.join(timeout=0.5)
    cpu_threads = []
    
    # Release memory leak allocations
    memory_leak_holder.clear()
    
    # Reset metrics
    MEMORY_GAUGE.set(20 * 1024 * 1024)
    CPU_GAUGE.set(0.05)
    
    return {"message": f"Faults cleared for {SERVICE_NAME}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
