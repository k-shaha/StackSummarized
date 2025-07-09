// popup.js - Enhanced version with better error handling and debugging

const API_BASE_URL = 'http://localhost:8000';
const TIMEOUT_MS = 45000; // 45 second timeout

// Utility function to show loading state
function showLoading() {
    const output = document.getElementById('output');
    output.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div class="loading-spinner"></div>
            <p>Summarizing StackOverflow question...</p>
        </div>
    `;
}

// Utility function to show error with details
function showError(message, details = null) {
    const output = document.getElementById('output');
    console.error('Error:', message, details);
    
    let errorHtml = `
        <div style="color: #d32f2f; padding: 15px; border: 1px solid #ffcdd2; border-radius: 4px; background-color: #ffeef0;">
            <strong>⚠️ Error:</strong> ${message}
    `;
    
    if (details) {
        errorHtml += `<br><small style="color: #666;">${details}</small>`;
    }
    
    errorHtml += '</div>';
    output.innerHTML = errorHtml;
}

// Utility function to show success
function showSuccess(summary) {
    const output = document.getElementById('output');
    output.innerHTML = `
        <div style="border: 1px solid #4caf50; border-radius: 4px; background-color: #f1f8e9; padding: 15px;">
            ${summary}
        </div>
    `;
}

// Extract question ID from StackOverflow URL
function extractQuestionId(url) {
    const patterns = [
        /stackoverflow\.com\/questions\/(\d+)/,
        /stackoverflow\.com\/q\/(\d+)/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return null;
}

// Validate if URL is a StackOverflow question
function isValidStackOverflowUrl(url) {
    if (!url) return false;
    
    const validPatterns = [
        /https?:\/\/stackoverflow\.com\/questions\/\d+/,
        /https?:\/\/stackoverflow\.com\/q\/\d+/
    ];
    
    return validPatterns.some(pattern => pattern.test(url));
}

// Make API request with timeout and retry logic
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
            let errorMessage = `Server returned ${response.status}`;
            
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.detail) {
                    errorMessage = errorJson.detail;
                }
            } catch (e) {
                // If not JSON, use the raw text
                if (errorText) {
                    errorMessage = errorText;
                }
            }
            
            throw new Error(errorMessage);
        }
        
        return await response.json();
        
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            throw new Error('Request timed out after 45 seconds');
        }
        
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Cannot connect to backend server. Make sure it\'s running on localhost:8000');
        }
        
        throw error;
    }
}

// Test if backend is running
async function testBackendHealth() {
    try {
        const response = await makeApiRequest(`${API_BASE_URL}/health`);
        console.log('Backend health check:', response);
        return true;
    } catch (error) {
        console.error('Backend health check failed:', error);
        return false;
    }
}

// Main function to summarize StackOverflow question
async function summarizeQuestion() {
    try {
        showLoading();
        
        // Test backend health first
        const backendHealthy = await testBackendHealth();
        if (!backendHealthy) {
            showError('Backend server is not running', 'Start your FastAPI server: python main.py');
            return;
        }
        
        // Get current tab URL
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tabs[0].url;
        
        console.log('Current URL:', currentUrl);
        
        // Validate URL
        if (!isValidStackOverflowUrl(currentUrl)) {
            showError('Not a StackOverflow question page', 'Please navigate to a StackOverflow question first');
            return;
        }
        
        const questionId = extractQuestionId(currentUrl);
        console.log('Question ID:', questionId);
        
        // Make API request
        const requestData = { url: currentUrl };
        console.log('Sending request:', requestData);
        
        const result = await makeApiRequest(`${API_BASE_URL}/summarize`, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });
        
        console.log('API response:', result);
        
        if (result.status === 'success' && result.summary) {
            showSuccess(result.summary);
        } else if (result.status === 'error') {
            showError('Summary generation failed', result.error);
        } else {
            showError('Unexpected response format', JSON.stringify(result));
        }
        
    } catch (error) {
        console.error('Error in summarizeQuestion:', error);
        showError('Failed to summarize question', error.message);
    }
}

// Add retry functionality
async function retryWithDelay(fn, maxRetries = 2, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            console.log(`Attempt ${i + 1} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Enhanced summarize with retry
async function summarizeWithRetry() {
    try {
        await retryWithDelay(summarizeQuestion);
    } catch (error) {
        console.error('All retry attempts failed:', error);
        showError('All attempts failed', error.message);
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('Popup loaded');
    
    // Add loading spinner CSS
    const style = document.createElement('style');
    style.textContent = `
        .loading-spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #3498db;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    // Add manual refresh button
    const refreshButton = document.createElement('button');
    refreshButton.textContent = 'Refresh Summary';
    refreshButton.style.cssText = `
        margin: 10px;
        padding: 8px 16px;
        background: #4caf50;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    `;
    refreshButton.addEventListener('click', summarizeWithRetry);
    document.body.appendChild(refreshButton);
    
    // Auto-start summarization
    summarizeWithRetry();
});

// Handle runtime errors
window.addEventListener('error', function(event) {
    console.error('Runtime error:', event.error);
    showError('Runtime error occurred', event.error.message);
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    showError('Unhandled error', event.reason);
});