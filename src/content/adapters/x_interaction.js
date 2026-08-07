/**
 * X / Twitter (x.com & twitter.com) Interaction Engine
 * Auto-Like, AI Reply, Auto-Retweet, Auto-Follow for x.com
 */

import { randomDelay, simulateHumanTyping } from '../../utils/dom_helpers.js';

function xClick(el) {
  if (!el) return;
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  });
}

function scanXTweets(maxTweets = 30) {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'))
    .filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .slice(0, maxTweets);

  return articles.map((el, i) => {
    const likeBtn = el.querySelector('[data-testid="like"]') || el.querySelector('[aria-label*="Like"]');
    const unlikeBtn = el.querySelector('[data-testid="unlike"]') || el.querySelector('[aria-label*="Liked"]');
    const replyBtn = el.querySelector('[data-testid="reply"]');
    const retweetBtn = el.querySelector('[data-testid="retweet"]');
    const followBtn = el.querySelector('[data-testid*="-follow"]') ||
                      Array.from(el.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'Follow');

    const authorEl = el.querySelector('[data-testid="User-Name"]');
    const author = authorEl ? (authorEl.textContent || '').split('@')[0].trim() : 'User';

    const textEl = el.querySelector('[data-testid="tweetText"]');
    const text = textEl ? (textEl.textContent || '').trim() : '';

    return {
      index: i,
      element: el,
      author,
      text,
      likeBtn: unlikeBtn ? null : likeBtn,
      hasLiked: !!unlikeBtn,
      replyBtn,
      retweetBtn,
      followBtn
    };
  });
}

export const XInteraction = {
  name: 'XInteraction',
  isRunning: false,
  activeTask: null,

  async stop() {
    this.isRunning = false;
    this.activeTask = null;
    console.log('[XInteraction] Stopped.');
  },

  async startContinuousAutoLike(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'like';
    let count = 0;
    const processed = new WeakSet();

    while (this.isRunning && this.activeTask === 'like') {
      const tweets = scanXTweets(40);
      const target = tweets.find(t => t.likeBtn && !t.hasLiked && !processed.has(t.element));

      if (target) {
        processed.add(target.element);
        try {
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(0.8, 1.5);
          xClick(target.likeBtn);
          count++;
          if (onProgressCallback) onProgressCallback({ count, author: target.author });
          await randomDelay(2, 4);
        } catch (e) {
          console.warn('[XInteraction] Auto-like error:', e);
        }
      } else {
        window.scrollBy({ top: 700, behavior: 'smooth' });
        await randomDelay(2, 3.5);
      }
    }
    return { success: true, totalProcessed: count };
  },

  async startContinuousAutoReply(onProgressCallback, generateReplyFn) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'reply';
    let count = 0;
    const processed = new WeakSet();

    while (this.isRunning && this.activeTask === 'reply') {
      const tweets = scanXTweets(40);
      const target = tweets.find(t => t.replyBtn && t.text && t.text.length > 10 && !processed.has(t.element));

      if (target) {
        processed.add(target.element);
        try {
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);

          let replyText = '';
          if (generateReplyFn) replyText = await generateReplyFn(target.text);
          if (!replyText) { await randomDelay(2, 4); continue; }

          xClick(target.replyBtn);
          await randomDelay(1.5, 3);

          const input = await new Promise(resolve => {
            const check = setInterval(() => {
              const el = document.querySelector('div[data-testid="tweetTextarea_0"]') ||
                         document.querySelector('div[role="textbox"][aria-label*="Post"]');
              if (el) { clearInterval(check); resolve(el); }
            }, 300);
            setTimeout(() => { clearInterval(check); resolve(null); }, 5000);
          });

          if (input) {
            input.focus();
            await randomDelay(0.5, 1);
            await simulateHumanTyping(input, replyText, 'fast');
            await randomDelay(0.8, 1.5);

            const sendBtn = document.querySelector('button[data-testid="tweetButton"]') ||
                            document.querySelector('button[data-testid="tweetButtonInline"]');
            if (sendBtn && !sendBtn.disabled) {
              xClick(sendBtn);
              count++;
              if (onProgressCallback) onProgressCallback({ count, author: target.author, replyText });
            }
          }
          await randomDelay(4, 8);
        } catch (e) {
          console.warn('[XInteraction] Auto-reply error:', e);
          await randomDelay(3, 5);
        }
      } else {
        window.scrollBy({ top: 700, behavior: 'smooth' });
        await randomDelay(2.5, 4);
      }
    }
    return { success: true, totalProcessed: count };
  },

  async startContinuousAutoRetweet(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'retweet';
    let count = 0;
    const processed = new WeakSet();

    while (this.isRunning && this.activeTask === 'retweet') {
      const tweets = scanXTweets(40);
      const target = tweets.find(t => t.retweetBtn && !processed.has(t.element));

      if (target) {
        processed.add(target.element);
        try {
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(0.8, 1.5);
          xClick(target.retweetBtn);
          await randomDelay(0.8, 1.5);

          const confirmBtn = document.querySelector('[data-testid="retweetConfirm"]');
          if (confirmBtn) {
            xClick(confirmBtn);
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: target.author });
          }
          await randomDelay(2, 4);
        } catch (e) {
          console.warn('[XInteraction] Auto-retweet error:', e);
        }
      } else {
        window.scrollBy({ top: 700, behavior: 'smooth' });
        await randomDelay(2, 3.5);
      }
    }
    return { success: true, totalProcessed: count };
  },

  async startContinuousAutoFollow(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'follow';
    let count = 0;
    const processed = new WeakSet();

    while (this.isRunning && this.activeTask === 'follow') {
      const tweets = scanXTweets(40);
      const target = tweets.find(t => t.followBtn && !processed.has(t.element));

      if (target) {
        processed.add(target.element);
        try {
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);
          xClick(target.followBtn);
          count++;
          if (onProgressCallback) onProgressCallback({ count, author: target.author });
          await randomDelay(3, 6);
        } catch (e) {
          console.warn('[XInteraction] Auto-follow error:', e);
        }
      } else {
        window.scrollBy({ top: 700, behavior: 'smooth' });
        await randomDelay(2, 4);
      }
    }
    return { success: true, totalProcessed: count };
  }
};
