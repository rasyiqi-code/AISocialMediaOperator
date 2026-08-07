import { AIEngine } from '../services/ai_engine.js';
import { addActivityLog } from '../utils/storage.js';
import { splitIntoThreadParts } from '../utils/text_utils.js';

const escapeHtml = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function parseIdeas(raw, count = 10) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .map(line => line.replace(/^\s*(?:\d+[\.\)]|[-*•◦])\s*/, '').trim())
    .filter(line => line.length > 12)
    .filter(line => !/^(berikut|daftar|ide[- ]konten|tema|intro|oke|tentu|siap|berikut adalah)/i.test(line))
    .slice(0, count);
}

/**
 * Parse a single post text: extract the "TOPIC LABEL: ..." line (if the AI
 * produced one) into { text, label }, and strip it from the post body.
 * If the AI skipped the label, fall back to the main topic (studioTopic),
 * then to a best-effort derivation from the first line.
 */
/**
 * Golden hours (LOCAL) for general social-media activity on Threads: peak
 * engagement windows across the day (morning commute, lunch, evening after work,
 * late-night scroll).
 */
const GOLDEN_HOURS = [7, 8, 9, 12, 13, 18, 19, 20, 21, 22];

/**
 * Compute the next N future posting timestamps, aligned to the golden hours,
 * spread across the coming days. One slot per variant.
 */
function nextGoldenSlots(count = 1) {
  const slots = [];
  const now = Date.now();
  const MIN_AHEAD = 10 * 60 * 1000; // allow the scheduler a grace window
  const today = new Date();
  for (let d = 0; d < 14 && slots.length < count; d++) {
    for (const h of GOLDEN_HOURS) {
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d, h, 0, 0).getTime();
      if (t > now + MIN_AHEAD) {
        slots.push(t);
        if (slots.length >= count) break;
      }
    }
  }
  return slots;
}

function parseVariantWithLabel(raw, fallbackTopic) {
  let text = (raw || '').trim();
  const labelMatch = text.match(/^TOPIC LABEL:\s*(.+)$/im);
  let label = '';
  let cleaned = text;
  if (labelMatch) {
    label = labelMatch[1].trim().split(/\s+/).slice(0, 3).join(' ');
    cleaned = text.replace(/^TOPIC LABEL:\s*.+$/im, '').trim();
  }
  // Defensive: strip any leaked POST SCHEDULE line the AI might still emit
  cleaned = cleaned.replace(/^POST SCHEDULE:\s*.+$/im, '').trim();
  // Extract image prompt if present
  const imageMatch = cleaned.match(/^===IMAGE===\s*(.+)$/im);
  const imagePrompt = imageMatch ? imageMatch[1].trim() : '';
  if (imageMatch) {
    cleaned = cleaned.replace(/^===IMAGE===\s*.+$/im, '').trim();
  }
  // Safety: drop any leaked variant header / stray "VARIANT n" line
  cleaned = cleaned
    .replace(/^(?:=+|u003d)+\s*(?:VARIANT|VARIAN)\s*\d+\s*(?:=+|u003d)+\s*$/gim, '')
    .replace(/^VARIANT\s*\d+\s*$/gim, '')
    .trim();

  const STOP = ['kenapa','mengapa','apa','bagaimana','berapa','kapan','yang','untuk','dengan','dari','ke','di','itu','ini','anda','kamu','lu','gue','akan','adalah'];
  const pickLabel = (src) => {
    const stripped = (src || '')
      .replace(/^\s*(?:\d+[\.\)\/]?\s*|[-\u2022*•]+\s*)/, '')
      .split(/[.!?:;,](?:\s|$)/)[0]
      .trim();
    const words = stripped.split(/\s+/).filter(w => w && w.length > 1 && !STOP.includes(w.toLowerCase())).slice(0, 3);
    return words.length >= 2 ? words.join(' ') : '';
  };

  // 1) AI label already extracted above. 2) main topic. 3) first line.
  if (!label) label = pickLabel(fallbackTopic);
  if (!label) label = pickLabel(cleaned.split(/\r?\n/)[0]);

  return { text: cleaned, label, imagePrompt };
}

function parseVariants(raw, fallbackTopic) {
  if (!raw) return [];
  const parts = raw
    // Whole-line variant headers; tolerate mangled "u003d" (unescaped "=")
    .split(/^(?:=+|u003d)+\s*(?:VARIANT|VARIAN)\s*\d+\s*(?:=+|u003d)+\s*$/gim)
    .map(s => s.trim())
    .filter(Boolean);
  return (parts.length > 1 ? parts : [raw.trim()]).map(s => parseVariantWithLabel(s, fallbackTopic));
}

class SidepanelApp {
  constructor() {
    this.selectedPlatform = 'threads';
    this.selectedTone = 'engaging';
    this.generatedContent = '';
  }

  async init() {
    // Bind each feature independently so a single failure cannot block the
    // rest of the UI from working.
    const safe = (fn) => { try { fn(); } catch (e) { console.error('[Sidepanel] Bind error:', e); } };
    safe(() => this.bindNavigation());
    safe(() => this.bindStudioEvents());
    safe(() => this.bindIdeaEvents());
    safe(() => this.bindSettingsEvents());
    safe(() => this.bindLogEvents());
    safe(() => this.bindInteractionEvents());

    // Load initial settings & detect active tab platform
    await this.detectActivePlatform();
    await this.loadSettings();
    await this.loadLogs();
  }

  async detectActivePlatform() {
    const tab = await this.getActiveTab();
    if (!tab || !tab.url) return;

    const url = tab.url;
    let target = 'threads';
    if (url.includes('facebook.com')) target = 'facebook';
    else if (url.includes('x.com') || url.includes('twitter.com')) target = 'x';
    else if (url.includes('threads.net')) target = 'threads';
    else return;

    this.selectedPlatform = target;
    const btns = document.querySelectorAll('.platform-btn');
    btns.forEach(b => {
      if (b.dataset.platform === target) b.classList.add('active');
      else b.classList.remove('active');
    });
  }

