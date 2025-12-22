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
// AI Provider Integration
// ==========================================
async function requestGroupingSuggestions(tabs, maxTabsPerGroup, customGroupingInstructions) {
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
  return await makeStructuredRequest(systemPrompt, userPrompt, response_format, validateGroupingSuggestions);
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
  const groupingSuggestions = await makeStructuredRequest(systemPrompt, userPrompt, response_format, validateGroupingSuggestions);
  console.log(groupingSuggestions);

  return convertTitlesToIndices(groupingSuggestions, tabs);
}

// ==========================================
// API Helper Functions
// ==========================================
function getDefaultModelForProvider(provider) {
  if (provider === 'openai') {
    return 'gpt-4o-mini';
  }
  if (provider === 'gemini') {
    return 'gemini-2.0-flash';
  }
  return '';
}

function normalizeModel(provider, model) {
  if (!model) {
    return getDefaultModelForProvider(provider);
  }
  if (provider === 'custom') {
    return model;
  }
  if (provider === 'gemini' && !model.startsWith('gemini-')) {
    return getDefaultModelForProvider(provider);
  }
  if (provider === 'openai' && model.startsWith('gemini-')) {
    return getDefaultModelForProvider(provider);
  }
  return model;
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    return '';
  }
  let normalized = baseUrl.trim();
  if (normalized.endsWith('/chat/completions')) {
    normalized = normalized.slice(0, -'/chat/completions'.length);
  }
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

async function getAIConfig() {
  const settings = await chrome.storage.sync.get([
    'aiProvider',
    'modelName',
    'openaiModelName',
    'geminiModelName',
    'customModelName',
    'apiKey',
    'geminiApiKey',
    'customApiBaseUrl'
  ]);
  const provider = settings.aiProvider === 'openai' || settings.aiProvider === 'custom'
    ? settings.aiProvider
    : 'gemini';
  const apiKey = (settings.apiKey || settings.geminiApiKey || '').trim();
  const modelFromProvider = provider === 'openai'
    ? settings.openaiModelName
    : provider === 'gemini'
      ? settings.geminiModelName
      : settings.customModelName;
  const model = normalizeModel(provider, modelFromProvider || settings.modelName);
  const baseUrl = provider === 'custom'
    ? normalizeBaseUrl(settings.customApiBaseUrl)
    : 'https://api.openai.com/v1';
  return { provider, apiKey, model, baseUrl };
}

async function makeStructuredRequest(systemPrompt, userPrompt, responseSchema, validate, maxRetries = 3) {
  const config = await getAIConfig();

  if (!config.apiKey) {
    throw new Error(`Missing API key for ${config.provider}. Add one in Settings.`);
  }
  if (!config.model) {
    throw new Error(`Missing model for ${config.provider}. Add one in Settings.`);
  }
  if (config.provider === 'custom' && !config.baseUrl) {
    throw new Error('Missing API base URL for custom provider. Add one in Settings.');
  }

  let attempts = 0;
  let lastError = null;

  while (attempts < maxRetries) {
    try {
      const result = config.provider === 'openai' || config.provider === 'custom'
        ? await requestOpenAI(config, systemPrompt, userPrompt)
        : await requestGemini(config, systemPrompt, userPrompt, responseSchema);

      if (!validate || validate(result)) {
        return result;
      }

      lastError = new Error('Invalid response format from provider');
    } catch (error) {
      console.error(`Error on attempt ${attempts + 1}:`, error);
      lastError = error;
    }

    attempts++;
    if (attempts < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
    }
  }

  throw lastError || new Error('Failed to get valid response after multiple attempts');
}

async function requestGemini(config, systemPrompt, userPrompt, responseSchema) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`, {
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
        response_schema: responseSchema
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error('Empty response from Gemini');
  }
  return JSON.parse(content);
}

async function requestOpenAI(config, systemPrompt, userPrompt) {
  const endpoint = `${config.baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }
  return JSON.parse(content);
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
const regroupingTabs = new Set(); // Track tabs currently being regrouped to prevent duplicate operations

