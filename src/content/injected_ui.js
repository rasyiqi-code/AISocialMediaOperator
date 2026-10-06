/**
 * Injected Floating AI Assist UI Widget
 */

import { simulateHumanTyping } from '../utils/dom_helpers.js';

export class InjectedUIWidget {
  constructor(platformName) {
    this.platform = platformName; // 'threads', 'facebook', 'x'
    this.activeInput = null;
    this.floatingBtn = null;
    this.selectedTone = 'engaging';
  }

  init() {
    this.startObserver();
  }

  startObserver() {
    // Periodically search for composer elements on page
    setInterval(() => {
      this.detectAndAttachWidget();
    }, 1500);
  }

  detectAndAttachWidget() {
    let selector = '';
    if (this.platform === 'x') {
      selector = 'div[data-testid="tweetTextarea_0"], div[role="textbox"]';
    } else if (this.platform === 'threads') {
      selector = 'div[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"]';
    } else if (this.platform === 'facebook') {
      selector = 'div[contenteditable="true"][role="textbox"], div[role="dialog"] div[contenteditable="true"]';
    }

    const inputs = document.querySelectorAll(selector);
    inputs.forEach(input => {
      if (input.dataset.aiWidgetAttached) return;
      input.dataset.aiWidgetAttached = 'true';

      // Attach floating button near input box
      this.attachButton(input);
    });
  }

  attachButton(targetInput) {
    const btn = document.createElement('div');
    btn.className = 'ai-operator-floating-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"/>
      </svg>
      <span>✨ AI Assist</span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.activeInput = targetInput;
      this.openPromptModal();
    });

    // Attach to composer dialog/root to prevent inner overflow clipping
    const composerRoot = targetInput.closest('div[role="dialog"]') ||
                         targetInput.closest('article') ||
                         targetInput.closest('form') ||
                         targetInput.parentElement;

    if (composerRoot) {
      if (composerRoot.querySelector('.ai-operator-floating-btn')) return;
      if (getComputedStyle(composerRoot).position === 'static') {
        composerRoot.style.position = 'relative';
      }
      btn.style.position = 'absolute';
      btn.style.right = '20px';
      btn.style.top = '52px';
      btn.style.zIndex = '99999';
      composerRoot.appendChild(btn);
    }
  }

  openPromptModal() {
    const existingModal = document.querySelector('.ai-operator-modal-overlay');
    if (existingModal) existingModal.remove();

    // Detect existing text in active input
    let existingText = '';
    if (this.activeInput) {
      existingText = (this.activeInput.value || this.activeInput.innerText || '').trim();
    }

    const overlay = document.createElement('div');
    overlay.className = 'ai-operator-modal-overlay';
    overlay.innerHTML = `
      <div class="ai-operator-modal">
        <div class="ai-operator-modal-header">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"/>
            </svg>
            AI Content Assistant (${this.platform.toUpperCase()})
          </h3>
          <button class="ai-operator-modal-close">&times;</button>
        </div>
        <div class="ai-operator-modal-body">
          <label class="ai-operator-field-label">Topik, Ide Konten, atau Teks Draf</label>
          <input type="text" class="ai-operator-input" id="aiTopicInput" placeholder="Misal: 5 Tips Produktivitas Kerja Remote" value="${existingText ? existingText.replace(/"/g, '&quot;') : ''}" />

          <label class="ai-operator-field-label">Quick AI Actions</label>
          <div class="ai-operator-pills" style="margin-bottom:10px;">
            <button class="ai-operator-pill action-chip" data-action="rewrite">🪄 Polish & Rapikan Draf</button>
            <button class="ai-operator-pill action-chip" data-action="bullets">🧵 Ubah ke Poin-Poin</button>
            <button class="ai-operator-pill action-chip" data-action="translate">🌐 Terjemahkan Bahasa Inggris</button>
          </div>

          <label class="ai-operator-field-label">Pilih Tone Konten</label>
          <div class="ai-operator-pills">
            <button class="ai-operator-pill active tone-chip" data-tone="engaging">🔥 Viral / Engaging</button>
            <button class="ai-operator-pill tone-chip" data-tone="professional">💼 Profesional</button>
            <button class="ai-operator-pill tone-chip" data-tone="casual">😊 Santai / Storytelling</button>
            <button class="ai-operator-pill tone-chip" data-tone="humorous">😄 Lucu / Humor</button>
          </div>

          <button class="ai-operator-btn-generate" id="aiBtnSubmit">
            <span>Buat Konten AI & Isikan</span>
          </button>

          <div id="aiResultContainer" style="display:none;">
            <div class="ai-operator-result-box" id="aiResultBox"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const topicInput = overlay.querySelector('#aiTopicInput');

    // Bind Action Chips
    const actionChips = overlay.querySelectorAll('.action-chip');
    actionChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const actionType = chip.dataset.action;
        const currentInputVal = topicInput.value.trim();
        if (actionType === 'rewrite') {
          topicInput.value = currentInputVal ? `Polish & perbaiki draf ini agar lebih menarik: "${currentInputVal}"` : 'Perbaiki draf postingan saya agar lebih profesional & rapi';
        } else if (actionType === 'bullets') {
          topicInput.value = currentInputVal ? `Ubah teks ini jadi poin-poin thread menarik: "${currentInputVal}"` : 'Buat ringkasan poin-poin singkat tentang topik ini';
        } else if (actionType === 'translate') {
          topicInput.value = currentInputVal ? `Terjemahkan ke Bahasa Inggris gaya sosial media: "${currentInputVal}"` : 'Terjemahkan pesan ini ke Bahasa Inggris';
        }
      });
    });

    // Close listener
    overlay.querySelector('.ai-operator-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Tone selection listeners
    const pills = overlay.querySelectorAll('.ai-operator-pill');
    pills.forEach(p => {
      p.addEventListener('click', () => {
        pills.forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        this.selectedTone = p.dataset.tone;
      });
    });

    // Submit listener
    const submitBtn = overlay.querySelector('#aiBtnSubmit');
    topicInput.focus();

    submitBtn.addEventListener('click', async () => {
      const topic = topicInput.value.trim();
      if (!topic) {
        topicInput.style.borderColor = '#ef4444';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>🤖 Generating content...</span>';

      try {
        // Send request to background service worker
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'GENERATE_CONTENT',
            payload: {
              prompt: topic,
              platform: this.platform,
              tone: this.selectedTone,
              threadsFormat: 'short'
            }
          }, (res) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
            if (!res || !res.success) return reject(res ? res.error : 'Gagal menghasilkan konten');
            resolve(res.data);
          });
        });

        // Clean metadata headers before typing
        const cleanedText = (response || '')
          .replace(/^TOPIC LABEL:\s*.+$/im, '')
          .replace(/^===VARIANT\s*\d+===/im, '')
          .replace(/^===(IMAGE|POLL)===.+$/im, '')
          .replace(/<[^>]*>/g, '')
          .trim();

        // Fill content into input
        overlay.remove();
        if (this.activeInput) {
          await simulateHumanTyping(this.activeInput, cleanedText, 'medium');
        }

      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Buat Konten AI & Isikan</span>';
        const resBox = overlay.querySelector('#aiResultBox');
        const resContainer = overlay.querySelector('#aiResultContainer');
        resContainer.style.display = 'block';
        resBox.style.color = '#f87171';
        resBox.textContent = 'Error: ' + err.toString();
      }
    });
  }
}
