// ==========================================
// Features: Sessions, Templates, Undo
// ==========================================
import { DEFAULTS, generateUUID, getConfig, setConfig } from './config.js';

// ==========================================
// Undo History Management
// ==========================================
export async function pushUndoAction(action) {
  try {
    const result = await chrome.storage.sync.get(['undoHistory']);
    const undoHistory = result.undoHistory || [];
    const settings = await getConfig(['undoHistorySize']);
    const maxSize = settings.undoHistorySize || DEFAULTS.undoHistorySize;

    // Add new action with ID
    const actionWithId = {
      id: generateUUID(),
      ...action
    };

    undoHistory.unshift(actionWithId);

    // Trim to max size
    while (undoHistory.length > maxSize) {
      undoHistory.pop();
    }

    await chrome.storage.sync.set({ undoHistory });

    // Also store as lastAutoGroupAction for backward compatibility
    await chrome.storage.sync.set({ lastAutoGroupAction: action });

    return actionWithId;
  } catch (error) {
    console.error('Failed to push undo action:', error);
    return null;
  }
}

export async function getUndoHistory() {
  const result = await chrome.storage.sync.get(['undoHistory']);
  return result.undoHistory || [];
}

export async function undoAction(actionId = null) {
  try {
    const undoHistory = await getUndoHistory();

    if (undoHistory.length === 0) {
      return { ok: false, error: 'No actions to undo.' };
    }

    // Find the action to undo
    let actionIndex = 0;
    if (actionId) {
      actionIndex = undoHistory.findIndex(a => a.id === actionId);
      if (actionIndex === -1) {
        return { ok: false, error: 'Action not found in history.' };
      }
    }

    const action = undoHistory[actionIndex];

    if (action.toGroupId === -1) {
      return { ok: false, error: 'Nothing to undo for that action.' };
    }

    // Try to get the tab
    let tab;
    try {
      tab = await chrome.tabs.get(action.tabId);
    } catch (e) {
      // Tab no longer exists, remove from history
      undoHistory.splice(actionIndex, 1);
      await chrome.storage.sync.set({ undoHistory });
      return { ok: false, error: 'Tab no longer exists.' };
    }

    // Check if tab was moved since the action
    if (tab.groupId !== action.toGroupId) {
      return { ok: false, error: 'Tab was moved since the action.' };
    }

    // Perform the undo
    if (action.fromGroupId && action.fromGroupId !== -1) {
      await chrome.tabs.group({
        tabIds: [tab.id],
        groupId: action.fromGroupId
      });
    } else if (tab.groupId !== -1) {
      await chrome.tabs.ungroup(tab.id);
    }

    // Remove the action from history
    undoHistory.splice(actionIndex, 1);
    await chrome.storage.sync.set({ undoHistory });

    // Update lastAutoGroupAction for backward compatibility
    if (undoHistory.length > 0) {
      await chrome.storage.sync.set({ lastAutoGroupAction: undoHistory[0] });
    } else {
      await chrome.storage.sync.remove('lastAutoGroupAction');
    }

    return { ok: true };
  } catch (error) {
    console.error('Undo failed:', error);
    return { ok: false, error: 'Undo failed. ' + error.message };
  }
}

export async function clearUndoHistory() {
  await chrome.storage.sync.set({ undoHistory: [] });
  await chrome.storage.sync.remove('lastAutoGroupAction');
}

