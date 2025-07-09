const API_BASE_URL = 'http://localhost:8000';
const TIMEOUT_MS = 45000;

function showLoading() {
    const output = document.getElementById('output');
    output.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div class="loading-spinner" style="
                border: 3px solid #f3f3f3;
                border-top: 3px solid #3498db;
                border-radius: 50%;
                width: 30px;
                height: 30px;
                animation: spin 1s linear infinite;
                margin: 0 auto 10px;">
            </div>
            <style>
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
            <p>Summarizing StackOverflow question...</p>
        </div>
    `;
}

function showError(message, details = null) {
    const output = document.getElementById('output');
    console.error('Error:', message, details);
    output.innerHTML = `
        <div style="color: #d32f2f; padding: 15px; border: 1px solid #ffcdd2; background-color: #ffeef0;">
            <strong>⚠️ Error:</strong> ${message}<br>
            <small style="color: #666;">${details || ''}</small>
        </div>
    `;
}

function showSuccess(summary) {
    const output = document.getElementById('output');
    output.innerHTML = `<div class="summary-box">${summary}</div>`;
}

function isValidStackOverflowUrl(url) {
    return /https?:\/\/stackoverflow\.com\/(questions|q)\/\d+/.test(url);
}

async function makeApiRequest(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...options.headers
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out after 45 seconds');
        }
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Cannot connect to backend. Make sure it’s running on localhost:8000');
        }
        throw error;
    }
}

async function testBackendHealth() {
    try {
        const res = await makeApiRequest(`${API_BASE_URL}/health`);
        console.log('Backend health:', res);
        return true;
    } catch (err) {
        console.error('Health check failed:', err.message);
        return false;
    }
}

async function summarizeQuestion() {
    try {
        showLoading();

        const healthy = await testBackendHealth();
        if (!healthy) {
            showError('Backend not running', 'Start FastAPI server at localhost:8000');
            return;
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tabs[0]?.url;
        console.log('Current URL:', currentUrl);

        if (!isValidStackOverflowUrl(currentUrl)) {
            showError('Invalid StackOverflow URL', currentUrl);
            return;
        }

        const result = await makeApiRequest(`${API_BASE_URL}/summarize`, {
            method: 'POST',
            body: JSON.stringify({ url: currentUrl })
        });

        console.log('API response:', result);

        if (result.status === 'success' && result.summary) {
            showSuccess(result.summary);
        } else {
            showError('Summary failed', result.error || 'Unknown error');
        }
    } catch (err) {
        console.error('Summarize error:', err.message);
        showError('Failed to summarize', err.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Popup loaded');
    document.getElementById("refresh").addEventListener("click", summarizeQuestion);
    summarizeQuestion();
});
