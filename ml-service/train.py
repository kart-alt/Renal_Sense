import os
import sys
import joblib
import requests
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error

# File paths
MODEL_PATH = "kidney_model.pkl"
SCALER_PATH = "kidney_scaler.pkl"

# CKD-EPI (2021) Creatinine Equation
def calculate_egfr(scr, age, gender_code):
    # gender_code: 1 = Male, 2 = Female (NHANES standard)
    is_female = (gender_code == 2)
    kappa = 0.7 if is_female else 0.9
    alpha = -0.241 if is_female else -0.302
    gender_mult = 1.012 if is_female else 1.0
    
    # Calculate components
    term1 = min(scr / kappa, 1.0) ** alpha
    term2 = max(scr / kappa, 1.0) ** -1.200
    term3 = 0.9938 ** age
    
    egfr = 142 * term1 * term2 * term3 * gender_mult
    return egfr

def download_file(url, local_path):
    print(f"Downloading {url} ...")
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    with open(local_path, "wb") as f:
        f.write(response.content)

def get_nhanes_data():
    """
    Attempts to download and parse NHANES 2017-2018 datasets.
    Falls back to synthetic data generator if CDC server is offline or fails.
    """
    os.makedirs("temp_nhanes", exist_ok=True)
    
    files = {
        "demo": ("https://wwwn.cdc.gov/Nchs/Nhanes/2017-2018/DEMO_J.XPT", "temp_nhanes/demo.xpt"),
        "bmx": ("https://wwwn.cdc.gov/Nchs/Nhanes/2017-2018/BMX_J.XPT", "temp_nhanes/bmx.xpt"),
        "bpx": ("https://wwwn.cdc.gov/Nchs/Nhanes/2017-2018/BPX_J.XPT", "temp_nhanes/bpx.xpt"),
        "biopro": ("https://wwwn.cdc.gov/Nchs/Nhanes/2017-2018/BIOPRO_J.XPT", "temp_nhanes/biopro.xpt")
    }
    
    try:
        # Try downloading
        for key, (url, path) in files.items():
            if not os.path.exists(path):
                download_file(url, path)
                
        print("Reading SAS Transport files...")
        df_demo = pd.read_sas(files["demo"][1])
        df_bmx = pd.read_sas(files["bmx"][1])
        df_bpx = pd.read_sas(files["bpx"][1])
        df_biopro = pd.read_sas(files["biopro"][1])
        
        # Merge datasets on Respondent Sequence Number (SEQN)
        # Suffix/prefix handling to clean up
        df = df_demo[["SEQN", "RIDAGEYR", "RIAGENDR"]].merge(df_bmx[["SEQN", "BMXBMI"]], on="SEQN")
        df = df.merge(df_bpx[["SEQN", "BPXSY1", "BPXDI1"]], on="SEQN")
        df = df.merge(df_biopro[["SEQN", "LBXSCR"]], on="SEQN")
        
        # Clean column names & drop NaNs
        df.rename(columns={
            "RIDAGEYR": "Age",
            "RIAGENDR": "Gender",
            "BMXBMI": "BMI",
            "BPXSY1": "SBP",
            "BPXDI1": "DBP",
            "LBXSCR": "Creatinine"
        }, inplace=True)
        
        df = df.dropna()
        
        # Compute eGFR using CKD-EPI (2021)
        df["eGFR"] = df.apply(lambda row: calculate_egfr(row["Creatinine"], row["Age"], row["Gender"]), axis=1)
        
        # Filter realistic values
        df = df[(df["eGFR"] > 2) & (df["eGFR"] < 200)]
        
        print(f"[SUCCESS] Successfully downloaded and processed {len(df)} records from NHANES 2017-2018.")
        return df[["Age", "Gender", "BMI", "SBP", "DBP", "eGFR"]]

    except Exception as e:
        print(f"[WARNING] CDC download/process failed: {e}")
        print("[INFO] Falling back to high-fidelity synthetic NHANES generator...")
        return generate_synthetic_nhanes(2500)

