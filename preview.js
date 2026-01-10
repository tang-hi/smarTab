// ==========================================
// Preview Window Script
// ==========================================

const elements = {
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    errorMessage: document.getElementById('errorMessage'),
    previewContent: document.getElementById('previewContent'),
    previewSummary: document.getElementById('previewSummary'),
    previewGroups: document.getElementById('previewGroups'),
    closeButton: document.getElementById('closeButton'),
    cancelButton: document.getElementById('cancelButton'),
    applyButton: document.getElementById('applyButton'),
    retryButton: document.getElementById('retryButton')
};

let groupingData = null;
let tabsData = null;

function showState(state) {
    elements.loadingState.classList.toggle('hidden', state !== 'loading');
    elements.errorState.classList.toggle('hidden', state !== 'error');
    elements.previewContent.classList.toggle('hidden', state !== 'preview');
}

function showError(message) {
    elements.errorMessage.textContent = message;
    showState('error');
}

function getColorClass(color) {
    const validColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
    return validColors.includes(color) ? color : 'grey';
}

function getFavicon(url) {
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
        return '';
    }
}

function truncateTitle(title, maxLength = 40) {
    if (!title) return 'Untitled';
    if (title.length <= maxLength) return title;
    return title.slice(0, maxLength) + '...';
}

function renderPreview(suggestions, tabs) {
    const groups = suggestions.groups || [];
    const totalTabs = groups.reduce((sum, g) => sum + (g.tab_indices?.length || 0), 0);

    elements.previewSummary.textContent = `Found ${groups.length} group${groups.length !== 1 ? 's' : ''} for ${totalTabs} tab${totalTabs !== 1 ? 's' : ''}`;

    elements.previewGroups.innerHTML = '';

    groups.forEach(group => {
        const groupEl = document.createElement('div');
        groupEl.className = 'preview-group';

        const headerEl = document.createElement('div');
        headerEl.className = 'group-header';

        const colorEl = document.createElement('div');
        colorEl.className = `group-color ${getColorClass(group.group_color)}`;

        const nameEl = document.createElement('span');
        nameEl.className = 'group-name';
        nameEl.textContent = group.group_name || 'Unnamed Group';

        headerEl.appendChild(colorEl);
        headerEl.appendChild(nameEl);

        const tabsEl = document.createElement('ul');
        tabsEl.className = 'group-tabs';

        const tabIndices = group.tab_indices || [];
        tabIndices.forEach(index => {
            const tab = tabs[index];
            if (!tab) return;

            const tabEl = document.createElement('li');

            const favicon = getFavicon(tab.url);
            if (favicon) {
                const img = document.createElement('img');
                img.className = 'tab-favicon';
                img.src = favicon;
                img.alt = '';
                img.onerror = () => img.style.display = 'none';
                tabEl.appendChild(img);
            }

            const titleSpan = document.createElement('span');
            titleSpan.textContent = truncateTitle(tab.title);
            tabEl.appendChild(titleSpan);

            tabsEl.appendChild(tabEl);
        });

        const reasoningEl = document.createElement('div');
        reasoningEl.className = 'group-reasoning';
        reasoningEl.textContent = group.reasoning || 'Grouped by similarity';

        groupEl.appendChild(headerEl);
        groupEl.appendChild(tabsEl);
        groupEl.appendChild(reasoningEl);

        elements.previewGroups.appendChild(groupEl);
    });

    showState('preview');
}

async function applyGrouping() {
    if (!groupingData || !tabsData) return;

    elements.applyButton.disabled = true;
    elements.applyButton.classList.add('loading');

    try {
        // Send message to background to apply grouping
        chrome.runtime.sendMessage({
            action: 'applyGrouping',
            tabs: tabsData,
            groupingSuggestions: groupingData
        }, (response) => {
            if (response?.ok) {
                window.close();
            } else {
                showError(response?.error || 'Failed to apply grouping');
                elements.applyButton.disabled = false;
                elements.applyButton.classList.remove('loading');
            }
        });
    } catch (error) {
        showError(error.message);
        elements.applyButton.disabled = false;
        elements.applyButton.classList.remove('loading');
    }
}

async function requestGrouping() {
    showState('loading');

    try {
        // Get tabs data from URL params or request from background
        const urlParams = new URLSearchParams(window.location.search);
        const tabsJson = urlParams.get('tabs');

        if (tabsJson) {
            tabsData = JSON.parse(decodeURIComponent(tabsJson));
        } else {
            // Request tabs from background
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
                if (!tab.url || !tab.url.startsWith('http')) return false;
                if (settings.excludePinnedTabs !== false && tab.pinned) return false;
                if (settings.excludeGroupedTabs !== false && tab.groupId !== -1) return false;
                if (settings.excludeFrozenTabs !== false && tab.discarded) return false;
                return true;
            });

            tabsData = tabs;
        }

        if (!tabsData || tabsData.length === 0) {
            showError('No tabs to group with the current filters.');
            return;
        }

        if (tabsData.length < 2) {
            showError('Need at least 2 tabs to create groups.');
            return;
        }

        // Request grouping suggestions from background
        chrome.runtime.sendMessage({
            action: 'getTwoStageGrouping',
            tabs: tabsData
        }, (response) => {
            if (chrome.runtime.lastError) {
                showError(chrome.runtime.lastError.message);
                return;
            }

            if (response?.error) {
                showError(response.error);
                return;
            }

            if (response?.groupingSuggestions) {
                groupingData = response.groupingSuggestions;
                renderPreview(groupingData, tabsData);
            } else {
                showError('Failed to get grouping suggestions.');
            }
        });
    } catch (error) {
        console.error('Error requesting grouping:', error);
        showError(error.message || 'An unexpected error occurred.');
    }
}

// Event Listeners
elements.closeButton.addEventListener('click', () => window.close());
elements.cancelButton.addEventListener('click', () => window.close());
elements.applyButton.addEventListener('click', applyGrouping);
elements.retryButton.addEventListener('click', requestGrouping);

// Initialize
requestGrouping();
