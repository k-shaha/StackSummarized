// content.js - Content script for StackOverflow pages

// Extract question ID from current page URL
function getQuestionId() {
    const url = window.location.href;
    const match = url.match(/\/questions\/(\d+)/);
    return match ? match[1] : null;
}

// Send message to background script when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

function initialize() {
    const questionId = getQuestionId();
    if (questionId) {
        console.log('StackOverflow Summarizer: Question ID found:', questionId);
        
        // Send message to background script
        chrome.runtime.sendMessage({
            action: 'questionPageLoaded',
            questionId: questionId,
            url: window.location.href
        });
    }
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageInfo') {
        sendResponse({
            url: window.location.href,
            questionId: getQuestionId(),
            title: document.title
        });
    }
});

console.log('StackOverflow Summarizer content script loaded');