/*
 * Smart Kidney Monitoring System - ESP32 Bluetooth Low Energy (BLE) Configuration
 * 
 * This sketch demonstrates how to configure an ESP32 as a BLE server
 * to stream real-time physiological data (Heart Rate, Temperature, SpO2)
 * directly to the Web Bluetooth Dashboard.
 * 
 * Prerequisites:
 * - ESP32 development board
 * - Arduino IDE with ESP32 support installed
 * - Required libraries: BLE libraries (built-in)
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ============================================
// BLE UUID CONFIGURATION - IMPORTANT!
// These must match the Web Bluetooth dashboard UUIDs
// ============================================
#define SERVICE_UUID           "de991000-f9a1-43e8-abdf-14022c45aa3c"
#define CHARACTERISTIC_UUID    "de991001-f9a1-43e8-abdf-14022c45aa3c"

// BLE Global Variables
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Simulated Sensor Data
float simulatedHeartRate = 72.0;
float simulatedTemperature = 36.8;
float simulatedSpO2 = 98.0;

unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 1000; // Stream data every 1 second (1000 ms)
int packetCount = 0;

// BLE Server Callbacks to track connection status
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
        deviceConnected = true;
        Serial.println("🔗 BLE Client Connected");
    };

    void onDisconnect(BLEServer* pServer) {
        deviceConnected = false;
        Serial.println("❌ BLE Client Disconnected");
    }
};

void setup() {
    Serial.begin(115200);
    delay(100);

    Serial.println("\n\n========================================");
    Serial.println("Smart Kidney Monitoring System");
    Serial.println("ESP32 BLE Configuration");
    Serial.println("========================================\n");

    // Initialize BLE Device
    BLEDevice::init("RenalSense-Monitor");

    // Create BLE Server
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    // Create BLE Service
    pService = pServer->createService(SERVICE_UUID);

    // Create BLE Characteristic
    pCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID,
                        BLECharacteristic::PROPERTY_READ   |
                        BLECharacteristic::PROPERTY_WRITE  |
                        BLECharacteristic::PROPERTY_NOTIFY |
                        BLECharacteristic::PROPERTY_INDICATE
                      );

    // Create BLE Descriptor for notifications (2902)
    pCharacteristic->addDescriptor(new BLE2902());

    // Start BLE Service
    pService->start();

    // Start BLE Advertising
    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("📶 BLE server initialized!");
    Serial.println("Advertising name: RenalSense-Monitor");
    Serial.print("Service UUID:     ");
    Serial.println(SERVICE_UUID);
    Serial.print("Char UUID:        ");
    Serial.println(CHARACTERISTIC_UUID);
    Serial.println("\nWaiting for client connection...\n");
}

void loop() {
    // Notify client of new data when connected
    if (deviceConnected) {
        unsigned long currentTime = millis();
        if (currentTime - lastSendTime >= SEND_INTERVAL) {
            lastSendTime = currentTime;

            // Generate simulated data (incorporating minor physiological fluctuations)
            simulatedHeartRate += random(-2, 3);
            if (simulatedHeartRate < 60) simulatedHeartRate = 60;
            if (simulatedHeartRate > 120) simulatedHeartRate = 120;

            simulatedTemperature += (random(-10, 11) / 100.0);
            if (simulatedTemperature < 36.0) simulatedTemperature = 36.0;
            if (simulatedTemperature > 38.5) simulatedTemperature = 38.5;

            simulatedSpO2 += random(-1, 2);
            if (simulatedSpO2 < 95) simulatedSpO2 = 95;
            if (simulatedSpO2 > 100) simulatedSpO2 = 100;

            // Format data as a CSV string
            // Format: "heart_rate,temperature,spo2"
            char dataBuffer[32];
            snprintf(dataBuffer, sizeof(dataBuffer), "%.1f,%.2f,%.1f", 
                     simulatedHeartRate, simulatedTemperature, simulatedSpO2);

            // Send notification
            pCharacteristic->setValue(dataBuffer);
            pCharacteristic->notify();
            
            Serial.print("📤 BLE Notification Sent [");
            Serial.print(packetCount);
            Serial.print("]: ");
            Serial.println(dataBuffer);
            
            packetCount++;
        }
    }

    // Handle disconnecting states gracefully
    if (!deviceConnected && oldDeviceConnected) {
        delay(500); // give the bluetooth stack the chance to get things ready
        pServer->startAdvertising(); // restart advertising
        Serial.println("📶 Restarted advertising...");
        oldDeviceConnected = deviceConnected;
        packetCount = 0;
    }
    
    // Handle connecting states
    if (deviceConnected && !oldDeviceConnected) {
        // do stuff on connection
        oldDeviceConnected = deviceConnected;
    }

    delay(50);
}
