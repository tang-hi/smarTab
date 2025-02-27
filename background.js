// ==========================================
// Initialization
// ==========================================
console.log('Background service worker initialized');

let currentActiveGroupId = null;

// ==========================================
// Utility Functions
// ==========================================
function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = s1[i - 1] === s2[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function validateGroupingSuggestions(suggestions) {
  if (!suggestions?.groups || !Array.isArray(suggestions.groups)) {
    return false;
  }

  return suggestions.groups.every(group => 
    group.group_name && 
    typeof group.group_name === 'string' &&
    group.group_color && 
    (group.tab_indices || group.tab_titles)
  );
}

function extractTabInfo(tabs) {
  return tabs.map(tab => {
    const url = new URL(tab.url);
    return {
      title: tab.title,
      url: url.origin + url.pathname // Extracts the base URL
    };
  });
}

// ==========================================
// Tab Group Management
// ==========================================
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

    chrome.storage.sync.get(['closeOtherGroups'], async (result) => {
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
    });

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

// ==========================================
// Gemini API Integration
// ==========================================
async function sendToGemini(tabs, maxTabsPerGroup, customGroupingInstructions) {
  const tabsInfo = extractTabInfo(tabs);
  const systemPrompt = `You are a browser tab grouping assistant. Your task is to analyze the user's tabs and provide reasonable grouping suggestions.

  Example output format:
  {
      "groups": [
          {
              "group_name": "Work Documents",
              "group_color": "blue",
              "tab_indices": [0, 1, 2],
          },
          {
              "group_name": "Social Media",
              "group_color": "pink",
              "tab_indices": [3, 4],
          }
      ]
  }
  
  Example output Schema:
  {
      "groups": [
          {
              "group_name": string,
              "group_color": string, // one of: grey, blue, red, yellow, green, pink, purple, cyan
              "tab_indices": number[], // indices of tabs that belong to this group
          }
      ]
  }
  
  Notes:
  1. group_color must be one of the following options: grey, blue, red, yellow, green, pink, purple, cyan
  2. group_name should be short and meaningful
  3. Add Emoji to group_name for better readability if needed
  4. tab_indices must be valid tab indices
  5. The response must be valid JSON format
  6. Each group should contain at most ${maxTabsPerGroup} tabs
  ${customGroupingInstructions ? `7. Follow these custom grouping instructions: ${customGroupingInstructions}` : ""}
  `;

  const userPrompt = `Please analyze the following browser tabs and suggest reasonable groupings:
  Tabs: ${JSON.stringify(tabsInfo, null, 2)}

  Notes:
  Each group should contain at most ${maxTabsPerGroup} tabs
  ${customGroupingInstructions ? `Follow these custom grouping instructions: ${customGroupingInstructions}` : ""}`;

  const response_format = {
    type: "OBJECT",
    properties: {
      groups: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            group_name: { type: "STRING" },
            group_color: { type: "STRING" },
            tab_indices: { type: "ARRAY", items: { type: "NUMBER" } },
          },
          required: ["group_name", "group_color", "tab_indices"],
        },
      }
    },
  }
  return await makeGeminiRequest(tabsInfo, systemPrompt, userPrompt, response_format);
}

