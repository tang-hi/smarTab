console.log('Popup script loaded');

const elements = {
    tabCount: document.getElementById('tabCount'),
    groupCount: document.getElementById('groupCount'),
    groupButton: document.getElementById('groupButton'),
    statusMessage: document.getElementById('statusMessage'),
    searchInput: document.getElementById('tabSearch'),
    searchResults: document.getElementById('searchResults'),
    searchMeta: document.getElementById('searchMeta'),
    undoAutoGroup: document.getElementById('undoAutoGroup'),
    undoHistoryBtn: document.getElementById('undoHistoryBtn'),
    undoHistoryDropdown: document.getElementById('undoHistoryDropdown'),
    undoHistoryList: document.getElementById('undoHistoryList'),
    autoGroupSummary: document.getElementById('autoGroupSummary'),
    autoGroupReason: document.getElementById('autoGroupReason'),
    saveSessionBtn: document.getElementById('saveSessionBtn'),
    sessionsList: document.getElementById('sessionsList'),
    saveTemplateBtn: document.getElementById('saveTemplateBtn'),
    templatesList: document.getElementById('templatesList')
};

let cachedTabs = [];
let searchTabs = [];

function setStatus(message, type = '') {
    elements.statusMessage.textContent = message;
    if (type) {
        elements.statusMessage.dataset.type = type;
    } else {
        elements.statusMessage.removeAttribute('data-type');
    }
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const diffMs = Date.now() - timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

function renderAutoGroupAction(action) {
    if (!action) {
        elements.autoGroupSummary.textContent = 'No recent auto-grouping yet.';
        elements.autoGroupReason.textContent = '';
        elements.undoAutoGroup.disabled = true;
        return;
    }

    const timeAgo = formatTimeAgo(action.timestamp);
    const actionText = action.createdNewGroup ? 'Created new group' : 'Added to existing group';
    const groupLabel = action.groupTitle ? `"${action.groupTitle}"` : 'a group';
    elements.autoGroupSummary.textContent = `${actionText} ${groupLabel}${timeAgo ? ` · ${timeAgo}` : ''}`;
    elements.autoGroupReason.textContent = action.reasoning ? `Reason: ${action.reasoning}` : '';
    elements.undoAutoGroup.disabled = action.toGroupId === -1;
}

async function loadAutoGroupAction() {
    const result = await chrome.storage.sync.get(['lastAutoGroupAction']);
    renderAutoGroupAction(result.lastAutoGroupAction || null);
}

// ==========================================
// Undo History
// ==========================================
async function loadUndoHistory() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getUndoHistory' }, (response) => {
            resolve(response?.history || []);
        });
    });
}

function renderUndoHistory(history) {
    elements.undoHistoryList.innerHTML = '';

    if (!history || history.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'undo-history-empty';
        empty.textContent = 'No undo history.';
        elements.undoHistoryList.appendChild(empty);
        return;
    }

    history.slice(0, 5).forEach((action) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'undo-history-item';

        const actionText = action.createdNewGroup ? 'Created' : 'Added to';
        const groupLabel = action.groupTitle || 'group';
        const timeAgo = formatTimeAgo(action.timestamp);

        btn.innerHTML = `
            <span class="undo-item-text">${actionText} "${groupLabel}"</span>
            <span class="undo-item-time">${timeAgo}</span>
        `;

        btn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'undoAutoGroup', actionId: action.id }, (response) => {
                if (response?.ok) {
                    setStatus('Action undone.', 'success');
                    loadUndoHistory().then(renderUndoHistory);
                    loadAutoGroupAction();
                } else {
                    setStatus(response?.error || 'Undo failed.', 'error');
                }
            });
        });

        li.appendChild(btn);
        elements.undoHistoryList.appendChild(li);
    });
}

elements.undoHistoryBtn?.addEventListener('click', async () => {
    const isHidden = elements.undoHistoryDropdown.classList.contains('hidden');
    if (isHidden) {
        const history = await loadUndoHistory();
        renderUndoHistory(history);
        elements.undoHistoryDropdown.classList.remove('hidden');
    } else {
        elements.undoHistoryDropdown.classList.add('hidden');
    }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!elements.undoHistoryDropdown?.contains(e.target) &&
        !elements.undoHistoryBtn?.contains(e.target)) {
        elements.undoHistoryDropdown?.classList.add('hidden');
    }
});

// ==========================================
// Sessions
// ==========================================
async function loadSessions() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSessions' }, (response) => {
            resolve(response?.sessions || []);
        });
    });
}

