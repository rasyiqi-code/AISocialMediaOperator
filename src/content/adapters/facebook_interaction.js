/**
 * Facebook Interaction Engine
 * Auto-Like, AI Comment, Auto-Follow for facebook.com
 *
 * Selectors verified from live DOM dump 2026-08-06:
 *   - Post containers : div[role="article"]
 *   - Like button     : div[aria-label="Suka"][role="button"]
 *   - Already liked   : div[aria-label="Batalkan suka"] or aria-label starts with "Suka:"
 *   - Comment button  : div[aria-label*="Komentar"] or div[aria-label*="Comment"]
 *   - Follow button   : div[aria-label="Ikuti"][role="button"]
 */

import { randomDelay, simulateHumanTyping } from '../../utils/dom_helpers.js';

/**
 * Fire React-compatible click events (needed for Facebook's React handlers).
 * Set skipScroll to true when clicking inside floating popovers (e.g. Tanggapan dialog)
 * to avoid triggering scroll events that close the popover.
 */
function fbClick(el, skipScroll = false) {
  if (!el) return;
  if (!skipScroll) {
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  }

  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const pointerOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  const mouseOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 };

  el.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
  el.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
  el.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
  el.dispatchEvent(new MouseEvent('mouseenter', mouseOpts));
  el.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
  el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
  el.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
  el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
  el.dispatchEvent(new MouseEvent('click', mouseOpts));

  try { el.click(); } catch (e) {}
}

/**
 * Insert text safely into Facebook's Lexical contenteditable comment editor.
 */
function fbSetLexicalText(element, text) {
  if (!element) return;
  element.focus();

  // Step 1: Clear any existing text first (select all + delete)
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false, null);
  } catch (e) {}

  // Step 2: Small delay for Lexical to process the deletion
  // Re-focus and set cursor
  element.focus();
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false); // collapse to end
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {}

  // Step 3: Insert new text
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch (e) {}

  // Step 4: Fallback if insertText didn't work
  if (!inserted || !element.textContent || !element.textContent.trim()) {
    element.innerHTML = `<p class="xdj266r x14z9mp xat24cr x1lziwak" dir="auto"><span data-lexical-text="true">${text}</span></p>`;
  }

  // Step 5: Dispatch events to notify Lexical/React of the change
  ['focus', 'keydown', 'input', 'keyup', 'change'].forEach(evtType => {
    try {
      element.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true }));
    } catch (e) {}
  });

  // Step 6: Also dispatch InputEvent for React compatibility
  try {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: text
    }));
  } catch (e) {}
}

/**
 * Find active comment input (Lexical contenteditable editor) inside modal dialog, post target, or document.
 */
function findActiveFbCommentInput(targetElement) {
  // 1. Search inside open dialog modal first (highest priority)
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog) {
    const inputInDialog = dialog.querySelector('div[contenteditable="true"]');
    if (inputInDialog) return inputInDialog;
  }

  // 2. Search inside target post element
  if (targetElement) {
    const inputInTarget = targetElement.querySelector('div[contenteditable="true"]');
    if (inputInTarget) return inputInTarget;
  }

  // 3. Search globally for contenteditable textbox
  const allInputs = Array.from(document.querySelectorAll(
    'div[contenteditable="true"][role="textbox"], ' +
    'div[contenteditable="true"][aria-label*="sebagai"], ' +
    'div[contenteditable="true"][aria-label*="komentar"], ' +
    'div[contenteditable="true"][aria-label*="comment"], ' +
    'div[contenteditable="true"][aria-placeholder*="sebagai"], ' +
    'div[contenteditable="true"][aria-placeholder*="komentar"], ' +
    'div[contenteditable="true"][aria-placeholder*="comment"], ' +
    'div[contenteditable="true"][data-lexical-editor="true"], ' +
    'div[contenteditable="true"]'
  ));

  return allInputs.length > 0 ? allInputs[allInputs.length - 1] : null;
}

