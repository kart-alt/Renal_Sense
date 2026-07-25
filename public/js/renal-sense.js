// Renal Sense Page JavaScript - Real-Time Medical Monitoring
// Handles Local Simulation, WiFi Gateway (WebSockets), and Bluetooth (BLE) modes.

let hrChart, spo2Chart;
let testActive = false;
let packetCount = 0;
const TOTAL_PACKETS = 180;
let elapsedTime = 0;
let elapsedInterval = null;
let selectedGender = null;
let patientAge = null;

// Connection Mode Management
let connectionMode = 'simulation'; // 'simulation', 'websocket', 'bluetooth'
let wsConnection = null;
let simulationInterval = null;

// Telemetry Accumulation (to compute average for prediction)
let collectedHR = [];
let collectedTemp = [];
let collectedSpO2 = [];

// Wait for server config to be available
async function initLiveTest() {
    // Wait for serverConfig to be loaded
    let attempts = 0;
    while (typeof serverConfig === 'undefined' && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    console.log('Renal Sense Page Loaded');
    console.log('Using server:', serverConfig.getWebSocketURL());
    
    // Initialize charts
    initializeCharts();
    
    // Setup event listeners
    window.startTest = startTest;
    window.stopTest = stopTest;
    window.viewResults = viewResults;
    window.startNewTest = startNewTest;
    window.selectGender = selectGender;
    window.setConnectionMode = setConnectionMode;
    window.connectBluetooth = connectBluetooth;
    window.disconnectBluetooth = disconnectBluetooth;

    // Load initial connection mode setting
    setConnectionMode('simulation');
}

// Connection Mode Selection
function setConnectionMode(mode) {
    if (testActive) {
        alert('Cannot change connection mode during an active test');
        return;
    }
    
    connectionMode = mode;
    
    // Update active UI classes on connection toggles
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
        activeBtn.style.background = '#667eea';
        activeBtn.style.borderColor = '#667eea';
        activeBtn.style.color = 'white';
        activeBtn.style.fontWeight = '600';
    }
    
    // Show/hide corresponding status consoles
    const bleConsole = document.getElementById('bleConsole');
    const wifiConsole = document.getElementById('wifiConsole');
    
    if (bleConsole) bleConsole.style.display = mode === 'bluetooth' ? 'block' : 'none';
    if (wifiConsole) wifiConsole.style.display = mode === 'websocket' ? 'block' : 'none';
    
    console.log(`Connection mode toggled to: ${mode}`);
    
    // Clean up other modes' active connections
    if (mode !== 'bluetooth' && window.bluetoothController) {
        window.bluetoothController.disconnect();
    }
    
    if (mode !== 'websocket' && wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    
    // Initialize current mode connections
    if (mode === 'bluetooth' && window.bluetoothController) {
        window.bluetoothController.onStatusChange(handleBLEStatus);
        window.bluetoothController.onDataReceived(handleBLEData);
    } else if (mode === 'websocket') {
        connectWiFiWebSocket();
    }
}

// BLE Controller Status Callback
function handleBLEStatus(statusUpdate) {
    const statusLabel = document.getElementById('bleStatusLabel');
    const detailsLabel = document.getElementById('bleDetailsLabel');
    const connectBtn = document.getElementById('bleConnectBtn');
    const disconnectBtn = document.getElementById('bleDisconnectBtn');
    
    if (!statusLabel) return;
    
    let statusText = 'Disconnected';
    let statusColor = '#666';
    
    switch (statusUpdate.status) {
        case 'scanning':
            statusText = 'Scanning...';
            statusColor = '#f59e0b';
            if (connectBtn) connectBtn.disabled = true;
            break;
        case 'connecting':
            statusText = 'Connecting...';
            statusColor = '#3b82f6';
            break;
        case 'connected':
            statusText = 'Connected';
            statusColor = '#10b981';
            if (connectBtn) connectBtn.style.display = 'none';
            if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
            break;
        case 'disconnected':
        case 'error':
        case 'cancelled':
            statusText = 'Disconnected';
            statusColor = '#ef4444';
            if (connectBtn) {
                connectBtn.disabled = false;
                connectBtn.style.display = 'inline-flex';
            }
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            break;
    }
    
    statusLabel.textContent = `Status: ${statusText}`;
    statusLabel.style.color = statusColor;
    
    if (detailsLabel && statusUpdate.details) {
        detailsLabel.textContent = statusUpdate.details;
    }
}

// BLE Data Notification Callback
function handleBLEData(data) {
    if (!testActive) return;
    processReceivedTelemetry(data.heartRate, data.temperature, data.spo2);
}

// Connect/Disconnect BLE Helpers
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

// WiFi WebSocket Connection setup
function connectWiFiWebSocket() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) return;
    
    const statusLabel = document.getElementById('wifiStatusLabel');
    if (statusLabel) {
        statusLabel.textContent = 'Connecting to WebSocket gateway...';
        statusLabel.style.color = '#666';
    }
    
    const wsURL = serverConfig ? serverConfig.getWebSocketURL() : `ws://${window.location.host}`;
    wsConnection = new WebSocket(wsURL);
    
    wsConnection.onopen = () => {
        console.log('✅ WebSocket connected for live test');
        if (statusLabel) {
            statusLabel.textContent = 'Connected. Waiting for device WiFi stream...';
            statusLabel.style.color = '#10b981';
        }
    };
    
    wsConnection.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'sensor_update') {
                if (statusLabel) {
                    statusLabel.textContent = 'Active streaming from ESP32 detected.';
                    statusLabel.style.color = '#2e7d32';
                }
                
                if (testActive) {
                    const payload = message.payload;
                    const hr = payload.ecg?.heartRate || payload.heartRate || 72;
                    const temp = payload.temperature || 36.8;
                    const spo2 = payload.spO2 || payload.spo2 || 98;
                    processReceivedTelemetry(hr, temp, spo2);
                }
            }
        } catch (err) {
            console.error('Error parsing WebSocket message:', err);
        }
    };
    
    wsConnection.onerror = (error) => {
        console.error('WebSocket connection error:', error);
        if (statusLabel) {
            statusLabel.textContent = 'Gateway error. Ensure Node.js server is running and reload.';
            statusLabel.style.color = '#ef4444';
        }
    };
    
    wsConnection.onclose = () => {
        console.log('WebSocket disconnected');
        if (statusLabel && connectionMode === 'websocket') {
            statusLabel.textContent = 'Disconnected. Select toggle again to reconnect.';
            statusLabel.style.color = '#666';
        }
    };
}

