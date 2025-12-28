import joblib

egfr_model = joblib.load("ECG/egfr_model.pkl")
egfr_scaler = joblib.load("ECG/egfr_scaler.pkl")
kidney_model = joblib.load("ECG/kidney_model.pkl")

print("✅ All models loaded successfully")