/**
 * Find the comment submit/post button within a given scope.
 * Prioritizes exact matches like "Posting komentar" to avoid false positives
 * with buttons like "Tindakan untuk postingan oleh...".
 */
function findFbCommentSubmitButton(scope) {
  if (!scope) return null;
  const allBtns = Array.from(scope.querySelectorAll('[role="button"], button'));

  // Priority 1: Exact aria-label matches for submit buttons
  const exactLabels = ['posting komentar', 'post comment', 'kirim komentar', 'send comment', 'kirim', 'send'];
  for (const btn of allBtns) {
    const label = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (exactLabels.includes(label)) return btn;
  }

  // Priority 2: aria-label starts with "posting" or "kirim" (but NOT "tindakan" or "postingan")
  for (const btn of allBtns) {
    const label = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (label.startsWith('posting') || label.startsWith('kirim')) {
      return btn;
    }
  }

  // Priority 3: Button text equals submit keywords
  for (const btn of allBtns) {
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'kirim' || text === 'send' || text === 'posting' || text === 'post') {
      return btn;
    }
  }

  return null;
}

/**
 * Close any open Facebook modal dialog.
 * Uses aria-label button click, SVG close button, and Escape key fallback to ensure completion.
 */
async function closeFbModal(dialog = null) {
  const targetDialog = dialog || document.querySelector('[role="dialog"]');
  if (!targetDialog) return;

  console.log('[FacebookInteraction] Closing open modal dialog...');

  // Try finding close button inside dialog or document
  const closeBtn = targetDialog.querySelector('[aria-label="Tutup"]') ||
                   targetDialog.querySelector('[aria-label="Close"]') ||
                   targetDialog.querySelector('[aria-label="Tutup"][role="button"]') ||
                   targetDialog.querySelector('[aria-label="Close"][role="button"]') ||
                   document.querySelector('[role="dialog"] [aria-label="Tutup"]') ||
                   document.querySelector('[role="dialog"] [aria-label="Close"]');

  if (closeBtn) {
    fbClick(closeBtn, true);
    await randomDelay(1, 1.8);
  }

  // If dialog is STILL open in DOM, press Escape key as robust fallback!
  if (document.querySelector('[role="dialog"]')) {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
    }));
    await randomDelay(1, 1.5);
  }
}

/**
 * Check if a post is already liked.
 * Checks for Facebook ID DOM labels: "Hapus Suka", "Batalkan suka", "Ubah tanggapan", "Unlike", "Remove Like".
 */
function fbIsAlreadyLiked(container) {
  if (!container) return false;
  const alreadyLikedBtn = container.querySelector(
    '[aria-label*="Hapus Suka"][role="button"], ' +
    '[aria-label*="Batalkan suka"][role="button"], ' +
    '[aria-label*="Ubah tanggapan"][role="button"], ' +
    '[aria-label*="Remove Like"][role="button"], ' +
    '[aria-label*="Unlike"][role="button"]'
  );
  if (alreadyLikedBtn) return true;

  const all = Array.from(container.querySelectorAll('[role="button"]'));
  return all.some(el => {
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    return label.includes('hapus suka') || label.includes('batalkan suka') ||
           label.includes('ubah tanggapan') || label.includes('unlike') ||
           label.includes('remove like');
  });
}

/**
 * Find the Like button inside a Facebook post article.
 * Confirmed from DOM: div[aria-label="Suka"][role="button"]
 */
function findFbLikeButton(article) {
  if (!article) return null;
  if (fbIsAlreadyLiked(article)) return null;

  const all = Array.from(article.querySelectorAll('[role="button"]'));
  return all.find(el => {
    const label = (el.getAttribute('aria-label') || '').trim();
    if (label.includes(':')) return false; // Skip count displays like "Suka: 30 orang"
    return label === 'Suka' || label === 'Like';
  }) || null;
}

