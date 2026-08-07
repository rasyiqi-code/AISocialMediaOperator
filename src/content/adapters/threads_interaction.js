/**
 * Threads Interaction Engine
 * Auto-Like, AI Reply, Repost, Follow & Feed Scanner
 */

import { randomDelay, simulateHumanTyping } from '../../utils/dom_helpers.js';

const AUTO_REPLY_STATE_KEY = 'autoReplyProcessed';

/**
 * Load persisted dedup state (survives the full-page reload that follows
 * every reply, so the loop never re-replies to the same author/post).
 */
function loadAutoReplyState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([AUTO_REPLY_STATE_KEY], (r) => {
      const data = r[AUTO_REPLY_STATE_KEY] || {};
      resolve({
        authors: new Set(Array.isArray(data.authors) ? data.authors : []),
        postKeys: new Set(Array.isArray(data.postKeys) ? data.postKeys : [])
      });
    });
  });
}

function persistAutoReplyState(state) {
  chrome.storage.local.set({
    [AUTO_REPLY_STATE_KEY]: {
      authors: Array.from(state.authors).slice(-500),
      postKeys: Array.from(state.postKeys).slice(-1000)
    }
  });
}

/**
 * Fire a proper React-compatible click on an element.
 * Plain .click() often fails on Threads' React event handlers.
 */
function reactClick(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  });
}

/**
 * Find the Like button inside a post container using multiple strategies.
 * Threads renders like buttons as <svg aria-label="Like"> inside a div[role="button"].
 */
function findLikeButton(container) {
  // Strategy 1: Find SVG with Like/Suka aria-label, then walk up to clickable wrapper
  const allSvgs = Array.from(container.querySelectorAll('svg'));
  for (const svg of allSvgs) {
    const label = (
      svg.getAttribute('aria-label') ||
      svg.querySelector('title')?.textContent ||
      ''
    ).toLowerCase();
    if (label.includes('like') || label.includes('suka')) {
      let el = svg.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!el) break;
        const role = el.getAttribute('role');
        const tag = (el.tagName || '').toLowerCase();
        if (role === 'button' || tag === 'button') return el;
        el = el.parentElement;
      }
      return svg.parentElement;
    }
  }

  // Strategy 2: aria-label on button/div directly
  return (
    container.querySelector('[aria-label*="Like"i]') ||
    container.querySelector('[aria-label*="Suka"i]') ||
    container.querySelector('[aria-label*="Unlike"i]') ||
    container.querySelector('[aria-label*="Batalkan suka"i]') ||
    null
  );
}

/**
 * Determine if a post is already liked
 */
function isAlreadyLiked(container) {
  const btn = findLikeButton(container);
  if (!btn) return false;

  // Check aria-pressed
  if (btn.getAttribute('aria-pressed') === 'true') return true;

  // Check aria-label for "Unlike" / "Batalkan"
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  if (label.includes('unlike') || label.includes('batalkan')) return true;

  // Check SVG title or aria-label for liked state
  const svg = btn.querySelector('svg') || (btn.tagName === 'svg' ? btn : null);
  if (svg) {
    const svgLabel = (
      svg.getAttribute('aria-label') ||
      svg.querySelector('title')?.textContent ||
      ''
    ).toLowerCase();
    if (svgLabel.includes('unlike') || svgLabel.includes('batalkan')) return true;
  }

  return false;
}

/**
 * Find Reply button inside post container safely without clicking profile link <a> tags
 */
function findReplyButton(container) {
  if (!container) return null;

  const svgs = Array.from(container.querySelectorAll('svg'));
  for (const svg of svgs) {
    const label = (svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || '').toLowerCase();
    if (label.includes('reply') || label.includes('balas')) {
      let el = svg.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!el || el === container) break;
        // DO NOT return profile link tag!
        if (el.tagName === 'A' && el.getAttribute('href')?.includes('/@')) break;

        const role = el.getAttribute('role');
        const tag = el.tagName.toLowerCase();
        if (role === 'button' || tag === 'button') return el;
        el = el.parentElement;
      }
      return svg.parentElement;
    }
  }

  const directBtn = container.querySelector('[aria-label*="Reply"i]') || container.querySelector('[aria-label*="Balas"i]');
  if (directBtn) {
    const closestAnchor = directBtn.closest('a[href*="/@"]');
    if (!closestAnchor) {
      // Prefer the clickable role=button wrapper over the svg itself
      return directBtn.closest('div[role="button"], button') || directBtn;
    }
  }

  return null;
}

