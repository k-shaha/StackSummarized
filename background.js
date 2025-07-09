// background.js - Service worker for the extension

// Extension installation and updates
chrome.runtime.onInstalled.addListener((details) => {
    console.log('StackOverflow Summarizer installed/updated:', details.reason);
    
    if (details.reason === 'install') {
        console.log('Extension installed for the first time');
    } else if (details.reason === 'update') {
        console.log('Extension updated from version:', details.previousVersion);
    }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
    console.log('Extension started up');
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Message received in background:', request);
    
    if (request.action === 'getCurrentUrl') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                sendResponse({ url: tabs[0].url });
            } else {
                sendResponse({ error: 'No active tab found' });
            }
        });
        return true; // Keep message channel open for async response
    }
    
    if (request.action === 'checkBackendHealth') {
        // This could be extended to ping the backend from the service worker
        sendResponse({ status: 'checking' });
        return true;
    }
    
    if (request.action === 'log') {
        console.log('Log from extension:', request.message);
        sendResponse({ logged: true });
    }
});

// Handle tab updates to detect navigation to StackOverflow
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only process when the tab is completely loaded
    if (changeInfo.status === 'complete' && tab.url) {
        const isStackOverflow = tab.url.includes('stackoverflow.com/questions/');
        
        if (isStackOverflow) {
            console.log('User navigated to StackOverflow question:', tab.url);
            
            // Update the action badge to indicate it's ready
            chrome.action.setBadgeText({
                tabId: tabId,
                text: '✓'
            });
            
            chrome.action.setBadgeBackgroundColor({
                tabId: tabId,
                color: '#4CAF50'
            });
            
            chrome.action.setTitle({
                tabId: tabId,
                title: 'Click to summarize this StackOverflow question'
            });
        } else {
            // Clear badge for non-StackOverflow pages
            chrome.action.setBadgeText({
                tabId: tabId,
                text: ''
            });
            
            chrome.action.setTitle({
                tabId: tabId,
                title: 'Navigate to a StackOverflow question to summarize'
            });
        }
    }
});

// Handle tab activation (switching between tabs)
chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab.url && tab.url.includes('stackoverflow.com/questions/')) {
            chrome.action.setBadgeText({
                tabId: activeInfo.tabId,
                text: '✓'
            });
            chrome.action.setBadgeBackgroundColor({
                tabId: activeInfo.tabId,
                color: '#4CAF50'
            });
        } else {
            chrome.action.setBadgeText({
                tabId: activeInfo.tabId,
                text: ''
            });
        }
    });
});

// Context menu integration (optional enhancement)
chrome.contextMenus.create({
    id: 'summarize-question',
    title: 'Summarize this StackOverflow question',
    contexts: ['page'],
    documentUrlPatterns: ['https://stackoverflow.com/questions/*']
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'summarize-question') {
        // Open the popup programmatically
        chrome.action.openPopup();
    }
});

// Error handling for service worker
self.addEventListener('error', (event) => {
    console.error('Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection in service worker:', event.reason);
});

// Keep service worker alive (if needed)
let keepAliveInterval;

function keepAlive() {
    keepAliveInterval = setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {
            // Just a simple operation to keep the service worker alive
        });
    }, 20000); // Every 20 seconds
}

// Start keep alive when service worker starts
keepAlive();

// Clean up on service worker shutdown
self.addEventListener('beforeunload', () => {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
});

console.log('StackOverflow Summarizer background service worker loaded');