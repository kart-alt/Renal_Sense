import sys
sys.path.insert(0, 'ECG')
from ml_model import predict_kidney

tests = [
    (65, 36.5, 99, 10),
    (75, 36.8, 97, 20),
    (85, 37.0, 95, 30),
    (95, 37.4, 93, 40)
]

for hr, temp, spo2, motion in tests:
    egfr, stage, risk = predict_kidney(hr, temp, spo2, motion)
    print(
        f"HR={hr}, Temp={temp}, SpO2={spo2}, Motion={motion} "
        f"→ eGFR={egfr:.1f}, {stage}, Risk={risk}"
    )
