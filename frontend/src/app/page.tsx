"use client";

import { useEffect, useState, useRef } from "react";
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
  Trash2, 
  ArrowRight,
  Download,
  AlertOctagon,
  Clock,
  Shield,
  Target,
  Zap,
  Menu,
  ChevronRight,
  ExternalLink,
  User,
  Rocket,
  Settings
} from "lucide-react";

// Get API base URL
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ServiceMetric {
  name: string;
  status: "healthy" | "unhealthy" | "offline";
  cpu: number; // ratio
  memory: number; // MB
  faults_injected: boolean;
}

interface Incident {
  id: string;
  service: string;
  alert_name: string;
  status: "INVESTIGATING" | "ROOT_CAUSE_FOUND" | "EXECUTING_FIX" | "VERIFYING" | "RESOLVED" | "FAILED";
  severity: string;
  root_cause?: string;
  confidence?: number;           // 0-100 from RCA
  risk_level?: string;           // LOW / MEDIUM / HIGH
  evidence?: string;             // JSON string: list of evidence items
  affected_services?: string;    // JSON string: list of service names
  reasoning_summary?: string;    // LLM reasoning narrative
  resolution_action?: string;
  resolution_time_seconds?: number;
  created_at: string;
  updated_at: string;
}

interface IncidentLog {
  id: number;
  incident_id: string;
  timestamp: string;
  level: "INFO" | "WARNING" | "ERROR" | "AGENT_THOUGHT" | "AGENT_ACTION" | "AGENT_RESULT";
  message: string;
}

