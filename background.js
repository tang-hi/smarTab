// ==========================================
// SmarTab Background Service Worker
// Main Entry Point
// ==========================================
import { getConfig, DEFAULTS } from './modules/config.js';
import {
  requestGroupingSuggestions,
  handleLargeBatchTabGrouping,
  requestTwoStageGrouping
} from './modules/ai.js';
import { focusTab } from './modules/tabs.js';

console.log('Background service worker initialized');

// ==========================================
// Event Listeners
// ==========================================
// Auto-collapse other groups when switching tabs
chrome.tabs.onActivated.addListener(focusTab);

// ==========================================
// Keyboard Shortcuts (Commands)
// ==========================================
chrome.commands.onCommand.addListener(async (command) => {
  console.log('Command received:', command);

  if (command === 'group-tabs') {
    try {
      // Open preview window
      const previewUrl = chrome.runtime.getURL('preview.html');
      const currentWindow = await chrome.windows.getCurrent();

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
    } catch (error) {
      console.error('Error opening preview via shortcut:', error);
    }
  }

  if (command === 'search-tabs') {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.url || activeTab.url.startsWith('chrome://')) {
        console.log('Cannot inject into this page');
        return;
      }

      // Inject content script if not already injected
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['search-overlay.js']
      });

      // Toggle the search overlay
      chrome.tabs.sendMessage(activeTab.id, { action: 'toggleSearch' });
    } catch (error) {
      console.error('Error opening search overlay:', error);
    }
  }
});

// ==========================================
// Message Handlers
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Get all tabs for search overlay
  if (request.action === 'getAllTabs') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const groups = await chrome.tabGroups.query({});

        // Convert groups array to object keyed by id
        const groupsMap = {};
        groups.forEach(g => {
          groupsMap[g.id] = { title: g.title, color: g.color };
        });

        sendResponse({ tabs, groups: groupsMap });
      } catch (error) {
        console.error('Error getting tabs:', error);
        sendResponse({ tabs: [], groups: {} });
      }
    })();
    return true;
  }

  // Switch to a specific tab
  if (request.action === 'switchToTab') {
    (async () => {
      try {
        await chrome.windows.update(request.windowId, { focused: true });
        await chrome.tabs.update(request.tabId, { active: true });
        sendResponse({ ok: true });
      } catch (error) {
        console.error('Error switching tab:', error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  // Close a specific tab
  if (request.action === 'closeTab') {
    (async () => {
      try {
        await chrome.tabs.remove(request.tabId);
        sendResponse({ ok: true });
      } catch (error) {
        console.error('Error closing tab:', error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  // Two-stage grouping (new)
  if (request.action === 'getTwoStageGrouping') {
    const { tabs } = request;

    getConfig(['customGroupingInstructions']).then(async (settings) => {
      try {
        const groupingSuggestions = await requestTwoStageGrouping(
          tabs,
          settings.customGroupingInstructions || ''
        );
        sendResponse({ groupingSuggestions });
      } catch (error) {
        console.error('Error getting two-stage grouping:', error);
        sendResponse({ error: error.message });
      }
    });

    return true;
  }

  // Apply grouping (from preview window)
  if (request.action === 'applyGrouping') {
    const { tabs, groupingSuggestions } = request;

    (async () => {
      try {
        const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

        for (const group of groupingSuggestions.groups) {
          let tabIndices = group.tab_indices;
          if (typeof tabIndices === 'string') {
            tabIndices = JSON.parse(tabIndices);
          }

          const tabIds = tabIndices.map(index => {
            const tab = tabs[index];
            return tab ? tab.id : null;
          }).filter(id => id !== null);

          if (tabIds.length === 0) continue;

          const groupId = await chrome.tabs.group({ tabIds });
          const hasActiveTab = activeTab && tabIds.includes(activeTab.id);

          await chrome.tabGroups.update(groupId, {
            title: group.group_name,
            color: group.group_color,
            collapsed: !hasActiveTab
          });
        }

        sendResponse({ ok: true });
      } catch (error) {
        console.error('Error applying grouping:', error);
        sendResponse({ ok: false, error: error.message });
      }
    })();

    return true;
  }

  // Legacy grouping suggestions (for compatibility)
  if (request.action === 'getGroupingSuggestions') {
    const { tabs, customGroupingInstructions } = request;

    getConfig(['excludePinnedTabs']).then(async (settings) => {
      let filteredTabs = [...tabs];

      if (settings.excludePinnedTabs) {
        filteredTabs = filteredTabs.filter(tab => !tab.pinned);
        console.log(`Filtered out pinned tabs, ${tabs.length - filteredTabs.length} tabs excluded`);
      }

      const useAdvanced = filteredTabs.length >= 30;
      const handler = useAdvanced ? handleLargeBatchTabGrouping : requestGroupingSuggestions;

      console.log(`Handling grouping suggestions: ${filteredTabs.length} tabs, using ${useAdvanced ? 'advanced' : 'standard'} mode`);

      try {
        const groupingSuggestions = await handler(filteredTabs, 10, customGroupingInstructions);
        sendResponse({ groupingSuggestions });
      } catch (error) {
        console.error('Error getting grouping suggestions:', error);
        sendResponse({ error: error.message });
      }
    });

    return true;
  }
});