// Gender selection function
function selectGender(gender) {
    selectedGender = gender;
    document.querySelectorAll('.gender-btn').forEach(btn => {
        btn.style.background = 'white';
        btn.style.borderColor = '#ddd';
        btn.style.color = '#333';
    });
    const selectedBtn = document.querySelector(`[data-gender="${gender}"]`);
    if (selectedBtn) {
        selectedBtn.style.background = '#667eea';
        selectedBtn.style.borderColor = '#667eea';
        selectedBtn.style.color = 'white';
    }
}

function initializeCharts() {
    // Heart Rate Chart
    const hrCtx = document.getElementById('hrChart');
    if (hrCtx) {
        hrChart = new Chart(hrCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Heart Rate (BPM)',
                    data: [],
                    borderColor: '#2e7d32',
                    backgroundColor: 'rgba(46, 125, 50, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 3,
                    pointBackgroundColor: '#2e7d32'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: true, labels: { font: { size: 12, weight: '500' } } }
                },
                scales: {
                    y: { beginAtZero: false, min: 40, max: 120, ticks: { font: { size: 10 } } },
                    x: { ticks: { font: { size: 10 } } }
                }
            }
        });
    }

    // SpO2 Chart
    const spo2Ctx = document.getElementById('spo2Chart');
    if (spo2Ctx) {
        spo2Chart = new Chart(spo2Ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'SpO2 (%)',
                    data: [],
                    borderColor: '#4caf50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 3,
                    pointBackgroundColor: '#4caf50'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: true, labels: { font: { size: 12, weight: '500' } } }
                },
                scales: {
                    y: { beginAtZero: false, min: 90, max: 100, ticks: { font: { size: 10 } } },
                    x: { ticks: { font: { size: 10 } } }
                }
            }
        });
    }
}

