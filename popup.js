console.log('Popup script loaded');

async function sendToQwen(tabs) {
    const QWEN_API_KEY = "sk-91b1102e7abf4d098584c27a730778ff";
    
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
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${QWEN_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "qwen-turbo-latest",
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

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}

async function sendToGemini(tabs) {
    const GOOGLE_API_KEY = "AIzaSyA1ovqK63c-9ykXeeU_JF7vOc7y_Anj6o8";

    const tabsInfo = tabs.map(tab => (
        {
            title: tab.title,
            url: tab.url
        }
    ));
    const prompt = `Analyze these browser tabs and suggest logical groupings:
    Tabs: ${JSON.stringify(tabsInfo, null, 2)}
    
    Group these tabs using this JSON schema:
    {
        "groups": [
            {
                "group_name": string,
                "group_color": string, // one of: grey, blue, red, yellow, green, pink, purple, cyan
                "tab_indices": number[], // indices of tabs that belong to this group
                "reasoning": string
            }
        ]
    }
    
    Consider common themes, domains, purposes, and content types when grouping.
    Return only valid JSON.`;
    console.log(prompt);
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    response_mime_type: "application/json"
                }
            })
        }
    );

    const data = await response.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
}

async function removeExistingGroups() {
    try {
        // Get all tabs
        const tabs = await chrome.tabs.query({});
        
        // Get unique group IDs
        const groupIds = [...new Set(tabs
            .map(tab => tab.groupId)
            .filter(id => id !== -1))]; // Filter out ungrouped tabs
        
        // Ungroup all tabs in each group
        for (const groupId of groupIds) {
            const groupTabs = await chrome.tabs.query({ groupId });
            await chrome.tabs.ungroup(groupTabs.map(tab => tab.id));
        }
    } catch (error) {
        console.error('Error removing existing groups:', error);
    }
}


async function createTabGroups(tabs, groupingSuggestions) {
    // Get the active tab
    const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = activeTab[0]?.id;

    for (const group of groupingSuggestions.groups) {
        const tabIndices = group.tab_indices;
        // Qwen may return the array of tab indices in string format
        // [1,2,3] -> '[1,2,3]'
        if (typeof tabIndices === 'string') {
            tabIndices = JSON.parse(tabIndices);
        }
        const tabIds = tabIndices.map(index => tabs[index].id);
        const newGroup = await chrome.tabs.group({ tabIds });

        // Check if active tab is in this group
        const isActiveTabInGroup = tabIds.includes(activeTabId);

        await chrome.tabGroups.update(newGroup, {
            title: group.group_name,
            color: group.group_color,
            collapsed: !isActiveTabInGroup // Collapse if active tab is not in this group
        });
    }
}

async function getTabs() {
    const tabs = await chrome.tabs.query({});
    console.log(tabs);
    const collator = new Intl.Collator();

    tabs.sort((a, b) => collator.compare(a.title, b.title));

    const groupButton = document.getElementById('groupButton');
    groupButton.onclick = async () => {
        try {
            groupButton.classList.add('loading');
            await removeExistingGroups();
            const groupingSuggestions = await sendToGemini(tabs);
            console.log("LLM Suggestions:", groupingSuggestions);
            await createTabGroups(tabs, groupingSuggestions);

        } catch (error) {
            console.error('Error grouping tabs:', error);
        } finally {
            groupButton.classList.remove('loading');
        }
    };

    return tabs;
}

/**
 * curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$GOOGLE_API_KEY" \
-H 'Content-Type: application/json' \
-d '{
    "contents": [{
      "parts":[
        {"text": "List a few popular cookie recipes using this JSON schema:

            Recipe = {\"recipe_name\": str}
            Return: list[Recipe]"
        }
      ]
    }],
    "generationConfig": { "response_mime_type": "application/json" }
}' 2> /dev/null | head
 */

getTabs().catch(console.error);
// const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
// console.log(tabs);
// if (tabs.length === 0) return;

// const currentTab = tabs[0];
// const { title, url } = currentTab;

// // Function to send data to the large language model
// async function sendToModel(title, url) {
//   const response = await fetch('https://api.example.com/reorganize', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify({ title, url }),
//   });
//   return response.json();
// }

// // Function to group tabs based on the model's response
// async function groupTabs(groupTitle) {
//   const tabIds = [currentTab.id];
//   const group = await chrome.tabs.group({ tabIds });
//   await chrome.tabGroups.update(group, { title: groupTitle });
// }

// // Main logic
// const modelResponse = await sendToModel(title, url);
// if (modelResponse && modelResponse.groupTitle) {
//   await groupTabs(modelResponse.groupTitle);
// }