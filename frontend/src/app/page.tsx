"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  Cpu, 
  Database, 
  Flame, 
  HardDrive, 
  Layers, 
  Play, 
  RefreshCw, 
  Server, 
  Terminal, 
  ArrowRight,
  Clock,
  Shield,
  Target,
  Zap,
  ChevronRight,
  ExternalLink,
  Code,
  Layout,
  Radio,
  FileText,
  BarChart3,
  TrendingUp
} from "lucide-react";

interface SimulationStep {
  title: string;
  badge: string;
  icon: any;
  color: string;
  logs: string[];
}

interface Scenario {
  name: string;
  service: string;
  anomaly: string;
  steps: SimulationStep[];
}

const SCENARIOS: Record<string, Scenario> = {
  memory: {
    name: "Memory Leak (OOM Anomaly)",
    service: "payment-service",
    anomaly: "HighMemoryUsage",
    steps: [
      {
        title: "Investigate Node",
        badge: "DIAGNOSING",
        icon: Target,
        color: "text-purple-600 border-purple-200 bg-purple-50",
        logs: [
          "[10:14:02] ALERT received: HighMemoryUsage on payment-service",
          "[10:14:03] Node INVESTIGATE: Querying Prometheus telemetry metrics...",
          "[10:14:04] payment-service RAM usage is 98MB (Limit 80MB). Status: Unhealthy.",
          "[10:14:05] Querying logs... Found trace: java.lang.OutOfMemoryError",
          "[10:14:06] LLM Diagnosis: Fatal memory exhaustion due to transaction thread heap leak."
        ]
      },
      {
        title: "Remediate Node",
        badge: "REMEDIATING",
        icon: Zap,
        color: "text-amber-600 border-amber-200 bg-amber-50",
        logs: [
          "[10:14:07] Node REMEDIATE: Selecting mitigation plan: CONTAINER_RESTART",
          "[10:14:08] Executing Docker command: docker restart sentinelops-payment-1",
          "[10:14:09] Container sentinelops-payment-1 restarted successfully (Exit Code 0).",
          "[10:14:09] Telemetry reset. Memory allocations cleared."
        ]
      },
      {
        title: "Verify Node",
        badge: "VERIFYING",
        icon: Shield,
        color: "text-cyan-700 border-cyan-200 bg-cyan-50",
        logs: [
          "[10:14:10] Node VERIFY: Waiting 5 seconds for service convergence...",
          "[10:14:15] Pinging health probe on http://payment-service:8004/health",
          "[10:14:16] Response: 200 OK. RAM: 24MB. Status: Healthy.",
          "[10:14:17] LLM Verification: System confirmed stable. No cascading anomalies."
        ]
      },
      {
        title: "Report Node",
        badge: "RESOLVED",
        icon: CheckCircle,
        color: "text-emerald-600 border-emerald-200 bg-emerald-50",
        logs: [
          "[10:14:18] Node REPORT: Generating markdown incident post-mortem report...",
          "[10:14:19] Report saved to Database (Incident ID: INC-4890). MTTR: 17 seconds.",
          "[10:14:20] Alert resolved. Operations Console resumed monitoring."
        ]
      }
    ]
  },
  cpu: {
    name: "CPU Spike (Busy Loop)",
    service: "order-service",
    anomaly: "HighCpuUsage",
    steps: [
      {
        title: "Investigate Node",
        badge: "DIAGNOSING",
        icon: Target,
        color: "text-purple-600 border-purple-200 bg-purple-50",
        logs: [
          "[18:02:11] ALERT received: HighCpuUsage on order-service",
          "[18:02:12] Node INVESTIGATE: Fetching target container metrics...",
          "[18:02:13] order-service CPU load at 97% (Threshold 80%).",
          "[18:02:14] Examining stdout logs... Detected recurring busy-loop thread on route /checkout.",
          "[18:02:15] LLM Diagnosis: Core thread lockup in order checkout routine."
        ]
      },
      {
        title: "Remediate Node",
        badge: "REMEDIATING",
        icon: Zap,
        color: "text-amber-600 border-amber-200 bg-amber-50",
        logs: [
          "[18:02:16] Node REMEDIATE: Selecting mitigation plan: REBOOT_WORKERS",
          "[18:02:17] Clearing lock threads and restarting order-processing workers...",
          "[18:02:18] Remediated order-service container state."
        ]
      },
      {
        title: "Verify Node",
        badge: "VERIFYING",
        icon: Shield,
        color: "text-cyan-700 border-cyan-200 bg-cyan-50",
        logs: [
          "[18:02:19] Node VERIFY: Cooling down telemetry sensors...",
          "[18:02:24] Scraping Prometheus metric: process_cpu_seconds_total",
          "[18:02:25] order-service CPU load stabilized at 4.2%.",
          "[18:02:26] Synthetic endpoint check returned 200 OK (Latency: 12ms)."
        ]
      },
      {
        title: "Report Node",
        badge: "RESOLVED",
        icon: CheckCircle,
        color: "text-emerald-600 border-emerald-200 bg-emerald-50",
        logs: [
          "[18:02:27] Node REPORT: Assembling Incident Report INC-4891.",
          "[18:02:28] Post-mortem compiled. Total resolution time (MTTR): 17 seconds."
        ]
      }
    ]
  },
  http: {
    name: "HTTP 500 Storm (Failure)",
    service: "api-gateway",
    anomaly: "HttpErrorSpike",
    steps: [
      {
        title: "Investigate Node",
        badge: "DIAGNOSING",
        icon: Target,
        color: "text-purple-600 border-purple-200 bg-purple-50",
        logs: [
          "[03:41:50] ALERT received: HttpErrorSpike on api-gateway",
          "[03:41:51] Node INVESTIGATE: Inspecting gateway routing statistics...",
          "[03:41:52] Detected 48 errors/min on downstream user-service calls.",
          "[03:41:53] Checking user-service status... Found DB connection pool timeout.",
          "[03:41:54] LLM Diagnosis: Database pool exhaustion in user-service leading to gateway HTTP 500 failures."
        ]
      },
      {
        title: "Remediate Node",
        badge: "REMEDIATING",
        icon: Zap,
        color: "text-amber-600 border-amber-200 bg-amber-50",
        logs: [
          "[03:41:55] Node REMEDIATE: Action plan: RECYCLE_DB_POOL & SERVICE_RESTART",
          "[03:41:56] Restarting postgres connection manager & user-service container...",
          "[03:41:57] Database pools recycled. Container reboot complete."
        ]
      },
      {
        title: "Verify Node",
        badge: "VERIFYING",
        icon: Shield,
        color: "text-cyan-700 border-cyan-200 bg-cyan-50",
        logs: [
          "[03:41:58] Node VERIFY: Executing verification suite...",
          "[03:42:03] curl http://api-gateway:8001/orders -> 200 OK (0.015s).",
          "[03:42:04] HTTP Error Rate dropped to 0.0%."
        ]
      },
      {
        title: "Report Node",
        badge: "RESOLVED",
        icon: CheckCircle,
        color: "text-emerald-600 border-emerald-200 bg-emerald-50",
        logs: [
          "[03:42:05] Node REPORT: Writing Incident Report INC-4892.",
          "[03:42:06] Incident resolved. MTTR: 16 seconds."
        ]
      }
    ]
  }
};

