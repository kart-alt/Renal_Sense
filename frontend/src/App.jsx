import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  Heart,
  Droplet,
  Thermometer,
  Zap,
  Settings,
  Database,
  TrendingUp,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Radio,
  Info,
  FileText,
  User,
  Cpu,
  Layers,
  ChevronRight
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from "recharts";

// --- Sub-Component: Live ECG Scrolling Monitor (Canvas) ---
function LiveECGMonitor({ heartRate = 72, stable = true }) {
  const canvasRef = useRef(null);
  const xRef = useRef(0);
  const pointsRef = useRef([]);
  const lastTimeRef = useRef(0);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animationId;
    
    // Grid settings
    const drawGrid = () => {
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 0.5;
      
      // Vertical lines
      for (let x = 0; x < canvas.width; x += 15) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      // Horizontal lines
      for (let y = 0; y < canvas.height; y += 15) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    };

    // ECG wave math: generate y coordinate based on current cycle position
    const getECGValue = (phase) => {
      // phase goes from 0 to 1
      if (phase > 0.0 && phase < 0.05) {
        // P Wave
        return Math.sin((phase / 0.05) * Math.PI) * 10;
      }
      if (phase >= 0.05 && phase < 0.08) {
        // PR segment
        return 0;
      }
      if (phase >= 0.08 && phase < 0.10) {
        // Q Wave (slight dip)
        return -8;
      }
      if (phase >= 0.10 && phase < 0.13) {
        // R Wave (tall peak)
        const p = (phase - 0.10) / 0.03;
        return p < 0.5 ? p * 2 * 60 : (1 - p) * 2 * 60;
      }
      if (phase >= 0.13 && phase < 0.15) {
        // S Wave (deep dip)
        const p = (phase - 0.13) / 0.02;
        return -15 * (1 - p);
      }
      if (phase >= 0.15 && phase < 0.18) {
        // ST segment
        return 0;
      }
      if (phase >= 0.18 && phase < 0.25) {
        // T Wave (medium bump)
        return Math.sin(((phase - 0.18) / 0.07) * Math.PI) * 15;
      }
      // Baseline
      return 0;
    };
    
    const render = (time) => {
      const delta = time - lastTimeRef.current;
      lastTimeRef.current = time;
      
      // Clear canvas
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      drawGrid();
      
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;
      
      // Calculate scrolling trace speed
      // Scale speed based on heart rate
      const bps = heartRate / 60; // beats per second
      const pixelsPerSec = 120;
      const dx = (pixelsPerSec * (delta || 16)) / 1000;
      
      xRef.current = (xRef.current + dx) % width;
      
      // Current cycle phase
      const cycleLengthMs = 1000 / bps;
      const cycleTime = time % cycleLengthMs;
      const phase = cycleTime / cycleLengthMs;
      
      const ecgVal = getECGValue(phase);
      
      // Add current point
      pointsRef.current.push({
        x: xRef.current,
        y: centerY - ecgVal
      });
      
      // Keep points sorted and prune duplicates in the scrolling path
      if (pointsRef.current.length > 500) {
        pointsRef.current.shift();
      }
      
      // Draw lead path
      ctx.strokeStyle = stable ? "#10b981" : "#f59e0b"; // green for stable, amber for jittery
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      
      // Draw in two segments to avoid line joining across screen wrapping edge
      const sortedPoints = [...pointsRef.current].sort((a, b) => a.x - b.x);
      
      let isFirst = true;
      for (let i = 0; i < sortedPoints.length; i++) {
        const pt = sortedPoints[i];
        
        // Skip points near the sweep refresh boundary
        const sweepGap = 12;
        if (Math.abs(pt.x - xRef.current) < sweepGap) {
          isFirst = true;
          continue;
        }
        
        if (isFirst) {
          ctx.moveTo(pt.x, pt.y);
          isFirst = false;
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.stroke();
      
      // Draw glow dot at the sweep head
      ctx.fillStyle = stable ? "#059669" : "#d97706";
      ctx.beginPath();
      ctx.arc(xRef.current, centerY - ecgVal, 4, 0, 2 * Math.PI);
      ctx.fill();
      
      animationId = requestAnimationFrame(render);
    };
    
    animationId = requestAnimationFrame(render);
    
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [heartRate, stable]);
  
  return (
    <div className="relative bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-teal-600 animate-pulse" /> Live Lead II ECG Waveform
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          stable ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-amber-50 text-amber-700 border border-amber-100"
        }`}>
          {stable ? "Sinus Rhythm (Stable)" : "Arrhythmia (Unstable)"}
        </span>
      </div>
      <canvas 
        ref={canvasRef} 
        width={550} 
        height={130} 
        className="w-full h-[130px] border border-slate-100 rounded-lg bg-white"
      />
    </div>
  );
}

// --- Main App Component ---
export default function App() {
  const [activeTab, setActiveTab] = useState("monitoring");
  
  // Real-Time States
  const [latestReading, setLatestReading] = useState(null);
  const [readingsHistory, setReadingsHistory] = useState([]);
  const [latestPrediction, setLatestPrediction] = useState(null);
  const [predictionsHistory, setPredictionsHistory] = useState([]);
  const [patientConfig, setPatientConfig] = useState({
    name: "Jane Doe",
    age: 58,
    gender: "female",
    mode: "simulator",
    profile: "healthy"
  });

  // Connection states
  const [socketConnected, setSocketConnected] = useState(false);
  const [mlServiceOnline, setMlServiceOnline] = useState(false);
  
  // Edit patient profile states
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tempAge, setTempAge] = useState(58);
  const [tempGender, setTempGender] = useState("female");
  const [tempMode, setTempMode] = useState("simulator");

  // WebSocket Connection ref
  const socketRef = useRef(null);

  // Initialize and Fetch Initial DB Records
  useEffect(() => {
    // 1. Fetch initial states
    const fetchInitialData = async () => {
      try {
        const configRes = await fetch("http://localhost:3001/api/config");
        if (configRes.ok) {
          const config = await configRes.json();
          setPatientConfig(config);
          setTempName(config.name);
          setTempAge(config.age);
          setTempGender(config.gender);
          setTempMode(config.mode);
        }

        const readingsRes = await fetch("http://localhost:3001/api/readings/history?range=15m");
        if (readingsRes.ok) {
          const history = await readingsRes.json();
          setReadingsHistory(history);
          if (history.length > 0) {
            setLatestReading(history[history.length - 1]);
          }
        }

        const predRes = await fetch("http://localhost:3001/api/predictions/history");
        if (predRes.ok) {
          const preds = await predRes.json();
          setPredictionsHistory(preds);
          if (preds.length > 0) {
            setLatestPrediction(preds[0]);
          }
        }
      } catch (err) {
        console.error("Error fetching initial database state:", err);
      }
    };

    fetchInitialData();

    // 2. Setup Socket.IO Client
    const socket = io("http://localhost:3001");
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      console.log("Connected to Express Socket.IO server");
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
      console.log("Disconnected from Express Socket.IO server");
    });

    socket.on("config-updated", (newConfig) => {
      setPatientConfig(newConfig);
    });

    socket.on("live-reading", (packet) => {
      setLatestReading(packet);
      // Append and limit sliding window array in memory
      setReadingsHistory((prev) => {
        const updated = [...prev, packet];
        return updated.slice(-100); // keep last 100
      });
    });

    socket.on("new-prediction", (prediction) => {
      setLatestPrediction(prediction);
      setPredictionsHistory((prev) => [prediction, ...prev].slice(0, 50));
      // Ping check: ML service generated a prediction successfully, so it must be online!
      setMlServiceOnline(true);
    });

    // Check ML service health periodically
    const checkMLHealth = async () => {
      try {
        // Simply try loading config or prediction. If we got predictions, it's alive.
        // We can do a dummy ping or verify
        const res = await fetch("http://localhost:3001/api/predictions/latest");
        if (res.ok) {
          setMlServiceOnline(true);
        }
      } catch {
        setMlServiceOnline(false);
      }
    };
    checkMLHealth();
    const mlPingInterval = setInterval(checkMLHealth, 5000);

    return () => {
      socket.disconnect();
      clearInterval(mlPingInterval);
    };
  }, []);

  // Update Config handler
  const saveConfiguration = async (e) => {
    if (e) e.preventDefault();
    try {
      const response = await fetch("http://localhost:3001/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tempName,
          age: parseInt(tempAge),
          gender: tempGender,
          mode: tempMode
        })
      });
      if (response.ok) {
        const updated = await response.json();
        setPatientConfig(updated);
        setShowConfigModal(false);
      }
    } catch (err) {
      alert("Failed to update patient profile config.");
    }
  };

  // Toggle Simulator profile instantly
  const toggleSimulatorProfile = async (profile) => {
    try {
      const response = await fetch("http://localhost:3001/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile })
      });
      if (response.ok) {
        const updated = await response.json();
        setPatientConfig(updated);
      }
    } catch (err) {
      console.error("Could not toggle simulator profile", err);
    }
  };

  // Format date helper
  const formatTime = (isoString) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Staging CSS Color Mapper
  const getStageColorClass = (stage) => {
    if (!stage) return "bg-slate-100 text-slate-700";
    if (stage.includes("Stage 1") || stage.includes("Stage 2")) return "bg-emerald-50 border-emerald-200 text-emerald-700";
    if (stage.includes("Stage 3")) return "bg-amber-50 border-amber-200 text-amber-700";
    return "bg-rose-50 border-rose-200 text-rose-700";
  };

  const getRiskColorClass = (risk) => {
    if (!risk) return "bg-slate-100 text-slate-700";
    if (risk.includes("Low")) return "bg-emerald-500 text-white shadow-sm";
    if (risk.includes("Moderate")) return "bg-amber-500 text-white shadow-sm";
    return "bg-rose-500 text-white shadow-sm";
  };

  const getEgfrGaugeColor = (egfr) => {
    if (egfr >= 90) return "#10b981"; // Emerald
    if (egfr >= 60) return "#10b981"; // Emerald
    if (egfr >= 30) return "#f59e0b"; // Amber
    return "#f43f5e"; // Rose
  };

  // Prepare Bioimpedance spectroscopy data for the Radar chart
  const getBioimpedanceSpectrumData = () => {
    if (!latestReading || !latestReading.bioimpedance) {
      return [
        { subject: "1 kHz", R: 450, X: 10, mag: 450 },
        { subject: "10 kHz", R: 420, X: 25, mag: 420 },
        { subject: "50 kHz", R: 380, X: 45, mag: 383 },
        { subject: "100 kHz", R: 350, X: 35, mag: 352 },
        { subject: "200 kHz", R: 320, X: 20, mag: 321 }
      ];
    }
    const bio = latestReading.bioimpedance;
    const labels = ["1 kHz", "10 kHz", "50 kHz", "100 kHz", "200 kHz"];
    return labels.map((label, idx) => ({
      subject: label,
      Resistance: bio.R[idx],
      Reactance: Math.abs(bio.X[idx]), // use absolute for visual plotting
      Magnitude: bio.mag[idx]
    }));
  };

  // Render main layout
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Banner: Navigation and Status Indicators */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-teal-500 text-white p-2 rounded-xl shadow-sm">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">Renal Sense</h1>
              <span className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Kidney Function Monitor</span>
            </div>
          </div>
          
          {/* Status Indicators */}
          <div className="hidden md:flex items-center gap-4 text-xs font-medium">
            {/* Express backend status */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">
              <div className={`w-2 h-2 rounded-full ${socketConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
              <span className="text-slate-600">Gateway: <span className="font-bold">{socketConnected ? "Online" : "Offline"}</span></span>
            </div>

            {/* Flask ML status */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">
              <div className={`w-2 h-2 rounded-full ${mlServiceOnline ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
              <span className="text-slate-600">ML Engine: <span className="font-bold">{mlServiceOnline ? "Active" : "Offline"}</span></span>
            </div>

            {/* Ingestion Source */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">
              <Radio className={`w-3.5 h-3.5 ${patientConfig.mode === "simulator" ? "text-teal-600" : "text-indigo-600 animate-pulse"}`} />
              <span className="text-slate-600">Source: <span className="font-bold uppercase">{patientConfig.mode}</span></span>
            </div>

            {/* Simulator Profile (Demo controller status) */}
            {patientConfig.mode === "simulator" && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-600">Profile: <span className={`font-bold ${
                  patientConfig.profile === "healthy" ? "text-emerald-600" : "text-rose-600"
                }`}>{patientConfig.profile === "healthy" ? "HEALTHY" : "CKD RISK"}</span></span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowConfigModal(true)}
              className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Demo Controls Bar */}
      <section className="bg-gradient-to-r from-teal-800 to-cyan-900 text-white py-3.5 px-4 shadow-inner">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="bg-teal-700 text-teal-100 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full">
              Demo Panel
            </span>
            <p className="text-xs text-teal-100">
              Active Patient: <span className="font-semibold text-white">{patientConfig.name}</span> ({patientConfig.age} y/o, {patientConfig.gender})
            </p>
          </div>
          
          {patientConfig.mode === "simulator" ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-teal-100">Switch physiological profile:</span>
              <button
                onClick={() => toggleSimulatorProfile("healthy")}
                className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all ${
                  patientConfig.profile === "healthy"
                    ? "bg-emerald-500 text-white shadow-sm border border-emerald-400"
                    : "bg-teal-900 text-teal-200 hover:bg-teal-800 border border-transparent"
                }`}
              >
                Healthy Patient
              </button>
              <button
                onClick={() => toggleSimulatorProfile("ckd-risk")}
                className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all ${
                  patientConfig.profile === "ckd-risk"
                    ? "bg-rose-500 text-white shadow-sm border border-rose-400"
                    : "bg-teal-900 text-teal-200 hover:bg-teal-800 border border-transparent"
                }`}
              >
                CKD Risk Patient
              </button>
            </div>
          ) : (
            <span className="text-xs text-amber-200 flex items-center gap-1 animate-pulse">
              <Radio className="w-3.5 h-3.5" /> Direct Hardware Stream Active. Feed serial input to trigger analytics.
            </span>
          )}
        </div>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
        
        {/* Navigation Tabs */}
        <div className="border-b border-slate-200 flex justify-between items-center">
          <nav className="flex space-x-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab("monitoring")}
              className={`pb-4 px-1 border-b-2 font-semibold text-sm flex items-center gap-2 transition ${
                activeTab === "monitoring"
                  ? "border-teal-500 text-teal-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              <Activity className="w-4 h-4" /> Live Telemetry
            </button>
            <button
              onClick={() => setActiveTab("analysis")}
              className={`pb-4 px-1 border-b-2 font-semibold text-sm flex items-center gap-2 transition ${
                activeTab === "analysis"
                  ? "border-teal-500 text-teal-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              <Cpu className="w-4 h-4" /> AI Diagnostics
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`pb-4 px-1 border-b-2 font-semibold text-sm flex items-center gap-2 transition ${
                activeTab === "history"
                  ? "border-teal-500 text-teal-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              <Database className="w-4 h-4" /> Reports & History
            </button>
          </nav>

          <span className="text-xs text-slate-400 italic">
            Last update: {latestReading ? formatTime(latestReading.timestamp) : "No data"}
          </span>
        </div>

        {/* TAB CONTENT: 1. Live Telemetry */}
        {activeTab === "monitoring" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Cardiac Lead Monitor Column */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              
              <LiveECGMonitor 
                heartRate={latestReading?.ecg?.heart_rate || 72} 
                stable={latestReading?.ecg?.rhythm_stable ?? true} 
              />
              
              {/* Telemetry Charts */}
              <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-teal-600" /> Vital Trends (Last 15 minutes)
                </h3>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={readingsHistory.slice(-40)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={(val) => formatTime(val)} 
                        stroke="#94a3b8"
                        fontSize={10}
                      />
                      <YAxis yAxisId="left" stroke="#0d9488" fontSize={10} domain={['auto', 'auto']} />
                      <YAxis yAxisId="right" orientation="right" stroke="#e11d48" fontSize={10} domain={[90, 100]} />
                      <Tooltip 
                        labelFormatter={(val) => new Date(val).toLocaleTimeString()}
                        contentStyle={{ fontSize: 11, borderRadius: 8, borderColor: '#f1f5f9' }}
                      />
                      <Legend textAnchor="middle" wrapperStyle={{ fontSize: 11 }} />
                      <Line 
                        yAxisId="left" 
                        type="monotone" 
                        dataKey="ecg.heart_rate" 
                        name="Heart Rate (bpm)" 
                        stroke="#0d9488" 
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line 
                        yAxisId="right" 
                        type="monotone" 
                        dataKey="optical.spo2" 
                        name="SpO₂ Oxygen (%)" 
                        stroke="#e11d48" 
                        strokeWidth={2} 
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Bioimpedance Spectroscopy & Small Vitals Column */}
            <div className="flex flex-col gap-6">
              
              {/* Bioimpedance Radar Plot */}
              <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-teal-600" /> Bioimpedance Spectrum
                    </h3>
                    <div className="flex items-center gap-1 hover:cursor-pointer" title="R is Resistance, X is Reactance (absolute values).">
                      <Info className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Hydration Index: <span className="font-semibold text-slate-800">
                      {latestReading ? (latestReading.bioimpedance.R[4] / latestReading.bioimpedance.R[1]).toFixed(3) : "0.760"}
                    </span>
                  </p>
                </div>
                
                <div className="h-[210px] w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="75%" data={getBioimpedanceSpectrumData()}>
                      <PolarGrid stroke="#e2e8f0" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 500]} tick={{ fill: '#94a3b8', fontSize: 8 }} />
                      <Radar name="Resistance (Ω)" dataKey="Resistance" stroke="#0f766e" fill="#0f766e" fillOpacity={0.2} />
                      <Radar name="Reactance (X)" dataKey="Reactance" stroke="#d97706" fill="#d97706" fillOpacity={0.25} />
                      <Legend wrapperStyle={{ fontSize: 10, marginTop: 10 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                <div className="border-t border-slate-100 pt-3 mt-2 flex justify-around text-center text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px] block uppercase font-semibold">Phase (50kHz)</span>
                    <span className="font-bold text-slate-800">
                      {latestReading ? latestReading.bioimpedance.phase[2] : "-6.8"}°
                    </span>
                  </div>
                  <div className="border-l border-slate-100" />
                  <div>
                    <span className="text-slate-400 text-[10px] block uppercase font-semibold">Magnitude (50k)</span>
                    <span className="font-bold text-slate-800">
                      {latestReading ? latestReading.bioimpedance.mag[2] : "382"} Ω
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: 2. AI Diagnostics */}
        {activeTab === "monitoring" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {/* Quick Stats Grid */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center gap-3">
              <div className="p-3 rounded-lg bg-emerald-50 text-emerald-600">
                <Heart className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Pulse Rate</span>
                <span className="text-lg font-bold text-slate-800">{latestReading?.optical?.heart_rate || "72"} <span className="text-xs text-slate-500 font-normal">bpm</span></span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center gap-3">
              <div className="p-3 rounded-lg bg-teal-50 text-teal-600">
                <Droplet className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Oxygen (SpO₂)</span>
                <span className="text-lg font-bold text-slate-800">{latestReading?.optical?.spo2 || "98"} <span className="text-xs text-slate-500 font-normal">%</span></span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center gap-3">
              <div className="p-3 rounded-lg bg-orange-50 text-orange-600">
                <Thermometer className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Body Temp</span>
                <span className="text-lg font-bold text-slate-800">{latestReading?.temperature?.body_temp || "36.6"} <span className="text-xs text-slate-500 font-normal">°C</span></span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center gap-3">
              <div className="p-3 rounded-lg bg-slate-50 text-slate-600">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Contact Quality</span>
                <span className="text-lg font-bold text-slate-800">{latestReading?.pressure?.contact_quality || "97"} <span className="text-xs text-slate-500 font-normal">%</span></span>
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: 2. AI Diagnostics (Detailed view) */}
        {activeTab === "analysis" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left side: eGFR Gauge and Stage Info */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm flex flex-col justify-between gap-6">
              <div>
                <h3 className="text-base font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                  <Cpu className="w-5 h-5 text-teal-600" /> Physiological AI Analysis
                </h3>
                <p className="text-xs text-slate-500">
                  Model Consensus based on active 60-second vital aggregation and NHANES correlation.
                </p>
              </div>

              {/* Major eGFR Indicator Block */}
              <div className="flex flex-col md:flex-row items-center justify-around gap-6 py-6 border-y border-slate-100">
                
                {/* Radial Gauge */}
                <div className="relative w-44 h-44 flex items-center justify-center">
                  {/* Outer circle track */}
                  <svg className="w-full h-full transform -rotate-90">
                    <circle 
                      cx="88" cy="88" r="76" 
                      stroke="#f1f5f9" strokeWidth="14" fill="transparent" 
                    />
                    <circle 
                      cx="88" cy="88" r="76" 
                      stroke={getEgfrGaugeColor(latestPrediction?.egfr || 104)} 
                      strokeWidth="14" fill="transparent" 
                      strokeDasharray={2 * Math.PI * 76}
                      strokeDashoffset={2 * Math.PI * 76 * (1 - Math.min(120, latestPrediction?.egfr || 104) / 120)}
                      strokeLinecap="round"
                    />
                  </svg>
                  
                  {/* Inside dial text */}
                  <div className="absolute text-center">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Predicted eGFR</span>
                    <span className="text-4xl font-extrabold text-slate-800 block leading-none">
                      {latestPrediction ? Math.round(latestPrediction.egfr) : "104"}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-1 font-medium block">mL/min/1.73m²</span>
                  </div>
                </div>

                {/* Staging Summary */}
                <div className="flex flex-col gap-4 max-w-sm">
                  <div>
                    <span className="text-xs text-slate-400 font-bold block mb-1">CKD Classification</span>
                    <span className={`text-base font-bold px-3 py-1 border rounded-lg ${getStageColorClass(latestPrediction?.ckdStage || "Stage 1")}`}>
                      {latestPrediction?.ckdStage || "Stage 1"}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 font-bold block mb-1">Kidney Risk Level</span>
                    <span className={`text-xs font-extrabold px-3 py-1 rounded-lg ${getRiskColorClass(latestPrediction?.riskLevel || "Low Risk")}`}>
                      {latestPrediction?.riskLevel || "Low Risk"}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 font-bold block mb-0.5">Diagnostic Confidence</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-slate-100 rounded-full h-2">
                        <div 
                          className="bg-teal-500 h-2 rounded-full transition-all" 
                          style={{ width: `${latestPrediction?.confidence || 93}%` }} 
                        />
                      </div>
                      <span className="text-xs font-semibold text-slate-700">
                        {latestPrediction?.confidence || "93.4"}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Explanatory text */}
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                <h4 className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-1">
                  <Info className="w-4 h-4 text-teal-600" /> Explanation & Diagnostic Insights
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {latestPrediction?.explanation || "Kidney function is estimated as normal. No physiological flags for cellular fluid retention or chronic cardiac stressors are present in the sensor buffer window."}
                </p>
              </div>
            </div>

            {/* Right side: Estimated Clinical Proxies */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-teal-600" /> Estimated Clinical Proxies
                </h3>
                <p className="text-xs text-slate-500 mb-4">
                  The ML model was trained on medical variables. Here is how the AI mapped your wearable features onto estimated clinical proxies:
                </p>
              </div>

              <div className="flex-1 flex flex-col justify-around gap-4 py-2">
                {/* Proxy 1: BMI */}
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">Estimated BMI</span>
                    <span className="text-[10px] text-slate-400">Mapped from bioimpedance magnitude</span>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-extrabold text-slate-800 block">
                      {latestPrediction?.bmi || "24.5"} <span className="text-xs text-slate-500 font-normal">kg/m²</span>
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      (latestPrediction?.bmi || 24.5) < 25 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}>
                      {(latestPrediction?.bmi || 24.5) < 25 ? "Normal Weight" : "Elevated Volume / Weight"}
                    </span>
                  </div>
                </div>

                {/* Proxy 2: BP */}
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">Estimated Blood Pressure</span>
                    <span className="text-[10px] text-slate-400">Mapped from HR, HRV & Hydration</span>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-extrabold text-slate-800 block">
                      {latestPrediction ? `${Math.round(latestPrediction.sbp)}/${Math.round(latestPrediction.dbp)}` : "118/74"} <span className="text-xs text-slate-500 font-normal">mmHg</span>
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      (latestPrediction?.sbp || 118) < 130 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                    }`}>
                      {(latestPrediction?.sbp || 118) < 120 ? "Normal" : (latestPrediction?.sbp || 118) < 130 ? "Elevated" : "Hypertension Proxy"}
                    </span>
                  </div>
                </div>

                {/* Proxy 3: Fluid index */}
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">Hydration status (Fluid Index)</span>
                    <span className="text-[10px] text-slate-400">Impedance ratio index</span>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-extrabold text-slate-800 block">
                      {latestReading ? (latestReading.bioimpedance.R[4] / latestReading.bioimpedance.R[1]).toFixed(3) : "0.762"}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      (latestReading ? latestReading.bioimpedance.R[4] / latestReading.bioimpedance.R[1] : 0.76) > 0.74 
                        ? "bg-emerald-50 text-emerald-700" 
                        : "bg-rose-50 text-rose-700"
                    }`}>
                      {(latestReading ? latestReading.bioimpedance.R[4] / latestReading.bioimpedance.R[1] : 0.76) > 0.74 
                        ? "Optimal Hydration" 
                        : "Potential Congestion / Edema"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 text-[10px] text-slate-400 leading-tight">
                * Proxies represent physiological scaling calculated to map biological wearable data onto NHANES clinical datasets. They should not be used as clinical diagnostic measurements.
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: 3. Reports & History */}
        {activeTab === "history" && (
          <div className="flex flex-col gap-6">
            
            {/* Progression Chart */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-teal-600" /> eGFR Progression Timeline
              </h3>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[...predictionsHistory].reverse()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={(val) => formatTime(val)} 
                      stroke="#94a3b8"
                      fontSize={10}
                    />
                    <YAxis stroke="#475569" fontSize={10} domain={[0, 130]} />
                    <Tooltip 
                      labelFormatter={(val) => new Date(val).toLocaleTimeString()}
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                    />
                    <Legend textAnchor="middle" wrapperStyle={{ fontSize: 11 }} />
                    <Line 
                      type="monotone" 
                      dataKey="egfr" 
                      name="Estimated eGFR (mL/min/1.73m²)" 
                      stroke="#0d9488" 
                      strokeWidth={3}
                      activeDot={{ r: 8 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="sbp" 
                      name="Systolic BP Proxy (mmHg)" 
                      stroke="#f59e0b" 
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Historical Records Table */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-teal-600" /> Past Kidney Health Predictions
                </h3>
                <span className="text-xs text-slate-500 font-medium">Showing last {predictionsHistory.length} readings</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-semibold">
                    <tr>
                      <th className="px-6 py-3">Timestamp</th>
                      <th className="px-6 py-3">Profile Mode</th>
                      <th className="px-6 py-3">eGFR</th>
                      <th className="px-6 py-3">CKD Stage</th>
                      <th className="px-6 py-3">Risk Level</th>
                      <th className="px-6 py-3">SBP/DBP Proxy</th>
                      <th className="px-6 py-3">BMI Proxy</th>
                      <th className="px-6 py-3">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {predictionsHistory.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="px-6 py-10 text-center text-slate-400 italic">
                          No predictions recorded yet. Ingest sensor data to trigger analysis.
                        </td>
                      </tr>
                    ) : (
                      predictionsHistory.map((pred) => (
                        <tr key={pred.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-slate-500">{new Date(pred.timestamp).toLocaleTimeString()}</td>
                          <td className="px-6 py-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${
                              pred.profile === "healthy" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-700 border border-rose-100"
                            }`}>
                              {pred.profile}
                            </span>
                          </td>
                          <td className="px-6 py-3 font-extrabold text-teal-600">{pred.egfr}</td>
                          <td className="px-6 py-3 font-semibold">{pred.ckdStage}</td>
                          <td className="px-6 py-3">
                            <span className={`px-2 py-0.5 rounded-full font-medium ${
                              pred.riskLevel === "Low Risk" ? "bg-emerald-50 text-emerald-700" : pred.riskLevel === "Moderate Risk" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"
                            }`}>
                              {pred.riskLevel}
                            </span>
                          </td>
                          <td className="px-6 py-3 font-mono">{Math.round(pred.sbp)}/{Math.round(pred.dbp)}</td>
                          <td className="px-6 py-3 font-mono">{pred.bmi}</td>
                          <td className="px-6 py-3 font-bold text-slate-600">{pred.confidence}%</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="bg-slate-950 text-slate-500 py-6 border-t border-slate-900 mt-12 text-center text-xs">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p>© 2026 Renal Sense Project. AI Research Feasibility Study.</p>
          <div className="flex gap-4">
            <span className="hover:text-slate-400 transition cursor-pointer">Protocol Spec</span>
            <span className="hover:text-slate-400 transition cursor-pointer">Hardware Seam</span>
            <span className="hover:text-slate-400 transition cursor-pointer">NHANES Clinician Guide</span>
          </div>
        </div>
      </footer>

      {/* PATIENT CONFIG MODAL */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100 relative">
            <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-1.5">
              <User className="w-5 h-5 text-teal-600" /> Patient Profile Settings
            </h3>
            
            <form onSubmit={saveConfiguration} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Patient Name</label>
                <input 
                  type="text" 
                  value={tempName} 
                  onChange={(e) => setTempName(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500" 
                  placeholder="Jane Doe"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Age (Years)</label>
                  <input 
                    type="number" 
                    value={tempAge} 
                    onChange={(e) => setTempAge(e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500" 
                    min="18" max="110"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Biological Gender</label>
                  <select 
                    value={tempGender}
                    onChange={(e) => setTempGender(e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500"
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Telemetry Ingestion Mode</label>
                <select 
                  value={tempMode}
                  onChange={(e) => setTempMode(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500"
                >
                  <option value="simulator">Simulation Loop (Stand-in)</option>
                  <option value="hardware">Real Hardware (WiFi/Serial Ingest)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  * Hardware mode pauses the local random walk simulation so the gateway can listen exclusively for serial or external WiFi ESP32 POST packets.
                </span>
              </div>

              <div className="flex justify-end gap-3 mt-4 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="text-xs px-3.5 py-2 font-medium text-slate-500 hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="text-xs px-4 py-2 font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-xs"
                >
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