  // Navigation Tab Switcher
  bindNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.tab-view');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetId = tab.dataset.tab;
        tabs.forEach(t => t.classList.remove('active'));
        views.forEach(v => v.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(`view-${targetId}`).classList.add('active');

        if (targetId === 'logs') this.loadLogs();
      });
    });
  }

  // Interaction Tab Events
  bindInteractionEvents() {
    let activeTask = null; // 'like' | 'repost' | 'follow' | null

    // ── Sub-tab switcher ──
    document.querySelectorAll('.interact-subtab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.interact-subtab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.interact-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panelId = {
          threads: 'panelThreadsInteract',
          facebook: 'panelFacebookInteract',
          x: 'panelXInteract'
        }[tab.dataset.panel];
        if (panelId) document.getElementById(panelId)?.classList.add('active');
      });
    });

    const showInteractResult = (html, isError = false) => {
      const el = document.getElementById('interactResult');
      if (!el) return;
      el.style.display = 'block';
      el.className = 'interact-result' + (isError ? ' error' : '');
      el.innerHTML = html;
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const sendInteraction = async (type, options = {}) => {
      const tab = await this.getActiveTab();
      if (!tab) { showInteractResult('Tab aktif tidak ditemukan.', true); return; }

      const messagePayload = { action: 'EXECUTE_INTERACTION', payload: { type, options } };

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, messagePayload, async (res) => {
          if (chrome.runtime.lastError) {
            console.log('[Sidepanel] Content script not loaded in active tab yet, injecting dynamically...');
            try {
              // Dynamically inject content script bundle into target tab
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['public/content_main.bundle.js']
              });
              await new Promise(r => setTimeout(r, 600));

              // Retry message sending after dynamic injection
              chrome.tabs.sendMessage(tab.id, messagePayload, (retryRes) => {
                if (chrome.runtime.lastError) {
                  return reject(new Error('Silakan refresh tab browser Anda (F5) untuk memperbarui script.'));
                }
                if (!retryRes || !retryRes.success) {
                  return reject(new Error(retryRes ? retryRes.error : 'Gagal mengeksekusi interaksi'));
                }
                resolve(retryRes.result || retryRes);
              });
            } catch (injErr) {
              return reject(new Error('Silakan buka atau refresh tab Threads/Facebook/X terlebih dahulu (F5).'));
            }
          } else {
            if (!res || !res.success) return reject(new Error(res ? res.error : 'Request failed'));
            resolve(res.result || res);
          }
        });
      });
    };

    // Helper: generic toggle button
    const makeToggle = (btnId, taskKey, startAction, stopAction, startLabel, stopLabel, startMsg, getOptionsFn) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        if (activeTask === taskKey) {
          await sendInteraction(stopAction).catch(() => {});
          activeTask = null;
          btn.innerHTML = startLabel;
          btn.classList.remove('btn-danger');
          showInteractResult(`⏹️ ${startLabel.replace(/^[^\s]+\s/, '')} dihentikan.`);
        } else {
          if (activeTask) await sendInteraction('stop_all').catch(() => {});
          activeTask = taskKey;
          btn.innerHTML = `⏹️ Stop`;
          btn.classList.add('btn-danger');
          showInteractResult(startMsg);
          try {
            const opts = getOptionsFn ? getOptionsFn() : {};
            await sendInteraction(startAction, opts);
          } catch (e) {
            activeTask = null;
            btn.innerHTML = startLabel;
            btn.classList.remove('btn-danger');
            showInteractResult('❌ ' + e.message, true);
          }
        }
      });
    };

    // Listen for progress updates from content script
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'INTERACTION_PROGRESS') {
        const { type, progress } = msg.payload || {};
        if (type === 'like') {
          showInteractResult(`❤️ <b>Auto-Like Berjalan...</b><br>Berhasil menyukai <b>${progress.count}</b> postingan.<br><span style="opacity:0.8">Terbaru: @${progress.author || 'User'}</span>`);
        } else if (type === 'reply') {
          showInteractResult(`💬 <b>Auto AI-Reply Berjalan...</b><br>Berhasil membalas <b>${progress.count}</b> postingan @${progress.author || 'User'}.<br><span style="opacity:0.9;font-style:italic">" ${progress.replyText} "</span>`);
        } else if (type === 'repost') {
          showInteractResult(`🔁 <b>Auto-Repost Berjalan...</b><br>Berhasil repost <b>${progress.count}</b> postingan.<br><span style="opacity:0.8">Terbaru: @${progress.author || 'User'}</span>`);
        } else if (type === 'follow') {
          showInteractResult(`➕ <b>Auto-Follow Berjalan...</b><br>Berhasil follow <b>${progress.count}</b> user.<br><span style="opacity:0.8">Terbaru: @${progress.author || 'User'}</span>`);
        } else if (type === 'fb_like') {
          showInteractResult(`👍 <b>FB Auto-Like / Reaksi Berjalan...</b><br>Berhasil memberi tanggapan (<b>${progress.reaction || 'Suka'}</b>) pada <b>${progress.count}</b> postingan.`);
        } else if (type === 'fb_comment') {
          showInteractResult(`💬 <b>FB Auto AI-Comment Berjalan...</b><br>Berhasil komentar <b>${progress.count}</b> postingan.<br><span style="opacity:0.9;font-style:italic">" ${progress.replyText || ''} "</span>`);
        } else if (type === 'fb_share') {
          showInteractResult(`🔁 <b>FB Auto-Share Berjalan...</b><br>Berhasil share <b>${progress.count}</b> postingan.`);
        } else if (type === 'fb_follow') {
          showInteractResult(`➕ <b>FB Auto-Follow Berjalan...</b><br>Berhasil follow <b>${progress.count}</b> user/halaman.`);
        } else if (type === 'fb_story') {
          showInteractResult(`📖 <b>FB Auto-View Story Berjalan...</b><br>Sudah menonton <b>${progress.count}</b> story.`);
        } else if (type === 'fb_personal') {
          showInteractResult(`👥 <b>Auto-Interaksi Personal Berjalan...</b><br>Teman dikunjungi: <b>${progress.count}</b> | 👍 Like: <b>${progress.likes || 0}</b> | 💬 Komentar: <b>${progress.comments || 0}</b><br><span style="opacity:0.8">Profil saat ini: ${progress.author || 'User'}</span>`);
        } else if (type === 'x_like') {
          showInteractResult(`❤️ <b>X Auto-Like Berjalan...</b><br>Berhasil menyukai <b>${progress.count}</b> tweet.`);
        } else if (type === 'x_reply') {
          showInteractResult(`💬 <b>X Auto AI-Reply Berjalan...</b><br>Berhasil membalas <b>${progress.count}</b> tweet.`);
        } else if (type === 'x_retweet') {
          showInteractResult(`🔁 <b>X Auto-Retweet Berjalan...</b><br>Berhasil retweet <b>${progress.count}</b> tweet.`);
        } else if (type === 'x_follow') {
          showInteractResult(`➕ <b>X Auto-Follow Berjalan...</b><br>Berhasil follow <b>${progress.count}</b> user.`);
        }
      }
    });

    // ── THREADS ──
    makeToggle('btnAutoLike',   'like',   'start_auto_like',   'stop_auto_like',   '❤️ Mulai Auto-Like',   '⏹️ Stop Auto-Like',   '⏳ Auto-Like Kontinu dimulai...');
    makeToggle('btnAutoReply',  'reply',  'start_auto_reply',  'stop_auto_reply',  '💬 Mulai Auto AI-Reply', '⏹️ Stop Auto AI-Reply', '🤖 Auto AI-Reply dimulai...');
    makeToggle('btnAutoRepost', 'repost', 'start_auto_repost', 'stop_auto_repost', '🔁 Mulai Auto-Repost', '⏹️ Stop Auto-Repost', '⏳ Auto-Repost Kontinu dimulai...');
    makeToggle('btnAutoFollow', 'follow', 'start_auto_follow', 'stop_auto_follow', '➕ Mulai Auto-Follow', '⏹️ Stop Auto-Follow', '⏳ Auto-Follow Kontinu dimulai...');

    // ── FACEBOOK ──
    makeToggle('btnFbAutoLike',    'fb_like',    'start_fb_auto_like',    'stop_fb_auto_like',    '👍 Mulai Auto-Like / Reaksi Acak', '⏹️ Stop', '⏳ FB Auto-Like / Reaksi Acak dimulai...', () => ({
      reaction: 'random'
    }));
    makeToggle('btnFbAutoComment', 'fb_comment', 'start_fb_auto_comment', 'stop_fb_auto_comment', '💬 Mulai Auto AI-Comment',  '⏹️ Stop', '🤖 FB Auto AI-Comment dimulai...');
    makeToggle('btnFbAutoRepost',  'fb_share',   'start_fb_auto_share',   'stop_fb_auto_share',   '🔁 Mulai Auto-Share',       '⏹️ Stop', '⏳ FB Auto-Share dimulai...');
    makeToggle('btnFbAutoFollow',  'fb_follow',  'start_fb_auto_follow',  'stop_fb_auto_follow',  '➕ Mulai Auto-Follow',      '⏹️ Stop', '⏳ FB Auto-Follow dimulai...');
    makeToggle('btnFbAutoStory',   'fb_story',   'start_fb_auto_story',   'stop_fb_auto_story',   '📖 Mulai Auto-View Story',  '⏹️ Stop', '📖 FB Auto-View Story dimulai...');
    makeToggle('btnFbAutoPersonal', 'fb_personal', 'start_fb_auto_personal', 'stop_fb_auto_personal', '👥 Mulai Auto-Interaksi Personal', '⏹️ Stop', '👥 FB Auto-Interaksi Personal dimulai...');

    // ── X / TWITTER ──
    makeToggle('btnXAutoLike',    'x_like',    'start_x_auto_like',    'stop_x_auto_like',    '❤️ Mulai Auto-Like Tweet', '⏹️ Stop', '⏳ X Auto-Like dimulai...');
    makeToggle('btnXAutoReply',   'x_reply',   'start_x_auto_reply',   'stop_x_auto_reply',   '💬 Mulai Auto AI-Reply',   '⏹️ Stop', '🤖 X Auto AI-Reply dimulai...');
    makeToggle('btnXAutoQuote',   'x_quote',   'start_x_auto_quote',   'stop_x_auto_quote',   '🗣️ Mulai Auto AI-Quote Tweet', '⏹️ Stop', '🗣️ X Auto AI-Quote Tweet dimulai...');
    makeToggle('btnXAutoRetweet', 'x_retweet', 'start_x_auto_retweet', 'stop_x_auto_retweet', '🔁 Mulai Auto-Retweet',    '⏹️ Stop', '⏳ X Auto-Retweet dimulai...');
    makeToggle('btnXAutoFollow',  'x_follow',  'start_x_auto_follow',  'stop_x_auto_follow',  '➕ Mulai Auto-Follow',     '⏹️ Stop', '⏳ X Auto-Follow dimulai...');

    // Generate AI Reply
    document.getElementById('btnGenAIReply')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnGenAIReply');
      btn.disabled = true; btn.textContent = '🤖 Generating...';
      try {
        const replyContent = await AIEngine.generateContent(
          `Balas postingan di feed secara natural, singkat, relevan dan engaging.`,
          { platform: 'threads', tone: this.getEffectiveTone(), threadsFormat: 'short' }
        );
        document.getElementById('replyText').value = replyContent;
        showInteractResult(`✨ AI Reply berhasil digenerate!`);
      } catch (e) { showInteractResult('❌ ' + e.message, true); }
      finally { btn.disabled = false; btn.textContent = '✨ Generate AI Reply'; }
    });

    // Send Reply
    document.getElementById('btnSendReply')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnSendReply');
      const replyText = document.getElementById('replyText')?.value?.trim();
      if (!replyText) { showInteractResult('❌ Teks balasan belum diisi.', true); return; }
      btn.disabled = true; btn.textContent = '⏳ Mengisi balasan...';
      try {
        const res = await sendInteraction('reply_post', { replyText });
        showInteractResult(`💬 ${res.message || 'Berhasil mengisikan balasan!'}`);
      } catch (e) { showInteractResult('❌ ' + e.message, true); }
      finally { btn.disabled = false; btn.textContent = '💬 Balas Post di Feed'; }
    });

    // DOM Inspector Debug
    document.getElementById('btnDebugDom')?.addEventListener('click', async () => {
      try {
        const res = await sendInteraction('debug_dom', { platform: this.selectedPlatform });
        showInteractResult('🔬 DOM dump berhasil. Buka DevTools Console (F12) untuk melihat, atau tempel dari clipboard ke chat untuk verifikasi selector.');
      } catch (e) {
        showInteractResult('❌ ' + e.message, true);
      }
    });
  }



  // Studio Events
  bindStudioEvents() {
    // Platform Buttons
    const platformBtns = document.querySelectorAll('.platform-btn');
    const groupThreadsMode = document.getElementById('groupThreadsMode');

    platformBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        platformBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedPlatform = btn.dataset.platform;

        if (groupThreadsMode) {
          groupThreadsMode.style.display = this.selectedPlatform === 'threads' ? 'block' : 'none';
        }
        document.querySelectorAll('.variant-card .topic-row').forEach(row => {
          row.style.display = this.selectedPlatform === 'threads' ? 'block' : 'none';
        });
        this.updateAllCards();
      });
    });

    // Set initial visibility based on default platform
    if (groupThreadsMode) groupThreadsMode.style.display = this.selectedPlatform === 'threads' ? 'block' : 'none';
    document.querySelectorAll('.variant-card .topic-row').forEach(row => {
      row.style.display = this.selectedPlatform === 'threads' ? 'block' : 'none';
    });

    // Threads Format Mode Selector Buttons
    this.selectedThreadsMode = 'thread'; // Default: 'thread' (Utas), 'single' (Attachment), 'poll'
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedThreadsMode = btn.dataset.mode;
        const isAttachmentOrPoll = this.selectedThreadsMode === 'attachment' || this.selectedThreadsMode === 'poll';
        document.querySelectorAll('.schedule-row').forEach(row => {
          row.style.display = isAttachmentOrPoll ? 'none' : '';
        });
        document.querySelectorAll('.btn-schedule-variant').forEach(b => {
          b.style.display = isAttachmentOrPoll ? 'none' : '';
        });
        document.querySelectorAll('.variant-card').forEach(card => this.renderCard(card));
        this.updateAllCards();
      });
    });

    // Tone Chips
    const chips = document.querySelectorAll('.chip');
    const customToneInput = document.getElementById('customToneInput');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedTone = chip.dataset.tone;
        if (customToneInput) {
          customToneInput.style.display = chip.dataset.tone === 'custom' ? 'block' : 'none';
        }
      });
    });

    // Varian & Emoji selector
    this.selectedVariants = 1;
    const segBtns = document.querySelectorAll('.seg-btn');
    segBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        segBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedVariants = parseInt(btn.dataset.variant, 10) || 1;
      });
    });

     // Generate Content Button
    const btnGenerate = document.getElementById('btnGenerateStudio');
    const topicInput = document.getElementById('studioTopic');
    const resultWrapper = document.getElementById('studioResultWrapper');

    btnGenerate.addEventListener('click', async () => {
      const topic = topicInput.value.trim();
      if (!topic) {
        alert('Silakan masukkan topik atau ide konten terlebih dahulu.');
        return;
      }

       const useEmoji = document.getElementById('optEmoji')?.checked || false;
       const useImage = document.getElementById('optImage')?.checked || false;

       btnGenerate.disabled = true;
       btnGenerate.innerHTML = '<span>🤖 AI sedang membuat konten...</span>';

    try {
      console.log('[Sidepanel] Generate platform:', this.selectedPlatform, 'threadsFormat:', this.selectedPlatform === 'threads' ? this.selectedThreadsMode : 'N/A');
      await addActivityLog(`Meminta AI Generate (${this.selectedPlatform})`, `Topik: ${topic}`, 'info');
      const res = await AIEngine.generateContent(topic, {
        platform: this.selectedPlatform,
        tone: this.getEffectiveTone(),
        ...(this.selectedPlatform === 'threads' ? { threadsFormat: this.selectedThreadsMode || 'thread' } : {}),
        useEmoji,
        useImage,
        variants: this.selectedVariants
      });
        await addActivityLog(`AI Generasi Berhasil (${this.selectedPlatform})`, `${this.selectedVariants} varian konten`, 'success');

        this.generatedContent = res;
        const variants = this.selectedVariants > 1 ? parseVariants(res, topic) : [parseVariantWithLabel(res, topic)];
        this.renderVariants(resultWrapper, variants);

        resultWrapper.style.display = 'block';
        resultWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        alert('Error: ' + err.toString());
      } finally {
        btnGenerate.disabled = false;
        btnGenerate.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"/></svg>
          <span>Generate Content with AI</span>
        `;
      }
    });
  }

  /**
   * Resolve the tone to send to the AI, reading the custom tone input when selected.
   */
  getEffectiveTone() {
    if (this.selectedTone === 'custom') {
      const custom = document.getElementById('customToneInput')?.value.trim();
      return custom || 'engaging';
    }
    return this.selectedTone;
  }

  /**
   * Get content of a single variant card, joining edited thread parts when in Utas mode.
   */
  getCardContent(card) {
    if (!card) return '';
    const partAreas = card.querySelectorAll('.thread-part-textarea');
    if (partAreas.length > 0) {
      return Array.from(partAreas).map(t => t.value.trim()).filter(Boolean).join('\n\n');
    }
    const output = card.querySelector('.studio-output');
    return output ? output.value : '';
  }

  /**
   * Render N variant cards into the result wrapper. Each card has its own
   * textarea (or Utas parts), char count and Post buttons.
   */
  renderVariants(wrapper, variants) {
    if (!wrapper) return;
    if (!variants || variants.length === 0) {
      wrapper.innerHTML = '<div class="empty-state"><p>Gagal menghasilkan konten. Coba lagi.</p></div>';
      return;
    }
    wrapper.innerHTML = '';

    // Programmatic schedule: one golden-hour slot per variant (no AI needed)
    const schedSlots = nextGoldenSlots(variants.length);

      variants.forEach((item, i) => {
        const text = typeof item === 'string' ? item : (item.text || '');
        const label = typeof item === 'string' ? '' : (item.label || '');
        const imagePrompt = typeof item === 'string' ? '' : (item.imagePrompt || '');
        const scheduledTime = schedSlots[i] || 0;
        const card = document.createElement('div');
        card.className = 'variant-card';
        if (imagePrompt) card.dataset.imagePrompt = imagePrompt;
       const isMulti = variants.length > 1;
       card.innerHTML = `
         <div class="result-header">
           <span>${isMulti ? `Varian ${i + 1}/${variants.length}` : 'Hasil Konten Generasi'}</span>
           <span class="char-count"></span>
         </div>
         <textarea class="studio-output" rows="6"></textarea>
         <div class="thread-parts"></div>
         <div class="topic-row">
           <input type="text" class="topic-input" placeholder="🏷️ Label Topik utas pertama (Komunitas atau Topik) — maks 3 kata" maxlength="40" />
         </div>
         <div class="image-preview-row${imagePrompt ? '' : ' hidden'}">
           <label>🖼️ Preview Gambar</label>
           <div class="image-preview" data-image-prompt="${escapeHtml(imagePrompt)}"></div>
         </div>
         <div class="schedule-row${this.selectedThreadsMode === 'attachment' || this.selectedThreadsMode === 'poll' ? ' hidden' : ''}">
           <label>📅 Jadwal Posting (jam aktif Threads)</label>
           <input type="datetime-local" class="schedule-input" />
         </div>
         <div class="action-row">
           <button class="btn btn-secondary btn-post-variant">🚀 Post ke Tab Aktif</button>
           <button class="btn btn-outline btn-schedule-variant${this.selectedThreadsMode === 'attachment' || this.selectedThreadsMode === 'poll' ? ' hidden' : ''}">📅 Jadwalkan & Post</button>
         </div>
       `;
       wrapper.appendChild(card);

       card.querySelector('.studio-output').value = text;
       if (label) card.querySelector('.topic-input').value = label;
       if (scheduledTime) {
         const d = new Date(scheduledTime);
         const pad = n => String(n).padStart(2, '0');
         card.querySelector('.schedule-input').value =
           `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
       }
       this.renderCard(card);

       if (imagePrompt) {
         this.generateAndShowImage(card, imagePrompt);
       }

      card.querySelector('.studio-output').addEventListener('input', () => this.updateCardCharCount(card));
      card.querySelector('.btn-post-variant').addEventListener('click', () => this.postVariant(card));
      card.querySelector('.btn-schedule-variant').addEventListener('click', () => this.scheduleVariant(card));
    });

    this.updateAllCards();
  }

  /**
   * Render a single card: single textarea or split into Utas parts.
   */
  renderCard(card) {
    if (!card) return;
    const text = this.getCardContent(card);
    const output = card.querySelector('.studio-output');
    const partsBox = card.querySelector('.thread-parts');
    if (!output || !partsBox) return;

    if (this.selectedPlatform === 'threads' && this.selectedThreadsMode === 'thread') {
      output.style.display = 'none';
      this.renderThreadParts(card, text);
    } else {
      partsBox.innerHTML = '';
      partsBox.style.display = 'none';
      output.style.display = 'block';
    }
    this.updateCardCharCount(card);
  }

  /**
   * Split a card's content into individual Utas part textareas (editable).
   */
  renderThreadParts(card, text) {
    const partsBox = card.querySelector('.thread-parts');
    const output = card.querySelector('.studio-output');
    if (!card || !partsBox || !output) return;

    output.style.display = 'none';
    const parts = splitIntoThreadParts(text, 450);
    partsBox.style.display = 'block';
    partsBox.innerHTML = parts.map((p, i) => `
      <div class="thread-part">
        <div class="thread-part-label">Utas ${i + 1}/${parts.length} — ${p.length} karakter</div>
        <textarea class="thread-part-textarea" rows="3" data-part="${i}">${escapeHtml(p)}</textarea>
      </div>
    `).join('');

    partsBox.querySelectorAll('.thread-part-textarea').forEach(ta => {
      ta.addEventListener('input', () => {
        const total = partsBox.querySelectorAll('.thread-part-textarea').length;
        const idx = ta.dataset.part;
        const label = ta.closest('.thread-part')?.querySelector('.thread-part-label');
        if (label) label.textContent = `Utas ${+idx + 1}/${total} — ${ta.value.length} karakter`;
        this.updateCardCharCount(card);
      });
    });
  }

  /**
   * Update the character counter of a single variant card based on platform/mode.
   */
  updateCardCharCount(card) {
    if (!card) return;
    const charCountEl = card.querySelector('.char-count');
    if (!charCountEl) return;
    const text = this.getCardContent(card);
    const len = text.length;
    const platform = this.selectedPlatform;
    const mode = this.selectedThreadsMode || 'thread';

    if (platform === 'threads') {
      if (mode === 'short') {
        charCountEl.style.color = len > 500 ? '#f87171' : 'inherit';
        charCountEl.textContent = `${len} / 500 Karakter (⚡ Post Pendek)`;
      } else if (mode === 'attachment') {
        charCountEl.style.color = len > 10000 ? '#f87171' : 'inherit';
        charCountEl.textContent = `${len} / 10.000 Karakter (📎 Text Attachment)`;
      } else if (mode === 'poll') {
        charCountEl.style.color = len > 1000 ? '#f87171' : 'inherit';
        charCountEl.textContent = `${len} / 1.000 Karakter (📊 Polling)`;
      } else {
        charCountEl.style.color = 'inherit';
        const renderedParts = card.querySelectorAll('.thread-part-textarea').length;
        const parts = renderedParts > 0 ? renderedParts : Math.ceil(len / 450);
        charCountEl.textContent = `${len} Karakter (🧵 ${parts} Utas Thread)`;
      }
    } else if (platform === 'x') {
      charCountEl.style.color = len > 280 ? '#f87171' : 'inherit';
      charCountEl.textContent = `${len} / 280 Karakter`;
    } else {
      charCountEl.style.color = 'inherit';
      charCountEl.textContent = `${len} Karakter`;
    }
  }

  /**
   * Refresh char counters of all visible variant cards (platform/mode change).
   */
   updateAllCards() {
     document.querySelectorAll('.variant-card').forEach(card => this.updateCardCharCount(card));
   }

   async generateAndShowImage(card, imagePrompt) {
     const preview = card.querySelector('.image-preview');
     if (!preview) return;
     preview.innerHTML = '<span style="color:#94a3b8;font-size:11px">⏳ Generate gambar...</span>';
     try {
       const res = await this.sendMessage('GENERATE_IMAGE', { prompt: imagePrompt });
       if (res && res.success && res.data) {
         preview.innerHTML = `<img src="${res.data}" alt="Generated" style="max-width:100%;border-radius:8px;margin-top:4px;" />`;
       } else {
         preview.innerHTML = `<span style="color:#f87171;font-size:11px">Gagal generate gambar</span>`;
       }
     } catch (e) {
       preview.innerHTML = `<span style="color:#f87171;font-size:11px">Error: ${e.message}</span>`;
     }
   }

   // Idea Generator Events (integrated into Studio tab)
  bindIdeaEvents() {
    const ideaNiche = document.getElementById('ideaNiche');
    const btnGenIdeas = document.getElementById('btnGenIdeas');
    const btnRandomIdea = document.getElementById('btnRandomIdea');
    const ideasResult = document.getElementById('ideasResult');
    const ideasList = document.getElementById('ideasList');
    const btnShuffleIdeas = document.getElementById('btnShuffleIdeas');

    if (!btnGenIdeas) return;

    const escapeHtml = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    const setBusy = (busy, label) => {
      btnGenIdeas.disabled = busy;
      btnRandomIdea.disabled = busy;
      btnGenIdeas.textContent = busy ? (label || '🤖 Mencari ide...') : '✨ 10 Ide';
    };

    const generateIdeas = async (count) => {
      const niche = ideaNiche.value.trim();
      const platform = this.selectedPlatform;

      const fullPrompt = (niche ? `Niche/Topik: ${niche}` : 'Tema bebas (boleh dari kehidupan sehari-hari, pengalaman, tips, opini, atau curhatan yang relatable)') + `

TUGAS: Buat ${count} ide konten menarik untuk platform ${platform.toUpperCase()} yang bakal memancing interaksi (like, reply, repost, share).

ATURAN:
1. Setiap ide SATU kalimat saja — spesifik, konkret, dan langsung bisa dieksekusi.
2. Variasikan jenisnya: tips / kisah pribadi / opini / pertanyaan / tren / mitos vs fakta.
3. Format: tulis nomor "1." sampai "${count}.", SATU ide per baris.
4. Jangan tambahkan intro, penjelasan, atau tanda kutip — langsung daftarnya saja.`;

      const res = await AIEngine.generateContent(fullPrompt, {
        platform,
        tone: this.getEffectiveTone(),
        threadsFormat: 'short'
      });
      await addActivityLog(`Ide Konten Dihasilkan (${platform})`, `Niche: ${niche || 'bebas'}`, 'success');
      return parseIdeas(res, count);
    };

    const renderIdeas = (ideas) => {
      ideasResult.style.display = 'block';
      if (!ideas || ideas.length === 0) {
        ideasList.innerHTML = '<div class="idea-item"><span class="idea-text" style="color:#f87171">Tidak ada ide yang bisa diparsing. Coba lagi.</span></div>';
        return;
      }
      ideasList.innerHTML = ideas.map((idea, i) => `
        <div class="idea-item">
          <span class="idea-num">${i + 1}</span>
          <span class="idea-text">${escapeHtml(idea)}</span>
          <button class="btn btn-primary btn-sm idea-gen" data-idea="${escapeHtml(idea)}">✨ Buat</button>
        </div>
      `).join('');

      ideasList.querySelectorAll('.idea-gen').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '🤖 Generating...';
          try {
            await this.generateFromIdea(btn.dataset.idea);
          } catch (e) {
            alert('Error: ' + e.message);
          }
        });
      });
    };

    const showError = (err) => {
      ideasResult.style.display = 'block';
      ideasList.innerHTML = `<div class="idea-item"><span class="idea-text" style="color:#f87171">❌ ${escapeHtml(err.message || err)}</span></div>`;
    };

    btnGenIdeas.addEventListener('click', async () => {
      setBusy(true);
      try {
        renderIdeas(await generateIdeas(10));
      } catch (e) { showError(e); }
      finally { setBusy(false); }
    });

    btnRandomIdea.addEventListener('click', async () => {
      setBusy(true);
      try {
        const ideas = await generateIdeas(1);
        const idea = ideas[0];
        if (!idea) throw new Error('Tidak ada ide yang dihasilkan. Coba lagi.');
        await this.generateFromIdea(idea);
      } catch (e) { alert('Error: ' + e.message); }
      finally { setBusy(false); }
    });

    btnShuffleIdeas?.addEventListener('click', async () => {
      setBusy(true);
      try {
        renderIdeas(await generateIdeas(10));
      } catch (e) { showError(e); }
      finally { setBusy(false); }
    });
  }

  async generateFromIdea(idea) {
    const topicInput = document.getElementById('studioTopic');
    if (topicInput) topicInput.value = idea;

    const btnGenerate = document.getElementById('btnGenerateStudio');
    if (!btnGenerate) return;
    await new Promise(r => setTimeout(r, 50));
    btnGenerate.click();
  }

  // Settings Events
  bindSettingsEvents() {
    const providerSelect = document.getElementById('cfgAiProvider');
    const groupChatgptCookie = document.getElementById('groupChatgptCookie');
    const groupGeminiCookie = document.getElementById('groupGeminiCookie');
    const groupOpenAICompat = document.getElementById('groupOpenAICompat');
    const groupClaudeCompat = document.getElementById('groupClaudeCompat');

    providerSelect.addEventListener('change', () => {
      const val = providerSelect.value;
      groupChatgptCookie.style.display = val === 'cookie_chatgpt' ? 'block' : 'none';
      groupGeminiCookie.style.display = val === 'cookie_gemini' ? 'block' : 'none';
      groupOpenAICompat.style.display = val === 'openai_compat' ? 'block' : 'none';
      groupClaudeCompat.style.display = val === 'claude_compat' ? 'block' : 'none';
    });

    // Auto-Detect ChatGPT Cookie
    document.getElementById('btnAutoDetectChatgptCookie').addEventListener('click', async () => {
      const statusLabel = document.getElementById('statusChatgptCookie');
      statusLabel.textContent = '⏳ Mengambil cookie chatgpt.com...';
      try {
        const cookies = await new Promise(r => chrome.cookies.getAll({ domain: 'chatgpt.com' }, c => r(c || [])));
        if (cookies.length === 0) {
          statusLabel.style.color = '#f87171';
          statusLabel.textContent = '⚠️ Tidak ada cookie ditemukan. Login di chatgpt.com terlebih dahulu.';
          return;
        }
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        document.getElementById('cfgChatgptCookie').value = cookieStr;
        statusLabel.style.color = '#34d399';
        statusLabel.textContent = `✅ Berhasil mendeteksi ${cookies.length} cookie dari chatgpt.com!`;
      } catch (e) {
        statusLabel.style.color = '#f87171';
        statusLabel.textContent = 'Gagal: ' + e.message;
      }
    });

    // Auto-Detect Gemini Cookie
    document.getElementById('btnAutoDetectGeminiCookie').addEventListener('click', async () => {
      const statusLabel = document.getElementById('statusGeminiCookie');
      statusLabel.textContent = '⏳ Mengambil cookie gemini.google.com...';
      try {
        const cookies = await new Promise(r => chrome.cookies.getAll({ domain: 'gemini.google.com' }, c => r(c || [])));
        if (cookies.length === 0) {
          statusLabel.style.color = '#f87171';
          statusLabel.textContent = '⚠️ Tidak ada cookie ditemukan. Login di gemini.google.com terlebih dahulu.';
          return;
        }
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        document.getElementById('cfgGeminiCookie').value = cookieStr;
        statusLabel.style.color = '#34d399';
        statusLabel.textContent = `✅ Berhasil mendeteksi ${cookies.length} cookie dari gemini.google.com!`;
      } catch (e) {
        statusLabel.style.color = '#f87171';
        statusLabel.textContent = 'Gagal: ' + e.message;
      }
    });

    document.getElementById('btnSaveSettings').addEventListener('click', async () => {
       const newSettings = {
         aiProvider: providerSelect.value,
         customChatgptCookie: document.getElementById('cfgChatgptCookie').value.trim(),
         customGeminiCookie: document.getElementById('cfgGeminiCookie').value.trim(),
         apiKey: document.getElementById('cfgApiKey')?.value.trim() || '',
         apiEndpoint: document.getElementById('cfgApiEndpoint')?.value.trim() || '',
         apiModel: document.getElementById('cfgApiModel')?.value.trim() || '',
         claudeApiKey: document.getElementById('cfgClaudeApiKey')?.value.trim() || '',
         claudeEndpoint: document.getElementById('cfgClaudeEndpoint')?.value.trim() || '',
         claudeModel: document.getElementById('cfgClaudeModel')?.value.trim() || '',
         customSystemPrompt: document.getElementById('cfgSystemPrompt').value,
         customTone: document.getElementById('customToneInput')?.value.trim() || '',
         humanTypingSpeed: document.getElementById('cfgTypingSpeed').value,
         imageGenEndpoint: document.getElementById('cfgImageEndpoint')?.value.trim() || '',
         imageGenModel: document.getElementById('cfgImageModel')?.value.trim() || '',
         imageGenApiKey: document.getElementById('cfgImageApiKey')?.value.trim() || ''
       };

       await this.sendMessage('SAVE_SETTINGS', newSettings);
       alert('Pengaturan berhasil disimpan!');
     });
   }

   async loadSettings() {
     try {
       const s = await this.sendMessage('GET_SETTINGS');
       document.getElementById('cfgAiProvider').value = s.aiProvider || 'cookie_gemini';
       document.getElementById('cfgChatgptCookie').value = s.customChatgptCookie || '';
       document.getElementById('cfgGeminiCookie').value = s.customGeminiCookie || '';
       document.getElementById('cfgApiKey').value = s.apiKey || '';
       document.getElementById('cfgApiEndpoint').value = s.apiEndpoint || '';
       document.getElementById('cfgApiModel').value = s.apiModel || '';
       document.getElementById('cfgClaudeApiKey').value = s.claudeApiKey || '';
       const claudeEndpointEl = document.getElementById('cfgClaudeEndpoint');
       const claudeModelEl = document.getElementById('cfgClaudeModel');
       if (claudeEndpointEl) claudeEndpointEl.value = s.claudeEndpoint || '';
       if (claudeModelEl) claudeModelEl.value = s.claudeModel || '';
       document.getElementById('cfgSystemPrompt').value = s.customSystemPrompt || '';
       const customToneInput = document.getElementById('customToneInput');
       if (customToneInput) customToneInput.value = s.customTone || '';
       document.getElementById('cfgTypingSpeed').value = s.humanTypingSpeed || 'medium';
       const imgEndpoint = document.getElementById('cfgImageEndpoint');
       const imgModel = document.getElementById('cfgImageModel');
       const imgApiKey = document.getElementById('cfgImageApiKey');
       if (imgEndpoint) imgEndpoint.value = s.imageGenEndpoint || '';
       if (imgModel) imgModel.value = s.imageGenModel || '';
       if (imgApiKey) imgApiKey.value = s.imageGenApiKey || '';

       document.getElementById('cfgAiProvider').dispatchEvent(new Event('change'));
     } catch (err) {
       console.error('Load Settings Error:', err);
     }
   }

  // Logs Events
  bindLogEvents() {
    const btn = document.getElementById('btnRefreshLogs');
    if (btn) {
      btn.type = 'button';
      btn.addEventListener('click', () => this.loadLogs());
    }
  }

  async loadLogs() {
    const logsList = document.getElementById('logsList');
    const btn = document.getElementById('btnRefreshLogs');
    if (!logsList) return;

    if (btn) {
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '↻ Loading...';
      setTimeout(() => { if (btn) btn.textContent = original; }, 1500);
    }

    try {
      const logs = await this.sendMessage('GET_LOGS');
      if (!logs || logs.length === 0) {
        logsList.innerHTML = `<div class="empty-state"><p>Belum ada riwayat aktivitas.</p></div>`;
        return;
      }

      logsList.innerHTML = logs.map(l => `
        <div class="log-item">
          <div class="log-time">${new Date(l.timestamp).toLocaleTimeString()}</div>
          <div class="log-action">${l.action}</div>
          <small style="color:#94a3b8">${l.details || ''}</small>
        </div>
      `).join('');
      // Auto-scroll to latest log
      logsList.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      console.error('Load Logs Error:', err);
      logsList.innerHTML = `<div class="empty-state"><p>❌ Gagal memuat log: ${escapeHtml(err.message || err)}</p></div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /**
   * Post a single variant card to the active/target tab.
   */
  async postVariant(card, extraOptions = {}) {
    const content = this.getCardContent(card).trim();
    if (!content) return;

    const btn = card.querySelector('.btn-post-variant');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Membuka & Mengirim...'; }

    try {
      const platform = this.selectedPlatform;
      let targetUrl = 'https://www.threads.net';
      let domainKeyword = 'threads.net';
       const threadsTopicLabel = (card.querySelector('.topic-input')?.value || '').trim();
       const imagePrompt = card.dataset.imagePrompt || '';

      if (platform === 'facebook') {
        targetUrl = 'https://www.facebook.com';
        domainKeyword = 'facebook.com';
      } else if (platform === 'x') {
        targetUrl = 'https://x.com';
        domainKeyword = 'x.com';
      } else {
        targetUrl = 'https://www.threads.com';
        domainKeyword = 'threads'; // Matches threads.com and threads.net!

        // If a profile handle is set, aim at the user's own profile page
        try {
          const settings = await this.sendMessage('GET_SETTINGS');
          const handle = (settings.threadsProfileHandle || '').replace(/^@/, '').trim();
          if (handle) targetUrl = `https://www.threads.com/@${handle}`;
        } catch (e) { /* keep default targetUrl */ }
      }

      // 1. Check all open tabs for target platform
      const allTabs = await new Promise(r => chrome.tabs.query({}, r));
      let targetTab = allTabs.find(t => t.url && (t.url.toLowerCase().includes(domainKeyword) || (platform === 'x' && t.url.toLowerCase().includes('twitter.com'))));

      const waitForTabComplete = (tabId) => new Promise(r => {
        const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); r(); }, 6000);
        const listener = (id, changeInfo) => {
          if (id === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timeout);
            r();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      if (!targetTab) {
        // Tab not open -> Automatically open new tab & switch to it
        targetTab = await new Promise(r => chrome.tabs.create({ url: targetUrl, active: true }, r));
        await waitForTabComplete(targetTab.id);
      } else {
        // Navigate the existing tab to the profile page (only for Threads with a set handle)
        const needsNavigate = platform === 'threads' && targetUrl !== 'https://www.threads.com' &&
          targetTab.url && !targetTab.url.toLowerCase().startsWith(targetUrl.toLowerCase());
        if (needsNavigate) {
          await chrome.tabs.update(targetTab.id, { active: true, url: targetUrl });
          await waitForTabComplete(targetTab.id);
        } else {
          // Switch to existing open tab
          await chrome.tabs.update(targetTab.id, { active: true });
        }
      }

      // Small delay for DOM content script initialization
      await new Promise(r => setTimeout(r, 1000));

      // 2. Send EXECUTE_AUTO_POST with dynamic content script injection fallback
    const postMessage = {
      action: 'EXECUTE_AUTO_POST',
      payload: {
        content,
        options: {
          ...(this.selectedPlatform === 'threads'
            ? { threadsMode: this.selectedThreadsMode || 'thread', threadsTopicLabel, threadsScheduledTime: extraOptions.scheduledTime || 0 }
            : { facebookMode: 'post' }),
          imagePrompt
        }
      }
    };

      const res = await new Promise((resolve, reject) => {
        const tabId = targetTab.id;
        chrome.tabs.sendMessage(tabId, postMessage, async (response) => {
          if (chrome.runtime.lastError) {
            console.log('[Sidepanel] Content script not loaded in target tab yet, injecting dynamically...');
            try {
              // Dynamically inject content script bundle into target tab on the fly
              await chrome.scripting.executeScript({
                target: { tabId },
                files: ['public/content_main.bundle.js']
              });
              await new Promise(r => setTimeout(r, 800));

              // Retry message after dynamic injection
              chrome.tabs.sendMessage(tabId, postMessage, (retryRes) => {
                if (chrome.runtime.lastError) {
                  return reject(new Error(`Silakan refresh tab ${platform.toUpperCase()} (F5) terlebih dahulu.`));
                }
                if (!retryRes || !retryRes.success) {
                  return reject(new Error(retryRes ? retryRes.error : 'Gagal memposting ke ' + platform));
                }
                resolve(retryRes.result);
              });
            } catch (injErr) {
              reject(new Error(`Refresh tab ${platform.toUpperCase()} di browser Anda terlebih dahulu.`));
            }
          } else {
            if (!response || !response.success) {
              return reject(new Error(response ? response.error : 'Gagal memposting ke ' + platform));
            }
            resolve(response.result);
          }
        });
      });

      alert(res.message || `Post berhasil diisikan ke tab ${platform.toUpperCase()}!`);
    } catch (err) {
      alert('Info: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Post ke Tab Aktif'; }
    }
  }

  /**
   * Schedule & post a single variant card using the platform's NATIVE schedule
   * dialog. Reads the card's schedule time (AI/programmatic or user-edited).
   */
  async scheduleVariant(card) {
    const content = this.getCardContent(card).trim();
    if (!content) return;

    let scheduledTime = Date.now() + 60 * 60 * 1000;
    const schedInput = card.querySelector('.schedule-input');
    if (schedInput && schedInput.value) {
      const t = new Date(schedInput.value).getTime();
      if (!isNaN(t)) scheduledTime = t;
    } else {
      scheduledTime = nextGoldenSlots(1)[0] || Date.now() + 60 * 60 * 1000;
    }

    const when = scheduledTime > Date.now()
      ? `pada ${new Date(scheduledTime).toLocaleString('id-ID')}`
      : 'segera';
    const platformLabel = this.selectedPlatform === 'facebook' ? 'Facebook'
      : this.selectedPlatform === 'x' ? 'X (Twitter)'
      : 'Threads';
    alert(`⏳ Membuka ${platformLabel} untuk menjadwalkan post ${when}...`);
    await this.postVariant(card, { scheduledTime });
  }

   // Helper Message Sender
  sendMessage(action, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, payload }, (res) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
        if (!res || !res.success) return reject(res ? res.error : 'Request failed');
        resolve(res.data);
      });
    });
  }

  async getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0] || null);
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new SidepanelApp();
  app.init();
});