// ==========================================
// Session Management
// ==========================================
export async function saveSession(name = null) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });

    if (tabs.length === 0) {
      return { ok: false, error: 'No tabs to save.' };
    }

    // Get group info for tabs
    const groups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
    const groupMap = new Map(groups.map(g => [g.id, { name: g.title, color: g.color }]));

    const sessionTabs = tabs
      .filter(tab => tab.url && tab.url.startsWith('http'))
      .map(tab => ({
        url: tab.url,
        title: tab.title,
        pinned: tab.pinned,
        groupInfo: tab.groupId !== -1 ? groupMap.get(tab.groupId) || null : null
      }));

    const session = {
      id: generateUUID(),
      name: name || `Session ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      tabs: sessionTabs,
      tabCount: sessionTabs.length,
      groupCount: groups.length
    };

    // Get existing sessions from local storage
    const result = await chrome.storage.local.get(['sessions']);
    const sessions = result.sessions || [];

    // Add new session at the beginning
    sessions.unshift(session);

    // Limit session count
    const settings = await getConfig(['maxSessionCount']);
    const maxCount = settings.maxSessionCount || DEFAULTS.maxSessionCount;
    while (sessions.length > maxCount) {
      sessions.pop();
    }

    await chrome.storage.local.set({ sessions });

    return { ok: true, session };
  } catch (error) {
    console.error('Failed to save session:', error);
    return { ok: false, error: error.message };
  }
}

export async function getSessions() {
  const result = await chrome.storage.local.get(['sessions']);
  return result.sessions || [];
}

export async function getSession(sessionId) {
  const sessions = await getSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

export async function deleteSession(sessionId) {
  try {
    const sessions = await getSessions();
    const index = sessions.findIndex(s => s.id === sessionId);
    if (index === -1) {
      return { ok: false, error: 'Session not found.' };
    }
    sessions.splice(index, 1);
    await chrome.storage.local.set({ sessions });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function renameSession(sessionId, newName) {
  try {
    const sessions = await getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      return { ok: false, error: 'Session not found.' };
    }
    session.name = newName;
    await chrome.storage.local.set({ sessions });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function restoreSession(sessionId, inNewWindow = false) {
  try {
    const session = await getSession(sessionId);
    if (!session) {
      return { ok: false, error: 'Session not found.' };
    }

    let windowId;
    if (inNewWindow) {
      const newWindow = await chrome.windows.create({ focused: true });
      windowId = newWindow.id;
      // Close the initial empty tab
      const initialTabs = await chrome.tabs.query({ windowId });
      if (initialTabs.length === 1 && initialTabs[0].url === 'chrome://newtab/') {
        await chrome.tabs.remove(initialTabs[0].id);
      }
    } else {
      const currentWindow = await chrome.windows.getCurrent();
      windowId = currentWindow.id;
    }

    // Group tabs by their group info
    const groupedTabs = new Map(); // group name -> tabs
    const ungroupedTabs = [];

    for (const tabInfo of session.tabs) {
      if (tabInfo.groupInfo) {
        const key = `${tabInfo.groupInfo.name}|${tabInfo.groupInfo.color}`;
        if (!groupedTabs.has(key)) {
          groupedTabs.set(key, { info: tabInfo.groupInfo, tabs: [] });
        }
        groupedTabs.get(key).tabs.push(tabInfo);
      } else {
        ungroupedTabs.push(tabInfo);
      }
    }

    // Create ungrouped tabs
    for (const tabInfo of ungroupedTabs) {
      await chrome.tabs.create({
        url: tabInfo.url,
        pinned: tabInfo.pinned,
        windowId
      });
    }

    // Create grouped tabs
    for (const [key, group] of groupedTabs) {
      const createdTabIds = [];
      for (const tabInfo of group.tabs) {
        const tab = await chrome.tabs.create({
          url: tabInfo.url,
          pinned: tabInfo.pinned,
          windowId
        });
        createdTabIds.push(tab.id);
      }

      // Group the tabs
      if (createdTabIds.length > 0) {
        const groupId = await chrome.tabs.group({ tabIds: createdTabIds, createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, {
          title: group.info.name,
          color: group.info.color
        });
      }
    }

    return { ok: true, tabCount: session.tabs.length };
  } catch (error) {
    console.error('Failed to restore session:', error);
    return { ok: false, error: error.message };
  }
}

// ==========================================
// Grouping Templates
// ==========================================
export async function getTemplates() {
  const result = await chrome.storage.sync.get(['groupingTemplates']);
  return result.groupingTemplates || [];
}

export async function getTemplate(templateId) {
  const templates = await getTemplates();
  return templates.find(t => t.id === templateId) || null;
}

export async function saveTemplate(template) {
  try {
    const templates = await getTemplates();

    if (template.id) {
      // Update existing
      const index = templates.findIndex(t => t.id === template.id);
      if (index !== -1) {
        templates[index] = { ...templates[index], ...template };
      } else {
        templates.push(template);
      }
    } else {
      // Create new
      template.id = generateUUID();
      template.createdAt = Date.now();
      templates.push(template);
    }

    await chrome.storage.sync.set({ groupingTemplates: templates });
    return { ok: true, template };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function deleteTemplate(templateId) {
  try {
    const templates = await getTemplates();
    const index = templates.findIndex(t => t.id === templateId);
    if (index === -1) {
      return { ok: false, error: 'Template not found.' };
    }
    templates.splice(index, 1);
    await chrome.storage.sync.set({ groupingTemplates: templates });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function saveCurrentAsTemplate(name) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groups = await chrome.tabGroups.query({ windowId: tabs[0]?.windowId });

    if (groups.length === 0) {
      return { ok: false, error: 'No groups to save as template.' };
    }

    // Build patterns from current tabs
    const templateGroups = [];

    for (const group of groups) {
      const groupTabs = tabs.filter(t => t.groupId === group.id);
      const patterns = [];

      // Extract domains from tabs
      const domains = new Set();
      for (const tab of groupTabs) {
        try {
          const url = new URL(tab.url);
          domains.add(url.hostname);
        } catch (e) { }
      }

      for (const domain of domains) {
        patterns.push({ type: 'domain', value: domain });
      }

      templateGroups.push({
        name: group.title || 'Unnamed',
        color: group.color,
        patterns
      });
    }

    const template = {
      id: generateUUID(),
      name: name || `Template ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      groups: templateGroups,
      fallbackGroup: { name: 'Other', color: 'grey' }
    };

    return await saveTemplate(template);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Pattern matching helpers
