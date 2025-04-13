document.addEventListener('DOMContentLoaded', () => {
    const closeOtherGroups = document.getElementById('closeOtherGroups');
    const maxTabsPerGroup = document.getElementById('maxTabsPerGroup');
    const customGroupingInstructions = document.getElementById('customGroupingInstructions');
    const backButton = document.getElementById('backButton');
    const onlyIncludeActiveTab = document.getElementById('onlyIncludeActiveTab');
    const includeGroupedTabs = document.getElementById('includeGroupedTabs');
    const currentWindowOnly = document.getElementById('currentWindowOnly');
    const includeFrozenTabs = document.getElementById('includeFrozenTabs');
    const geminiApiKey = document.getElementById('geminiApiKey');
    const useAdvancedGrouping = document.getElementById('useAdvancedGrouping');
    const autoGroupNewTabs = document.getElementById('autoGroupNewTabs');
    const excludePinnedTabs = document.getElementById('excludePinnedTabs'); // Pinned tabs exclusion option

    // Load saved settings
    chrome.storage.sync.get([
        'closeOtherGroups', 
        'maxTabsPerGroup', 
        'customGroupingInstructions',
        'onlyIncludeActiveTab',
        'includeGroupedTabs',
        'currentWindowOnly',
        'includeFrozenTabs',
        'geminiApiKey',
        'useAdvancedGrouping',
        'autoGroupNewTabs',
        'excludePinnedTabs' // Just keep pinned tabs exclusion
    ], (result) => {
        closeOtherGroups.checked = result.closeOtherGroups ?? true;
        maxTabsPerGroup.value = result.maxTabsPerGroup ?? 10;
        customGroupingInstructions.value = result.customGroupingInstructions ?? "";
        onlyIncludeActiveTab.checked = result.onlyIncludeActiveTab ?? false;
        includeGroupedTabs.checked = result.includeGroupedTabs ?? false;
        currentWindowOnly.checked = result.currentWindowOnly ?? true;
        includeFrozenTabs.checked = result.includeFrozenTabs ?? true;
        geminiApiKey.value = result.geminiApiKey ?? '';
        useAdvancedGrouping.checked = result.useAdvancedGrouping ?? false;
        autoGroupNewTabs.checked = result.autoGroupNewTabs ?? false;
        excludePinnedTabs.checked = result.excludePinnedTabs ?? true; // Default to true for pinned tabs exclusion
    });

    closeOtherGroups.addEventListener('change', () => {
        chrome.storage.sync.set({ closeOtherGroups: closeOtherGroups.checked });
    });

    maxTabsPerGroup.addEventListener('change', () => {
        chrome.storage.sync.set({ maxTabsPerGroup: parseInt(maxTabsPerGroup.value) });
    });

    customGroupingInstructions.addEventListener('change', () => {
        chrome.storage.sync.set({ customGroupingInstructions: customGroupingInstructions.value });
    });

    backButton.addEventListener('click', () => {
        window.history.back();
    });

    onlyIncludeActiveTab.addEventListener('change', () => {
        chrome.storage.sync.set({ onlyIncludeActiveTab: onlyIncludeActiveTab.checked });
    });

    includeGroupedTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ includeGroupedTabs: includeGroupedTabs.checked });
    });

    currentWindowOnly.addEventListener('change', () => {
        chrome.storage.sync.set({ currentWindowOnly: currentWindowOnly.checked });
    });

    includeFrozenTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ includeFrozenTabs: includeFrozenTabs.checked });
    });

    geminiApiKey.addEventListener('change', () => {
        chrome.storage.sync.set({ geminiApiKey: geminiApiKey.value });
    });

    useAdvancedGrouping.addEventListener('change', () => {
        chrome.storage.sync.set({ useAdvancedGrouping: useAdvancedGrouping.checked });
    });

    autoGroupNewTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ autoGroupNewTabs: autoGroupNewTabs.checked });
    });

    // Event listener for pinned tabs exclusion
    excludePinnedTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ excludePinnedTabs: excludePinnedTabs.checked });
    });
});
