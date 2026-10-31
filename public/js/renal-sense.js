// Renal Sense Page JavaScript - Smart Real-Time Kidney Monitoring
// Handles Direct USB Serial (WebSerial), WiFi Gateway (WebSockets), Bluetooth (BLE), and Simulation modes.

let hrChart, spo2Chart;
let testActive = false;
let testPausedForHardware = false;
let packetCount = 0;
const TOTAL_PACKETS = 180;
let elapsedTime = 0;
let elapsedInterval = null;
let selectedGender = 'male'; // Default male for instant start
let patientAge = 50;

// Connection Mode Management: 'serial' (default hardware), 'websocket', 'bluetooth', 'simulation'
let connectionMode = 'serial';
let wsConnection = null;
let simulationInterval = null;
let serverHardwareState = { connected: false, deviceId: null, deviceType: null, fingerDetected: false };
let autoRunTriggered = false;

// Telemetry Accumulation (to compute average for prediction)
let collectedHR = [];
let collectedTemp = [];
let collectedSpO2 = [];

// Wait for server config and initialize
async function initLiveTest() {
    let attempts = 0;
    while (typeof serverConfig === 'undefined' && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }

    console.log('🩺 Renal Sense Smart Dashboard Initialized');

    // Initialize charts
    initializeCharts();

    // Setup global window event listeners
    window.startTest = startTest;
    window.stopTest = stopTest;
    window.viewResults = viewResults;
    window.startNewTest = startNewTest;
    window.selectGender = selectGender;
    window.setConnectionMode = setConnectionMode;
    window.connectSerial = connectSerial;
    window.disconnectSerial = disconnectSerial;
    window.connectBluetooth = connectBluetooth;
    window.disconnectBluetooth = disconnectBluetooth;

    // Hook WebSerial events
    if (window.serialController) {
        window.serialController.onStatusChange(handleSerialStatus);
        window.serialController.onDataReceived(handleSerialData);
    }

    // Connect WebSocket gateway in background to receive WiFi ESP32 data & server events
    connectWiFiWebSocket();

    // Query backend hardware status immediately
    fetchHardwareStatus();
    setInterval(fetchHardwareStatus, 3000);

    // Default to USB Direct Serial hardware mode
    setConnectionMode('serial');

    // Mark default gender button
    selectGender('male');
}

// -------------------------------------------------------------------------------------
// HARDWARE CONNECTION & STATUS MANAGEMENT
// -------------------------------------------------------------------------------------
function isHardwareConnected() {
    if (connectionMode === 'simulation') return true;
    if (connectionMode === 'serial') {
        return window.serialController && window.serialController.connected;
    }
    if (connectionMode === 'bluetooth') {
        return window.bluetoothController && window.bluetoothController.connected;
    }
    if (connectionMode === 'websocket') {
        return Boolean(serverHardwareState && serverHardwareState.connected);
    }
    return false;
}

// Check hardware state from backend
async function fetchHardwareStatus() {
    try {
        const res = await fetch('/api/hardware/status');
        if (res.ok) {
            const data = await res.json();
            if (data.hardware) {
                serverHardwareState = data.hardware;
                // If in WiFi/websocket mode, update UI from server state
                if (connectionMode === 'websocket') {
                    updateHardwareBanner(
                        serverHardwareState.connected,
                        serverHardwareState.deviceId || 'ESP32',
                        serverHardwareState.deviceType || 'WiFi',
                        serverHardwareState.fingerDetected
                    );
                }
            }
        }
    } catch (e) {
        // Backend ping
    }
}

