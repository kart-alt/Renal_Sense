import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const app = express();
const server = createServer(app);

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const prisma = new PrismaClient();
const PORT = 3001;
const ML_SERVICE_URL = "http://localhost:5000/predict";
const SIMULATOR_CONFIG_URL = "http://localhost:3002/simulator/profile";

app.use(cors());
app.use(express.json());

// In-Memory Config State
let patientConfig = {
  name: "Jane Doe",
  age: 58,
  gender: "female", // "male" or "female"
  mode: "simulator", // "simulator" or "hardware"
  profile: "healthy" // "healthy" or "ckd-risk"
};

// In-Memory Telemetry Buffer (for sliding window feature engineering)
let telemetryBuffer = [];
const WINDOW_DURATION_MS = 60 * 1000; // 60 seconds sliding window

// REST: Ingest raw sensor readings
app.post("/api/sensors/ingest", async (req, res) => {
  const packet = req.body;

  try {
    // Validate packet structure
    if (!packet || !packet.bioimpedance || !packet.ecg || !packet.optical) {
      console.warn("⚠️ Received malformed sensor packet. Dropped.");
      return res.status(400).json({ error: "Malformed sensor packet" });
    }

    // Save raw reading to SQLite
    const savedReading = await prisma.reading.create({
      data: {
        timestamp: new Date(packet.timestamp || Date.now()),
        profile: packet.profile || patientConfig.profile,
        rawPayload: JSON.stringify(packet),
        heartRate: packet.ecg.heart_rate || 0,
        spo2: packet.optical.spo2 || 0,
        temperature: packet.temperature.body_temp || 0,
        activityScore: packet.motion.activity_score || 0,
        contactQuality: packet.pressure.contact_quality || 0
      }
    });

    // Broadcast live telemetry packet to clients
    io.emit("live-reading", packet);

    // Push to sliding window buffer
    telemetryBuffer.push({
      timestamp: Date.now(),
      data: packet
    });

    // Trigger sliding window feature aggregation & prediction
    processAggregationAndPrediction(packet.profile || patientConfig.profile);

    return res.status(201).json({ success: true, id: savedReading.id });
  } catch (error) {
    console.error("❌ Error ingesting sensor packet:", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// REST: Latest raw reading
app.get("/api/readings/latest", async (req, res) => {
  try {
    const latest = await prisma.reading.findFirst({
      orderBy: { timestamp: "desc" }
    });
    return res.json(latest ? JSON.parse(latest.rawPayload) : null);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// REST: Readings history
app.get("/api/readings/history", async (req, res) => {
  try {
    const range = req.query.range || "1h";
    let since = new Date();
    if (range === "5m") since.setMinutes(since.getMinutes() - 5);
    else if (range === "15m") since.setMinutes(since.getMinutes() - 15);
    else if (range === "1h") since.setHours(since.getHours() - 1);
    else if (range === "24h") since.setHours(since.getHours() - 24);
    else since.setHours(since.getHours() - 1); // default 1h

    const readings = await prisma.reading.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: "asc" }
    });

    const parsedReadings = readings.map(r => JSON.parse(r.rawPayload));
    return res.json(parsedReadings);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// REST: Latest prediction
app.get("/api/predictions/latest", async (req, res) => {
  try {
    const latest = await prisma.prediction.findFirst({
      orderBy: { timestamp: "desc" }
    });
    return res.json(latest);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// REST: Predictions history
app.get("/api/predictions/history", async (req, res) => {
  try {
    const history = await prisma.prediction.findMany({
      orderBy: { timestamp: "desc" },
      take: 50 // Limit to last 50 predictions
    });
    return res.json(history);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// REST: Config (Get & Post)
app.get("/api/config", (req, res) => {
  res.json(patientConfig);
});

app.post("/api/config", async (req, res) => {
  const { name, age, gender, mode, profile } = req.body;
  
  if (name !== undefined) patientConfig.name = name;
  if (age !== undefined) patientConfig.age = parseInt(age);
  if (gender !== undefined) patientConfig.gender = gender;
  if (mode !== undefined) patientConfig.mode = mode;
  
  if (profile !== undefined && (profile === "healthy" || profile === "ckd-risk")) {
    patientConfig.profile = profile;
    
    // Sync with simulator if running in simulator mode
    if (patientConfig.mode === "simulator") {
      try {
        await fetch(SIMULATOR_CONFIG_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile })
        });
      } catch (err) {
        console.warn("⚠️ Could not contact simulator to sync profile. Is the simulator running?");
      }
    }
  }

  console.log("👤 Updated Patient Configuration:", patientConfig);
  io.emit("config-updated", patientConfig);
  res.json(patientConfig);
});

// Feature Engineering & ML Service Dispatcher
async function processAggregationAndPrediction(activeProfile) {
  const now = Date.now();
  // Filter sliding window (keep only last 60 seconds)
  telemetryBuffer = telemetryBuffer.filter(p => now - p.timestamp < WINDOW_DURATION_MS);

  if (telemetryBuffer.length === 0) return;

  // Extract raw packets
  const packets = telemetryBuffer.map(p => p.data);

  // Helper: Mean calculation
  const mean = arr => arr.reduce((sum, val) => sum + val, 0) / arr.length;
  // Helper: Variance calculation
  const variance = (arr, avg) => {
    const meanVal = avg !== undefined ? avg : mean(arr);
    return arr.reduce((sum, val) => sum + Math.pow(val - meanVal, 2), 0) / arr.length;
  };

  // 1. Gather lists of raw values across all packets in the window
  const lists = {
    hr_ecg: [],
    hrv: [],
    hr_opt: [],
    spo2: [],
    perf: [],
    temp: [],
    act: [],
    mot_mag: [],
    pres: [],
    // Frequency arrays (5 freqs)
    R: [[], [], [], [], []],
    X: [[], [], [], [], []],
    phase: [[], [], [], [], []],
    mag: [[], [], [], [], []],
    hydration_ratios: []
  };

  packets.forEach(p => {
    lists.hr_ecg.push(p.ecg.heart_rate);
    lists.hrv.push(p.ecg.hrv);
    lists.hr_opt.push(p.optical.heart_rate);
    lists.spo2.push(p.optical.spo2);
    lists.perf.push(p.optical.perfusion_index);
    lists.temp.push(p.temperature.body_temp);
    lists.act.push(p.motion.activity_score);
    lists.mot_mag.push(p.motion.accel_gyro_mag);
    lists.pres.push(p.pressure.contact_quality);

    // Freq values
    for (let f = 0; f < 5; f++) {
      lists.R[f].push(p.bioimpedance.R[f]);
      lists.X[f].push(p.bioimpedance.X[f]);
      lists.phase[f].push(p.bioimpedance.phase[f]);
      lists.mag[f].push(p.bioimpedance.mag[f]);
    }
    // Hydration Ratio: R_200k / R_10k (index 4 / index 1)
    lists.hydration_ratios.push(p.bioimpedance.R[4] / p.bioimpedance.R[1]);
  });

  // Calculate 31 features
  const features = {};

  // Bioimpedance features at each frequency
  for (let f = 0; f < 5; f++) {
    features[`mean_R_freq_${f+1}`] = mean(lists.R[f]);
    features[`mean_X_freq_${f+1}`] = mean(lists.X[f]);
    features[`mean_phase_freq_${f+1}`] = mean(lists.phase[f]);
    features[`mean_mag_freq_${f+1}`] = mean(lists.mag[f]);
  }

  // Bioimpedance variance and hydration
  const mean_R_50k = mean(lists.R[2]);
  const mean_X_50k = mean(lists.X[2]);
  features.var_R_50k = variance(lists.R[2], mean_R_50k);
  features.var_X_50k = variance(lists.X[2], mean_X_50k);
  features.hydration_index = mean(lists.hydration_ratios);

  // Sensor averages
  const mean_hr_ecg = mean(lists.hr_ecg);
  const mean_hr_opt = mean(lists.hr_opt);
  features.mean_hr = (mean_hr_ecg + mean_hr_opt) / 2;
  features.hrv = mean(lists.hrv);
  
  // Rhythm stability: fraction of stable packets
  const stableCount = packets.filter(p => p.ecg.rhythm_stable).length;
  features.rhythm_stability = stableCount / packets.length;

  features.mean_spo2 = mean(lists.spo2);
  features.mean_perfusion = mean(lists.perf);

  const mean_temp = mean(lists.temp);
  features.mean_temp = mean_temp;
  features.var_temp = variance(lists.temp, mean_temp);

  features.mean_activity = mean(lists.act);
  features.mean_motion_mag = mean(lists.mot_mag);
  features.mean_pressure = mean(lists.pres);

  // Call the Flask ML prediction microservice
  try {
    const payload = {
      age: patientConfig.age,
      gender: patientConfig.gender,
      features: features
    };

    const response = await fetch(ML_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`ML Service responded with status ${response.status}`);
    }

    const prediction = await response.json();
    
    // Save prediction results to SQLite database
    const savedPrediction = await prisma.prediction.create({
      data: {
        profile: activeProfile,
        egfr: prediction.eGFR,
        ckdStage: prediction.ckd_stage,
        riskLevel: prediction.risk_level,
        confidence: prediction.confidence,
        explanation: prediction.explanation,
        age: patientConfig.age,
        gender: patientConfig.gender,
        bmi: prediction.bmi,
        sbp: prediction.sbp,
        dbp: prediction.dbp
      }
    });

    // Broadcast new prediction via Socket.IO to connected clients
    io.emit("new-prediction", savedPrediction);
  } catch (error) {
    console.warn("⚠️ ML prediction call skipped or failed. Ensure Flask service is running.", error.message);
  }
}

// Socket Connection handling
io.on("connection", (socket) => {
  console.log(`🔌 Client connected to dashboard socket: ${socket.id}`);
  
  // Send current configuration to newly connected clients
  socket.emit("config-updated", patientConfig);

  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Graceful cleanup
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit();
});

server.listen(PORT, () => {
  console.log(`🚀 Express Backend server listening on port ${PORT}`);
});
