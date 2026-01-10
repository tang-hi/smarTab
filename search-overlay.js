// ==========================================
// Search Overlay Content Script
// Vimium-style tab search
// ==========================================

(function() {
  // Prevent multiple injections
  if (window.__smartabSearchInjected) return;
  window.__smartabSearchInjected = true;

  let overlay = null;
  let searchInput = null;
  let resultsContainer = null;
  let allTabs = [];
  let filteredTabs = [];
  let selectedIndex = 0;
  let tabGroups = {};

  // Create and inject the overlay
  function createOverlay() {
    if (overlay) return;

    // Inject CSS
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('styles/search-overlay.css');
    document.head.appendChild(style);

    // Create overlay HTML
    overlay = document.createElement('div');
    overlay.id = 'smartab-search-overlay';
    overlay.innerHTML = `
      <div class="smartab-modal">
        <div class="smartab-search-header">
          <svg class="smartab-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            class="smartab-search-input"
            placeholder="Search tabs..."
            autocomplete="off"
            spellcheck="false"
          />
          <span class="smartab-esc-hint">ESC</span>
        </div>
        <div class="smartab-results"></div>
        <div class="smartab-footer">
          <div class="smartab-shortcut">
            <kbd>↑</kbd><kbd>↓</kbd> Navigate
          </div>
          <div class="smartab-shortcut">
            <kbd>↵</kbd> Switch
          </div>
          <div class="smartab-shortcut">
            <kbd>⌘</kbd><kbd>D</kbd> Close
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    searchInput = overlay.querySelector('.smartab-search-input');
    resultsContainer = overlay.querySelector('.smartab-results');

    // Event listeners
    searchInput.addEventListener('input', handleSearch);
    overlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleKeydown);
  }

  function handleOverlayClick(e) {
    if (e.target === overlay) {
      hideOverlay();
    }
  }

  function handleKeydown(e) {
    if (!overlay || !overlay.classList.contains('visible')) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        hideOverlay();
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
  }

  function handleSearch() {
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
      filteredTabs = [...allTabs];
    } else {
      filteredTabs = allTabs.filter(tab => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(query) || url.includes(query);
      });
    }

    selectedIndex = 0;
    renderResults();
  }

  function renderResults() {
    if (filteredTabs.length === 0) {
      resultsContainer.innerHTML = '<div class="smartab-empty">No tabs found</div>';
      return;
    }

    resultsContainer.innerHTML = filteredTabs.map((tab, index) => {
      const favicon = getFavicon(tab.url);
      const group = tab.groupId !== -1 ? tabGroups[tab.groupId] : null;
      const groupBadge = group
        ? `<span class="smartab-group-badge ${group.color || ''}">${group.title || 'Group'}</span>`
        : '';

      return `
        <div class="smartab-result-item ${index === selectedIndex ? 'selected' : ''}"
             data-index="${index}"
             data-tab-id="${tab.id}">
          ${favicon
            ? `<img class="smartab-result-favicon" src="${favicon}" alt="" onerror="this.style.display='none'"/>`
            : `<div class="smartab-result-favicon placeholder">${getInitial(tab.title)}</div>`
          }
          <div class="smartab-result-content">
            <div class="smartab-result-title">${escapeHtml(tab.title || 'Untitled')}</div>
            <div class="smartab-result-url">${escapeHtml(getDisplayUrl(tab.url))}</div>
          </div>
          ${groupBadge}
          <button class="smartab-result-close" data-action="close" title="Close tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      `;
    }).join('');

    // Add click handlers
    resultsContainer.querySelectorAll('.smartab-result-item').forEach(item => {
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
    resultsContainer.querySelectorAll('.smartab-result-item').forEach((item, index) => {
      item.classList.toggle('selected', index === selectedIndex);
    });
    scrollSelectedIntoView();
  }

  function scrollSelectedIntoView() {
    const selected = resultsContainer.querySelector('.smartab-result-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function switchToSelected() {
    if (filteredTabs.length === 0 || selectedIndex >= filteredTabs.length) return;

    const tab = filteredTabs[selectedIndex];
    chrome.runtime.sendMessage({
      action: 'switchToTab',
      tabId: tab.id,
      windowId: tab.windowId
    });
    hideOverlay();
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

  // Utility functions
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

  // Show/hide overlay
  function showOverlay() {
    createOverlay();

    // Fetch tabs from background
    chrome.runtime.sendMessage({ action: 'getAllTabs' }, (response) => {
      if (response) {
        allTabs = response.tabs || [];
        tabGroups = response.groups || {};
        filteredTabs = [...allTabs];
        selectedIndex = 0;

        overlay.classList.add('visible');
        searchInput.value = '';
        searchInput.focus();
        renderResults();
      }
    });
  }

  function hideOverlay() {
    if (overlay) {
      overlay.classList.remove('visible');
    }
  }

  function toggleOverlay() {
    if (overlay && overlay.classList.contains('visible')) {
      hideOverlay();
    } else {
      showOverlay();
    }
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleSearch') {
      toggleOverlay();
      sendResponse({ ok: true });
    }
    return true;
  });
})();
