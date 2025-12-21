console.log('Popup script loaded');

const elements = {
    tabCount: document.getElementById('tabCount'),
    groupCount: document.getElementById('groupCount'),
    groupButton: document.getElementById('groupButton'),
    statusMessage: document.getElementById('statusMessage'),
    searchInput: document.getElementById('tabSearch'),
    searchResults: document.getElementById('searchResults'),
    searchMeta: document.getElementById('searchMeta')
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
        // Get all tabs
        const currentWindowOnly = await chrome.storage.sync.get('currentWindowOnly');
        const tabs = await chrome.tabs.query({ currentWindow: currentWindowOnly.currentWindowOnly ?? true });

        // Get unique group IDs
        const groupIds = [...new Set(tabs
            .map(tab => tab.groupId)
            .filter(id => id !== -1))]; // Filter out ungrouped tabs

        // Ungroup all tabs in each group
        for (const groupId of groupIds) {
            const groupTabs = await chrome.tabs.query({ groupId });
            await chrome.tabs.ungroup(groupTabs.map(tab => tab.id));
        }
    } catch (error) {
        console.error('Error removing existing groups:', error);
    }
}


async function createTabGroups(tabs, groupingSuggestions) {
    // Get the active tab
    const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTab[0]?.id;

    for (const group of groupingSuggestions.groups) {
        let tabIndices = group.tab_indices;
        // Qwen may return the array of tab indices in string format
        // [1,2,3] -> '[1,2,3]'
        if (typeof tabIndices === 'string') {
            tabIndices = JSON.parse(tabIndices);
        }
        const tabIds = tabIndices.map(index => {
            const tab = tabs[index];
            return tab ? tab.id : null;
        }).filter(id => id !== null);
        const newGroup = await chrome.tabs.group({ tabIds });

        // Check if active tab is in this group
        const isActiveTabInGroup = tabIds.includes(activeTabId);

        await chrome.tabGroups.update(newGroup, {
            title: group.group_name,
            color: group.group_color,
            collapsed: !isActiveTabInGroup // Collapse if active tab is not in this group
        });
    }
}

elements.searchInput.addEventListener('input', (event) => {
    filterTabs(event.target.value);
});

document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== elements.searchInput) {
        event.preventDefault();
        elements.searchInput.focus();
    }
});

loadTabs().catch(console.error);
