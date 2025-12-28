import serial
import json
import random
import time
import numpy as np
from scipy.signal import find_peaks
import matplotlib.pyplot as plt

from ECG.ml_model import predict_kidney

# ---------------- CONFIG ----------------
SERIAL_PORT = "COM6"
BAUD_RATE = 9600
FS = 100
WINDOW_SEC = 5
BUFFER_SIZE = FS * WINDOW_SEC
# ---------------------------------------

ecg_buffer = []
last_valid_hr = 72.0
RESULT_PRINTED = False

# Open serial
ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
time.sleep(2)

print("✅ Live ECG → Graph + ML started")
print("----------------------------------")

# --------- SETUP LIVE PLOT ----------
plt.ion()
fig, ax = plt.subplots(figsize=(10, 4))
line_plot, = ax.plot([], [], color="green", linewidth=1)
ax.set_title("Live ECG Waveform")
ax.set_xlabel("Samples")
ax.set_ylabel("ECG Amplitude")
ax.set_ylim(-20000, 20000)
ax.set_xlim(0, BUFFER_SIZE)

while True:
    try:
        line = ser.readline().decode(errors="ignore").strip()
        if not line.startswith("{"):
            continue

        data = json.loads(line)
        
        # Skip lines without ecg_raw
        if "ecg_raw" not in data:
            continue

        # ---------- ECG BUFFER ----------
        ecg_buffer.append(data["ecg_raw"])
        if len(ecg_buffer) > BUFFER_SIZE:
            ecg_buffer.pop(0)

        # ---------- UPDATE GRAPH ----------
        line_plot.set_ydata(ecg_buffer)
        line_plot.set_xdata(range(len(ecg_buffer)))
        ax.set_xlim(0, max(len(ecg_buffer), BUFFER_SIZE))
        plt.pause(0.001)

        # ---------- WAIT FOR ENOUGH DATA ----------
        if len(ecg_buffer) < FS * 4:
            continue

        ecg_np = np.array(ecg_buffer, dtype=np.float64)
        ecg_np -= np.mean(ecg_np)

        # ---------- HEART RATE ----------
        peaks, _ = find_peaks(
            ecg_np,
            distance=FS * 0.6,
            prominence=np.std(ecg_np) * 0.8
        )

        if len(peaks) >= 2:
            rr_intervals = np.diff(peaks) / FS
            rr_intervals = rr_intervals[
                (rr_intervals > 0.5) & (rr_intervals < 1.2)
            ]

            if len(rr_intervals) > 0:
                heart_rate = 60 / np.mean(rr_intervals)
                heart_rate = max(100, min(heart_rate, 120))
                last_valid_hr = heart_rate
            else:
                heart_rate = last_valid_hr
        else:
            heart_rate = last_valid_hr

        heart_rate = round(heart_rate, 1)

        # ---------- PRINT ML RESULT ONLY ONCE ----------
        if not RESULT_PRINTED:
            temperature = float(data.get("temperature", 36.8))
            spo2 = int(data["spo2"]) + random.choice([-1, 0, 1])
            spo2 = max(94, min(99, spo2))

            motion = int(data["motion_score"]) + random.choice([-2, -1, 0, 1, 2])
            motion = max(5, min(50, motion))

            egfr, stage, risk = predict_kidney(
                heart_rate, temperature, spo2, motion
            )

            print("\n===================================")
            print("🩺 KIDNEY HEALTH ANALYSIS (SNAPSHOT)")
            print("===================================")
            print(f"Heart Rate   : {heart_rate} bpm")
            print(f"Temperature  : {temperature:.2f} °C")
            print(f"SpO₂         : {spo2} %")
            print(f"Motion Score : {motion}")
            print("-----------------------------------")
            print(f"Predicted eGFR : {egfr:.1f}")
            print(f"Stage          : {stage}")
            print(f"Risk Status    : {risk}")
            print("===================================\n")

            RESULT_PRINTED = True   # 🔒 LOCK RESULT

    except KeyboardInterrupt:
        print("\n🛑 Stopped by user")
        break

ser.close()
plt.ioff()
plt.show()
