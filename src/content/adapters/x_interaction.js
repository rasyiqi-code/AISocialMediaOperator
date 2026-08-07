/**
 * X / Twitter (x.com & twitter.com) Interaction Engine
 * Auto-Like, AI Reply, Auto-Retweet, Auto-Follow for x.com
 */

import { randomDelay, simulateHumanTyping } from '../../utils/dom_helpers.js';

/**
 * Fire React-compatible click events (needed for X/Twitter's React handlers).
 * Pass skipScroll=true when clicking elements inside floating dialogs (e.g. the
 * reply composer), where scrolling would close the dialog.
 */
function xClick(el, skipScroll = false) {
  if (!el) return;
  if (!skipScroll) {
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  }

  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 }));
  });
  try { el.click(); } catch (e) {}
}

/**
 * Find the visible reply dialog. X opens a modal at /compose/post whose dialog
 * contains the reply composer. There is ALSO a composer on the home page behind
 * the dialog — queries must be scoped to this dialog or they can type into the
 * hidden background composer.
 */
function findXReplyDialog() {
  return Array.from(document.querySelectorAll('div[role="dialog"]')).find(d => {
    const rect = d.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return !!d.querySelector(
      'div[data-testid="tweetTextarea_0"], ' +
      'div[data-testid="tweetTextarea_0RichTextInputContainer"], ' +
      'div[role="textbox"][aria-label*="Post text"]'
    );
  }) || null;
}

/**
 * Find the reply composer input, preferring the one inside the open dialog.
 */
function findXReplyInput(dialog) {
  const scope = dialog || document;
  return (
    scope.querySelector('div[data-testid="tweetTextarea_0"]') ||
    scope.querySelector('div[role="textbox"][aria-label*="Post text"]') ||
    scope.querySelector('div[contenteditable="true"]') ||
    null
  );
}

/**
 * Find the reply submit button. Inside the dialog it is
 * button[data-testid="tweetButton"] (text "Reply"); the home composer's
 * tweetButtonInline (text "Post") is only a last-resort fallback.
 */
function findXReplySubmit(dialog) {
  if (dialog) {
    return dialog.querySelector('button[data-testid="tweetButton"]') ||
           dialog.querySelector('button[data-testid="tweetButtonInline"]') ||
           null;
  }
  // Search within active composer container first
  const activeInput = document.querySelector('div[data-testid="tweetTextarea_0"]') ||
                      document.querySelector('div[role="textbox"][aria-label*="Post text"]');
  if (activeInput) {
    const container = activeInput.closest('[data-testid*="RichTextInputContainer"]') ||
                      activeInput.closest('.DraftEditor-root')?.parentElement?.parentElement ||
                      activeInput.closest('article') ||
                      document;
    const btn = container.querySelector('button[data-testid="tweetButtonInline"]') ||
                container.querySelector('button[data-testid="tweetButton"]');
    if (btn) return btn;
  }
  return document.querySelector('button[data-testid="tweetButtonInline"]') ||
         document.querySelector('button[data-testid="tweetButton"]') ||
         null;
}

/**
 * Close an open reply dialog, including any "Discard draft?" confirmation that
 * X shows when the composer still contains unsent text.
 */
