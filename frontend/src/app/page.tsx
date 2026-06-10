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
  Clock
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

  const logsEndRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll logs terminal
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
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

  // Helper to format timestamps
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy": return "text-emerald-400 border-emerald-500 bg-emerald-950/20";
      case "unhealthy": return "text-red-400 border-red-500 bg-red-950/20";
      default: return "text-amber-500 border-amber-600 bg-amber-950/10";
    }
  };

  const getIncidentStatusBadge = (status: string) => {
    switch (status) {
      case "INVESTIGATING":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-md border border-purple-500 bg-purple-950/30 text-purple-400 animate-pulse">INVESTIGATING</span>;
      case "ROOT_CAUSE_FOUND":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-md border border-indigo-500 bg-indigo-950/30 text-indigo-400 animate-pulse">DIAGNOSING</span>;
      case "EXECUTING_FIX":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-md border border-amber-500 bg-amber-950/30 text-amber-400 animate-pulse">REMEDIATING</span>;
      case "VERIFYING":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-md border border-cyan-500 bg-cyan-950/30 text-cyan-400 animate-pulse">VERIFYING</span>;
      case "RESOLVED":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-md border border-emerald-500 bg-emerald-950/30 text-emerald-400">RESOLVED</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-md border border-red-500 bg-red-950/30 text-red-400">FAILED</span>;
    }
  };

  const getLogStyle = (level: string) => {
    switch (level) {
      case "AGENT_THOUGHT":
        return "text-cyan-300 italic font-mono";
      case "AGENT_ACTION":
        return "text-amber-400 font-semibold font-mono";
      case "AGENT_RESULT":
        return "text-slate-300 font-mono bg-slate-900/50 p-2 rounded border border-slate-800 my-1 block whitespace-pre-wrap text-xs";
      case "ERROR":
        return "text-red-400 font-semibold font-mono animate-pulse";
      case "WARNING":
        return "text-amber-500 font-mono";
      default:
        return "text-slate-400 font-mono";
    }
  };

  const selectedIncident = incidents.find(inc => inc.id === selectedIncidentId);
  const activeIncidentsCount = incidents.filter(inc => ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING"].includes(inc.status)).length;
  const clusterIsHealthy = Object.values(services).every(s => s.status === "healthy");

  const filteredIncidents = filterActive 
    ? incidents.filter(inc => ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING"].includes(inc.status))
    : incidents;

  return (
    <div className="flex-1 bg-[#090d16] text-slate-100 flex flex-col font-sans">
      
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-[#0c1220] px-6 py-4 flex items-center justify-between shadow-lg backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            <Activity className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center space-x-2">
              <span>SentinelOps AI</span>
              <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 uppercase tracking-widest font-mono">Autonomous SRE</span>
            </h1>
            <p className="text-xs text-slate-400">Monitoring & Remediation Control Center (Local LLM Development)</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Global Status Banner */}
          <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
            clusterIsHealthy 
              ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400" 
              : "bg-red-950/20 border-red-500/30 text-red-400 animate-pulse"
          }`}>
            <span className={`h-2 w-2 rounded-full ${clusterIsHealthy ? "bg-emerald-500" : "bg-red-500"} shadow`}></span>
            <span>CLUSTER STATE: {clusterIsHealthy ? "HEALTHY" : "ANOMALY DETECTED"}</span>
          </div>

          {/* Reset button */}
          <button
            onClick={clearAllFaults}
            disabled={clearingFaults}
            className="flex items-center space-x-2 px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 active:bg-slate-800 text-white disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${clearingFaults ? "animate-spin" : ""}`} />
            <span>{clearingFaults ? "Clearing Faults..." : "Reset Cluster Faults"}</span>
          </button>
        </div>
      </header>

      {/* Main Grid View */}
      <main className="flex-1 p-6 grid grid-cols-1 xl:grid-cols-12 gap-6 overflow-hidden max-w-[1800px] mx-auto w-full">
        
        {/* Column 1: Services Status & Fault Injectors (4 Columns) */}
        <section className="xl:col-span-4 flex flex-col space-y-6">
          <div className="bg-[#0c1220]/75 border border-slate-800 rounded-xl p-5 shadow-xl backdrop-blur">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center space-x-2">
              <Server className="h-4 w-4 text-indigo-400" />
              <span>Simulated Microservices</span>
            </h2>

            {loadingServices ? (
              <div className="py-10 text-center text-slate-500 flex flex-col items-center justify-center space-y-2">
                <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
                <span className="text-xs">Loading service topologies...</span>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.values(services).map((service) => (
                  <div 
                    key={service.name}
                    className="p-4 rounded-lg bg-[#0e172a] border border-slate-800 hover:border-slate-700 transition-all flex flex-col space-y-3"
                  >
                    {/* Header line */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Layers className="h-4 w-4 text-indigo-400" />
                        <span className="font-semibold text-sm text-white">{service.name}</span>
                      </div>
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${getStatusColor(service.status)}`}>
                        {service.status.toUpperCase()}
                      </span>
                    </div>

                    {/* Meters */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {/* CPU */}
                      <div className="flex flex-col space-y-1">
                        <span className="text-slate-400 flex items-center space-x-1">
                          <Cpu className="h-3 w-3 text-slate-500" />
                          <span>CPU</span>
                        </span>
                        <div className="flex items-center space-x-2">
                          <div className="flex-1 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${service.cpu > 0.8 ? "bg-red-500" : service.cpu > 0.4 ? "bg-amber-500" : "bg-emerald-500"}`}
                              style={{ width: `${Math.min(service.cpu * 100, 100)}%` }}
                            ></div>
                          </div>
                          <span className="font-mono font-semibold">{(service.cpu * 100).toFixed(0)}%</span>
                        </div>
                      </div>

                      {/* Memory */}
                      <div className="flex flex-col space-y-1">
                        <span className="text-slate-400 flex items-center space-x-1">
                          <HardDrive className="h-3 w-3 text-slate-500" />
                          <span>Memory</span>
                        </span>
                        <div className="flex items-center space-x-2">
                          <div className="flex-1 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${service.memory > 80 ? "bg-red-500 animate-pulse" : service.memory > 45 ? "bg-amber-500" : "bg-emerald-500"}`}
                              style={{ width: `${Math.min((service.memory / 120) * 100, 100)}%` }}
                            ></div>
                          </div>
                          <span className="font-mono font-semibold">{service.memory.toFixed(1)} MB</span>
                        </div>
                      </div>
                    </div>

                    {/* Injectors (Only show for services that support fault scenarios) */}
                    {["payment-service", "order-service", "api-gateway"].includes(service.name) && (
                      <div className="pt-2 border-t border-slate-800 flex flex-wrap gap-2">
                        {service.name === "payment-service" && (
                          <button
                            onClick={() => injectFault(service.name, "memory-leak")}
                            disabled={injectingFault !== null || service.status === "offline"}
                            className="flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:text-white border border-red-500/30 hover:bg-red-600/20 active:bg-red-600/30 rounded transition-colors disabled:opacity-50"
                          >
                            <HardDrive className="h-3 w-3" />
                            <span>{injectingFault === `${service.name}-memory-leak` ? "Injecting..." : "Leak Memory"}</span>
                          </button>
                        )}
                        {service.name === "order-service" && (
                          <button
                            onClick={() => injectFault(service.name, "cpu-spike")}
                            disabled={injectingFault !== null || service.status === "offline"}
                            className="flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-amber-400 hover:text-white border border-amber-500/30 hover:bg-amber-600/20 active:bg-amber-600/30 rounded transition-colors disabled:opacity-50"
                          >
                            <Cpu className="h-3 w-3" />
                            <span>{injectingFault === `${service.name}-cpu-spike` ? "Injecting..." : "Spike CPU"}</span>
                          </button>
                        )}
                        <button
                          onClick={() => injectFault(service.name, "error-spike")}
                          disabled={injectingFault !== null || service.status === "offline"}
                          className="flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:text-white border border-rose-500/30 hover:bg-rose-600/20 active:bg-rose-600/30 rounded transition-colors disabled:opacity-50"
                        >
                          <Flame className="h-3 w-3" />
                          <span>{injectingFault === `${service.name}-error-spike` ? "Injecting..." : "Inject 500s"}</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Column 2: Incidents List (4 Columns) */}
        <section className="xl:col-span-4 flex flex-col space-y-6">
          <div className="bg-[#0c1220]/75 border border-slate-800 rounded-xl p-5 shadow-xl backdrop-blur flex flex-col h-full max-h-[85vh]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span>Incident Feed ({incidents.length})</span>
              </h2>
              <button 
                onClick={() => setFilterActive(!filterActive)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  filterActive 
                    ? "bg-indigo-600 border-indigo-500 text-white" 
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white"
                }`}
              >
                {filterActive ? "Show Resolved" : "Filter Active"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {filteredIncidents.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-slate-500 text-center space-y-2 border border-dashed border-slate-800 rounded-lg">
                  <CheckCircle className="h-8 w-8 text-emerald-500/70" />
                  <span className="text-xs">No incidents logged. Everything is stable.</span>
                </div>
              ) : (
                filteredIncidents.map((incident) => {
                  const isSelected = incident.id === selectedIncidentId;
                  const isActive = ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING"].includes(incident.status);
                  return (
                    <div
                      key={incident.id}
                      onClick={() => setSelectedIncidentId(incident.id)}
                      className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col space-y-2.5 ${
                        isSelected 
                          ? "bg-slate-900 border-indigo-500/80 shadow-md shadow-indigo-500/5" 
                          : "bg-[#0e172a] border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-300">{incident.id}</span>
                        {getIncidentStatusBadge(incident.status)}
                      </div>

                      <div>
                        <h4 className="font-semibold text-xs text-white">
                          Alert: {incident.alert_name}
                        </h4>
                        <div className="text-slate-400 text-[11px] mt-0.5 flex items-center space-x-1">
                          <span>Service:</span>
                          <span className="font-mono text-slate-300 font-semibold">{incident.service}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[10px] text-slate-500">
                        <span className="flex items-center space-x-1">
                          <Clock className="h-3 w-3" />
                          <span>{formatTime(incident.created_at)}</span>
                        </span>
                        {incident.resolution_time_seconds && (
                          <span>MTTR: {incident.resolution_time_seconds.toFixed(0)}s</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* Column 3: Live Agent Operations Terminal (4 Columns) */}
        <section className="xl:col-span-4 flex flex-col space-y-6">
          <div className="bg-[#0c1220]/75 border border-slate-800 rounded-xl p-5 shadow-xl backdrop-blur flex flex-col h-full max-h-[85vh]">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center space-x-2 border-b border-slate-800 pb-3">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <span>SRE Agent Console</span>
            </h2>

            {selectedIncident ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Selected incident info header */}
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs space-y-2 mb-4">
                  <div className="grid grid-cols-2 gap-2 text-slate-400">
                    <div>Incident: <span className="font-mono text-white">{selectedIncident.id}</span></div>
                    <div>Status: <span className="text-white font-semibold">{selectedIncident.status}</span></div>
                    <div>Service: <span className="font-mono text-white">{selectedIncident.service}</span></div>
                    {selectedIncident.resolution_time_seconds && (
                      <div>Time to Resolve: <span className="text-white font-semibold">{selectedIncident.resolution_time_seconds}s</span></div>
                    )}
                  </div>
                  {selectedIncident.root_cause && (
                    <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-300">
                      <strong className="text-slate-400">Diagnosed Root Cause:</strong><br />
                      {selectedIncident.root_cause}
                    </div>
                  )}
                </div>

                {/* Console Terminal Log */}
                <div className="flex-1 bg-black/90 rounded-lg border border-slate-900 p-4 font-mono text-xs overflow-y-auto flex flex-col space-y-2.5 relative shadow-inner">
                  {logs.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-600 text-center italic">
                      Initializing SRE reasoning loop connection...
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="leading-relaxed whitespace-pre-wrap">
                        <span className="text-slate-500 mr-2 text-[10px]">{formatTime(log.timestamp)}</span>
                        <span className={getLogStyle(log.level)}>{log.message}</span>
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>

                {/* Post Mortem Document Download section */}
                {selectedIncident.resolution_action && (
                  <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-xs text-emerald-400 flex items-center space-x-1">
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>Post-Mortem Compiled</span>
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
                      className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-600 text-white transition-colors"
                    >
                      <Download className="h-3 w-3" />
                      <span>Download Report</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 space-y-3 border border-dashed border-slate-800 rounded-lg">
                <Terminal className="h-10 w-10 text-slate-700 animate-pulse" />
                <div>
                  <h3 className="font-semibold text-sm text-slate-400">Terminal Deconnected</h3>
                  <p className="text-xs max-w-[200px] mt-1">Select an incident from the feed to hook into the live agent operations log.</p>
                </div>
              </div>
            )}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#070b13] px-6 py-4 text-center text-xs text-slate-500 mt-auto">
        <div className="flex items-center justify-between max-w-[1800px] mx-auto w-full">
          <div>SentinelOps Agent SRE Framework | Local LLM development</div>
          <div>Version 1.0.0 (Ollama: qwen2.5:3b)</div>
        </div>
      </footer>

    </div>
  );
}
