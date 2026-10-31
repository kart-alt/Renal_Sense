// Web Serial API Controller for Renal Sense Dashboard
// Direct USB cable connection to ESP32 without requiring intermediate drivers or software.

class SerialController {
    constructor() {
        this.port = null;
        this.reader = null;
        this.readableStreamClosed = null;
        this.connected = false;
        this.connecting = false;
        this.statusCallback = null;
        this.dataCallback = null;
        this.keepReading = false;
        this.baudRate = 115200;
        this.deviceId = 'ESP32-RENAL-USB';
    }

    // Register status change callback
    onStatusChange(callback) {
        this.statusCallback = callback;
    }

    // Register incoming sensor data callback
    onDataReceived(callback) {
        this.dataCallback = callback;
    }

    // Update status and invoke listener
    updateStatus(status, details = '') {
        console.log(`[Serial Status] ${status}: ${details}`);
        if (this.statusCallback) {
            this.statusCallback({ status, details, connected: this.connected, deviceId: this.deviceId });
        }
    }

    // Check if Web Serial is supported in current browser
    isSupported() {
        return 'serial' in navigator;
    }

    // Connect to USB Serial Port
    async connect(baudRate = 115200) {
        if (!this.isSupported()) {
            this.updateStatus('error', 'Web Serial is not supported in this browser. Please use Chrome, Edge, or Opera.');
            return false;
        }

        if (this.connected || this.connecting) {
            return true;
        }

        this.connecting = true;
        this.baudRate = baudRate;
        this.updateStatus('connecting', 'Please select your ESP32 device from the browser popup...');

        try {
            // Prompt user to pick a serial port
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: this.baudRate });

            this.connected = true;
            this.connecting = false;
            this.keepReading = true;

            const portInfo = this.port.getInfo ? this.port.getInfo() : {};
            const usbVendorId = portInfo.usbVendorId ? `0x${portInfo.usbVendorId.toString(16)}` : 'ESP32';
            this.deviceId = `ESP32 (${usbVendorId})`;

            this.updateStatus('connected', `Connected to ${this.deviceId} @ ${this.baudRate} baud`);

            // Notify server of hardware connection
            this.notifyServerConnected();

            // Start background stream reader
            this.readStream();
            return true;
        } catch (error) {
            this.connected = false;
            this.connecting = false;
            console.error('Serial connection error:', error);
            if (error.name === 'NotFoundError') {
                this.updateStatus('cancelled', 'Device selection was cancelled');
            } else {
                this.updateStatus('error', error.message || 'Could not connect to serial port');
            }
            return false;
        }
    }

    // Notify backend server that hardware is connected via USB
    async notifyServerConnected() {
        try {
            await fetch('/api/hardware/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: this.deviceId,
                    deviceType: 'USB-Serial',
                    baudRate: this.baudRate,
                    connectedAt: new Date().toISOString()
                })
            });
        } catch (e) {
            console.warn('Could not notify server of USB connect:', e);
        }
    }

    // Background reader loop
    async readStream() {
        let lineBuffer = '';
        const textDecoder = new TextDecoderStream();
        this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
        const reader = textDecoder.readable.getReader();
        this.reader = reader;

        try {
            while (this.keepReading) {
                const { value, done } = await reader.read();
                if (done) break;
                if (!value) continue;

                lineBuffer += value;
                const lines = lineBuffer.split(/\r?\n/);
                // Keep the incomplete trailing fragment in the buffer
                lineBuffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                        try {
                            const parsed = JSON.parse(trimmed);
                            this.handleParsedPacket(parsed);
                        } catch (err) {
                            // Non-critical JSON line fragment
                        }
                    }
                }
            }
        } catch (error) {
            if (this.keepReading) {
                console.error('Serial stream reading error:', error);
                this.updateStatus('error', 'Lost connection to device');
            }
        } finally {
            reader.releaseLock();
        }
    }

    // Process a single JSON packet from ESP32
    handleParsedPacket(data) {
        // Normalize fields
        const normalized = {
            heartRate: data.heartRate || data.hr || 72,
            temperature: data.temperature || data.temp || 36.8,
            spo2: data.spo2 || data.spO2 || 98.0,
            ecgRaw: data.ecgRaw !== undefined ? data.ecgRaw : 2048,
            fingerDetected: data.fingerDetected !== undefined ? data.fingerDetected : true,
            ecgLeadsOn: data.ecgLeadsOn !== undefined ? data.ecgLeadsOn : true,
            battery: data.battery || 95,
            deviceId: data.deviceId || this.deviceId,
            source: 'hardware'
        };

        if (this.dataCallback) {
            this.dataCallback(normalized);
        }

        // Forward to server /api/sensor-data so server state stays synced
        this.forwardToServer(normalized);
    }

    async forwardToServer(data) {
        try {
            await fetch('/api/sensor-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } catch (e) {
            // Ignore minor network hiccups
        }
    }

    // Disconnect port
    async disconnect() {
        this.keepReading = false;
        try {
            if (this.reader) {
                await this.reader.cancel();
            }
            if (this.readableStreamClosed) {
                await this.readableStreamClosed.catch(() => {});
            }
            if (this.port) {
                await this.port.close();
            }
        } catch (error) {
            console.warn('Error during serial port close:', error);
        } finally {
            this.port = null;
            this.reader = null;
            this.connected = false;
            this.connecting = false;
            this.updateStatus('disconnected', 'Hardware disconnected');

            // Notify server
            fetch('/api/hardware/disconnect', { method: 'POST' }).catch(() => {});
        }
    }
}

// Global instance
window.serialController = new SerialController();

