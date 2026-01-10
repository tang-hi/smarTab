// ==========================================
// AI Provider Integration & Grouping Decision
// ==========================================
import {
  DEFAULTS,
  ALLOWED_COLORS,
  AI_MODELS,
  levenshteinDistance,
  validateGroupingSuggestions,
  extractTabInfo,
  getConfig
} from './config.js';

// ==========================================
// API Configuration Helpers
// ==========================================
function getDefaultModelForProvider(provider) {
  if (provider === 'openai') return AI_MODELS.openai.default;
  if (provider === 'gemini') return AI_MODELS.gemini.default;
  if (provider === 'doubao') return AI_MODELS.doubao.default;
  return '';
}

function normalizeModel(provider, model) {
  if (!model) return getDefaultModelForProvider(provider);
  if (provider === 'custom') return model;
  if (provider === 'gemini' && !model.startsWith('gemini-')) {
    return getDefaultModelForProvider(provider);
  }
  if (provider === 'openai' && model.startsWith('gemini-')) {
    return getDefaultModelForProvider(provider);
  }
  if (provider === 'doubao' && !model.startsWith('doubao-')) {
    return getDefaultModelForProvider(provider);
  }
  return model;
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  let normalized = baseUrl.trim();
  if (normalized.endsWith('/chat/completions')) {
    normalized = normalized.slice(0, -'/chat/completions'.length);
  }
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export async function getAIConfig() {
  const settings = await getConfig([
    'aiProvider',
    'modelName',
    'openaiModelName',
    'geminiModelName',
    'doubaoModelName',
    'customModelName',
    'apiKey',
    'geminiApiKey',
    'customApiBaseUrl'
  ]);

  const provider = settings.aiProvider === 'openai' || settings.aiProvider === 'custom' || settings.aiProvider === 'doubao'
    ? settings.aiProvider
    : 'gemini';

  const apiKey = (settings.apiKey || settings.geminiApiKey || '').trim();

  const modelFromProvider = provider === 'openai'
    ? settings.openaiModelName
    : provider === 'gemini'
      ? settings.geminiModelName
      : provider === 'doubao'
        ? settings.doubaoModelName
        : settings.customModelName;

  const model = normalizeModel(provider, modelFromProvider || settings.modelName);

  const baseUrl = provider === 'custom'
    ? normalizeBaseUrl(settings.customApiBaseUrl)
    : provider === 'doubao'
      ? AI_MODELS.doubao.baseUrl
      : AI_MODELS.openai.baseUrl;

  return { provider, apiKey, model, baseUrl };
}

// ==========================================
// API Request Functions
// ==========================================
async function requestGemini(config, systemPrompt, userPrompt, responseSchema) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + '\n' + userPrompt }] }],
        generationConfig: {
          response_mime_type: "application/json",
          response_schema: responseSchema
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Empty response from Gemini');
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
  if (!content) throw new Error('Empty response from OpenAI');
  return JSON.parse(content);
}

export async function makeStructuredRequest(systemPrompt, userPrompt, responseSchema, validate, maxRetries = 3) {
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
      const result = config.provider === 'openai' || config.provider === 'custom' || config.provider === 'doubao'
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
      await new Promise(resolve => setTimeout(resolve, DEFAULTS.delays.apiRetryBackoff * attempts));
    }
  }

  throw lastError || new Error('Failed to get valid response after multiple attempts');
}

// ==========================================
// Two-Stage Tab Grouping (New Design)
// ==========================================

/**
 * Stage 1: Tab Understanding
 * Analyzes each tab to understand its content and user intent
 */
export async function analyzeTabsUnderstanding(tabs) {
  const tabsInfo = extractTabInfo(tabs);

  const systemPrompt = `Analyze browser tabs. For each tab provide:
- description: what the page is (brief)
- intent: user's goal/task
- keywords: 2-4 for grouping

Output: {"tabs": [{"index":0,"description":"...","intent":"...","keywords":["..."]}]}`;

  const userPrompt = JSON.stringify(tabsInfo);

  const response_format = {
    type: "OBJECT",
    properties: {
      tabs: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            index: { type: "NUMBER" },
            description: { type: "STRING" },
            intent: { type: "STRING" },
            keywords: { type: "ARRAY", items: { type: "STRING" } }
          },
          required: ["index", "description", "intent", "keywords"]
        }
      }
    }
  };

  return await makeStructuredRequest(
    systemPrompt,
    userPrompt,
    response_format,
    (result) => Array.isArray(result?.tabs) && result.tabs.length > 0
  );
}

/**
 * Stage 2: Smart Grouping
 * Uses tab understanding to create intelligent groups
 */
export async function createSmartGroups(tabs, tabUnderstanding, customGroupingInstructions) {
  const tabsInfo = extractTabInfo(tabs);

  const systemPrompt = `Group browser tabs by task/intent first, then domain/category.

Priority: task > domain > other.
- Don't force connections or create single-tab groups
- Group names: short with emoji (🔧 Fix Bug, GitHub)
- Colors: blue(work/dev), green(learning), yellow(todo), red(urgent), pink(fun/social), purple(creative), cyan(tools), grey(other)

Output: {"groups": [{"group_name":"...","group_color":"blue","tab_indices":[0,1],"reasoning":"..."}]}`;

  const userPrompt = JSON.stringify({
    tabs: tabsInfo,
    analysis: tabUnderstanding.tabs,
    custom: customGroupingInstructions || undefined
  });

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
            reasoning: { type: "STRING" }
          },
          required: ["group_name", "group_color", "tab_indices", "reasoning"]
        }
      }
    }
  };

  return await makeStructuredRequest(
    systemPrompt,
    userPrompt,
    response_format,
    validateGroupingSuggestions
  );
}

