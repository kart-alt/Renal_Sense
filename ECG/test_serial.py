import serial
import json
import time

SERIAL_PORT = "COM6"
BAUD_RATE = 9600

try:
    ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    time.sleep(2)
    
    print("Reading 10 lines from serial port...")
    for i in range(10):
        line = ser.readline().decode(errors="ignore").strip()
        if line and line.startswith("{"):
            try:
                data = json.loads(line)
                print(f"[{i}] ecg_raw={data.get('ecg_raw')} temp={data.get('temperature')} spo2={data.get('spo2')} motion={data.get('motion_score')}")
            except:
                print(f"[{i}] Could not parse: {line[:50]}")
        else:
            print(f"[{i}] Invalid: {line[:50]}")
    
    ser.close()
    print("\nDone!")
    
except Exception as e:
    print(f"Error: {e}")
