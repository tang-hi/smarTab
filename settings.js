document.addEventListener('DOMContentLoaded', () => {
    // Elements - Main Settings
    const closeOtherGroups = document.getElementById('closeOtherGroups');
    const apiKey = document.getElementById('apiKey');
    const aiProvider = document.getElementById('aiProvider');
    const modelNameSelect = document.getElementById('modelName');
    const modelNameCustom = document.getElementById('modelNameCustom');
    const modelHint = document.getElementById('modelHint');
    const customApiBaseUrl = document.getElementById('customApiBaseUrl');
    const customApiBaseUrlField = document.getElementById('customApiBaseUrlField');
    const testConnectionButton = document.getElementById('testConnectionButton');
    const refreshModelsButton = document.getElementById('refreshModelsButton');
    const connectionStatus = document.getElementById('connectionStatus');

    // Elements - Advanced Settings
    const excludePinnedTabs = document.getElementById('excludePinnedTabs');
    const excludeGroupedTabs = document.getElementById('excludeGroupedTabs');
    const currentWindowOnly = document.getElementById('currentWindowOnly');
    const excludeFrozenTabs = document.getElementById('excludeFrozenTabs');
    const customGroupingInstructions = document.getElementById('customGroupingInstructions');

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
        doubao: [
            { value: 'doubao-seed-1.8', label: 'Doubao Seed 1.8 (agent)' },
            { value: 'doubao-seed-1.6', label: 'Doubao Seed 1.6 (balanced)' },
            { value: 'doubao-seed-1.6-lite', label: 'Doubao Seed 1.6 Lite (cost-effective)' },
            { value: 'doubao-seed-1.6-flash', label: 'Doubao Seed 1.6 Flash (fast)' }
        ],
        custom: []
    };

    const DEFAULT_MODEL = {
        openai: 'gpt-4o-mini',
        gemini: 'gemini-2.0-flash',
        doubao: 'doubao-seed-1.6-flash',
        custom: ''
    };

    const PROVIDER_API_BASE = {
        openai: 'https://api.openai.com/v1',
        gemini: 'https://generativelanguage.googleapis.com/v1beta',
        doubao: 'https://ark.cn-beijing.volces.com/api/v3'
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
        refreshModelsButton.classList.toggle('hidden', isCustom);
        modelHint.textContent = isCustom
            ? 'Use the exact model id from your provider.'
            : 'Choose a recommended model or refresh to fetch latest.';
    }

    // ==========================================
    // Fetch Models from API
    // ==========================================
    async function fetchModelsFromAPI(provider, key) {
        if (!key) return null;

        try {
            if (provider === 'gemini') {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
                if (!response.ok) return null;
                const data = await response.json();
                return data.models
                    ?.filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                    ?.map(m => ({
                        value: m.name.replace('models/', ''),
                        label: m.displayName || m.name.replace('models/', '')
                    })) || null;
            }

            if (provider === 'openai') {
                const response = await fetch('https://api.openai.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${key}` }
                });
                if (!response.ok) return null;
                const data = await response.json();
                return data.data
                    ?.filter(m => m.id.includes('gpt'))
                    ?.sort((a, b) => a.id.localeCompare(b.id))
                    ?.map(m => ({ value: m.id, label: m.id })) || null;
            }

            if (provider === 'doubao') {
                // 豆包 API 暂不支持列出模型，使用默认列表
                return null;
            }
        } catch (error) {
            console.error('Error fetching models:', error);
            return null;
        }

        return null;
    }

    async function refreshModels() {
        const provider = aiProvider.value;
        const key = apiKey.value.trim();

        if (provider === 'custom') {
            setConnectionStatus('Custom provider: enter model ID manually.', null);
            return;
        }

        if (provider === 'doubao') {
            setConnectionStatus('Doubao does not support listing models. Using defaults.', null);
            return;
        }

        if (!key) {
            setConnectionStatus('Add an API key first to refresh models.', 'error');
            return;
        }

        setConnectionStatus('Fetching models...', null);

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'fetchModels',
                provider,
                apiKey: key
            });

            if (response?.error) {
                setConnectionStatus(`Failed: ${response.error}`, 'error');
                return;
            }

            if (response?.models && response.models.length > 0) {
                MODEL_OPTIONS[provider] = response.models;
                const currentModel = modelNameSelect.value;
                updateModelOptions(provider, currentModel);
                setConnectionStatus(`Found ${response.models.length} models.`, 'success');
            } else {
                setConnectionStatus('Could not fetch models. Using defaults.', null);
            }
        } catch (error) {
            setConnectionStatus(`Error: ${error.message}`, 'error');
        }
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
            } else if (provider === 'doubao') {
                const response = await fetch(`${PROVIDER_API_BASE.doubao}/chat/completions`, {
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
    // Load Settings
    // ==========================================
    let modelByProvider = {
        openai: DEFAULT_MODEL.openai,
        gemini: DEFAULT_MODEL.gemini,
        doubao: DEFAULT_MODEL.doubao,
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
        'doubaoModelName',
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
            doubao: result.doubaoModelName ?? DEFAULT_MODEL.doubao,
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
            ...(provider === 'gemini' ? { geminiModelName: nextModel } : {}),
            ...(provider === 'doubao' ? { doubaoModelName: nextModel } : {})
        });
    });

    modelNameSelect.addEventListener('change', () => {
        const provider = aiProvider.value;
        if (provider === 'custom') return;
        modelByProvider[provider] = modelNameSelect.value;
        chrome.storage.sync.set({
            modelName: modelNameSelect.value,
            ...(provider === 'openai' ? { openaiModelName: modelNameSelect.value } : {}),
            ...(provider === 'gemini' ? { geminiModelName: modelNameSelect.value } : {}),
            ...(provider === 'doubao' ? { doubaoModelName: modelNameSelect.value } : {})
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

    refreshModelsButton.addEventListener('click', () => {
        refreshModels();
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

    // ==========================================
    // Initialize
    // ==========================================

    // Handle hash navigation for advanced settings
    if (window.location.hash === '#advanced') {
        showAdvancedSettings();
    }
});
