// Web Bluetooth (BLE) Controller for Renal Sense Dashboard
// Handles pairing, GATT services, notifications, and mock fallback simulation.

class BluetoothController {
    constructor() {
        this.device = null;
        this.characteristic = null;
        this.connected = false;
        this.connecting = false;
        this.scanning = false;
        this.statusCallback = null;
        this.dataCallback = null;

        // Custom GATT UUIDs configured in ESP32 sketch
        this.SERVICE_UUID = 'de991000-f9a1-43e8-abdf-14022c45aa3c';
        this.CHARACTERISTIC_UUID = 'de991001-f9a1-43e8-abdf-14022c45aa3c';
    }

    // Register status change handler
    onStatusChange(callback) {
        this.statusCallback = callback;
    }

    // Register data update handler
    onDataReceived(callback) {
        this.dataCallback = callback;
    }

    // Update internal status and trigger callback
    updateStatus(status, details = '') {
        console.log(`[BLE Status] ${status}: ${details}`);
        if (this.statusCallback) {
            this.statusCallback({ status, details, connected: this.connected });
        }
    }

    // Check if Web Bluetooth is supported
    isSupported() {
        return navigator.bluetooth !== undefined;
    }

    // Connect to actual BLE device using Web Bluetooth
    async connect() {
        if (!this.isSupported()) {
            this.updateStatus('error', 'Web Bluetooth is not supported in this browser. Running simulation instead...');
            return this.connectMock();
        }

        if (this.connected || this.connecting) {
            return;
        }

        this.connecting = true;
        this.scanning = true;
        this.updateStatus('scanning', 'Requesting Bluetooth device...');

        try {
            // Request device with name RenalSense-Monitor and custom Service UUID
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: 'RenalSense-Monitor' }],
                optionalServices: [this.SERVICE_UUID]
            });

            this.scanning = false;
            this.updateStatus('connecting', `Found device: ${this.device.name}. Connecting...`);

            // Listen for disconnection events
            this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnection());

            // Connect to GATT Server
            const server = await this.device.gatt.connect();
            this.updateStatus('connecting', 'GATT Server connected. Discovering services...');

            // Get Service
            const service = await server.getPrimaryService(this.SERVICE_UUID);
            this.updateStatus('connecting', 'Service discovered. Finding characteristics...');

            // Get Characteristic
            this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);
            this.updateStatus('connecting', 'Notifications active. Starting data stream...');

            // Start notifications
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', (e) => this.handleDataNotification(e));

            this.connected = true;
            this.connecting = false;
            this.updateStatus('connected', 'Connected to RenalSense Monitor!');

        } catch (error) {
            this.connecting = false;
            this.scanning = false;
            console.error('BLE connection error:', error);
            
            if (error.name === 'NotFoundError') {
                this.updateStatus('cancelled', 'Device selection cancelled or unsupported. Falling back to mock...');
                this.connectMock();
            } else {
                this.updateStatus('error', `Connection failed: ${error.message}`);
                // Fallback to simulated BLE connection for testing purposes
                this.updateStatus('info', 'Starting mock Bluetooth simulation for demonstration...');
                this.connectMock();
            }
        }
    }

    // Parse notification value
    handleDataNotification(event) {
        try {
            const value = event.target.value;
            const decoder = new TextDecoder('utf-8');
            const csvData = decoder.decode(value);
            this.parseAndEmitCSV(csvData);
        } catch (err) {
            console.error('Error decoding BLE notification data:', err);
        }
    }

    // Parse CSV data and forward to dataCallback
    parseAndEmitCSV(csvData) {
        // Format should be: "heart_rate,temperature,spo2"
        const parts = csvData.split(',');
        if (parts.length >= 3) {
            const heartRate = parseFloat(parts[0]);
            const temperature = parseFloat(parts[1]);
            const spo2 = parseFloat(parts[2]);

            if (this.dataCallback) {
                this.dataCallback({ heartRate, temperature, spo2 });
            }
        }
    }

    // Handle BLE Device Disconnection
    handleDisconnection() {
        this.connected = false;
        this.connecting = false;
        this.device = null;
        this.characteristic = null;
        this.updateStatus('disconnected', 'Device disconnected.');
    }

    // Disconnect active connection
    disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        } else if (this.mockInterval) {
            clearInterval(this.mockInterval);
            this.mockInterval = null;
            this.connected = false;
            this.connecting = false;
            this.updateStatus('disconnected', 'Mock connection terminated.');
        }
    }

    // Mock Bluetooth Connection Flow (Animated Simulation)
    connectMock() {
        if (this.connected || this.connecting) return;
        
        this.connecting = true;
        this.scanning = true;
        this.updateStatus('scanning', 'Searching for BLE devices...');

        // Step 1: Scan (2s)
        setTimeout(() => {
            if (!this.connecting) return;
            this.scanning = false;
            this.updateStatus('connecting', 'Device found: RenalSense-Monitor (Mock BLE). Connecting...');

            // Step 2: Establish connection (2s)
            setTimeout(() => {
                if (!this.connecting) return;
                this.updateStatus('connecting', 'GATT services paired. Commencing telemetry notifications...');

                // Step 3: Complete Connection
                setTimeout(() => {
                    if (!this.connecting) return;
                    this.connected = true;
                    this.connecting = false;
                    this.updateStatus('connected', 'Connected via Bluetooth (Simulator Mode)');

                    // Step 4: Stream Data
                    let hr = 72;
                    let temp = 36.8;
                    let spo2 = 98;

                    this.mockInterval = setInterval(() => {
                        if (!this.connected) {
                            clearInterval(this.mockInterval);
                            return;
                        }

                        // Introduce realistic physiological drift
                        hr += (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 3);
                        hr = Math.max(60, Math.min(120, hr));

                        temp += (Math.random() > 0.5 ? 0.05 : -0.05);
                        temp = Math.max(36.0, Math.min(38.2, temp));

                        spo2 += (Math.random() > 0.8 ? (Math.random() > 0.5 ? 1 : -1) : 0);
                        spo2 = Math.max(94, Math.min(100, spo2));

                        if (this.dataCallback) {
                            this.dataCallback({ heartRate: hr, temperature: temp, spo2: spo2 });
                        }
                    }, 1000);

                }, 1500);
            }, 2000);
        }, 2000);
    }
}

// Export controller globally
window.bluetoothController = new BluetoothController();
