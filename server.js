// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();

// Hardware Connection Management
const hardwareState = {
    connected: false,
    deviceId: null,
    deviceType: 'None', // 'USB-Serial', 'WiFi-ESP32', 'BLE'
    ip: null,
    lastSeen: 0,
    battery: 100,
    fingerDetected: false,
    autoRun: true
};

// Collected telemetry during an active test (for real ML averages)
let testCollectedData = {
    heartRates: [],
    temperatures: [],
    spo2Values: []
};

// Simulation timer handle (only active when demo simulation explicitly requested)
let simulationInterval = null;
let currentTestMode = 'hardware'; // 'hardware' or 'simulation'


// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve WiFi setup page
app.get('/wifi-setup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'wifi-setup.html'));
});

// Hardware Connection & Status Endpoints
app.get('/api/hardware/status', (req, res) => {
    res.json({
        success: true,
        hardware: hardwareState,
        testInProgress,
        packetCount,
        totalPackets: TOTAL_PACKETS,
        testMode: currentTestMode
    });
});

app.post('/api/hardware/connect', (req, res) => {
    hardwareState.connected = true;
    hardwareState.deviceId = req.body.deviceId || 'ESP32-RENAL-01';
    hardwareState.deviceType = req.body.deviceType || 'WiFi-ESP32';
    hardwareState.ip = req.ip || req.body.ip || 'Local';
    hardwareState.lastSeen = Date.now();
    hardwareState.fingerDetected = req.body.fingerDetected !== undefined ? req.body.fingerDetected : true;
    hardwareState.battery = req.body.battery || 95;

    console.log(`🔌 Hardware Registered: ${hardwareState.deviceId} via ${hardwareState.deviceType}`);

    broadcastMessage({
        type: 'hardware_status',
        payload: hardwareState
    });

    res.json({
        success: true,
        message: 'Hardware connected',
        hardware: hardwareState
    });
});

app.post('/api/hardware/disconnect', (req, res) => {
    hardwareState.connected = false;
    hardwareState.deviceId = null;
    hardwareState.deviceType = 'None';
    hardwareState.fingerDetected = false;

    console.log('🔌 Hardware Marked Disconnected');

    broadcastMessage({
        type: 'hardware_status',
        payload: hardwareState
    });

    res.json({ success: true, message: 'Hardware marked disconnected' });
});

// REST API endpoint for ESP32 to send sensor data
app.post('/api/sensor-data', async (req, res) => {
    try {
        const sensorData = req.body;
        const now = Date.now();
        const wasConnected = hardwareState.connected;

        // Update hardware state
        hardwareState.connected = true;
        hardwareState.lastSeen = now;
        hardwareState.deviceId = sensorData.deviceId || hardwareState.deviceId || 'ESP32-RENAL-01';
        hardwareState.deviceType = sensorData.deviceType || hardwareState.deviceType || 'WiFi-ESP32';
        hardwareState.battery = sensorData.battery || hardwareState.battery || 95;
        hardwareState.fingerDetected = sensorData.fingerDetected !== undefined ? sensorData.fingerDetected : true;

        if (!wasConnected) {
            console.log(`🔌 Hardware active and streaming: ${hardwareState.deviceId}`);
            broadcastMessage({
                type: 'hardware_status',
                payload: hardwareState
            });
        }

        // Broadcast sensor data to connected dashboard clients
        broadcastMessage({
            type: 'sensor_update',
            payload: sensorData
        });

        // If test is currently active, accumulate data and advance packet count
        if (testInProgress) {
            const hr = Number(sensorData.heartRate || sensorData.ecg?.heartRate || 72);
            const temp = Number(sensorData.temperature || 36.8);
            const spo2 = Number(sensorData.spo2 || sensorData.spO2 || 98);

            testCollectedData.heartRates.push(hr);
            testCollectedData.temperatures.push(temp);
            testCollectedData.spo2Values.push(spo2);

            packetCount++;

            broadcastMessage({
                type: 'test_progress',
                payload: {
                    testId: `TEST-${testSessionId.toString().padStart(3, '0')}`,
                    packetsReceived: packetCount,
                    totalPackets: TOTAL_PACKETS
                }
            });

            // When target packets reached, compute real ML prediction
            if (packetCount >= TOTAL_PACKETS) {
                testInProgress = false;
                const avgHR = testCollectedData.heartRates.reduce((a, b) => a + b, 0) / (testCollectedData.heartRates.length || 1);
                const avgTemp = testCollectedData.temperatures.reduce((a, b) => a + b, 0) / (testCollectedData.temperatures.length || 1);
                const avgSpO2 = testCollectedData.spo2Values.reduce((a, b) => a + b, 0) / (testCollectedData.spo2Values.length || 1);

                console.log(`🏁 Hardware Test Complete. Averages: HR=${avgHR.toFixed(1)}, Temp=${avgTemp.toFixed(1)}, SpO2=${avgSpO2.toFixed(1)}`);

                const predictionResult = await sendToMLModel({
                    heart_rate: avgHR,
                    temperature: avgTemp,
                    spo2: avgSpO2,
                    demographics: patientDemographics || { gender: 'male', age: 50 }
                });

                broadcastMessage({
                    type: 'test_completed',
                    payload: {
                        mlResults: predictionResult.success ? predictionResult.prediction : null
                    }
                });
            }
        }

        res.status(200).json({ 
            success: true, 
            hardware: hardwareState
        });
    } catch (error) {
        console.error('❌ Error processing sensor data:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing sensor data',
            error: error.message
        });
    }
});