async function handleLargeBatchTabGrouping(tabs, maxTabsPerGroup, customGroupingInstructions) {
  const tabsInfo = extractTabInfo(tabs);
  const systemPrompt = `You are a browser tab grouping assistant. Your task is to analyze the user's tabs and provide reasonable grouping suggestions.
  
  Example output format:
  {
      "groups": [
          {
              "group_name": "Work Documents",
              "group_color": "blue",
              "tab_titles": ["Lark", "Google Doc", "Microsoft Word"]
          },
          {
              "group_name": "Social Media",
              "group_color": "pink",
              "tab_titles": ["Facebook", "Twitter", "Instagram"]
          }
      ]
  }

  Example output Schema:
  {
      "groups": [
          {
              "group_name": string,
              "group_color": string, // one of: grey, blue, red, yellow, green, pink, purple, cyan
              "tab_titles": string[], // titles of tabs that belong to this group
          }
      ]
  }

  Notes:
  1. group_color must be one of the following options: grey, blue, red, yellow, green, pink, purple, cyan
  2. group_name should be short and meaningful
  3. Add Emoji to group_name for better readability if needed
  4. tab_title must be valid tab titles, You can use the title of the tab to identify it
  5. Don't miss any tab, each tab should be in one group
  6. Don't miss any group, each group should contain at least one tab
  7. Don't duplicate any tab in different groups
  8. The response must be valid JSON format
  9. Each group should contain at most ${maxTabsPerGroup} tabs, unless there are too many very similar tabs to group together
  ${customGroupingInstructions ? `10. Follow these custom grouping instructions: ${customGroupingInstructions}` : ""}
  `;

  const userPrompt = `Please analyze the following browser tabs and suggest reasonable groupings:
  Tabs: ${JSON.stringify(tabsInfo, null, 2)}

  Notes:
  Each group should contain at most ${maxTabsPerGroup} tabs, unless there are too many very similar tabs to group together
  ${customGroupingInstructions ? `Follow these custom grouping instructions: ${customGroupingInstructions}` : ""}`;
 
  const response_format = {
    type: "OBJECT",
    properties: {
      groups: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            group_name: { type: "STRING" },
            group_color: { type: "STRING" },
            tab_titles: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["group_name", "group_color", "tab_titles"],
        },
      }
    },
  }
  const groupingSuggestions = await makeGeminiRequest(tabsInfo, systemPrompt, userPrompt, response_format);
  console.log(groupingSuggestions);

  return convertTitlesToIndices(groupingSuggestions, tabs);
}

// ==========================================
// API Helper Functions
// ==========================================
async function makeGeminiRequest(tabsInfo, systemPrompt, userPrompt, response_schema, maxRetries = 3) {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      const settings = await chrome.storage.sync.get(['geminiApiKey']);
      const useCustomApi = settings.geminiApiKey && settings.geminiApiKey.trim() !== '';
      
      const result = useCustomApi 
        ? await makeDirectGeminiRequest(tabsInfo, systemPrompt, userPrompt, response_schema, settings.geminiApiKey)
        : await makeProxyGeminiRequest(tabsInfo, systemPrompt, userPrompt);

      if (validateGroupingSuggestions(result)) {
        return result;
      }
      console.log(`Invalid response format on attempt ${attempts + 1}, retrying...`);
    } catch (error) {
      console.error(`Error on attempt ${attempts + 1}:`, error);
    }
    attempts++;
    if (attempts < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
    }
  }
  throw new Error('Failed to get valid grouping suggestions after multiple attempts');
}

async function makeDirectGeminiRequest(tabsInfo, systemPrompt, userPrompt, response_schema, apiKey) {
  console.log('Using custom Gemini');
  console.log(response_schema);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: systemPrompt + '\n' + userPrompt }],
      }],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: response_schema
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

