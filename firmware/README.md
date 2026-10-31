# Renal Sense - ESP32 Hardware Firmware Guide

This directory contains the production firmware for the **Renal Sense Smart Kidney Monitoring System**.

---

## 🛠 Hardware Supported

1. **ESP32 Development Board** (NodeMCU-32S, ESP32-WROOM-32, or TTGO)
2. **MAX30102 / MAX30100** Pulse Oximeter & Heart Rate Sensor (I2C)
3. **AD8232** Single-Lead ECG Sensor (Analog)
4. **DS18B20 or LM35 / NTC Thermistor** Body Temperature Sensor (Analog)
5. **USB Cable** (Micro-USB or Type-C for power and high-speed WebSerial communication)

---

## 📌 Wiring Diagram & Pinouts

| Sensor | Sensor Pin | ESP32 GPIO Pin | Description |
| :--- | :--- | :--- | :--- |
| **MAX30102** | `VIN` / `VCC` | `3.3V` | 3.3V Power Supply |
| | `GND` | `GND` | Ground |
| | `SDA` | `GPIO 21` | I2C Data Line |
| | `SCL` | `GPIO 22` | I2C Clock Line |
| **AD8232 ECG** | `OUTPUT` | `GPIO 34` | ECG Analog Signal (ADC1_CH6) |
| | `LO+` | `GPIO 4` | Lead-Off Detection Positive |
| | `LO-` | `GPIO 2` | Lead-Off Detection Negative |
| | `3.3V` / `GND` | `3.3V` / `GND` | Power Supply |
| **Temperature**| `VOUT` | `GPIO 35` | Analog Body Temperature (ADC1_CH7) |
| | `VCC` / `GND` | `3.3V` / `GND` | Power Supply |

---

## 🚀 How to Flash the ESP32

### Step 1: Install Arduino IDE & Libraries
1. Download and install [Arduino IDE](https://www.arduino.cc/en/software) (version 2.0+ recommended).
2. Go to **File -> Preferences**, and add this URL to **Additional Boards Manager URLs**:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Tools -> Board -> Boards Manager**, search for **esp32** and click **Install**.
4. Go to **Sketch -> Include Library -> Manage Libraries**, search and install:
   - **ArduinoJson** (by Benoit Blanchon, v6.x or v7.x)

### Step 2: Open and Configure Sketch
1. Open [`ESP32_RenalSense.ino`](file:///d:/projects/Renal_Sense/firmware/ESP32_RenalSense/ESP32_RenalSense.ino).
2. If connecting via WiFi:
   - Update `WIFI_SSID` and `WIFI_PASSWORD`.
   - Update `SERVER_IP` with your computer's IP address (shown on [http://localhost:3000/wifi-setup](http://localhost:3000/wifi-setup)).
3. If connecting via USB Serial:
   - No configuration needed! Just leave defaults and plug in the USB cable.

### Step 3: Upload
1. Connect ESP32 to PC using a USB data cable.
2. Under **Tools -> Board**, select **ESP32 Dev Module**.
3. Under **Tools -> Port**, select the recognized COM port (e.g. `COM3`, `COM5`, `COM6`).
4. Click **Upload** (arrow icon).

---

## ⚡ Smart Connection Modes

### Mode 1: Direct USB WebSerial (Recommended & Zero Configuration)
1. Keep the ESP32 plugged into your PC's USB port.
2. Open the Renal Sense dashboard in Google Chrome or Microsoft Edge:
   👉 **[http://localhost:3000/renal-sense.html](http://localhost:3000/renal-sense.html)**
3. Under **Device Connection Settings**, click **🔌 USB Serial (Direct)**.
4. Click **Connect USB Device** and select your ESP32 COM port from the prompt.
5. The dashboard detects the device instantly and activates the smart test!

### Mode 2: Wireless WiFi Gateway
1. Ensure your ESP32 and PC are on the same WiFi network.
2. The ESP32 boots up and automatically performs a handshake with the server at `http://<SERVER_IP>:3000/api/hardware/connect`.
3. The dashboard turns green: **🟢 Hardware Connected (WiFi)** and awaits your command.

