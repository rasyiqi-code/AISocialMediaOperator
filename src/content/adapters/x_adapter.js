/**
 * X / Twitter (x.com & twitter.com) Platform Adapter
 */

import { waitForElement, simulateHumanTyping, randomDelay } from '../../utils/dom_helpers.js';

export const XAdapter = {
  name: 'X (Twitter)',

  /**
   * Find tweet composer textbox
   */
  async getComposerInput() {
    let input = document.querySelector('div[data-testid="tweetTextarea_0"]') ||
                document.querySelector('div[role="textbox"][aria-label*="Post text"]') ||
                document.querySelector('div[role="textbox"][aria-label*="Tweet text"]') ||
                document.querySelector('div[role="textbox"]');

    if (input) return input;

    // Try clicking Tweet / Post side button
    const postSideBtn = document.querySelector('a[data-testid="SideNav_NewTweet_Button"]') ||
                        document.querySelector('button[aria-label="Post"]');

    if (postSideBtn) {
      postSideBtn.click();
      await randomDelay(1, 2);
      const res = await waitForElement([
        'div[data-testid="tweetTextarea_0"]',
        'div[role="textbox"]'
      ], 5000).catch(() => null);
      return res ? res.element : null;
    }

    return null;
  },

  /**
   * Post tweet to X
   */
  async createPost(contentText, options = {}) {
    const input = await this.getComposerInput();
    if (!input) throw new Error('Input X / Twitter tidak ditemukan. Buka x.com dan pastikan Anda sudah login.');

    const typingSpeed = options.humanTypingSpeed || 'medium';
    await simulateHumanTyping(input, contentText, typingSpeed);
    await randomDelay(1, 3);

    // Click Tweet/Post button
    const container = input.closest('div[data-testid*="modal"]') || document;
    const postBtn = container.querySelector('button[data-testid="tweetButtonInline"]') ||
                    container.querySelector('button[data-testid="tweetButton"]') ||
                    Array.from(container.querySelectorAll('button')).find(b => b.textContent.trim() === 'Post' || b.textContent.trim() === 'Reply');

    if (postBtn && !postBtn.disabled) {
      postBtn.click();
      await randomDelay(2, 4);
      return { success: true, message: 'Berhasil memposting ke X (Twitter)!' };
    } else {
      return { success: true, message: 'Konten terisi ke Tweet composer. Silakan klik Post.' };
    }
  }
};
