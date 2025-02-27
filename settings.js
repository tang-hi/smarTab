document.addEventListener('DOMContentLoaded', () => {
    const closeOtherGroups = document.getElementById('closeOtherGroups');
    const maxTabsPerGroup = document.getElementById('maxTabsPerGroup');
    const customGroupingInstructions = document.getElementById('customGroupingInstructions');
    const backButton = document.getElementById('backButton');
    const onlyIncludeActiveTab = document.getElementById('onlyIncludeActiveTab'); // Changed from includeActiveTab
    const includeGroupedTabs = document.getElementById('includeGroupedTabs');
    const currentWindowOnly = document.getElementById('currentWindowOnly');
    const includeFrozenTabs = document.getElementById('includeFrozenTabs');
    const geminiApiKey = document.getElementById('geminiApiKey');

    // Load saved settings
    chrome.storage.sync.get([
        'closeOtherGroups', 
        'maxTabsPerGroup', 
        'customGroupingInstructions',
        'onlyIncludeActiveTab', // Changed from includeActiveTab
        'includeGroupedTabs',
        'currentWindowOnly',
        'includeFrozenTabs',
        'geminiApiKey'
    ], (result) => {
        closeOtherGroups.checked = result.closeOtherGroups ?? true;
        maxTabsPerGroup.value = result.maxTabsPerGroup ?? 10;
        customGroupingInstructions.value = result.customGroupingInstructions ?? "";
        onlyIncludeActiveTab.checked = result.onlyIncludeActiveTab ?? false; // Changed from includeActiveTab
        includeGroupedTabs.checked = result.includeGroupedTabs ?? false;
        currentWindowOnly.checked = result.currentWindowOnly ?? true;
        includeFrozenTabs.checked = result.includeFrozenTabs ?? true;
        geminiApiKey.value = result.geminiApiKey ?? '';
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
        chrome.storage.sync.set({ onlyIncludeActiveTab: onlyIncludeActiveTab.checked }); // Changed from includeActiveTab
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
});