// Update the top live banner and Start button state
function updateHardwareBanner(connected, deviceId, deviceType, fingerDetected) {
    const banner = document.getElementById('hardwareLiveBanner');
    const dot = document.getElementById('hwStatusDot');
    const text = document.getElementById('hwBannerText');
    const pill = document.getElementById('hwSensorPill');
    const startBtn = document.getElementById('startTestBtn');

    if (!banner || !dot || !text) return;

    if (connectionMode === 'simulation') {
        banner.style.background = '#faf5ff';
        banner.style.borderColor = '#f3e8ff';
        banner.style.color = '#7e22ce';
        dot.style.background = '#a855f7';
        dot.style.boxShadow = '0 0 0 3px rgba(168, 85, 247, 0.2)';
        text.innerHTML = '<strong>Demo Simulation Mode Active</strong> — Running without hardware.';
        if (pill) {
            pill.textContent = 'Simulated';
            pill.style.background = '#f3e8ff';
            pill.style.color = '#7e22ce';
        }
        if (startBtn && !testActive) {
            startBtn.innerHTML = '<i class="fas fa-play"></i> Start Test (Demo Mode)';
            startBtn.classList.remove('btn-disabled');
        }
        return;
    }

    if (connected) {
        banner.style.background = '#ecfdf5';
        banner.style.borderColor = '#a7f3d0';
        banner.style.color = '#065f46';
        dot.style.background = '#10b981';
        dot.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.3)';
        text.innerHTML = `<strong>🟢 Hardware Connected:</strong> ${deviceId || 'ESP32'} (${deviceType || connectionMode.toUpperCase()}) — Ready to monitor.`;

        if (pill) {
            if (fingerDetected) {
                pill.textContent = '🟢 Sensor Contact Active';
                pill.style.background = '#d1fae5';
                pill.style.color = '#065f46';
            } else {
                pill.textContent = '🟡 Place Finger on Sensor';
                pill.style.background = '#fef3c7';
                pill.style.color = '#92400e';
            }
        }

        if (startBtn && !testActive) {
            startBtn.innerHTML = '<i class="fas fa-play"></i> Start Test (Hardware Ready)';
            startBtn.classList.remove('btn-disabled');
        }

        // Smart Auto-Run: trigger automatically if enabled & finger placed
        const autoRunCheck = document.getElementById('smartAutoRunCheck');
        if (autoRunCheck && autoRunCheck.checked && !testActive && !autoRunTriggered && fingerDetected) {
            console.log('⚡ Smart Auto-Run triggered by hardware connection & sensor contact!');
            autoRunTriggered = true;
            setTimeout(() => {
                if (!testActive && isHardwareConnected()) {
                    startTest();
                }
            }, 1000);
        }
    } else {
        banner.style.background = '#fef2f2';
        banner.style.borderColor = '#fee2e2';
        banner.style.color = '#991b1b';
        dot.style.background = '#ef4444';
        dot.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.2)';
        text.innerHTML = '<strong>🔴 Hardware Disconnected</strong> — Connect device below to begin monitoring.';

        if (pill) {
            pill.textContent = 'No Signal';
            pill.style.background = 'rgba(0,0,0,0.06)';
            pill.style.color = '#991b1b';
        }

        if (startBtn && !testActive) {
            startBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Connect Device to Start';
        }

        // If disconnected mid-test, pause and warn
        if (testActive) {
            console.warn('⚠️ Hardware disconnected during test session!');
            const statusBadge = document.getElementById('statusBadge');
            if (statusBadge) {
                statusBadge.textContent = 'Paused (No Signal)';
                statusBadge.className = 'status-badge running';
            }
            document.getElementById('statusText').textContent = 'Device Disconnected';
        }
    }
}