def generate_synthetic_nhanes(n_samples=2500):
    np.random.seed(42)
    
    # Generate Demographics
    age = np.random.uniform(18, 80, n_samples)
    gender = np.random.choice([1, 2], size=n_samples, p=[0.49, 0.51]) # 1=Male, 2=Female
    
    # Generate BMI (normal distribution with skew towards overweight)
    bmi = np.random.normal(28.5, 6.0, n_samples)
    bmi = np.clip(bmi, 15.0, 55.0)
    
    # Generate Blood Pressure (Age and BMI dependent)
    # SBP baseline increases with age and BMI
    sbp_mean = 118 + 0.22 * age + 0.12 * bmi
    sbp = np.random.normal(sbp_mean, 11.0)
    sbp = np.clip(sbp, 85, 200)
    
    # DBP baseline
    dbp_mean = 74 + 0.05 * age + 0.08 * bmi
    dbp = np.random.normal(dbp_mean, 8.0)
    dbp = np.clip(dbp, 50, 115)
    
    # Generate Serum Creatinine (reflecting age, gender, blood pressure health)
    # Baseline: Male = 0.9 mg/dL, Female = 0.7 mg/dL
    creatinine_baseline = np.where(gender == 2, 0.7, 0.9)
    # Age effect (kidney decline)
    age_effect = 0.0035 * (age - 18)
    # BP effect (long-term hypertension kidney strain)
    bp_effect = 0.006 * np.maximum(0, sbp - 120)
    
    # Combined creatinine + log-normal noise (creatinine distribution is right-skewed)
    noise = np.random.lognormal(mean=0, sigma=0.35, size=n_samples) - 1.0
    creatinine = creatinine_baseline + age_effect + bp_effect + noise * 0.4
    creatinine = np.clip(creatinine, 0.4, 8.5)
    
    # Calculate eGFR using CKD-EPI formula
    egfr = []
    for i in range(n_samples):
        egfr.append(calculate_egfr(creatinine[i], age[i], gender[i]))
        
    df = pd.DataFrame({
        "Age": age,
        "Gender": gender,
        "BMI": bmi,
        "SBP": sbp,
        "DBP": dbp,
        "eGFR": egfr
    })
    
    print(f"[SUCCESS] Generated {len(df)} high-fidelity synthetic NHANES clinical records.")
    return df

def main():
    # 1. Fetch data
    df = get_nhanes_data()
    
    # 2. Split features and target
    # Feature columns: Age, Gender (1=Male, 2=Female), BMI, SBP, DBP
    X = df[["Age", "Gender", "BMI", "SBP", "DBP"]].values
    y = df["eGFR"].values
    
    # 3. Train-test split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # 4. Standardize features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # 5. Train Random Forest Model
    print("Training Random Forest Regressor...")
    model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    model.fit(X_train_scaled, y_train)
    
    # 6. Evaluate
    y_pred = model.predict(X_test_scaled)
    r2 = r2_score(y_test, y_pred)
    mae = mean_absolute_error(y_test, y_pred)
    
    print("\n---------------- MODEL EVALUATION ----------------")
    print(f"R² Score              : {r2:.4f}")
    print(f"Mean Absolute Error    : {mae:.2f} mL/min/1.73m²")
    print("--------------------------------------------------\n")
    
    # 7. Save model and scaler
    joblib.dump(model, MODEL_PATH)
    joblib.dump(scaler, SCALER_PATH)
    print(f"[INFO] Model saved to: {MODEL_PATH}")
    print(f"[INFO] Scaler saved to: {SCALER_PATH}")
    
    # Clean up temp folder if it exists
    import shutil
    if os.path.exists("temp_nhanes"):
        shutil.rmtree("temp_nhanes")

if __name__ == "__main__":
    main()
