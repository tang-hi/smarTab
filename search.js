// ==========================================
// Search Window Script
// ==========================================

const searchInput = document.getElementById('searchInput');
const resultsContainer = document.getElementById('results');
const searchModeIndicator = document.getElementById('searchMode');

let allTabs = [];
let filteredTabs = [];
let selectedIndex = 0;
let tabGroups = {};

// Semantic search state
let useSemanticSearch = false;
let geminiApiKey = null;
let tabEmbeddings = {}; // { tabId: { text: string, embedding: number[] } }
let searchDebounceTimer = null;

// ==========================================
// Tab Loading
// ==========================================
async function loadTabs() {
    try {
        // Check if Gemini is configured
        const settings = await chrome.storage.sync.get(['aiProvider', 'apiKey']);
        if (settings.aiProvider === 'gemini' && settings.apiKey) {
            geminiApiKey = settings.apiKey;
            useSemanticSearch = true;
            searchModeIndicator.classList.remove('hidden');
        }

        const response = await chrome.runtime.sendMessage({ action: 'getAllTabs' });
        if (response) {
            allTabs = response.tabs || [];
            tabGroups = response.groups || {};
            filteredTabs = [...allTabs];
            selectedIndex = 0;
            renderResults();

            // Pre-compute embeddings for semantic search
            if (useSemanticSearch) {
                await loadCachedEmbeddings();
                await updateTabEmbeddings();
            }
        }
    } catch (error) {
        console.error('Error loading tabs:', error);
        resultsContainer.innerHTML = '<div class="search-empty">Failed to load tabs</div>';
    }
}

// ==========================================
// Gemini Embedding API
// ==========================================
async function getEmbeddings(texts) {
    if (!geminiApiKey || texts.length === 0) return null;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${geminiApiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requests: texts.map(text => ({
                        model: 'models/gemini-embedding-001',
                        content: { parts: [{ text }] }
                    }))
                })
            }
        );

        if (!response.ok) {
            console.error('Embedding API error:', response.status);
            return null;
        }

        const data = await response.json();
        return data.embeddings?.map(e => e.values) || null;
    } catch (error) {
        console.error('Error getting embeddings:', error);
        return null;
    }
}

async function getQueryEmbedding(query) {
    const embeddings = await getEmbeddings([query]);
    return embeddings ? embeddings[0] : null;
}

// ==========================================
// Embedding Cache
// ==========================================
async function loadCachedEmbeddings() {
    try {
        const cached = await chrome.storage.local.get(['tabEmbeddings']);
        tabEmbeddings = cached.tabEmbeddings || {};
    } catch (error) {
        console.error('Error loading cached embeddings:', error);
        tabEmbeddings = {};
    }
}

async function saveCachedEmbeddings() {
    try {
        await chrome.storage.local.set({ tabEmbeddings });
    } catch (error) {
        console.error('Error saving embeddings:', error);
    }
}

function getTabText(tab) {
    const group = tab.groupId !== -1 ? tabGroups[tab.groupId] : null;
    const groupName = group?.title || '';
    return `${tab.title || ''} ${groupName} ${getDisplayUrl(tab.url)}`.trim();
}

async function updateTabEmbeddings() {
    // Find tabs that need embeddings
    const tabsNeedingEmbedding = allTabs.filter(tab => {
        const text = getTabText(tab);
        const cached = tabEmbeddings[tab.id];
        return !cached || cached.text !== text;
    });

    if (tabsNeedingEmbedding.length === 0) {
        // Still clean up stale entries
        cleanupStaleEmbeddings();
        return;
    }

    // Batch embed (max 100 at a time)
    const batchSize = 100;
    for (let i = 0; i < tabsNeedingEmbedding.length; i += batchSize) {
        const batch = tabsNeedingEmbedding.slice(i, i + batchSize);
        const texts = batch.map(tab => getTabText(tab));
        const embeddings = await getEmbeddings(texts);

        if (embeddings) {
            batch.forEach((tab, idx) => {
                tabEmbeddings[tab.id] = {
                    text: texts[idx],
                    embedding: embeddings[idx]
                };
            });
        }
    }

    cleanupStaleEmbeddings();
    await saveCachedEmbeddings();
}

function cleanupStaleEmbeddings() {
    // Remove embeddings for tabs that no longer exist
    const currentTabIds = new Set(allTabs.map(t => t.id));
    let cleaned = false;
    for (const tabId of Object.keys(tabEmbeddings)) {
        if (!currentTabIds.has(parseInt(tabId))) {
            delete tabEmbeddings[tabId];
            cleaned = true;
        }
    }

    // Limit cache size to 500 entries (oldest removed first)
    const maxCacheSize = 500;
    const entries = Object.entries(tabEmbeddings);
    if (entries.length > maxCacheSize) {
        const toRemove = entries.length - maxCacheSize;
        const keysToRemove = entries.slice(0, toRemove).map(([k]) => k);
        keysToRemove.forEach(k => delete tabEmbeddings[k]);
        cleaned = true;
    }

    return cleaned;
}

// ==========================================
// Similarity Calculation
// ==========================================
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function semanticSearch(query) {
    const queryEmbedding = await getQueryEmbedding(query);
    if (!queryEmbedding) return null;

    const results = allTabs.map(tab => {
        const cached = tabEmbeddings[tab.id];
        const similarity = cached ? cosineSimilarity(queryEmbedding, cached.embedding) : 0;
        return { tab, similarity };
    });

    // Sort by similarity and filter low scores
    results.sort((a, b) => b.similarity - a.similarity);
    return results.filter(r => r.similarity > 0.3).map(r => r.tab);
}

