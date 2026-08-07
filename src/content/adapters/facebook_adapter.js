/**
 * Facebook (facebook.com) Platform Adapter
 * Verified selectors from live DOM dump 2026-08-06.
 */

import { waitForElement, simulateHumanTyping, randomDelay } from '../../utils/dom_helpers.js';
import { GeneralHelpers } from './general_helpers.js';

function findByAriaLabel(root, label, exact = false) {
  return Array.from(root.querySelectorAll('[role="button"], [role="dialog"], [role="menu"]')).find(el => {
    const aria = el.getAttribute('aria-label') || '';
    return exact ? aria === label : aria.includes(label);
  }) || null;
}

function findByText(root, regex) {
  return Array.from(root.querySelectorAll('[role="button"]')).find(el => {
    const txt = (el.textContent || '').trim();
    return regex.test(txt);
  }) || null;
}

function findComboboxes(root) {
  return Array.from(root.querySelectorAll('input[role="combobox"]'));
}

export const FacebookAdapter = {
  name: 'Facebook',

  /**
   * Find the Lexical composer textbox inside the "Buat postingan" dialog.
   * Uses aria-placeholder (confirmed by live DOM dump).
   */
  async getComposerInput() {
    const selectors = [
      'div[contenteditable="true"][role="textbox"][aria-placeholder*="Apa yang Anda pikirkan"]',
      'div[contenteditable="true"][role="textbox"][aria-placeholder*="What\'s on your mind"]',
      'div[contenteditable="true"][role="textbox"][aria-label*="Apa yang Anda pikirkan"]',
      'div[contenteditable="true"][role="textbox"][aria-label*="What\'s on your mind"]',
      'div[role="dialog"] div[contenteditable="true"][role="textbox"]',
      'div[data-lexical-editor="true"][contenteditable="true"]',
      'form div[contenteditable="true"][role="textbox"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    const triggers = [
      'div[aria-label*="Apa yang Anda pikirkan"]',
      'div[aria-label*="What\'s on your mind"]',
      'div[role="button"]:has(span)'
    ];

    for (const sel of triggers) {
      const els = Array.from(document.querySelectorAll(sel));
      const match = els.find(e => {
        const text = e.textContent || '';
        return text.includes("Apa yang Anda pikirkan") || text.includes("What's on your mind");
      });
      if (match) {
        GeneralHelpers.clickElement(match);
        await randomDelay(1, 2);
        const res = await waitForElement([
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="Apa yang Anda pikirkan"]',
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="What\'s on your mind"]',
          'div[role="dialog"] div[contenteditable="true"]',
          'div[data-lexical-editor="true"][contenteditable="true"]'
        ], 5000).catch(() => null);
        return res ? res.element : null;
      }
    }

    return null;
  },

  /**
   * Click the "Berikutnya" (Next) button in the composer dialog.
   * This navigates from composer to post settings panel.
   */
  async clickNextButton() {
    const btn = findByAriaLabel(document, 'Berikutnya');
    if (btn) {
      GeneralHelpers.clickElement(btn);
      // Wait for settings panel to load
      await waitForElement([
        'div[aria-label="Kirim"][role="button"]',
        'div[aria-label="Kirim"][role="button"] span',
        'div[role="button"][aria-label="Opsi penjadwalan"]',
        'div[role="button"][aria-label="Jadwalkan untuk nanti"]'
      ], 5000).catch(() => {});
      await randomDelay(1, 2);
      return true;
    }
    return false;
  },

  /**
   * Find the schedule section in the post-settings panel.
   * In the settings panel, "Opsi penjadwalan" is shown with "Terbitkan sekarang".
   */
  async openSchedulePanel() {
    const scheduleSection = findByText(document, /Opsi penjadwalan/i);
    if (scheduleSection) {
      GeneralHelpers.clickElement(scheduleSection);
      await randomDelay(1, 2);
      return true;
    }
    return false;
  },

  /**
   * Click "Jadwalkan untuk nanti" inside the schedule dialog.
   */
  async clickScheduleForLater() {
    const btn = findByAriaLabel(document, 'Jadwalkan untuk nanti');
    if (btn) {
      GeneralHelpers.clickElement(btn);
      await randomDelay(1, 2);
      return true;
    }
    return false;
  },

  /**
   * Set date and time in the Facebook schedule comboboxes.
   * Date combobox: first combobox (no listbox popup)
   * Time combobox: second combobox (has listbox popup)
   */
  async setScheduleDateTime(when) {
    const comboboxes = findComboboxes(document);
    if (comboboxes.length < 2) return false;

    const dateInput = comboboxes[0];
    const timeInput = comboboxes[1];

    // Format date for Facebook: "6 Agu 2026" (Indonesian locale)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = when.getDate();
    const month = months[when.getMonth()];
    const year = when.getFullYear();
    const dateStr = `${day} ${month} ${year}`;

    // Format time for Facebook: "14:30"
    const hours = String(when.getHours()).padStart(2, '0');
    const mins = String(when.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${mins}`;

    // Set date
    GeneralHelpers.clickElement(dateInput);
    await randomDelay(0.5, 1);
    await simulateHumanTyping(dateInput, dateStr, 'fast');
    await randomDelay(0.5, 1);

    // Set time
    GeneralHelpers.clickElement(timeInput);
    await randomDelay(0.5, 1);
    await simulateHumanTyping(timeInput, timeStr, 'fast');
    await randomDelay(0.5, 1);

    // Press Enter to confirm
    dateInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    timeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await randomDelay(0.5, 1);

    return true;
  },

  /**
   * Click the final "Kirim" (Post) button.
   */
  async clickPostButton() {
    // Wait for button to appear after panel transition
    const res = await waitForElement([
      'div[aria-label="Kirim"][role="button"]',
      'div[aria-label="Post"][role="button"]',
      'div[aria-label="Kirim"][role="button"] span',
      'div[role="button"][aria-label="Kirim"]'
    ], 8000).catch(() => null);

    const btn = res ? res.element : findByAriaLabel(document, 'Kirim');
    if (btn) {
      GeneralHelpers.clickElement(btn);
      await randomDelay(2, 4);
      return true;
    }
    return false;
  },

  /**
   * Post content to Facebook.
   * Flow: Composer → type text → Berikutnya → Settings → (optional: schedule) → Kirim
   */
  async createPost(contentText, options = {}) {
    const typingSpeed = options.humanTypingSpeed || 'medium';

    const input = await this.getComposerInput();
    if (!input) throw new Error('Input Facebook tidak ditemukan. Buka facebook.com dan klik "Apa yang Anda pikirkan?".');

    // Type content
    await simulateHumanTyping(input, contentText, typingSpeed);
    await randomDelay(1, 2);

    // Click "Berikutnya" to go to settings
    const nextClicked = await this.clickNextButton();
    if (!nextClicked) {
      // Fallback: try to find Kirim button directly (simple post without settings)
      const postBtn = findByAriaLabel(document, 'Kirim');
      if (postBtn) {
        GeneralHelpers.clickElement(postBtn);
        await randomDelay(2, 4);
        return { success: true, message: 'Berhasil memposting ke Facebook!' };
      }
      return { success: true, message: 'Konten terisi di Facebook. Silakan klik Kirim.' };
    }

    await randomDelay(1, 2);

    // Handle scheduling if requested
    if (options.facebookScheduledTime) {
      const when = new Date(options.facebookScheduledTime);

      const panelOpened = await this.openSchedulePanel();
      if (panelOpened) {
        const laterClicked = await this.clickScheduleForLater();
        if (laterClicked) {
          const dtSet = await this.setScheduleDateTime(when);
          if (dtSet) {
            await randomDelay(0.5, 1);
            const posted = await this.clickPostButton();
            return {
              success: posted,
              message: posted
                ? `Post dijadwalkan ${when.toLocaleString('id-ID')} via Facebook`
                : 'Gagal klik Kirim setelah set jadwal'
            };
          }
        }
      }
      // Fallback: post without scheduling
      console.warn('[Facebook] Gagal set jadwal native, posting langsung');
    }

    // Click "Kirim" to post
    const posted = await this.clickPostButton();
    return {
      success: posted,
      message: posted ? 'Berhasil memposting ke Facebook!' : 'Konten terisi. Silakan klik Kirim.'
    };
  }
};