async function handleNewTab(tab) {
  // Debug log
  console.log('New tab created:', tab);

  // Make sure we have all required properties
  if (!tab || !tab.id) {
    console.log('Invalid tab object');
    return;
  }

  const settings = await chrome.storage.sync.get(['autoGroupNewTabs']);
  if (!settings.autoGroupNewTabs) {
    console.log('Auto-grouping disabled');
    return;
  }

  if (pendingTabs.has(tab.id)) {
    return;
  }

  pendingTabs.set(tab.id, {
    timestamp: Date.now(),
    timeoutId: setTimeout(() => autoGroupTab(tab.id), 15000) // Fallback if load never completes
  });

  console.log(`Tab ${tab.id} scheduled for auto-grouping after load`);
}

async function autoGroupTab(tabId) {
  try {
    // Check if the tab still exists and is still pending
    if (!pendingTabs.has(tabId)) return;
    
    const pendingTab = pendingTabs.get(tabId);
    clearTimeout(pendingTab.timeoutId);
    pendingTabs.delete(tabId);
    
    const settings = await chrome.storage.sync.get([
      'autoGroupNewTabs',
      'excludePinnedTabs'
    ]);

    if (!settings.autoGroupNewTabs) {
      console.log('Auto-grouping disabled');
      return;
    }

    // Get the updated tab info
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== -1) return; // Already grouped
    if (!tab.url || !tab.url.startsWith('http')) return;
    if (settings.excludePinnedTabs && tab.pinned) return;
    
    // Get all existing groups in the current window
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    if (groups.length === 0) {
      // No existing groups, create a new one
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

    // Step 1: decide whether to reuse an existing group or create a new one
    const choice = await getGroupingChoiceFromLLM(newTab, existingGroups);
    console.log("Group choice:", choice);

    if (choice.create_new_group) {
      // Step 2: get a new group name/color from the LLM
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

    // Step 2: choose the target existing group from the LLM
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
      // Fallback to creating a new group
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
    // Fallback to creating a new group
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

async function getGroupingChoiceFromLLM(newTab, existingGroups) {
  const settings = await chrome.storage.sync.get(['customGroupingInstructions']);

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
  const systemPrompt = `You are a browser tab organization assistant that decides whether a newly opened tab should join an existing group or create a new group.
  Only decide between the two options based on the new tab info and existing group names/colors.
  Respond with JSON:
  {
    "create_new_group": boolean,
    "reasoning": string
  }
  ${settings.customGroupingInstructions ? `Consider these custom user instructions: ${settings.customGroupingInstructions}` : ""}`;

  const userPrompt = `New tab: 
  ${JSON.stringify(newTabInfo, null, 2)}
  
  Existing groups:
  ${JSON.stringify(existingGroupsInfo, null, 2)}`;

  const response_format = {
    type: "OBJECT",
    properties: {
      create_new_group: { type: "BOOLEAN" },
      reasoning: { type: "STRING" }
    },
    required: ["create_new_group", "reasoning"]
  };

  try {
    const result = await makeStructuredRequest(
      systemPrompt,
      userPrompt,
      response_format,
      (payload) => {
        if (!payload || typeof payload.create_new_group !== 'boolean') {
          return false;
        }
        return typeof payload.reasoning === 'string';
      }
    );

    return result;
  } catch (error) {
    console.error("Error getting group choice from LLM:", error);
    return {
      create_new_group: true,
      reasoning: "Error occurred during analysis, defaulting to new group"
    };
  }
}

async function getGroupDecisionFromLLM(newTab, existingGroups) {
  try {
    const choice = await getGroupingChoiceFromLLM(newTab, existingGroups);
    if (choice.create_new_group) {
      const details = await getNewGroupDetailsFromLLM(newTab);
      return {
        create_new_group: true,
        reasoning: choice.reasoning,
        target_group_id: null,
        suggested_name: details.suggested_name,
        suggested_color: details.suggested_color
      };
    }

    const target = await getTargetGroupFromLLM(newTab, existingGroups);
    return {
      create_new_group: false,
      reasoning: target.reasoning,
      target_group_id: target.target_group_id,
      suggested_name: '',
      suggested_color: 'grey'
    };
  } catch (error) {
    console.error("Error getting group decision from LLM:", error);
    return {
      create_new_group: true,
      reasoning: "Error occurred during analysis, defaulting to new group",
      target_group_id: null,
      suggested_name: getDefaultGroupNameFromTab(newTab),
      suggested_color: getDefaultColorFromTab(newTab)
    };
  }
}

async function getTargetGroupFromLLM(newTab, existingGroups) {
  const settings = await chrome.storage.sync.get(['customGroupingInstructions']);

  const existingGroupsInfo = existingGroups.map(group => ({
    id: group.id,
    name: group.title,
    color: group.color
  }));

  const newTabInfo = {
    title: newTab.title,
    url: newTab.url
  };

  const systemPrompt = `You are a browser tab organization assistant.
  Choose the best existing group for the new tab and return its ID.
  Respond with JSON:
  {
    "target_group_id": number,
    "reasoning": string
  }
  ${settings.customGroupingInstructions ? `Consider these custom user instructions: ${settings.customGroupingInstructions}` : ""}`;

  const userPrompt = `New tab:
  ${JSON.stringify(newTabInfo, null, 2)}

  Existing groups:
  ${JSON.stringify(existingGroupsInfo, null, 2)}`;

  const response_format = {
    type: "OBJECT",
    properties: {
      target_group_id: { type: "NUMBER" },
      reasoning: { type: "STRING" }
    },
    required: ["target_group_id", "reasoning"]
  };

  const validGroupIds = new Set(existingGroups.map(group => group.id));

  const result = await makeStructuredRequest(
    systemPrompt,
    userPrompt,
    response_format,
    (payload) => {
      if (!payload || typeof payload.target_group_id !== 'number') {
        return false;
      }
      return validGroupIds.has(payload.target_group_id);
    }
  );

  return result;
}

async function getNewGroupDetailsFromLLM(newTab) {
  const settings = await chrome.storage.sync.get(['customGroupingInstructions']);

  const newTabInfo = {
    title: newTab.title,
    url: newTab.url
  };

  const systemPrompt = `You are a browser tab organization assistant.
  Propose a concise group name (<= 20 characters) and a group color for the new tab.
  Add an emoji to the group name for readability when it makes sense.
  Colors must be one of: grey, blue, red, yellow, green, pink, purple, cyan.
  Respond with JSON:
  {
    "suggested_name": string,
    "suggested_color": string,
    "reasoning": string
  }
  ${settings.customGroupingInstructions ? `Consider these custom user instructions: ${settings.customGroupingInstructions}` : ""}`;

  const userPrompt = `New tab:
  ${JSON.stringify(newTabInfo, null, 2)}`;

  const response_format = {
    type: "OBJECT",
    properties: {
      suggested_name: { type: "STRING" },
      suggested_color: { type: "STRING" },
      reasoning: { type: "STRING" }
    },
    required: ["suggested_name", "suggested_color", "reasoning"]
  };

  const allowedColors = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan']);

  const result = await makeStructuredRequest(
    systemPrompt,
    userPrompt,
    response_format,
    (payload) => {
      if (!payload || typeof payload.suggested_name !== 'string') {
        return false;
      }
      if (typeof payload.suggested_color !== 'string') {
        return false;
      }
      return allowedColors.has(payload.suggested_color);
    }
  );

  return result;
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
      return { groupId, title: suggestedName, color: suggestedColor };
    }
    
    // Otherwise, use the LLM grouping for better suggestions
    try {
      // Use the existing grouping suggestions with a single tab
      const settings = await chrome.storage.sync.get(['maxTabsPerGroup', 'customGroupingInstructions']);
      const maxTabsPerGroup = settings.maxTabsPerGroup ?? 10;
      const customGroupingInstructions = settings.customGroupingInstructions ?? "";
      
      const suggestions = await requestGroupingSuggestions([tab], maxTabsPerGroup, customGroupingInstructions);
      
      if (suggestions.groups && suggestions.groups.length > 0) {
        // Create the group with the suggested name and color
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
    return { groupId, title: groupName, color: color };
  } catch (error) {
    console.error("Error creating new group for tab:", error);
  }
  return null;
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
  // Also clean up regrouping set
  regroupingTabs.delete(tabId);
}

// ==========================================
// Tab Regrouping for Existing Tabs
// ==========================================
/**
 * Regroups an existing tab when its URL changes.
 * This function evaluates if a grouped tab still belongs in its current group
 * after navigating to new content, and moves it to a more appropriate group if needed.
 * 
 * @param {Object} tab - The tab object from Chrome tabs API
 */
async function regroupExistingTab(tab) {
  try {
    // Prevent duplicate regrouping operations for the same tab
    if (regroupingTabs.has(tab.id)) {
      console.log(`Tab ${tab.id} already being regrouped, skipping`);
      return;
    }
    
    regroupingTabs.add(tab.id);
    console.log(`Regrouping tab ${tab.id} due to URL change:`, tab.url);
    
    // Check if regrouping is enabled
    const settings = await chrome.storage.sync.get([
      'autoRegroupTabs',
      'excludePinnedTabs'
    ]);
    
    if (!settings.autoRegroupTabs) {
      console.log('Auto-regrouping disabled');
      return;
    }
    
    // Skip pinned tabs if setting is enabled
    if (settings.excludePinnedTabs && tab.pinned) {
      console.log(`Tab ${tab.id} skipped: Pinned tab is excluded by settings`);
      return;
    }
    
    // Skip non-HTTP tabs
    if (!tab.url || !tab.url.startsWith('http')) {
      console.log(`Tab ${tab.id} skipped: Not HTTP URL`);
      return;
    }
    
    // Get the current group of the tab
    const currentGroupId = tab.groupId;
    
    // Get all existing groups in the current window (excluding the current tab's group)
    const allGroups = await chrome.tabGroups.query({ windowId: tab.windowId });
    const otherGroups = allGroups.filter(group => group.id !== currentGroupId);
    
    // Temporarily ungroup the tab for evaluation
    await chrome.tabs.ungroup(tab.id);
    console.log(`Tab ${tab.id} temporarily ungrouped for re-evaluation`);
    
    // If there are no other groups, create a new group
    if (otherGroups.length === 0) {
      await createNewGroupForTab(tab);
      console.log(`Tab ${tab.id} moved to new group (no other groups available)`);
      return;
    }
    
    // Evaluate where this tab should go
    const decision = await getGroupDecisionFromLLM(tab, otherGroups);
    console.log("Regrouping decision:", decision);
    
    if (decision.create_new_group) {
      // Create a new group
      await createNewGroupForTab(tab, decision.suggested_name, decision.suggested_color);
      console.log(`Tab ${tab.id} moved to new group: ${decision.suggested_name}`);
    } else {
      // Move to existing group
      const targetGroupId = decision.target_group_id;
      try {
        await chrome.tabs.group({
          tabIds: [tab.id],
          groupId: targetGroupId
        });
        console.log(`Tab ${tab.id} moved to existing group ${targetGroupId}`);
      } catch (error) {
        console.error(`Error moving tab to group ${targetGroupId}:`, error);
        // Fallback: try to move back to original group or create new one
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
    // Always remove from regrouping set when done
    regroupingTabs.delete(tab.id);
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
  // Handle URL changes for both new and existing tabs
  if (changeInfo.url && tab.url.startsWith('http')) {
    // Check if this tab is not yet being tracked (new tab)
    if (!pendingTabs.has(tabId) && tab.groupId === -1) {
      handleNewTab(tab);
    }
  }

  if (changeInfo.status === 'complete' && pendingTabs.has(tabId)) {
    autoGroupTab(tabId);
    return;
  }

  if (changeInfo.url && tab.url.startsWith('http') && tab.groupId !== -1) {
    // This is an existing grouped tab that changed URL - consider regrouping
    // Add a delay to allow the page to fully load and avoid regrouping during redirects
    setTimeout(() => {
      // Get the updated tab state before regrouping
      chrome.tabs.get(tabId).then(updatedTab => {
        // Only regroup if the tab is still grouped and URL is stable
        if (updatedTab.groupId !== -1 && updatedTab.url === tab.url) {
          regroupExistingTab(updatedTab);
        }
      }).catch(error => {
        // Tab might have been closed
        console.log(`Tab ${tabId} no longer exists for regrouping`);
      });
    }, 3000); // 3 second delay to allow page content to load and avoid redirects
  }
});

chrome.tabs.onRemoved.addListener(cleanupPendingTab);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getGroupingSuggestions") {
    const { tabs, maxTabsPerGroup, customGroupingInstructions } = request;

    // Get settings and filter out pinned tabs if needed
    chrome.storage.sync.get(['useAdvancedGrouping', 'excludePinnedTabs'], async (settings) => {
      let filteredTabs = [...tabs];
      
      // Filter out pinned tabs if the setting is enabled
      if (settings.excludePinnedTabs) {
        filteredTabs = filteredTabs.filter(tab => !tab.pinned);
        console.log(`Filtered out pinned tabs, ${tabs.length - filteredTabs.length} tabs excluded`);
      }

      // Choose handler based on setting or tab count
      const useAdvanced = settings.useAdvancedGrouping || filteredTabs.length >= 30;
      const handler = useAdvanced ? handleLargeBatchTabGrouping : requestGroupingSuggestions;

      console.log(`Handling grouping suggestions: ${filteredTabs.length} tabs, using ${useAdvanced ? 'advanced' : 'standard'} mode`);

      try {
        const groupingSuggestions = await handler(filteredTabs, maxTabsPerGroup, customGroupingInstructions);
        sendResponse({ groupingSuggestions });
      } catch (error) {
        console.error("Error getting grouping suggestions:", error);
        sendResponse({ error: error.message });
      }
    });
    
    return true; // Keep the message channel open for the async response
  }

  if (request.action === "undoAutoGroup") {
    chrome.storage.sync.get(['lastAutoGroupAction'], async (result) => {
      const action = result.lastAutoGroupAction;
      if (!action) {
        sendResponse({ ok: false, error: 'No recent auto-grouping to undo.' });
        return;
      }

      try {
        const tab = await chrome.tabs.get(action.tabId);
        if (action.toGroupId === -1) {
          sendResponse({ ok: false, error: 'Nothing to undo for that action.' });
          return;
        }

        if (tab.groupId !== action.toGroupId) {
          sendResponse({ ok: false, error: 'Tab was moved since the auto-grouping.' });
          return;
        }

        if (action.fromGroupId && action.fromGroupId !== -1) {
          await chrome.tabs.group({
            tabIds: [tab.id],
            groupId: action.fromGroupId
          });
        } else if (tab.groupId !== -1) {
          await chrome.tabs.ungroup(tab.id);
        }

        chrome.storage.sync.remove('lastAutoGroupAction');
        sendResponse({ ok: true });
      } catch (error) {
        console.error('Undo auto-group failed:', error);
        sendResponse({ ok: false, error: 'Undo failed. The tab might be closed.' });
      }
    });
    return true;
  }
});

async function storeLastAutoGroupAction(action) {
  try {
    await chrome.storage.sync.set({ lastAutoGroupAction: action });
  } catch (error) {
    console.error('Failed to store last auto-group action:', error);
  }
}
