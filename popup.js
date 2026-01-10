console.log('Popup script loaded');

const elements = {
    groupButton: document.getElementById('groupButton'),
    statusMessage: document.getElementById('statusMessage'),
    searchButton: document.getElementById('searchButton')
};

let cachedTabs = [];

function setStatus(message, type = '') {
    elements.statusMessage.textContent = message;
    if (type) {
        elements.statusMessage.dataset.type = type;
    } else {
        elements.statusMessage.removeAttribute('data-type');
    }
}

// ==========================================
// Main Tab Loading & Grouping
// ==========================================
async function loadTabs(includeGrouped = false) {
    const settings = await chrome.storage.sync.get([
        'excludePinnedTabs',
        'excludeGroupedTabs',
        'currentWindowOnly',
        'excludeFrozenTabs'
    ]);

    const queryOptions = {};
    if (settings.currentWindowOnly !== false) {
        queryOptions.currentWindow = true;
    }

    let tabs = await chrome.tabs.query(queryOptions);

    tabs = tabs.filter(tab => {
        if (settings.excludePinnedTabs !== false && tab.pinned) return false;
        // When includeGrouped is true, include already grouped tabs
        if (!includeGrouped && settings.excludeGroupedTabs !== false && tab.groupId !== -1) return false;
        if (settings.excludeFrozenTabs !== false && tab.discarded) return false;
        return true;
    });

    cachedTabs = tabs;
    return tabs;
}

async function openPreviewWindow(tabs) {
    // Open preview window with tabs data as URL parameter
    const tabsData = encodeURIComponent(JSON.stringify(tabs));
    const previewUrl = chrome.runtime.getURL(`preview.html?tabs=${tabsData}`);

    // Get current window to position preview window
    const currentWindow = await chrome.windows.getCurrent();

    // Create preview window centered on current window
    const width = 480;
    const height = 600;
    const left = Math.round(currentWindow.left + (currentWindow.width - width) / 2);
    const top = Math.round(currentWindow.top + (currentWindow.height - height) / 2);

    await chrome.windows.create({
        url: previewUrl,
        type: 'popup',
        width: width,
        height: height,
        left: left,
        top: top,
        focused: true
    });

    // Close popup after opening preview
    window.close();
}

async function handleGroupClick() {
    try {
        const tabs = await loadTabs();

        if (!tabs.length) {
            setStatus('All tabs are already grouped. Double-click to re-group all tabs.', 'info');
            return;
        }

        if (tabs.length < 2) {
            setStatus('Need at least 2 tabs to create groups.', 'error');
            return;
        }

        await openPreviewWindow(tabs);
    } catch (error) {
        console.error('Error opening preview:', error);
        setStatus('Failed to open preview window.', 'error');
    }
}

async function handleGroupDoubleClick() {
    try {
        // Load all tabs including grouped ones
        const tabs = await loadTabs(true);

        if (tabs.length < 2) {
            setStatus('Need at least 2 tabs to create groups.', 'error');
            return;
        }

        await openPreviewWindow(tabs);
    } catch (error) {
        console.error('Error opening preview:', error);
        setStatus('Failed to open preview window.', 'error');
    }
}

// ==========================================
// Event Listeners
// ==========================================
let clickTimeout = null;
elements.groupButton.addEventListener('click', () => {
    if (clickTimeout) {
        // Double click detected
        clearTimeout(clickTimeout);
        clickTimeout = null;
        handleGroupDoubleClick();
    } else {
        // Wait for possible double click
        clickTimeout = setTimeout(() => {
            clickTimeout = null;
            handleGroupClick();
        }, 250);
    }
});

// Search button - open search window
elements.searchButton.addEventListener('click', async () => {
    try {
        const searchUrl = chrome.runtime.getURL('search.html');
        const currentWindow = await chrome.windows.getCurrent();

        const width = 500;
        const height = 480;
        const left = Math.round(currentWindow.left + (currentWindow.width - width) / 2);
        const top = Math.round(currentWindow.top + (currentWindow.height - height) / 2);

        await chrome.windows.create({
            url: searchUrl,
            type: 'popup',
            width: width,
            height: height,
            left: left,
            top: top,
            focused: true
        });

        window.close();
    } catch (error) {
        console.error('Error opening search:', error);
        setStatus('Failed to open search.', 'error');
    }
});

// ==========================================
// Initialize
// ==========================================
loadTabs().catch(console.error);
