import serial
import json
import time
import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import butter, filtfilt

# -------- CONFIG --------
SERIAL_PORT = "COM6"      # change if needed
BAUD_RATE = 9600
FS = 100                 # ECG sampling rate
WINDOW_SEC = 5
BUFFER_SIZE = FS * WINDOW_SEC
# -----------------------

# -------- ECG FILTER --------
def bandpass_filter(signal, fs, lowcut=0.5, highcut=40):
    nyq = 0.5 * fs
    b, a = butter(2, [lowcut/nyq, highcut/nyq], btype="band")
    return filtfilt(b, a, signal)

ecg_buffer = []

# Open serial
ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
time.sleep(2)

print("📈 Live ECG waveform (Python) started")

# Setup plot
plt.ion()
fig, ax = plt.subplots(figsize=(10, 4))
line, = ax.plot([], [], color="green", linewidth=1)

ax.set_title("Live ECG Waveform")
ax.set_xlabel("Samples")
ax.set_ylabel("ECG Amplitude")
ax.set_xlim(0, BUFFER_SIZE)
ax.set_ylim(-8000, 8000)

while True:
    try:
        raw = ser.readline().decode(errors="ignore").strip()
        if not raw.startswith("{"):
            continue

        data = json.loads(raw)
        ecg = data["ecg_raw"]

        ecg_buffer.append(ecg)
        if len(ecg_buffer) > BUFFER_SIZE:
            ecg_buffer.pop(0)

        if len(ecg_buffer) < FS:
            continue

        ecg_np = np.array(ecg_buffer, dtype=np.float64)
        ecg_np -= np.mean(ecg_np)

        # Apply ECG filter
        ecg_np = bandpass_filter(ecg_np, FS)

        # Gain for visibility
        ecg_np *= 4

        # Update plot
        line.set_ydata(ecg_np)
        line.set_xdata(range(len(ecg_np)))
        ax.set_xlim(0, len(ecg_np))

        plt.pause(0.001)

    except KeyboardInterrupt:
        print("\n🛑 Stopped")
        break
    except Exception as e:
        print("Error:", e)

ser.close()
plt.ioff()
plt.show()
