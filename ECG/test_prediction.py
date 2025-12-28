import numpy as np
import sys
sys.path.insert(0, 'ECG')
from ml_model import predict_kidney

# ---- SAMPLE PATIENT ----
heart_rate = 72
temperature = 36.6
spo2 = 98
motion_score = 15
# ------------------------

egfr, stage, risk = predict_kidney(
    heart_rate,
    temperature,
    spo2,
    motion_score
)

print("Prediction result:")
print("Heart Rate:", heart_rate)
print("Temperature:", temperature)
print("SpO2:", spo2)
print("Motion:", motion_score)
print("eGFR:", round(egfr, 2))
print("Stage:", stage)
print("Risk:", risk)
