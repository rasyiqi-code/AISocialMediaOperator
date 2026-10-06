/**
 * Facebook Interaction Engine
 * Auto-Like, AI Comment, Auto-Follow for facebook.com
 *
 * Selectors verified from live DOM dump 2026-08-07:
 *   - Post containers : anchored on the per-post 3-dot menu
 *     [aria-label="Tindakan untuk postingan oleh ..."] (div[role="article"]
 *     now matches empty placeholder divs, NOT real posts).
 *   - Like button     : div[aria-label="Suka"][role="button"]
 *   - Already liked   : div[aria-label="Batalkan suka"] or aria-label starts with "Suka:"
 *   - Comment button  : div[role="button"] text "Balas" (or aria-label "Komentar")
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
 * Check if an element is currently rendered & visible. Facebook keeps dialog
 * shells in the DOM after closing (display:none), so queries must not trust
 * mere presence of [role="dialog"].
 */
function fbIsVisible(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Find active comment input (Lexical contenteditable editor) inside modal dialog, post target, or document.
 */
function findActiveFbCommentInput(targetElement) {
  // 1. Search inside open dialog modal first (highest priority)
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(fbIsVisible);
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
 * Excludes false positives like the Share button ("Kirim ini ke teman atau
 * posting di profil Anda.") and the post 3-dot menu ("Tindakan untuk postingan
 * oleh ..."), which share the "kirim"/"posting" prefixes in Indonesian FB.
 */
function findFbCommentSubmitButton(scope, inputEl = null) {
  if (!scope) return null;
  const allBtns = Array.from(scope.querySelectorAll('[role="button"], button'));

  const isUnrelated = el => {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    const text = (el.textContent || '').trim().toLowerCase();
    const meta = label || text;
    if (!meta) return true;
    // Share button & post action menus are the main false positives
    if (meta.includes('kirim ini') || meta.includes('bagikan') || meta.includes('share') ||
        meta.includes('teman atau posting di profil') || meta.includes('tindakan untuk') ||
        meta.includes('tandai sebagai dibaca')) return true;
    // Like / reaction / close buttons
    if (meta.includes('suka') || meta.includes('like') || meta.includes('reaksi') ||
        meta.includes('reaction') || meta.includes('tutup') || meta.includes('close')) return true;
    return false;
  };

  // Priority 1: Exact aria-label matches for submit buttons
  const exactLabels = ['posting komentar', 'post comment', 'kirim komentar', 'send comment', 'kirim', 'send'];
  for (const btn of allBtns) {
    if (isUnrelated(btn)) continue;
    const label = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (exactLabels.includes(label)) return btn;
  }

  // Priority 2: aria-label starts with "posting" or "kirim" (safe now that share/actions excluded)
  for (const btn of allBtns) {
    if (isUnrelated(btn)) continue;
    const label = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (label.startsWith('posting') || label.startsWith('kirim')) {
      return btn;
    }
  }

  // Priority 3: Button text equals submit keywords
  for (const btn of allBtns) {
    if (isUnrelated(btn)) continue;
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'kirim' || text === 'send' || text === 'posting' || text === 'post') {
      return btn;
    }
  }

  // Priority 4: single icon-only button near the input (FB's comment send arrow
  // appears only after typing and has no accessible label)
  if (inputEl) {
    const container = inputEl.closest('form') ||
      inputEl.closest('div[class*="notranslate"]') ||
      inputEl.parentElement?.parentElement?.parentElement ||
      inputEl.parentElement;
    if (container) {
      const iconBtns = Array.from(container.querySelectorAll('[role="button"], button')).filter(b => {
        if (b.getAttribute('aria-hidden') === 'true') return false;
        if (b.getAttribute('aria-disabled') === 'true') return false;
        const label = (b.getAttribute('aria-label') || '').trim();
        const text = (b.textContent || '').trim();
        return !label && !text; // icon-only button
      });
      if (iconBtns.length === 1) return iconBtns[0];
    }
  }

  return null;
}

/**
 * Close any open Facebook modal dialog.
 * Returns true when no visible dialog remains. Uses aria-label close button,
 * then Escape key (document + window) fallback.
 */
async function closeFbModal(dialog = null) {
  const targetDialog = dialog || Array.from(document.querySelectorAll('[role="dialog"]')).find(fbIsVisible);
  if (!targetDialog || !fbIsVisible(targetDialog)) return true;

  console.log('[FacebookInteraction] Closing open modal dialog...');

  const closeBtn = targetDialog.querySelector(
    '[aria-label="Tutup"][role="button"], [aria-label="Tutup"], ' +
    '[aria-label="Close"][role="button"], [aria-label="Close"]'
  );

  if (closeBtn) {
    fbClick(closeBtn, true);
    await randomDelay(1, 1.8);
    if (!Array.from(document.querySelectorAll('[role="dialog"]')).some(fbIsVisible)) return true;
  }

  // If dialog is STILL open, press Escape on both document and window
  const esc = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent('keydown', esc));
  window.dispatchEvent(new KeyboardEvent('keydown', esc));
  await randomDelay(1, 1.5);

  return !Array.from(document.querySelectorAll('[role="dialog"]')).some(fbIsVisible);
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
      // Note: current FB DOM (2026-08 dump) labels the post comment action as
      // text "Balas" with NO aria-label — must match by text too.
      return label.includes('beri komentar') || label.includes('komentar') || label.includes('comment') ||
             label.includes('balas') || label.includes('reply') ||
             text === 'komentar' || text === 'comment' ||
             text === 'balas' || text === 'reply';
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
 * Find the Share button inside a Facebook post.
 * On the Indonesian feed it is aria-label="Kirim ini ke teman atau posting
 * di profil Anda." (the dialog's own buttons are labeled "Bagikan...", so we
 * must match the trigger, not the dialog). Scoped to a single post container.
 */
function findFbShareButton(article) {
  if (!article) return null;
  return (
    article.querySelector('[aria-label*="Kirim ini ke teman"][role="button"]') ||
    article.querySelector('[aria-label*="Send this to friends"][role="button"]') ||
    article.querySelector('[aria-label*="posting di profil"][role="button"]') ||
    article.querySelector('[aria-label*="post on your profile"][role="button"]') ||
    article.querySelector('[aria-label^="Bagikan"][role="button"]') ||
    article.querySelector('[aria-label^="Share"][role="button"]') ||
    Array.from(article.querySelectorAll('[role="button"]')).find(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      return label.includes('kirim ini') || label.includes('bagikan') ||
             label.includes('share') || label.includes('send this to friends');
    }) || null
  );
}

