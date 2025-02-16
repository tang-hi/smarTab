// Initialize the service worker
console.log('Background service worker initialized');

let currentActiveGroupId = null;

async function updateTabGroup(groupId, properties, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabGroups.update(groupId, properties);
      return true;
    } catch (error) {
      if (i === retries - 1) throw error;
      // Wait for 100ms before retrying
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return false;
}

async function focusTab(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    console.log(`Focus tab ID: ${activeInfo.tabId}`);

    if (tab.groupId !== -1 && tab.groupId !== currentActiveGroupId) {
      if (currentActiveGroupId !== null) {
        try {
          await updateTabGroup(currentActiveGroupId, { collapsed: true });
        } catch (e) {
          console.log('Failed to collapse previous group:', e);
        }
      }

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

function removeGroup(groupId) {
  if (groupId === currentActiveGroupId) {
    currentActiveGroupId = null;
    console.log('Active group removed');
  }
}

// Add tab activation listener
chrome.tabs.onActivated.addListener(focusTab);

// Add group removal listener
chrome.tabGroups.onRemoved.addListener(removeGroup);