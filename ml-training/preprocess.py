import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split

RAW_DIR = "data/raw"
PROCESSED_DIR = "data/processed"

def calculate_egfr(scr, age, gender):
    # NHANES gender: 1 = Male, 2 = Female
    is_female = (gender == 2)
    kappa = 0.7 if is_female else 0.9
    alpha = -0.241 if is_female else -0.302
    gender_mult = 1.012 if is_female else 1.0
    
    if scr <= 0 or age <= 0:
        return np.nan
        
    term1 = min(scr / kappa, 1.0) ** alpha
    term2 = max(scr / kappa, 1.0) ** -1.200
    term3 = 0.9938 ** age
    
    return 142 * term1 * term2 * term3 * gender_mult

def get_ckd_stage(egfr):
    if pd.isna(egfr):
        return np.nan
    if egfr >= 90:
        return "Stage 1"
    elif egfr >= 60:
        return "Stage 2"
    elif egfr >= 45:
        return "Stage 3a"
    elif egfr >= 30:
        return "Stage 3b"
    elif egfr >= 15:
        return "Stage 4"
    else:
        return "Stage 5"

def load_nhanes_cycle(cycle_suffix):
    """
    Loads and merges files for a single cycle.
    """
    s = f"_{cycle_suffix}" if cycle_suffix else "_a"
    
    # Paths
    demo_path = os.path.join(RAW_DIR, f"demo{s}.xpt")
    bmx_path = os.path.join(RAW_DIR, f"bmx{s}.xpt")
    bpx_path = os.path.join(RAW_DIR, f"bpx{s}.xpt")
    bix_path = os.path.join(RAW_DIR, f"bix{s}.xpt")
    biopro_path = os.path.join(RAW_DIR, f"biopro{s}.xpt")
    alb_cr_path = os.path.join(RAW_DIR, f"alb_cr{s}.xpt")
    
    # Check if all exist
    paths = [demo_path, bmx_path, bpx_path, bix_path, biopro_path, alb_cr_path]
    if not all(os.path.exists(p) for p in paths):
        raise FileNotFoundError(f"Missing XPT files for cycle {cycle_suffix.upper()}")
        
    # Read files
    df_demo = pd.read_sas(demo_path)
    df_bmx = pd.read_sas(bmx_path)
    df_bpx = pd.read_sas(bpx_path)
    df_bix = pd.read_sas(bix_path)
    df_biopro = pd.read_sas(biopro_path)
    df_alb_cr = pd.read_sas(alb_cr_path)
    
    # Standardize columns to uppercase for clean matching
    for df in [df_demo, df_bmx, df_bpx, df_bix, df_biopro, df_alb_cr]:
        df.columns = df.columns.str.upper()
        
    # Merge on SEQN
    df = df_demo[["SEQN", "RIDAGEYR", "RIAGENDR"]]
    df = df.merge(df_bmx[["SEQN", "BMXBMI", "BMXWT", "BMXHT"]], on="SEQN", how="inner")
    
    # Blood Pressure Average
    # SBP = Average of BPXSY1, BPXSY2, BPXSY3, BPXSY4
    # DBP = Average of BPXDI1, BPXDI2, BPXDI3, BPXDI4
    bpx_cols_sbp = [c for c in ["BPXSY1", "BPXSY2", "BPXSY3", "BPXSY4"] if c in df_bpx.columns]
    bpx_cols_dbp = [c for c in ["BPXDI1", "BPXDI2", "BPXDI3", "BPXDI4"] if c in df_bpx.columns]
    
    df_bpx_avg = df_bpx[["SEQN"]].copy()
    if bpx_cols_sbp:
        df_bpx_avg["SBP"] = df_bpx[bpx_cols_sbp].mean(axis=1)
    if bpx_cols_dbp:
        df_bpx_avg["DBP"] = df_bpx[bpx_cols_dbp].mean(axis=1)
    if "BPXPLS" in df_bpx.columns:
        df_bpx_avg["Pulse"] = df_bpx["BPXPLS"]
        
    df = df.merge(df_bpx_avg, on="SEQN", how="left")
    
    # Bioimpedance
    # NHANES BIA files have BIXS050K (resistance) and BIXC050K (reactance) at 50kHz
    bix_cols = ["SEQN"]
    if "BIXS050K" in df_bix.columns:
        bix_cols.append("BIXS050K")
    if "BIXC050K" in df_bix.columns:
        bix_cols.append("BIXC050K")
        
    # Check for Cole-modeling resistances if raw are missing
    if "BIDRECF" in df_bix.columns:
        bix_cols.append("BIDRECF")
    if "BIDRICF" in df_bix.columns:
        bix_cols.append("BIDRICF")
        
    df = df.merge(df_bix[bix_cols], on="SEQN", how="inner")
    
    # Biochemistry Creatinine
    # 1999-2000 (A): LBXSCR
    # 2001-2002 (B): LBDSCR
    # 2003-2004 (C): LBXSCR
    # We will look for LBXSCR first, then LBDSCR
    df_scr = df_biopro[["SEQN"]].copy()
    scr_var = None
    for v in ["LBXSCR", "LBDSCR"]:
        if v in df_biopro.columns:
            scr_var = v
            break
    if scr_var:
        df_scr["Creatinine"] = df_biopro[scr_var]
    else:
        df_scr["Creatinine"] = np.nan
        
    df = df.merge(df_scr, on="SEQN", how="inner")
    
    # Urinary Albumin & Creatinine
    # URXUMA (albumin mg/L), URXUCR (urine creatinine mg/dL)
    alb_cols = ["SEQN"]
    if "URXUMA" in df_alb_cr.columns:
        alb_cols.append("URXUMA")
    if "URXUCR" in df_alb_cr.columns:
        alb_cols.append("URXUCR")
    df = df.merge(df_alb_cr[alb_cols], on="SEQN", how="left")
    
    return df

