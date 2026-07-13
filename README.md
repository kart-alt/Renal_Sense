# Renal Sense

An AI-powered, non-invasive kidney function monitoring system dashboard.

## Overview

Renal Sense collects physiological signals, extracts clinical features, and runs a machine learning pipeline to estimate **eGFR (estimated Glomerular Filtration Rate)**, **CKD (Chronic Kidney Disease) stage**, and **kidney risk level**.

This repository contains the complete full-stack web application:
1. **`simulator/`**: A mock sensor telemetry service simulating continuous physiological readings.
2. **`backend/`**: A Node.js + Express + Socket.IO API gateway that buffers data, extracts 30 features, saves to SQLite (via Prisma), and pushes telemetry/predictions to the dashboard.
3. **`ml-service/`**: A Python + Flask service running a Random Forest Regressor trained on the CDC's NHANES clinical dataset.
4. **`frontend/`**: A React + Vite dashboard built with Tailwind CSS and Recharts.

---

## Hardware & Simulation Status

> [!NOTE]
> **Validation Transparency**: The system is designed for a hackathon/grant feasibility demo.
> - **Simulated Sensors**: The Bioimpedance (AD5941) and Optical (MAX30102) sensors are simulated in `/simulator` because the physical ESP32 integration is in progress.
> - **Clinical Proxy Model**: Since there is no existing dataset linking direct raw wearable bioimpedance to lab-certified eGFR, the ML model is trained on the public CDC NHANES dataset (demographics, blood pressure, BMI). The backend maps wearable telemetry (e.g., heart rate, HRV, SpO2, and bioimpedance magnitude) onto these clinical variables to query the model.

---

## Quick Start

### Prerequisites
- Node.js (v18+)
- Python (3.9+)

### Installation
From the root directory, run:
```bash
npm run install:all
```

To set up the ML service virtual environment and train the model, see the instructions in [ml-service/README.md](file:///c:/projects/Renal_Sense/ml-service/README.md) (we will create this).

### Running Locally
To launch all services (Simulator, Backend, ML, Frontend) concurrently:
```bash
npm run dev
```

Individual services can be started as:
- **Simulator**: `npm run dev --prefix simulator` (Port 3002)
- **Backend**: `npm run dev --prefix backend` (Port 3001)
- **Frontend**: `npm run dev --prefix frontend` (Port 5173)
- **ML Service**: `python ml-service/app.py` (Port 5000)