function startTest() {
    // Validate demographics
    if (!selectedGender) {
        alert('Please select gender before starting the test');
        return;
    }

    patientAge = parseInt(document.getElementById('ageInput').value);
    if (!patientAge || patientAge < 1 || patientAge > 120) {
        alert('Please enter a valid age (1-120)');
        return;
    }

    // Verify hardware connection if Bluetooth is chosen
    if (connectionMode === 'bluetooth' && (!window.bluetoothController || !window.bluetoothController.connected)) {
        alert('Please connect your Bluetooth Device first using the "Connect BLE Device" button.');
        return;
    }

    // Store demographics in sessionStorage
    sessionStorage.setItem('patientDemographics', JSON.stringify({
        gender: selectedGender,
        age: patientAge
    }));

    testActive = true;
    packetCount = 0;
    elapsedTime = 0;

    // Reset telemetry averages
    collectedHR = [];
    collectedTemp = [];
    collectedSpO2 = [];

    // Hide demographics input & connection settings during test
    document.getElementById('demographicsInput').style.display = 'none';
    document.querySelector('.connection-manager').style.display = 'none';

    // Hide start button, show stop button
    document.getElementById('startTestBtn').style.display = 'none';
    document.getElementById('stopTestBtn').style.display = 'inline-flex';

    // Hide next steps buttons
    document.getElementById('viewResultBtn').style.display = 'none';
    document.getElementById('newTestBtn').style.display = 'none';

    // Update status UI
    const statusBadge = document.getElementById('statusBadge');
    if (statusBadge) {
        statusBadge.textContent = 'Testing...';
        statusBadge.className = 'status-badge running';
    }
    document.getElementById('statusText').textContent = 'Running';

    // Reset charts
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
    
    // Reset progress details
    document.getElementById('packetsReceived').textContent = '0';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('dataQuality').textContent = '--';
    
    // Reset progress stages
    document.querySelectorAll('.stage').forEach((stage, idx) => {
        stage.classList.remove('active');
        const icon = stage.querySelector('i');
        if (icon) {
            if (idx < 2) icon.className = 'fas fa-circle-check';
            else icon.className = 'fas fa-circle';
        }
        if (idx === 2) {
            stage.classList.add('active');
        }
    });
    
    // Start elapsed time counter
    elapsedInterval = setInterval(updateElapsedTime, 1000);

    // Send demographics to server
    sendDemographicsToServer();

    // Trigger data streaming based on connection mode
    if (connectionMode === 'simulation') {
        simulateTestData();
    } else if (connectionMode === 'bluetooth') {
        // BLE stream is already connected, wait for notifications
        console.log('📶 Active Bluetooth telemetry ingestion started.');
    } else if (connectionMode === 'websocket') {
        // WiFi stream is already connected, wait for WS messages
        console.log('📡 Active WiFi/WebSocket telemetry ingestion started.');
    }
}