def generate_synthetic_preprocessed(n_samples=6000):
    """
    Generates a synthetic replica of preprocessed data to ensure the pipeline remains runnable offline.
    """
    np.random.seed(42)
    age = np.random.uniform(18, 85, n_samples)
    gender = np.random.choice([1, 2], size=n_samples, p=[0.49, 0.51])
    
    bmi = np.random.normal(28.2, 5.8, n_samples)
    bmi = np.clip(bmi, 15.0, 52.0)
    
    height = np.random.normal(168.0, 10.0, n_samples)
    weight = bmi * ((height / 100) ** 2)
    
    sbp = np.random.normal(120 + 0.22 * age + 0.1 * bmi, 12.0)
    sbp = np.clip(sbp, 85, 200)
    dbp = sbp * 0.62 + np.random.normal(0, 4.0)
    dbp = np.clip(dbp, 50, 115)
    
    pulse = np.random.normal(72, 8.0, n_samples)
    pulse = np.clip(pulse, 50, 105)
    
    # BIA
    resistance = np.random.normal(400 - 1.2 * bmi + 0.5 * age, 45.0)
    # Reactance (cell membrane integrity, drops with age and cardiovascular strain)
    reactance = np.random.normal(45 - 0.2 * age - 0.1 * bmi, 6.0)
    reactance = np.clip(reactance, 5, 80)
    
    # Cole-model proxies
    bidrecf = resistance * 1.1
    bidricf = resistance * 1.4
    
    # Creatinine (serum)
    scr_base = np.where(gender == 2, 0.72, 0.92)
    age_effect = 0.003 * (age - 18)
    bp_effect = 0.006 * np.maximum(0, sbp - 120)
    # Add a small cluster of simulated advanced CKD patients
    ckd_cluster = np.random.choice([0, 1], size=n_samples, p=[0.95, 0.05])
    scr_ckd = ckd_cluster * np.random.exponential(scale=2.0, size=n_samples)
    
    creatinine = scr_base + age_effect + bp_effect + scr_ckd + np.random.normal(0, 0.1, n_samples)
    creatinine = np.clip(creatinine, 0.4, 10.0)
    
    # Urine Albumin and Creatinine
    urxucr = np.random.normal(120, 40, n_samples)
    urxucr = np.clip(urxucr, 10, 350)
    urxuma = creatinine * 10.0 + np.random.exponential(scale=50.0, size=n_samples)
    urxuma = np.clip(urxuma, 1, 1500)
    
    df = pd.DataFrame({
        "SEQN": range(10001, 10001 + n_samples),
        "RIDAGEYR": age,
        "RIAGENDR": gender,
        "BMXBMI": bmi,
        "BMXWT": weight,
        "BMXHT": height,
        "SBP": sbp,
        "DBP": dbp,
        "Pulse": pulse,
        "BIXS050K": resistance,
        "BIXC050K": reactance,
        "BIDRECF": bidrecf,
        "BIDRICF": bidricf,
        "Creatinine": creatinine,
        "URXUMA": urxuma,
        "URXUCR": urxucr
    })
    
    return df