/**
 * Send sensor data to ML model for eGFR prediction
 * @param {Object} sensorData - Sensor data from ESP32
 * @returns {Promise<Object>} Prediction result from ML model
 */
async function sendToMLModel(sensorData) {
    try {
        // Get ML API configuration from config.json or use defaults
        const mlApiIP = process.env.ML_API_IP || '127.0.0.1';
        const mlApiPort = process.env.ML_API_PORT || 5000;
        const mlApiUrl = `http://${mlApiIP}:${mlApiPort}/predict`;
        
        console.log(`📡 Calling ML API at: ${mlApiUrl}`);
        
        // Get demographics from session storage or use defaults
        const demographics = sensorData.demographics || patientDemographics || { gender: 'male', age: 50 };

        // Prepare data for ML model - New kidney monitoring setup
        // Extract values with proper handling for nested objects
        const mlData = {
            // Vital Signs from Hardware
            heart_rate: sensorData.ecg?.heartRate || sensorData.heartRate || 72,
            temperature: sensorData.temperature || 36.8,
            spo2: sensorData.spO2 || sensorData.spo2 || 98,

            // Demographics (for eGFR calculation)
            gender: demographics.gender || 'male',
            age: demographics.age || 50,

            // Metadata
            timestamp: sensorData.timestamp || new Date().toISOString()
        };
        
        console.log('📤 Sending to ML model:', JSON.stringify(mlData, null, 2));
        
        // Send to ML model with timeout
        const response = await Promise.race([
            fetch(mlApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mlData),
                timeout: 5000
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('ML API timeout')), 5000)
            )
        ]);
        
        if (!response.ok) {
            throw new Error(`ML API returned status ${response.status}`);
        }
        
        const result = await response.json();
        console.log('✅ Received prediction from ML model');
        return {
            success: true,
            prediction: result.prediction || result,
            recommendations: result.recommendations || {},
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('⚠️ Error calling ML model:', error.message);
        // Return success: false but don't crash the sensor endpoint
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

// Endpoint to start a test (Smart Hardware-aware)
app.post('/api/start-test', (req, res) => {
    const { demographics, mode, requireHardware } = req.body || {};
    if (demographics) {
        patientDemographics = demographics;
        console.log('👤 Patient demographics stored:', patientDemographics);
    }

    const testMode = mode || currentTestMode || 'hardware';

    // Smart Hardware Check: If in hardware mode and device is required, ensure it is connected!
    if (testMode === 'hardware' && requireHardware && !hardwareState.connected) {
        return res.status(400).json({
            success: false,
            error: 'DEVICE_NOT_CONNECTED',
            message: 'Physical hardware device is not connected. Please connect your ESP32 or switch to demo simulation.'
        });
    }

    startNewTest(testMode);

    res.status(200).json({
        success: true,
        message: `Test started in ${testMode} mode`,
        testId: `TEST-${testSessionId.toString().padStart(3, '0')}`,
        hardwareConnected: hardwareState.connected
    });
});

// Endpoint to stop a test
app.post('/api/stop-test', (req, res) => {
    console.log('Stopping test');
    stopTest();
    res.status(200).json({ 
        success: true, 
        message: 'Test stopped successfully' 
    });
});

// Manual ML Prediction endpoint (for testing)
app.post('/api/predict', async (req, res) => {
    try {
        const sensorData = req.body;
        console.log('📊 Received prediction request with data:', sensorData);
        
        // Attach demographic information to sensor data
        const dataWithDemographics = {
            ...sensorData,
            demographics: patientDemographics
        };
        
        console.log('👤 Including demographics:', patientDemographics);
        
        // Send to ML model with demographics
        const predictionResult = await sendToMLModel(dataWithDemographics);
        
        res.status(200).json(predictionResult);
    } catch (error) {
        console.error('❌ Error in prediction endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Check AI/API Configuration
app.get('/api/check-ai-config', (req, res) => {
    const hasGeminiKey = !!process.env.GOOGLE_AI_API_KEY;
    const geminiModel = 'gemini-pro';
    
    res.status(200).json({
        success: true,
        apiAvailable: hasGeminiKey,
        model: geminiModel,
        features: {
            voiceInput: true,
            voiceOutput: true,
            textToSpeech: true,
            imageAnalysis: false,
            codeExecution: false,
            geminiAI: hasGeminiKey
        },
        message: hasGeminiKey ? 'Google Gemini API is configured' : 'Using local AI (Gemini API not configured)'
    });
});

// Store patient demographics before test starts
let patientDemographics = {
    gender: null,  // 'male' or 'female'
    age: null      // age in years
};

// API endpoint to set demographic information
app.post('/api/demographics', (req, res) => {
    try {
        const { gender, age } = req.body;
        
        // Validate input
        if (!gender || !['male', 'female'].includes(gender.toLowerCase())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gender. Must be "male" or "female"'
            });
        }
        
        if (!age || age < 0 || age > 150 || !Number.isInteger(parseInt(age))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid age. Must be a number between 0 and 150'
            });
        }
        
        // Store demographics
        patientDemographics = {
            gender: gender.toLowerCase(),
            age: parseInt(age)
        };
        
        console.log(`👤 Demographics set - Gender: ${patientDemographics.gender}, Age: ${patientDemographics.age}`);
        
        res.status(200).json({
            success: true,
            message: 'Demographics recorded successfully',
            demographics: patientDemographics
        });
        
    } catch (error) {
        console.error('Error in demographics API:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing demographics',
            error: error.message
        });
    }
});

// API endpoint to get current demographics
app.get('/api/demographics', (req, res) => {
    res.status(200).json({
        success: true,
        demographics: patientDemographics
    });
});

