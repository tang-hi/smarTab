// ==========================================
// Tab & Tab Group Management
// ==========================================
import { getConfig, getDelays } from './config.js';

// ==========================================
// State
// ==========================================
let currentActiveGroupId = null;

// ==========================================
// Tab Group Operations
// ==========================================
async function updateTabGroup(groupId, properties, retries = 3) {
  const delays = await getDelays();
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabGroups.update(groupId, properties);
      return true;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delays.retryDelay));
    }
  }
  return false;
}

/**
 * Focus handler - auto-collapse other groups when switching tabs
 */
export async function focusTab(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    console.log(`Focus tab ID: ${activeInfo.tabId}`);

    const result = await getConfig(['closeOtherGroups']);
    const closeOtherGroups = result.closeOtherGroups ?? true;

    if (!closeOtherGroups) {
      return;
    }

    if (tab.groupId !== -1 && tab.groupId !== currentActiveGroupId) {
      // Collapse previous group
      if (currentActiveGroupId !== null) {
        try {
          await updateTabGroup(currentActiveGroupId, { collapsed: true });
        } catch (e) {
          console.log('Failed to collapse previous group:', e);
        }
      }

      // Expand current group
      try {
        await updateTabGroup(tab.groupId, { collapsed: false });
        currentActiveGroupId = tab.groupId;
      } catch (e) {
        console.log('Failed to expand current group:', e);
        currentActiveGroupId = null;
      }
    }
  } catch (error) {
    console.error('Error focusing tab:', error);
  }
}
