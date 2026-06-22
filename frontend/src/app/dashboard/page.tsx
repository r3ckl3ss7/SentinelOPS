"use client";

import { useEffect, useState, useRef } from "react";
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
  status: "INVESTIGATING" | "ROOT_CAUSE_FOUND" | "EXECUTING_FIX" | "VERIFYING" | "PENDING_APPROVAL" | "RESOLVED" | "FAILED";
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

// Seeding initial metrics to make history trends look beautiful instantly
const seedHistory = (currentVal: number, isCpu: boolean): number[] => {
  const samples: number[] = [];
  const count = 25;
  const stdDev = isCpu ? 0.04 : 3.0;
  for (let i = 0; i < count; i++) {
    const noise = (Math.random() + Math.random() + Math.random() - 1.5) * stdDev;
    const val = Math.max(0, currentVal + noise);
    samples.push(isCpu ? Math.min(1, val) : val);
  }
  return samples;
};

interface KdeChartProps {
  samples: number[];
  minVal: number;
  maxVal: number;
  label: string;
  colorClass: string;
  gradientId: string;
  valueSuffix: string;
  formatter: (v: number) => string;
}

function KdeChart({ samples, minVal, maxVal, label, colorClass, gradientId, valueSuffix, formatter }: KdeChartProps) {
  if (!samples || samples.length < 2) return null;

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const n = samples.length;
  const isCpu = maxVal <= 1.5;

  const width = 360;
  const height = 120;
  const paddingBottom = 15;
  const chartHeight = height - paddingBottom;

  const getY = (val: number) => {
    const clampedVal = Math.max(minVal, Math.min(maxVal, val));
    return chartHeight - ((clampedVal - minVal) / (maxVal - minVal)) * (chartHeight - 6);
  };

  let areaD = `M 0 ${chartHeight}`;
  let lineD = "";

  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * width;
    const y = getY(samples[i]);
    areaD += ` L ${x} ${y}`;
    if (i === 0) {
      lineD = `M ${x} ${y}`;
    } else {
      lineD += ` L ${x} ${y}`;
    }
  }
  areaD += ` L ${width} ${chartHeight} Z`;

  const latestValue = samples[n - 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(pct * (n - 1));
    setHoveredIdx(idx);
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
  };

  const hoveredX = hoveredIdx !== null ? (hoveredIdx / (n - 1)) * width : null;
  const hoveredVal = hoveredIdx !== null ? samples[hoveredIdx] : null;
  const hoveredY = hoveredVal !== null ? getY(hoveredVal) : null;

  return (
    <div className="flex flex-col space-y-2.5 bg-slate-50/50 p-3 rounded-xl border border-slate-100/80 hover:bg-slate-50/80 transition-all duration-200 relative">
      <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${isCpu ? "bg-blue-600 animate-pulse" : "bg-indigo-600 animate-pulse"}`} />
          {label} Trend
        </span>
        <span className="font-mono text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-100 shadow-sm text-[10px]">
          Current: {formatter(latestValue)}{valueSuffix}
        </span>
      </div>

      <div className="relative h-[90px] w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full overflow-visible cursor-crosshair"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isCpu ? "#2563eb" : "#4f46e5"} stopOpacity="0.25" />
              <stop offset="100%" stopColor={isCpu ? "#2563eb" : "#4f46e5"} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1="0" y1={chartHeight * 0.25} x2={width} y2={chartHeight * 0.25} stroke="#f1f5f9" strokeWidth="1" />
          <line x1="0" y1={chartHeight * 0.5} x2={width} y2={chartHeight * 0.5} stroke="#f1f5f9" strokeWidth="1" />
          <line x1="0" y1={chartHeight * 0.75} x2={width} y2={chartHeight * 0.75} stroke="#f1f5f9" strokeWidth="1" />
          <line x1="0" y1={chartHeight} x2={width} y2={chartHeight} stroke="#e2e8f0" strokeWidth="1.5" />

          {/* Value guidelines / labels inside SVG */}
          <text x={4} y={12} fill="#94a3b8" fontSize="8" fontFamily="monospace" className="opacity-60 font-bold">{formatter(maxVal)}{valueSuffix}</text>
          <text x={4} y={chartHeight - 4} fill="#94a3b8" fontSize="8" fontFamily="monospace" className="opacity-60 font-bold">{formatter(minVal)}{valueSuffix}</text>

          {/* Filled Area */}
          <path d={areaD} fill={`url(#${gradientId})`} />

          {/* Top Line */}
          <path d={lineD} fill="none" stroke={isCpu ? "#2563eb" : "#4f46e5"} strokeWidth="1.5" strokeLinecap="round" />

          {/* Latest value dot and glowing pulse */}
          <circle cx={width} cy={getY(latestValue)} r="3" fill={isCpu ? "#2563eb" : "#4f46e5"} stroke="#ffffff" strokeWidth="1.5" />
          <circle cx={width} cy={getY(latestValue)} r="7" fill={isCpu ? "#2563eb" : "#4f46e5"} className="animate-ping opacity-35 pointer-events-none" />

          {/* Interactive Hover Indicators */}
          {hoveredX !== null && hoveredY !== null && (
            <>
              <line
                x1={hoveredX}
                y1={0}
                x2={hoveredX}
                y2={chartHeight}
                stroke={isCpu ? "#3b82f6" : "#6366f1"}
                strokeWidth="1.2"
                strokeDasharray="3,3"
              />
              <circle
                cx={hoveredX}
                cy={hoveredY}
                r="4"
                fill={isCpu ? "#2563eb" : "#4f46e5"}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
            </>
          )}
        </svg>

        {/* Floating Tooltip */}
        {hoveredIdx !== null && hoveredVal !== null && hoveredX !== null && hoveredY !== null && (
          <div
            className="absolute z-10 pointer-events-none bg-slate-900/95 text-white font-mono text-[9px] px-2 py-1.5 rounded shadow-lg border border-slate-700/80 flex flex-col space-y-0.5 min-w-[95px] backdrop-blur-sm transition-all duration-75"
            style={{
              left: `${(hoveredX / width) * 100}%`,
              top: `${(hoveredY / height) * 100}%`,
              transform: hoveredX > width / 2 ? "translate(-110%, -110%)" : "translate(10%, -110%)",
            }}
          >
            <div className="flex justify-between gap-2 text-slate-400 font-bold border-b border-slate-700/50 pb-0.5 mb-0.5">
              <span>VAL</span>
              <span className="text-white">{formatter(hoveredVal)}{valueSuffix}</span>
            </div>
            <div className="flex justify-between gap-2 text-slate-400">
              <span>TIME</span>
              <span className="text-blue-300 font-bold">
                {hoveredIdx === n - 1 ? "Now" : `t-${n - 1 - hoveredIdx}`}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[8px] font-mono text-slate-400 px-0.5">
        <span>History Start</span>
        <span>Live</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [services, setServices] = useState<Record<string, ServiceMetric>>({});
  const [telemetryHistory, setTelemetryHistory] = useState<Record<string, { cpu: number[]; memory: number[] }>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [logs, setLogs] = useState<IncidentLog[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [injectingFault, setInjectingFault] = useState<string | null>(null);
  const [clearingFaults, setClearingFaults] = useState(false);
  const [triggeringRisk, setTriggeringRisk] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState(false);

  const consoleRef = useRef<HTMLDivElement>(null);
  const prevIncidentIdRef = useRef<string | null>(null);

  const handleTelemetryUpdate = (data: Record<string, ServiceMetric>) => {
    setServices(data);
    setTelemetryHistory(prev => {
      const nextHistory = { ...prev };
      Object.keys(data).forEach(name => {
        const svc = data[name];
        const cpuVal = svc.cpu;
        const memVal = svc.memory;

        if (!nextHistory[name]) {
          nextHistory[name] = {
            cpu: seedHistory(cpuVal, true),
            memory: seedHistory(memVal, false)
          };
        } else {
          const currentCpu = [...nextHistory[name].cpu, cpuVal];
          const currentMem = [...nextHistory[name].memory, memVal];
          if (currentCpu.length > 40) currentCpu.shift();
          if (currentMem.length > 40) currentMem.shift();
          nextHistory[name] = {
            cpu: currentCpu,
            memory: currentMem
          };
        }
      });
      return nextHistory;
    });
    setLoadingServices(false);
  };

  // Poll SRE incidents
  useEffect(() => {
    const fetchIncidents = async () => {
      try {
        const iRes = await fetch(`${API_URL}/api/v1/incidents`);
        if (iRes.ok) {
          const data = await iRes.json();
          setIncidents(data);

          if (!selectedIncidentId && data.length > 0) {
            const activeIncident = data.find((inc: Incident) =>
              ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING", "PENDING_APPROVAL"].includes(inc.status)
            );
            if (activeIncident) {
              setSelectedIncidentId(activeIncident.id);
            } else {
              setSelectedIncidentId(data[0].id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch incidents list:", err);
      }
    };

    fetchIncidents();
    const interval = setInterval(fetchIncidents, 3000);
    return () => clearInterval(interval);
  }, [selectedIncidentId]);

  // Real-time Telemetry Subscription: WebSocket with HTTP fallback
  useEffect(() => {
    let ws: WebSocket | null = null;
    let fallbackInterval: any = null;
    let isConnected = false;

    const startFallbackPolling = () => {
      if (fallbackInterval) return;
      console.log("WebSocket inactive – starting HTTP status polling fallback (2s)");

      const poll = async () => {
        try {
          const res = await fetch(`${API_URL}/api/v1/simulation/status`);
          if (res.ok) {
            const data = await res.json();
            handleTelemetryUpdate(data);
          }
        } catch (err) {
          console.error("HTTP status polling failed:", err);
        }
      };

      poll();
      fallbackInterval = setInterval(poll, 2000);
    };

    const stopFallbackPolling = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const connectWs = () => {
      try {
        const wsUrl = API_URL.replace(/^http/, "ws") + "/api/v1/simulation/ws";
        console.log(`Connecting to SRE Telemetry WebSocket: ${wsUrl}`);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("Telemetry WebSocket connected – real-time 500ms push active");
          isConnected = true;
          stopFallbackPolling();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            handleTelemetryUpdate(data);
          } catch (err) {
            console.error("Failed to parse telemetry WebSocket data:", err);
          }
        };

        ws.onerror = (err) => {
          console.warn("Telemetry WebSocket error, falling back to REST:", err);
          if (!isConnected) {
            startFallbackPolling();
          }
        };

        ws.onclose = () => {
          console.log("Telemetry WebSocket closed");
          isConnected = false;
          startFallbackPolling();
          // Retry connection after 5 seconds
          setTimeout(() => {
            if (!isConnected) connectWs();
          }, 5000);
        };
      } catch (err) {
        console.error("WebSocket setup failed:", err);
        startFallbackPolling();
      }
    };

    connectWs();

    return () => {
      if (ws) ws.close();
      stopFallbackPolling();
    };
  }, []);

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
      const container = consoleRef.current;
      const incidentChanged = prevIncidentIdRef.current !== selectedIncidentId;
      
      if (incidentChanged) {
        // If the incident has changed, scroll to the bottom unconditionally
        container.scrollTop = container.scrollHeight;
        prevIncidentIdRef.current = selectedIncidentId;
      } else {
        // Only auto-scroll if the user is already near the bottom (threshold of 100px)
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 100;
        if (isNearBottom) {
          container.scrollTop = container.scrollHeight;
        }
      }
    }
  }, [logs, selectedIncidentId]);

  // Trigger a simulated test incident for risk classification testing
  const triggerTestIncident = async (riskLevel: string) => {
    setTriggeringRisk(riskLevel);
    try {
      const res = await fetch(`${API_URL}/api/v1/simulation/trigger_test_incident`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ risk_level: riskLevel })
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      // Refresh incidents feed instantly
      const incRes = await fetch(`${API_URL}/api/v1/incidents`);
      if (incRes.ok) {
        const data = await incRes.json();
        setIncidents(data);
        if (data.length > 0) {
          setSelectedIncidentId(data[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to trigger simulated incident:", err);
    } finally {
      setTriggeringRisk(null);
    }
  };

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
      case "PENDING_APPROVAL":
        return <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border border-orange-200 bg-orange-50 text-orange-700 animate-pulse">PENDING APPROVAL</span>;
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
  const activeIncidentsCount = incidents.filter(inc => ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING", "PENDING_APPROVAL"].includes(inc.status)).length;
  const clusterIsHealthy = Object.values(services).every(s => s.status === "healthy");

  const filteredIncidents = filterActive
    ? incidents.filter(inc => ["INVESTIGATING", "ROOT_CAUSE_FOUND", "EXECUTING_FIX", "VERIFYING", "PENDING_APPROVAL"].includes(inc.status))
    : incidents;

  return (
    <div className="relative min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans overflow-x-hidden">

      {/* Decorative Background Shapes */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-blue-100/30 via-cyan-50/20 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-[-100px] right-[-100px] w-[450px] h-[450px] rounded-full bg-gradient-to-br from-[#0942e6] to-[#0033cc] opacity-[0.95] pointer-events-none -z-10 shadow-2xl" />
      <div className="absolute top-[35%] right-[-150px] w-[350px] h-[350px] rounded-full border-[45px] border-[#00d2d3]/25 pointer-events-none -z-10" />
      <div className="absolute bottom-[20%] left-[-150px] w-[450px] h-[450px] rounded-full bg-cyan-100/30 blur-3xl pointer-events-none -z-10" />

      {/* Top Navbar */}
      <header className="border-b border-slate-100/80 bg-white/70 backdrop-blur-md px-8 py-4 flex items-center justify-between sticky top-0 z-50">
        <Link href="/" className="flex items-center space-x-3 cursor-pointer group">
          <div className="p-2 rounded-lg bg-blue-600/10 border border-blue-600/20 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-200">
            <Activity className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-black tracking-tight text-[#0f172a] flex items-center space-x-2">
              <span>SentinelOps</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-600/10 text-blue-600 border border-blue-600/20 uppercase tracking-widest font-mono group-hover:border-blue-600/30 transition-colors">Autonomous SRE</span>
            </h1>
          </div>
        </Link>

        {/* Center menu navigation links */}
        <nav className="hidden md:flex space-x-8 text-xs font-bold tracking-wider text-slate-500 font-sans">
          <Link href="/" className="hover:text-blue-600 transition-colors uppercase">Home</Link>
          <Link href="/dashboard" className="text-blue-600 transition-colors uppercase font-extrabold border-b-2 border-blue-600 pb-1">Console</Link>
          <a href="http://localhost:8000/docs" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors uppercase flex items-center gap-1">
            <span>API Docs</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </nav>

        <div className="flex items-center space-x-4">
          {/* Quick Demo Trigger button */}
          <button
            onClick={() => injectFault("payment-service", "memory-leak")}
            disabled={injectingFault !== null}
            className="flex items-center space-x-1.5 px-4 py-2 text-xs font-bold tracking-wider bg-blue-600 hover:bg-blue-700 text-white rounded-full transition-all duration-200 disabled:opacity-50 shadow-md shadow-blue-500/15 cursor-pointer"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Trigger Outage</span>
          </button>

          {/* Reset button */}
          <button
            onClick={clearAllFaults}
            disabled={clearingFaults}
            className="flex items-center space-x-1.5 px-4 py-2 text-xs font-bold tracking-wider border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-full transition-all duration-200 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${clearingFaults ? "animate-spin" : ""}`} />
            <span>Reset Cluster</span>
          </button>

          <div className="p-2 rounded-full hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer">
            <User className="h-4.5 w-4.5" />
          </div>
        </div>
      </header>

      {/* SRE Operations Center */}
      <main id="ops-center" className="flex-grow px-8 py-8 max-w-[1400px] mx-auto w-full">

        <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
              <h2 className="text-xs uppercase tracking-widest font-black text-blue-600">Operations Center</h2>
            </div>
            <h3 className="font-heading font-black text-slate-800 text-2xl">Autonomous SRE Command Console</h3>
            <p className="text-slate-500 text-xs mt-1">
              A unified live telemetry console. Manually inject anomalies using service triggers, or click "Trigger Outage" above to watch the agent perform self-healing.
            </p>
          </div>

          {/* Cluster Status Summary Badge */}
          <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-100 shadow-sm self-start md:self-auto text-xs">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Cluster State</span>
              <span className="font-bold text-slate-800">{clusterIsHealthy ? "All Systems Nominal" : "Anomalous Load Detected"}</span>
            </div>
            <div className={`p-2 rounded-lg ${clusterIsHealthy ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600 animate-pulse"}`}>
              <Server className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Global Telemetry Real-time Trend Profiles */}
        <div className="mb-6 bg-white border border-slate-100 shadow-[0_10px_30px_rgba(0,0,0,0.02)] rounded-2xl p-5 w-full">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2 border-b border-slate-50 pb-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping"></span>
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-600 flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-blue-600" />
                  <span>Telemetry Real-time History Trends</span>
                </h4>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">
                Live timeline charts show resource metrics profile over a sliding window. Glowing dots mark the latest state.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.values(services).map((service) => {
              const history = telemetryHistory[service.name];
              if (!history) return null;

              return (
                <div
                  key={service.name}
                  className="bg-slate-50/40 border border-slate-100/60 rounded-xl p-3.5 flex flex-col space-y-3.5 relative"
                >
                  {/* Service Header */}
                  <div className="flex items-center justify-between border-b border-slate-100/80 pb-2">
                    <span className="font-heading font-black text-xs text-slate-800 uppercase tracking-tight">{service.name}</span>
                    <span className={`px-1.5 py-0.5 text-[8px] font-bold tracking-wider rounded border ${getStatusColor(service.status)}`}>
                      {service.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Live History Charts Stacked */}
                  <div className="flex flex-col space-y-3.5">
                    <KdeChart
                      samples={history.cpu}
                      minVal={0}
                      maxVal={1.0}
                      label="CPU Load"
                      colorClass="text-blue-600"
                      gradientId={`global-cpu-kde-${service.name}`}
                      valueSuffix="%"
                      formatter={(v) => (v * 100).toFixed(0)}
                    />
                    <KdeChart
                      samples={history.memory}
                      minVal={0}
                      maxVal={120}
                      label="Memory Alloc"
                      colorClass="text-indigo-600"
                      gradientId={`global-mem-kde-${service.name}`}
                      valueSuffix="MB"
                      formatter={(v) => v.toFixed(0)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Unified 3-panel Dashboard Layout */}
        <div className="bg-white border border-slate-100 shadow-[0_15px_50px_rgba(0,0,0,0.03)] rounded-2xl overflow-hidden flex flex-col lg:flex-row lg:h-[650px] w-full divide-y lg:divide-y-0 lg:divide-x divide-slate-100">

          {/* Panel 1: Simulated Microservices */}
          <div className="w-full lg:w-[35%] flex flex-col h-[500px] lg:h-full overflow-hidden bg-slate-50/10">
            <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5">
                <Server className="h-4 w-4 text-blue-600" />
                <span>Telemetry & Fault Injector</span>
              </h4>
              <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold tracking-wide ${clusterIsHealthy
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

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 flex-wrap">
                      <button
                        onClick={() => injectFault(service.name, "memory-leak")}
                        disabled={injectingFault !== null || service.status === "offline"}
                        className="px-2 py-0.5 text-[9px] font-bold text-red-500 hover:text-white border border-red-500/25 hover:bg-red-500 active:bg-red-600 rounded-full transition-all duration-150 disabled:opacity-40 cursor-pointer"
                      >
                        {injectingFault === `${service.name}-memory-leak` ? "Leaking..." : "Leak Mem"}
                      </button>
                      <button
                        onClick={() => injectFault(service.name, "cpu-spike")}
                        disabled={injectingFault !== null || service.status === "offline"}
                        className="px-2 py-0.5 text-[9px] font-bold text-amber-600 hover:text-white border border-amber-500/25 hover:bg-amber-500 active:bg-amber-600 rounded-full transition-all duration-150 disabled:opacity-40 cursor-pointer"
                      >
                        {injectingFault === `${service.name}-cpu-spike` ? "Spiking..." : "Spike CPU"}
                      </button>
                      <button
                        onClick={() => injectFault(service.name, "error-spike")}
                        disabled={injectingFault !== null || service.status === "offline"}
                        className="px-2 py-0.5 text-[9px] font-bold text-rose-500 hover:text-white border border-rose-500/25 hover:bg-rose-500 active:bg-[#f43f5e] rounded-full transition-all duration-150 disabled:opacity-40 cursor-pointer"
                      >
                        {injectingFault === `${service.name}-error-spike` ? "Injecting..." : "Fail HTTP"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>


            {/* Safety & Governance Risk Console */}
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl shadow-lg flex flex-col space-y-3 mt-4 text-white">
              <div className="flex items-center space-x-2">
                <Shield className="h-4 w-4 text-blue-400 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Safety & Governance Risk Console</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Inject simulated outages with specific parameters to test the SRE safety gates, risk classifications, and email approval processes.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1.5">
                <button
                  onClick={() => triggerTestIncident("low")}
                  disabled={triggeringRisk !== null}
                  className="flex items-center justify-between px-3 py-2 text-[10px] font-bold bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/40 rounded-lg text-emerald-400 hover:text-emerald-300 transition-all duration-150 cursor-pointer disabled:opacity-40"
                >
                  <span>Low Risk</span>
                  <span className="text-[8px] bg-emerald-500/10 px-1.5 py-0.5 rounded text-emerald-400 border border-emerald-500/20 font-mono font-bold">AUTO</span>
                </button>
                <button
                  onClick={() => triggerTestIncident("medium")}
                  disabled={triggeringRisk !== null}
                  className="flex items-center justify-between px-3 py-2 text-[10px] font-bold bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/40 rounded-lg text-amber-400 hover:text-amber-300 transition-all duration-150 cursor-pointer disabled:opacity-40"
                >
                  <span>Medium Risk</span>
                  <span className="text-[8px] bg-amber-500/10 px-1.5 py-0.5 rounded text-amber-400 border border-amber-500/20 font-mono font-bold">AUTO</span>
                </button>
                <button
                  onClick={() => triggerTestIncident("high")}
                  disabled={triggeringRisk !== null}
                  className="flex items-center justify-between px-3 py-2 text-[10px] font-bold bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/40 rounded-lg text-orange-400 hover:text-orange-300 transition-all duration-150 cursor-pointer disabled:opacity-40"
                >
                  <span>High Risk</span>
                  <span className="text-[8px] bg-orange-500/10 px-1.5 py-0.5 rounded text-orange-400 border border-orange-500/20 font-mono font-bold">HALT</span>
                </button>
                <button
                  onClick={() => triggerTestIncident("critical")}
                  disabled={triggeringRisk !== null}
                  className="flex items-center justify-between px-3 py-2 text-[10px] font-bold bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/40 rounded-lg text-rose-500 hover:text-rose-400 transition-all duration-150 cursor-pointer disabled:opacity-40"
                >
                  <span>Critical Risk</span>
                  <span className="text-[8px] bg-rose-500/10 px-1.5 py-0.5 rounded text-rose-500 border border-rose-500/20 font-mono font-bold">HALT</span>
                </button>
              </div>
            </div>
          </div>

        {/* Panel 2: Incident Feed */}
        <div className="w-full lg:w-[25%] flex flex-col h-[400px] lg:h-full overflow-hidden bg-white">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>Incident Feed</span>
            </h4>
            <button
              onClick={() => setFilterActive(!filterActive)}
              className={`text-[9px] px-2.5 py-1 rounded-full border font-bold tracking-wider uppercase transition-colors cursor-pointer ${filterActive
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
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all flex flex-col space-y-2.5 relative overflow-hidden ${isSelected
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

        {/* Panel 3: SRE Agent Console Terminal */}
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
                          className={`h-full rounded-full transition-all duration-500 ${selectedIncident.confidence >= 80 ? "bg-emerald-500" :
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
              <div ref={consoleRef} className="flex-grow bg-[#0c1020] rounded-xl p-4 font-mono text-[11px] overflow-y-auto overscroll-contain flex flex-col space-y-2 relative shadow-inner">
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
                      const file = new Blob([selectedIncident.resolution_action || ""], { type: 'text/markdown' });
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
    </main>

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

    {/* Floating Rocket scroll-to-top button */}
    <div
      onClick={scrollToTop}
      className="fixed bottom-6 right-6 w-11 h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center cursor-pointer hover:shadow-xl active:scale-90 z-50 group"
    >
      <Rocket className="h-5 w-5 transform -rotate-45 group-hover:-translate-y-0.5 transition-transform" />
    </div>

  </div>
  );
}
