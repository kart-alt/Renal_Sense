import os
import json
import joblib
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, RandomForestClassifier
from sklearn.metrics import r2_score, mean_absolute_error, f1_score, accuracy_score
from xgboost import XGBRegressor, XGBClassifier

PROCESSED_DIR = "data/processed"
MODELS_DIR = "models"

# Staging bucket helper
def get_ckd_stage_code(egfr):
    if egfr >= 90: return 0  # Stage 1
    elif egfr >= 60: return 1  # Stage 2
    elif egfr >= 45: return 2  # Stage 3a
    elif egfr >= 30: return 3  # Stage 3b
    elif egfr >= 15: return 4  # Stage 4
    else: return 5  # Stage 5

def main():
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    print("--------------------------------------------------")
    print("Renal Sense - Model Hyperparameter Tuning & Training")
    print("--------------------------------------------------")
    
    # 1. Load splits
    train_df = pd.read_csv(os.path.join(PROCESSED_DIR, "train.csv"))
    val_df = pd.read_csv(os.path.join(PROCESSED_DIR, "val.csv"))
    
    # Separate features and targets
    # Features are everything except SEQN, eGFR, CKD_Stage
    exclude_cols = ["SEQN", "eGFR", "CKD_Stage"]
    feature_cols = [c for c in train_df.columns if c not in exclude_cols]
    
    print(f"[INFO] Expected features ({len(feature_cols)}): {feature_cols}")
    
    X_train = train_df[feature_cols].values
    y_train_egfr = train_df["eGFR"].values
    y_train_stage = train_df["CKD_Stage"].apply(get_ckd_stage_code).values
    
    X_val = val_df[feature_cols].values
    y_val_egfr = val_df["eGFR"].values
    y_val_stage = val_df["CKD_Stage"].apply(get_ckd_stage_code).values
    
    # 2. Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_val_scaled = scaler.transform(X_val)
    
    # ---------------- REGRESSOR SEARCH ----------------
    print("\n--- Tuning eGFR Regressors ---")
    regressors = {
        "RandomForest": {
            "model_class": RandomForestRegressor,
            "params": [
                {"n_estimators": 50, "max_depth": 10, "random_state": 42},
                {"n_estimators": 100, "max_depth": 15, "random_state": 42},
                {"n_estimators": 100, "max_depth": None, "random_state": 42}
            ]
        },
        "GradientBoosting": {
            "model_class": GradientBoostingRegressor,
            "params": [
                {"n_estimators": 50, "learning_rate": 0.05, "max_depth": 3, "random_state": 42},
                {"n_estimators": 100, "learning_rate": 0.1, "max_depth": 3, "random_state": 42},
                {"n_estimators": 100, "learning_rate": 0.1, "max_depth": 5, "random_state": 42}
            ]
        },
        "XGBoost": {
            "model_class": XGBRegressor,
            "params": [
                {"n_estimators": 50, "learning_rate": 0.05, "max_depth": 3, "random_state": 42, "n_jobs": -1},
                {"n_estimators": 100, "learning_rate": 0.1, "max_depth": 3, "random_state": 42, "n_jobs": -1},
                {"n_estimators": 100, "learning_rate": 0.1, "max_depth": 5, "random_state": 42, "n_jobs": -1}
            ]
        }
    }
    
    best_reg_name = None
    best_reg_model = None
    best_reg_val_mae = float("inf")
    best_reg_val_r2 = -float("inf")
    
    for name, config in regressors.items():
        print(f"Evaluating {name}...")
        for p in config["params"]:
            model = config["model_class"](**p)
            model.fit(X_train_scaled, y_train_egfr)
            
            y_pred = model.predict(X_val_scaled)
            mae = mean_absolute_error(y_val_egfr, y_pred)
            r2 = r2_score(y_val_egfr, y_pred)
            
            print(f"  Params: {p} -> Val MAE: {mae:.2f}, R²: {r2:.4f}")
            
            if mae < best_reg_val_mae:
                best_reg_val_mae = mae
                best_reg_val_r2 = r2
                best_reg_model = model
                best_reg_name = f"{name} ({p})"
                
    print(f"\n[WINNER Regressor]: {best_reg_name} with Val MAE: {best_reg_val_mae:.2f}, R²: {best_reg_val_r2:.4f}")
    
    # ---------------- CLASSIFIER SEARCH ----------------
    print("\n--- Tuning Direct Stage Classifiers ---")
    classifiers = {
        "RandomForestClassifier": {
            "model_class": RandomForestClassifier,
            "params": [
                {"n_estimators": 50, "max_depth": 10, "random_state": 42},
                {"n_estimators": 100, "max_depth": 15, "random_state": 42}
            ]
        },
        "XGBoostClassifier": {
            "model_class": XGBClassifier,
            "params": [
                {"n_estimators": 50, "learning_rate": 0.05, "max_depth": 3, "random_state": 42, "eval_metric": "mlogloss", "n_jobs": -1},
                {"n_estimators": 100, "learning_rate": 0.1, "max_depth": 4, "random_state": 42, "eval_metric": "mlogloss", "n_jobs": -1}
            ]
        }
    }
    
    best_cls_name = None
    best_cls_model = None
    best_cls_val_f1 = -float("inf")
    
    for name, config in classifiers.items():
        print(f"Evaluating {name}...")
        for p in config["params"]:
            model = config["model_class"](**p)
            model.fit(X_train_scaled, y_train_stage)
            
            y_pred = model.predict(X_val_scaled)
            # Calculate macro F1 because CKD classes are heavily imbalanced
            f1 = f1_score(y_val_stage, y_pred, average="macro")
            acc = accuracy_score(y_val_stage, y_pred)
            
            print(f"  Params: {p} -> Val F1: {f1:.4f}, Accuracy: {acc:.4f}")
            
            if f1 > best_cls_val_f1:
                best_cls_val_f1 = f1
                best_cls_model = model
                best_cls_name = f"{name} ({p})"
                
    print(f"\n[WINNER Classifier]: {best_cls_name} with Val Macro-F1: {best_cls_val_f1:.4f}")
    
    # ---------------- STRATEGY COMPARISON ----------------
    print("\n--- Strategy Comparison: Direct Classifier vs Regression-Bucketing ---")
    
    # Strategy A: Regression-Bucketing
    val_reg_preds = best_reg_model.predict(X_val_scaled)
    val_reg_stages = np.array([get_ckd_stage_code(pred) for pred in val_reg_preds])
    f1_reg_bucket = f1_score(y_val_stage, val_reg_stages, average="macro")
    acc_reg_bucket = accuracy_score(y_val_stage, val_reg_stages)
    
    # Strategy B: Direct Classifier
    val_cls_preds = best_cls_model.predict(X_val_scaled)
    f1_direct_cls = f1_score(y_val_stage, val_cls_preds, average="macro")
    acc_direct_cls = accuracy_score(y_val_stage, val_cls_preds)
    
    print(f"Strategy A (Regression-Bucketing) -> Val Macro-F1: {f1_reg_bucket:.4f}, Accuracy: {acc_reg_bucket:.4f}")
    print(f"Strategy B (Direct Classifier)    -> Val Macro-F1: {f1_direct_cls:.4f}, Accuracy: {acc_direct_cls:.4f}")
    
    winning_strategy = "Regression-Bucketing" if f1_reg_bucket >= f1_direct_cls else "Direct Classifier"
    print(f"\n[WINNING STRATEGY]: {winning_strategy} (selected based on higher macro F1 score).")
    
    # ---------------- SAVE ASSETS ----------------
    print("\nSaving best models and scalers...")
    
    # Save best regressor & classifier
    joblib.dump(best_reg_model, os.path.join(MODELS_DIR, "egfr_regressor.pkl"))
    joblib.dump(best_cls_model, os.path.join(MODELS_DIR, "ckd_classifier.pkl"))
    joblib.dump(scaler, os.path.join(MODELS_DIR, "scaler.pkl"))
    
    # Save features list
    with open(os.path.join(MODELS_DIR, "features.json"), "w") as f:
        json.dump(feature_cols, f, indent=2)
        
    # Save a configuration file reflecting the winning strategy
    strategy_config = {
        "expected_features": feature_cols,
        "winning_classification_strategy": winning_strategy,
        "regressor_val_mae": best_reg_val_mae,
        "classifier_val_macro_f1": best_cls_val_f1
    }
    with open(os.path.join(MODELS_DIR, "pipeline_config.json"), "w") as f:
        json.dump(strategy_config, f, indent=2)
        
    print(f"[SUCCESS] Model artifacts successfully saved to: {MODELS_DIR}/")
    print("---------------------------------------------------\n")

if __name__ == "__main__":
    main()
