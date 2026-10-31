"""
Renal Sense - Hardware USB Serial Bridge
Bridges real-time serial JSON stream from ESP32 to the local Renal Sense HTTP API.

Usage:
    python hardware/serial_bridge.py --port COM6 --baud 115200 --server http://localhost:3000
"""

import sys
import json
import time
import argparse

try:
    import serial
    import serial.tools.list_ports
    import requests
except ImportError:
    print("=" * 60)
    print("Missing requirements. Run:")
    print("    pip install pyserial requests")
    print("=" * 60)
    sys.exit(1)


def find_default_port():
    ports = serial.tools.list_ports.comports()
    if not ports:
        return None
    for p in ports:
        desc = p.description.lower()
        if "cp210" in desc or "ch340" in desc or "usb-serial" in desc or "uart" in desc:
            return p.device
    return ports[0].device


def main():
    parser = argparse.ArgumentParser(description="Renal Sense ESP32 Serial Bridge")
    parser.add_argument("--port", type=str, default=None, help="COM port (e.g., COM3, COM6, /dev/ttyUSB0)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument("--server", type=str, default="http://localhost:3000", help="Renal Sense server base URL")
    args = parser.parse_args()

    port = args.port or find_default_port()
    if not port:
        print("❌ Error: No serial port detected. Please plug in your ESP32 device.")
        sys.exit(1)

    url_sensor = f"{args.server.rstrip('/')}/api/sensor-data"
    url_connect = f"{args.server.rstrip('/')}/api/hardware/connect"

    print("=" * 60)
    print("        RENAL SENSE - HARDWARE SERIAL BRIDGE")
    print("=" * 60)
    print(f"Connecting to Serial Port: {port} @ {args.baud} baud")
    print(f"Target Server:             {url_sensor}")
    print("=" * 60)

    try:
        ser = serial.Serial(port, args.baud, timeout=1)
        time.sleep(2)
        print(" Connected to ESP32 serial stream.")

        # Register hardware with backend
        try:
            requests.post(url_connect, json={
                "deviceId": "ESP32-RENAL-SERIAL",
                "deviceType": "USB-Serial",
                "port": port
            }, timeout=2)
            print(" Registered hardware connection with Renal Sense server.")
        except Exception as e:
            print(f"⚠️ Warning: Could not register with server: {e}")

        packet_count = 0
        while True:
            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if not line or not line.startswith("{"):
                continue

            try:
                data = json.loads(line)
                data["source"] = "hardware"
                data["deviceType"] = "USB-Serial"

                # Post to server
                resp = requests.post(url_sensor, json=data, timeout=1)
                packet_count += 1
                if packet_count % 10 == 0:
                    hr = data.get("heartRate", "--")
                    spo2 = data.get("spo2", "--")
                    temp = data.get("temperature", "--")
                    print(f"[{packet_count}] Forwarded: HR={hr} BPM | SpO2={spo2}% | Temp={temp}°C")
            except json.JSONDecodeError:
                continue
            except requests.RequestException:
                pass

    except KeyboardInterrupt:
        print("\nStopping serial bridge...")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()


if __name__ == "__main__":
    main()

