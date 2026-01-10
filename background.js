// ==========================================
// SmarTab Background Service Worker
// Main Entry Point
// ==========================================
import { getConfig, DEFAULTS } from './modules/config.js';
import {
  requestGroupingSuggestions,
  handleLargeBatchTabGrouping,
  requestTwoStageGrouping,
  analyzeTabsUnderstanding,
  createSmartGroups
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
  // Fetch models from API (bypass CORS)
  if (request.action === 'fetchModels') {
    const { provider, apiKey } = request;

    (async () => {
      try {
        if (provider === 'gemini') {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
          if (!response.ok) {
            sendResponse({ error: `HTTP ${response.status}` });
            return;
          }
          const data = await response.json();
          const models = data.models
            ?.filter(m => m.supportedGenerationMethods?.includes('generateContent'))
            ?.map(m => ({
              value: m.name.replace('models/', ''),
              label: m.displayName || m.name.replace('models/', '')
            })) || [];
          sendResponse({ models });
        } else if (provider === 'openai') {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (!response.ok) {
            sendResponse({ error: `HTTP ${response.status}` });
            return;
          }
          const data = await response.json();
          const models = data.data
            ?.filter(m => m.id.includes('gpt'))
            ?.sort((a, b) => b.id.localeCompare(a.id))
            ?.map(m => ({ value: m.id, label: m.id })) || [];
          sendResponse({ models });
        } else if (provider === 'doubao') {
          // Doubao doesn't support listing models
          sendResponse({ models: null, message: 'Doubao does not support listing models' });
        } else {
          sendResponse({ models: null });
        }
      } catch (error) {
        console.error('Error fetching models:', error);
        sendResponse({ error: error.message });
      }
    })();

    return true;
  }

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
        // Stage 1: Analyze tabs
        sendResponse({ stage: 'analyzing' });
      } catch (error) {
        console.error('Error in two-stage grouping:', error);
        sendResponse({ error: error.message });
      }
    });

    return true;
  }

  // Stage 1: Analyze tabs understanding
  if (request.action === 'analyzeTabsStage1') {
    const { tabs } = request;

    (async () => {
      try {
        const tabUnderstanding = await analyzeTabsUnderstanding(tabs);
        sendResponse({ tabUnderstanding });
      } catch (error) {
        console.error('Error in stage 1:', error);
        sendResponse({ error: error.message });
      }
    })();

    return true;
  }

  // Stage 2: Create smart groups
  if (request.action === 'createGroupsStage2') {
    const { tabs, tabUnderstanding } = request;

    getConfig(['customGroupingInstructions']).then(async (settings) => {
      try {
        const groupingSuggestions = await createSmartGroups(
          tabs,
          tabUnderstanding,
          settings.customGroupingInstructions || ''
        );
        sendResponse({ groupingSuggestions });
      } catch (error) {
        console.error('Error in stage 2:', error);
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
        // Get the original window from the first tab's windowId
        // Find the active tab in the original window
        const originalWindowId = tabs[0]?.windowId;
        const activeTab = originalWindowId
          ? (await chrome.tabs.query({ active: true, windowId: originalWindowId }))[0]
          : null;

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

          // Create group with explicit windowId to avoid popup window issues
          const groupOptions = { tabIds };
          const firstTab = tabs[tabIndices[0]];
          if (firstTab?.windowId) {
            groupOptions.createProperties = { windowId: firstTab.windowId };
          }

          const groupId = await chrome.tabs.group(groupOptions);
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
