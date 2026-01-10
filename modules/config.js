// ==========================================
// Configuration Constants
// ==========================================
export const DEFAULTS = {
  delays: {
    autoGroupFallback: 15000,  // 15 seconds
    regroupDelay: 3000,        // 3 seconds
    retryDelay: 100,           // 100ms for tab group update retry
    apiRetryBackoff: 1000      // 1 second base for API retry
  },
  maxTabsPerGroup: 10,
  undoHistorySize: 10,
  maxSessionCount: 20
};

export const ALLOWED_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];

export const AI_MODELS = {
  openai: {
    default: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1'
  },
  gemini: {
    default: 'gemini-2.0-flash'
  },
  doubao: {
    default: 'doubao-seed-1.6-flash',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
  }
};

// ==========================================
// Utility Functions
// ==========================================
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

export function levenshteinDistance(s1, s2) {
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

export function validateGroupingSuggestions(suggestions) {
  if (!suggestions?.groups || !Array.isArray(suggestions.groups)) {
    return false;
  }

  return suggestions.groups.every(group =>
    group.group_name &&
    typeof group.group_name === 'string' &&
    group.group_color &&
    (group.tab_indices || group.tab_titles)
  );
}

export function extractTabInfo(tabs) {
  return tabs.map(tab => {
    const url = new URL(tab.url);
    return {
      title: tab.title,
      url: url.origin + url.pathname
    };
  });
}

// ==========================================
// Configuration Management
// ==========================================
export async function getConfig(keys) {
  return chrome.storage.sync.get(keys);
}

export async function setConfig(updates) {
  return chrome.storage.sync.set(updates);
}

export async function getDelays() {
  const result = await chrome.storage.sync.get(['delays']);
  return {
    ...DEFAULTS.delays,
    ...(result.delays || {})
  };
}

export async function setDelays(delays) {
  const current = await getDelays();
  return chrome.storage.sync.set({
    delays: { ...current, ...delays }
  });
}