async function makeProxyGeminiRequest(tabsInfo, systemPrompt, userPrompt) {
  console.log('Using proxy Gemini');
  const response = await fetch('https://smartab.work:443/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

function convertTitlesToIndices(groupingSuggestions, tabs) {
  // record title to group index mapping
  const titleToGroupIndex = {};

  for (const group of groupingSuggestions.groups) {
    const tabTitles = group.tab_titles;
    group.tab_indices = tabTitles.map(title => {
      let index = tabs.findIndex(tab => tab.title === title);
      if (index === -1) {
        // Find closest match using Levenshtein distance
        let minDistance = Number.MAX_VALUE;
        const titleLower = title.toLowerCase();
        tabs.forEach((tab, i) => {
          const distance = levenshteinDistance(titleLower, tab.title.toLowerCase());
          if (distance < minDistance) {
            minDistance = distance;
            index = i;
          }
        });
      }
      return index !== -1 ? index : null;
    }).filter(index => index !== null);

    for (const title of tabTitles) {
      titleToGroupIndex[title] = groupingSuggestions.groups.indexOf(group);
    }
  }

  // if still some tabs are not grouped, assign them to the group based on the similarity of the title
  const ungroupedTabs = tabs.filter((tab, i) => !groupingSuggestions.groups.some(group => group.tab_indices.includes(i)));

  for (const tab of ungroupedTabs) {
    let minDistance = Number.MAX_VALUE;
    let groupIndex = -1;
    for (const title of groupingSuggestions.groups.map(group => group.tab_titles).flat()) {
      const distance = levenshteinDistance(tab.title.toLowerCase(), title.toLowerCase());
      if (distance < minDistance) {
        minDistance = distance;
        groupIndex = titleToGroupIndex[title];
      }
    }
    if (groupIndex !== -1) {
      groupingSuggestions.groups[groupIndex].tab_indices.push(tabs.indexOf(tab));
    }
  }

  return groupingSuggestions;
}

// ==========================================
// Auto Tab Grouping
// ==========================================
const pendingTabs = new Map(); // Track tabs waiting to be auto-grouped

async function handleNewTab(tab) {
  // Debug log
  console.log('New tab created:', tab);

  // Make sure we have all required properties
  if (!tab || !tab.id) {
    console.log('Invalid tab object');
    return;
  }

  // Check if auto-grouping is enabled
  const settings = await chrome.storage.sync.get(['autoGroupNewTabs']);
  if (!settings.autoGroupNewTabs) {
    console.log('Auto-grouping disabled');
    return;
  }
  
  // Add a small delay to wait for the tab to fully load its URL
  // This helps with "new tab" pages that don't have a URL initially
  setTimeout(async () => {
    try {
      // Get the current state of the tab (URL might have changed)
      const currentTab = await chrome.tabs.get(tab.id);
      
      // Skip internal pages, empty pages, and already grouped tabs
      if (!currentTab.url || 
          !currentTab.url.startsWith('http') || 
          currentTab.groupId !== -1) {
        console.log(`Tab ${tab.id} skipped: `, 
          !currentTab.url ? 'No URL' : 
          currentTab.groupId !== -1 ? 'Already grouped' : 'Not HTTP');
        return;
      }
      
      // Add this tab to pending tabs
      pendingTabs.set(tab.id, {
        tab: currentTab,
        timestamp: Date.now(),
        timeoutId: setTimeout(() => autoGroupTab(tab.id), 10000) // 10 second delay
      });
      
      console.log(`Tab ${tab.id} scheduled for auto-grouping`, currentTab.url);
    } catch (error) {
      // Tab may have been closed immediately
      console.log(`Error scheduling tab ${tab.id}:`, error);
    }
  }, 500); // Small delay to allow URL to populate
}

async function autoGroupTab(tabId) {
  try {
    // Check if the tab still exists and is still pending
    if (!pendingTabs.has(tabId)) return;
    
    const pendingTab = pendingTabs.get(tabId);
    pendingTabs.delete(tabId);
    
    // Get the updated tab info
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== -1) return; // Already grouped
    
    // Get all existing groups in the current window
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    if (groups.length === 0) {
      // No existing groups, create a new one
      await createNewGroupForTab(tab);
      return;
    }
    
    await findGroupingDecision(tab, groups);
  } catch (error) {
    console.error("Error in autoGroupTab:", error);
  }
}

async function findGroupingDecision(newTab, existingGroups) {
  try {
    // If there are no existing groups, create a new one
    if (existingGroups.length === 0) {
      await createNewGroupForTab(newTab);
      return;
    }

    // Get decision from LLM using just group names and colors
    const decision = await getGroupDecisionFromLLM(newTab, existingGroups);
    console.log("Group decision:", decision);

    if (decision.create_new_group) {
      // Create a new group with the suggested name and color
      await createNewGroupForTab(newTab, decision.suggested_name, decision.suggested_color);
    } else {
      // Add to existing group
      const targetGroupId = decision.target_group_id;
      try {
        await chrome.tabs.group({
          tabIds: [newTab.id],
          groupId: targetGroupId
        });
        console.log(`Tab ${newTab.id} added to existing group ${targetGroupId}`);
      } catch (error) {
        console.error(`Error adding tab to group ${targetGroupId}:`, error);
        // Fallback to creating a new group
        await createNewGroupForTab(newTab);
      }
    }
  } catch (error) {
    console.error("Error in findGroupingDecision:", error);
    // Fallback to creating a new group
    await createNewGroupForTab(newTab);
  }
}

async function getGroupDecisionFromLLM(newTab, existingGroups) {
  const settings = await chrome.storage.sync.get(['geminiApiKey', 'customGroupingInstructions']);
  
  // Only provide group names and colors, no sample tabs
  const existingGroupsInfo = existingGroups.map(group => ({
    id: group.id,
    name: group.title,
    color: group.color
  }));

  // Format new tab info
  const newTabInfo = {
    title: newTab.title,
    url: newTab.url
  };

  // Prepare the prompt
  const systemPrompt = `You are a browser tab organization assistant that helps decide how to group a newly opened tab.
  Analyze the new tab and existing tab groups to make the best decision for organizing the browser.
  
  Your task is to determine whether the new tab should:
  1. Be added to one of the existing groups based on their names and colors, OR
  2. Get its own new group and appropriate name and color (Only if it doesn't fit in any existing group)
  3. Add emoji to group names for better readability
  
  Your response must be valid JSON matching this format:
  {
    "create_new_group": boolean,
    "reasoning": string,
    "target_group_id": number | null,  // ID of the existing group to join, or null if creating new group
    "suggested_name": string,  // Suggested name if creating a new group
    "suggested_color": string   // One of: grey, blue, red, yellow, green, pink, purple, cyan
  }
  
  Note: You only have the group names and colors to work with, not the contents of the tabs in those groups.
  Make your best guess based on the new tab's URL and title, and the existing group names.
  
  ${settings.customGroupingInstructions ? `Consider these custom user instructions: ${settings.customGroupingInstructions}` : ""}`;

  const userPrompt = `New tab: 
  ${JSON.stringify(newTabInfo, null, 2)}
  
  Existing groups:
  ${JSON.stringify(existingGroupsInfo, null, 2)}`;

  const response_format = {
    type: "OBJECT",
    properties: {
      create_new_group: { type: "BOOLEAN" },
      reasoning: { type: "STRING" },
      target_group_id: { type: "NUMBER", nullable: true },
      suggested_name: { type: "STRING" },
      suggested_color: { type: "STRING" }
    },
    required: ["create_new_group", "reasoning", "target_group_id", "suggested_name", "suggested_color"]
  };

  try {
    // Use existing Gemini request function
    const useCustomApi = settings.geminiApiKey && settings.geminiApiKey.trim() !== '';
    
    let result;
    if (useCustomApi) {
      result = await makeDirectGeminiRequest(
        [newTabInfo, existingGroupsInfo], 
        systemPrompt, 
        userPrompt, 
        response_format, 
        settings.geminiApiKey
      );
    } else {
      // Use proxy for simpler API
      const response = await fetch('https://smartab.work:443/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      result = await response.json();
    }

    // Validate result has necessary fields
    if (!result || typeof result.create_new_group !== 'boolean') {
      throw new Error('Invalid response format from LLM');
    }

    return result;
  } catch (error) {
    console.error("Error getting group decision from LLM:", error);
    // Default to creating a new group in case of error
    return {
      create_new_group: true,
      reasoning: "Error occurred during analysis, defaulting to new group",
      target_group_id: null,
      suggested_name: getDefaultGroupNameFromTab(newTab),
      suggested_color: getDefaultColorFromTab(newTab)
    };
  }
}

async function createNewGroupForTab(tab, suggestedName = null, suggestedColor = null) {
  try {
    // If we already have suggested name and color, use them
    if (suggestedName && suggestedColor) {
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, {
        title: suggestedName,
        color: suggestedColor
      });
      console.log(`Created new group "${suggestedName}" for tab ${tab.id}`);
      return;
    }
    
    // Otherwise, use our existing LLM grouping for better suggestions
    try {
      // Use the existing sendToGemini function with a single tab
      const settings = await chrome.storage.sync.get(['maxTabsPerGroup', 'customGroupingInstructions']);
      const maxTabsPerGroup = settings.maxTabsPerGroup ?? 10;
      const customGroupingInstructions = settings.customGroupingInstructions ?? "";
      
      const suggestions = await sendToGemini([tab], maxTabsPerGroup, customGroupingInstructions);
      
      if (suggestions.groups && suggestions.groups.length > 0) {
        // Create the group with the suggested name and color
        const group = suggestions.groups[0];
        const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
        await chrome.tabGroups.update(groupId, {
          title: group.group_name,
          color: group.group_color
        });
        console.log(`Created AI-suggested group "${group.group_name}" for tab ${tab.id}`);
        return;
      }
    } catch (error) {
      console.error("Error using AI for group creation:", error);
      // Fall back to default group creation below
    }
    
    // Fallback to simple group creation
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    const groupName = getDefaultGroupNameFromTab(tab);
    const color = getDefaultColorFromTab(tab);
    
    await chrome.tabGroups.update(groupId, {
      title: groupName,
      color: color
    });
    
    console.log(`Created default group "${groupName}" for tab ${tab.id}`);
  } catch (error) {
    console.error("Error creating new group for tab:", error);
  }
}

function getDefaultGroupNameFromTab(tab) {
  let groupName = tab.title.split(' - ')[0].split(' | ')[0];
  if (groupName.length > 20) {
    groupName = groupName.substring(0, 20) + '...';
  }
  return groupName;
}

function getDefaultColorFromTab(tab) {
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
  try {
    const domain = new URL(tab.url).hostname;
    const colorIndex = Math.abs(hashCode(domain) % colors.length);
    return colors[colorIndex];
  } catch (e) {
    return 'grey'; // Default color if there's an error
  }
}

// Clean up the pending tabs map for tabs that are closed
function cleanupPendingTab(tabId) {
  if (pendingTabs.has(tabId)) {
    clearTimeout(pendingTabs.get(tabId).timeoutId);
    pendingTabs.delete(tabId);
  }
}

// ==========================================
// Event Listeners
// ==========================================
chrome.tabs.onActivated.addListener(focusTab);
chrome.tabGroups.onRemoved.addListener(removeGroup);
chrome.tabs.onCreated.addListener(handleNewTab);

// Sometimes the onCreated event doesn't have the URL yet, so we also listen for updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only handle tabs that just got a URL assigned
  if (changeInfo.url && tab.url.startsWith('http')) {
    // Check if this tab is not yet being tracked
    if (!pendingTabs.has(tabId)) {
      handleNewTab(tab);
    }
  }
});

chrome.tabs.onRemoved.addListener(cleanupPendingTab);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getGroupingSuggestions") {
    const { tabs, maxTabsPerGroup, customGroupingInstructions } = request;

    // Get the useAdvancedGrouping setting
    chrome.storage.sync.get(['useAdvancedGrouping'], (settings) => {
      // Choose handler based on setting or tab count
      const useAdvanced = settings.useAdvancedGrouping || tabs.length >= 30;
      const handler = useAdvanced ? handleLargeBatchTabGrouping : sendToGemini;

      console.log(`Handling grouping suggestions: ${tabs.length} tabs, using ${useAdvanced ? 'advanced' : 'standard'} mode`);

      handler(tabs, maxTabsPerGroup, customGroupingInstructions)
        .then(groupingSuggestions => {
          sendResponse({ groupingSuggestions });
        })
        .catch(error => {
          console.error("Error getting grouping suggestions:", error);
          sendResponse({ error: error.message });
        });
    });
    
    return true; // Keep the message channel open for the async response
  }
});