// Send demographics to server
async function sendDemographicsToServer() {
    try {
        const serverURL = serverConfig ? serverConfig.getAPIURL() : 'http://localhost:3000';
        const response = await fetch(`${serverURL}/api/start-test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                demographics: {
                    gender: selectedGender,
                    age: patientAge
                }
            })
        });

        if (response.ok) {
            console.log('✅ Demographics successfully submitted to backend gateway');
        }
    } catch (error) {
        console.error('Error sending demographics:', error);
    }
}

function stopTest() {
    testActive = false;
    
    // Clear intervals
    if (elapsedInterval) clearInterval(elapsedInterval);
    if (simulationInterval) clearInterval(simulationInterval);
    
    // Restore UI visibility
    document.getElementById('startTestBtn').style.display = 'inline-flex';
    document.getElementById('stopTestBtn').style.display = 'none';
    document.getElementById('demographicsInput').style.display = 'block';
    document.querySelector('.connection-manager').style.display = 'block';
    
    // Update status
    const statusBadge = document.getElementById('statusBadge');
    if (statusBadge) {
        statusBadge.textContent = 'Stopped';
        statusBadge.className = 'status-badge';
    }
    document.getElementById('statusText').textContent = 'Stopped';

    // Notify backend
    fetch('/api/stop-test', { method: 'POST' }).catch(err => console.error(err));
}

function updateElapsedTime() {
    elapsedTime++;
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = elapsedTime % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById('elapsedTime').textContent = timeStr;
}

// Direct local browser telemetry generator
function simulateTestData() {
    if (!testActive) return;
    
    simulationInterval = setInterval(() => {
        if (!testActive) {
            clearInterval(simulationInterval);
            return;
        }
        
        // Generate realistic simulated variables
        const heartRate = 65 + Math.random() * 25;
        const temperature = 36.5 + Math.random() * 1;
        const spo2 = 95 + Math.random() * 5;

        processReceivedTelemetry(heartRate, temperature, spo2);

        if (packetCount >= TOTAL_PACKETS) {
            clearInterval(simulationInterval);
        }
    }, 100);
}

// Unified Telemetry Aggregator & Visualizer
function processReceivedTelemetry(heartRate, temperature, spo2) {
    if (!testActive) return;

    // Accumulate for ML average prediction
    collectedHR.push(heartRate);
    collectedTemp.push(temperature);
    collectedSpO2.push(spo2);

    // Update current UI metrics
    document.getElementById('heartRate').textContent = Math.floor(heartRate);
    document.getElementById('temperature').textContent = temperature.toFixed(1);
    document.getElementById('spo2').textContent = spo2.toFixed(1);

    // Update gauge bars
    document.getElementById('heartRateBar').style.width = Math.min(100, Math.max(0, (heartRate - 40) / 80 * 100)) + '%';
    document.getElementById('temperatureBar').style.width = Math.min(100, Math.max(0, (temperature - 35) / 5 * 100)) + '%';
    document.getElementById('spo2Bar').style.width = Math.min(100, Math.max(0, (spo2 - 90) / 10 * 100)) + '%';

    // Update charts periodically
    if (packetCount % 5 === 0) {
        const timeLabel = Math.floor(elapsedTime / 5) + 's';

        if (hrChart) {
            hrChart.data.labels.push(timeLabel);
            hrChart.data.datasets[0].data.push(Math.floor(heartRate));
            if (hrChart.data.labels.length > 25) {
                hrChart.data.labels.shift();
                hrChart.data.datasets[0].data.shift();
            }
            hrChart.update('none');
        }

        if (spo2Chart) {
            spo2Chart.data.labels.push(timeLabel);
            spo2Chart.data.datasets[0].data.push(spo2.toFixed(1));
            if (spo2Chart.data.labels.length > 25) {
                spo2Chart.data.labels.shift();
                spo2Chart.data.datasets[0].data.shift();
            }
            spo2Chart.update('none');
        }
    }
    
    // Update progress variables
    packetCount++;
    const percentage = Math.min(100, Math.round((packetCount / TOTAL_PACKETS) * 100));
    const dataQuality = Math.min(100, 75 + (percentage / 100) * 20);
    
    document.getElementById('packetsReceived').textContent = packetCount;
    document.getElementById('progressFill').style.width = percentage + '%';
    document.getElementById('progressPercent').textContent = percentage + '%';
    document.getElementById('dataQuality').textContent = Math.floor(dataQuality) + '%';
    
    // Shift progress stages UI
    if (percentage > 33 && percentage <= 66) {
        document.querySelectorAll('.stage').forEach((stage, idx) => {
            stage.classList.remove('active');
            const icon = stage.querySelector('i');
            if (idx < 3) {
                if (icon && idx < 2) icon.className = 'fas fa-circle-check';
            }
            if (idx === 3) {
                stage.classList.add('active');
            }
        });
    }
    
    // Finish test when packet limits reached
    if (packetCount >= TOTAL_PACKETS) {
        completeTest();
    }
}

// Complete test & query ML prediction
async function completeTest() {
    testActive = false;
    
    if (elapsedInterval) clearInterval(elapsedInterval);
    if (simulationInterval) clearInterval(simulationInterval);
    
    // Update status
    const statusBadge = document.getElementById('statusBadge');
    if (statusBadge) {
        statusBadge.textContent = 'Processing...';
        statusBadge.className = 'status-badge running';
    }
    document.getElementById('statusText').textContent = 'Analyzing eGFR';
    
    // Update progress to 100%
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('progressPercent').textContent = '100%';

    // Calculate collected averages
    const avgHR = collectedHR.reduce((a, b) => a + b, 0) / (collectedHR.length || 1);
    const avgTemp = collectedTemp.reduce((a, b) => a + b, 0) / (collectedTemp.length || 1);
    const avgSpO2 = collectedSpO2.reduce((a, b) => a + b, 0) / (collectedSpO2.length || 1);
    const finalQuality = 98; // Simulated signal quality percentage

    console.log(`Test completed. Averages: HR=${avgHR.toFixed(1)}, Temp=${avgTemp.toFixed(2)}, SpO2=${avgSpO2.toFixed(1)}`);

    // Fetch eGFR prediction from real ML Model Server
    try {
        const serverURL = serverConfig ? serverConfig.getAPIURL() : 'http://localhost:3000';
        const response = await fetch(`${serverURL}/api/predict`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                heartRate: avgHR,
                temperature: avgTemp,
                spo2: avgSpO2,
                demographics: {
                    gender: selectedGender,
                    age: patientAge
                }
            })
        });

        if (response.ok) {
            const mlResult = await response.json();
            console.log('✅ ML prediction result received:', mlResult);
            
            // Format and store in sessionStorage for results page
            const prediction = mlResult.prediction || mlResult;
            const patientResults = {
                eGFR: Math.round(prediction.egfr || 78),
                heartRate: Math.round(avgHR),
                temperature: parseFloat(avgTemp.toFixed(1)),
                quality: finalQuality,
                confidence: Math.round(prediction.confidence_score || 94),
                riskLevel: prediction.risk_level || 'Low',
                status: prediction.kidney_status || 'Normal Function',
                stage: prediction.kidney_status || 'Normal Function'
            };
            
            sessionStorage.setItem('patientResults', JSON.stringify(patientResults));
            console.log('Stored dynamic patientResults in sessionStorage');
        } else {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('⚠️ Could not obtain real ML prediction. Falling back to local calculator.', error);
        
        // Dynamic fallback logic matching the ML logic
        let simulatedEGFR = 120 - (avgHR - 75) * 0.3 - (avgTemp - 37.0) * 5 - (100 - avgSpO2) * 2 - (patientAge - 50) * 0.5;
        if (selectedGender === 'female') simulatedEGFR -= 5;
        simulatedEGFR = Math.min(120, Math.max(5, simulatedEGFR));

        let statusText = 'Normal Function';
        let riskText = 'Low';
        if (simulatedEGFR < 15) { statusText = 'Kidney Failure'; riskText = 'Very High'; }
        else if (simulatedEGFR < 30) { statusText = 'Severely Reduced'; riskText = 'High'; }
        else if (simulatedEGFR < 60) { statusText = 'Moderately Reduced'; riskText = 'Medium'; }
        else if (simulatedEGFR < 90) { statusText = 'Mildly Reduced'; riskText = 'Low'; }

        const localResults = {
            eGFR: Math.round(simulatedEGFR),
            heartRate: Math.round(avgHR),
            temperature: parseFloat(avgTemp.toFixed(1)),
            quality: finalQuality,
            confidence: 85, // Lower confidence for fallback
            riskLevel: riskText,
            status: statusText,
            stage: statusText
        };
        
        sessionStorage.setItem('patientResults', JSON.stringify(localResults));
    }

    // Shift status and reveal navigation
    if (statusBadge) {
        statusBadge.textContent = 'Complete';
        statusBadge.className = 'status-badge complete';
    }
    document.getElementById('statusText').textContent = 'Complete';
    
    setTimeout(() => {
        document.getElementById('viewResultBtn').style.display = 'inline-flex';
        document.getElementById('newTestBtn').style.display = 'inline-flex';
        
        // Update stages check icon
        document.querySelectorAll('.stage').forEach((stage) => {
            stage.classList.remove('active');
            const icon = stage.querySelector('i');
            if (icon) icon.className = 'fas fa-circle-check';
        });
    }, 500);
}

function viewResults() {
    window.location.href = 'result.html';
}

function startNewTest() {
    // Show demographics and connection manager for configuring next run
    document.getElementById('demographicsInput').style.display = 'block';
    document.querySelector('.connection-manager').style.display = 'block';
    
    // Hide start/stop controls
    document.getElementById('startTestBtn').style.display = 'inline-flex';
    document.getElementById('stopTestBtn').style.display = 'none';
    
    // Hide completion buttons
    document.getElementById('viewResultBtn').style.display = 'none';
    document.getElementById('newTestBtn').style.display = 'none';

    // Reset progress badge
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
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initLiveTest);
