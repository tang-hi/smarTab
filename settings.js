document.addEventListener('DOMContentLoaded', () => {
    // Elements - Main Settings
    const closeOtherGroups = document.getElementById('closeOtherGroups');
    const backButton = document.getElementById('backButton');
    const apiKey = document.getElementById('apiKey');
    const aiProvider = document.getElementById('aiProvider');
    const modelNameSelect = document.getElementById('modelName');
    const modelNameCustom = document.getElementById('modelNameCustom');
    const modelHint = document.getElementById('modelHint');
    const customApiBaseUrl = document.getElementById('customApiBaseUrl');
    const customApiBaseUrlField = document.getElementById('customApiBaseUrlField');
    const testConnectionButton = document.getElementById('testConnectionButton');
    const connectionStatus = document.getElementById('connectionStatus');

    // Elements - Advanced Settings
    const excludePinnedTabs = document.getElementById('excludePinnedTabs');
    const excludeGroupedTabs = document.getElementById('excludeGroupedTabs');
    const currentWindowOnly = document.getElementById('currentWindowOnly');
    const excludeFrozenTabs = document.getElementById('excludeFrozenTabs');
    const customGroupingInstructions = document.getElementById('customGroupingInstructions');
    const openShortcutsLink = document.getElementById('openShortcutsLink');
    const groupShortcut = document.getElementById('groupShortcut');
    const searchShortcut = document.getElementById('searchShortcut');

    // Elements - View Toggle
    const mainSettings = document.getElementById('mainSettings');
    const advancedSettings = document.getElementById('advancedSettings');
    const openAdvancedSettings = document.getElementById('openAdvancedSettings');
    const backToMain = document.getElementById('backToMain');

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

    // ==========================================
    // View Toggle
    // ==========================================
    function showMainSettings() {
        mainSettings.classList.remove('hidden');
        advancedSettings.classList.add('hidden');
    }

    function showAdvancedSettings() {
        mainSettings.classList.add('hidden');
        advancedSettings.classList.remove('hidden');
    }

    openAdvancedSettings?.addEventListener('click', showAdvancedSettings);
    backToMain?.addEventListener('click', showMainSettings);

    // ==========================================
    // Model Options
    // ==========================================
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
        modelNameSelect.classList.toggle('hidden', isCustom);
        modelNameCustom.classList.toggle('hidden', !isCustom);
        customApiBaseUrlField.classList.toggle('hidden', !isCustom);
        modelHint.textContent = isCustom
            ? 'Use the exact model id from your provider.'
            : 'Choose a recommended model for this provider.';
    }

    // ==========================================
    // Connection Testing
    // ==========================================
    function setConnectionStatus(message, state) {
        connectionStatus.textContent = message;
        connectionStatus.classList.remove('is-success', 'is-error');
        if (state) {
            connectionStatus.classList.add(`is-${state}`);
        }
    }

    function resetConnectionStatus() {
        setConnectionStatus('', null);
    }

    function setTestLoading(isLoading) {
        testConnectionButton.disabled = isLoading;
        testConnectionButton.classList.toggle('loading', isLoading);
    }

    function normalizeBaseUrl(value) {
        return value.replace(/\/+$/, '');
    }

    async function testConnection() {
        const provider = aiProvider.value;
        const key = apiKey.value.trim();
        const model = provider === 'custom' ? modelNameCustom.value.trim() : modelNameSelect.value;

        if (!key) {
            setConnectionStatus('Add an API key first.', 'error');
            return;
        }
        if (!model) {
            setConnectionStatus('Select a model first.', 'error');
            return;
        }

        let baseUrl = 'https://api.openai.com/v1';
        if (provider === 'custom') {
            const customUrl = customApiBaseUrl.value.trim();
            if (!customUrl) {
                setConnectionStatus('Add an API base URL for custom providers.', 'error');
                return;
            }
            baseUrl = normalizeBaseUrl(customUrl);
        }

        setTestLoading(true);
        setConnectionStatus('Testing connection...', null);

        try {
            if (provider === 'gemini') {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: 'ping' }]
                        }]
                    })
                });

                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(text || `HTTP ${response.status}`);
                }
            } else {
                const response = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: 'ping' }],
                        max_tokens: 1,
                        temperature: 0
                    })
                });

                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(text || `HTTP ${response.status}`);
                }
            }

            setConnectionStatus('Connection ok.', 'success');
        } catch (error) {
            const message = (error && error.message ? error.message : 'Connection failed.').trim();
            const detail = message.length > 200 ? `${message.slice(0, 200)}...` : message;
            setConnectionStatus(`Failed: ${detail}`, 'error');
        } finally {
            setTestLoading(false);
        }
    }

    // ==========================================
    // Load Shortcuts
    // ==========================================
    async function loadShortcuts() {
        try {
            const commands = await chrome.commands.getAll();
            const groupCommand = commands.find(cmd => cmd.name === 'group-tabs');
            const searchCommand = commands.find(cmd => cmd.name === 'search-tabs');

            if (groupCommand?.shortcut && groupShortcut) {
                groupShortcut.textContent = groupCommand.shortcut;
            }
            if (searchCommand?.shortcut && searchShortcut) {
                searchShortcut.textContent = searchCommand.shortcut;
            }
        } catch (error) {
            console.error('Error loading shortcuts:', error);
        }
    }

    // ==========================================
    // Load Settings
    // ==========================================
    let modelByProvider = {
        openai: DEFAULT_MODEL.openai,
        gemini: DEFAULT_MODEL.gemini,
        custom: ''
    };

    chrome.storage.sync.get([
        'closeOtherGroups',
        'customGroupingInstructions',
        'currentWindowOnly',
        'excludePinnedTabs',
        'excludeGroupedTabs',
        'excludeFrozenTabs',
        'apiKey',
        'aiProvider',
        'modelName',
        'openaiModelName',
        'geminiModelName',
        'customModelName',
        'customApiBaseUrl',
        'geminiApiKey'
    ], (result) => {
        // Main settings
        closeOtherGroups.checked = result.closeOtherGroups ?? true;

        // Advanced settings
        customGroupingInstructions.value = result.customGroupingInstructions ?? '';
        currentWindowOnly.checked = result.currentWindowOnly ?? true;
        excludePinnedTabs.checked = result.excludePinnedTabs ?? true;
        excludeGroupedTabs.checked = result.excludeGroupedTabs ?? true;
        excludeFrozenTabs.checked = result.excludeFrozenTabs ?? true;

        // Model settings
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

    // ==========================================
    // Event Listeners - Main Settings
    // ==========================================
    closeOtherGroups.addEventListener('change', () => {
        chrome.storage.sync.set({ closeOtherGroups: closeOtherGroups.checked });
    });

    backButton.addEventListener('click', () => {
        window.history.back();
    });

    apiKey.addEventListener('change', () => {
        chrome.storage.sync.set({ apiKey: apiKey.value.trim() });
        resetConnectionStatus();
    });

    aiProvider.addEventListener('change', () => {
        const provider = aiProvider.value;
        applyProviderUI(provider);
        resetConnectionStatus();

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
        resetConnectionStatus();
    });

    modelNameCustom.addEventListener('change', () => {
        const value = modelNameCustom.value.trim();
        modelByProvider.custom = value;
        chrome.storage.sync.set({ customModelName: value, modelName: value });
        resetConnectionStatus();
    });

    customApiBaseUrl.addEventListener('change', () => {
        chrome.storage.sync.set({ customApiBaseUrl: customApiBaseUrl.value.trim() });
        resetConnectionStatus();
    });

    testConnectionButton.addEventListener('click', () => {
        testConnection();
    });

    // ==========================================
    // Event Listeners - Advanced Settings
    // ==========================================
    excludePinnedTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ excludePinnedTabs: excludePinnedTabs.checked });
    });

    excludeGroupedTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ excludeGroupedTabs: excludeGroupedTabs.checked });
    });

    currentWindowOnly.addEventListener('change', () => {
        chrome.storage.sync.set({ currentWindowOnly: currentWindowOnly.checked });
    });

    excludeFrozenTabs.addEventListener('change', () => {
        chrome.storage.sync.set({ excludeFrozenTabs: excludeFrozenTabs.checked });
    });

    customGroupingInstructions.addEventListener('change', () => {
        chrome.storage.sync.set({ customGroupingInstructions: customGroupingInstructions.value });
    });

    openShortcutsLink?.addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });

    // ==========================================
    // Initialize
    // ==========================================
    loadShortcuts();

    // Handle hash navigation for advanced settings
    if (window.location.hash === '#advanced') {
        showAdvancedSettings();
    }
});
