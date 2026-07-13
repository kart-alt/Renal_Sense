import os
import time
import requests

RAW_DIR = "data/raw"

# Define NHANES file map (cycle, component name, CDC URL, local file name)
NHANES_FILES = {
    # 1999-2000 Cycle (Cycle A)
    "1999-2000_DEMO": ("https://wwwn.cdc.gov/nchs/nhanes/1999-2000/DEMO.XPT", "demo_a.xpt"),
    "1999-2000_BMX": ("https://wwwn.cdc.gov/nchs/nhanes/1999-2000/BMX.XPT", "bmx_a.xpt"),
    "1999-2000_BPX": ("https://wwwn.cdc.gov/nchs/nhanes/1999-2000/BPX.XPT", "bpx_a.xpt"),
    "1999-2000_BIX": ("https://wwwn.cdc.gov/nchs/nhanes/1999-2000/BIX.XPT", "bix_a.xpt"),
    "1999-2000_BIOPRO": ("https://wwwn.cdc.gov/nchs/nhanes/1999-2000/LAB18.XPT", "biopro_a.xpt"),
    "1999-2000_ALB_CR": ("https://wwwn.cdc.gov/nchs/nhanes/1999-2000/LAB16.XPT", "alb_cr_a.xpt"),
    
    # 2001-2002 Cycle (Cycle B)
    "2001-2002_DEMO": ("https://wwwn.cdc.gov/nchs/nhanes/2001-2002/DEMO_B.XPT", "demo_b.xpt"),
    "2001-2002_BMX": ("https://wwwn.cdc.gov/nchs/nhanes/2001-2002/BMX_B.XPT", "bmx_b.xpt"),
    "2001-2002_BPX": ("https://wwwn.cdc.gov/nchs/nhanes/2001-2002/BPX_B.XPT", "bpx_b.xpt"),
    "2001-2002_BIX": ("https://wwwn.cdc.gov/nchs/nhanes/2001-2002/BIX_B.XPT", "bix_b.xpt"),
    "2001-2002_BIOPRO": ("https://wwwn.cdc.gov/nchs/nhanes/2001-2002/L40_B.XPT", "biopro_b.xpt"),
    "2001-2002_ALB_CR": ("https://wwwn.cdc.gov/nchs/nhanes/2001-2002/L16_B.XPT", "alb_cr_b.xpt"),

    # 2003-2004 Cycle (Cycle C)
    "2003-2004_DEMO": ("https://wwwn.cdc.gov/nchs/nhanes/2003-2004/DEMO_C.XPT", "demo_c.xpt"),
    "2003-2004_BMX": ("https://wwwn.cdc.gov/nchs/nhanes/2003-2004/BMX_C.XPT", "bmx_c.xpt"),
    "2003-2004_BPX": ("https://wwwn.cdc.gov/nchs/nhanes/2003-2004/BPX_C.XPT", "bpx_c.xpt"),
    "2003-2004_BIX": ("https://wwwn.cdc.gov/nchs/nhanes/2003-2004/BIX_C.XPT", "bix_c.xpt"),
    "2003-2004_BIOPRO": ("https://wwwn.cdc.gov/nchs/nhanes/2003-2004/L40_C.XPT", "biopro_c.xpt"),
    "2003-2004_ALB_CR": ("https://wwwn.cdc.gov/nchs/nhanes/2003-2004/L16_C.XPT", "alb_cr_c.xpt"),
}

UCI_FILES = {
    "UCI_CKD": ("https://raw.githubusercontent.com/Abdelkerim-Dassi/Chronic-Kidney-Disease-Prediction/master/chronic_kidney_disease.arff", "chronic_kidney_disease.arff")
}

def download_url(url, dest_path, retries=3):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    
    for attempt in range(1, retries + 1):
        try:
            print(f"[INFO] Downloading {url} -> {dest_path} (Attempt {attempt}/{retries})...")
            response = requests.get(url, headers=headers, timeout=45, stream=True)
            
            if response.status_code == 404:
                # Some CDCs might have variable case sensitivity or slight URL redirects
                print(f"[WARNING] 404 Not Found for {url}.")
                return False
                
            response.raise_for_status()
            
            with open(dest_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            # Verify file size is non-trivial
            size = os.path.getsize(dest_path)
            if size < 500:
                # File might be an HTML error message instead of actual data
                with open(dest_path, "r", errors="ignore") as f:
                    content = f.read(100)
                if "html" in content.lower() or "doctype" in content.lower():
                    raise ValueError(f"Downloaded file appears to be an HTML page, not binary data.")
            
            print(f"[SUCCESS] Download completed. Size: {size} bytes.")
            return True
            
        except Exception as e:
            print(f"[WARNING] Error during download on attempt {attempt}: {e}")
            if attempt < retries:
                time.sleep(2)
            else:
                if os.path.exists(dest_path):
                    os.remove(dest_path)
                return False

def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    
    print("--------------------------------------------------")
    print("Renal Sense - ML Dataset Ingestion Script")
    print("--------------------------------------------------")
    
    success_count = 0
    total_count = len(NHANES_FILES) + len(UCI_FILES)
    
    # 1. Download NHANES cycles
    for key, (url, filename) in NHANES_FILES.items():
        dest = os.path.join(RAW_DIR, filename)
        if os.path.exists(dest) and os.path.getsize(dest) > 1000:
            print(f"[INFO] Cached file found for {key}: {dest}. Skipping.")
            success_count += 1
        else:
            if download_url(url, dest):
                success_count += 1
                
    # 2. Download UCI validation dataset
    for key, (url, filename) in UCI_FILES.items():
        dest = os.path.join(RAW_DIR, filename)
        if os.path.exists(dest) and os.path.getsize(dest) > 1000:
            print(f"[INFO] Cached file found for {key}: {dest}. Skipping.")
            success_count += 1
        else:
            if download_url(url, dest):
                success_count += 1
                
    print("\n---------------- INGESTION SUMMARY ----------------")
    print(f"Successfully downloaded: {success_count}/{total_count} files.")
    print("---------------------------------------------------\n")
    
    if success_count < total_count:
        print("[ERROR] Some dataset files failed to download. Please inspect logs.")
        # We will not crash the script, but raise an warning.
        # Preprocessing script will handle missing raw files.

if __name__ == "__main__":
    main()