/**
 * Find the Comment button inside a Facebook post.
 */
function findFbCommentButton(article) {
  if (!article) return null;
  return (
    article.querySelector('[aria-label="Beri komentar"][role="button"]') ||
    article.querySelector('[aria-label="Komentar"][role="button"]') ||
    article.querySelector('[aria-label="Comment"][role="button"]') ||
    Array.from(article.querySelectorAll('[role="button"]')).find(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const text = (el.textContent || '').trim().toLowerCase();
      return label.includes('beri komentar') || label.includes('komentar') || label.includes('comment') ||
             text === 'komentar' || text === 'comment';
    }) || null
  );
}

/**
 * Find the Follow button inside a Facebook post.
 */
function findFbFollowButton(article) {
  if (!article) return null;
  return (
    article.querySelector('[aria-label="Ikuti"][role="button"]') ||
    article.querySelector('[aria-label="Follow"][role="button"]') ||
    Array.from(article.querySelectorAll('[role="button"]')).find(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const text = (el.textContent || '').trim().toLowerCase();
      return label === 'ikuti' || label === 'follow' ||
             text === 'ikuti' || text === 'follow';
    }) || null
  );
}

/**
 * Extract post author name from a Facebook article element.
 */
function extractFbAuthor(article) {
  if (!article) return 'User';
  const strong = article.querySelector('strong a, h2 a, h3 a');
  if (strong) return (strong.textContent || '').trim().slice(0, 60);
  const spans = Array.from(article.querySelectorAll('span'));
  for (const sp of spans) {
    const txt = (sp.textContent || '').trim();
    if (txt.length > 2 && txt.length < 60 && !txt.includes('\n')) return txt;
  }
  return 'User';
}

/**
 * Extract visible post text from a Facebook article.
 */
function extractFbPostText(article) {
  if (!article) return '';
  const textDivs = Array.from(article.querySelectorAll('div[dir="auto"], [data-ad-preview], span[dir="auto"]'));
  const parts = [];
  for (const el of textDivs) {
    const txt = (el.textContent || '').trim();
    if (txt.length > 15 && !parts.includes(txt)) parts.push(txt);
  }
  return parts.join(' ').slice(0, 500);
}

/**
 * Scan visible Facebook post articles in the feed.
 */
function scanFbFeedPosts(maxPosts = 30) {
  let articles = Array.from(document.querySelectorAll('div[role="article"], div[data-pagelet*="FeedUnit"]'))
    .filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('komentar oleh') || ariaLabel.includes('balasan oleh') || ariaLabel.includes('comment by') || ariaLabel.includes('reply by')) {
        return false; // skip comments
      }
      return true;
    });

  if (articles.length === 0) {
    const likeBtns = Array.from(document.querySelectorAll('[aria-label="Suka"][role="button"], [aria-label="Like"][role="button"]'))
      .filter(b => !(b.getAttribute('aria-label') || '').includes(':'));
    articles = likeBtns.map(b => b.closest('div[role="article"]') || b.closest('div[data-pagelet]') || b.parentElement?.parentElement?.parentElement || b).filter(Boolean);
  }

  articles = articles.slice(0, maxPosts);

  return articles.map((el, i) => ({
    index: i,
    element: el,
    author: extractFbAuthor(el),
    text: extractFbPostText(el),
    likeBtn: findFbLikeButton(el),
    commentBtn: findFbCommentButton(el),
    followBtn: findFbFollowButton(el),
    hasLiked: fbIsAlreadyLiked(el),
  }));
}

/**
 * Simulate mouse hover over an element to trigger Facebook's reaction flyout bar (Tanggapan).
 */