def main():
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    
    print("--------------------------------------------------")
    print("Renal Sense - Data Preprocessing & Features")
    print("--------------------------------------------------")
    
    # 1. Attempt loading NHANES files from RAW cache
    raw_df_list = []
    use_synthetic = False
    
    for cycle in ["", "b", "c"]:
        try:
            print(f"[INFO] Loading NHANES cycle: {cycle.upper() if cycle else '1999-2000'}...")
            cycle_df = load_nhanes_cycle(cycle)
            raw_df_list.append(cycle_df)
            print(f"[SUCCESS] Loaded {len(cycle_df)} records.")
        except Exception as e:
            print(f"[WARNING] Could not load cycle {cycle}: {e}")
            use_synthetic = True
            break
            
    if use_synthetic or len(raw_df_list) == 0:
        print("[WARNING] Incomplete raw NHANES data files. Falling back to synthetic cohort generation...")
        df = generate_synthetic_preprocessed(5000)
    else:
        df = pd.concat(raw_df_list, ignore_index=True)
        print(f"[SUCCESS] Concatenated NHANES cycles. Total cohort: {len(df)} records.")
        
    # 2. Target engineering: Calculate eGFR
    print("[INFO] Computing target labels (eGFR using CKD-EPI 2021 race-free equation)...")
    df["eGFR"] = df.apply(lambda row: calculate_egfr(row["Creatinine"], row["RIDAGEYR"], row["RIAGENDR"]), axis=1)
    
    # Drop records where eGFR calculation was not possible
    df = df.dropna(subset=["eGFR"])
    print(f"[INFO] eGFR calculation complete. Records remaining: {len(df)}.")
    
    # Categorize CKD Stage
    df["CKD_Stage"] = df["eGFR"].apply(get_ckd_stage)
    
    # 3. Feature engineering
    print("[INFO] Engineering clinical and bioimpedance features...")
    
    # Rename baseline columns
    df.rename(columns={
        "RIDAGEYR": "Age",
        "RIAGENDR": "Gender",
        "BMXBMI": "BMI",
        "BMXWT": "Weight",
        "BMXHT": "Height"
    }, inplace=True)
    
    # Convert Gender: 1=Male, 2=Female -> 0=Male, 1=Female
    df["Gender"] = (df["Gender"] == 2).astype(int)
    
    # Phase Angle: arctan(|Xc| / R) * (180 / PI)
    # In NHANES raw reactance is usually positive, but we take absolute value to be safe
    resistance = df["BIXS050K"]
    reactance = np.abs(df["BIXC050K"])
    df["Resistance"] = resistance
    df["Reactance"] = reactance
    
    df["Phase_Angle"] = np.arctan(reactance / resistance) * (180.0 / np.pi)
    df["Impedance_Magnitude"] = np.sqrt(resistance**2 + reactance**2)
    
    # Hydration Index
    if "BIDRECF" in df.columns and "BIDRICF" in df.columns:
        # Extracellular fluid resistance ratio (lower resistance = higher volume)
        # Hydration index as extracellular resistance relative to total
        df["Hydration_Index"] = df["BIDRECF"] / (df["BIDRECF"] + df["BIDRICF"])
    else:
        # Fallback ratio
        df["Hydration_Index"] = reactance / resistance
        
    # Urine Albumin-Creatinine Ratio (UACR) in mg/g
    # URXUMA in mg/L, URXUCR in mg/dL -> UACR = 100 * URXUMA / URXUCR
    if "URXUMA" in df.columns and "URXUCR" in df.columns:
        df["UACR"] = 100.0 * df["URXUMA"] / df["URXUCR"]
    else:
        df["UACR"] = np.nan
        
    # Keep selected target features
    feature_cols = [
        "Age", "Gender", "BMI", "Weight", "Height",
        "SBP", "DBP", "Pulse",
        "Resistance", "Reactance", "Phase_Angle", "Impedance_Magnitude", "Hydration_Index",
        "UACR"
    ]
    target_cols = ["eGFR", "CKD_Stage"]
    
    df_dataset = df[["SEQN"] + feature_cols + target_cols].copy()
    
    # 4. Handle missing values (Median imputation + missing flags)
    print("[INFO] Imputing missing values and adding missingness indicators...")
    for col in feature_cols:
        missing_count = df_dataset[col].isna().sum()
        if missing_count > 0:
            # Create flag column
            flag_name = f"{col}_imputed"
            df_dataset[flag_name] = df_dataset[col].isna().astype(int)
            # Impute
            median_val = df_dataset[col].median()
            df_dataset[col] = df_dataset[col].fillna(median_val)
            print(f"  - Imputed {missing_count} values for {col} (median: {median_val:.2f})")
            
    # 5. Stratified splits
    # Drop rows with NaN CKD_Stage (should be 0 since we dropped NaN eGFR)
    df_dataset = df_dataset.dropna(subset=["CKD_Stage"])
    
    # Report class balance
    print("\n---------------- COHORT CLASS BALANCE ----------------")
    print(df_dataset["CKD_Stage"].value_counts().sort_index())
    print("------------------------------------------------------\n")
    
    # Features (X) and Targets (y)
    X = df_dataset.drop(columns=target_cols)
    y = df_dataset[target_cols]
    
    # Split into 70% Train, 30% Temp
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.30, random_state=42, stratify=y["CKD_Stage"]
    )
    
    # Split Temp into 50% Val, 50% Test (15% / 15% overall)
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.50, random_state=42, stratify=y_temp["CKD_Stage"]
    )
    
    # Merge back features and labels
    train_df = pd.concat([X_train, y_train], axis=1)
    val_df = pd.concat([X_val, y_val], axis=1)
    test_df = pd.concat([X_test, y_test], axis=1)
    
    # Save datasets
    train_path = os.path.join(PROCESSED_DIR, "train.csv")
    val_path = os.path.join(PROCESSED_DIR, "val.csv")
    test_path = os.path.join(PROCESSED_DIR, "test.csv")
    
    train_df.to_csv(train_path, index=False)
    val_df.to_csv(val_path, index=False)
    test_df.to_csv(test_path, index=False)
    
    print(f"[SUCCESS] Datasets preprocessed and split successfully:")
    print(f"  - Train split      : {train_path} ({len(train_df)} rows)")
    print(f"  - Validation split : {val_path} ({len(val_df)} rows)")
    print(f"  - Test split       : {test_path} ({len(test_df)} rows)")
    print("---------------------------------------------------\n")

if __name__ == "__main__":
    main()