// Chatbot API endpoint for AI-powered health tips
app.post('/api/chatbot', async (req, res) => {
    try {
        const { message, patientResults, conversationHistory, sessionId } = req.body;
        
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Message is required' 
            });
        }
        
        const sessionIdVal = sessionId || 'session_' + Date.now();
        console.log(`[Chatbot] Session: ${sessionIdVal}, Message: ${message.substring(0, 50)}`);
        
        // Set a timeout for AI response generation
        const aiResponsePromise = generateAIResponse(message, patientResults, conversationHistory);
        
        // Create a timeout promise (25 seconds)
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI response timeout')), 25000)
        );
        
        // Race between AI response and timeout
        let aiResponse;
        try {
            aiResponse = await Promise.race([aiResponsePromise, timeoutPromise]);
        } catch (timeoutError) {
            console.warn('⚠️ AI response timeout, using fallback');
            aiResponse = 'I\'m processing your question about kidney health. Please try again in a moment. Your question: "' + message.substring(0, 50) + '..."';
        }
        
        res.status(200).json({ 
            success: true, 
            reply: aiResponse || 'Unable to generate response',
            patientResults: patientResults
        });
        
    } catch (error) {
        console.error('Error in chatbot API:', error.message);
        // Always return success with fallback message instead of error
        res.status(200).json({ 
            success: true,
            reply: 'I encountered a temporary issue processing your question. Please try again!',
            patientResults: req.body?.patientResults || {}
        });
    }
});

/**
 * Generate AI response using xAI Grok API
 * Fallback to local generation if API not available
 */
async function generateAIResponse(userMessage, patientResults, conversationHistory) {
    const apiKey = process.env.GROK_API_KEY || '';
    
    // Build patient context
    const patientContext = patientResults ? `
    Patient Test Results:
    - eGFR: ${patientResults.eGFR} mL/min/1.73m²
    - Kidney Status: ${patientResults.status || 'Unknown'}
    - Risk Level: ${patientResults.riskLevel || 'Unknown'}
    - Heart Rate: ${patientResults.heartRate || '--'} BPM
    - Temperature: ${patientResults.temperature || '--'}°C
    - Test Confidence: ${patientResults.confidence || '--'}%
    ` : '';
    
    const systemPrompt = `You are a compassionate and knowledgeable kidney health assistant. Your role is to provide personalized health tips and guidance based on the patient's test results.

${patientContext}

Guidelines:
1. Provide personalized advice based on the patient's kidney function status
2. Give practical, actionable health tips (diet, exercise, medication, hydration)
3. Use friendly and encouraging language
4. Explain kidney health concepts in simple terms
5. Recommend when to consult healthcare professionals
6. Focus on prevention and early intervention
7. Be empathetic and supportive
8. Provide specific recommendations based on eGFR level
9. Suggest lifestyle modifications appropriate for their stage
10. Do not provide medical diagnosis - only tips and general guidance

Remember: Always prioritize patient safety and recommend professional medical consultation for serious concerns.`;
    
    try {
        // Try using Grok API if key is available
        if (apiKey) {
            return await callGrokAPI(userMessage, systemPrompt, conversationHistory, apiKey);
        } else {
            // Fallback to local AI generation
            return generateLocalAIResponse(userMessage, patientResults, conversationHistory);
        }
    } catch (error) {
        console.error('Error generating AI response:', error);
        return generateLocalAIResponse(userMessage, patientResults, conversationHistory);
    }
}

/**
 * Call xAI Grok API (OpenAI Compatible)
 */
