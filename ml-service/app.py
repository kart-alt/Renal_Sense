import os
import joblib
import numpy as np
from flask import Flask, request, jsonify

app = Flask(__name__)

MODEL_PATH = "kidney_model.pkl"
SCALER_PATH = "kidney_scaler.pkl"

# Global references for loaded model/scaler
model = None
scaler = None

def load_models():
    global model, scaler
    if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH):
        try:
            model = joblib.load(MODEL_PATH)
            scaler = joblib.load(SCALER_PATH)
            print("[INFO] ML Model and Scaler loaded successfully.")
        except Exception as e:
            print(f"[ERROR] Error loading models: {e}")
    else:
        print("[WARNING] Model files not found. Run train.py first.")

# Map wearable aggregated features to clinical proxies
def map_wearable_to_clinical(age, gender, features):
    # 1. Age (directly from config)
    # 2. Gender (1 = Male, 2 = Female)
    gender_code = 2.0 if gender.lower() == "female" else 1.0
    
    # 3. BMI estimation
    # Bioimpedance magnitude at 50kHz (mean_mag_freq_3) and hydration_index
    # Healthy baseline mag ~382.8 ohms, hydration ~0.76 -> BMI ~24.5
    # CKD baseline mag ~330.8 ohms (fluid overload/high conduction), hydration ~0.73 -> BMI ~28.5 (fluid weight)
    mean_mag = features.get("mean_mag_freq_3", 380.0)
    hydration = features.get("hydration_index", 0.75)
    
    bmi_base = 24.0
    # Conductive volume increase (lower magnitude) maps to higher fluid-induced weight/BMI proxy
    if mean_mag < 360:
        bmi_offset = (360 - mean_mag) * 0.12 + (0.75 - hydration) * 20.0
    else:
        bmi_offset = (360 - mean_mag) * 0.03
        
    estimated_bmi = bmi_base + bmi_offset
    estimated_bmi = max(18.0, min(48.0, estimated_bmi))
    
    # 4. SBP (Systolic Blood Pressure) estimation
    # Base SBP = 118 mmHg
    # Modified by Heart Rate, HRV (autonomic strain), SpO2, and hydration index (fluid overload)
    mean_hr = features.get("mean_hr", 72.0)
    hrv = features.get("hrv", 55.0)
    spo2 = features.get("mean_spo2", 98.0)
    
    hr_effect = (mean_hr - 70.0) * 0.75
    hrv_effect = (55.0 - hrv) * 0.55
    spo2_effect = (98.0 - spo2) * 5.0 if spo2 < 98.0 else 0.0
    
    # Hydration index (lower R_200k/R_10k represents more extracellular volume -> blood pressure load)
    hydration_effect = (0.76 - hydration) * 180.0 if hydration < 0.76 else 0.0
    
    estimated_sbp = 118.0 + hr_effect + hrv_effect + spo2_effect + hydration_effect
    estimated_sbp = max(90.0, min(190.0, estimated_sbp))
    
    # 5. DBP (Diastolic Blood Pressure) estimation
    # Typically maps linearly to SBP
    estimated_dbp = estimated_sbp * 0.63
    estimated_dbp = max(55.0, min(112.0, estimated_dbp))
    
    return [age, gender_code, estimated_bmi, estimated_sbp, estimated_dbp]

# Staging Staging Logic
def determine_stage_and_risk(egfr):
    if egfr >= 90.0:
        return {
            "stage": "Stage 1",
            "risk": "Low Risk",
            "explanation": "Kidney function is normal. Physiological metrics (healthy bioimpedance phase angle, normal blood pressure and SpO2 proxies) indicate optimal renal filtration and healthy fluid clearance."
        }
    elif egfr >= 60.0:
        return {
            "stage": "Stage 2",
            "risk": "Low Risk",
            "explanation": "Kidney function is mildly decreased. Mild fluid or cardiovascular loading is present, but kidney filtration remains within stable, physiological bounds."
        }
    elif egfr >= 45.0:
        return {
            "stage": "Stage 3a",
            "risk": "Moderate Risk",
            "explanation": "Kidney function is moderately decreased. Wearable data indicates early cellular hydration shift (lowering phase angle) and moderately elevated arterial volume proxy."
        }
    elif egfr >= 30.0:
        return {
            "stage": "Stage 3b",
            "risk": "Moderate Risk",
            "explanation": "Kidney function is moderately-to-severely decreased. Elevated volume indicators (low bioimpedance high-to-low ratio) and systemic cardiovascular stress (lowered HRV) indicate chronic loading."
        }
    elif egfr >= 15.0:
        return {
            "stage": "Stage 4",
            "risk": "High Risk",
            "explanation": "Kidney function is severely decreased. Significant systemic fluid retention (reduced bioimpedance magnitude) and vascular volume overload match clinical signs of kidney failure."
        }
    else:
        return {
            "stage": "Stage 5",
            "risk": "High Risk",
            "explanation": "Kidney function is extremely low, suggesting potential kidney failure. Severe fluid volume congestion and elevated autonomic strain require immediate professional assessment."
        }

@app.route("/predict", methods=["POST"])
def predict():
    global model, scaler
    if model is None or scaler is None:
        return jsonify({"error": "Model files are not loaded on server. Run train.py first."}), 500
        
    try:
        data = request.json
        if not data or "age" not in data or "gender" not in data or "features" not in data:
            return jsonify({"error": "Missing parameters 'age', 'gender', or 'features'"}), 400
            
        age = int(data["age"])
        gender = str(data["gender"])
        features = data["features"]
        
        # 1. Map wearable features to the 5 clinical inputs
        clinical_vector = map_wearable_to_clinical(age, gender, features)
        
        # 2. Scale features and run prediction
        scaled_input = scaler.transform([clinical_vector])
        predicted_egfr = float(model.predict(scaled_input)[0])
        
        # 3. Calculate prediction confidence based on tree variance in Random Forest
        # Retrieve predictions of each individual estimator
        predictions_from_trees = [float(tree.predict(scaled_input)[0]) for tree in model.estimators_]
        std_dev = np.std(predictions_from_trees)
        
        # Mapping standard deviation of estimators to a confidence percentage (50% - 99%)
        # Lower std dev -> tighter agreement between trees -> higher confidence
        raw_confidence = 100.0 - (std_dev / max(10.0, predicted_egfr)) * 100.0
        confidence = float(np.clip(raw_confidence, 55.0, 99.0))
        
        # 4. Determine stage, risk, and explanation
        stage_details = determine_stage_and_risk(predicted_egfr)
        
        return jsonify({
            "eGFR": float(round(predicted_egfr, 2)),
            "ckd_stage": stage_details["stage"],
            "risk_level": stage_details["risk"],
            "confidence": float(round(confidence, 1)),
            "explanation": stage_details["explanation"],
            # Return estimated clinical values for demo transparency
            "bmi": float(round(clinical_vector[2], 1)),
            "sbp": float(round(clinical_vector[3], 1)),
            "dbp": float(round(clinical_vector[4], 1))
        })
        
    except Exception as e:
        return jsonify({"error": f"Prediction failed: {str(e)}"}), 500

if __name__ == "__main__":
    load_models()
    app.run(host="0.0.0.0", port=5000, debug=True)
