document.addEventListener('DOMContentLoaded', () => {
    const closeOtherGroups = document.getElementById('closeOtherGroups');
    const maxTabsPerGroup = document.getElementById('maxTabsPerGroup');
    const customGroupingInstructions = document.getElementById('customGroupingInstructions');
    const backButton = document.getElementById('backButton');
    const onlyIncludeActiveTab = document.getElementById('onlyIncludeActiveTab');
    const includeGroupedTabs = document.getElementById('includeGroupedTabs');
    const currentWindowOnly = document.getElementById('currentWindowOnly');
    const includeFrozenTabs = document.getElementById('includeFrozenTabs');
    const apiKey = document.getElementById('apiKey');
    const aiProvider = document.getElementById('aiProvider');
    const modelNameSelect = document.getElementById('modelName');
    const modelNameCustom = document.getElementById('modelNameCustom');
    const modelHint = document.getElementById('modelHint');
    const customApiBaseUrl = document.getElementById('customApiBaseUrl');
    const customApiBaseUrlField = document.getElementById('customApiBaseUrlField');
    const useAdvancedGrouping = document.getElementById('useAdvancedGrouping');
    const autoGroupNewTabs = document.getElementById('autoGroupNewTabs');
    const autoRegroupTabs = document.getElementById('autoRegroupTabs');
    const excludePinnedTabs = document.getElementById('excludePinnedTabs'); // Pinned tabs exclusion option

    const MODEL_OPTIONS = {
        openai: [
            { value: 'gpt-4o-mini', label: 'GPT-4o mini (fast)' },
            { value: 'gpt-4o', label: 'GPT-4o (balanced)' }
        ],
        gemini: [
            { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
            { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
            { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
        ],
        custom: []
    };

    const DEFAULT_MODEL = {
        openai: 'gpt-4o-mini',
        gemini: 'gemini-2.0-flash',
        custom: ''
    };

    function updateModelOptions(provider, selectedModel) {
        modelNameSelect.innerHTML = '';
        const options = MODEL_OPTIONS[provider] || [];
        options.forEach(option => {
            const item = document.createElement('option');
            item.value = option.value;
            item.textContent = option.label;
            modelNameSelect.appendChild(item);
        });

        const nextModel = options.some(option => option.value === selectedModel)
            ? selectedModel
            : DEFAULT_MODEL[provider];

        modelNameSelect.value = nextModel;
        return nextModel;
    }

    function applyProviderUI(provider) {
        const isCustom = provider === 'custom';
        modelNameSelect.classList.toggle('is-hidden', isCustom);
        modelNameCustom.classList.toggle('is-hidden', !isCustom);
        customApiBaseUrlField.classList.toggle('is-hidden', !isCustom);
        modelHint.textContent = isCustom
            ? 'Use the exact model id from your provider.'
            : 'Choose a recommended model for this provider.';
    }

    let modelByProvider = {
        openai: DEFAULT_MODEL.openai,
        gemini: DEFAULT_MODEL.gemini,
        custom: ''
    };

    // Load saved settings
    chrome.storage.sync.get([
        'closeOtherGroups',
        'maxTabsPerGroup',
        'customGroupingInstructions',
        'onlyIncludeActiveTab',
        'includeGroupedTabs',
        'currentWindowOnly',
        'includeFrozenTabs',
        'apiKey',
        'aiProvider',
        'modelName',
        'openaiModelName',
        'geminiModelName',
        'customModelName',
        'customApiBaseUrl',
        'geminiApiKey',
        'useAdvancedGrouping',
        'autoGroupNewTabs',
        'autoRegroupTabs',
        'excludePinnedTabs'
    ], (result) => {
        closeOtherGroups.checked = result.closeOtherGroups ?? true;
        maxTabsPerGroup.value = result.maxTabsPerGroup ?? 10;
        customGroupingInstructions.value = result.customGroupingInstructions ?? "";
        onlyIncludeActiveTab.checked = result.onlyIncludeActiveTab ?? false;
        includeGroupedTabs.checked = result.includeGroupedTabs ?? false;
        currentWindowOnly.checked = result.currentWindowOnly ?? true;
        includeFrozenTabs.checked = result.includeFrozenTabs ?? true;
        useAdvancedGrouping.checked = result.useAdvancedGrouping ?? false;
        autoGroupNewTabs.checked = result.autoGroupNewTabs ?? false;
        autoRegroupTabs.checked = result.autoRegroupTabs ?? false;
        excludePinnedTabs.checked = result.excludePinnedTabs ?? true;

        modelByProvider = {
            openai: result.openaiModelName ?? result.modelName ?? DEFAULT_MODEL.openai,
            gemini: result.geminiModelName ?? result.modelName ?? DEFAULT_MODEL.gemini,
            custom: result.customModelName ?? ''
        };

        const provider = result.aiProvider || 'gemini';
        aiProvider.value = provider;
        applyProviderUI(provider);

        if (provider === 'custom') {
            modelNameCustom.value = modelByProvider.custom;
        } else {
            const nextModel = updateModelOptions(provider, modelByProvider[provider]);
            modelByProvider[provider] = nextModel;
        }

        const legacyKey = result.geminiApiKey ?? '';
        apiKey.value = result.apiKey ?? legacyKey;
        customApiBaseUrl.value = result.customApiBaseUrl ?? '';

        if (!result.apiKey && legacyKey) {
            const nextModel = provider === 'custom' ? modelNameCustom.value.trim() : modelNameSelect.value;
            chrome.storage.sync.set({
                apiKey: legacyKey,
                aiProvider: provider,
                modelName: nextModel
            });
        }
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

    apiKey.addEventListener('change', () => {
        chrome.storage.sync.set({ apiKey: apiKey.value.trim() });
    });

    aiProvider.addEventListener('change', () => {
        const provider = aiProvider.value;
        applyProviderUI(provider);

        if (provider === 'custom') {
            modelNameCustom.value = modelByProvider.custom || '';
            chrome.storage.sync.set({ aiProvider: provider });
            return;
        }

        const nextModel = updateModelOptions(provider, modelByProvider[provider]);
        modelByProvider[provider] = nextModel;
        chrome.storage.sync.set({
            aiProvider: provider,
            modelName: nextModel,
            ...(provider === 'openai' ? { openaiModelName: nextModel } : {}),
            ...(provider === 'gemini' ? { geminiModelName: nextModel } : {})
        });
    });

    modelNameSelect.addEventListener('change', () => {
        const provider = aiProvider.value;
        if (provider === 'custom') return;
        modelByProvider[provider] = modelNameSelect.value;
        chrome.storage.sync.set({
            modelName: modelNameSelect.value,
            ...(provider === 'openai' ? { openaiModelName: modelNameSelect.value } : {}),
            ...(provider === 'gemini' ? { geminiModelName: modelNameSelect.value } : {})
        });
    });

    modelNameCustom.addEventListener('change', () => {
        const value = modelNameCustom.value.trim();
        modelByProvider.custom = value;
        chrome.storage.sync.set({ customModelName: value, modelName: value });
    });

    customApiBaseUrl.addEventListener('change', () => {
        chrome.storage.sync.set({ customApiBaseUrl: customApiBaseUrl.value.trim() });
    });

    useAdvancedGrouping.addEventListener('change', () => {
        chrome.storage.sync.set({ useAdvancedGrouping: useAdvancedGrouping.checked });
    });

    autoGroupNewTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ autoGroupNewTabs: autoGroupNewTabs.checked });
    });

    autoRegroupTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ autoRegroupTabs: autoRegroupTabs.checked });
    });

    // Event listener for pinned tabs exclusion
    excludePinnedTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ excludePinnedTabs: excludePinnedTabs.checked });
    });
});