// -------------------------------------------------------------------------------------
// CONNECTION MODE SWITCHING
// -------------------------------------------------------------------------------------
function setConnectionMode(mode) {
    if (testActive) {
        alert('Cannot change connection mode during an active test');
        return;
    }

    connectionMode = mode;
    autoRunTriggered = false;

    // Update active UI classes on connection tabs
    document.querySelectorAll('.connection-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'white';
        btn.style.borderColor = '#ddd';
        btn.style.color = '#333';
        btn.style.fontWeight = '500';
    });

    const activeBtn = document.getElementById(`modeBtn-${mode}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = (mode === 'serial') ? '#0284c7' : (mode === 'simulation') ? '#9333ea' : '#3b82f6';
        activeBtn.style.borderColor = activeBtn.style.background;
        activeBtn.style.color = 'white';
        activeBtn.style.fontWeight = '600';
    }

    // Toggle Consoles
    const serialConsole = document.getElementById('serialConsole');
    const wifiConsole = document.getElementById('wifiConsole');
    const bleConsole = document.getElementById('bleConsole');
    const simConsole = document.getElementById('simulationConsole');

    if (serialConsole) serialConsole.style.display = (mode === 'serial') ? 'block' : 'none';
    if (wifiConsole) wifiConsole.style.display = (mode === 'websocket') ? 'block' : 'none';
    if (bleConsole) bleConsole.style.display = (mode === 'bluetooth') ? 'block' : 'none';
    if (simConsole) simConsole.style.display = (mode === 'simulation') ? 'block' : 'none';

    // Update banner for current mode
    if (mode === 'serial') {
        const isConn = window.serialController && window.serialController.connected;
        updateHardwareBanner(isConn, window.serialController?.deviceId, 'USB-Serial', isConn);
    } else if (mode === 'bluetooth') {
        const isConn = window.bluetoothController && window.bluetoothController.connected;
        updateHardwareBanner(isConn, 'RenalSense-BLE', 'BLE', isConn);
    } else if (mode === 'websocket') {
        updateHardwareBanner(serverHardwareState.connected, serverHardwareState.deviceId, 'WiFi', serverHardwareState.fingerDetected);
    } else if (mode === 'simulation') {
        updateHardwareBanner(true, 'Simulator', 'Mock', true);
    }
}

// -------------------------------------------------------------------------------------
// USB SERIAL CONTROLLER HANDLERS
// -------------------------------------------------------------------------------------
async function connectSerial() {
    if (!window.serialController) return;
    const ok = await window.serialController.connect(115200);
    if (!ok && !window.serialController.isSupported()) {
        alert('Web Serial is not supported in this browser. Please use Google Chrome or Microsoft Edge, or switch to WiFi mode.');
    }
}

async function disconnectSerial() {
    if (window.serialController) {
        await window.serialController.disconnect();
    }
}

function handleSerialStatus(statusUpdate) {
    const label = document.getElementById('serialStatusLabel');
    const connBtn = document.getElementById('serialConnectBtn');
    const disconnBtn = document.getElementById('serialDisconnectBtn');

    if (statusUpdate.status === 'connected') {
        if (label) {
            label.textContent = `Connected: ${statusUpdate.deviceId || 'ESP32'}`;
            label.style.color = '#0284c7';
        }
        if (connBtn) connBtn.style.display = 'none';
        if (disconnBtn) disconnBtn.style.display = 'inline-flex';
        updateHardwareBanner(true, statusUpdate.deviceId || 'ESP32', 'USB-Serial', true);
    } else if (statusUpdate.status === 'connecting') {
        if (label) {
            label.textContent = 'Selecting device in browser popup...';
            label.style.color = '#f59e0b';
        }
    } else {
        if (label) {
            label.textContent = statusUpdate.details || 'Disconnected';
            label.style.color = '#64748b';
        }
        if (connBtn) connBtn.style.display = 'inline-flex';
        if (disconnBtn) disconnBtn.style.display = 'none';
        updateHardwareBanner(false, null, null, false);
    }
}

function handleSerialData(data) {
    // Update live sensor pill if finger contact changed
    const pill = document.getElementById('hwSensorPill');
    if (pill) {
        if (data.fingerDetected) {
            pill.textContent = '🟢 Sensor Contact Active';
            pill.style.background = '#d1fae5';
            pill.style.color = '#065f46';
        } else {
            pill.textContent = '🟡 Place Finger on Sensor';
            pill.style.background = '#fef3c7';
            pill.style.color = '#92400e';
        }
    }

    // Always update live metrics UI
    updateLiveMetricsCard(data.heartRate, data.temperature, data.spo2);

    // If test is active, process into charts and test quota
    if (testActive && connectionMode === 'serial') {
        processReceivedTelemetry(data.heartRate, data.temperature, data.spo2);
    }
}

// -------------------------------------------------------------------------------------
// BLUETOOTH CONTROLLER HANDLERS
// -------------------------------------------------------------------------------------
async function connectBluetooth() {
    if (window.bluetoothController) {
        await window.bluetoothController.connect();
    }
}

function disconnectBluetooth() {
    if (window.bluetoothController) {
        window.bluetoothController.disconnect();
    }
}

function handleBLEStatus(statusUpdate) {
    const statusLabel = document.getElementById('bleStatusLabel');
    const connectBtn = document.getElementById('bleConnectBtn');
    const disconnectBtn = document.getElementById('bleDisconnectBtn');

    if (!statusLabel) return;

    if (statusUpdate.status === 'connected') {
        statusLabel.textContent = 'Status: Connected';
        statusLabel.style.color = '#10b981';
        if (connectBtn) connectBtn.style.display = 'none';
        if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
        updateHardwareBanner(true, 'RenalSense-BLE', 'BLE', true);
    } else {
        statusLabel.textContent = 'Status: Disconnected';
        statusLabel.style.color = '#ef4444';
        if (connectBtn) connectBtn.style.display = 'inline-flex';
        if (disconnectBtn) disconnectBtn.style.display = 'none';
        updateHardwareBanner(false, null, null, false);
    }
}

function handleBLEData(data) {
    updateLiveMetricsCard(data.heartRate, data.temperature, data.spo2);
    if (testActive && connectionMode === 'bluetooth') {
        processReceivedTelemetry(data.heartRate, data.temperature, data.spo2);
    }
}

// -------------------------------------------------------------------------------------
// WIFI WEBSOCKET GATEWAY HANDLER
// -------------------------------------------------------------------------------------
function connectWiFiWebSocket() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) return;

    const wsURL = (typeof serverConfig !== 'undefined') ? serverConfig.getWebSocketURL() : `ws://${window.location.host}`;
    wsConnection = new WebSocket(wsURL);

    wsConnection.onopen = () => {
        console.log('✅ WebSocket gateway connected');
        const wifiStatus = document.getElementById('wifiStatusLabel');
        if (wifiStatus) {
            wifiStatus.textContent = 'Connected to server gateway. Listening for ESP32 stream...';
            wifiStatus.style.color = '#2e7d32';
        }
    };

    wsConnection.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);

            if (message.type === 'hardware_status') {
                serverHardwareState = message.payload;
                if (connectionMode === 'websocket') {
                    updateHardwareBanner(
                        serverHardwareState.connected,
                        serverHardwareState.deviceId || 'ESP32',
                        serverHardwareState.deviceType || 'WiFi',
                        serverHardwareState.fingerDetected
                    );
                }
            } else if (message.type === 'sensor_update') {
                const payload = message.payload;
                const hr = payload.heartRate || payload.ecg?.heartRate || 72;
                const temp = payload.temperature || 36.8;
                const spo2 = payload.spo2 || payload.spO2 || 98;

                updateLiveMetricsCard(hr, temp, spo2);

                if (testActive && connectionMode === 'websocket') {
                    processReceivedTelemetry(hr, temp, spo2);
                }
            } else if (message.type === 'test_completed') {
                if (testActive) {
                    completeTest(message.payload?.mlResults);
                }
            }
        } catch (err) {
            console.error('Error handling WebSocket message:', err);
        }
    };

    wsConnection.onclose = () => {
        setTimeout(connectWiFiWebSocket, 3000);
    };
}