export default function LandingPage() {
  const [activeScenario, setActiveScenario] = useState<string>("memory");
  const [activeStep, setActiveStep] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [typedLogs, setTypedLogs] = useState<string[]>([]);
  const intervalRef = useRef<any>(null);

  // Benchmark data from real API
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  interface BenchmarkSummary {
    avg_mttr: number;
    recovery_success_rate: number;
    false_positive_rate: number;
    agent_accuracy: number;
    total_resolved: number;
    total_failed: number;
    total_pending: number;
  }

  interface AlertBenchmark {
    alert_name: string;
    total: number;
    resolved: number;
    failed: number;
    avg_mttr: number;
    success_rate: number;
    false_positive_rate: number;
    avg_confidence: number;
  }

  interface BenchmarkData {
    total_incidents: number;
    summary: BenchmarkSummary;
    by_alert_type: AlertBenchmark[];
  }

  const [benchmarkData, setBenchmarkData] = useState<BenchmarkData | null>(null);

  useEffect(() => {
    const fetchBenchmarks = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/benchmarks`);
        if (res.ok) {
          const data = await res.json();
          setBenchmarkData(data);
        }
      } catch (err) {
        console.error("Failed to fetch benchmarks:", err);
      }
    };
    fetchBenchmarks();
    // Refresh every 30 seconds to pick up new incidents
    const interval = setInterval(fetchBenchmarks, 30000);
    return () => clearInterval(interval);
  }, [API_URL]);

  // Icon map for alert types
  const alertIconMap: Record<string, string> = {
    "HighMemoryUsage": "🧠",
    "HighCpuUsage": "⚡",
    "HttpErrorSpike": "🔥",
    "DatabaseCorruptionAlert": "🗄️",
    "LowPriorityWarning": "⚙️",
    "DependencyFailure": "🔌",
    "DatabaseSaturation": "🗄️",
    "NetworkPartition": "🌐",
    "CascadingFailure": "🌊",
    "ConfigurationDrift": "⚙️",
    "CertificateExpiration": "🔑",
  };

  // Human-readable names for alert types
  const alertNameMap: Record<string, string> = {
    "HighMemoryUsage": "Memory Leak (OOM)",
    "HighCpuUsage": "CPU Spike (Busy Loop)",
    "HttpErrorSpike": "HTTP 500 Storm",
    "DatabaseCorruptionAlert": "DB Corruption",
    "LowPriorityWarning": "Low Priority Warning",
    "DependencyFailure": "Dependency Failure",
    "DatabaseSaturation": "Database Saturation",
    "NetworkPartition": "Network Partition",
    "CascadingFailure": "Cascading Failure",
    "ConfigurationDrift": "Configuration Drift",
    "CertificateExpiration": "Certificate Expiration",
  };

  const scenario = SCENARIOS[activeScenario];

  // Auto-play the simulator steps
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setActiveStep((prev) => (prev + 1) % scenario.steps.length);
      }, 5000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, scenario]);

  // Simulating typewriter/log lines output
  useEffect(() => {
    const logsToShow: string[] = [];
    // Show logs from previous steps + current step
    for (let i = 0; i <= activeStep; i++) {
      logsToShow.push(...scenario.steps[i].logs);
    }
    setTypedLogs(logsToShow);
  }, [activeStep, activeScenario, scenario]);

  const changeScenario = (key: string) => {
    setActiveScenario(key);
    setActiveStep(0);
  };

  const handleStepClick = (idx: number) => {
    setIsPlaying(false);
    setActiveStep(idx);
  };

  return (
    <div className="relative min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans overflow-x-hidden">
      
      {/* Decorative Background Shapes */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-blue-100/30 via-cyan-50/20 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-[-100px] right-[-100px] w-[450px] h-[450px] rounded-full bg-gradient-to-br from-[#0942e6] to-[#0033cc] opacity-[0.95] pointer-events-none -z-10 shadow-2xl" />
      <div className="absolute top-[35%] right-[-150px] w-[350px] h-[350px] rounded-full border-[45px] border-[#00d2d3]/25 pointer-events-none -z-10" />
      <div className="absolute bottom-[20%] left-[-150px] w-[450px] h-[450px] rounded-full bg-cyan-100/30 blur-3xl pointer-events-none -z-10" />

      {/* Header */}
      <header className="border-b border-slate-100/80 bg-white/70 backdrop-blur-md px-8 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-blue-600/10 border border-blue-600/20 text-blue-600">
            <Activity className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-black tracking-tight text-[#0f172a] flex items-center space-x-2">
              <span>SentinelOps</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-600/10 text-blue-600 border border-blue-600/20 uppercase tracking-widest font-mono">Autonomous SRE</span>
            </h1>
          </div>
        </div>

        <nav className="hidden md:flex space-x-8 text-xs font-bold tracking-wider text-slate-500 font-sans">
          <Link href="/" className="text-blue-600 border-b-2 border-blue-600 pb-1 uppercase font-extrabold">About</Link>
          <Link href="/dashboard" className="hover:text-blue-600 transition-colors uppercase">Console</Link>
          <a href="http://localhost:8000/docs" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors uppercase flex items-center gap-1">
            <span>API Docs</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </nav>

        <div className="flex items-center space-x-4">
          <div className="hidden lg:flex items-center space-x-2.5 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-mono font-medium text-slate-600">
            <Radio className="h-3.5 w-3.5 text-emerald-500 animate-pulse" />
            <span>LLM: qwen2.5:3b</span>
          </div>

          <Link
            href="/dashboard"
            className="flex items-center space-x-1.5 px-5 py-2 text-xs font-bold tracking-wider bg-blue-600 hover:bg-blue-700 text-white rounded-full transition-all duration-200 shadow-md shadow-blue-500/15 hover:-translate-y-0.5"
          >
            <span>Launch Console</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="px-8 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-16 items-center max-w-[1400px] mx-auto w-full">
        
        {/* Left Side Info */}
        <div className="lg:col-span-6 flex flex-col items-start text-left">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-xs font-mono font-bold text-blue-600 mb-6 uppercase tracking-wider">
            <Shield className="h-4 w-4" />
            <span>100% Autonomous Incident Recovery</span>
          </div>
          
          <h2 className="text-slate-800 font-heading font-black text-4xl sm:text-5xl lg:text-[52px] leading-[1.1] tracking-tight mb-6 uppercase">
            Resolving system <br />
            outages in <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600 font-extrabold">seconds</span>, not hours.
          </h2>
          
          <p className="text-slate-500 text-sm sm:text-base mb-8 leading-relaxed max-w-xl font-medium font-sans">
            SentinelOps AI is a localized, self-healing Site Reliability Engineering agent. By combining real-time Prometheus telemetry, docker container orchestration, and a LangGraph cognitive loop, it diagnoses logs and executes code-level remediations autonomously.
          </p>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto">
            <Link
              href="/dashboard"
              className="flex items-center justify-center space-x-2 px-8 py-3.5 rounded-full text-xs font-bold tracking-wider bg-gradient-to-r from-blue-600 to-cyan-500 hover:opacity-95 text-white active:scale-95 transition-all shadow-lg shadow-blue-500/15 cursor-pointer"
            >
              <span>Launch Live Operations</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#simulator"
              className="flex items-center justify-center space-x-2 px-8 py-3.5 rounded-full text-xs font-bold tracking-wider border border-slate-200 hover:border-slate-300 bg-white text-slate-600 hover:text-slate-800 shadow-sm transition-all cursor-pointer"
            >
              <span>Watch Outage Simulator</span>
            </a>
          </div>

          <div className="mt-12 grid grid-cols-3 gap-6 pt-8 border-t border-slate-100 w-full max-w-lg">
            <div>
              <div className="text-xl font-bold font-heading text-slate-800">18s</div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Average MTTR</div>
            </div>
            <div>
              <div className="text-xl font-bold font-heading text-slate-800">0</div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Egress Data Cost</div>
            </div>
            <div>
              <div className="text-xl font-bold font-heading text-slate-800">Local</div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">LLM Run (Qwen)</div>
            </div>
          </div>
        </div>

        {/* Right Side UI Graphic */}
        <div className="lg:col-span-6 w-full flex justify-center lg:justify-end relative">
          <div className="relative rounded-2xl border border-slate-200 shadow-2xl bg-slate-950 p-2 overflow-hidden w-full max-w-[580px] group">
            
            {/* Window Frame header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-slate-900/40">
              <div className="flex space-x-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">sentinelops-agent-daemon.log</span>
              <div className="w-10"></div>
            </div>

            <div className="p-4 bg-slate-950 font-mono text-xs text-slate-300 space-y-2 h-[340px] overflow-y-auto overscroll-contain select-none scrollbar-thin">
              <div className="text-slate-500">// Booting SentinelOps AI Agent Core ...</div>
              <div className="flex items-center space-x-1">
                <span className="text-emerald-500">✓</span>
                <span>Ollama service connection confirmed: http://localhost:11434</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="text-emerald-500">✓</span>
                <span>Telemetry scraping active (Prometheus Client on port 9090)</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="text-emerald-500">✓</span>
                <span>Docker Daemon socket bound: /var/run/docker.sock</span>
              </div>
              <div className="text-slate-500 mt-2">// Telemetry Overview status nominal</div>
              <div className="grid grid-cols-2 gap-2 text-[11px] p-2 bg-slate-900/30 rounded border border-white/5 my-2">
                <div className="flex justify-between"><span>api-gateway:</span><span className="text-emerald-400 font-bold">HEALTHY</span></div>
                <div className="flex justify-between"><span>order-service:</span><span className="text-emerald-400 font-bold">HEALTHY</span></div>
                <div className="flex justify-between"><span>payment-service:</span><span className="text-emerald-400 font-bold">HEALTHY</span></div>
                <div className="flex justify-between"><span>user-service:</span><span className="text-emerald-400 font-bold">HEALTHY</span></div>
              </div>
              <div className="text-cyan-400 animate-pulse mt-4">&gt; Agent listening on AlertManager webhook endpoint [/api/v1/webhook]...</div>
              
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none" />
            </div>

            {/* Overlapping Badge */}
            <div className="absolute bottom-6 right-6 p-4 rounded-xl border border-slate-100 bg-white/90 shadow-xl flex items-center space-x-3 backdrop-blur-md hover:scale-105 transition-transform duration-200">
              <div className="p-2 bg-blue-600/10 text-blue-600 border border-blue-600/20 rounded-lg">
                <Cpu className="h-5 w-5 animate-spin-slow" />
              </div>
              <div className="text-left">
                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Reasoning Loop</div>
                <div className="text-xs font-bold text-slate-800">LangGraph Active</div>
              </div>
            </div>

          </div>
        </div>

      </section>

      {/* Simulator Section */}
      <section id="simulator" className="px-8 py-24 border-y border-slate-100 bg-slate-50/50 w-full relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[1px] bg-gradient-to-r from-transparent via-blue-500/10 to-transparent"></div>
        
        <div className="max-w-[1400px] mx-auto text-center mb-16">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-xs font-mono font-bold text-blue-600 mb-3 uppercase tracking-wider">
            <Radio className="h-3 w-3 text-blue-600 animate-pulse" />
            <span>Interactive Simulator</span>
          </div>
          <h3 className="font-heading font-black text-slate-800 text-3xl sm:text-4xl uppercase">
            Outage Remediation Playground
          </h3>
          <p className="text-slate-500 text-sm mt-3 max-w-lg mx-auto">
            Choose a critical microservice outage scenario below to test and watch the SRE agent reasoning and automated resolution process.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-[1400px] mx-auto w-full items-stretch">
          
          {/* Simulator Control Panel (Tabs & Steps) */}
          <div className="lg:col-span-5 flex flex-col justify-between bg-white border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.02)] rounded-2xl p-6">
            
            {/* Scenarios Selector */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">1. Select Outage Scenario</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2.5">
                {Object.entries(SCENARIOS).map(([key, item]) => {
                  const isActive = activeScenario === key;
                  return (
                    <button
                      key={key}
                      onClick={() => changeScenario(key)}
                      className={`p-3.5 rounded-xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                        isActive 
                          ? "bg-blue-50 border-blue-600/30 text-blue-700 shadow-sm" 
                          : "bg-slate-50/50 border-slate-100 hover:border-slate-200 text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-xs">{item.name}</span>
                        <span className="text-[9px] text-slate-500 font-mono mt-0.5">Target: {item.service}</span>
                      </div>
                      <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isActive ? "translate-x-0.5 text-blue-600" : "text-slate-400"}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step-by-Step Flow */}
            <div className="mt-8 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">2. SRE Agent Lifecycle Trace</h4>
                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center space-x-1 cursor-pointer"
                >
                  <RefreshCw className={`h-3 w-3 ${isPlaying ? "animate-spin" : ""}`} />
                  <span>{isPlaying ? "Pause Loop" : "Auto Play"}</span>
                </button>
              </div>

              <div className="relative border-l border-slate-100 pl-4 ml-2 space-y-4">
                {scenario.steps.map((step, idx) => {
                  const isActive = activeStep === idx;
                  const isCompleted = activeStep > idx;
                  const StepIcon = step.icon;

                  return (
                    <div 
                      key={idx}
                      onClick={() => handleStepClick(idx)}
                      className={`relative flex items-start space-x-3 cursor-pointer group transition-all duration-200 ${
                        isActive 
                          ? "opacity-100 translate-x-1" 
                          : isCompleted 
                            ? "opacity-60 hover:opacity-85" 
                            : "opacity-40 hover:opacity-60"
                      }`}
                    >
                      {/* Left Dot/Icon overlap */}
                      <span className={`absolute -left-[27px] w-6 h-6 rounded-full flex items-center justify-center border text-xs shadow-md transition-all ${
                        isActive 
                          ? "bg-blue-600 border-blue-500 text-white pulse-glow" 
                          : isCompleted 
                            ? "bg-emerald-50 border-emerald-200 text-emerald-600" 
                            : "bg-slate-50 border-slate-200 text-slate-400"
                      }`}>
                        {isCompleted ? <CheckCircle className="h-3 w-3" /> : idx + 1}
                      </span>

                      <div className="text-left flex-grow">
                        <div className="flex items-center justify-between">
                          <span className={`font-bold text-xs transition-colors ${isActive ? "text-blue-600" : "text-slate-700"}`}>
                            {step.title}
                          </span>
                          <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${step.color}`}>
                            {step.badge}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5 font-medium leading-relaxed font-sans">
                          {idx === 0 && `Fetch logs & detect root-cause`}
                          {idx === 1 && `Apply selected remediation script`}
                          {idx === 2 && `Wait and verify health stats return`}
                          {idx === 3 && `Compile markdown post-mortem logs`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Launch Console CTA Button */}
            <div className="mt-8 pt-6 border-t border-slate-100">
              <Link
                href="/dashboard"
                className="flex items-center justify-center space-x-1.5 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold tracking-wider transition-all duration-200"
              >
                <span>Trigger This in Real Console</span>
                <ArrowRight className="h-4.5 w-4.5" />
              </Link>
            </div>

          </div>

          {/* Simulator Visual Terminal / Log Output */}
          <div className="lg:col-span-7 flex flex-col rounded-2xl border border-slate-100 overflow-hidden bg-white shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs font-mono select-none text-slate-600">
              <div className="flex items-center space-x-2">
                <Terminal className="h-4.5 w-4.5 text-blue-600" />
                <span className="font-bold text-slate-700">SentinelOps Console Stream</span>
              </div>
              <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                <span>Telemetry Connected</span>
              </div>
            </div>

            <div className="flex-1 p-5 font-mono text-[11px] leading-relaxed space-y-3 text-left overflow-y-auto overscroll-contain max-h-[450px] lg:max-h-none scrollbar-thin bg-[#0c1020] text-slate-300 shadow-inner">
              {typedLogs.map((log, idx) => {
                let textClass = "text-slate-300";
                if (log.includes("ALERT")) textClass = "text-red-400 font-bold animate-pulse";
                else if (log.includes("INVESTIGATE")) textClass = "text-purple-300";
                else if (log.includes("REMEDIATE")) textClass = "text-amber-300 font-bold";
                else if (log.includes("VERIFY")) textClass = "text-cyan-300";
                else if (log.includes("REPORT")) textClass = "text-emerald-400";
                else if (log.includes("LLM Diagnosis")) textClass = "text-blue-300 font-semibold italic";
                else if (log.includes("Docker command")) textClass = "text-slate-400 text-[10px] bg-slate-950 p-1 rounded font-mono border border-white/5 block my-1";

                return (
                  <div key={idx} className={`${textClass} whitespace-pre-wrap`}>
                    {log}
                  </div>
                );
              })}
              <div className="text-blue-500 animate-pulse mt-3">&gt;_ Listening for telemetry updates...</div>
            </div>
            
            {/* Terminal status bar */}
            <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[9px] font-mono text-slate-500 flex justify-between select-none">
              <div>Incident: INC-489{activeScenario === 'memory' ? '0' : activeScenario === 'cpu' ? '1' : '2'}</div>
              <div>MTTR Target: &lt;20s</div>
            </div>

          </div>

        </div>
      </section>

      {/* SRE Core Loop / State Machine Visualizer */}
      <section className="px-8 py-24 max-w-[1400px] mx-auto w-full text-center">
        
        <div className="mb-16">
          <div className="inline-flex items-center space-x-1 px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-xs font-mono font-bold text-blue-600 mb-3 uppercase tracking-wider">
            <Layers className="h-3.5 w-3.5" />
            <span>Agent Architecture</span>
          </div>
          <h3 className="font-heading font-black text-slate-800 text-3xl sm:text-4xl uppercase">
            LangGraph Cognitive State Loop
          </h3>
          <p className="text-slate-500 text-sm mt-3 max-w-lg mx-auto">
            SentinelOps routes decisions via an agentic state machine rather than hardcoded scripts, ensuring flexible diagnosis and recovery paths.
          </p>
        </div>

        {/* State Machine Grid Flow */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative px-4">
          
          {/* Card 1: Investigate */}
          <div className="bg-white border border-slate-100 hover:border-blue-300 p-6 rounded-2xl text-left transition-all duration-300 flex flex-col justify-between group shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-md">
            <div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 mb-4 group-hover:scale-110 transition-transform">
                <Target className="h-5 w-5" />
              </div>
              <h4 className="font-heading font-bold text-slate-800 text-lg mb-2">1. Investigate Node</h4>
              <p className="text-slate-500 text-xs leading-relaxed font-sans font-medium">
                Pulls the last 50 lines of container stdout, scrapes Prometheus metrics, and reads internal FastAPI /health outputs to construct LLM diagnosis prompts.
              </p>
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-6 border-t border-slate-100 pt-4">
              Tools: get_container_logs(), get_service_metrics()
            </div>
          </div>

          {/* Card 2: Remediate */}
          <div className="bg-white border border-slate-100 hover:border-amber-300 p-6 rounded-2xl text-left transition-all duration-300 flex flex-col justify-between group shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-md">
            <div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mb-4 group-hover:scale-110 transition-transform">
                <Zap className="h-5 w-5" />
              </div>
              <h4 className="font-heading font-bold text-slate-800 text-lg mb-2">2. Remediate Node</h4>
              <p className="text-slate-500 text-xs leading-relaxed font-sans font-medium">
                Executes the diagnostic mitigation plan. Commands are run safely via mounted Docker sockets or local Python virtual environment subprocesses.
              </p>
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-6 border-t border-slate-100 pt-4">
              Tools: restart_service(), scale_replicas(), rollback_config()
            </div>
          </div>

          {/* Card 3: Verify */}
          <div className="bg-white border border-slate-100 hover:border-cyan-300 p-6 rounded-2xl text-left transition-all duration-300 flex flex-col justify-between group shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-md">
            <div>
              <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-600 mb-4 group-hover:scale-110 transition-transform">
                <Shield className="h-5 w-5" />
              </div>
              <h4 className="font-heading font-bold text-slate-800 text-lg mb-2">3. Verify Node</h4>
              <p className="text-slate-500 text-xs leading-relaxed font-sans font-medium">
                Monitors downstream metrics over a convergence window to check if service recovery holds and verify the incident has been successfully resolved.
              </p>
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-6 border-t border-slate-100 pt-4">
              Tools: verify_telemetry_health(), run_synthetic_tests()
            </div>
          </div>

          {/* Card 4: Report */}
          <div className="bg-white border border-slate-100 hover:border-emerald-300 p-6 rounded-2xl text-left transition-all duration-300 flex flex-col justify-between group shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-md">
            <div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mb-4 group-hover:scale-110 transition-transform">
                <CheckCircle className="h-5 w-5" />
              </div>
              <h4 className="font-heading font-bold text-slate-800 text-lg mb-2">4. Report Node</h4>
              <p className="text-slate-500 text-xs leading-relaxed font-sans font-medium">
                Compiles a detailed post-mortem report summarizing the root cause, actions taken, timeline, and suggestions to prevent recurrence.
              </p>
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-6 border-t border-slate-100 pt-4">
              Tools: write_post_mortem_db(), emit_slack_webhook()
            </div>
          </div>

        </div>

      </section>

      {/* Quantitative Benchmark Tables Section */}
      <section className="px-8 py-24 bg-slate-50/50 border-y border-slate-100 w-full relative overflow-hidden">
        {/* Decorative background accents */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[1px] bg-gradient-to-r from-transparent via-blue-500/10 to-transparent"></div>
        <div className="absolute bottom-[-200px] right-[-100px] w-[400px] h-[400px] rounded-full bg-gradient-to-br from-blue-100/20 to-cyan-100/10 blur-3xl pointer-events-none" />

        <div className="max-w-[1400px] mx-auto">
          {/* Section Header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-xs font-mono font-bold text-blue-600 mb-3 uppercase tracking-wider">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Quantitative Evaluation</span>
            </div>
            <h3 className="font-heading font-black text-slate-800 text-3xl sm:text-4xl uppercase">
              Performance Benchmarks
            </h3>
            <p className="text-slate-500 text-sm mt-3 max-w-xl mx-auto">
              {benchmarkData && benchmarkData.total_incidents > 0
                ? `Live metrics computed from ${benchmarkData.total_incidents} real incident${benchmarkData.total_incidents !== 1 ? 's' : ''} across all microservices.`
                : "Metrics will appear here once incidents have been processed by the SRE agent."
              }
            </p>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            {/* Card 1: Avg MTTR */}
            <div className="group bg-white border border-slate-100 rounded-2xl p-6 text-center shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-lg hover:border-blue-200 transition-all duration-300 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="w-10 h-10 mx-auto rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 mb-3 group-hover:scale-110 transition-transform">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="text-3xl font-black font-heading text-slate-800 tracking-tight">
                  {benchmarkData ? benchmarkData.summary.avg_mttr : "—"}<span className="text-lg text-slate-400">s</span>
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Avg MTTR</div>
                <div className="mt-2 flex items-center justify-center gap-1 text-[9px] font-bold text-emerald-600">
                  <TrendingUp className="h-3 w-3" />
                  <span>{benchmarkData && benchmarkData.summary.avg_mttr > 0 ? `${Math.round(((15 * 60) - benchmarkData.summary.avg_mttr) / (15 * 60) * 100)}% faster than manual` : "Awaiting data"}</span>
                </div>
              </div>
            </div>

            {/* Card 2: Recovery Success Rate */}
            <div className="group bg-white border border-slate-100 rounded-2xl p-6 text-center shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-lg hover:border-emerald-200 transition-all duration-300 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="w-10 h-10 mx-auto rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mb-3 group-hover:scale-110 transition-transform">
                  <CheckCircle className="h-5 w-5" />
                </div>
                <div className="text-3xl font-black font-heading text-slate-800 tracking-tight">
                  {benchmarkData ? benchmarkData.summary.recovery_success_rate : "—"}<span className="text-lg text-slate-400">%</span>
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Recovery Success</div>
                <div className="mt-2 flex items-center justify-center gap-1 text-[9px] font-bold text-emerald-600">
                  <TrendingUp className="h-3 w-3" />
                  <span>{benchmarkData ? `${benchmarkData.summary.total_resolved} of ${benchmarkData.summary.total_resolved + benchmarkData.summary.total_failed} incidents` : "Awaiting data"}</span>
                </div>
              </div>
            </div>

            {/* Card 3: False Positive Rate */}
            <div className="group bg-white border border-slate-100 rounded-2xl p-6 text-center shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-lg hover:border-amber-200 transition-all duration-300 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-50/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="w-10 h-10 mx-auto rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mb-3 group-hover:scale-110 transition-transform">
                  <Shield className="h-5 w-5" />
                </div>
                <div className="text-3xl font-black font-heading text-slate-800 tracking-tight">
                  {benchmarkData ? benchmarkData.summary.false_positive_rate : "—"}<span className="text-lg text-slate-400">%</span>
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">False Positive Rate</div>
                <div className="mt-2 flex items-center justify-center gap-1 text-[9px] font-bold text-blue-600">
                  <Shield className="h-3 w-3" />
                  <span>Governance-filtered</span>
                </div>
              </div>
            </div>

            {/* Card 4: Agent Accuracy */}
            <div className="group bg-white border border-slate-100 rounded-2xl p-6 text-center shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-lg hover:border-purple-200 transition-all duration-300 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-50/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="w-10 h-10 mx-auto rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 mb-3 group-hover:scale-110 transition-transform">
                  <Target className="h-5 w-5" />
                </div>
                <div className="text-3xl font-black font-heading text-slate-800 tracking-tight">
                  {benchmarkData ? benchmarkData.summary.agent_accuracy : "—"}<span className="text-lg text-slate-400">%</span>
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">RCA Accuracy</div>
                <div className="mt-2 flex items-center justify-center gap-1 text-[9px] font-bold text-purple-600">
                  <Cpu className="h-3 w-3" />
                  <span>LLM + Heuristic fusion</span>
                </div>
              </div>
            </div>
          </div>

          {/* Benchmark Comparison Table */}
          <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.02)] overflow-hidden">
            {/* Table Header Bar */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-600">Performance Breakdown by Alert Type</span>
              </div>
              <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                {benchmarkData ? `n = ${benchmarkData.total_incidents} incidents` : "loading..."}
              </span>
            </div>

            {/* Responsive table wrapper */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-[22%]">Alert Type</th>
                    <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center w-[10%]">Count</th>
                    <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center w-[13%]">Avg MTTR</th>
                    <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-[20%]">Recovery Success</th>
                    <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-[17%]">False Positive</th>
                    <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-[18%]">Agent Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarkData && benchmarkData.by_alert_type.length > 0 ? (
                    benchmarkData.by_alert_type.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-slate-50 transition-all duration-200 hover:bg-blue-50/30 group ${
                          idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"
                        }`}
                      >
                        {/* Alert Name */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2.5">
                            <span className="text-sm">{alertIconMap[row.alert_name] || "🚨"}</span>
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-800 text-xs group-hover:text-blue-700 transition-colors">
                                {alertNameMap[row.alert_name] || row.alert_name}
                              </span>
                              <span className="text-[8px] font-mono text-slate-400">{row.alert_name}</span>
                            </div>
                          </div>
                        </td>

                        {/* Count */}
                        <td className="px-4 py-4 text-center">
                          <span className="font-mono font-bold text-sm text-slate-700">{row.total}</span>
                        </td>

                        {/* MTTR */}
                        <td className="px-4 py-4 text-center">
                          {row.avg_mttr > 0 ? (
                            <span className={`font-mono font-black text-sm ${
                              row.avg_mttr <= 30 ? "text-emerald-600" : row.avg_mttr <= 60 ? "text-blue-600" : "text-amber-600"
                            }`}>
                              {row.avg_mttr}s
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10px] font-mono">N/A</span>
                          )}
                        </td>

                        {/* Recovery Success Rate */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex-grow bg-slate-100 h-2 rounded-full overflow-hidden max-w-[100px]">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  row.success_rate >= 95 ? "bg-emerald-500" : row.success_rate >= 80 ? "bg-blue-500" : row.success_rate > 0 ? "bg-amber-500" : "bg-slate-200"
                                }`}
                                style={{ width: `${row.success_rate}%` }}
                              ></div>
                            </div>
                            <span className={`font-mono font-bold text-[11px] ${
                              row.success_rate >= 95 ? "text-emerald-600" : row.success_rate >= 80 ? "text-blue-600" : "text-amber-600"
                            }`}>
                              {row.success_rate}%
                            </span>
                          </div>
                        </td>

                        {/* False Positive Rate */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex-grow bg-slate-100 h-2 rounded-full overflow-hidden max-w-[100px]">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  row.false_positive_rate <= 2.0 ? "bg-emerald-400" : row.false_positive_rate <= 5.0 ? "bg-amber-400" : "bg-red-400"
                                }`}
                                style={{ width: `${Math.min(row.false_positive_rate * 10, 100)}%` }}
                              ></div>
                            </div>
                            <span className={`font-mono font-bold text-[11px] ${
                              row.false_positive_rate <= 2.0 ? "text-emerald-600" : row.false_positive_rate <= 5.0 ? "text-amber-600" : "text-red-500"
                            }`}>
                              {row.false_positive_rate}%
                            </span>
                          </div>
                        </td>

                        {/* Agent Accuracy */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex-grow bg-slate-100 h-2 rounded-full overflow-hidden max-w-[100px]">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  row.avg_confidence >= 90 ? "bg-purple-500" : row.avg_confidence >= 75 ? "bg-blue-500" : "bg-amber-500"
                                }`}
                                style={{ width: `${row.avg_confidence}%` }}
                              ></div>
                            </div>
                            <span className={`font-mono font-bold text-[11px] ${
                              row.avg_confidence >= 90 ? "text-purple-600" : row.avg_confidence >= 75 ? "text-blue-600" : "text-amber-600"
                            }`}>
                              {row.avg_confidence}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <RefreshCw className="h-5 w-5 animate-spin text-blue-400" />
                          <span className="text-[11px] font-bold uppercase tracking-wider">
                            {benchmarkData ? "No incident data yet — trigger an outage to start collecting benchmarks" : "Connecting to backend..."}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="px-6 py-3.5 bg-slate-50/50 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <span className="text-[9px] text-slate-400 font-medium">
                Live data from real SRE agent incidents &middot; LLM: Qwen 2.5:3b &middot; Auto-refreshes every 30s
              </span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-[9px] text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Excellent</span>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  <span>Good</span>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  <span>Acceptable</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Infrastructure Components Stack / Architecture Grid */}
      <section className="px-8 py-24 bg-slate-50/50 border-t border-slate-100 w-full">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div className="lg:col-span-4 text-left">
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-xs font-mono font-bold text-blue-600 mb-3 uppercase tracking-wider">
              <Cpu className="h-3.5 w-3.5" />
              <span>System Stack</span>
            </div>
            <h3 className="font-heading font-black text-slate-800 text-3xl uppercase leading-[1.15]">
              Modern Observability & Agent Integration
            </h3>
            <p className="text-slate-500 text-xs leading-relaxed mt-4 font-sans font-medium">
              SentinelOps is architected around robust production paradigms. In a production containerized environment, the FastAPI agent uses the docker daemon interface directly, backed by Prometheus alerting rules.
            </p>
            
            <div className="mt-8 space-y-3">
              <div className="flex items-center space-x-2.5 text-xs text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                <span>Ollama / Local LLM Inference Isolation</span>
              </div>
              <div className="flex items-center space-x-2.5 text-xs text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                <span>Docker Socket Container Control Mounting</span>
              </div>
              <div className="flex items-center space-x-2.5 text-xs text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                <span>SQL Database Incident Log Persistence</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Observability */}
            <div className="bg-white border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-md transition-shadow p-5 rounded-2xl text-left flex space-x-4">
              <div className="p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl h-11 w-11 flex items-center justify-center shrink-0">
                <Radio className="h-5.5 w-5.5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Telemetry Stack</h4>
                <p className="text-slate-500 text-[11px] leading-relaxed mt-1">
                  Prometheus metrics gathering. Scrapes CPU, Memory, and Error thresholds from running microservices. Uses AlertManager webhooks for triggers.
                </p>
              </div>
            </div>

            {/* FastAPI */}
            <div className="bg-white border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-md transition-shadow p-5 rounded-2xl text-left flex space-x-4">
              <div className="p-3 bg-blue-50 border border-blue-100 text-blue-600 rounded-xl h-11 w-11 flex items-center justify-center shrink-0">
                <Server className="h-5.5 w-5.5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm">FastAPI SRE Gateway</h4>
                <p className="text-slate-500 text-[11px] leading-relaxed mt-1">
                  Exposes rest webhooks, coordinates docker environment instructions, hosts logs proxy endpoints, and runs SQLite database writes.
                </p>
              </div>
            </div>

            {/* Ollama */}
            <div className="bg-white border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-md transition-shadow p-5 rounded-2xl text-left flex space-x-4">
              <div className="p-3 bg-purple-50 border border-purple-100 text-purple-600 rounded-xl h-11 w-11 flex items-center justify-center shrink-0">
                <Cpu className="h-5.5 w-5.5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Local Reasoning Engine</h4>
                <p className="text-slate-500 text-[11px] leading-relaxed mt-1">
                  Processes telemetry variables using lightweight local LLMs (e.g. Qwen 2.5:3b or Llama 3) via Ollama. Ensures 100% data privacy and zero API key bills.
                </p>
              </div>
            </div>

            {/* Next.js UI */}
            <div className="bg-white border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-md transition-shadow p-5 rounded-2xl text-left flex space-x-4">
              <div className="p-3 bg-cyan-50 border border-cyan-200 text-cyan-600 rounded-xl h-11 w-11 flex items-center justify-center shrink-0">
                <Layout className="h-5.5 w-5.5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Operational Control Center</h4>
                <p className="text-slate-500 text-[11px] leading-relaxed mt-1">
                  A real-time reactive interface to monitor service status, trigger test outages, view the live agent reasoning loop, and download post-mortem logs.
                </p>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* Tech Stack Callout Banner */}
      <section className="px-8 py-16 bg-gradient-to-b from-transparent to-slate-50 w-full relative">
        <div className="max-w-[1000px] mx-auto bg-gradient-to-r from-blue-50 via-purple-50 to-blue-50 border border-blue-100 p-12 rounded-3xl text-center relative overflow-hidden shadow-sm">
          
          <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-blue-100/20 blur-3xl pointer-events-none rounded-full" />
          
          <h3 className="font-heading font-black text-2xl sm:text-3xl text-slate-800 uppercase mb-4">
            Ready to test autonomous infrastructure?
          </h3>
          <p className="text-slate-500 text-xs sm:text-sm max-w-xl mx-auto mb-8 font-sans font-medium">
            Deploy the services container cluster locally using the startup runscripts, trigger failure scenarios, and watch self-healing SRE in action.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-xs font-bold tracking-wider hover:-translate-y-0.5 transition-all shadow-lg shadow-blue-500/20"
            >
              Open Command Console
            </Link>
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3.5 border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-800 rounded-full text-xs font-bold tracking-wider transition-all shadow-sm bg-white"
            >
              View API Documentation
            </a>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 px-8 py-8 text-center text-xs text-slate-500 mt-auto font-sans">
        <div className="flex flex-col sm:flex-row items-center justify-between max-w-[1400px] mx-auto w-full gap-4">
          <div className="flex items-center space-x-2">
            <Activity className="h-4.5 w-4.5 text-blue-500" />
            <span className="font-bold text-slate-700">SentinelOps AI Agent</span>
            <span className="text-slate-300">|</span>
            <span>Open Source Hackathon Project</span>
          </div>
          <div className="flex items-center gap-4 text-slate-500">
            <span>Next.js 16</span>
            <span>FastAPI</span>
            <span>LangGraph</span>
            <span>Ollama</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
