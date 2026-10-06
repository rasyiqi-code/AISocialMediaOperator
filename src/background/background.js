/**
 * Main Extension Background Service Worker
 */

import { AIEngine } from '../services/ai_engine.js';
import { getSettings, saveSettings, getActivityLogs, addActivityLog } from '../utils/storage.js';

// Initialize extension background tasks
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AI Operator v1.0.1] Service Worker Installed/Updated');
  if (details.reason === 'install') {
    await addActivityLog('AI Social Media Operator Berhasil Diinstall', 'Extension siap digunakan!', 'success');
  }
  // Setup side panel behavior to open on action click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Message Bus Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(data => sendResponse({ success: true, data }))
    .catch(err => sendResponse({ success: false, error: err.message || err.toString() }));
  return true; // async return
});

async function handleMessage(message, sender) {
  const { action, payload } = message;

  switch (action) {
    case 'GENERATE_CONTENT': {
      await addActivityLog(`Meminta AI Generate (${payload.platform || 'general'})`, `Topik: ${payload.prompt || ''}`, 'info');
      const generatedText = await AIEngine.generateContent(payload.prompt, {
        platform: payload.platform,
        tone: payload.tone,
        provider: payload.provider,
        threadsFormat: payload.threadsFormat,
        threadsMode: payload.threadsMode,
        useEmoji: payload.useEmoji,
        useImage: payload.useImage,
        usePoll: payload.usePoll,
        variants: payload.variants,
        ...(payload.options || {}),
        ...(payload || {})
      });
      await addActivityLog(`AI Generasi Berhasil (${payload.platform || 'general'})`, 'Konten siap diisikan', 'success');
      return generatedText;
    }

    case 'GET_SETTINGS': {
      return await getSettings();
    }

    case 'SAVE_SETTINGS': {
      const updated = await saveSettings(payload);
      await addActivityLog('Pengaturan Disimpan', `Provider AI: ${updated.aiProvider}`, 'info');
      return updated;
    }

    case 'GET_LOGS': {
      return await getActivityLogs();
    }

    case 'GENERATE_IMAGE': {
      const imageUrl = await AIEngine.generateImage(payload.prompt);
      return imageUrl;
    }

    // Progress events broadcast by content scripts to the side panel.
    // Background only relays; no-op so it doesn't throw an "unknown action".
    case 'INTERACTION_PROGRESS': {
      return null;
    }

    default:
      throw new Error(`Unknown background action: ${action}`);
  }
}