function renderSessions(sessions) {
    elements.sessionsList.innerHTML = '';

    if (!sessions || sessions.length === 0) {
        elements.sessionsList.innerHTML = '<p class="empty-hint">No saved sessions yet.</p>';
        return;
    }

    // Show last 3 sessions
    sessions.slice(0, 3).forEach((session) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'session-item';

        const timeAgo = formatTimeAgo(session.createdAt);

        btn.innerHTML = `
            <span class="session-name">${session.name}</span>
            <span class="session-meta">${session.tabCount} tabs · ${timeAgo}</span>
        `;

        btn.addEventListener('click', () => {
            btn.disabled = true;
            chrome.runtime.sendMessage({
                action: 'restoreSession',
                sessionId: session.id,
                inNewWindow: false
            }, (response) => {
                btn.disabled = false;
                if (response?.ok) {
                    setStatus(`Restored ${response.tabCount} tabs.`, 'success');
                } else {
                    setStatus(response?.error || 'Restore failed.', 'error');
                }
            });
        });

        elements.sessionsList.appendChild(btn);
    });
}

elements.saveSessionBtn?.addEventListener('click', () => {
    elements.saveSessionBtn.disabled = true;
    chrome.runtime.sendMessage({ action: 'saveSession' }, (response) => {
        elements.saveSessionBtn.disabled = false;
        if (response?.ok) {
            setStatus('Session saved!', 'success');
            loadSessions().then(renderSessions);
        } else {
            setStatus(response?.error || 'Save failed.', 'error');
        }
    });
});

// ==========================================
// Templates
// ==========================================
async function loadTemplates() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getTemplates' }, (response) => {
            resolve(response?.templates || []);
        });
    });
}

function renderTemplates(templates) {
    elements.templatesList.innerHTML = '';

    if (!templates || templates.length === 0) {
        elements.templatesList.innerHTML = '<p class="empty-hint">No templates yet.</p>';
        return;
    }

    templates.forEach((template) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'template-chip';
        chip.textContent = template.name;

        chip.addEventListener('click', () => {
            chip.disabled = true;
            chrome.runtime.sendMessage({
                action: 'applyTemplate',
                templateId: template.id
            }, (response) => {
                chip.disabled = false;
                if (response?.ok) {
                    setStatus(`Applied template, grouped ${response.groupedCount} tabs.`, 'success');
                    loadTabs();
                } else {
                    setStatus(response?.error || 'Apply failed.', 'error');
                }
            });
        });

        elements.templatesList.appendChild(chip);
    });
}

elements.saveTemplateBtn?.addEventListener('click', () => {
    const name = prompt('Template name:', `Template ${new Date().toLocaleDateString()}`);
    if (!name) return;

    elements.saveTemplateBtn.disabled = true;
    chrome.runtime.sendMessage({ action: 'saveCurrentAsTemplate', name }, (response) => {
        elements.saveTemplateBtn.disabled = false;
        if (response?.ok) {
            setStatus('Template saved!', 'success');
            loadTemplates().then(renderTemplates);
        } else {
            setStatus(response?.error || 'Save failed.', 'error');
        }
    });
});

// ==========================================
// Search
// ==========================================
function getTabSubtitle(tab) {
    if (!tab.url) return 'No URL';
    try {
        const parsed = new URL(tab.url);
        const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
        return `${parsed.hostname}${path}`;
    } catch (error) {
        return tab.url;
    }
}

function renderSearchResults(tabs, metaText) {
    elements.searchResults.innerHTML = '';
    elements.searchMeta.textContent = metaText;

    if (!tabs.length) {
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        empty.textContent = 'No matching tabs yet.';
        elements.searchResults.appendChild(empty);
        return;
    }

    const maxResults = 6;
    const results = tabs.slice(0, maxResults);
    results.forEach(tab => {
        const listItem = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'result-item';
        const title = document.createElement('span');
        title.className = 'result-title';
        title.textContent = tab.title || 'Untitled tab';
        const subtitle = document.createElement('span');
        subtitle.className = 'result-url';
        subtitle.textContent = getTabSubtitle(tab);
        button.appendChild(title);
        button.appendChild(subtitle);
        button.addEventListener('click', () => {
            chrome.tabs.update(tab.id, { active: true });
        });
        listItem.appendChild(button);
        elements.searchResults.appendChild(listItem);
    });

    if (tabs.length > maxResults) {
        const remaining = document.createElement('li');
        remaining.className = 'empty-state';
        remaining.textContent = `Showing ${maxResults} of ${tabs.length} matches.`;
        elements.searchResults.appendChild(remaining);
    }
}

function filterTabs(query) {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
        const recentTabs = [...searchTabs]
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
            .slice(0, 6);
        renderSearchResults(recentTabs, `Recent tabs - ${searchTabs.length} total`);
        return;
    }

    const matches = searchTabs.filter(tab => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(trimmed) || url.includes(trimmed);
    });
    renderSearchResults(matches, `${matches.length} match${matches.length === 1 ? '' : 'es'}`);
}