export default function Home() {
  const [services, setServices] = useState<Record<string, ServiceMetric>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [logs, setLogs] = useState<IncidentLog[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [injectingFault, setInjectingFault] = useState<string | null>(null);
  const [clearingFaults, setClearingFaults] = useState(false);
  const [filterActive, setFilterActive] = useState(false);

  const consoleRef = useRef<HTMLDivElement>(null);

  // Poll service status and incident list
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch services status
        const sRes = await fetch(`${API_URL}/api/v1/simulation/status`);
        if (sRes.ok) {
          const data = await sRes.json();
          setServices(data);
        }
        setLoadingServices(false);

        // Fetch incidents list
        const iRes = await fetch(`${API_URL}/api/v1/incidents`);
        if (iRes.ok) {
          const data = await iRes.json();
          setIncidents(data);
          
          // Auto-select latest active incident if none selected
          if (!selectedIncidentId && data.length > 0) {
            const activeIncident = data.find((inc: Incident) => 
              ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING"].includes(inc.status)
            );
            if (activeIncident) {
              setSelectedIncidentId(activeIncident.id);
            } else {
              setSelectedIncidentId(data[0].id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [selectedIncidentId]);

  // Poll logs when an incident is selected
  useEffect(() => {
    if (!selectedIncidentId) {
      setLogs([]);
      return;
    }

    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/incidents/${selectedIncidentId}/logs`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data);
        }
      } catch (err) {
        console.error("Failed to fetch logs:", err);
      }
    };

    fetchLogs();
    const logInterval = setInterval(fetchLogs, 1500);
    return () => clearInterval(logInterval);
  }, [selectedIncidentId]);

  // Auto-scroll logs terminal container only (does not scroll the main window)
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  // Inject a fault
  const injectFault = async (service: string, fault: string) => {
    const key = `${service}-${fault}`;
    setInjectingFault(key);
    try {
      const res = await fetch(`${API_URL}/api/v1/simulation/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, fault })
      });
      if (res.ok) {
        console.log(`Fault ${fault} injected into ${service}`);
      }
    } catch (err) {
      console.error("Fault injection failed:", err);
    } finally {
      setInjectingFault(null);
    }
  };

  // Clear all faults
  const clearAllFaults = async () => {
    setClearingFaults(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/simulation/clear`, {
        method: "POST"
      });
      if (res.ok) {
        console.log("All faults cleared.");
      }
    } catch (err) {
      console.error("Failed to clear faults:", err);
    } finally {
      setClearingFaults(false);
    }
  };

  // Trigger demo simulation and scroll down
  const startDemo = async () => {
    // Auto inject memory leak to payment-service to spin up the SRE flow
    await injectFault("payment-service", "memory-leak");
    
    // Smooth scroll to operations center
    const opsCenter = document.getElementById("ops-center");
    if (opsCenter) {
      opsCenter.scrollIntoView({ behavior: "smooth" });
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Helper to format timestamps
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  };

  // Parse JSON string fields from the backend
  const parseJsonField = (jsonStr?: string): string[] => {
    if (!jsonStr) return [];
    try {
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const getRiskColor = (risk?: string) => {
    switch (risk?.toUpperCase()) {
      case "HIGH": return { border: "border-red-200", bg: "bg-red-50", text: "text-red-600" };
      case "MEDIUM": return { border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-700" };
      case "LOW": return { border: "border-emerald-200", bg: "bg-emerald-50", text: "text-emerald-700" };
      default: return { border: "border-slate-200", bg: "bg-slate-50", text: "text-slate-600" };
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy": return "text-emerald-600 border-emerald-100 bg-emerald-50";
      case "unhealthy": return "text-red-600 border-red-100 bg-red-50";
      default: return "text-slate-500 border-slate-100 bg-slate-50";
    }
  };

  const getIncidentStatusBadge = (status: string) => {
    switch (status) {
      case "INVESTIGATING":
        return <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border border-purple-200 bg-purple-50 text-purple-600 animate-pulse">INVESTIGATING</span>;
      case "ROOT_CAUSE_FOUND":
        return <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border border-indigo-200 bg-indigo-50 text-indigo-600 animate-pulse">DIAGNOSING</span>;
      case "EXECUTING_FIX":
        return <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border border-amber-200 bg-amber-50 text-amber-600 animate-pulse">REMEDIATING</span>;
      case "VERIFYING":
        return <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border border-cyan-200 bg-cyan-50 text-cyan-600 animate-pulse">VERIFYING</span>;
      case "RESOLVED":
        return <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border border-emerald-200 bg-emerald-50 text-emerald-600">RESOLVED</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border border-red-200 bg-red-50 text-red-600">FAILED</span>;
    }
  };

  const getLogStyle = (level: string) => {
    switch (level) {
      case "AGENT_THOUGHT":
        return "text-cyan-300 italic font-mono";
      case "AGENT_ACTION":
        return "text-amber-400 font-semibold font-mono";
      case "AGENT_RESULT":
        return "text-slate-300 font-mono bg-slate-900/60 p-2.5 rounded border border-slate-800 my-1.5 block whitespace-pre-wrap text-[11px]";
      case "ERROR":
        return "text-red-400 font-semibold font-mono animate-pulse";
      case "WARNING":
        return "text-amber-400 font-mono";
      default:
        return "text-slate-300 font-mono";
    }
  };

  const selectedIncident = incidents.find(inc => inc.id === selectedIncidentId);
  const activeIncidentsCount = incidents.filter(inc => ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING"].includes(inc.status)).length;
  const clusterIsHealthy = Object.values(services).every(s => s.status === "healthy");

  const filteredIncidents = filterActive 
    ? incidents.filter(inc => ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING"].includes(inc.status))
    : incidents;

  return (
    <div className="relative min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans overflow-x-hidden">
      
      {/* Decorative Background Shapes matching the template */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-blue-100/30 via-cyan-50/20 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-[-100px] right-[-100px] w-[450px] h-[450px] rounded-full bg-gradient-to-br from-[#0942e6] to-[#0033cc] opacity-[0.95] pointer-events-none -z-10 shadow-2xl" />
      <div className="absolute top-[35%] right-[-150px] w-[350px] h-[350px] rounded-full border-[45px] border-[#00d2d3]/25 pointer-events-none -z-10" />
      <div className="absolute bottom-[20%] left-[-150px] w-[450px] h-[450px] rounded-full bg-cyan-100/30 blur-3xl pointer-events-none -z-10" />

      {/* Top Navbar */}
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

        {/* Center menu navigation links from the template */}
        <nav className="hidden md:flex space-x-8 text-xs font-bold tracking-wider text-slate-500 font-sans">
          <a href="#" className="hover:text-blue-600 transition-colors uppercase">Dashboard</a>
          <a href="#ops-center" className="hover:text-blue-600 transition-colors uppercase">Operations Center</a>
          <a href="#capabilities" className="hover:text-blue-600 transition-colors uppercase">Capabilities</a>
          <a href="http://localhost:8000/docs" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors uppercase flex items-center gap-1">
            <span>API Docs</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </nav>

        <div className="flex items-center space-x-4">
          {/* Reset button styled as the outline nav button in the template */}
          <button
            onClick={clearAllFaults}
            disabled={clearingFaults}
            className="flex items-center space-x-1.5 px-5 py-2 text-xs font-bold tracking-wider border-2 border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white rounded-full transition-all duration-200 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${clearingFaults ? "animate-spin" : ""}`} />
            <span>{clearingFaults ? "Clearing..." : "Reset Cluster"}</span>
          </button>
          
          <div className="p-2 rounded-full hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer">
            <User className="h-4.5 w-4.5" />
          </div>
        </div>
      </header>

      {/* Hero Section & Generated Vector SRE Graphic */}
      <section className="px-8 py-12 md:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center max-w-[1400px] mx-auto w-full">
        
        {/* Left Side: Copywriter Hero */}
        <div className="lg:col-span-5 flex flex-col items-start text-left">
          <h2 className="text-slate-900 font-heading font-extrabold text-3xl sm:text-4xl lg:text-[44px] leading-[1.15] tracking-tight uppercase mb-6">
            You can access all your <span className="gradient-text">service telemetry</span> in one place
          </h2>
          <p className="text-slate-500 text-sm sm:text-base mb-8 leading-relaxed max-w-lg font-sans font-medium">
            A fully autonomous, self-healing Site Reliability Engineering agent. It monitors logs and metrics, runs cognitive root cause analysis, executes Docker runbooks, and verifies restoration.
          </p>
          <button
            onClick={startDemo}
            className="gradient-btn text-white px-8 py-3.5 rounded-full text-xs font-bold tracking-wider hover:opacity-90 active:scale-95 transition-all cursor-pointer"
          >
            Get Started
          </button>
        </div>

        {/* Right Side: Generated Vector Illustration with floating tech elements */}
        <div className="lg:col-span-7 w-full flex justify-center lg:justify-end relative">
          <div className="relative rounded-2xl border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.06)] bg-white overflow-hidden p-2 transition-all hover:scale-[1.01] duration-300 w-full max-w-[580px]">
            <img 
              src="/sre_hero.png" 
              alt="SentinelOps Autonomous SRE Illustration" 
              className="w-full h-auto object-cover rounded-xl"
            />
            
            {/* Floating Organic Badges overlapping the image */}
            <div className="absolute top-6 left-6 px-4 py-2.5 rounded-xl bg-white/95 border border-slate-100/80 shadow-md flex items-center space-x-2.5 backdrop-blur-md">
              <Activity className="h-5 w-5 text-blue-600 animate-pulse" />
              <div className="text-left">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Self-Healing</div>
                <div className="text-xs font-heading font-black text-slate-800">Agent Active</div>
              </div>
            </div>
            
            <div className="absolute bottom-6 right-6 px-4 py-2.5 rounded-xl bg-white/95 border border-slate-100/80 shadow-md flex items-center space-x-2.5 backdrop-blur-md">
              <Cpu className="h-5 w-5 text-purple-600 animate-pulse" />
              <div className="text-left">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Cognitive Engine</div>
                <div className="text-xs font-heading font-black text-slate-800">Qwen2.5 (3B)</div>
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* SRE Operations Center (Unified Dashboard Panels Together) */}
      <section id="ops-center" className="px-8 py-12 max-w-[1400px] mx-auto w-full">
        
        <div className="mb-8 text-center md:text-left">
          <h2 className="text-xs uppercase tracking-widest font-black text-blue-600 mb-2">Operations Center</h2>
          <h3 className="font-heading font-black text-slate-800 text-3xl">Autonomous SRE Command Console</h3>
          <p className="text-slate-500 text-sm mt-2 max-w-xl">
            A unified cockpit integrating telemetry meters, active incident feeds, and the live agent reasoning loop. Trigger faults on the left to activate self-healing.
          </p>
        </div>

        {/* Unified 3-panel Dashboard Layout */}
        <div className="bg-white border border-slate-100 shadow-[0_15px_50px_rgba(0,0,0,0.03)] rounded-2xl overflow-hidden flex flex-col lg:flex-row lg:h-[650px] w-full divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
          
          {/* Panel 1: Simulated Microservices (w-full lg:w-[35%]) */}
          <div className="w-full lg:w-[35%] flex flex-col h-[500px] lg:h-full overflow-hidden bg-slate-50/10">
            <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5">
                <Server className="h-4 w-4 text-blue-600" />
                <span>Telemetry & Fault Injector</span>
              </h4>
              <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold tracking-wide ${
                clusterIsHealthy 
                  ? "bg-emerald-50 border-emerald-100 text-emerald-600" 
                  : "bg-red-50 border-red-100 text-red-600 animate-pulse"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${clusterIsHealthy ? "bg-emerald-500" : "bg-red-500"}`}></span>
                <span>{clusterIsHealthy ? "HEALTHY" : "ANOMALY"}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {loadingServices ? (
                <div className="h-full flex flex-col items-center justify-center space-y-2">
                  <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
                  <span className="text-[11px] text-slate-400">Querying cluster...</span>
                </div>
              ) : (
                Object.values(services).map((service) => (
                  <div 
                    key={service.name}
                    className="p-3.5 bg-white border border-slate-100 rounded-xl shadow-[0_3px_8px_rgba(0,0,0,0.01)] hover:shadow-md transition-all flex flex-col space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-800">{service.name}</span>
                      <span className={`px-1.5 py-0.5 text-[9px] font-bold tracking-wider rounded border ${getStatusColor(service.status)}`}>
                        {service.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-[10px]">
                      <div className="flex flex-col space-y-0.5">
                        <div className="flex justify-between text-slate-400 text-[9px]">
                          <span>CPU</span>
                          <span className="font-mono font-bold text-slate-600">{(service.cpu * 100).toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${service.cpu > 0.8 ? "bg-red-500" : service.cpu > 0.4 ? "bg-amber-500" : "bg-blue-600"}`}
                            style={{ width: `${Math.min(service.cpu * 100, 100)}%` }}
                          ></div>
                        </div>
                      </div>

                      <div className="flex flex-col space-y-0.5">
                        <div className="flex justify-between text-slate-400 text-[9px]">
                          <span>MEMORY</span>
                          <span className="font-mono font-bold text-slate-600">{service.memory.toFixed(0)} MB</span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${service.memory > 80 ? "bg-red-500 animate-pulse" : service.memory > 45 ? "bg-amber-500" : "bg-blue-600"}`}
                            style={{ width: `${Math.min((service.memory / 120) * 100, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {["payment-service", "order-service", "api-gateway"].includes(service.name) && (
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 flex-wrap">
                        {service.name === "payment-service" && (
                          <button
                            onClick={() => injectFault(service.name, "memory-leak")}
                            disabled={injectingFault !== null || service.status === "offline"}
                            className="px-2.5 py-0.5 text-[9px] font-bold text-red-500 hover:text-white border border-red-500/25 hover:bg-red-500 active:bg-red-600 rounded-full transition-all duration-150 disabled:opacity-40"
                          >
                            {injectingFault === `${service.name}-memory-leak` ? "Leaking..." : "Leak Mem"}
                          </button>
                        )}
                        {service.name === "order-service" && (
                          <button
                            onClick={() => injectFault(service.name, "cpu-spike")}
                            disabled={injectingFault !== null || service.status === "offline"}
                            className="px-2.5 py-0.5 text-[9px] font-bold text-amber-600 hover:text-white border border-amber-500/25 hover:bg-amber-500 active:bg-amber-600 rounded-full transition-all duration-150 disabled:opacity-40"
                          >
                            {injectingFault === `${service.name}-cpu-spike` ? "Spiking..." : "Spike CPU"}
                          </button>
                        )}
                        <button
                          onClick={() => injectFault(service.name, "error-spike")}
                          disabled={injectingFault !== null || service.status === "offline"}
                          className="px-2.5 py-0.5 text-[9px] font-bold text-rose-500 hover:text-white border border-rose-500/25 hover:bg-rose-500 active:bg-[#f43f5e] rounded-full transition-all duration-150 disabled:opacity-40"
                        >
                          {injectingFault === `${service.name}-error-spike` ? "Injecting..." : "Fail HTTP"}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Panel 2: Incident Feed (w-full lg:w-[25%]) */}
          <div className="w-full lg:w-[25%] flex flex-col h-[400px] lg:h-full overflow-hidden bg-white">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span>Incident Feed</span>
              </h4>
              <button 
                onClick={() => setFilterActive(!filterActive)}
                className={`text-[9px] px-2.5 py-1 rounded-full border-2 font-bold tracking-wider uppercase transition-colors cursor-pointer ${
                  filterActive 
                    ? "bg-blue-600 border-blue-600 text-white" 
                    : "bg-transparent border-slate-200 text-slate-500 hover:text-slate-700"
                }`}
              >
                {filterActive ? "Resolved" : "Active Only"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {filteredIncidents.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-center space-y-2 border border-dashed border-slate-200 rounded-xl">
                  <CheckCircle className="h-7 w-7 text-emerald-500 animate-pulse" />
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">System Stable</span>
                </div>
              ) : (
                filteredIncidents.map((incident) => {
                  const isSelected = incident.id === selectedIncidentId;
                  return (
                    <div
                      key={incident.id}
                      onClick={() => setSelectedIncidentId(incident.id)}
                      className={`p-4 rounded-xl border text-left cursor-pointer transition-all flex flex-col space-y-2.5 relative overflow-hidden ${
                        isSelected 
                          ? "bg-blue-50/20 border-blue-600/30 shadow-[0_4px_12px_rgba(9,66,230,0.03)]" 
                          : "bg-slate-50/30 border-slate-100 hover:border-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold text-slate-500">{incident.id}</span>
                        {getIncidentStatusBadge(incident.status)}
                      </div>

                      <div>
                        <h4 className="font-bold text-xs text-slate-800">
                          {incident.alert_name}
                        </h4>
                        <div className="text-slate-400 text-[9px] mt-0.5 flex items-center space-x-1">
                          <span>Target:</span>
                          <span className="font-mono text-slate-700 font-semibold">{incident.service}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[9px] text-slate-400">
                        <span className="flex items-center space-x-1">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{formatTime(incident.created_at)}</span>
                        </span>
                        {incident.resolution_time_seconds && (
                          <span className="font-mono font-bold text-slate-600">MTTR: {incident.resolution_time_seconds.toFixed(0)}s</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Panel 3: SRE Agent Console Terminal (w-full lg:w-[40%]) */}
          <div className="w-full lg:w-[40%] flex flex-col h-[500px] lg:h-full overflow-hidden bg-slate-50/10">
            <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5">
                <Terminal className="h-4 w-4 text-slate-600" />
                <span>SRE Agent Log & Reports</span>
              </h4>
            </div>

            {selectedIncident ? (
              <div className="flex-1 flex flex-col p-4 overflow-hidden space-y-3">
                {/* Meta details dashboard inside Panel 3 */}
                <div className="p-3 bg-white border border-slate-100 rounded-xl text-[10px] space-y-2.5 flex flex-col shadow-[0_4px_12px_rgba(0,0,0,0.01)] shrink-0">
                  <div className="grid grid-cols-2 gap-1.5 text-slate-500 font-medium">
                    <div>ID: <span className="font-mono font-bold text-slate-800">{selectedIncident.id}</span></div>
                    <div>Status: <span className="font-bold text-slate-800">{selectedIncident.status}</span></div>
                    <div>Target: <span className="font-mono font-bold text-slate-800">{selectedIncident.service}</span></div>
                    {selectedIncident.resolution_time_seconds && (
                      <div>MTTR: <span className="font-bold text-slate-800">{selectedIncident.resolution_time_seconds}s</span></div>
                    )}
                  </div>

                  {/* Confidence & Risk */}
                  {(selectedIncident.confidence !== undefined && selectedIncident.confidence !== null) && (
                    <div className="pt-2 border-t border-slate-100 flex items-center gap-3 justify-between">
                      <div className="flex items-center gap-1.5 flex-grow max-w-[70%]">
                        <Target className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                        <span className="text-slate-400 text-[9px] uppercase tracking-wider font-semibold shrink-0">Confidence</span>
                        <div className="flex-grow bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              selectedIncident.confidence >= 80 ? "bg-emerald-500" :
                              selectedIncident.confidence >= 50 ? "bg-amber-500" : "bg-red-500"
                            }`}
                            style={{ width: `${Math.min(selectedIncident.confidence, 100)}%` }}
                          ></div>
                        </div>
                        <span className="font-mono text-slate-800 font-bold text-[9px] shrink-0">{selectedIncident.confidence}%</span>
                      </div>

                      {selectedIncident.risk_level && (() => {
                        const rc = getRiskColor(selectedIncident.risk_level);
                        return (
                          <div className={`flex items-center gap-0.5 px-2 py-0.5 rounded border ${rc.border} ${rc.bg} shrink-0`}>
                            <Shield className={`h-3 w-3 ${rc.text}`} />
                            <span className={`font-bold text-[8px] uppercase tracking-wider ${rc.text}`}>{selectedIncident.risk_level}</span>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Evidence & Blast Radius */}
                  {(() => {
                    const evidenceItems = parseJsonField(selectedIncident.evidence);
                    const affectedItems = parseJsonField(selectedIncident.affected_services);
                    return (evidenceItems.length > 0 || affectedItems.length > 0) ? (
                      <div className="pt-2 border-t border-slate-100 flex flex-col space-y-1.5">
                        {evidenceItems.length > 0 && (
                          <div>
                            <div className="text-[8px] font-bold uppercase tracking-wider text-slate-400 mb-0.5 flex items-center gap-1">
                              <Zap className="h-3 w-3 text-amber-500" />
                              Evidence
                            </div>
                            <ul className="space-y-0.5 pl-0.5">
                              {evidenceItems.map((e, i) => (
                                <li key={i} className="text-[9px] text-slate-600 pl-3 relative before:content-['▸'] before:absolute before:left-0 before:text-blue-500">{e}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {affectedItems.length > 0 && (
                          <div>
                            <div className="text-[8px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                              Blast Radius
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {affectedItems.map((svc, i) => (
                                <span key={i} className="px-1.5 py-0.5 text-[8px] font-mono rounded border border-slate-100 bg-slate-50 text-slate-600 shadow-sm">{svc}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null;
                  })()}

                  {selectedIncident.root_cause && (
                    <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-600">
                      <strong className="text-slate-400 uppercase tracking-wider text-[8px] block mb-0.5">Root Cause</strong>
                      {selectedIncident.root_cause}
                    </div>
                  )}
                </div>

                {/* Console Output */}
                <div ref={consoleRef} className="flex-grow bg-[#0c1020] rounded-xl p-4 font-mono text-[11px] overflow-y-auto flex flex-col space-y-2 relative shadow-inner">
                  {logs.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-500 text-center italic">
                      Idle... select an incident to stream agent timeline.
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="leading-relaxed whitespace-pre-wrap">
                        <span className="text-slate-500 mr-2 text-[9px]">{formatTime(log.timestamp)}</span>
                        <span className={getLogStyle(log.level)}>{log.message}</span>
                      </div>
                    ))
                  )}
                </div>

                {/* Markdown post-mortem downloader */}
                {selectedIncident.resolution_action && (
                  <div className="pt-2 border-t border-slate-200/60 flex justify-between items-center shrink-0">
                    <span className="text-[10px] text-emerald-600 font-bold flex items-center space-x-1">
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>Report Compiled</span>
                    </span>
                    <button
                      onClick={() => {
                        const element = document.createElement("a");
                        const file = new Blob([selectedIncident.resolution_action || ""], {type: 'text/markdown'});
                        element.href = URL.createObjectURL(file);
                        element.download = `PostMortem-${selectedIncident.id}.md`;
                        document.body.appendChild(element);
                        element.click();
                        document.body.removeChild(element);
                      }}
                      className="flex items-center space-x-1 px-3 py-1.5 text-[10px] font-bold rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/10 active:scale-95 transition-all cursor-pointer"
                    >
                      <Download className="h-3 w-3" />
                      <span>Download Report</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-grow flex flex-col items-center justify-center text-center text-slate-400 space-y-3 p-10">
                <Terminal className="h-9 w-9 text-slate-300 animate-pulse" />
                <div>
                  <h3 className="font-bold text-xs text-slate-500">Terminal Offline</h3>
                  <p className="text-[10px] max-w-[200px] mt-1 text-slate-400">Select an incident from the feed to connect into SRE logs.</p>
                </div>
              </div>
            )}
          </div>

        </div>

      </section>

      {/* SRE Capabilities Section (Matching "Our Top Benefits") */}
      <section id="capabilities" className="bg-white/50 border-y border-slate-100/80 px-8 py-16 w-full">
        <div className="max-w-[1400px] mx-auto text-center mb-16">
          <h2 className="text-xs uppercase tracking-widest font-black text-blue-600 mb-2">Our SRE Capabilities</h2>
          <h3 className="font-heading font-black text-slate-800 text-3xl">Auto-Healing Operations Engine</h3>
          <p className="text-slate-500 text-sm mt-3 max-w-lg mx-auto">SentinelOps monitors, resolves, and documents incidents dynamically without developer interventions.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-[1400px] mx-auto w-full px-4">
          
          {/* Card 1: Automatic Remediation */}
          <div className="relative bg-white border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.03)] rounded-2xl pl-10 pr-6 py-7 flex items-start text-left">
            {/* Circular badge overlapping left edge */}
            <div className="absolute -left-7 top-1/2 transform -translate-y-1/2 w-14 h-14 rounded-full flex items-center justify-center bg-[#00decb] text-white shadow-lg pulse-glow">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-heading font-bold text-slate-800 text-lg mb-2">Automatic Remediation</h4>
              <p className="text-slate-500 text-xs leading-relaxed font-sans font-medium">
                SentinelOps evaluates firing alerts and automatically runs targeted SRE runbooks like service restarts, configuration rollbacks, and capacity scaling.
              </p>
            </div>
          </div>

          {/* Card 2: Cognitive RCA */}
          <div className="relative bg-white border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.03)] rounded-2xl pl-10 pr-6 py-7 flex items-start text-left">
            {/* Circular badge overlapping left edge */}
            <div className="absolute -left-7 top-1/2 transform -translate-y-1/2 w-14 h-14 rounded-full flex items-center justify-center bg-[#8b5cf6] text-white shadow-lg pulse-glow">
              <Cpu className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-heading font-bold text-slate-800 text-lg mb-2">Make Better Decision</h4>
              <p className="text-slate-500 text-xs leading-relaxed font-sans font-medium">
                Uses local LLM reasoning loops to investigate container stdout logs, health checks, and Prometheus metrics to pinpoint root causes.
              </p>
            </div>
          </div>

          {/* Card 3: Spectacular Dashboard */}
          <div className="relative bg-white border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.03)] rounded-2xl pl-10 pr-6 py-7 flex items-start text-left">
            {/* Circular badge overlapping left edge */}
            <div className="absolute -left-7 top-1/2 transform -translate-y-1/2 w-14 h-14 rounded-full flex items-center justify-center bg-[#0942e6] text-white shadow-lg pulse-glow">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-heading font-bold text-slate-800 text-lg mb-2">Spectacular Dashboard</h4>
              <p className="text-slate-500 text-xs leading-relaxed font-sans font-medium">
                Renders microservice status widgets, streams live agent diagnostics logs, resolves metrics warnings, and auto-compiles detailed Markdown post-mortems.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 px-8 py-6 text-center text-xs text-slate-400 mt-auto font-sans">
        <div className="flex flex-col sm:flex-row items-center justify-between max-w-[1400px] mx-auto w-full gap-4">
          <div>SentinelOps Agent SRE Framework | Local LLM Development</div>
          <div className="flex items-center gap-2">
            <span>Version 1.0.0</span>
            <span className="text-slate-300">|</span>
            <span>Ollama: qwen2.5:3b</span>
          </div>
        </div>
      </footer>

      {/* Floating Rocket scroll-to-top button from template */}
      <div 
        onClick={scrollToTop}
        className="fixed bottom-6 right-6 w-11 h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center cursor-pointer hover:shadow-xl active:scale-90 z-50 group"
      >
        <Rocket className="h-5 w-5 transform -rotate-45 group-hover:-translate-y-0.5 transition-transform" />
      </div>

    </div>
  );
}