// ==========================================
// Search & Filter
// ==========================================
function textSearch(query) {
    return allTabs.filter(tab => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        const group = tab.groupId !== -1 ? tabGroups[tab.groupId] : null;
        const groupName = (group?.title || '').toLowerCase();
        return title.includes(query) || url.includes(query) || groupName.includes(query);
    });
}

async function handleSearch() {
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
        filteredTabs = [...allTabs];
        selectedIndex = 0;
        renderResults();
        return;
    }

    // Always do text search first for instant results
    filteredTabs = textSearch(query);
    selectedIndex = 0;
    renderResults();

    // If semantic search is enabled, debounce and enhance results
    if (useSemanticSearch && query.length >= 2) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(async () => {
            const semanticResults = await semanticSearch(query);
            if (semanticResults && semanticResults.length > 0) {
                // Merge: semantic results first, then text matches not in semantic
                const semanticIds = new Set(semanticResults.map(t => t.id));
                const textOnly = filteredTabs.filter(t => !semanticIds.has(t.id));
                filteredTabs = [...semanticResults, ...textOnly];
                selectedIndex = 0;
                renderResults();
            }
        }, 300);
    }
}

// ==========================================
// Rendering
// ==========================================
function renderResults() {
    if (filteredTabs.length === 0) {
        resultsContainer.innerHTML = '<div class="search-empty">No tabs found</div>';
        return;
    }

    resultsContainer.innerHTML = filteredTabs.map((tab, index) => {
        const favicon = getFavicon(tab.url);
        const group = tab.groupId !== -1 ? tabGroups[tab.groupId] : null;
        const groupBadge = group
            ? `<span class="search-group-badge" data-color="${group.color || 'grey'}">${escapeHtml(group.title || 'Group')}</span>`
            : '';

        return `
            <div class="search-result-item ${index === selectedIndex ? 'selected' : ''}"
                 data-index="${index}"
                 data-tab-id="${tab.id}"
                 data-window-id="${tab.windowId}">
                ${favicon
                    ? `<img class="search-result-favicon" src="${favicon}" alt="" onerror="this.style.display='none'"/>`
                    : `<div class="search-result-favicon placeholder">${getInitial(tab.title)}</div>`
                }
                <div class="search-result-content">
                    <div class="search-result-title">${escapeHtml(tab.title || 'Untitled')}</div>
                    <div class="search-result-url">${escapeHtml(getDisplayUrl(tab.url))}</div>
                </div>
                ${groupBadge}
                <button class="search-result-close" data-action="close" title="Close tab">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;
    }).join('');

    // Add click handlers
    resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="close"]')) {
                const tabId = parseInt(item.dataset.tabId);
                closeTab(tabId);
            } else {
                const index = parseInt(item.dataset.index);
                selectedIndex = index;
                switchToSelected();
            }
        });
    });

    scrollSelectedIntoView();
}

// ==========================================
// Navigation
// ==========================================
function selectNext() {
    if (filteredTabs.length === 0) return;
    selectedIndex = (selectedIndex + 1) % filteredTabs.length;
    updateSelection();
}

function selectPrev() {
    if (filteredTabs.length === 0) return;
    selectedIndex = (selectedIndex - 1 + filteredTabs.length) % filteredTabs.length;
    updateSelection();
}

function updateSelection() {
    resultsContainer.querySelectorAll('.search-result-item').forEach((item, index) => {
        item.classList.toggle('selected', index === selectedIndex);
    });
    scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
    const selected = resultsContainer.querySelector('.search-result-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// ==========================================
// Tab Actions
// ==========================================
function switchToSelected() {
    if (filteredTabs.length === 0 || selectedIndex >= filteredTabs.length) return;

    const tab = filteredTabs[selectedIndex];
    chrome.runtime.sendMessage({
        action: 'switchToTab',
        tabId: tab.id,
        windowId: tab.windowId
    });
    window.close();
}

function closeSelected() {
    if (filteredTabs.length === 0 || selectedIndex >= filteredTabs.length) return;
    const tab = filteredTabs[selectedIndex];
    closeTab(tab.id);
}

function closeTab(tabId) {
    chrome.runtime.sendMessage({
        action: 'closeTab',
        tabId: tabId
    }, () => {
        // Remove from arrays and re-render
        allTabs = allTabs.filter(t => t.id !== tabId);
        filteredTabs = filteredTabs.filter(t => t.id !== tabId);

        if (selectedIndex >= filteredTabs.length) {
            selectedIndex = Math.max(0, filteredTabs.length - 1);
        }

        renderResults();
    });
}

// ==========================================
// Utility Functions
// ==========================================
function getFavicon(url) {
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
        return null;
    }
}

function getInitial(title) {
    return (title || 'U').charAt(0).toUpperCase();
}

function getDisplayUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
    } catch {
        return url || '';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// Event Listeners
// ==========================================
searchInput.addEventListener('input', handleSearch);

document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'Escape':
            e.preventDefault();
            window.close();
            break;
        case 'ArrowDown':
            e.preventDefault();
            selectNext();
            break;
        case 'ArrowUp':
            e.preventDefault();
            selectPrev();
            break;
        case 'Enter':
            e.preventDefault();
            switchToSelected();
            break;
        case 'd':
        case 'D':
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                closeSelected();
            }
            break;
    }
});

// ==========================================
// Initialize
// ==========================================
loadTabs();