// ==========================================
// Main Tab Loading & Grouping
// ==========================================
async function loadTabs() {
    const settings = await chrome.storage.sync.get([
        'onlyIncludeActiveTab',
        'includeGroupedTabs',
        'currentWindowOnly',
        'includeFrozenTabs'
    ]);

    const queryOptions = {};
    if (settings.currentWindowOnly) {
        queryOptions.currentWindow = true;
    }

    const allTabs = await chrome.tabs.query({});
    searchTabs = allTabs;
    filterTabs(elements.searchInput.value || '');

    let tabs = await chrome.tabs.query(queryOptions);

    tabs = tabs.filter(tab => {
        if (settings.onlyIncludeActiveTab && !tab.active) return false;
        if (!settings.includeGroupedTabs && tab.groupId !== -1) return false;
        if (!settings.includeFrozenTabs && tab.discarded) return false;
        return true;
    });

    cachedTabs = tabs;

    const groups = await chrome.tabGroups.query({});
    elements.tabCount.textContent = tabs.length;
    elements.groupCount.textContent = groups.length;

    if (!searchTabs.length) {
        searchTabs = tabs;
        filterTabs(elements.searchInput.value || '');
    }

    elements.groupButton.onclick = async () => {
        try {
            if (!tabs.length) {
                setStatus('No tabs to group with the current filters.', 'error');
                return;
            }

            elements.groupButton.classList.add('loading');
            elements.groupButton.disabled = true;
            setStatus('');

            if (settings.includeGroupedTabs) {
                await removeExistingGroups();
            }

            chrome.storage.sync.get(['maxTabsPerGroup', 'customGroupingInstructions'], (result) => {
                const maxTabsPerGroup = result.maxTabsPerGroup ?? 10;
                const customGroupingInstructions = result.customGroupingInstructions ?? "";

                chrome.runtime.sendMessage({
                    action: 'getGroupingSuggestions',
                    tabs: tabs,
                    maxTabsPerGroup: maxTabsPerGroup,
                    customGroupingInstructions: customGroupingInstructions
                }, (response) => {
                    if (response && response.groupingSuggestions) {
                        console.log('LLM Suggestions:', response.groupingSuggestions);
                        createTabGroups(tabs, response.groupingSuggestions);
                        setStatus('Groups created. Take a look at your tab bar.', 'success');
                    } else if (response && response.error) {
                        setStatus(response.error, 'error');
                    } else {
                        setStatus('Could not get grouping suggestions.', 'error');
                    }
                    elements.groupButton.classList.remove('loading');
                    elements.groupButton.disabled = false;
                });
            });
        } catch (error) {
            console.error('Error grouping tabs:', error);
            setStatus('Grouping failed. Check settings and API key.', 'error');
            elements.groupButton.classList.remove('loading');
            elements.groupButton.disabled = false;
        }
    };

    return tabs;
}

async function removeExistingGroups() {
    try {
        const currentWindowOnly = await chrome.storage.sync.get('currentWindowOnly');
        const tabs = await chrome.tabs.query({ currentWindow: currentWindowOnly.currentWindowOnly ?? true });

        const groupIds = [...new Set(tabs
            .map(tab => tab.groupId)
            .filter(id => id !== -1))];

        for (const groupId of groupIds) {
            const groupTabs = await chrome.tabs.query({ groupId });
            await chrome.tabs.ungroup(groupTabs.map(tab => tab.id));
        }
    } catch (error) {
        console.error('Error removing existing groups:', error);
    }
}

async function createTabGroups(tabs, groupingSuggestions) {
    const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTab[0]?.id;

    for (const group of groupingSuggestions.groups) {
        let tabIndices = group.tab_indices;
        if (typeof tabIndices === 'string') {
            tabIndices = JSON.parse(tabIndices);
        }
        const tabIds = tabIndices.map(index => {
            const tab = tabs[index];
            return tab ? tab.id : null;
        }).filter(id => id !== null);
        const newGroup = await chrome.tabs.group({ tabIds });

        const isActiveTabInGroup = tabIds.includes(activeTabId);

        await chrome.tabGroups.update(newGroup, {
            title: group.group_name,
            color: group.group_color,
            collapsed: !isActiveTabInGroup
        });
    }
}

// ==========================================
// Event Listeners
// ==========================================
elements.searchInput.addEventListener('input', (event) => {
    filterTabs(event.target.value);
});

document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== elements.searchInput) {
        event.preventDefault();
        elements.searchInput.focus();
    }
});

elements.undoAutoGroup.addEventListener('click', () => {
    elements.undoAutoGroup.disabled = true;
    chrome.runtime.sendMessage({ action: 'undoAutoGroup' }, (response) => {
        if (response && response.ok) {
            setStatus('Auto-group undone.', 'success');
            renderAutoGroupAction(null);
            loadUndoHistory().then(renderUndoHistory);
            return;
        }
        const error = response?.error || 'Undo failed.';
        setStatus(error, 'error');
        elements.undoAutoGroup.disabled = false;
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.lastAutoGroupAction) return;
    renderAutoGroupAction(changes.lastAutoGroupAction.newValue || null);
});

// ==========================================
// Initialize
// ==========================================
loadTabs().catch(console.error);
loadAutoGroupAction().catch(console.error);
loadSessions().then(renderSessions).catch(console.error);
loadTemplates().then(renderTemplates).catch(console.error);