function matchDomain(url, domain) {
  try {
    const urlHost = new URL(url).hostname;
    return urlHost === domain || urlHost.endsWith('.' + domain);
  } catch (e) {
    return false;
  }
}

function matchContains(url, keyword) {
  return url.toLowerCase().includes(keyword.toLowerCase());
}

function matchPattern(url, pattern) {
  switch (pattern.type) {
    case 'domain':
      return matchDomain(url, pattern.value);
    case 'contains':
      return matchContains(url, pattern.value);
    default:
      return false;
  }
}

export async function applyTemplate(templateId) {
  try {
    const template = await getTemplate(templateId);
    if (!template) {
      return { ok: false, error: 'Template not found.' };
    }

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const httpTabs = tabs.filter(t => t.url && t.url.startsWith('http') && t.groupId === -1);

    if (httpTabs.length === 0) {
      return { ok: false, error: 'No ungrouped tabs to organize.' };
    }

    const settings = await getConfig(['excludePinnedTabs']);
    const filteredTabs = settings.excludePinnedTabs
      ? httpTabs.filter(t => !t.pinned)
      : httpTabs;

    // Match tabs to groups
    const groupAssignments = new Map(); // group index -> tab ids
    const fallbackTabs = [];

    for (const tab of filteredTabs) {
      let matched = false;

      for (let i = 0; i < template.groups.length; i++) {
        const group = template.groups[i];
        const isMatch = group.patterns.some(p => matchPattern(tab.url, p));

        if (isMatch) {
          if (!groupAssignments.has(i)) {
            groupAssignments.set(i, []);
          }
          groupAssignments.get(i).push(tab.id);
          matched = true;
          break;
        }
      }

      if (!matched && template.fallbackGroup) {
        fallbackTabs.push(tab.id);
      }
    }

    // Create groups
    for (const [groupIndex, tabIds] of groupAssignments) {
      const groupDef = template.groups[groupIndex];
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: groupDef.name,
        color: groupDef.color
      });
    }

    // Create fallback group
    if (fallbackTabs.length > 0 && template.fallbackGroup) {
      const groupId = await chrome.tabs.group({ tabIds: fallbackTabs });
      await chrome.tabGroups.update(groupId, {
        title: template.fallbackGroup.name,
        color: template.fallbackGroup.color
      });
    }

    const totalGrouped = [...groupAssignments.values()].flat().length + fallbackTabs.length;
    return { ok: true, groupedCount: totalGrouped };
  } catch (error) {
    console.error('Failed to apply template:', error);
    return { ok: false, error: error.message };
  }
}