/**
 * Detect logged-in active user handle to prevent replying to self posts/comments
 */
function getSelfUsername() {
  const profileLinks = Array.from(document.querySelectorAll('a[href*="/@"]'));
  for (const a of profileLinks) {
    const href = a.getAttribute('href') || '';
    const match = href.match(/\/@([a-zA-Z0-9_.]+)/);
    if (match && match[1]) {
      if (a.closest('header, nav, [role="navigation"]')) {
        return match[1].toLowerCase();
      }
    }
  }
  return 'rasyiqi'; // fallback default user handle
}

/**
 * Extract clean, full post body text from a Threads post container
 */
function extractPostText(container) {
  if (!container) return '';

  const candidates = Array.from(container.querySelectorAll('span[dir="auto"], div[dir="auto"], p'));
  const textParts = [];

  for (const el of candidates) {
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length < 2) continue;

    // Filter out metadata, timestamps, action buttons
    if (/^\d+\s*(detik|menit|jam|hari|minggu|d|m|h|w|mnt|bln)$/i.test(txt)) continue;
    if (/^(follow|ikuti|diposting|balas|suka|repost|kutip|share|bagikan|balasan|like|unlike)$/i.test(txt)) continue;
    if (txt.startsWith('@')) continue;

    textParts.push(txt);
  }

  const uniqueParts = [...new Set(textParts)];
  return uniqueParts.join(' ').trim().slice(0, 600);
}

/**
 * Save auto-reply state and reload the feed to continue the loop after page
 * load. Only sets the resume flag when `shouldResume` is true, so a Stop that
 * happens mid-iteration does NOT restart the loop after reload.
 */
async function reloadFeedAfterReply(shouldResume = true) {
  await randomDelay(1.5, 2.5);
  // Clear any leftover composer/reply drafts so Threads' beforeunload guard
  // does not block navigation with a "Changes you made may not be saved"
  // dialog (which would stall the auto-reply loop).
  try {
    document.querySelectorAll('div[contenteditable="true"]').forEach((el) => {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    });
  } catch (e) {}
  if (shouldResume) {
    // Persist the "auto-reply is running" flag so content script can resume after reload
    chrome.storage.local.set({ autoReplyRunning: true });
  } else {
    chrome.storage.local.remove('autoReplyRunning');
  }
  // Stay on the same host (threads.net or threads.com) and go back to the home feed
  window.location.href = window.location.protocol + '//' + window.location.host + '/';
}

