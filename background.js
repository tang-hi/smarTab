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
async function makeGeminiRequest(tabsInfo, systemPrompt, userPrompt, response_schema) {
  console.log("userPrompt:", userPrompt);

  const settings = await chrome.storage.sync.get(['geminiApiKey']);
  const useCustomApi = settings.geminiApiKey && settings.geminiApiKey.trim() !== '';

  if (useCustomApi) {
    return await makeDirectGeminiRequest(tabsInfo, systemPrompt, userPrompt, response_schema, settings.geminiApiKey);
  } else {
    return await makeProxyGeminiRequest(tabsInfo, systemPrompt, userPrompt);
  }
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
// Event Listeners
// ==========================================
chrome.tabs.onActivated.addListener(focusTab);
chrome.tabGroups.onRemoved.addListener(removeGroup);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getGroupingSuggestions") {
    const { tabs, maxTabsPerGroup, customGroupingInstructions } = request;
    const handler = tabs.length >= 30 ? handleLargeBatchTabGrouping : sendToGemini;
    console.log('Handling grouping suggestions:', tabs.length);
    if (tabs.length >= 30) {
      console.log('Handling large batch tab grouping');
    }

    handler(tabs, maxTabsPerGroup, customGroupingInstructions)
      .then(groupingSuggestions => {
        sendResponse({ groupingSuggestions });
      })
      .catch(error => {
        console.error("Error getting grouping suggestions:", error);
        sendResponse({ error: error.message });
      });
    return true;
  }
});