async function callGrokAPI(userMessage, systemPrompt, conversationHistory, apiKey) {
    try {
        const model = process.env.GROK_MODEL || 'grok-2-latest';
        const url = 'https://api.x.ai/v1/chat/completions';
        
        console.log(`📡 Calling Grok API (${model})...`);
        console.log(`🔑 API Key present: ${apiKey ? 'Yes ✓' : 'No ✗'}`);
        
        // Build messages array
        const messages = [
            { role: "system", content: systemPrompt }
        ];
        
        if (conversationHistory && conversationHistory.length > 0) {
            conversationHistory.slice(-4).forEach(msg => {
                const mappedRole = msg.role.toLowerCase() === 'user' ? 'user' : 'assistant';
                messages.push({ role: mappedRole, content: msg.content });
            });
        }
        
        messages.push({ role: "user", content: userMessage });
        
        const requestBody = {
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 2048,
            stream: false
        };
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody),
            timeout: 30000
        });

        console.log(`📨 Response Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Grok API HTTP Error:', errorText.substring(0, 200));
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { error: { message: errorText || 'Unknown error' } };
            }
            const errorMsg = errorData?.error?.message || 'Unknown error';
            throw new Error(`Grok API error (${response.status}): ${errorMsg}`);
        }

        const data = await response.json();
        console.log('✓ Received response from Grok API');
        
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            console.log('✅ Grok API Response Successful - Got text content');
            return data.choices[0].message.content;
        }
        
        throw new Error('Invalid or empty response from Grok API');
        
    } catch (error) {
        console.error('❌ Grok API Call Failed:', error.message);
        console.log('Falling back to local AI...');
        throw error;
    }
}

/**
 * Local AI response generation (no API key required)
 * Uses predefined templates and intelligent matching
 */
function generateLocalAIResponse(userMessage, patientResults, conversationHistory) {
    const lowerMessage = userMessage.toLowerCase();
    
    // Get patient risk level
    const riskLevel = patientResults?.riskLevel?.toLowerCase() || 'unknown';
    const eGFR = patientResults?.eGFR || 0;
    const status = patientResults?.status?.toLowerCase() || 'unknown';
    
    // Kidney disease stage based on eGFR
    let stage = 'Unknown';
    if (eGFR >= 90) stage = 'Stage 1 (Normal)';
    else if (eGFR >= 60) stage = 'Stage 2 (Mild)';
    else if (eGFR >= 45) stage = 'Stage 3a (Mild-Moderate)';
    else if (eGFR >= 30) stage = 'Stage 3b (Moderate-Severe)';
    else if (eGFR >= 15) stage = 'Stage 4 (Severe)';
    else stage = 'Stage 5 (Kidney Failure)';
    
    // Generate personalized response based on keywords and patient status
    if (lowerMessage.includes('diet') || lowerMessage.includes('food') || lowerMessage.includes('eat')) {
        return generateDietAdvice(eGFR, stage);
    } else if (lowerMessage.includes('exercise') || lowerMessage.includes('activity') || lowerMessage.includes('workout')) {
        return generateExerciseAdvice(eGFR, stage);
    } else if (lowerMessage.includes('medicine') || lowerMessage.includes('medication') || lowerMessage.includes('drug')) {
        return generateMedicationAdvice(eGFR, stage);
    } else if (lowerMessage.includes('water') || lowerMessage.includes('drink') || lowerMessage.includes('hydration')) {
        return generateHydrationAdvice(eGFR, stage);
    } else if (lowerMessage.includes('test') || lowerMessage.includes('check') || lowerMessage.includes('monitor')) {
        return generateMonitoringAdvice(eGFR, stage);
    } else if (lowerMessage.includes('what') && (lowerMessage.includes('can') || lowerMessage.includes('should'))) {
        return generateGeneralAdvice(eGFR, stage);
    } else if (lowerMessage.includes('avoid') || lowerMessage.includes('not') || lowerMessage.includes('don\'t')) {
        return generateAvoidanceAdvice(eGFR, stage);
    } else if (lowerMessage.includes('sodium') || lowerMessage.includes('salt')) {
        return generateSodiumAdvice(eGFR, stage);
    } else if (lowerMessage.includes('potassium') || lowerMessage.includes('banana')) {
        return generatePotassiumAdvice(eGFR, stage);
    } else if (lowerMessage.includes('protein')) {
        return generateProteinAdvice(eGFR, stage);
    } else if (lowerMessage.includes('tip') || lowerMessage.includes('help') || lowerMessage.includes('suggest')) {
        return generatePersonalizedTips(eGFR, stage);
    } else {
        return generateGeneralResponse(eGFR, stage, userMessage);
    }
}

/**
 * Generate diet advice personalized by kidney stage
 */
function generateDietAdvice(eGFR, stage) {
    let advice = '🥗 **Personalized Diet Recommendations**\n\n';
    
    if (eGFR >= 60) {
        advice += `Based on your ${stage}, here are kidney-friendly diet tips:\n\n`;
        advice += '✓ **DO:**\n';
        advice += '- Eat fresh fruits and vegetables\n';
        advice += '- Choose lean proteins (fish, chicken)\n';
        advice += '- Use herbs instead of salt for flavoring\n';
        advice += '- Drink plenty of water (typically 8-10 glasses/day)\n';
        advice += '- Eat whole grains\n\n';
        advice += '✗ **AVOID:**\n';
        advice += '- Processed foods (high in sodium)\n';
        advice += '- Cured meats\n';
        advice += '- Sugary drinks\n';
        advice += '- Excess salt\n\n';
    } else {
        advice += `For your ${stage}, stricter dietary control is important:\n\n`;
        advice += '⚠️ **Important Restrictions:**\n';
        advice += `- Limit protein intake (consult dietitian for exact amount)\n`;
        advice += '- Reduce sodium to less than 2,300mg/day\n';
        advice += '- Be cautious with potassium-rich foods\n';
        advice += '- Limit phosphorus intake\n';
        advice += '- Monitor fluid intake carefully\n\n';
        advice += '**Best Foods for Advanced CKD:**\n';
        advice += '- Cauliflower, cabbage, green beans\n';
        advice += '- Apples, pears, grapes (low potassium fruits)\n';
        advice += '- White rice, pasta\n';
        advice += '- Low-protein bread\n\n';
    }
    
    advice += '💡 **Pro Tip:** Consider consulting a renal dietitian for a personalized meal plan tailored to your specific needs.';
    
    return advice;
}

/**
 * Generate exercise advice
 */
function generateExerciseAdvice(eGFR, stage) {
    let advice = '💪 **Exercise & Physical Activity Guide**\n\n';
    
    if (eGFR >= 60) {
        advice += '**You can engage in regular exercise!**\n\n';
        advice += '✓ **Recommended Activities:**\n';
        advice += '- Brisk walking (30 minutes, 5 days/week)\n';
        advice += '- Swimming or water aerobics\n';
        advice += '- Cycling\n';
        advice += '- Yoga or tai chi\n';
        advice += '- Resistance training (2-3 times/week)\n\n';
    } else {
        advice += '**Exercise is beneficial but needs to be monitored.**\n\n';
        advice += '✓ **Safe Activities:**\n';
        advice += '- Gentle walking (20-30 minutes)\n';
        advice += '- Light stretching\n';
        advice += '- Seated exercises\n';
        advice += '- Tai chi\n\n';
        advice += '⚠️ **Cautions:**\n';
        advice += '- Avoid heavy weightlifting\n';
        advice += '- Don\'t exercise if you feel unwell\n';
        advice += '- Start slowly and increase gradually\n\n';
    }
    
    advice += '💡 **General Guidelines:**\n';
    advice += '- Aim for 150 minutes of moderate activity per week\n';
    advice += '- Stay hydrated before, during, and after exercise\n';
    advice += '- Warm up and cool down properly\n';
    advice += '- Listen to your body and rest when needed\n';
    advice += '- Consult your doctor before starting a new exercise program';
    
    return advice;
}

/**
 * Generate medication advice
 */
function generateMedicationAdvice(eGFR, stage) {
    let advice = '💊 **Medication Guidance**\n\n';
    
    advice += `For your ${stage}:\n\n`;
    advice += '✓ **Important Points:**\n';
    advice += '- Always take medications exactly as prescribed\n';
    advice += '- Keep all appointments to monitor medication effectiveness\n';
    advice += '- Inform your doctor about all over-the-counter medications\n';
    advice += '- Never skip doses without consulting your doctor\n\n';
    
    if (eGFR < 60) {
        advice += '⚠️ **Special Considerations:**\n';
        advice += '- Some medications need dose adjustments with reduced kidney function\n';
        advice += '- NSAIDs (ibuprofen) should be avoided\n';
        advice += '- Certain supplements may harm your kidneys\n';
        advice += '- Always inform healthcare providers about kidney disease\n\n';
    }
    
    advice += '📋 **Common Kidney Disease Medications:**\n';
    advice += '- ACE inhibitors (help reduce blood pressure)\n';
    advice += '- ARBs (protect kidney function)\n';
    advice += '- Diuretics (manage fluid and electrolytes)\n';
    advice += '- Statins (reduce cholesterol)\n\n';
    
    advice += '💡 **Reminder:** Never change your medication without consulting your doctor.';
    
    return advice;
}

/**
 * Generate hydration advice
 */
function generateHydrationAdvice(eGFR, stage) {
    let advice = '💧 **Hydration Guidelines**\n\n';
    
    if (eGFR >= 60) {
        advice += '**General recommendation: 8-10 glasses of water per day**\n\n';
        advice += '✓ **Hydration Tips:**\n';
        advice += '- Drink water throughout the day\n';
        advice += '- Limit sugary and caffeinated beverages\n';
        advice += '- Avoid excessive salt intake\n';
        advice += '- Drink more in hot weather or during exercise\n\n';
    } else {
        advice += '**Fluid intake needs careful monitoring**\n\n';
        advice += '⚠️ **Important:**\n';
        advice += '- Consult your doctor about your daily fluid limit\n';
        advice += '- May need to restrict fluids (often 1-2 liters/day)\n';
        advice += '- Monitor for signs of fluid overload\n';
        advice += '- Track urine output\n\n';
    }
    
    advice += '💡 **Helpful Tips:**\n';
    advice += '- Set reminders to drink water regularly\n';
    advice += '- Limit drinks at bedtime\n';
    advice += '- Use smaller glasses\n';
    advice += '- Try herbal teas (caffeine-free)\n';
    advice += '- Monitor your weight daily for fluid retention signs';
    
    return advice;
}

/**
 * Generate monitoring advice
 */
function generateMonitoringAdvice(eGFR, stage) {
    let advice = '📊 **Testing & Monitoring Schedule**\n\n';
    
    advice += `Based on your current ${stage}:\n\n`;
    
    if (eGFR >= 60) {
        advice += '✓ **Recommended Schedule:**\n';
        advice += '- Annual kidney function tests\n';
        advice += '- Annual blood pressure checks\n';
        advice += '- Annual urine tests\n';
        advice += '- Regular blood work\n\n';
    } else if (eGFR >= 30) {
        advice += '✓ **More Frequent Monitoring:**\n';
        advice += '- Every 6 months: eGFR and creatinine tests\n';
        advice += '- Every 3 months: urine protein levels\n';
        advice += '- Monthly: blood pressure monitoring\n';
        advice += '- As needed: additional blood work\n\n';
    } else {
        advice += '✓ **Regular Monitoring Essential:**\n';
        advice += '- Every 3 months: comprehensive metabolic panel\n';
        advice += '- Monthly: eGFR, creatinine, electrolytes\n';
        advice += '- Frequent: blood pressure checks\n';
        advice += '- Regular: discussions with nephrologist\n\n';
    }
    
    advice += '💡 **What to Track:**\n';
    advice += '- Blood pressure readings\n';
    advice += '- Weight\n';
    advice += '- Urine output\n';
    advice += '- Lab results\n';
    advice += '- Any new symptoms\n';
    advice += '- Medication changes';
    
    return advice;
}

/**
 * Generate potassium advice
 */
function generatePotassiumAdvice(eGFR, stage) {
    let advice = '🍌 **Potassium Management**\n\n';
    
    if (eGFR >= 60) {
        advice += '**Potassium is essential for heart health.**\n\n';
        advice += '✓ **High-Potassium Foods (Encouraged):**\n';
        advice += '- Bananas\n';
        advice += '- Oranges\n';
        advice += '- Avocados\n';
        advice += '- Spinach and dark leafy greens\n';
        advice += '- Sweet potatoes\n\n';
    } else {
        advice += '**You may need to limit potassium intake.**\n\n';
        advice += '⚠️ **Foods to Limit:**\n';
        advice += '- Bananas (use smaller portions)\n';
        advice += '- Orange juice\n';
        advice += '- Avocados\n';
        advice += '- Spinach\n';
        advice += '- Tomatoes (high in potassium)\n';
        advice += '- Nuts and seeds\n';
        advice += '- Dried fruits\n\n';
        advice += '✓ **Low-Potassium Alternatives:**\n';
        advice += '- Apples and pears\n';
        advice += '- Grapes\n';
        advice += '- Green beans\n';
        advice += '- Cucumber\n';
        advice += '- Cabbage\n\n';
    }
    
    advice += '💡 **Always consult your doctor or dietitian about safe potassium levels for your condition.';
    
    return advice;
}

/**
 * Generate sodium advice
 */
function generateSodiumAdvice(eGFR, stage) {
    let advice = '🧂 **Sodium Reduction Tips**\n\n';
    
    advice += `For your ${stage}, limiting sodium is important:\n\n`;
    advice += '✓ **Ways to Reduce Salt:**\n';
    advice += '- Use herbs and spices for flavoring\n';
    advice += '- Avoid processed foods\n';
    advice += '- Don\'t add salt during cooking\n';
    advice += '- Limit canned foods\n';
    advice += '- Choose fresh over processed meat\n';
    advice += '- Read food labels (aim for <2,300mg sodium/day)\n\n';
    advice += '⚠️ **Hidden Sodium Sources:**\n';
    advice += '- Bread and rolls\n';
    advice += '- Deli meats\n';
    advice += '- Canned soups\n';
    advice += '- Soy sauce\n';
    advice += '- Cheese\n';
    advice += '- Condiments\n\n';
    advice += '💡 **Cooking Tips:**\n';
    advice += '- Prepare meals at home\n';
    advice += '- Rinse canned vegetables\n';
    advice += '- Use potassium-based salt substitutes (with doctor approval)';
    
    return advice;
}

/**
 * Generate protein advice
 */
function generateProteinAdvice(eGFR, stage) {
    let advice = '🥚 **Protein Intake Guidelines**\n\n';
    
    if (eGFR >= 60) {
        advice += '**Protein is important, but choose wisely.**\n\n';
        advice += '✓ **Best Protein Sources:**\n';
        advice += '- Fish (2-3 times per week)\n';
        advice += '- Chicken or turkey\n';
        advice += '- Eggs\n';
        advice += '- Legumes (beans, lentils)\n';
        advice += '- Low-fat dairy\n\n';
    } else {
        advice += '**Protein intake needs to be carefully controlled.**\n\n';
        advice += '⚠️ **Important:**\n';
        advice += '- Excess protein increases kidney workload\n';
        advice += '- Your doctor will determine the right amount\n';
        advice += '- Consult a renal dietitian\n\n';
        advice += '✓ **Better Options:**\n';
        advice += '- Smaller portions of lean protein\n';
        advice += '- Fish over red meat\n';
        advice += '- Plant-based proteins (limited)\n';
        advice += '- Egg whites\n\n';
    }
    
    advice += '💡 **Remember:** Talk to your healthcare team about the right protein amount for your kidney function level.';
    
    return advice;
}

/**
 * Generate avoidance advice
 */
function generateAvoidanceAdvice(eGFR, stage) {
    let advice = '🛑 **What to Avoid for Kidney Health**\n\n';
    
    advice += '⚠️ **Medications & Substances to Avoid:**\n';
    advice += '- NSAIDs (ibuprofen, naproxen)\n';
    advice += '- Excess alcohol\n';
    advice += '- High-dose supplements\n';
    advice += '- ACE inhibitors without doctor guidance\n\n';
    
    advice += '⚠️ **Foods to Avoid or Limit:**\n';
    advice += '- Processed and canned foods\n';
    advice += '- Sugary drinks\n';
    advice += '- Salt-laden snacks\n';
    advice += '- Fast food\n';
    advice += '- Fatty meats\n';
    advice += '- Excess caffeine\n\n';
    
    if (eGFR < 60) {
        advice += '⚠️ **Additional Restrictions:**\n';
        advice += `- Certain potassium-rich foods\n`;
        advice += '- High-phosphorus foods\n';
        advice += '- Excess fluid intake\n\n';
    }
    
    advice += '💡 **Pro Tip:** Keep a food diary to track what affects your health.';
    
    return advice;
}

/**
 * Generate personalized tips
 */
function generatePersonalizedTips(eGFR, stage) {
    let advice = '⭐ **Personalized Health Tips for You**\n\n';
    
    advice += `Based on your ${stage}:\n\n`;
    
    if (eGFR >= 90) {
        advice += '✓ **Your kidneys are functioning well. Focus on prevention:**\n';
        advice += '- Maintain a healthy diet and exercise regularly\n';
        advice += '- Keep blood pressure under control\n';
        advice += '- Manage weight\n';
        advice += '- Avoid smoking\n';
        advice += '- Limit alcohol\n';
        advice += '- Stay hydrated\n';
        advice += '- Get annual check-ups\n\n';
    } else if (eGFR >= 60) {
        advice += '✓ **Your kidney function is mildly reduced. Key actions:**\n';
        advice += '- Monitor kidney function every 6-12 months\n';
        advice += '- Maintain healthy blood pressure (<130/80)\n';
        advice += '- Keep balanced diet with moderate sodium\n';
        advice += '- Exercise regularly\n';
        advice += '- Control diabetes if present\n';
        advice += '- Avoid NSAIDs\n';
        advice += '- Regular medical follow-ups\n\n';
    } else if (eGFR >= 30) {
        advice += '⚠️ **Your kidney disease is moderate. Important steps:**\n';
        advice += '- See a nephrologist regularly (every 3-4 months)\n';
        advice += '- Strict blood pressure control\n';
        advice += '- Limit sodium significantly\n';
        advice += '- Monitor protein intake carefully\n';
        advice += '- Restrict potassium as needed\n';
        advice += '- Regular lab tests\n';
        advice += '- Consider nephrology referral\n';
        advice += '- Prepare for possible future treatments\n\n';
    } else {
        advice += '⚠️ **Your kidney function is severely reduced. Critical care needed:**\n';
        advice += '- Frequent nephrologist visits (monthly or more)\n';
        advice += '- Strict dietary restrictions\n';
        advice += '- Close fluid management\n';
        advice += '- Blood work every month\n';
        advice += '- Prepare for dialysis or transplant\n';
        advice += '- Manage related conditions (anemia, blood pressure)\n';
        advice += '- Emotional and family support\n\n';
    }
    
    advice += '🏥 **Always maintain regular contact with your healthcare team!**';
    
    return advice;
}

/**
 * Generate general advice
 */
function generateGeneralAdvice(eGFR, stage) {
    let advice = '📋 **General Kidney Health Advice**\n\n';
    
    advice += `Your Current Status: ${stage}\n\n`;
    advice += '✓ **Key Recommendations:**\n';
    advice += '- Monitor kidney function regularly\n';
    advice += '- Keep blood pressure below 130/80 mmHg\n';
    advice += '- Eat a kidney-friendly diet\n';
    advice += '- Stay physically active\n';
    advice += '- Avoid smoking and excessive alcohol\n';
    advice += '- Manage diabetes and other conditions\n';
    advice += '- Stay hydrated appropriately\n';
    advice += '- Take medications as prescribed\n\n';
    advice += '💡 **Need More Information?**\n';
    advice += 'Ask me about: diet, exercise, medications, testing, what to avoid, potassium, sodium, protein, or any specific concern!';
    
    return advice;
}

/**
 * Generate general response
 */
function generateGeneralResponse(eGFR, stage, userMessage) {
    return `I'm here to help with kidney health information for your ${stage}. 
    
Based on your test results, I can provide personalized advice on:
- **Diet**: kidney-friendly foods and restrictions
- **Exercise**: safe physical activities
- **Medications**: usage and precautions  
- **Hydration**: proper fluid intake
- **Monitoring**: testing schedules
- **Lifestyle**: tips for kidney health

Feel free to ask about any of these topics or let me know if you have other concerns about your kidney health!`;
}

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    console.log('New WebSocket client connected');
    clients.add(ws);
    
    // Send initial connection message
    ws.send(JSON.stringify({
        type: 'connection_established',
        payload: {
            message: 'Connected to Smart Kidney Monitoring System'
        }
    }));
    
    // Handle incoming messages from clients
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message from client:', data);
            
            // Handle different message types
            switch (data.type) {
                case 'ping':
                    ws.send(JSON.stringify({
                        type: 'pong'
                    }));
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    });
    
    // Handle client disconnect
    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        clients.delete(ws);
    });
    
    // Handle WebSocket errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Function to broadcast messages to all connected clients
function broadcastMessage(message) {
    const messageString = JSON.stringify(message);
    
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
}

// Simulate sensor data for demonstration
function simulateSensorData() {
    const sensorData = {
        // Kidney Monitoring Sensors (New Setup - ECG HR, Temperature, SpO2)
        heartRate: parseInt(60 + Math.random() * 40),  // 60-100 BPM
        temperature: parseFloat((36.0 + Math.random() * 2).toFixed(1)),  // 36-38°C
        spo2: parseFloat((95 + Math.random() * 5).toFixed(1)),  // 95-100% SpO2
        battery: parseInt(70 + Math.random() * 30)  // Battery percentage
    };

    broadcastMessage({
        type: 'sensor_update',
        payload: sensorData
    });
}

// Track test sessions to avoid duplicates
let testSessionId = 1;
let packetCount = 0;
const TOTAL_PACKETS = 180;
let testInProgress = false;

function startNewTest(mode = 'hardware') {
    testInProgress = true;
    packetCount = 0;
    testSessionId++;
    currentTestMode = mode;
    testCollectedData = { heartRates: [], temperatures: [], spo2Values: [] };
    console.log(`Starting new test session: ${testSessionId} [Mode: ${mode}]`);

    broadcastMessage({
        type: 'test_started',
        payload: {
            testId: `TEST-${testSessionId.toString().padStart(3, '0')}`,
            mode: mode
        }
    });

    if (mode === 'simulation') {
        startSimulation();
    }
}

function startSimulation() {
    if (simulationInterval) clearInterval(simulationInterval);
    simulationInterval = setInterval(() => {
        if (!testInProgress) {
            clearInterval(simulationInterval);
            simulationInterval = null;
            return;
        }
        simulateSensorData();
        simulateTestProgress();
    }, 1000);
}

function stopTest() {
    testInProgress = false;
    packetCount = 0;
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
    console.log('Test stopped');
    broadcastMessage({ type: 'test_stopped' });
}

function simulateTestProgress() {
    if (!testInProgress) return;
    
    if (packetCount < TOTAL_PACKETS) {
        packetCount++;
        
        broadcastMessage({
            type: 'test_progress',
            payload: {
                testId: `TEST-${testSessionId.toString().padStart(3, '0')}`,
                packetsReceived: packetCount,
                totalPackets: TOTAL_PACKETS
            }
        });
        
        // When test is complete, send completion message
        if (packetCount === TOTAL_PACKETS) {
            setTimeout(() => {
                // Simulate realistic biophysical parameters
                const realisticEGFR = (85 + Math.random() * 15).toFixed(2); // Normal range: 90-120
                const realisticTemp = (36.8 + (Math.random() - 0.5) * 0.4).toFixed(1); // Normal: 36.5-37.5°C
                const realisticBP = `${Math.floor(110 + Math.random() * 20)}/${Math.floor(70 + Math.random() * 10)}`; // Normal: 120/80
                
                const mockMLResult = {
                    testId: `TEST-${testSessionId.toString().padStart(3, '0')}`,
                    timestamp: new Date().toISOString(),
                    biophysical: {
                        blood_pressure: realisticBP,
                        body_temperature: realisticTemp,
                        heart_rate: Math.floor(60 + Math.random() * 20), // 60-80 BPM
                        respiratory_rate: Math.floor(12 + Math.random() * 4) // 12-16 breaths/min
                    },
                    prediction: {
                        egfr: realisticEGFR,
                        kidney_status: realisticEGFR >= 90 ? "Normal" : realisticEGFR >= 60 ? "Mildly Reduced" : "Risk",
                        confidence_score: (88 + Math.random() * 12).toFixed(1), // 88-100%
                        risk_level: realisticEGFR >= 90 ? "Low" : realisticEGFR >= 60 ? "Medium" : "High"
                    },
                    recommendations: {
                        primary: realisticEGFR >= 90 ? 
                            "Continue with regular monitoring. Maintain healthy hydration levels." :
                            "Consult with a nephrologist for further evaluation.",
                        secondary: [
                            "Maintain blood pressure below 130/80 mmHg",
                            "Follow a low-protein diet",
                            realisticEGFR >= 90 ? "Schedule next test in 12 months" : "Schedule next test in 6 months"
                        ],
                        next_test_schedule: realisticEGFR >= 90 ? "12 months" : "6 months"
                    }
                };
                
                // Broadcast test completion with mock ML results
                broadcastMessage({
                    type: 'test_completed',
                    payload: {
                        mlResults: mockMLResult
                    }
                });
                
                // Stop the test after completion
                stopTest();
            }, 1000);
        }
    }
}

// Start the server
const HOST = 'localhost';  // Listen on localhost for local development

server.listen(PORT, HOST, () => {
    // Get the IP address for displaying to users
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let ipAddress = 'localhost';
    
    // Priority: Use environment variable, then find network IP, then localhost
    if (process.env.SERVER_IP) {
        ipAddress = process.env.SERVER_IP;
    } else {
        // Find the first non-loopback IPv4 address
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    ipAddress = iface.address;
                    break;
                }
            }
            if (ipAddress !== 'localhost') break;
        }
    }
    
    // Get ML API configuration from environment variables
    // Important: ML API should be on the same network IP as the server
    const ML_API_IP = process.env.ML_API_IP || ipAddress;
    const ML_API_PORT = process.env.ML_API_PORT || 5000;
    
    console.log(`\n========================================`);
    console.log(`Server running on http://${ipAddress}:${PORT}`);
    console.log(`WebSocket server running on ws://${ipAddress}:${PORT}`);
    console.log(`Local: http://localhost:${PORT}`);
    console.log(`ML API: http://${ML_API_IP}:${ML_API_PORT}`);
    console.log(`========================================\n`);
    
    // Create a config file that clients can use
    const fs = require('fs');
    const config = {
        serverIP: ipAddress,
        serverPort: PORT,
        mlApiIP: ML_API_IP,
        mlApiPort: parseInt(ML_API_PORT),
        timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(
        path.join(__dirname, 'public', 'config.json'),
        JSON.stringify(config, null, 2)
    );
});