export const ThreadsInteraction = {
  name: 'ThreadsInteraction',
  isRunning: false,
  activeTask: null, // 'like' | 'repost' | 'follow' | 'reply'

  /**
   * Stop any active continuous loop and close modals / go back to feed
   */
  async stop() {
    this.isRunning = false;
    this.activeTask = null;
    // Clear auto-resume flag so it never restarts on its own
    try {
      chrome.storage.local.remove('autoReplyRunning');
    } catch (e) { /* extension context may be invalidated after a reload */ }
    console.log('[ThreadsInteraction] Stopped continuous interaction loop.');
  },

  /**
   * Scan visible feed posts and return their data (Excludes self posts!)
   */
  scanFeedPosts(maxPosts = 30) {
    const posts = [];
    const selfUser = getSelfUsername();

    const selectorGroups = [
      'article',
      'div[data-pressable-container="true"]',
      '[role="article"]',
    ];

    let containers = [];
    for (const sel of selectorGroups) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > containers.length) containers = found;
    }

    for (let i = 0; i < Math.min(containers.length, maxPosts); i++) {
      const el = containers[i];
      try {
        if (el.closest('div[role="dialog"]')) continue;

        const text = extractPostText(el);
        const authorEl =
          el.querySelector('a span') ||
          el.querySelector('strong') ||
          el.querySelector('span[class*="username"]');

        const author = (authorEl?.textContent || '').trim().slice(0, 80);
        const authorLower = author.toLowerCase();

        // STRICT FILTER: Skip self posts / self comments completely!
        if (authorLower === selfUser || authorLower === 'rasyiqi') {
          continue;
        }

        const likeBtn = findLikeButton(el);
        const replyBtn = findReplyButton(el);
        const repostBtn =
          el.querySelector('[aria-label*="Repost"i]') ||
          el.querySelector('[aria-label*="Kutip"i]') ||
          el.querySelector('[aria-label*="Posting ulang"i]') ||
          el.querySelector('[aria-label*="Rethread"i]');

        if (!text || text.length < 5) continue;

        posts.push({
          id: `post_${i}_${Date.now()}`,
          index: i,
          author,
          text,
          element: el,
          likeBtn,
          replyBtn,
          repostBtn,
          hasLiked: isAlreadyLiked(el),
        });
      } catch (e) {}
    }

    return posts;
  },

  /**
   * Like a specific post
   */
  async likePost(postData) {
    const { element } = postData;

    if (isAlreadyLiked(element)) {
      return { success: true, message: 'Sudah di-like sebelumnya', skipped: true };
    }

    const freshBtn = findLikeButton(element);
    if (!freshBtn) throw new Error('Tombol Like tidak ditemukan pada postingan ini');

    await randomDelay(0.5, 1.2);
    reactClick(freshBtn);
    await randomDelay(0.5, 1);

    return { success: true, message: `Berhasil like postingan dari @${postData.author}` };
  },

  /**
   * Continuous Auto-Like Loop with Auto-Scroll
   */
  async startContinuousAutoLike(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'like';

    let count = 0;
    const processedPostElements = new WeakSet();

    console.log('[ThreadsInteraction] Starting continuous Auto-Like...');

    while (this.isRunning && this.activeTask === 'like') {
      const posts = this.scanFeedPosts(40);
      const unlikedPost = posts.find(p => p.likeBtn && !p.hasLiked && !processedPostElements.has(p.element));

      if (unlikedPost) {
        processedPostElements.add(unlikedPost.element);
        try {
          unlikedPost.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(0.8, 1.5);

          const res = await this.likePost(unlikedPost);
          if (res.success && !res.skipped) {
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: unlikedPost.author, text: unlikedPost.text });
          }
          await randomDelay(2, 4);
        } catch (e) {
          console.warn('[ThreadsInteraction] Auto-like error on post:', e);
        }
      } else {
        window.scrollBy({ top: 600, behavior: 'smooth' });
        await randomDelay(2, 3.5);
      }
    }

    return { success: true, totalProcessed: count };
  },

  /**
   * Continuous Auto-Repost Loop with Auto-Scroll
   */
  async startContinuousAutoRepost(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'repost';

    let count = 0;
    const processedElements = new WeakSet();

    while (this.isRunning && this.activeTask === 'repost') {
      const posts = this.scanFeedPosts(40);
      const targetPost = posts.find(p => p.repostBtn && !processedElements.has(p.element));

      if (targetPost) {
        processedElements.add(targetPost.element);
        try {
          targetPost.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);

          const res = await this.repostPost(targetPost);
          if (res.success) {
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: targetPost.author });
          }
          await randomDelay(3, 6);
        } catch (e) {
          console.warn('[ThreadsInteraction] Repost error:', e);
        }
      } else {
        window.scrollBy({ top: 600, behavior: 'smooth' });
        await randomDelay(2, 4);
      }
    }

    return { success: true, totalProcessed: count };
  },

  /**
   * Continuous Auto-Follow Loop with Auto-Scroll
   */
  async startContinuousAutoFollow(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'follow';

    let count = 0;
    const processedElements = new WeakSet();

    while (this.isRunning && this.activeTask === 'follow') {
      const posts = this.scanFeedPosts(40);
      const targetPost = posts.find(p => {
        if (processedElements.has(p.element)) return false;
        const followBtn = Array.from(p.element.querySelectorAll('div[role="button"], button, span[role="button"]')).find(el => {
          const txt = (el.textContent || '').trim().toLowerCase();
          return txt === 'follow' || txt === 'ikuti';
        });
        return !!followBtn;
      });

      if (targetPost) {
        processedElements.add(targetPost.element);
        try {
          targetPost.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);

          const res = await this.followUser(targetPost);
          if (res.success) {
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: targetPost.author });
          }
          await randomDelay(3, 6);
        } catch (e) {
          console.warn('[ThreadsInteraction] Follow error:', e);
        }
      } else {
        window.scrollBy({ top: 600, behavior: 'smooth' });
        await randomDelay(2, 4);
      }
    }

    return { success: true, totalProcessed: count };
  },

  /**
   * Submit reply post button click safely without double-triggering.
   * Threads' reply composer send button is an icon-only circular arrow (no
   * text/aria-label), so we fall back to: explicit label match -> icon-only
   * last button -> Enter key.
   */
  async submitReply(replyInput, shouldResume = true) {
    await randomDelay(0.5, 1);

    const scope = replyInput?.closest('div[role="dialog"]') ||
                  replyInput?.closest('div[role="dialog"], div[class*="x78zum5"]') ||
                  document;
    const candidates = Array.from(scope.querySelectorAll('div[role="button"], button'));

    // 1) Explicit label / text match (e.g. "Kirim", "Balas", "Post", "Send")
    let submitBtn = candidates.find(el => {
      const txt = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      return ['posting', 'post', 'kirim', 'balas', 'send'].some(k => txt === k || aria === k) ||
             aria.includes('kirim') || aria.includes('send');
    });

    // 2) Icon-only send button (circular arrow): the last icon-only clickable
    //    in the composer footer.
    if (!submitBtn) {
      const iconBtns = candidates.filter(el => {
        const txt = (el.textContent || '').trim();
        return txt === '' && el.querySelector('svg');
      });
      submitBtn = iconBtns[iconBtns.length - 1] || null;
    }

    if (submitBtn) {
      reactClick(submitBtn);
      await randomDelay(2, 3);
    } else {
      // 3) Last resort: Threads submits replies on Enter (Shift+Enter = newline)
      try {
        replyInput.focus();
        const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        replyInput.dispatchEvent(enter);
        await randomDelay(1.5, 2.5);
      } catch (e) {}
    }

    // Always clean up modal, back to feed, and scroll down to skip replied post
    await reloadFeedAfterReply(shouldResume);
    return true;
  },

  /**
   * Continuous Auto AI-Reply Loop with Auto-Scroll & Contextual AI Generation
   * STRICT: Excludes self posts/comments and enforces 1 reply per Thread / Author
   */
  async startContinuousAutoReply(onProgressCallback, generateReplyFn) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'reply';

    let count = 0;
    const selfUser = getSelfUsername();
    const processedAuthors = new Set([selfUser, 'rasyiqi']); // Never reply to self!
    const processedPostKeys = new Set();
    const processedElements = new WeakSet();

    // Seed dedup from persisted state so a post-reply page reload does not
    // cause the same authors/posts to be replied to a second time.
    const persisted = await loadAutoReplyState();
    persisted.authors.forEach(a => processedAuthors.add(a));
    persisted.postKeys.forEach(k => processedPostKeys.add(k));

    console.log(`[ThreadsInteraction] Starting continuous Auto AI-Reply (selfUser=${selfUser}, 1 reply per thread)...`);

    while (this.isRunning && this.activeTask === 'reply') {
      // If the extension was reloaded, the runtime context is invalidated.
      // Stop the loop immediately instead of spamming errors forever.
      if (!chrome.runtime?.id) {
        console.warn('[ThreadsInteraction] Extension context invalidated. Stopping auto-reply loop.');
        this.isRunning = false;
        this.activeTask = null;
        break;
      }

      const posts = this.scanFeedPosts(40);
      const targetPost = posts.find(p => {
        if (!p.replyBtn || !p.text || p.text.length < 10) return false;
        
        const authorKey = (p.author || '').trim().toLowerCase();
        // Strict Rule: Exclude self posts and authors already replied to!
        if (!authorKey || authorKey === selfUser || authorKey === 'rasyiqi' || processedAuthors.has(authorKey)) {
          return false;
        }

        const postKey = `${p.author}_${p.text.slice(0, 50)}`;
        return !processedPostKeys.has(postKey) && !processedElements.has(p.element);
      });

      if (targetPost) {
        const authorKey = (targetPost.author || '').trim().toLowerCase();
        if (authorKey) processedAuthors.add(authorKey);

        const postKey = `${targetPost.author}_${targetPost.text.slice(0, 50)}`;
        processedPostKeys.add(postKey);
        processedElements.add(targetPost.element);
        persistAutoReplyState({ authors: processedAuthors, postKeys: processedPostKeys });

        try {
          targetPost.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);

          // 1. Generate Contextual AI Reply based on post text
          let replyText = '';
          if (generateReplyFn) {
            replyText = await generateReplyFn(targetPost.text);
          }

          if (!replyText) {
            // AI gagal menghasilkan balasan (mis. 403 ChatGPT/Gemini). Lewati
            // post ini daripada membalas dengan teks generik yang terlihat bot.
            console.warn('[ThreadsInteraction] AI reply gagal, melewati post ini.');
            await randomDelay(2, 4);
            continue;
          }

          // 2. Open reply composer
          const replyInput = await this.openReplyComposer(targetPost);
          if (replyInput) {
            // 3. Type reply naturally (Single execCommand without paste duplication)
            await simulateHumanTyping(replyInput, replyText, 'fast');
            await randomDelay(0.8, 1.5);

            // 4. Submit reply, force back to main feed, and auto-scroll to skip replied post!
            await this.submitReply(replyInput, this.isRunning);

            count++;
            if (onProgressCallback) {
              onProgressCallback({
                count,
                author: targetPost.author,
                replyText,
                postText: targetPost.text.slice(0, 60)
              });
            }
          } else {
            await reloadFeedAfterReply(this.isRunning);
          }
          await randomDelay(3, 5);
        } catch (e) {
          console.warn('[ThreadsInteraction] Auto-reply error:', e);
          if (!chrome.runtime?.id) {
            this.isRunning = false;
            this.activeTask = null;
            break;
          }
          await reloadFeedAfterReply(this.isRunning);
        }
      } else {
        window.scrollBy({ top: 600, behavior: 'smooth' });
        await randomDelay(2.5, 4);
      }
    }

    await reloadFeedAfterReply(this.isRunning);
    return { success: true, totalProcessed: count };
  },

  /**
   * Open reply composer for a post cleanly WITHOUT clicking double-sided expand arrows
   */
  async openReplyComposer(postData) {
    const { replyBtn } = postData;

    if (replyBtn) {
      replyBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await randomDelay(0.3, 0.8);
      reactClick(replyBtn);
      await randomDelay(1.5, 3);
    }

    // Wait for reply contenteditable textarea to appear (DO NOT click double-sided arrow icon).
    // Prefer the actual reply composer ("Balas ke ...") over the inline
    // "Apa yang baru?" composer that is always present in the DOM.
    const replyInput = await new Promise((resolve) => {
      const check = setInterval(() => {
        const inputs = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
        const replyComposer = inputs.find(el =>
          (el.getAttribute('aria-placeholder') || '').toLowerCase().startsWith('balas ke') ||
          (el.getAttribute('aria-placeholder') || '').toLowerCase().includes('reply')
        );
        if (replyComposer) {
          clearInterval(check);
          resolve(replyComposer);
        } else if (inputs.length > 0) {
          clearInterval(check);
          resolve(inputs[inputs.length - 1]);
        }
      }, 300);
      setTimeout(() => { clearInterval(check); resolve(null); }, 5000);
    });

    return replyInput;
  },

  /**
   * Post an AI reply on top/first post in feed
   */
  async replyToFirstPost(replyText) {
    const posts = this.scanFeedPosts(10);
    const targetPost = posts.find(p => p.replyBtn) || posts[0];

    if (!targetPost) throw new Error('Postingan tidak ditemukan di feed.');

    const replyInput = await this.openReplyComposer(targetPost);
    if (!replyInput) throw new Error('Composer balasan tidak muncul.');

    await simulateHumanTyping(replyInput, replyText, 'fast');
    await randomDelay(0.5, 1);
    await this.submitReply(replyInput, false);

    return { success: true, message: `Balasan dikirim ke postingan @${targetPost.author}.` };
  },

  /**
   * Repost a post
   */
  async repostPost(postData) {
    const { repostBtn } = postData;
    if (!repostBtn) throw new Error('Tombol Repost tidak ditemukan pada postingan ini');

    repostBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await randomDelay(0.5, 1);
    reactClick(repostBtn);
    await randomDelay(0.5, 1.5);

    const repostOption = Array.from(document.querySelectorAll('[role="menuitem"], div[role="button"]')).find(el => {
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('repost') || txt.includes('rethread') || txt.includes('posting ulang');
    });

    if (repostOption) {
      await randomDelay(0.3, 0.8);
      reactClick(repostOption);
      return { success: true, message: `Berhasil repost postingan dari @${postData.author}!` };
    }

    return { success: true, message: `Menu repost dibuka untuk @${postData.author}.` };
  },

  /**
   * Follow a user from a post in feed
   */
  async followUser(postData) {
    const { element, author } = postData;
    const followBtn = Array.from(element.querySelectorAll('div[role="button"], button, span[role="button"]')).find(el => {
      const txt = (el.textContent || '').trim().toLowerCase();
      return txt === 'follow' || txt === 'ikuti';
    });

    if (!followBtn) return { success: false, message: `Tombol Ikuti tidak ditemukan untuk @${author}` };

    await randomDelay(0.5, 1.5);
    reactClick(followBtn);
    await randomDelay(0.5, 1);

    return { success: true, message: `Berhasil mengikuti @${author}!` };
  }
};