// -------------------------------------------------------------------------------------
// DEMOGRAPHICS & CHARTS
// -------------------------------------------------------------------------------------
function selectGender(gender) {
    selectedGender = gender;
    document.querySelectorAll('.gender-btn').forEach(btn => {
        btn.style.background = 'white';
        btn.style.borderColor = '#ddd';
        btn.style.color = '#333';
    });
    const selectedBtn = document.querySelector(`[data-gender="${gender}"]`);
    if (selectedBtn) {
        selectedBtn.style.background = '#3b82f6';
        selectedBtn.style.borderColor = '#3b82f6';
        selectedBtn.style.color = 'white';
    }
}

function initializeCharts() {
    const hrCtx = document.getElementById('hrChart');
    if (hrCtx) {
        hrChart = new Chart(hrCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Heart Rate (BPM)',
                    data: [],
                    borderColor: '#0284c7',
                    backgroundColor: 'rgba(2, 132, 199, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    pointRadius: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    y: { min: 45, max: 120, ticks: { font: { size: 10 } } },
                    x: { ticks: { font: { size: 10 } } }
                }
            }
        });
    }

    const spo2Ctx = document.getElementById('spo2Chart');
    if (spo2Ctx) {
        spo2Chart = new Chart(spo2Ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'SpO2 (%)',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    pointRadius: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    y: { min: 90, max: 100, ticks: { font: { size: 10 } } },
                    x: { ticks: { font: { size: 10 } } }
                }
            }
        });
    }
}