// Hardware Timeout Watchdog (checks every 2 seconds)
setInterval(() => {
    if (hardwareState.connected) {
        const elapsedSinceLastSeen = Date.now() - hardwareState.lastSeen;
        if (elapsedSinceLastSeen > 7000) {
            console.log('⚠️ Hardware connection timed out (no packets received for 7s)');
            hardwareState.connected = false;
            hardwareState.fingerDetected = false;
            broadcastMessage({
                type: 'hardware_status',
                payload: hardwareState
            });
        }
    }
}, 2000);

console.log('🩺 Smart Hardware Mode active: Waiting for device connection.');

console.log('✅ Server fully initialized and running!');

// Add server heartbeat to keep it alive
let heartbeatCount = 0;
const heartbeatInterval = setInterval(() => {
    heartbeatCount++;
    const timestamp = new Date().toLocaleTimeString();
    console.log(`💓 Heartbeat ${heartbeatCount} - Server alive at ${timestamp}`);
    
    // Check if server is still listening
    if (server.listening) {
        console.log('  ✓ Server is listening on port ${PORT}');
    } else {
        console.error('  ❌ WARNING: Server is NOT listening!');
    }
}, 30000); // Every 30 seconds

// Prevent interval from keeping process alive indefinitely
heartbeatInterval.unref();

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown handler - only on explicit Ctrl+C (3 seconds of no activity)
let lastActivityTime = Date.now();
setInterval(() => {
    const timeSinceLastActivity = Date.now() - lastActivityTime;
    if (timeSinceLastActivity > 120000) { // 2 minutes
        console.log('⏱️ No activity for 2 minutes, server still running...');
        lastActivityTime = Date.now();
    }
}, 10000);

process.on('SIGINT', () => {
    console.log('\n\n⛔ SIGINT Signal received - shutting down gracefully');
    console.log('Closing all connections...');
    
    // Close all WebSocket connections
    clients.forEach(client => {
        try {
            client.close();
        } catch (e) {}
    });
    
    // Close WebSocket server
    wss.close(() => {
        console.log('✓ WebSocket server closed');
    });
    
    // Close HTTP server
    server.close(() => {
        console.log('✓ HTTP server closed');
        console.log('⏹️ Server shutdown complete');
        process.exit(0);
    });
    
    // Force exit after 10 seconds if not graceful
    setTimeout(() => {
        console.error('⚠️ Forcing shutdown after timeout...');
        process.exit(1);
    }, 10000);
});