function fbHoverToOpenReactions(el) {
  if (!el) return;
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}

  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const events = [
    new PointerEvent('pointerover', { bubbles: true, cancelable: true, view: window, clientX, clientY }),
    new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window, clientX, clientY }),
    new PointerEvent('pointerenter', { bubbles: true, cancelable: true, view: window, clientX, clientY }),
    new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window, clientX, clientY }),
    new PointerEvent('pointermove', { bubbles: true, cancelable: true, view: window, clientX, clientY }),
    new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX, clientY })
  ];

  events.forEach(ev => el.dispatchEvent(ev));
}

/**
 * Click Like button or choose a reaction from the Facebook reaction picker flyout (Tanggapan).
 * If reactionChoice is not 'Suka', simulates real mouse HOVER over the Like button to open flyout.
 */
async function fbPerformReaction(btn, reactionChoice = 'random') {
  if (!btn) return false;
  await randomDelay(0.3, 0.5);

  const reactionsList = ['Suka', 'Super', 'Peduli', 'Haha', 'Wow'];
  let chosenReaction = reactionChoice;
  if (!chosenReaction || chosenReaction === 'random') {
    chosenReaction = reactionsList[Math.floor(Math.random() * reactionsList.length)];
  }

  // 1. If chosenReaction is standard 'Suka', direct click is sufficient
  if (chosenReaction === 'Suka') {
    fbClick(btn);
    await randomDelay(0.5, 0.8);
    return true;
  }

  // 2. If non-standard reaction (Super/Love, Peduli, Haha, Wow), HOVER first to open reaction bar!
  fbHoverToOpenReactions(btn);
  await randomDelay(0.8, 1.2);

  // Check if reaction flyout "Tanggapan" or role="dialog" opened
  let dialog = document.querySelector('[aria-label="Tanggapan"]') ||
               Array.from(document.querySelectorAll('[role="dialog"]')).find(d => (d.textContent || '').includes('Tanggapan') || (d.textContent || '').includes('Super'));

  // If hover didn't open flyout, try pointerdown hold
  if (!dialog) {
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    await randomDelay(0.8, 1.2);
    dialog = document.querySelector('[aria-label="Tanggapan"]') ||
             Array.from(document.querySelectorAll('[role="dialog"]')).find(d => (d.textContent || '').includes('Tanggapan') || (d.textContent || '').includes('Super'));
  }

  // 3. If reaction flyout "Tanggapan" is open, select target reaction button inside it!
  if (dialog) {
    let rxBtn = dialog.querySelector(`[aria-label="${chosenReaction}"][role="button"]`) ||
                dialog.querySelector(`[aria-label*="${chosenReaction}"][role="button"]`);

    if (!rxBtn) {
      rxBtn = Array.from(dialog.querySelectorAll('[role="button"]')).find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        const txt = (b.textContent || '').toLowerCase();
        return label.includes(chosenReaction.toLowerCase()) || txt.includes(chosenReaction.toLowerCase());
      });
    }

    if (!rxBtn) {
      rxBtn = dialog.querySelector('[aria-label="Super"][role="button"]') ||
              Array.from(dialog.querySelectorAll('[role="button"]'))[0];
    }

    if (rxBtn) {
      fbClick(rxBtn, true);
      await randomDelay(0.5, 0.9);
      return true;
    }
  }

  // Fallback if hover didn't trigger reaction bar: click button directly
  fbClick(btn);
  await randomDelay(0.5, 0.8);
  return true;
}