/**
 * Find the visible Share dialog (the "Bagikan" modal opened after clicking a
 * post's share button). It contains the "Bagikan sekarang" / "Share now" button.
 */
function findFbShareDialog() {
  return Array.from(document.querySelectorAll('[role="dialog"]')).find(d => {
    if (!fbIsVisible(d)) return false;
    const txt = (d.textContent || '').toLowerCase();
    return txt.includes('bagikan sekarang') || txt.includes('share now');
  }) || null;
}

/**
 * Normalize a profile link into a stable dedupe key.
 * Facebook uses /profile.php?id=... or /username paths; the same friend appears
 * multiple times on the Friends page (avatar link, name link), so we dedupe.
 */
function fbNormalizeProfileUrl(href) {
  if (!href) return '';
  const url = href.startsWith('http') ? href : 'https://www.facebook.com' + href;
  const idMatch = url.match(/profile\.php\?[^#]*id=(\d+)/);
  if (idMatch) return 'id:' + idMatch[1];
  const path = url
    .replace(/^https:\/\/(www\.|web\.|m\.|mbasic\.)?facebook\.com\/?/i, '')
    .split(/[?#]/)[0]
    .replace(/\/$/, '');
  return path;
}

/**
 * Collect friend profile links from the Friends list page (facebook.com/friends).
 * Scoped to div[role="main"], deduped by normalized URL, keeping the first
 * (usually the avatar) link per friend. Names come from aria-label / title,
 * then the avatar's img[alt], then the link's short text.
 */
function findFbFriendLinks() {
  const scope = document.querySelector('div[role="main"]') || document.body;
  const skipPath = /^(friends\/?$|groups|watch|marketplace|messages|direct|story|stories|reel|reels|events|pages|settings|help|policy|about|policies|login|home|notifications|find-friends|saved|profile|me|p|sharer|intent|hashtag|photo|videos?|people|search|pay|fundraisers|gaming|jobs|shortform|friends_lists|invite|campaign|business|apps|game|live|comments|privacy|support|account|security|welcome|requests|fundraiser|payments|gifts|notes|photo_fbid|change_name|contact|friends_tab|reviews|list|wellbeing|local|shortcuts|watch_tab|gaming_tab|videos_tab)/i;

  const results = new Map();
  const anchors = scope.querySelectorAll('a[href]');
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript')) continue;

    const key = fbNormalizeProfileUrl(href);
    if (!key || key === 'friends' || key === 'friends/' || skipPath.test(key)) continue;
    if (key.startsWith('id:')) {
      // numeric profile id — always a profile
    } else if (key.includes('/') || key.length < 3) {
      continue; // non-profile paths
    }

    let name = (a.getAttribute('aria-label') || a.getAttribute('title') || '').trim();
    if (!name) {
      const img = a.querySelector('img');
      if (img) name = (img.getAttribute('alt') || '').trim();
    }
    if (!name) {
      const txt = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length > 0 && txt.length < 40) name = txt;
    }
    if (!name) continue;

    if (!results.has(key)) results.set(key, { url: href, name, el: a });
  }
  return Array.from(results.values());
}

/**
 * Process an open comment dialog (the modal opened after clicking a post's
 * comment button): type an AI-generated comment and submit it. Returns
 * { done:true, commentText } on success, or { done:false } when no dialog /
 * no input / generation failed (dialog is force-closed in that case).
 */
async function processOpenFbCommentDialog(generateCommentFn) {
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(fbIsVisible);
  if (!dialog) return { done: false, dialog: false };

  const input = dialog.querySelector(
    'div[contenteditable="true"][role="textbox"], ' +
    'div[contenteditable="true"][aria-label*="sebagai"], ' +
    'div[contenteditable="true"][aria-placeholder*="sebagai"], ' +
    'div[contenteditable="true"][data-lexical-editor="true"], ' +
    'div[contenteditable="true"]'
  );
  if (!input) {
    await closeFbModal(dialog);
    return { done: false, closed: true };
  }

  const textDivs = Array.from(dialog.querySelectorAll('div[dir="auto"], span[dir="auto"]'));
  const parts = [];
  for (const el of textDivs) {
    const txt = (el.textContent || '').trim();
    if (txt.length > 15 && !parts.includes(txt) && !txt.startsWith('Komentari sebagai')) parts.push(txt);
  }
  const postText = parts.join(' ').slice(0, 500) || 'Postingan teman di Facebook';

  let commentText = '';
  if (generateCommentFn) commentText = await generateCommentFn(postText);
  if (!commentText) {
    await closeFbModal(dialog);
    return { done: false, closed: true };
  }

  try {
    input.focus();
    await randomDelay(0.5, 1);
    await simulateHumanTyping(input, commentText, 'medium');
    await randomDelay(1.2, 2.2);

    const submitBtn = findFbCommentSubmitButton(dialog, input);
    if (submitBtn) {
      await randomDelay(0.5, 1);
      fbClick(submitBtn, true);
    } else {
      input.focus();
      const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
      input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
      input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    }
    await randomDelay(2.5, 4);
    await closeFbModal(dialog);
    return { done: true, commentText, postText };
  } catch (e) {
    console.warn('[FacebookInteraction] Error typing comment in dialog:', e);
    await closeFbModal(dialog);
    return { done: false, closed: true };
  }
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
 * True if the element is a per-post 3-dot menu ("Tindakan untuk postingan oleh X ini").
 * This is the most reliable anchor for real feed posts in the current FB DOM;
 * div[role="article"] now matches empty placeholder divs instead of posts.
 */
function isFbPostMenu(el) {
  if (!el) return false;
  const label = (el.getAttribute('aria-label') || '').toLowerCase();
  const isPostMenu = label.includes('tindakan untuk postingan') ||
                     label.includes('actions for this post') ||
                     label.includes('actions for the post') ||
                     (label.includes('actions for') && !label.includes('comment'));
  if (!isPostMenu) return false;
  // Comment/reply menus share the same pattern ("Tindakan untuk komentar ...") — exclude them
  return !label.includes('komentar') && !label.includes('comment');
}

/**
 * Find the largest ancestor that contains exactly ONE real post, anchored on the
 * per-post 3-dot menu. Returns deduped post containers in document order.
 */
function findFbPostContainers(maxPosts = 30) {
  const btnSel = 'div[role="button"], button, [role="menuitem"]';
  const menus = Array.from(document.querySelectorAll(btnSel)).filter(isFbPostMenu);
  const containers = [];
  const seen = new Set();

  for (const menu of menus) {
    let cur = menu.parentElement;
    let container = null;
    for (let depth = 0; cur && depth < 12; depth++) {
      const menuCount = Array.from(cur.querySelectorAll(btnSel)).filter(isFbPostMenu).length;
      if (menuCount === 1) {
        container = cur;
      } else if (menuCount > 1) {
        break; // climbed into an ancestor containing sibling posts — stop here
      }
      cur = cur.parentElement;
    }
    if (container && !seen.has(container)) {
      seen.add(container);
      containers.push(container);
    }
  }
  return containers.slice(0, maxPosts);
}

/**
 * Scan visible Facebook post articles in the feed.
 */
function scanFbFeedPosts(maxPosts = 30) {
  let articles = findFbPostContainers(maxPosts);

  // Fallback 1: visible article elements that actually contain a post (text + buttons)
  if (articles.length === 0) {
    articles = Array.from(document.querySelectorAll('div[role="article"], div[data-pagelet*="FeedUnit"]'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel.includes('komentar oleh') || ariaLabel.includes('balasan oleh') ||
            ariaLabel.includes('comment by') || ariaLabel.includes('reply by')) {
          return false; // skip comments
        }
        const hasText = (el.textContent || '').trim().length > 0;
        const hasButtons = !!el.querySelector('[role="button"]');
        return hasText && hasButtons; // skip empty placeholder article shells
      })
      .slice(0, maxPosts);
  }

  // Fallback 2: anchor directly on Like buttons
  if (articles.length === 0) {
    const likeBtns = Array.from(document.querySelectorAll('[aria-label="Suka"][role="button"], [aria-label="Like"][role="button"]'))
      .filter(b => !(b.getAttribute('aria-label') || '').includes(':'));
    articles = likeBtns.map(b => b.closest('div[role="article"]') || b.closest('div[data-pagelet]') || b.parentElement?.parentElement?.parentElement || b).filter(Boolean).slice(0, maxPosts);
  }

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

function loadFbProcessedAuthors() {
  try {
    const raw = sessionStorage.getItem('fbProcessedAuthors');
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) {
    return new Set();
  }
}

function saveFbProcessedAuthors(set) {
  try {
    sessionStorage.setItem('fbProcessedAuthors', JSON.stringify(Array.from(set).slice(-500)));
  } catch (e) {}
}

export const FacebookInteraction = {
  name: 'FacebookInteraction',
  isRunning: false,
  activeTask: null,

  async stop() {
    this.isRunning = false;
    this.activeTask = null;
    try {
      sessionStorage.removeItem('fbAutoLoopMode');
    } catch (e) {}
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
    try { sessionStorage.setItem('fbAutoLoopMode', 'comment'); } catch (e) {}

    let count = 0;
    const processedAuthors = loadFbProcessedAuthors();
    const processedElements = new WeakSet();
    let failedDialogCloses = 0;
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
      const openDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(fbIsVisible);
      if (openDialog) {
        failedDialogCloses = 0;
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
              // Use the same Lexical-friendly path (beforeinput insertText) the
              // injected AI widget uses on this composer — execCommand is ignored
              // by Facebook's Lexical editor.
              await simulateHumanTyping(dialogCommentInput, commentText, 'medium');
              await randomDelay(1.2, 2.2);

              const submitBtn = findFbCommentSubmitButton(openDialog, dialogCommentInput);
              if (submitBtn) {
                console.log('[FacebookInteraction] Found submit button:', submitBtn.getAttribute('aria-label') || submitBtn.textContent?.slice(0, 30));
                await randomDelay(0.5, 1);
                fbClick(submitBtn, true);
                console.log('[FacebookInteraction] Clicked submit button.');
              } else {
                dialogCommentInput.focus();
                const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                dialogCommentInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                dialogCommentInput.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
                dialogCommentInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
                console.log('[FacebookInteraction] Pressed Enter to submit.');
              }

              await randomDelay(2.5, 4);
              count++;
              const author = extractFbAuthor(openDialog) || 'User';
              if (author && author.toLowerCase() !== 'user') {
                processedAuthors.add(author.toLowerCase());
                saveFbProcessedAuthors(processedAuthors);
              }
              if (onProgressCallback) onProgressCallback({ count, author, replyText: commentText });

              // After successfully commenting, close modal and continue feed loop
              console.log('[FacebookInteraction] Comment posted! Closing dialog modal and continuing feed loop...');
              await randomDelay(1, 2);
              await closeFbModal(openDialog);
              await randomDelay(1.5, 2.5);
              window.scrollBy({ top: 600, behavior: 'smooth' });
              await randomDelay(2, 4);
              continue;
            } catch (e) {
              console.warn('[FacebookInteraction] Error commenting on dialog:', e);
            }
          }
        }

        // ALWAYS force close the open dialog before doing anything else!
        console.log('[FacebookInteraction] Closing open dialog modal...');
        const dialogClosed = await closeFbModal(openDialog);
        if (!dialogClosed) {
          failedDialogCloses++;
          console.warn(`[FacebookInteraction] Dialog masih terbuka setelah percobaan ke-${failedDialogCloses}.`);
          if (failedDialogCloses >= 3) {
            console.warn('[FacebookInteraction] Dialog tidak dapat ditutup. Menghentikan Auto-Comment untuk mencegah loop tak berujung.');
            this.isRunning = false;
            break;
          }
        }
        await randomDelay(1.5, 2.5);
        continue; // Loop back and verify dialog is gone before scanning feed
      }
      failedDialogCloses = 0;

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
        if (authorKey && authorKey !== 'user') {
          processedAuthors.add(authorKey);
          saveFbProcessedAuthors(processedAuthors);
        }
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
      const articles = scanFbFeedPosts(40).map(p => p.element);
      const target = articles.find(art => {
        if (processed.has(art)) return false;
        return !!findFbShareButton(art);
      });

      if (target) {
        processed.add(target);
        try {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(1, 2);
          const shareBtn = findFbShareButton(target);
          if (shareBtn) {
            fbClick(shareBtn);
            await randomDelay(1.5, 2.5);

            // Wait for the Share dialog to open, then click "Bagikan sekarang".
            let dialog = findFbShareDialog();
            for (let i = 0; i < 5 && !dialog; i++) {
              await randomDelay(0.5, 1);
              dialog = findFbShareDialog();
            }

            const shareNowBtn = dialog
              ? Array.from(dialog.querySelectorAll('[role="button"]')).find(el => {
                  const txt = (el.textContent || '').trim().toLowerCase();
                  return txt === 'bagikan sekarang' || txt === 'share now';
                })
              : null;

            if (shareNowBtn) {
              fbClick(shareNowBtn, true);
              await randomDelay(1, 2);
            } else {
              console.warn('[FacebookInteraction] Tombol "Bagikan sekarang" tidak ditemukan di dialog share.');
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
   * Auto-Interaksi Personal continuous loop.
   * Visits each friend's profile (from facebook.com/friends), then randomly
   * likes & AI-comments on some of their posts before moving to the next friend.
   *
   * Like Auto-View Story, the loop first navigates to /friends — that full page
   * load destroys this content-script context, so we persist a pending flag
   * (fbAutoPersonalPending) that content_main.js reads after re-init to resume.
   */
  async startContinuousAutoPersonalInteraction(onProgressCallback, generateCommentFn) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'personal';

    console.log('[FacebookInteraction] Auto-Interaksi Personal dimulai...');

    // === STEP 0: make sure we are on the Friends list page ===
    if (!window.location.href.includes('facebook.com/friends')) {
      console.log('[FacebookInteraction] Menuju https://www.facebook.com/friends/ ...');
      try { await chrome.storage.local.set({ fbAutoPersonalPending: true }); } catch (e) {}
      window.location.href = 'https://www.facebook.com/friends/';
      return { success: true, totalVisited: 0, navigated: true };
    }

    const visitedFriends = new Set();
    const processedPosts = new WeakSet();
    let friendsVisited = 0;
    let likeCount = 0;
    let commentCount = 0;
    let currentFriendName = '';
    let profileActions = 0;
    let profileActionBudget = 0;
    let profileScrollFails = 0;

    while (this.isRunning && this.activeTask === 'personal') {
      if (!chrome.runtime?.id) {
        console.warn('[FacebookInteraction] Extension context invalidated. Stopping.');
        this.isRunning = false;
        break;
      }

      const url = window.location.href;

      // === Finish any open comment dialog first (never scroll the feed behind it) ===
      const dialogRes = await processOpenFbCommentDialog(generateCommentFn);
      if (dialogRes.done) {
        commentCount++;
        profileActions++;
        if (onProgressCallback) onProgressCallback({
          count: friendsVisited, likes: likeCount, comments: commentCount,
          author: currentFriendName, replyText: dialogRes.commentText
        });
        await randomDelay(2, 3.5);
        continue;
      }

      if (url.includes('facebook.com/friends')) {
        // === On Friends page: pick the next unvisited friend ===
        const friends = findFbFriendLinks();
        console.log('[FacebookInteraction] Friends terdeteksi:', friends.length);
        const next = friends.find(f => !visitedFriends.has(fbNormalizeProfileUrl(f.url)));

        if (next) {
          const key = fbNormalizeProfileUrl(next.url);
          visitedFriends.add(key);
          currentFriendName = next.name;
          profileActions = 0;
          profileActionBudget = 2 + Math.floor(Math.random() * 4); // 2-5 aksi per teman
          profileScrollFails = 0;
          console.log(`[FacebookInteraction] Mengunjungi profil teman: ${next.name} (budget ${profileActionBudget} aksi)`);

          next.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(0.8, 1.5);
          fbClick(next.el, true); // SPA navigation — content script survives
          await randomDelay(4, 6);
          continue;
        }

        // All visible friends visited -> scroll to load more (or wrap around)
        console.log('[FacebookInteraction] Semua teman yang terlihat sudah dikunjungi, scroll untuk memuat lebih...');
        window.scrollBy({ top: 900, behavior: 'smooth' });
        await randomDelay(2, 3.5);
        continue;
      }

      // === Stray page (home/notifications...)? Go back to the Friends list ===
      if (!currentFriendName) {
        console.log('[FacebookInteraction] Berada di halaman yang bukan daftar teman, kembali ke /friends...');
        try { await chrome.storage.local.set({ fbAutoPersonalPending: true }); } catch (e) {}
        window.location.href = 'https://www.facebook.com/friends/';
        return { success: true, totalVisited: friendsVisited, navigated: true };
      }

      // === Done interacting with this friend -> back to Friends list ===
      if (profileActionBudget > 0 && profileActions >= profileActionBudget) {
        friendsVisited++;
        console.log(`[FacebookInteraction] Selesai dengan ${currentFriendName}, kembali ke daftar teman...`);
        if (onProgressCallback) onProgressCallback({
          count: friendsVisited, likes: likeCount, comments: commentCount, author: currentFriendName, doneFriend: true
        });
        window.history.back();
        await randomDelay(4, 6);
        continue;
      }

      // === On a friend's profile: randomly like / comment / skip posts ===
      const posts = scanFbFeedPosts(20);
      const unprocessed = posts.filter(p => !processedPosts.has(p.element));

      if (unprocessed.length > 0) {
        profileScrollFails = 0;
        const post = unprocessed[Math.floor(Math.random() * unprocessed.length)];
        processedPosts.add(post.element);
        const roll = Math.random();

        if (roll < 0.55 && post.likeBtn) {
          post.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(0.8, 1.5);
          const freshBtn = findFbLikeButton(post.element);
          if (freshBtn && !fbIsAlreadyLiked(post.element)) {
            await fbPerformReaction(freshBtn, 'Suka');
            likeCount++;
            profileActions++;
            if (onProgressCallback) onProgressCallback({
              count: friendsVisited, likes: likeCount, comments: commentCount, author: currentFriendName
            });
          }
        } else if (roll < 0.82 && post.commentBtn) {
          post.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await randomDelay(0.8, 1.5);
          console.log('[FacebookInteraction] Membuka komentar untuk menyapa teman (AI)...');
          fbClick(post.commentBtn); // dialog diproses di iterasi berikutnya
        } else {
          console.log('[FacebookInteraction] Postingan dilewati secara acak.');
        }
        await randomDelay(2.5, 4.5);
      } else {
        profileScrollFails++;
        window.scrollBy({ top: 700, behavior: 'smooth' });
        await randomDelay(2.5, 4);
        if (profileScrollFails >= 3) {
          console.log('[FacebookInteraction] Tidak ada postingan baru di profil ini, pindah ke teman berikutnya...');
          friendsVisited++;
          window.history.back();
          await randomDelay(4, 6);
        }
      }
    }

    return { success: true, totalVisited: friendsVisited, likes: likeCount, comments: commentCount };
  },

  /**
   * Auto-View Story continuous loop.
   * Navigates directly to https://www.facebook.com/stories/ first (the story
   * viewer only exists there), then walks through each friend's story card.
   */
  async startContinuousAutoStory(onProgressCallback) {
    if (this.isRunning) await this.stop();
    this.isRunning = true;
    this.activeTask = 'story';

    let count = 0;
    console.log('[FacebookInteraction] Auto-View Story started...');

    // === STEP 0: Navigate to the Stories page if we are not already there.
    // Navigation destroys this content-script context, so persist a pending
    // flag that content_main.js reads after re-init to resume the loop. ===
    if (!window.location.href.includes('facebook.com/stories')) {
      console.log('[FacebookInteraction] Navigating to https://www.facebook.com/stories/ ...');
      try { await chrome.storage.local.set({ fbAutoStoryPending: true }); } catch (e) {}
      window.location.href = 'https://www.facebook.com/stories/';
      return { success: true, totalProcessed: 0, navigated: true };
    }

    // Story cards on the tray: div[role="button"] whose text starts with
    // "Cerita"/"Story" and has a non-empty id. The first "Cerita <You>" card
    // (your own story) has an EMPTY id — skip it.
    const isStoryCard = el => {
      const text = (el.textContent || '').trim();
      return /^(Cerita|Story)\s/.test(text);
    };
    const visibleCards = () => Array.from(document.querySelectorAll('div[role="button"], a[role="link"]'))
      .filter(el => fbIsVisible(el) && isStoryCard(el) && !!el.getAttribute('id'));

    // Wait for the story tray to render
    let initialCards = visibleCards();
    for (let i = 0; initialCards.length === 0 && i < 10; i++) {
      await randomDelay(1, 1.5);
      initialCards = visibleCards();
    }
    console.log(`[FacebookInteraction] ${initialCards.length} story found.`);

    const processedIds = new Set();

    if (initialCards.length > 0) {
      if (initialCards[0].getAttribute('id')) processedIds.add(initialCards[0].getAttribute('id'));
      fbClick(initialCards[0]);
      await randomDelay(3, 5);
    } else {
      // Fallback: aria-label based story card
      const storyCard = document.querySelector('div[aria-label*="Cerita"][role="button"], div[role="button"][aria-label*="Story"]');
      if (storyCard) {
        fbClick(storyCard);
        await randomDelay(3, 5);
      }
    }

    while (this.isRunning && this.activeTask === 'story') {
      try {
        count++;
        if (onProgressCallback) onProgressCallback({ count });

        // Let the current story play out before advancing
        await randomDelay(5, 8);

        // 1) Manual "next story" button if present
        const nextBtn = document.querySelector(
          '[aria-label="Cerita Berikutnya"][role="button"], ' +
          '[aria-label="Next story"][role="button"], ' +
          '[aria-label="Selanjutnya"][role="button"]'
        );
        if (nextBtn && fbIsVisible(nextBtn)) {
          fbClick(nextBtn);
          continue;
        }

        // 2) Otherwise click the next un-viewed story card in the tray
        const cards = visibleCards().filter(c => !processedIds.has(c.getAttribute('id')));
        const next = cards[0];
        if (next) {
          processedIds.add(next.getAttribute('id'));
          fbClick(next);
        } else {
          console.log('[FacebookInteraction] Semua cerita sudah dilihat, menghentikan.');
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
