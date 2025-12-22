// ==========================================
// SmarTab Background Service Worker
// Main Entry Point
// ==========================================
import { getConfig, getDelays, DEFAULTS } from './modules/config.js';
import {
  requestGroupingSuggestions,
  handleLargeBatchTabGrouping
} from './modules/ai.js';
import {
  focusTab,
  removeGroup,
  handleNewTab,
  autoGroupTab,
  regroupExistingTab,
  cleanupPendingTab,
  pendingTabs
} from './modules/tabs.js';
import {
  pushUndoAction,
  undoAction,
  getUndoHistory,
  saveSession,
  getSessions,
  restoreSession,
  deleteSession,
  renameSession,
  getTemplates,
  applyTemplate,
  saveCurrentAsTemplate,
  deleteTemplate
} from './modules/features.js';

console.log('Background service worker initialized');

// ==========================================
// Undo Action Helper (passed to tabs module)
// ==========================================
async function storeLastAutoGroupAction(action) {
  return pushUndoAction(action);
}

// ==========================================
// Event Listeners
// ==========================================
chrome.tabs.onActivated.addListener(focusTab);
chrome.tabGroups.onRemoved.addListener(removeGroup);
chrome.tabs.onCreated.addListener((tab) => handleNewTab(tab, storeLastAutoGroupAction));
chrome.tabs.onRemoved.addListener(cleanupPendingTab);

// Handle tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Handle URL changes for new tabs
  if (changeInfo.url && tab.url.startsWith('http')) {
    if (!pendingTabs.has(tabId) && tab.groupId === -1) {
      handleNewTab(tab, storeLastAutoGroupAction);
    }
  }

  // Handle load complete for pending tabs
  if (changeInfo.status === 'complete' && pendingTabs.has(tabId)) {
    autoGroupTab(tabId, storeLastAutoGroupAction);
    return;
  }

  // Handle URL change for grouped tabs (regrouping)
  if (changeInfo.url && tab.url.startsWith('http') && tab.groupId !== -1) {
    const delays = await getDelays();
    setTimeout(async () => {
      try {
        const updatedTab = await chrome.tabs.get(tabId);
        if (updatedTab.groupId !== -1 && updatedTab.url === tab.url) {
          regroupExistingTab(updatedTab);
        }
      } catch (error) {
        console.log(`Tab ${tabId} no longer exists for regrouping`);
      }
    }, delays.regroupDelay);
  }
});

// ==========================================
// Keyboard Shortcuts (Commands)
// ==========================================
chrome.commands.onCommand.addListener(async (command) => {
  console.log('Command received:', command);

  if (command === 'group-tabs') {
    try {
      const settings = await getConfig([
        'currentWindowOnly',
        'includeGroupedTabs',
        'excludePinnedTabs',
        'maxTabsPerGroup',
        'customGroupingInstructions',
        'useAdvancedGrouping'
      ]);

      const queryOptions = {};
      if (settings.currentWindowOnly !== false) {
        queryOptions.currentWindow = true;
      }

      let tabs = await chrome.tabs.query(queryOptions);

      // Apply filters
      tabs = tabs.filter(tab => tab.url && tab.url.startsWith('http'));
      if (!settings.includeGroupedTabs) {
        tabs = tabs.filter(tab => tab.groupId === -1);
      }
      if (settings.excludePinnedTabs) {
        tabs = tabs.filter(tab => !tab.pinned);
      }

      if (tabs.length === 0) {
        console.log('No tabs to group');
        return;
      }

      const maxTabsPerGroup = settings.maxTabsPerGroup ?? DEFAULTS.maxTabsPerGroup;
      const customGroupingInstructions = settings.customGroupingInstructions ?? '';
      const useAdvanced = settings.useAdvancedGrouping || tabs.length >= 30;
      const handler = useAdvanced ? handleLargeBatchTabGrouping : requestGroupingSuggestions;

      const suggestions = await handler(tabs, maxTabsPerGroup, customGroupingInstructions);

      // Apply grouping
      const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

      for (const group of suggestions.groups) {
        const tabIds = group.tab_indices.map(idx => tabs[idx]?.id).filter(Boolean);
        if (tabIds.length === 0) continue;

        const groupId = await chrome.tabs.group({ tabIds });
        const hasActiveTab = activeTab && tabIds.includes(activeTab.id);

        await chrome.tabGroups.update(groupId, {
          title: group.group_name,
          color: group.group_color,
          collapsed: !hasActiveTab
        });
      }

      console.log(`Grouped ${tabs.length} tabs via keyboard shortcut`);
    } catch (error) {
      console.error('Error grouping tabs via shortcut:', error);
    }
  }

  if (command === 'save-session') {
    const result = await saveSession();
    if (result.ok) {
      console.log('Session saved:', result.session.name);
    } else {
      console.error('Failed to save session:', result.error);
    }
  }
});

// ==========================================
// Message Handlers
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Grouping suggestions
  if (request.action === 'getGroupingSuggestions') {
    const { tabs, maxTabsPerGroup, customGroupingInstructions } = request;

    getConfig(['useAdvancedGrouping', 'excludePinnedTabs']).then(async (settings) => {
      let filteredTabs = [...tabs];

      if (settings.excludePinnedTabs) {
        filteredTabs = filteredTabs.filter(tab => !tab.pinned);
        console.log(`Filtered out pinned tabs, ${tabs.length - filteredTabs.length} tabs excluded`);
      }

      const useAdvanced = settings.useAdvancedGrouping || filteredTabs.length >= 30;
      const handler = useAdvanced ? handleLargeBatchTabGrouping : requestGroupingSuggestions;

      console.log(`Handling grouping suggestions: ${filteredTabs.length} tabs, using ${useAdvanced ? 'advanced' : 'standard'} mode`);

      try {
        const groupingSuggestions = await handler(filteredTabs, maxTabsPerGroup, customGroupingInstructions);
        sendResponse({ groupingSuggestions });
      } catch (error) {
        console.error('Error getting grouping suggestions:', error);
        sendResponse({ error: error.message });
      }
    });

    return true;
  }

  // Undo actions
  if (request.action === 'undoAutoGroup') {
    undoAction(request.actionId).then(sendResponse);
    return true;
  }

  if (request.action === 'getUndoHistory') {
    getUndoHistory().then(history => sendResponse({ history }));
    return true;
  }

  // Session management
  if (request.action === 'saveSession') {
    saveSession(request.name).then(sendResponse);
    return true;
  }

  if (request.action === 'getSessions') {
    getSessions().then(sessions => sendResponse({ sessions }));
    return true;
  }

  if (request.action === 'restoreSession') {
    restoreSession(request.sessionId, request.inNewWindow).then(sendResponse);
    return true;
  }

  if (request.action === 'deleteSession') {
    deleteSession(request.sessionId).then(sendResponse);
    return true;
  }

  if (request.action === 'renameSession') {
    renameSession(request.sessionId, request.newName).then(sendResponse);
    return true;
  }

  // Template management
  if (request.action === 'getTemplates') {
    getTemplates().then(templates => sendResponse({ templates }));
    return true;
  }

  if (request.action === 'applyTemplate') {
    applyTemplate(request.templateId).then(sendResponse);
    return true;
  }

  if (request.action === 'saveCurrentAsTemplate') {
    saveCurrentAsTemplate(request.name).then(sendResponse);
    return true;
  }

  if (request.action === 'deleteTemplate') {
    deleteTemplate(request.templateId).then(sendResponse);
    return true;
  }
});
