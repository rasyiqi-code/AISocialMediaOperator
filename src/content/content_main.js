/**
 * Main Content Script Entry Point
 * Automatically detects current social media platform and injects AI capabilities.
 */

import { ThreadsAdapter } from './adapters/threads_adapter.js';
import { ThreadsInteraction } from './adapters/threads_interaction.js';
import { FacebookAdapter } from './adapters/facebook_adapter.js';
import { FacebookInteraction } from './adapters/facebook_interaction.js';
import { XAdapter } from './adapters/x_adapter.js';
import { XInteraction } from './adapters/x_interaction.js';
import { InjectedUIWidget } from './injected_ui.js';
import { dumpDomStructure } from './dom_inspector.js';

/**
 * Clean raw AI text before typing into social media input fields.
 * Strips TOPIC LABEL headers, variant headers, metadata tags, and any raw HTML tags.
 */
function cleanAiResponseText(rawText) {
  if (!rawText) return '';
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^TOPIC LABEL:\s*.+$/im, '').trim();
  cleaned = cleaned.replace(/^===VARIANT\s*\d+===/im, '').trim();
  cleaned = cleaned.replace(/^===(IMAGE|POLL)===.+$/im, '').trim();
  cleaned = cleaned.replace(/<[^>]*>/g, '').trim();
  return cleaned;
}

class ContentScriptController {
  constructor() {
    this.hostname = window.location.hostname;
    this.adapter = null;
    this.platformKey = '';
    this.widget = null;
    this.interaction = null;
  }

