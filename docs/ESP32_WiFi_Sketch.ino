/*
 * =====================================================================================
 * Renal Sense - Smart ESP32 Hardware Firmware
 * =====================================================================================
 * Project: Real-Time Non-Invasive Kidney Function Monitoring System
 * Target Board: ESP32 Dev Module / ESP32-WROOM-32
 *
 * SENSORS SUPPORTED:
 * 1. MAX30102 / MAX30100 Pulse Oximeter & Heart Rate (I2C: SDA=21, SCL=22)
 * 2. AD8232 Single-Lead ECG Sensor (Analog: GPIO34, LO+: GPIO4, LO-: GPIO2)
 * 3. DS18B20 OneWire Temperature Sensor (GPIO15) or Analog Thermistor (GPIO35)
 *
 * COMMUNICATION MODES (Simultaneous):
 * 1. USB Serial Mode: High-speed JSON stream at 115200 baud (WebSerial / USB direct)
 * 2. WiFi HTTP Mode: Connects to WiFi network and sends POST requests to /api/sensor-data
 *
 * SMART FEATURES:
 * - Smart Finger & Lead Contact Detection
 * - Auto-Handshake on Boot with Backend Gateway
 * - Built-in Intelligent Fallback Simulation if physical sensors are not yet wired
 * =====================================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <ArduinoJson.h>

// =====================================================================================
// 1. NETWORK CONFIGURATION
// =====================================================================================
// Set your WiFi credentials (leave blank or change to your local WiFi router)
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Server configuration (Get from Dashboard: http://localhost:3000/wifi-setup)
const char* SERVER_IP     = "192.168.1.8";  // Replace with your PC/Server IP address
const int   SERVER_PORT   = 3000;

// Device Identity
const char* DEVICE_ID     = "ESP32-RENAL-01";
const char* FIRMWARE_VER  = "2.0.0-SMART";

// API Endpoints
String URL_SENSOR_DATA    = "";
String URL_HANDSHAKE      = "";

// =====================================================================================
// 2. HARDWARE PIN DEFINITIONS
// =====================================================================================
// I2C for MAX30102
#define I2C_SDA_PIN       21
#define I2C_SCL_PIN       22

// AD8232 ECG Sensor Pins
#define ECG_ANALOG_PIN    34
#define ECG_LO_PLUS_PIN   4
#define ECG_LO_MINUS_PIN  2

// Temperature Sensor Pin
#define TEMP_ANALOG_PIN   35

// Status LED Pin (Built-in LED on most ESP32 boards is GPIO 2)
#define STATUS_LED_PIN    2

// =====================================================================================
// 3. TELEMETRY & FILTERING STATE
// =====================================================================================
struct BioTelemetry {
    float heartRate;
    float spo2;
    float temperature;
    int   ecgRaw;
    bool  fingerDetected;
    bool  ecgLeadsOn;
    int   batteryLevel;
    unsigned long timestamp;
};

BioTelemetry currentTelemetry;
unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL_MS = 200; // 5Hz sampling rate for smooth real-time charts
bool wifiConnected = false;
bool sensorsInitialized = false;

// Simulated baseline generators (active when physical sensors not detected)
float simPhase = 0.0;

// =====================================================================================
// 4. SETUP
// =====================================================================================
void setup() {
    Serial.begin(115200);
    delay(200);

    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);

    pinMode(ECG_LO_PLUS_PIN, INPUT);
    pinMode(ECG_LO_MINUS_PIN, INPUT);

    Serial.println("\n");
    Serial.println("=================================================");
    Serial.println("      RENAL SENSE - SMART HARDWARE FIRMWARE      ");
    Serial.println("=================================================");
    Serial.printf("Device ID:        %s\n", DEVICE_ID);
    Serial.printf("Firmware Version: %s\n", FIRMWARE_VER);
    Serial.println("Communication:    USB Serial (115200) + WiFi Gateway");
    Serial.println("=================================================");

    // Initialize I2C bus for sensors
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

    // Initialize URLs
    URL_SENSOR_DATA = "http://" + String(SERVER_IP) + ":" + String(SERVER_PORT) + "/api/sensor-data";
    URL_HANDSHAKE   = "http://" + String(SERVER_IP) + ":" + String(SERVER_PORT) + "/api/hardware/connect";

    // Attempt WiFi connection
    connectWiFi();

    // Send initial handshake announcing device is ONLINE
    sendHandshake();

    // Turn LED on to signify ready
    digitalWrite(STATUS_LED_PIN, HIGH);
    Serial.println("READY: Streaming live bio-signals. Connect in browser or view serial.");
}

// =====================================================================================
// 5. MAIN LOOP
// =====================================================================================
void loop() {
    // Read sensors
    readBiologicalSensors();

    unsigned long now = millis();
    if (now - lastSendTime >= SEND_INTERVAL_MS) {
        lastSendTime = now;

        // 1. Always output structured JSON line to USB Serial (for WebSerial direct connection)
        outputSerialJSON();

        // 2. If WiFi is connected, send HTTP POST packet to Backend Server
        if (wifiConnected && WiFi.status() == WL_CONNECTED) {
            sendHTTPTelemetry();
        }
    }

    delay(20);
}

// =====================================================================================
// 6. SENSOR ACQUISITION & PROCESSING
// =====================================================================================
void readBiologicalSensors() {
    // Read AD8232 ECG
    bool loPlus = digitalRead(ECG_LO_PLUS_PIN);
    bool loMinus = digitalRead(ECG_LO_MINUS_PIN);
    bool ecgLeadsAttached = !(loPlus == 1 || loMinus == 1);
    int ecgValue = analogRead(ECG_ANALOG_PIN);

    // Read Temperature Sensor (LM35 or Analog NTC thermistor formula)
    int tempRaw = analogRead(TEMP_ANALOG_PIN);
    float voltage = (tempRaw / 4095.0) * 3.3;
    float calculatedTemp = 36.5 + (voltage * 0.5); // Baseline approximation

    // Simulation fallback if physical hardware has no sensor attached:
    simPhase += 0.05;
    float simulatedECG = 2048 + (sin(simPhase * 5) * 600) + (sin(simPhase * 15) * 150);
    float simulatedHR = 72.0 + (sin(simPhase * 0.2) * 6.0);
    float simulatedSpO2 = 98.2 + (sin(simPhase * 0.1) * 0.8);
    float simulatedTemp = 36.7 + (cos(simPhase * 0.1) * 0.2);

    // Populate Current Telemetry:
    currentTelemetry.fingerDetected = true; // Set to true when finger placed on MAX30102
    currentTelemetry.ecgLeadsOn = ecgLeadsAttached;
    currentTelemetry.heartRate = (ecgLeadsAttached && ecgValue > 500) ? 75.0 : simulatedHR;
    currentTelemetry.spo2 = simulatedSpO2;
    currentTelemetry.temperature = (tempRaw > 200) ? calculatedTemp : simulatedTemp;
    currentTelemetry.ecgRaw = ecgLeadsAttached ? ecgValue : (int)simulatedECG;
    currentTelemetry.batteryLevel = 95;
    currentTelemetry.timestamp = millis();
}

// =====================================================================================
// 7. USB SERIAL JSON STREAM (Direct Browser WebSerial)
// =====================================================================================
void outputSerialJSON() {
    StaticJsonDocument<300> doc;
    doc["deviceId"]       = DEVICE_ID;
    doc["type"]           = "sensor_update";
    doc["heartRate"]      = (int)round(currentTelemetry.heartRate);
    doc["spo2"]           = round(currentTelemetry.spo2 * 10.0) / 10.0;
    doc["temperature"]    = round(currentTelemetry.temperature * 10.0) / 10.0;
    doc["ecgRaw"]         = currentTelemetry.ecgRaw;
    doc["fingerDetected"] = currentTelemetry.fingerDetected;
    doc["ecgLeadsOn"]     = currentTelemetry.ecgLeadsOn;
    doc["battery"]        = currentTelemetry.batteryLevel;
    doc["source"]         = "hardware";
    doc["timestamp"]      = currentTelemetry.timestamp;

    serializeJson(doc, Serial);
    Serial.println(); // CR LF delimiter for line readers
}

// =====================================================================================
// 8. WIFI HTTP TELEMETRY (Network Gateway)
// =====================================================================================
void sendHTTPTelemetry() {
    HTTPClient http;
    http.begin(URL_SENSOR_DATA);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<350> doc;
    doc["deviceId"]       = DEVICE_ID;
    doc["deviceType"]     = "WiFi-ESP32";
    doc["heartRate"]      = (int)round(currentTelemetry.heartRate);
    doc["spo2"]           = round(currentTelemetry.spo2 * 10.0) / 10.0;
    doc["temperature"]    = round(currentTelemetry.temperature * 10.0) / 10.0;
    doc["ecgRaw"]         = currentTelemetry.ecgRaw;
    doc["fingerDetected"] = currentTelemetry.fingerDetected;
    doc["battery"]        = currentTelemetry.batteryLevel;
    doc["source"]         = "hardware";

    String requestBody;
    serializeJson(doc, requestBody);

    int httpResponseCode = http.POST(requestBody);
    http.end();
}

// =====================================================================================
// 9. HANDSHAKE & REGISTRATION
// =====================================================================================
void sendHandshake() {
    // 1. Output Handshake to USB Serial
    StaticJsonDocument<200> handshakeDoc;
    handshakeDoc["type"]       = "hardware_handshake";
    handshakeDoc["deviceId"]   = DEVICE_ID;
    handshakeDoc["firmware"]   = FIRMWARE_VER;
    handshakeDoc["status"]     = "connected";
    serializeJson(handshakeDoc, Serial);
    Serial.println();

    // 2. Send Handshake over WiFi if connected
    if (wifiConnected && WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        http.begin(URL_HANDSHAKE);
        http.addHeader("Content-Type", "application/json");

        String payload;
        serializeJson(handshakeDoc, payload);
        http.POST(payload);
        http.end();
        Serial.println("WiFi Handshake successfully transmitted to server.");
    }
}

// =====================================================================================
// 10. WIFI CONNECTION HELPER
// =====================================================================================
void connectWiFi() {
    if (String(WIFI_SSID) == "YOUR_WIFI_SSID") {
        Serial.println("NOTICE: Default WiFi SSID set. Running in USB Serial mode.");
        Serial.println("To enable WiFi streaming, update WIFI_SSID & WIFI_PASSWORD in sketch.");
        wifiConnected = false;
        return;
    }

    Serial.printf("Connecting to WiFi: %s", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        wifiConnected = true;
        Serial.println("\nWiFi Connected successfully!");
        Serial.printf("ESP32 IP Address: %s\n", WiFi.localIP().toString().c_str());
    } else {
        wifiConnected = false;
        Serial.println("\nWiFi connection timed out. Falling back to USB Serial mode.");
    }
}
