/**
 * Threads (threads.net) Platform Adapter
 */

import { waitForElement, simulateHumanTyping, randomDelay } from '../../utils/dom_helpers.js';
import { splitIntoThreadParts } from '../../utils/text_utils.js';
import { GeneralHelpers } from './general_helpers.js';

export const ThreadsAdapter = {
  name: 'Threads',

  /**
   * Find composer textbox or open modal if closed
   */
  async getComposerInput() {
    // 1. Check if composer input is already visible on page
    let input = document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                document.querySelector('div[data-lexical-editor="true"]') ||
                document.querySelector('div[contenteditable="true"]');

    if (input) {
      // Activate the inline composer (it exists in DOM even before being
      // clicked, but needs focus to accept input)
      try { input.click(); input.focus(); } catch (e) {}
      return input;
    }

    // 2. Try finding & clicking the composer trigger (verified labels from
    //    live threads.com DOM dump: "Kolom teks kosong. Ketik untuk menulis
    //    postingan baru." on a div[role="button"], plus legacy labels).
    const candidateBtns = [
      document.querySelector('a[href*="/create"]'),
      document.querySelector('[aria-label="New thread"]'),
      document.querySelector('[aria-label="Utas baru"]'),
      document.querySelector('[aria-label*="Create"]'),
      document.querySelector('[aria-label*="Kolom teks kosong"]'),
      document.querySelector('[aria-label*="menulis postingan baru"]'),
      document.querySelector('[aria-label*="Apa yang Anda pikirkan"]'),
      document.querySelector('[aria-label*="Apa yang baru"]'),
      ...Array.from(document.querySelectorAll('div[role="button"], a')).filter(el => {
        const txt = (el.textContent || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        return txt.includes('start a thread') ||
               txt.includes('apa yang anda pikirkan') ||
               txt.includes('apa yang baru') ||
               aria.includes('kolom teks kosong') ||
               aria.includes('menulis postingan baru');
      })
    ].filter(Boolean);

    for (const btn of candidateBtns) {
      try {
        if (btn && typeof btn.click === 'function') {
          btn.click();
        } else if (btn) {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        await randomDelay(1, 2);
        
        input = document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                document.querySelector('div[data-lexical-editor="true"]') ||
                document.querySelector('div[contenteditable="true"]');
        if (input) return input;
      } catch (e) {}
    }

    const res = await waitForElement([
      'div[contenteditable="true"][role="textbox"]',
      'div[data-lexical-editor="true"]',
      'div[contenteditable="true"]'
    ], 3000).catch(() => null);

    return res ? res.element : null;
  },

  /**
   * Split long text into thread parts under maxChars each. See utils/text_utils.js
   */
  splitIntoThreadParts(text, maxChars = 450) {
    return splitIntoThreadParts(text, maxChars);
  },

  /**
   * Post content to Threads (Supports Multi-Post Utas Threads & Paragraph Preservations)
   */
   async createPost(contentText, options = {}) {
     const mode = options.threadsMode || 'thread';

     if (mode === 'attachment') {
       return this.createAttachmentPost(contentText, options);
     }

     if (mode === 'poll') {
       return this.createPollPost(contentText, options);
     }

     const isSingleMode = mode === 'short' || mode === 'single';
     const threadParts = isSingleMode ? [contentText] : this.splitIntoThreadParts(contentText, 450);
     const typingSpeed = options.humanTypingSpeed || 'fast';

     let currentInput = await this.getComposerInput();
     if (!currentInput) throw new Error('Input Threads tidak ditemukan. Pastikan Anda berada di halaman threads.com');

     if (options.imagePrompt) {
       console.log('[Threads] Image prompt received:', options.imagePrompt);
       await this.uploadImageToComposer(currentInput, options.imagePrompt);
       await randomDelay(1, 2);
     }

     for (let i = 0; i < threadParts.length; i++) {
      const partText = threadParts[i];

      if (i > 0) {
        const addThreadBtn = this.findAddThreadButton(currentInput);
        if (addThreadBtn) {
          try {
            addThreadBtn.scrollIntoView?.({ block: 'center' });
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
              addThreadBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            });
          } catch (e) {}

          await randomDelay(1.5, 2.5);

          const newInput = this.findComposerInputBelow(currentInput);
          if (newInput) currentInput = newInput;
        }
      }

      await simulateHumanTyping(currentInput, partText, typingSpeed);
      await randomDelay(1, 2);

      if (i === 0 && options.threadsTopicLabel) {
        await this.fillThreadsTopic(currentInput, options.threadsTopicLabel);
      }
    }

    const composerRoot = currentInput.closest('div[role="dialog"]') || currentInput.closest('div[data-testid*="composer"]') || document;

    if (options.threadsScheduledTime) {
      const when = new Date(options.threadsScheduledTime);
      const ok = await GeneralHelpers.schedulePost({
        composerRoot,
        tag: 'Threads',
        chipRegex: /posting hari ini pukul|post today at|jadwal/i,
        moreRegex: /^(lainnya|more|opsi postingan)$/i,
        itemRegex: /^jadwalkan/i,
        confirmRegexes: [/^jadwalkan$/i, /^kirim$/i, /^post$/i]
      }, when);
      return {
        success: true,
        message: ok
          ? `Post dijadwalkan ${when.toLocaleString('id-ID')} melalui jadwal Threads`
          : `Konten terisi. Jadwal native belum berhasil diset (target ${when.toLocaleString('id-ID')}) — lihat log [Threads].`
      };
    }

    const postBtn = Array.from(composerRoot.querySelectorAll('div[role="button"], button')).find(el => {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const txt = (el.textContent || '').trim().toLowerCase();
      return aria === 'post' || aria === 'posting' || aria === 'kirim' || txt === 'post' || txt === 'posting';
    });

    if (postBtn) {
      postBtn.click();
      await randomDelay(2, 3);
      return {
        success: true,
        message: threadParts.length > 1
          ? `Berhasil memposting ${threadParts.length} bagian Utas (Thread) ke Threads!`
          : 'Berhasil memposting ke Threads!'
      };
    }

    return {
      success: true,
      message: threadParts.length > 1
        ? `Berhasil mengisikan ${threadParts.length} bagian Utas (Thread) ke Threads!`
        : 'Berhasil mengisikan postingan ke Threads!'
    };
  },

  /**
   * Post a long-form text attachment on Threads.
   * Single post: main input ("Edit utas..." / isi postingan) + text attachment card ("Tuliskan lebih banyak lagi...")
   */
  async createAttachmentPost(contentText, options = {}) {
    const typingSpeed = options.humanTypingSpeed || 'fast';

    let mainInput = await this.getComposerInput();
    if (!mainInput) throw new Error('Input Threads tidak ditemukan. Pastikan Anda berada di halaman threads.com');

    // Extract title/caption for the main post field ("Edit utas...")
    const cleanLines = (contentText || '').split('\n').map(l => l.trim()).filter(Boolean);
    let titleText = options.attachmentTitle || options.postTitle || (cleanLines[0] ? cleanLines[0].replace(/^[#*-\s]+/, '').trim() : 'Utas Teks Lampiran');
    if (titleText.length > 120) {
      titleText = titleText.substring(0, 117) + '...';
    }

    // Fill main input initially with short title/caption
    try { mainInput.click(); mainInput.focus(); } catch (e) {}
    await simulateHumanTyping(mainInput, titleText, typingSpeed);
    await randomDelay(1, 2);

    let lampirkanBtn = GeneralHelpers.findByText(document, /^Lampirkan teks$/i, 20)
      || GeneralHelpers.findByText(mainInput.closest('div[role="dialog"]') || document, /^Lampirkan teks$/i, 20);

    if (!lampirkanBtn) throw new Error('Tombol "Lampirkan teks" tidak ditemukan');
    GeneralHelpers.clickElement(lampirkanBtn);
    await randomDelay(1, 2);

    const bodyResult = await waitForElement([
      'div[aria-placeholder="Tuliskan lebih banyak lagi..."][contenteditable="true"]',
      'div[data-lexical-editor="true"][aria-placeholder="Tuliskan lebih banyak lagi..."]'
    ], 5000).catch(() => null);
    const bodyInput = bodyResult ? bodyResult.element : null;
    if (!bodyInput) throw new Error('Editor body "Tuliskan lebih banyak lagi..." tidak ditemukan');

    await simulateHumanTyping(bodyInput, contentText, typingSpeed);
    await randomDelay(1, 2);

    const selesaiBtn = GeneralHelpers.findByText(document, /^Selesai$/i, 20);
    if (selesaiBtn) {
      GeneralHelpers.clickElement(selesaiBtn);
      await randomDelay(1.5, 2.5);
    }

    // IMPORTANT: Make sure main post input field ("Edit utas..." / isi postingan) is filled with titleText!
    mainInput = await this.getComposerInput();
    if (mainInput) {
      const currentMainText = (mainInput.textContent || mainInput.innerText || '').trim();
      if (!currentMainText) {
        await simulateHumanTyping(mainInput, titleText, typingSpeed);
        await randomDelay(1, 2);
      }
    }

    if (options.threadsTopicLabel && mainInput) {
      await this.fillThreadsTopic(mainInput, options.threadsTopicLabel);
    }

    const composerRoot = (mainInput && mainInput.closest('div[role="dialog"]')) || document;

    if (options.threadsScheduledTime) {
      const when = new Date(options.threadsScheduledTime);
      const ok = await GeneralHelpers.schedulePost({
        composerRoot,
        tag: 'Threads',
        chipRegex: /posting hari ini pukul|post today at|jadwal/i,
        moreRegex: /^(lainnya|more|opsi postingan)$/i,
        itemRegex: /^jadwalkan/i,
        confirmRegexes: [/^jadwalkan$/i, /^kirim$/i, /^post$/i]
      }, when);
      return {
        success: true,
        message: ok
          ? `Text attachment post dijadwalkan ${when.toLocaleString('id-ID')} melalui jadwal Threads`
          : `Konten text attachment terisi. Jadwal native belum berhasil diset (target ${when.toLocaleString('id-ID')}) — lihat log [Threads].`
      };
    }

    const postBtn = Array.from(composerRoot.querySelectorAll('div[role="button"], button')).find(el => {
      const txt = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const disabled = el.getAttribute('aria-disabled') === 'true';
      return !disabled && (txt === 'kirim' || txt === 'post' || txt === 'posting' || aria === 'post' || aria === 'posting' || aria === 'kirim');
    });

    if (postBtn) {
      postBtn.click();
      await randomDelay(2, 3);
      return { success: true, message: 'Berhasil memposting text attachment ke Threads!' };
    }

    return { success: true, message: 'Konten text attachment & isi postingan terisi. Klik Kirim untuk memposting.' };
  },

  /**
   * Post a poll on Threads.
   * Flow: click "Tambahkan polling" → type question → type options → set duration → post.
   */
  async createPollPost(contentText, options = {}) {
    const typingSpeed = options.humanTypingSpeed || 'fast';

    let mainInput = await this.getComposerInput();
    if (!mainInput) throw new Error('Input Threads tidak ditemukan. Pastikan Anda berada di halaman threads.com');

    const tambahPollingBtn = GeneralHelpers.findByText(document, /^Tambahkan polling$/i, 20)
      || GeneralHelpers.findByText(mainInput.closest('div[role="dialog"]') || document, /^Tambahkan polling$/i, 20);
    if (!tambahPollingBtn) throw new Error('Tombol "Tambahkan polling" tidak ditemukan');
    GeneralHelpers.clickElement(tambahPollingBtn);
    await randomDelay(1, 2);

    const parts = contentText.split('\n').map(p => p.trim()).filter(Boolean);
    const question = parts[0] || contentText;
    const pollOptions = parts.slice(1);

    await simulateHumanTyping(mainInput, question, typingSpeed);
    await randomDelay(1, 2);

    const pollInputs = Array.from(document.querySelectorAll('input[dir="ltr"]')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.offsetParent !== null && el !== mainInput;
    });

    for (let i = 0; i < Math.min(pollOptions.length, pollInputs.length); i++) {
      await simulateHumanTyping(pollInputs[i], pollOptions[i], typingSpeed);
      await randomDelay(0.5, 1);
    }

    const durasiBtn = GeneralHelpers.findByText(document, /^Berakhir dalam/i, 20)
      || GeneralHelpers.findByText(mainInput.closest('div[role="dialog"]') || document, /^Berakhir dalam/i, 20);
    if (durasiBtn) {
      GeneralHelpers.clickElement(durasiBtn);
      await randomDelay(0.5, 1);
      await randomDelay(1, 2);
    }

    if (options.threadsTopicLabel) {
      await this.fillThreadsTopic(mainInput, options.threadsTopicLabel);
    }

    const composerRoot = mainInput.closest('div[role="dialog"]') || document;

    const postBtn = Array.from(composerRoot.querySelectorAll('div[role="button"], button')).find(el => {
      const txt = (el.textContent || '').trim().toLowerCase();
      return txt === 'kirim' || txt === 'post' || txt === 'posting';
    });

    if (postBtn) {
      postBtn.click();
      await randomDelay(2, 3);
      return { success: true, message: 'Berhasil memposting polling ke Threads!' };
    }

    return { success: true, message: 'Konten polling terisi. Klik Kirim untuk memposting.' };
  },

  /**
   * Find the "Tambahkan ke utas" / "Add to thread" button (creates the next
   * thread item). Tries aria-labels first, then text inside the composer, then
   * a global text fallback.
   */
  findAddThreadButton(currentInput) {
    const labelSelectors = [
      '[aria-label*="Tambahkan ke utas"]',
      '[aria-label*="Add to thread"]',
      '[aria-label*="Tambah utas"]',
      '[aria-label*="add to thread"]'
    ];
    for (const sel of labelSelectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    const matchesText = (el) => {
      if (!el) return false;
      const txt = (el.textContent || '').trim().toLowerCase();
      return txt === 'tambahkan ke utas' || txt === 'add to thread' || txt === 'tambah utas';
    };

    // Scope to the composer area first (dialog or a common ancestor)
    const root = (currentInput && currentInput.closest('div[role="dialog"]')) ||
                 (currentInput && currentInput.closest('div[data-testid*="composer"]')) ||
                 document;
    const candidates = Array.from(root.querySelectorAll('div[role="button"], button, span'));
    for (const el of candidates) {
      if (matchesText(el) && (el.children.length <= 2)) return el;
    }

    // Global fallback
    return Array.from(document.querySelectorAll('*')).find(el => {
      if (!el || el.children.length > 2) return false;
      return matchesText(el);
    });
  },

  /**
   * Find the newly created thread composer input: the first visible composer
   * input strictly below the current one (same column). Falls back to the last
   * composer input inside the same container if the new item is not laid out yet.
   */
  findComposerInputBelow(currentInput) {
    if (!currentInput) return null;
    const currentRect = currentInput.getBoundingClientRect();

    const candidates = Array.from(document.querySelectorAll(
      'div[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"], div[contenteditable="true"]'
    )).filter(el => {
      if (el === currentInput) return false;
      if (el.getBoundingClientRect().width <= 0) return false; // not rendered
      const r = el.getBoundingClientRect();
      return r.top > currentRect.top + 2 && Math.abs(r.left - currentRect.left) < 300;
    });

    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (candidates[0]) return candidates[0];

    // Fallback: last composer input within the same container (thread items are
    // siblings under one composer container).
    const container = currentInput.closest('div[role="dialog"]') ||
                      currentInput.closest('div[data-testid*="composer"]') ||
                      currentInput.parentElement?.parentElement ||
                      document;
    const inContainer = Array.from(container.querySelectorAll(
      'div[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"], div[contenteditable="true"]'
    )).filter(el => el !== currentInput && el.getBoundingClientRect().width > 0);
    return inContainer[inContainer.length - 1] || null;
  },

  /**
   * Find the "Komunitas atau topik" (Community or topic) field that lives on
   * the FIRST thread item. Threads labels this field via aria-placeholder /
   * aria-label ("Komunitas atau topik"), so we scan placeholder, aria-label,
   * aria-placeholder AND visible text across editable elements.
   */
  findTopicField(firstInput) {
    const root = (firstInput && firstInput.closest('div[role="dialog"]')) ||
                 (firstInput && firstInput.closest('div[data-testid*="composer"]')) ||
                 document;

    const patterns = [
      'input[placeholder*="topik" i]',
      'input[placeholder*="komunitas" i]',
      'input[aria-label*="topik" i]',
      'input[aria-label*="komunitas" i]',
      'input[aria-placeholder*="topik" i]',
      'input[aria-placeholder*="komunitas" i]',
      '[role="combobox"][aria-label*="topik" i]',
      '[role="combobox"][aria-label*="komunitas" i]',
      '[role="combobox"][aria-placeholder*="topik" i]',
      '[role="combobox"][aria-placeholder*="komunitas" i]',
      '[role="textbox"][aria-label*="topik" i]',
      '[role="textbox"][aria-label*="komunitas" i]',
      '[role="textbox"][aria-placeholder*="topik" i]',
      '[role="textbox"][aria-placeholder*="komunitas" i]',
      'div[contenteditable="true"][aria-label*="topik" i]',
      'div[contenteditable="true"][aria-label*="komunitas" i]',
      'div[contenteditable="true"][aria-placeholder*="topik" i]',
      'div[contenteditable="true"][aria-placeholder*="komunitas" i]',
      '[aria-label*="tambahkan topik" i]',
      '[aria-label*="tambahkan komunitas" i]',
      '[placeholder*="topik" i]',
      '[placeholder*="komunitas" i]',
      '[aria-placeholder*="topik" i]',
      '[aria-placeholder*="komunitas" i]'
    ];
    for (const sel of patterns) {
      const el = root.querySelector(sel);
      if (el && el.isConnected) return el;
    }

    // Text fallback: any editable element whose placeholder/aria/text mentions topik
    const all = Array.from(root.querySelectorAll(
      'input, [contenteditable="true"], [role="combobox"], [role="textbox"]'
    ));
    return all.find(el => {
      const get = (n) => (el.getAttribute && (el.getAttribute(n) || '')) || '';
      const meta = (
        get('placeholder') + ' ' +
        get('aria-label') + ' ' +
        get('aria-placeholder') + ' ' +
        (el.textContent || '').slice(0, 60)
      ).toLowerCase();
      return /topik|komunitas|topic|community/.test(meta);
    }) || null;
  },

  /**
   * Find the actual editable element once the topic field is active: a popup /
   * expanded search box (possibly rendered in a React portal outside the dialog)
   * may have appeared after clicking, so re-scan the whole document for a
   * visible editable whose placeholder/aria/text mentions topik.
   */
  findActiveTopicInput(firstInput) {
    const all = Array.from(document.querySelectorAll(
      'input, textarea, [contenteditable="true"], [role="combobox"], [role="textbox"]'
    )).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.offsetParent !== null;
    });
    return all.find(el => {
      const get = (n) => (el.getAttribute && (el.getAttribute(n) || '')) || '';
      const meta = (
        get('placeholder') + ' ' +
        get('aria-label') + ' ' +
        get('aria-placeholder') + ' ' +
        (el.textContent || '').slice(0, 60)
      ).toLowerCase();
      return /topik|komunitas|topic|community/.test(meta);
    }) || null;
  },

  /**
   * Type short text into the topic field. For plain inputs uses the React value
   * tracker trick (native setter + input/change), then verifies the value, then
   * confirms with Enter.
   */
  async typeTopicText(el, text) {
    if (!el) return false;
    try {
      el.focus();
      try { el.click(); } catch (e) {}

      const isCE = el.isContentEditable || el.getAttribute('contenteditable') === 'true';

      if (isCE) {
        // Place caret at the start of the field
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (e) {}

        // Type char-by-char so the editor registers each insertion
        for (const ch of text) {
          el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: ch
          }));
          await new Promise(r => setTimeout(r, 25 + Math.random() * 40));
        }
      } else {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) nativeSetter.call(el, text);
        else el.value = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        // Belt & suspenders: if the value still did not stick, use the classic
        // insertText-through-the-focused-element path (fires real input events).
        if (!(el.value || '').includes(text)) {
          try { el.select(); } catch (e) {}
          try { document.execCommand('selectAll', false, null); } catch (e) {}
          document.execCommand('insertText', false, text);
        }
      }

      // Confirm the topic (Enter) to close the suggestion list
      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      }

      await new Promise(r => setTimeout(r, 200));
      const ownVal = isCE ? (el.textContent || '') : (el.value || '');
      if (ownVal.includes(text)) return true;
      // Typing may have gone into the actually-focused element (portal input)
      const ae = document.activeElement;
      if (ae && ae !== el && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        return ((ae.value || ae.textContent || '')).includes(text);
      }
      return false;
    } catch (e) {
      return false;
    }
  },

  /**
   * Fill the "Komunitas atau topik" label on the first thread item (max 3 words).
   */
  async fillThreadsTopic(firstInput, label) {
    if (!label) return false;
    const field = this.findTopicField(firstInput);
    if (!field) {
      console.warn('[Threads] Field "Komunitas atau topik" tidak ditemukan — label dilewati:', label);
      return false;
    }

    const words = label.split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    if (!words) return false;

    try {
      field.scrollIntoView?.({ block: 'center' });

      // The actual editable may be a nested contenteditable inside the field
      const inner = field.matches('[contenteditable="true"]') ? field
        : field.querySelector('div[contenteditable="true"], [contenteditable="true"], input, textarea') || field;

      inner.focus();
      try { inner.click(); } catch (e) {}

      // A combobox may expand into a search box only after activation
      await new Promise(r => setTimeout(r, 700));

      // Prefer the element that actually received focus (portal popup search
      // box), otherwise re-scan the whole document for a visible topic field.
      const ae = document.activeElement;
      const isEditable = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable || ae.getAttribute('contenteditable') === 'true');
      const active = (isEditable ? ae : null) || this.findActiveTopicInput(firstInput) || inner;

      console.log('[Threads] Mengisi label topik:', words, '→', active.tagName, '(', (active.getAttribute('placeholder') || active.getAttribute('aria-placeholder') || ''), ')');

       const typed = await this.typeTopicText(active, words);
       if (!typed) console.warn('[Threads] Teks label tidak masuk ke field topik:', words);
       else console.log('[Threads] Label topik berhasil diisi:', words);
       await new Promise(r => setTimeout(r, 500));
       return typed;
     } catch (e) {
       console.warn('[Threads] Gagal mengisi label topik:', e.message);
       return false;
     }
   },

   /**
    * Upload an image to the Threads composer.
    * Tries to click "Lampirkan media" and handle the file input.
    * If image generation is not available, logs the prompt for manual use.
    */
   async uploadImageToComposer(composerInput, imagePrompt) {
     console.log('[Threads] Image prompt for generation:', imagePrompt);

     try {
       const imageUrl = await this.generateImage(imagePrompt);
       if (!imageUrl) throw new Error('No image URL returned');

       const imageResponse = await fetch(imageUrl);
       const blob = await imageResponse.blob();
       const file = new File([blob], 'generated-image.png', { type: 'image/png' });

       const dt = new DataTransfer();
       dt.items.add(file);

       const dataTransferItem = dt.items[0];
       const kind = dataTransferItem.kind;
       const type = dataTransferItem.type;

       const pasteEvent = new ClipboardEvent('paste', {
         bubbles: true,
         cancelable: true,
         clipboardData: dt
       });

       composerInput.dispatchEvent(pasteEvent);
       await randomDelay(1, 2);
       console.log('[Threads] Gambar berhasil di-paste ke composer');
       return true;
     } catch (e) {
       console.warn('[Threads] Gagal generate/unggah gambar:', e.message);
       return false;
     }
   },

   async generateImage(prompt) {
     try {
       const response = await chrome.runtime.sendMessage({
         action: 'GENERATE_IMAGE',
         payload: { prompt }
       });
       return response?.success ? response.data : null;
     } catch (e) {
       console.warn('[Threads] Image generation via background failed:', e.message);
       return null;
     }
   }
 };