  init() {
    if (this.hostname.includes('threads.net') || this.hostname.includes('threads.com')) {
      this.platformKey = 'threads';
      this.adapter = ThreadsAdapter;
      this.interaction = ThreadsInteraction;
    } else if (this.hostname.includes('facebook.com')) {
      this.platformKey = 'facebook';
      this.adapter = FacebookAdapter;
      this.interaction = FacebookInteraction;
    } else if (this.hostname.includes('x.com') || this.hostname.includes('twitter.com')) {
      this.platformKey = 'x';
      this.adapter = XAdapter;
      this.interaction = XInteraction;
    } else {
      return; // Not a targeted platform
    }

    console.log(`[AI Social Media Operator] Initialized on ${this.adapter.name}`);

    // Attach Injected Floating Widget
    this.widget = new InjectedUIWidget(this.platformKey);
    this.widget.init();

    // Listen for background worker messages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleBackgroundMessage(message, sendResponse);
      return true; // async response
    });

    // Keyboard shortcut to dump the live DOM structure (Ctrl/Cmd+Shift+Alt+D)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        dumpDomStructure(this.platformKey);
      }
    });

    // Auto-reply NEVER resumes automatically. Clear any stale flag left from a
    // previous session so a page reload / extension reload cannot restart it.
    if (this.platformKey === 'threads') {
      chrome.storage.local.remove('autoReplyRunning');
    }

    // Resume X Auto AI-Reply or Auto Quote Tweet ONLY if tab-scoped loop is active
    if (this.platformKey === 'x') {
      const activeReplyMode = sessionStorage.getItem('xAutoLoopMode');
      if (activeReplyMode === 'reply') {
        console.log('[AI Social Media Operator] Resuming X Auto AI-Reply after reload...');
        setTimeout(() => { this._startXAutoReply(); }, 1500);
      } else if (activeReplyMode === 'quote') {
        console.log('[AI Social Media Operator] Resuming X Auto Quote Tweet after reload...');
        setTimeout(() => { this._startXAutoQuote(); }, 1500);
      } else {
        // Clear any stale flags from previous sessions
        chrome.storage.local.remove(['xAutoReplyPending', 'xAutoQuotePending']);
      }
    }

    // Resume Facebook Auto-View Story after it navigated to the Stories page
    // (navigation destroys this content-script context, so the loop restarts here).
    if (this.platformKey === 'facebook' && window.location.href.includes('facebook.com/stories')) {
      chrome.storage.local.get('fbAutoStoryPending', (res) => {
        if (res.fbAutoStoryPending) {
          chrome.storage.local.remove('fbAutoStoryPending');
          this._startFbAutoStory();
        }
      });
    }

    // Resume Facebook Auto-Interaksi Personal after navigating to the Friends page.
    if (this.platformKey === 'facebook' && window.location.href.includes('facebook.com/friends')) {
      chrome.storage.local.get('fbAutoPersonalPending', (res) => {
        if (res.fbAutoPersonalPending) {
          chrome.storage.local.remove('fbAutoPersonalPending');
          this._startFbAutoPersonal();
        }
      });
    }
  }

  async handleBackgroundMessage(message, sendResponse) {
    const { action, payload } = message;

    if (action === 'EXECUTE_AUTO_POST') {
      try {
        const result = await this.adapter.createPost(payload.content, payload.options);
        sendResponse({ success: true, result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (action === 'DEBUG_DUMP_DOM') {
      try {
        const report = dumpDomStructure(this.platformKey);
        sendResponse({ success: true, result: report });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
     } else if (action === 'EXECUTE_INTERACTION') {
       try {
         const { type, options } = payload;

         if (type === 'debug_dom') {
           const platform = options?.platform || this.platformKey;
           sendResponse({ success: true, result: dumpDomStructure(platform) });
           return;
         }

         if (!this.interaction) throw new Error('Fitur interaksi tidak tersedia di platform ini.');

         switch (type) {
          // ── Threads ──
          case 'start_auto_like':
            this.interaction.startContinuousAutoLike((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'like', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'Continuous Auto-Like dimulai.' });
            break;

          case 'start_auto_reply': {
            this._startAutoReply();
            sendResponse({ success: true, message: 'Continuous Auto AI-Reply dimulai.' });
            break;
          }

          case 'start_auto_repost':
            this.interaction.startContinuousAutoRepost((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'repost', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'Continuous Auto-Repost dimulai.' });
            break;

          case 'start_auto_follow':
            this.interaction.startContinuousAutoFollow((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'follow', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'Continuous Auto-Follow dimulai.' });
            break;

          // ── Facebook ──
          case 'start_fb_auto_like':
            this.interaction.startContinuousAutoLike((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'fb_like', progress } }).catch(() => {});
            }, options).catch(console.error);
            sendResponse({ success: true, message: 'FB Auto-Like dimulai.' });
            break;

          case 'start_fb_auto_comment':
            this._startFbAutoComment();
            sendResponse({ success: true, message: 'FB Auto AI-Comment dimulai.' });
            break;

          case 'start_fb_auto_share':
            this.interaction.startContinuousAutoShare((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'fb_share', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'FB Auto-Share dimulai.' });
            break;

          case 'start_fb_auto_follow':
            this.interaction.startContinuousAutoFollow((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'fb_follow', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'FB Auto-Follow dimulai.' });
            break;

          case 'start_fb_auto_story':
            this.interaction.startContinuousAutoStory((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'fb_story', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'FB Auto-View Story dimulai.' });
            break;

          case 'start_fb_auto_personal':
            this._startFbAutoPersonal();
            sendResponse({ success: true, message: 'FB Auto-Interaksi Personal dimulai.' });
            break;

          // ── X / Twitter ──
          case 'start_x_auto_like':
            this.interaction.startContinuousAutoLike((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'x_like', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'X Auto-Like dimulai.' });
            break;

          case 'start_x_auto_reply':
            this._startXAutoReply();
            sendResponse({ success: true, message: 'X Auto AI-Reply dimulai.' });
            break;

          case 'start_x_auto_quote':
            this._startXAutoQuote();
            sendResponse({ success: true, message: 'X Auto AI-Quote Tweet dimulai.' });
            break;

          case 'start_x_auto_retweet':
            this.interaction.startContinuousAutoRetweet((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'x_retweet', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'X Auto-Retweet dimulai.' });
            break;

          case 'start_x_auto_follow':
            this.interaction.startContinuousAutoFollow((progress) => {
              chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'x_follow', progress } }).catch(() => {});
            }).catch(console.error);
            sendResponse({ success: true, message: 'X Auto-Follow dimulai.' });
            break;

          // ── Global Stop Commands ──
          case 'stop_auto_like':
          case 'stop_auto_reply':
          case 'stop_auto_repost':
          case 'stop_auto_follow':
          case 'stop_fb_auto_like':
          case 'stop_fb_auto_comment':
          case 'stop_fb_auto_share':
          case 'stop_fb_auto_follow':
          case 'stop_fb_auto_story':
          case 'stop_fb_auto_personal':
          case 'stop_x_auto_like':
          case 'stop_x_auto_reply':
          case 'stop_x_auto_quote':
          case 'stop_x_auto_retweet':
          case 'stop_x_auto_follow':
          case 'stop_all':
            this.interaction.stop();
            sessionStorage.removeItem('xAutoLoopMode');
            chrome.storage.local.remove(['autoReplyRunning', 'fbAutoStoryPending', 'fbAutoPersonalPending', 'xAutoReplyPending', 'xAutoQuotePending']);
            sendResponse({ success: true, message: 'Interaksi dihentikan.' });
            break;

          case 'reply_post': {
            const replyText = options?.replyText || '';
            const res = await this.interaction.replyToFirstPost(replyText);
            sendResponse({ success: true, result: res });
            break;
          }

          default:
            throw new Error(`Tipe interaksi tidak dikenal: ${type}`);
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
  }

  /**
   * Build the AI reply generator and start the continuous auto-reply loop
   */
  _startThreadsAutoReply() {
    const generateAIReplyHelper = async (postText) => {
      return new Promise((resolve) => {
        const prompt = `ISI POSTINGAN THREADS TARGET:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 balasan yang santai, relevan dan spesifik mengomentari postingan di atas.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam isi postingan target di atas. Tulis balasan Anda dalam BAHASA YANG SAMA PERSIS dengan postingan target (misalnya: jika postingan berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; jika Spanyol/Jepang/dll, jawab dalam bahasa tersebut). Gunakan gaya bahasa alami yang pas untuk bahasa target.
Tanpa hashtag. Berikan teks balasan saja.`;

        chrome.runtime.sendMessage({
          action: 'GENERATE_CONTENT',
          payload: { prompt, platform: 'threads', tone: 'casual' }
        }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            resolve('');
          } else {
            resolve(cleanAiResponseText(res.data));
          }
        });
      });
    };

    this.interaction.startContinuousAutoReply((progress) => {
      chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'reply', progress } }).catch(() => {});
    }, generateAIReplyHelper).catch(console.error);
  }

  _startFbAutoComment() {
    const generateFBCommentHelper = async (postText) => {
      return new Promise((resolve) => {
        const prompt = `ISI POSTINGAN FACEBOOK TARGET:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 komentar Facebook yang santai, relevan dan spesifik mengomentari postingan di atas.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam isi postingan target di atas. Tulis komentar Anda dalam BAHASA YANG SAMA PERSIS dengan postingan target (misalnya: jika postingan berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; jika Spanyol/Jepang/dll, jawab dalam bahasa tersebut).
1 kalimat saja, tanpa hashtag. Berikan teks komentar saja.`;

        chrome.runtime.sendMessage({
          action: 'GENERATE_CONTENT',
          payload: { prompt, platform: 'facebook', tone: 'casual' }
        }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            resolve('');
          } else {
            resolve(cleanAiResponseText(res.data));
          }
        });
      });
    };

    this.interaction.startContinuousAutoComment((progress) => {
      chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'fb_comment', progress } }).catch(() => {});
    }, generateFBCommentHelper).catch(console.error);
  }

  _startFbAutoStory() {
    this.interaction.startContinuousAutoStory((progress) => {
      chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'fb_story', progress } }).catch(() => {});
    }).catch(console.error);
  }

  _startFbAutoPersonal() {
    const generateFbPersonalComment = async (postText) => {
      return new Promise((resolve) => {
        const prompt = `ISI POSTINGAN TEMAN DI FACEBOOK:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 komentar untuk teman Anda di Facebook yang santai, hangat, spesifik dan relevan mengomentari isi postingan di atas.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam isi postingan teman di atas. Tulis komentar Anda dalam BAHASA YANG SAMA PERSIS dengan postingan teman tersebut (misalnya: jika postingan berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; dst.).
1 kalimat saja, tanpa hashtag. Berikan teks komentar saja.`;

        chrome.runtime.sendMessage({
          action: 'GENERATE_CONTENT',
          payload: { prompt, platform: 'facebook', tone: 'casual' }
        }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            resolve('');
          } else {
            resolve(cleanAiResponseText(res.data));
          }
        });
      });
    };

    this.interaction.startContinuousAutoPersonalInteraction((progress) => {
      chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'fb_personal', progress } }).catch(() => {});
    }, generateFbPersonalComment).catch(console.error);
  }

  _startXAutoReply() {
    sessionStorage.setItem('xAutoLoopMode', 'reply');
    chrome.storage.local.set({ xAutoReplyPending: true, xAutoQuotePending: false });
    const generateXReplyHelper = async (postText) => {
      return new Promise((resolve) => {
        const prompt = `ISI TWEET TARGET:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 balasan tweet (maksimal 200 karakter) yang relevan, punchy, dan alami.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam ISI TWEET TARGET di atas. Tulis balasan Anda dalam BAHASA YANG SAMA PERSIS dengan tweet target (misalnya: jika tweet berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; jika Jepang, jawab bahasa Jepang, dst.). Gunakan gaya bahasa dan slang lokal yang pas.
Tanpa hashtag. Berikan teks balasan saja.`;

        chrome.runtime.sendMessage({
          action: 'GENERATE_CONTENT',
          payload: { prompt, platform: 'x', tone: 'casual' }
        }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            resolve('');
          } else {
            resolve(cleanAiResponseText(res.data));
          }
        });
      });
    };

    this.interaction.startContinuousAutoReply((progress) => {
      chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'x_reply', progress } }).catch(() => {});
    }, generateXReplyHelper).catch(console.error);
  }

  _startXAutoQuote() {
    sessionStorage.setItem('xAutoLoopMode', 'quote');
    chrome.storage.local.set({ xAutoQuotePending: true, xAutoReplyPending: false });
    const generateXQuoteHelper = async (postText) => {
      return new Promise((resolve) => {
        const prompt = `ISI TWEET TARGET:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 komentar kutipan (quote tweet, maksimal 200 karakter) yang relevan, punchy, dan cerdas.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam ISI TWEET TARGET di atas. Tulis komentar Anda dalam BAHASA YANG SAMA PERSIS dengan tweet target (misalnya: jika tweet berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; jika Spanyol, jawab bahasa Spanyol, dst.).
Tanpa hashtag. Berikan teks balasan saja.`;

        chrome.runtime.sendMessage({
          action: 'GENERATE_CONTENT',
          payload: { prompt, platform: 'x', tone: 'casual' }
        }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            resolve('');
          } else {
            resolve(cleanAiResponseText(res.data));
          }
        });
      });
    };

    this.interaction.startContinuousAutoQuote((progress) => {
      chrome.runtime.sendMessage({ action: 'INTERACTION_PROGRESS', payload: { type: 'x_quote', progress } }).catch(() => {});
    }, generateXQuoteHelper).catch(console.error);
  }
}

const controller = new ContentScriptController();
controller.init();

