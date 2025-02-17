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

async function sendToQwen(tabs) {
  const QWEN_API_KEY = "49927165df154e8673c3c78b1a7fc768";

  const tabsInfo = tabs.map(tab => ({
    title: tab.title,
    url: tab.url
  }));

  const systemPrompt = `你是一个浏览器标签页分组助手。你的任务是分析用户的标签页并提供合理的分组建议。

示例输出格式：
{
    "groups": [
        {
            "group_name": "工作文档",
            "group_color": "blue",
            "tab_indices": [0, 1, 2],
        },
        {
            "group_name": "社交媒体",
            "group_color": "pink",
            "tab_indices": [3, 4],
        }
    ]
}

示例输出Schema:
{
    "groups": [
        {
            "group_name": string,
            "group_color": string, // one of: grey, blue, red, yellow, green, pink, purple, cyan
            "tab_indices": number[], // indices of tabs that belong to this group
        }
    ]
}

注意事项：
1. group_color 必须是以下选项之一: grey, blue, red, yellow, green, pink, purple, cyan
2. group_name 应该简短有意义
3. tab_indices 必须是有效的标签页索引
4. 响应必须是有效的JSON格式
`;

  const userPrompt = `请分析以下浏览器标签页并建议合理的分组：
标签页: ${JSON.stringify(tabsInfo, null, 2)}`;

  const response = await fetch(
    'https://idealab.alibaba-inc.com/api/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${QWEN_API_KEY}`,
        'Content-Type': 'text/plain'
      },
      credentials: 'include',
      body: JSON.stringify({
        model: "qwen2-72b-instruct",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        response_format: { type: "json_object" }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function sendToGemini(tabs, maxTabsPerGroup, customGroupingInstructions) {
  const GEMINI_KEY = "sk-Tn1eMplji0QTTg8H5055184a947c4eB4829c15Fb7092A42b";

  const tabsInfo = tabs.map(tab => (
    {
      title: tab.title,
      url: tab.url
    }
  ));
  const systemPrompt = `你是一个浏览器标签页分组助手。你的任务是分析用户的标签页并提供合理的分组建议。

  示例输出格式：
  {
      "groups": [
          {
              "group_name": "工作文档",
              "group_color": "blue",
              "tab_indices": [0, 1, 2],
          },
          {
              "group_name": "社交媒体",
              "group_color": "pink",
              "tab_indices": [3, 4],
          }
      ]
  }
  
  示例输出Schema:
  {
      "groups": [
          {
              "group_name": string,
              "group_color": string, // one of: grey, blue, red, yellow, green, pink, purple, cyan
              "tab_indices": number[], // indices of tabs that belong to this group
          }
      ]
  }
  
  注意事项：
  1. group_color 必须是以下选项之一: grey, blue, red, yellow, green, pink, purple, cyan
  2. group_name 应该简短有意义
  3. tab_indices 必须是有效的标签页索引
  4. 响应必须是有效的JSON格式
  5. 每个组最多包含 ${maxTabsPerGroup} 个标签页
  ${customGroupingInstructions ? `6. 遵循以下自定义分组说明: ${customGroupingInstructions}` : ""}
  `;

  const userPrompt = `请分析以下浏览器标签页并建议合理的分组：
  标签页: ${JSON.stringify(tabsInfo, null, 2)}

  注意事项：
  每个组最多包含 ${maxTabsPerGroup} 个标签页
  ${customGroupingInstructions ? `遵循以下自定义分组说明: ${customGroupingInstructions}` : ""}`;
  const response = await fetch(
    'https://aihubmix.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GEMINI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "gemini-2.0-flash-exp",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        response_format: { type: "json_object" }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}


// Add tab activation listener
chrome.tabs.onActivated.addListener(focusTab);

// Add group removal listener
chrome.tabGroups.onRemoved.addListener(removeGroup);

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(
  function (request, sender, sendResponse) {
    if (request.action === "getGroupingSuggestions") {
      const tabs = request.tabs;
      const maxTabsPerGroup = request.maxTabsPerGroup;
      const customGroupingInstructions = request.customGroupingInstructions;
      sendToGemini(tabs, maxTabsPerGroup, customGroupingInstructions)
        .then(groupingSuggestions => {
          sendResponse({ groupingSuggestions: groupingSuggestions });
        })
        .catch(error => {
          console.error("Error getting grouping suggestions:", error);
          sendResponse({ error: error.message });
        });
      return true;  // Indicate that the response will be sent asynchronously
    }
  }
);