/**
 * Chrome Storage utility wrappers for AI Social Media Operator
 */

export const DEFAULT_SETTINGS = {
  aiProvider: 'cookie_gemini',
  customChatgptCookie: '',
  customGeminiCookie: '',
  apiKey: '',
  apiEndpoint: '',
  apiModel: '',
  claudeApiKey: '',
  claudeEndpoint: '',
  claudeModel: '',
  customSystemPrompt: 'You are an expert social media strategist and content creator. Create engaging, high-performing posts tailored for the requested platform.',
  humanTypingSpeed: 'medium',
  minRandomDelay: 5,
  maxRandomDelay: 20,
  maxPostsPerDay: 15,
  autoReplyEnabled: true,
  threadsProfileHandle: '',
  customTone: '',
  autoReplyKeywords: ['info', 'tanya', 'harga', 'link', 'gimana', 'rekomendasi', 'mau', 'spill'],
  imageGenEndpoint: '',
  imageGenModel: '',
  imageGenApiKey: ''
};

export const getSettings = async () => {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
    });
  });
};

export const saveSettings = async (newSettings) => {
  const current = await getSettings();
  const updated = { ...current, ...newSettings };
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: updated }, () => {
      resolve(updated);
    });
  });
};

export const getActivityLogs = async () => {
  return new Promise((resolve) => {
    chrome.storage.local.get(['activityLogs'], (result) => {
      resolve(result.activityLogs || []);
    });
  });
};

export const addActivityLog = async (action, details, type = 'info') => {
  const logs = await getActivityLogs();
  const log = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    timestamp: Date.now(),
    action,
    details,
    type // 'info', 'success', 'warning', 'error'
  };
  logs.unshift(log); // newest first
  // Keep last 100 logs
  const trimmed = logs.slice(0, 100);
  return new Promise((resolve) => {
    chrome.storage.local.set({ activityLogs: trimmed }, () => {
      resolve(log);
    });
  });
};
