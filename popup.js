console.log('Popup script loaded');

async function getTabs() {
    const tabs = await chrome.tabs.query({});
    console.log(tabs);
    const collator = new Intl.Collator();

    tabs.sort((a, b) => collator.compare(a.title, b.title));

    const groups = await chrome.tabGroups.query({});

    // set group Number and Tab Number
    const tabCount = document.getElementById('tabCount');
    tabCount.innerText = tabs.length;
    const groupCount = document.getElementById('groupCount');
    groupCount.innerText = groups.length;

    const groupButton = document.getElementById('groupButton');
    groupButton.onclick = async () => {
        try {
            groupButton.classList.add('loading');
            await removeExistingGroups();

            chrome.storage.sync.get(['maxTabsPerGroup', 'customGroupingInstructions'], (result) => {
                const maxTabsPerGroup = result.maxTabsPerGroup ?? 10;
                const customGroupingInstructions = result.customGroupingInstructions ?? "";

                // Send message to background script to get grouping suggestions
                chrome.runtime.sendMessage({
                    action: "getGroupingSuggestions",
                    tabs: tabs,
                    maxTabsPerGroup: maxTabsPerGroup,
                    customGroupingInstructions: customGroupingInstructions
                },
                    function (response) {
                        if (response && response.groupingSuggestions) {
                            console.log("LLM Suggestions:", response.groupingSuggestions);
                            createTabGroups(tabs, response.groupingSuggestions);
                        } else {
                            console.error("Error getting grouping suggestions from background script");
                        }
                        groupButton.classList.remove('loading');
                    });
            });


        } catch (error) {
            console.error('Error grouping tabs:', error);
            groupButton.classList.remove('loading');
        }
    };

    return tabs;
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
        const tabIds = tabIndices.map(index => {
            const tab = tabs[index];
            return tab ? tab.id : null;
        }).filter(id => id !== null);
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

getTabs().catch(console.error);