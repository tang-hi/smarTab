console.log('Popup script loaded');

const elements = {
    groupButton: document.getElementById('groupButton'),
    statusMessage: document.getElementById('statusMessage'),
    shortcutSetup: document.getElementById('shortcutSetup'),
    shortcutDisplay: document.getElementById('shortcutDisplay'),
    shortcutKey: document.getElementById('shortcutKey')
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
// Shortcut Detection
// ==========================================
async function checkSearchShortcut() {
    try {
        const commands = await chrome.commands.getAll();
        const searchCommand = commands.find(cmd => cmd.name === 'search-tabs');

        if (searchCommand && searchCommand.shortcut) {
            elements.shortcutSetup.classList.add('hidden');
            elements.shortcutDisplay.classList.remove('hidden');
            elements.shortcutKey.textContent = searchCommand.shortcut;
        } else {
            elements.shortcutSetup.classList.remove('hidden');
            elements.shortcutDisplay.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error checking shortcuts:', error);
        elements.shortcutSetup.classList.remove('hidden');
        elements.shortcutDisplay.classList.add('hidden');
    }
}

// Open shortcuts settings page
elements.shortcutSetup.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ==========================================
// Main Tab Loading & Grouping
// ==========================================
async function loadTabs() {
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
        if (settings.excludeGroupedTabs !== false && tab.groupId !== -1) return false;
        if (settings.excludeFrozenTabs !== false && tab.discarded) return false;
        return true;
    });

    cachedTabs = tabs;
    return tabs;
}

async function handleGroupClick() {
    try {
        const tabs = await loadTabs();

        if (!tabs.length) {
            setStatus('No tabs to group with the current filters.', 'error');
            return;
        }

        if (tabs.length < 2) {
            setStatus('Need at least 2 tabs to create groups.', 'error');
            return;
        }

        // Open preview window
        const previewUrl = chrome.runtime.getURL('preview.html');

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
    } catch (error) {
        console.error('Error opening preview:', error);
        setStatus('Failed to open preview window.', 'error');
    }
}

// ==========================================
// Event Listeners
// ==========================================
elements.groupButton.addEventListener('click', handleGroupClick);

// ==========================================
// Initialize
// ==========================================
checkSearchShortcut();
loadTabs().catch(console.error);
