// ==========================================
// Tab & Tab Group Management
// ==========================================
import {
  DEFAULTS,
  ALLOWED_COLORS,
  hashCode,
  getConfig,
  getDelays
} from './config.js';
import {
  requestGroupingSuggestions,
  getGroupingChoiceFromLLM,
  getTargetGroupFromLLM,
  getNewGroupDetailsFromLLM,
  getGroupDecisionFromLLM
} from './ai.js';

// ==========================================
// State
// ==========================================
let currentActiveGroupId = null;
export const pendingTabs = new Map();
export const regroupingTabs = new Set();

// ==========================================
// Tab Group Operations
// ==========================================
export async function updateTabGroup(groupId, properties, retries = 3) {
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

export async function focusTab(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    console.log(`Focus tab ID: ${activeInfo.tabId}`);

    const result = await getConfig(['closeOtherGroups']);
    const closeOtherGroups = result.closeOtherGroups ?? true;

    if (tab.groupId !== -1 && tab.groupId !== currentActiveGroupId) {
      if (currentActiveGroupId !== null && closeOtherGroups) {
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

export function removeGroup(groupId) {
  if (groupId === currentActiveGroupId) {
    currentActiveGroupId = null;
    console.log('Active group removed');
  }
}

// ==========================================
// Default Group Name & Color
// ==========================================
export function getDefaultGroupNameFromTab(tab) {
  let groupName = tab.title.split(' - ')[0].split(' | ')[0];
  if (groupName.length > 20) {
    groupName = groupName.substring(0, 20) + '...';
  }
  return groupName;
}

export function getDefaultColorFromTab(tab) {
  try {
    const domain = new URL(tab.url).hostname;
    const colorIndex = Math.abs(hashCode(domain) % ALLOWED_COLORS.length);
    return ALLOWED_COLORS[colorIndex];
  } catch (e) {
    return 'grey';
  }
}

// ==========================================
// Create New Group
// ==========================================
export async function createNewGroupForTab(tab, suggestedName = null, suggestedColor = null) {
  try {
    if (suggestedName && suggestedColor) {
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, {
        title: suggestedName,
        color: suggestedColor
      });
      console.log(`Created new group "${suggestedName}" for tab ${tab.id}`);
      return { groupId, title: suggestedName, color: suggestedColor };
    }

    try {
      const settings = await getConfig(['maxTabsPerGroup', 'customGroupingInstructions']);
      const maxTabsPerGroup = settings.maxTabsPerGroup ?? DEFAULTS.maxTabsPerGroup;
      const customGroupingInstructions = settings.customGroupingInstructions ?? "";

      const suggestions = await requestGroupingSuggestions([tab], maxTabsPerGroup, customGroupingInstructions);

      if (suggestions.groups && suggestions.groups.length > 0) {
        const group = suggestions.groups[0];
        const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
        await chrome.tabGroups.update(groupId, {
          title: group.group_name,
          color: group.group_color
        });
        console.log(`Created AI-suggested group "${group.group_name}" for tab ${tab.id}`);
        return { groupId, title: group.group_name, color: group.group_color };
      }
    } catch (error) {
      console.error("Error using AI for group creation:", error);
    }

    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    const groupName = getDefaultGroupNameFromTab(tab);
    const color = getDefaultColorFromTab(tab);

    await chrome.tabGroups.update(groupId, {
      title: groupName,
      color: color
    });

    console.log(`Created default group "${groupName}" for tab ${tab.id}`);
    return { groupId, title: groupName, color: color };
  } catch (error) {
    console.error("Error creating new group for tab:", error);
  }
  return null;
}

// ==========================================
// Auto Tab Grouping
// ==========================================
export async function handleNewTab(tab, storeLastAutoGroupAction) {
  console.log('New tab created:', tab);

  if (!tab || !tab.id) {
    console.log('Invalid tab object');
    return;
  }

  const settings = await getConfig(['autoGroupNewTabs']);
  if (!settings.autoGroupNewTabs) {
    console.log('Auto-grouping disabled');
    return;
  }

  if (pendingTabs.has(tab.id)) {
    return;
  }

  const delays = await getDelays();
  pendingTabs.set(tab.id, {
    timestamp: Date.now(),
    timeoutId: setTimeout(() => autoGroupTab(tab.id, storeLastAutoGroupAction), delays.autoGroupFallback)
  });

  console.log(`Tab ${tab.id} scheduled for auto-grouping after load`);
}

export async function autoGroupTab(tabId, storeLastAutoGroupAction) {
  try {
    if (!pendingTabs.has(tabId)) return;

    const pendingTab = pendingTabs.get(tabId);
    clearTimeout(pendingTab.timeoutId);
    pendingTabs.delete(tabId);

    const settings = await getConfig(['autoGroupNewTabs', 'excludePinnedTabs']);

    if (!settings.autoGroupNewTabs) {
      console.log('Auto-grouping disabled');
      return;
    }

    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== -1) return;
    if (!tab.url || !tab.url.startsWith('http')) return;
    if (settings.excludePinnedTabs && tab.pinned) return;

    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    if (groups.length === 0) {
      const created = await createNewGroupForTab(tab);
      await storeLastAutoGroupAction({
        tabId: tab.id,
        windowId: tab.windowId,
        fromGroupId: -1,
        toGroupId: created?.groupId ?? -1,
        createdNewGroup: true,
        groupTitle: created?.title ?? '',
        groupColor: created?.color ?? '',
        reasoning: 'No existing groups to reuse.',
        timestamp: Date.now()
      });
      return;
    }

    await findGroupingDecision(tab, groups, storeLastAutoGroupAction);
  } catch (error) {
    console.error("Error in autoGroupTab:", error);
  }
}

export async function findGroupingDecision(newTab, existingGroups, storeLastAutoGroupAction) {
  try {
    if (existingGroups.length === 0) {
      await createNewGroupForTab(newTab);
      return;
    }

    const choice = await getGroupingChoiceFromLLM(newTab, existingGroups);
    console.log("Group choice:", choice);

    if (choice.create_new_group) {
      const details = await getNewGroupDetailsFromLLM(newTab);
      const created = await createNewGroupForTab(newTab, details.suggested_name, details.suggested_color);
      const reasoning = `${choice.reasoning}${details.reasoning ? ` Name: ${details.reasoning}` : ''}`;
      await storeLastAutoGroupAction({
        tabId: newTab.id,
        windowId: newTab.windowId,
        fromGroupId: -1,
        toGroupId: created?.groupId ?? -1,
        createdNewGroup: true,
        groupTitle: created?.title ?? details.suggested_name ?? '',
        groupColor: created?.color ?? details.suggested_color ?? '',
        reasoning: reasoning.trim(),
        timestamp: Date.now()
      });
      return;
    }

    const target = await getTargetGroupFromLLM(newTab, existingGroups);
    try {
      await chrome.tabs.group({
        tabIds: [newTab.id],
        groupId: target.target_group_id
      });
      console.log(`Tab ${newTab.id} added to existing group ${target.target_group_id}`);
      const targetGroup = existingGroups.find(group => group.id === target.target_group_id);
      const reasoning = `${choice.reasoning}${target.reasoning ? ` Target: ${target.reasoning}` : ''}`;
      await storeLastAutoGroupAction({
        tabId: newTab.id,
        windowId: newTab.windowId,
        fromGroupId: -1,
        toGroupId: target.target_group_id,
        createdNewGroup: false,
        groupTitle: targetGroup?.title ?? '',
        groupColor: targetGroup?.color ?? '',
        reasoning: reasoning.trim(),
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Error adding tab to group ${target.target_group_id}:`, error);
      const created = await createNewGroupForTab(newTab);
      await storeLastAutoGroupAction({
        tabId: newTab.id,
        windowId: newTab.windowId,
        fromGroupId: -1,
        toGroupId: created?.groupId ?? -1,
        createdNewGroup: true,
        groupTitle: created?.title ?? '',
        groupColor: created?.color ?? '',
        reasoning: 'Fallback: failed to add to target group.',
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error("Error in findGroupingDecision:", error);
    const created = await createNewGroupForTab(newTab);
    await storeLastAutoGroupAction({
      tabId: newTab.id,
      windowId: newTab.windowId,
      fromGroupId: -1,
      toGroupId: created?.groupId ?? -1,
      createdNewGroup: true,
      groupTitle: created?.title ?? '',
      groupColor: created?.color ?? '',
      reasoning: 'Fallback: failed to make grouping decision.',
      timestamp: Date.now()
    });
  }
}

// ==========================================
// Tab Regrouping
// ==========================================
export async function regroupExistingTab(tab) {
  try {
    if (regroupingTabs.has(tab.id)) {
      console.log(`Tab ${tab.id} already being regrouped, skipping`);
      return;
    }

    regroupingTabs.add(tab.id);
    console.log(`Regrouping tab ${tab.id} due to URL change:`, tab.url);

    const settings = await getConfig(['autoRegroupTabs', 'excludePinnedTabs']);

    if (!settings.autoRegroupTabs) {
      console.log('Auto-regrouping disabled');
      return;
    }

    if (settings.excludePinnedTabs && tab.pinned) {
      console.log(`Tab ${tab.id} skipped: Pinned tab is excluded by settings`);
      return;
    }

    if (!tab.url || !tab.url.startsWith('http')) {
      console.log(`Tab ${tab.id} skipped: Not HTTP URL`);
      return;
    }

    const currentGroupId = tab.groupId;

    const allGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
    const otherGroups = allGroups.filter(group => group.id !== currentGroupId);

    await chrome.tabs.ungroup(tab.id);
    console.log(`Tab ${tab.id} temporarily ungrouped for re-evaluation`);

    if (otherGroups.length === 0) {
      await createNewGroupForTab(tab);
      console.log(`Tab ${tab.id} moved to new group (no other groups available)`);
      return;
    }

    const decision = await getGroupDecisionFromLLM(tab, otherGroups);
    console.log("Regrouping decision:", decision);

    if (decision.create_new_group) {
      await createNewGroupForTab(tab, decision.suggested_name, decision.suggested_color);
      console.log(`Tab ${tab.id} moved to new group: ${decision.suggested_name}`);
    } else {
      const targetGroupId = decision.target_group_id;
      try {
        await chrome.tabs.group({
          tabIds: [tab.id],
          groupId: targetGroupId
        });
        console.log(`Tab ${tab.id} moved to existing group ${targetGroupId}`);
      } catch (error) {
        console.error(`Error moving tab to group ${targetGroupId}:`, error);
        try {
          if (currentGroupId !== -1 && allGroups.some(g => g.id === currentGroupId)) {
            await chrome.tabs.group({
              tabIds: [tab.id],
              groupId: currentGroupId
            });
            console.log(`Tab ${tab.id} moved back to original group ${currentGroupId}`);
          } else {
            await createNewGroupForTab(tab);
            console.log(`Tab ${tab.id} moved to fallback new group`);
          }
        } catch (fallbackError) {
          console.error(`Fallback regrouping failed for tab ${tab.id}:`, fallbackError);
        }
      }
    }
  } catch (error) {
    console.error(`Error regrouping tab ${tab.id}:`, error);
  } finally {
    regroupingTabs.delete(tab.id);
  }
}

// ==========================================
// Cleanup
// ==========================================
export function cleanupPendingTab(tabId) {
  if (pendingTabs.has(tabId)) {
    clearTimeout(pendingTabs.get(tabId).timeoutId);
    pendingTabs.delete(tabId);
  }
  regroupingTabs.delete(tabId);
}