/**
 * Single-Request Fast Grouping
 * Direct grouping without two-stage analysis
 */
export async function requestTwoStageGrouping(tabs, customGroupingInstructions) {
  const tabsInfo = extractTabInfo(tabs);

  const systemPrompt = `Group browser tabs.

Rules:
- Group by task/intent > domain
- Don't create single-tab groups
- Names: short + emoji
- Colors: blue(work), green(learn), yellow(todo), red(urgent), pink(fun), purple(creative), cyan(tools), grey(other)
- IMPORTANT: Every tab must be in exactly one group. Don't miss any tabs.

Output: {"groups":[{"group_name":"...","group_color":"blue","tab_indices":[0,1],"reasoning":"..."}]}`;

  const userPrompt = JSON.stringify({
    total: tabs.length,
    tabs: tabsInfo.map((t, i) => ({ i, t: t.title, u: t.url })),
    custom: customGroupingInstructions || undefined
  });

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
            reasoning: { type: "STRING" }
          },
          required: ["group_name", "group_color", "tab_indices", "reasoning"]
        }
      }
    }
  };

  const groupingSuggestions = await makeStructuredRequest(
    systemPrompt,
    userPrompt,
    response_format,
    validateGroupingSuggestions
  );

  // Handle ungrouped tabs - add them to an "Other" group
  const groupedIndices = new Set();
  for (const group of groupingSuggestions.groups) {
    for (const idx of group.tab_indices) {
      groupedIndices.add(idx);
    }
  }

  const ungroupedIndices = [];
  for (let i = 0; i < tabs.length; i++) {
    if (!groupedIndices.has(i)) {
      ungroupedIndices.push(i);
    }
  }

  if (ungroupedIndices.length > 0) {
    groupingSuggestions.groups.push({
      group_name: "📌 Other",
      group_color: "grey",
      tab_indices: ungroupedIndices,
      reasoning: "Tabs that don't fit other groups"
    });
  }

  return groupingSuggestions;
}

// ==========================================
// Legacy Tab Grouping Suggestions (kept for compatibility)
// ==========================================
export async function requestGroupingSuggestions(tabs, maxTabsPerGroup, customGroupingInstructions) {
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
  };

  return await makeStructuredRequest(systemPrompt, userPrompt, response_format, validateGroupingSuggestions);
}

export async function handleLargeBatchTabGrouping(tabs, maxTabsPerGroup, customGroupingInstructions) {
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
  };

  const groupingSuggestions = await makeStructuredRequest(systemPrompt, userPrompt, response_format, validateGroupingSuggestions);
  console.log(groupingSuggestions);

  return convertTitlesToIndices(groupingSuggestions, tabs);
}

function convertTitlesToIndices(groupingSuggestions, tabs) {
  const titleToGroupIndex = {};

  for (const group of groupingSuggestions.groups) {
    const tabTitles = group.tab_titles;
    group.tab_indices = tabTitles.map(title => {
      let index = tabs.findIndex(tab => tab.title === title);
      if (index === -1) {
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

  const ungroupedTabs = tabs.filter((tab, i) =>
    !groupingSuggestions.groups.some(group => group.tab_indices.includes(i))
  );

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
// Auto-Grouping Decision Functions
// ==========================================
export async function getGroupingChoiceFromLLM(newTab, existingGroups) {
  const settings = await getConfig(['customGroupingInstructions']);

  const existingGroupsInfo = existingGroups.map(group => ({
    id: group.id,
    name: group.title,
    color: group.color
  }));

  const newTabInfo = {
    title: newTab.title,
    url: newTab.url
  };

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
    return await makeStructuredRequest(
      systemPrompt,
      userPrompt,
      response_format,
      (payload) => typeof payload?.create_new_group === 'boolean' && typeof payload?.reasoning === 'string'
    );
  } catch (error) {
    console.error("Error getting group choice from LLM:", error);
    return {
      create_new_group: true,
      reasoning: "Error occurred during analysis, defaulting to new group"
    };
  }
}

export async function getTargetGroupFromLLM(newTab, existingGroups) {
  const settings = await getConfig(['customGroupingInstructions']);

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

  return await makeStructuredRequest(
    systemPrompt,
    userPrompt,
    response_format,
    (payload) => typeof payload?.target_group_id === 'number' && validGroupIds.has(payload.target_group_id)
  );
}

export async function getNewGroupDetailsFromLLM(newTab) {
  const settings = await getConfig(['customGroupingInstructions']);

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

  const allowedColors = new Set(ALLOWED_COLORS);

  return await makeStructuredRequest(
    systemPrompt,
    userPrompt,
    response_format,
    (payload) => typeof payload?.suggested_name === 'string' && allowedColors.has(payload?.suggested_color)
  );
}

export async function getGroupDecisionFromLLM(newTab, existingGroups) {
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
      suggested_name: null,
      suggested_color: null
    };
  }
}
