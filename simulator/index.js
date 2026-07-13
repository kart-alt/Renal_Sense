import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3002;
const BACKEND_INGEST_URL = "http://localhost:3001/api/sensors/ingest";

// Current simulation profile: "healthy" or "ckd-risk"
let currentProfile = "healthy";

// Bounded Random Walk helper
function randomWalk(current, step, min, max) {
  const change = (Math.random() - 0.5) * step;
  let next = current + change;
  if (next < min) next = min;
  if (next > max) next = max;
  return parseFloat(next.toFixed(2));
}

// Running states for smooth random walks
const telemetryState = {
  healthy: {
    hr: 68,
    hrv: 58,
    spo2: 98.2,
    temp: 36.6,
    motion_mag: 0.05,
    motion_score: 10,
    pressure: 97,
    // 5 frequencies: 1kHz, 10kHz, 50kHz, 100kHz, 200kHz
    R: [450, 420, 380, 350, 320],
    X: [-10, -25, -45, -35, -20]
  },
  "ckd-risk": {
    hr: 86,
    hrv: 28,
    spo2: 95.1,
    temp: 37.1,
    motion_mag: 0.02,
    motion_score: 3,
    pressure: 95,
    // Edema/fluid-overload profile: lower resistance and significantly lower reactance (lower phase angle)
    R: [400, 370, 330, 300, 270],
    X: [-5, -12, -22, -18, -10]
  }
};

// Expose profile config endpoints
app.post("/simulator/profile", (req, res) => {
  const { profile } = req.body;
  if (profile === "healthy" || profile === "ckd-risk") {
    currentProfile = profile;
    console.log(`👤 Simulator profile switched to: ${currentProfile.toUpperCase()}`);
    return res.json({ success: true, profile: currentProfile });
  }
  return res.status(400).json({ error: "Invalid profile name" });
});

app.get("/simulator/profile", (req, res) => {
  res.json({ profile: currentProfile });
});

// Telemetry loop
setInterval(async () => {
  const profile = currentProfile;
  const state = telemetryState[profile];

  // Update states using random walk
  if (profile === "healthy") {
    state.hr = randomWalk(state.hr, 1.5, 60, 78);
    state.hrv = randomWalk(state.hrv, 2.0, 48, 68);
    state.spo2 = randomWalk(state.spo2, 0.2, 97.0, 99.5);
    state.temp = randomWalk(state.temp, 0.05, 36.4, 36.8);
    state.motion_mag = randomWalk(state.motion_mag, 0.01, 0.02, 0.15);
    state.motion_score = randomWalk(state.motion_score, 1.0, 5, 20);
    state.pressure = randomWalk(state.pressure, 0.5, 92, 100);

    // Bioimpedance R & X walks
    state.R = state.R.map((r, i) => randomWalk(r, 2.0, [430, 400, 360, 330, 300][i], [470, 440, 400, 370, 340][i]));
    state.X = state.X.map((x, i) => randomWalk(x, 1.0, [-12, -28, -50, -38, -24][i], [-8, -22, -40, -32, -16][i]));
  } else {
    // CKD-risk
    state.hr = randomWalk(state.hr, 2.0, 78, 98);
    state.hrv = randomWalk(state.hrv, 1.5, 15, 38);
    state.spo2 = randomWalk(state.spo2, 0.3, 93.5, 96.5);
    state.temp = randomWalk(state.temp, 0.08, 36.8, 37.4);
    state.motion_mag = randomWalk(state.motion_mag, 0.005, 0.01, 0.05);
    state.motion_score = randomWalk(state.motion_score, 0.5, 1, 8);
    state.pressure = randomWalk(state.pressure, 0.8, 88, 98);

    // Bioimpedance R & X walks
    state.R = state.R.map((r, i) => randomWalk(r, 2.0, [380, 350, 310, 280, 250][i], [420, 390, 350, 320, 290][i]));
    state.X = state.X.map((x, i) => randomWalk(x, 0.8, [-8, -16, -26, -22, -14][i], [-3, -8, -18, -14, -7][i]));
  }

  // Calculate phase angle and magnitude for each frequency
  // phase = atan2(X, R) * 180 / PI
  // mag = sqrt(R^2 + X^2)
  const freqs = [1000, 10000, 50000, 100000, 200000];
  const phase = [];
  const mag = [];

  for (let i = 0; i < freqs.length; i++) {
    const r = state.R[i];
    const x = state.X[i];
    const ph = Math.atan2(x, r) * (180 / Math.PI);
    const m = Math.sqrt(r * r + x * x);
    phase.push(parseFloat(ph.toFixed(2)));
    mag.push(parseFloat(m.toFixed(2)));
  }

  // Construct telemetry packet
  const packet = {
    timestamp: new Date().toISOString(),
    profile,
    bioimpedance: {
      freqs,
      R: state.R,
      X: state.X,
      phase,
      mag
    },
    ecg: {
      heart_rate: parseFloat((state.hr + (Math.random() - 0.5) * 0.5).toFixed(1)), // add subtle instant jitter
      hrv: state.hrv,
      rr_interval: parseFloat((60 / state.hr).toFixed(3)),
      rhythm_stable: profile === "healthy" ? Math.random() > 0.05 : Math.random() > 0.25
    },
    optical: {
      heart_rate: parseFloat((state.hr + (Math.random() - 0.5) * 0.8).toFixed(1)),
      spo2: parseFloat(state.spo2.toFixed(1)),
      perfusion_index: profile === "healthy" ? randomWalk(2.2, 0.1, 1.8, 2.6) : randomWalk(1.2, 0.1, 0.8, 1.6)
    },
    temperature: {
      body_temp: parseFloat(state.temp.toFixed(2))
    },
    motion: {
      accel_gyro_mag: parseFloat(state.motion_mag.toFixed(3)),
      activity_score: parseFloat(state.motion_score.toFixed(1))
    },
    pressure: {
      contact_quality: parseFloat(state.pressure.toFixed(1))
    }
  };

  // POST packet to backend
  try {
    const response = await fetch(BACKEND_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(packet)
    });
    
    if (response.ok) {
      console.log(`📤 Telemetry sent successfully (${profile} profile, HR: ${packet.ecg.heart_rate}, Phase50k: ${packet.bioimpedance.phase[2]}°)`);
    } else {
      console.warn(`⚠️ Ingest response error: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.log(`🔌 Backend ingest offline. Awaiting connection...`);
  }
}, 1500);

app.listen(PORT, () => {
  console.log(`🚀 Simulator config API listening on port ${PORT}`);
  console.log(`📝 Default profile: ${currentProfile.toUpperCase()}`);
});