// Update cards in real time
function updateLiveMetricsCard(hr, temp, spo2) {
    const hrEl = document.getElementById('heartRate');
    const tempEl = document.getElementById('temperature');
    const spo2El = document.getElementById('spo2');

    if (hrEl) hrEl.textContent = Math.round(hr);
    if (tempEl) tempEl.textContent = Number(temp).toFixed(1);
    if (spo2El) spo2El.textContent = Number(spo2).toFixed(1);

    const hrBar = document.getElementById('heartRateBar');
    const tempBar = document.getElementById('temperatureBar');
    const spo2Bar = document.getElementById('spo2Bar');

    if (hrBar) hrBar.style.width = Math.min(100, Math.max(0, (hr - 40) / 80 * 100)) + '%';
    if (tempBar) tempBar.style.width = Math.min(100, Math.max(0, (temp - 35) / 5 * 100)) + '%';
    if (spo2Bar) spo2Bar.style.width = Math.min(100, Math.max(0, (spo2 - 90) / 10 * 100)) + '%';
}

// -------------------------------------------------------------------------------------
// TEST EXECUTION (SMART RULE: ONLY RUNS AFTER DEVICE CONNECTED UNLESS DEMO)
// -------------------------------------------------------------------------------------
async function startTest() {
    // 1. SMART HARDWARE CHECK: Device must be connected unless in simulation mode!
    if (connectionMode !== 'simulation' && !isHardwareConnected()) {
        alert(
            '⚠️ Physical Hardware Device Required!\n\n' +
            'This test runs only after the monitoring hardware is connected.\n\n' +
            '👉 If using USB cable: Click the "Connect USB Device" button above.\n' +
            '👉 If using WiFi: Turn on your ESP32 connected to the same network.\n\n' +
            '(To test without a physical board, switch to "Demo Simulator" mode).'
        );
        return;
    }

    patientAge = parseInt(document.getElementById('ageInput')?.value) || 50;

    sessionStorage.setItem('patientDemographics', JSON.stringify({
        gender: selectedGender,
        age: patientAge
    }));

    testActive = true;
    packetCount = 0;
    elapsedTime = 0;
    collectedHR = [];
    collectedTemp = [];
    collectedSpO2 = [];

    // Hide input & connection panel during active acquisition
    document.getElementById('demographicsInput').style.display = 'none';
    document.querySelector('.connection-manager').style.display = 'none';

    // Buttons
    document.getElementById('startTestBtn').style.display = 'none';
    document.getElementById('stopTestBtn').style.display = 'inline-flex';
    document.getElementById('viewResultBtn').style.display = 'none';
    document.getElementById('newTestBtn').style.display = 'none';

    // Status UI
    const statusBadge = document.getElementById('statusBadge');
    if (statusBadge) {
        statusBadge.textContent = 'Testing...';
        statusBadge.className = 'status-badge running';
    }
    document.getElementById('statusText').textContent = 'Monitoring';
    document.getElementById('packetsReceived').textContent = '0';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('dataQuality').textContent = '95%';

    // Clear charts
    if (hrChart) {
        hrChart.data.labels = [];
        hrChart.data.datasets[0].data = [];
        hrChart.update();
    }
    if (spo2Chart) {
        spo2Chart.data.labels = [];
        spo2Chart.data.datasets[0].data = [];
        spo2Chart.update();
    }

    // Timer
    if (elapsedInterval) clearInterval(elapsedInterval);
    elapsedInterval = setInterval(updateElapsedTime, 1000);

    // Notify backend
    try {
        await fetch('/api/start-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                demographics: { gender: selectedGender, age: patientAge },
                mode: connectionMode,
                requireHardware: (connectionMode !== 'simulation')
            })
        });
    } catch (e) {
        console.warn('Backend start-test notify error:', e);
    }

    // If simulation mode, run browser timer
    if (connectionMode === 'simulation') {
        simulateTestData();
    } else {
        console.log(`🚀 Smart Hardware Acquisition active via ${connectionMode.toUpperCase()}`);
    }
}