export const FacebookInteraction = {
  name: 'FacebookInteraction',
  isRunning: false,
  activeTask: null,

  async stop() {
    this.isRunning = false;
    this.activeTask = null;
    console.log('[FacebookInteraction] Stopped.');
  },

  /**
   * Auto-Like / Auto-Reaction continuous loop.
   */
  async startContinuousAutoLike(onProgressCallback, options = {}) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'like';
    const chosenReaction = options?.reaction || 'Suka';

    let count = 0;
    const processed = new WeakSet();
    console.log('[FacebookInteraction] Auto-Like/Reaction started with target reaction:', chosenReaction);

    while (this.isRunning && this.activeTask === 'like') {
      const posts = scanFbFeedPosts(40);
      const target = posts.find(p => p.likeBtn && !p.hasLiked && !processed.has(p.element));

      if (target) {
        processed.add(target.element);
        try {
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(0.8, 1.5);
          const freshBtn = findFbLikeButton(target.element);
          if (freshBtn && !fbIsAlreadyLiked(target.element)) {
            await fbPerformReaction(freshBtn, chosenReaction);
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: target.author, reaction: chosenReaction });
          }
          await randomDelay(2.5, 4.5);
        } catch (e) {
          console.warn('[FacebookInteraction] Auto-like error:', e);
        }
      } else {
        // Fallback: search directly for un-liked "Suka" buttons on page
        const rawBtns = Array.from(document.querySelectorAll('[aria-label="Suka"][role="button"], [aria-label="Like"][role="button"]'))
          .filter(b => {
            const label = (b.getAttribute('aria-label') || '').trim();
            if (label.includes(':')) return false;
            const parent = b.closest('div[role="article"]') || b.parentElement;
            if (processed.has(b) || (parent && processed.has(parent))) return false;
            if (parent && fbIsAlreadyLiked(parent)) return false;
            return true;
          });

        if (rawBtns.length > 0) {
          const btn = rawBtns[0];
          const parent = btn.closest('div[role="article"]') || btn.parentElement;
          if (parent) processed.add(parent);
          processed.add(btn);

          try {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await randomDelay(0.8, 1.5);
            await fbPerformReaction(btn, chosenReaction);
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: 'User', reaction: chosenReaction });
            await randomDelay(2.5, 4.5);
          } catch (e) {
            console.warn('[FacebookInteraction] Fallback like error:', e);
          }
        } else {
          window.scrollBy({ top: 600, behavior: 'smooth' });
          await randomDelay(2, 3.5);
        }
      }
    }

    return { success: true, totalProcessed: count };
  },

  /**
   * Auto-Comment (AI-generated) continuous loop.
   */
  async startContinuousAutoComment(onProgressCallback, generateCommentFn) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'comment';

    let count = 0;
    const processedAuthors = new Set();
    const processedElements = new WeakSet();
    console.log('[FacebookInteraction] Auto-Comment started...');

    while (this.isRunning && this.activeTask === 'comment') {
      if (!chrome.runtime?.id) {
        console.warn('[FacebookInteraction] Extension context invalidated. Stopping.');
        this.isRunning = false;
        break;
      }

      // === Skip Reel pages — do not comment on reels ===
      const currentUrl = window.location.href;
      if (currentUrl.includes('/reel/') || currentUrl.includes('/reels/')) {
        console.log('[FacebookInteraction] Skipping Reel page, scrolling past...');
        window.scrollBy({ top: 800, behavior: 'smooth' });
        await randomDelay(2, 3.5);
        continue;
      }

      // === STEP 1: If ANY dialog modal is open, handle it exclusively and NEVER scroll the background feed! ===
      const openDialog = document.querySelector('[role="dialog"]');
      if (openDialog) {
        const dialogCommentInput = openDialog.querySelector(
          'div[contenteditable="true"][role="textbox"], ' +
          'div[contenteditable="true"][aria-label*="sebagai"], ' +
          'div[contenteditable="true"][aria-placeholder*="sebagai"], ' +
          'div[contenteditable="true"][data-lexical-editor="true"], ' +
          'div[contenteditable="true"]'
        );

        if (dialogCommentInput && !processedElements.has(dialogCommentInput)) {
          processedElements.add(dialogCommentInput);
          processedElements.add(openDialog);
          console.log('[FacebookInteraction] Dialog modal detected on screen! Processing comment...');

          // Extract post text from open dialog
          const dialogTextDivs = Array.from(openDialog.querySelectorAll('div[dir="auto"], span[dir="auto"]'));
          const dialogTextParts = [];
          for (const el of dialogTextDivs) {
            const txt = (el.textContent || '').trim();
            if (txt.length > 15 && !dialogTextParts.includes(txt) && !txt.startsWith('Komentari sebagai')) {
              dialogTextParts.push(txt);
            }
          }
          const postText = dialogTextParts.join(' ').slice(0, 500) || 'Postingan Facebook populer';
          console.log('[FacebookInteraction] Dialog post text:', postText.slice(0, 100));

          let commentText = '';
          if (generateCommentFn) {
            console.log('[FacebookInteraction] Generating AI comment...');
            commentText = await generateCommentFn(postText);
            console.log('[FacebookInteraction] AI generated comment:', commentText ? commentText.slice(0, 100) : '(empty)');
          }

          if (commentText) {
            try {
              dialogCommentInput.focus();
              await randomDelay(0.5, 1);

              console.log('[FacebookInteraction] Typing comment into input...');
              fbSetLexicalText(dialogCommentInput, commentText);
              await randomDelay(1.2, 2.2);

              const submitBtn = findFbCommentSubmitButton(openDialog);
              if (submitBtn) {
                console.log('[FacebookInteraction] Found submit button:', submitBtn.getAttribute('aria-label') || submitBtn.textContent?.slice(0, 30));
                await randomDelay(0.5, 1);
                fbClick(submitBtn, true);
                console.log('[FacebookInteraction] Clicked submit button.');
              } else {
                dialogCommentInput.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                }));
                dialogCommentInput.dispatchEvent(new KeyboardEvent('keypress', {
                  key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                }));
                console.log('[FacebookInteraction] Pressed Enter to submit.');
              }

              await randomDelay(2.5, 4);
              count++;
              const author = extractFbAuthor(openDialog) || 'User';
              if (onProgressCallback) onProgressCallback({ count, author, replyText: commentText });

              // After successfully commenting, immediately refresh facebook.com as requested by user
              console.log('[FacebookInteraction] Comment posted! Refreshing facebook.com...');
              await randomDelay(1, 2);
              window.location.href = 'https://www.facebook.com';
              return { success: true, totalProcessed: count };
            } catch (e) {
              console.warn('[FacebookInteraction] Error commenting on dialog:', e);
            }
          }
        }

        // ALWAYS force close the open dialog before doing anything else!
        console.log('[FacebookInteraction] Closing open dialog modal...');
        await closeFbModal(openDialog);
        await randomDelay(1.5, 2.5);
        continue; // Loop back and verify dialog is gone before scanning feed
      }

      // === STEP 2: NO dialog is open on screen! Scan feed for next post ===
      const posts = scanFbFeedPosts(40);
      let target = posts.find(p => {
        if (!p.commentBtn) return false;
        const authorKey = (p.author || '').trim().toLowerCase();
        if (authorKey && authorKey !== 'user' && processedAuthors.has(authorKey)) return false;
        return !processedElements.has(p.element);
      });

      console.log('[FacebookInteraction] Feed scan:', posts.length, 'posts found,', target ? `target: ${target.author}` : 'no target');

      if (target) {
        const authorKey = (target.author || '').trim().toLowerCase();
        if (authorKey && authorKey !== 'user') processedAuthors.add(authorKey);
        processedElements.add(target.element);

        try {
          console.log('[FacebookInteraction] Scrolling feed to target post:', target.author);
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1.2, 2.2);

          console.log('[FacebookInteraction] Clicking comment button to open post modal...');
          fbClick(target.commentBtn);
          await randomDelay(2, 3.5);

          // Loop back to STEP 1 where the newly opened dialog modal will be processed!
          continue;
        } catch (e) {
          console.warn('[FacebookInteraction] Error clicking comment button:', e);
        }
      } else {
        // No un-commented post found on current view, scroll feed down smoothly
        console.log('[FacebookInteraction] No target on current view, scrolling feed down...');
        window.scrollBy({ top: 500, behavior: 'smooth' });
        await randomDelay(2.5, 4);
      }
    }

    return { success: true, totalProcessed: count };
  },

  /**
   * Auto-Follow continuous loop.
   */
  async startContinuousAutoFollow(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'follow';

    let count = 0;
    const processed = new WeakSet();
    console.log('[FacebookInteraction] Auto-Follow started...');

    while (this.isRunning && this.activeTask === 'follow') {
      const posts = scanFbFeedPosts(40);
      const target = posts.find(p => p.followBtn && !processed.has(p.element));

      if (target) {
        processed.add(target.element);
        try {
          target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);
          const freshBtn = findFbFollowButton(target.element);
          if (freshBtn) {
            fbClick(freshBtn);
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: target.author });
          }
          await randomDelay(3, 6);
        } catch (e) {
          console.warn('[FacebookInteraction] Auto-follow error:', e);
        }
      } else {
        window.scrollBy({ top: 700, behavior: 'smooth' });
        await randomDelay(2, 4);
      }
    }

    return { success: true, totalProcessed: count };
  },

  /**
   * Auto-Share continuous loop.
   */
  async startContinuousAutoShare(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'share';

    let count = 0;
    const processed = new WeakSet();
    console.log('[FacebookInteraction] Auto-Share started...');

    while (this.isRunning && this.activeTask === 'share') {
      const articles = Array.from(document.querySelectorAll('div[role="article"]'));
      const target = articles.find(art => {
        if (processed.has(art)) return false;
        const shareBtn = art.querySelector('[aria-label*="Bagikan"][role="button"], [aria-label*="Share"][role="button"]');
        return !!shareBtn;
      });

      if (target) {
        processed.add(target);
        try {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);
          const shareBtn = target.querySelector('[aria-label*="Bagikan"][role="button"], [aria-label*="Share"][role="button"]');
          if (shareBtn) {
            fbClick(shareBtn);
            await randomDelay(1.5, 2.5);

            // Click "Share now" / "Bagikan sekarang" if popup menu opens
            const shareNowBtn = Array.from(document.querySelectorAll('[role="menuitem"], [role="button"]')).find(el => {
              const txt = (el.textContent || '').toLowerCase();
              return txt.includes('bagikan sekarang') || txt.includes('share now');
            });
            if (shareNowBtn) {
              fbClick(shareNowBtn);
            }
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: extractFbAuthor(target) });
          }
          await randomDelay(4, 7);
        } catch (e) {
          console.warn('[FacebookInteraction] Auto-share error:', e);
        }
      } else {
        window.scrollBy({ top: 700, behavior: 'smooth' });
        await randomDelay(2, 4);
      }
    }

    return { success: true, totalProcessed: count };
  },

  /**
   * Auto-View Story continuous loop.
   */
  async startContinuousAutoStory(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'story';

    let count = 0;
    console.log('[FacebookInteraction] Auto-View Story started...');

    // Try clicking first story card
    const storyCard = document.querySelector('div[aria-label*="Cerita"][role="button"], div[role="button"][aria-label*="Story"]');
    if (storyCard) {
      fbClick(storyCard);
      await randomDelay(2, 3);
    }

    while (this.isRunning && this.activeTask === 'story') {
      try {
        count++;
        if (onProgressCallback) onProgressCallback({ count });
        await randomDelay(4, 7);

        // Next story button
        const nextBtn = document.querySelector('[aria-label="Cerita Berikutnya"][role="button"]') ||
                        document.querySelector('[aria-label="Next story"][role="button"]') ||
                        document.querySelector('[aria-label="Selanjutnya"][role="button"]');
        if (nextBtn) {
          fbClick(nextBtn);
        } else {
          // If story viewer closed or finished
          break;
        }
      } catch (e) {
        console.warn('[FacebookInteraction] Auto-story error:', e);
        break;
      }
    }

    return { success: true, totalProcessed: count };
  }
};