async function closeXReplyDialog() {
  const dlg = findXReplyDialog();
  if (!dlg) return;

  const closeBtn = dlg.querySelector('[data-testid="app-bar-close"], [aria-label="Close"]');
  if (closeBtn) {
    xClick(closeBtn, true);
    await randomDelay(0.8, 1.5);
  }

  if (findXReplyDialog()) {
    const esc = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent('keydown', esc));
    window.dispatchEvent(new KeyboardEvent('keydown', esc));
    await randomDelay(0.8, 1.5);
  }

  // Handle the "Discard this draft?" / "Buang draf ini?" confirmation dialog
  const confirmDlg = Array.from(document.querySelectorAll('div[role="dialog"]')).find(d => {
    const rect = d.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const txt = (d.textContent || '').toLowerCase();
    return txt.includes('discard') || txt.includes('buang draf');
  });
  if (confirmDlg) {
    const discardBtn = Array.from(confirmDlg.querySelectorAll('button')).find(b => {
      const t = (b.textContent || '').trim().toLowerCase();
      return t === 'discard' || t === 'buang';
    });
    if (discardBtn) {
      xClick(discardBtn, true);
      await randomDelay(0.8, 1.5);
    }
  }
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
    const processedArticles = new WeakSet();
    const processedUrls = new Set();

    console.log('[XInteraction] Auto-Reply (Status Page Flow) started...');

    while (this.isRunning && this.activeTask === 'reply') {
      if (!chrome.runtime?.id) {
        console.warn('[XInteraction] Extension context invalidated. Stopping.');
        this.isRunning = false;
        break;
      }

      const currentUrl = window.location.href;

      // === CASE 1: Currently on a Tweet Status Page (e.g. https://x.com/username/status/123456789) ===
      if (currentUrl.includes('/status/')) {
        console.log('[XInteraction] Detected status page:', currentUrl);

        // Find composer on status page (either modal or inline composer below main tweet)
        const input = document.querySelector('div[data-testid="tweetTextarea_0"]') ||
                      document.querySelector('div[role="textbox"][aria-label*="Post text"]') ||
                      document.querySelector('div[contenteditable="true"]');

        // Extract main tweet text from page
        const mainTweet = document.querySelector('article[data-testid="tweet"]');
        const tweetTextEl = mainTweet ? mainTweet.querySelector('[data-testid="tweetText"]') : null;
        const postText = tweetTextEl ? (tweetTextEl.textContent || '').trim() : '';
        const authorEl = mainTweet ? mainTweet.querySelector('[data-testid="User-Name"]') : null;
        const author = authorEl ? (authorEl.textContent || '').split('@')[0].trim() : 'User';

        if (input && postText && !processedUrls.has(currentUrl)) {
          processedUrls.add(currentUrl);
          console.log('[XInteraction] Target tweet found on status page:', author, postText.slice(0, 60));

          let replyText = '';
          if (generateReplyFn) replyText = await generateReplyFn(postText);

          if (replyText) {
            try {
              xClick(input);
              input.focus();
              await randomDelay(0.4, 0.8);

              console.log('[XInteraction] Typing reply into status page composer...');
              await simulateHumanTyping(input, replyText, 'medium');
              await randomDelay(1.2, 2.0);

              const currentTypedLen = (input.textContent || '').trim().length;
              const sendBtn = findXReplySubmit();

              if (sendBtn && currentTypedLen > 0) {
                if (sendBtn.getAttribute('aria-disabled') === 'true') {
                  sendBtn.removeAttribute('aria-disabled');
                }
                if (sendBtn.disabled) {
                  sendBtn.disabled = false;
                }

                console.log('[XInteraction] Executing click on Reply button...');
                xClick(sendBtn, true);
                try { sendBtn.click(); } catch (e) {}

                count++;
                if (onProgressCallback) onProgressCallback({ count, author, replyText });
                console.log('[XInteraction] Tweet reply posted successfully! Waiting before navigating back...');
                await randomDelay(4, 6);
              } else {
                console.warn('[XInteraction] Could not locate valid submit button or text empty.');
              }
            } catch (e) {
              console.warn('[XInteraction] Error replying on status page:', e);
            }
          }
        }

        // After replying (or skipping), reload home timeline!
        console.log('[XInteraction] Reloading https://x.com/home...');
        await randomDelay(1.5, 2.5);
        window.location.href = 'https://x.com/home';
        return { success: true, totalProcessed: count };
      }

      // === CASE 2: Currently on Home / Timeline Feed (e.g. https://x.com/home) ===
      const tweets = scanXTweets(40);
      let target = tweets.find(t => {
        if (!t.text || t.text.length < 10) return false;
        if (processedArticles.has(t.element)) return false;
        // Check if tweet has a status link we haven't processed yet
        const link = t.element.querySelector('a[href*="/status/"]');
        if (!link) return false;
        const href = link.getAttribute('href') || '';
        return !processedUrls.has(href);
      });

      console.log('[XInteraction] Timeline scan:', tweets.length, 'tweets found,', target ? `target: ${target.author}` : 'no target');

      if (target) {
        processedArticles.add(target.element);
        const link = target.element.querySelector('a[href*="/status/"]');
        const href = link ? link.getAttribute('href') : '';
        if (href) processedUrls.add(href);

        try {
          console.log('[XInteraction] Scrolling to target tweet:', target.author);
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);

          // Click body of tweet / time link to navigate into tweet status page
          console.log('[XInteraction] Clicking tweet body to open status page...');
          const clickTarget = target.element.querySelector('time')?.parentElement || link || target.element;
          xClick(clickTarget);
          await randomDelay(3, 5);

          // Next iteration of while-loop will pick up CASE 1 (status page)!
          continue;
        } catch (e) {
          console.warn('[XInteraction] Error clicking tweet to enter status page:', e);
        }
      } else {
        // No un-replied tweet target on current screen, scroll timeline down smoothly
        console.log('[XInteraction] No target on current view, scrolling timeline down...');
        window.scrollBy({ top: 600, behavior: 'smooth' });
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