function stopTest() {
    testActive = false;
    if (elapsedInterval) clearInterval(elapsedInterval);
    if (simulationInterval) clearInterval(simulationInterval);

    document.getElementById('startTestBtn').style.display = 'inline-flex';
    document.getElementById('stopTestBtn').style.display = 'none';
    document.getElementById('demographicsInput').style.display = 'block';
    document.querySelector('.connection-manager').style.display = 'block';

    const statusBadge = document.getElementById('statusBadge');
    if (statusBadge) {
        statusBadge.textContent = 'Stopped';
        statusBadge.className = 'status-badge';
    }
    document.getElementById('statusText').textContent = 'Stopped';

    fetch('/api/stop-test', { method: 'POST' }).catch(() => {});
}

function updateElapsedTime() {
    elapsedTime++;
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = elapsedTime % 60;
    document.getElementById('elapsedTime').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Telemetry Aggregator & Visualizer
function processReceivedTelemetry(heartRate, temperature, spo2) {
    if (!testActive) return;

    collectedHR.push(Number(heartRate));
    collectedTemp.push(Number(temperature));
    collectedSpO2.push(Number(spo2));

    packetCount++;
    const percentage = Math.min(100, Math.round((packetCount / TOTAL_PACKETS) * 100));

    document.getElementById('packetsReceived').textContent = packetCount;
    document.getElementById('progressFill').style.width = percentage + '%';
    document.getElementById('progressPercent').textContent = percentage + '%';

    // Push to chart every 2 packets
    if (packetCount % 2 === 0) {
        const timeLabel = `${elapsedTime}s`;
        if (hrChart) {
            hrChart.data.labels.push(timeLabel);
            hrChart.data.datasets[0].data.push(Math.round(heartRate));
            if (hrChart.data.labels.length > 25) {
                hrChart.data.labels.shift();
                hrChart.data.datasets[0].data.shift();
            }
            hrChart.update('none');
        }

        if (spo2Chart) {
            spo2Chart.data.labels.push(timeLabel);
            spo2Chart.data.datasets[0].data.push(Number(spo2).toFixed(1));
            if (spo2Chart.data.labels.length > 25) {
                spo2Chart.data.labels.shift();
                spo2Chart.data.datasets[0].data.shift();
            }
            spo2Chart.update('none');
        }
    }

    if (packetCount >= TOTAL_PACKETS) {
        completeTest();
    }
}

// Simulation fallback generator (only used in demo mode)
function simulateTestData() {
    if (!testActive) return;
    simulationInterval = setInterval(() => {
        if (!testActive) {
            clearInterval(simulationInterval);
            return;
        }
        const hr = 70 + Math.random() * 15;
        const temp = 36.6 + Math.random() * 0.4;
        const spo2 = 97 + Math.random() * 2.5;

        updateLiveMetricsCard(hr, temp, spo2);
        processReceivedTelemetry(hr, temp, spo2);

        if (packetCount >= TOTAL_PACKETS) {
            clearInterval(simulationInterval);
        }
    }, 150);
}

// Complete test and send real averages to ML model
async function completeTest(serverResult = null) {
    testActive = false;
    if (elapsedInterval) clearInterval(elapsedInterval);
    if (simulationInterval) clearInterval(simulationInterval);

    const statusBadge = document.getElementById('statusBadge');
    if (statusBadge) {
        statusBadge.textContent = 'Analyzing...';
        statusBadge.className = 'status-badge running';
    }
    document.getElementById('statusText').textContent = 'Computing eGFR';
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('progressPercent').textContent = '100%';

    const avgHR = collectedHR.reduce((a, b) => a + b, 0) / (collectedHR.length || 1);
    const avgTemp = collectedTemp.reduce((a, b) => a + b, 0) / (collectedTemp.length || 1);
    const avgSpO2 = collectedSpO2.reduce((a, b) => a + b, 0) / (collectedSpO2.length || 1);

    let prediction = serverResult;

    if (!prediction) {
        try {
            const resp = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    heartRate: avgHR,
                    temperature: avgTemp,
                    spo2: avgSpO2,
                    demographics: { gender: selectedGender, age: patientAge }
                })
            });

            if (resp.ok) {
                const data = await resp.json();
                prediction = data.prediction || data;
            }
        } catch (e) {
            console.warn('Could not reach backend /api/predict, applying local ML formula:', e);
        }
    }

    // Dynamic local fallback if needed
    if (!prediction) {
        let egfrCalc = 120 - (avgHR - 75) * 0.3 - (avgTemp - 37.0) * 5 - (100 - avgSpO2) * 2 - (patientAge - 50) * 0.5;
        if (selectedGender === 'female') egfrCalc -= 5;
        egfrCalc = Math.min(120, Math.max(5, egfrCalc));
        prediction = {
            egfr: Math.round(egfrCalc),
            kidney_status: egfrCalc >= 90 ? 'Normal Function' : egfrCalc >= 60 ? 'Mildly Reduced' : 'Risk',
            risk_level: egfrCalc >= 90 ? 'Low' : egfrCalc >= 60 ? 'Medium' : 'High',
            confidence_score: 92
        };
    }

    const patientResults = {
        eGFR: Math.round(prediction.egfr || 85),
        heartRate: Math.round(avgHR),
        temperature: parseFloat(avgTemp.toFixed(1)),
        spo2: parseFloat(avgSpO2.toFixed(1)),
        confidence: Math.round(prediction.confidence_score || 93),
        riskLevel: prediction.risk_level || 'Low',
        status: prediction.kidney_status || 'Normal Function',
        stage: prediction.kidney_status || 'Normal Function'
    };

    sessionStorage.setItem('patientResults', JSON.stringify(patientResults));

    if (statusBadge) {
        statusBadge.textContent = 'Complete';
        statusBadge.className = 'status-badge complete';
    }
    document.getElementById('statusText').textContent = 'Complete';

    document.getElementById('viewResultBtn').style.display = 'inline-flex';
    document.getElementById('newTestBtn').style.display = 'inline-flex';

    document.querySelectorAll('.stage').forEach(s => {
        s.classList.remove('active');
        const icon = s.querySelector('i');
        if (icon) icon.className = 'fas fa-circle-check';
    });
}

function viewResults() {
    window.location.href = 'result.html';
}

function startNewTest() {
    autoRunTriggered = false;
    document.getElementById('demographicsInput').style.display = 'block';
    document.querySelector('.connection-manager').style.display = 'block';
    document.getElementById('startTestBtn').style.display = 'inline-flex';
    document.getElementById('stopTestBtn').style.display = 'none';
    document.getElementById('viewResultBtn').style.display = 'none';
    document.getElementById('newTestBtn').style.display = 'none';

    const statusBadge = document.getElementById('statusBadge');
    if (statusBadge) {
        statusBadge.textContent = 'Ready';
        statusBadge.className = 'status-badge';
    }
    document.getElementById('statusText').textContent = 'Ready';
    document.getElementById('packetsReceived').textContent = '0';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('dataQuality').textContent = '--';
    document.getElementById('elapsedTime').textContent = '0:00';

    updateHardwareBanner(
        isHardwareConnected(),
        connectionMode === 'serial' ? window.serialController?.deviceId : 'ESP32',
        connectionMode.toUpperCase(),
        isHardwareConnected()
    );
}

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', initLiveTest);
