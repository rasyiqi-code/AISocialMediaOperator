/**
 * DOM Structure Inspector (Debug Tool)
 * Dumps the real, live DOM of the current social media page to the console
 * (and clipboard) so selectors in the adapters can be verified & fixed
 * against the actual authenticated layout — no manual DevTools copy needed.
 *
 * Trigger: Ctrl+Shift+Alt+D (or Cmd+Shift+Alt+D on macOS)
 * or chrome message action 'DEBUG_DUMP_DOM'.
 */

const KEYWORD_RE = /(like|unlike|suka|reply|balas|repost|kutip|rethread|follow|ikuti|post|posting|kirim|share|bagikan|new thread|utas baru)/i;

const FACEBOOK_KEYWORD_RE = /(like|unlike|suka|reply|balas|repost|kutip|follow|ikuti|post|posting|kirim|share|bagikan|jadwalkan|schedule|publish|terbitkan)/i;

function describeEl(el, maxText = 120) {
  if (!el) return null;
  const attrs = {};
  for (const attr of el.attributes) {
    const name = attr.name;
    if (
      name === 'id' ||
      name === 'role' ||
      name === 'dir' ||
      name === 'contenteditable' ||
      name === 'aria-pressed' ||
      name.startsWith('aria-') ||
      name.startsWith('data-') ||
      name === 'title'
    ) {
      attrs[name] = attr.value;
    } else if (name === 'class' && attr.value.length < 120) {
      attrs.class = attr.value;
    }
  }
  const text = (el.textContent || '').trim();
  return {
    tag: el.tagName.toLowerCase(),
    attrs,
    text: text.slice(0, maxText),
    textLen: text.length
  };
}

function collect(selector, limit = 30) {
  const els = Array.from(document.querySelectorAll(selector));
  return els.slice(0, limit).map(describeEl);
}

function uniqueTestIds(limit = 80) {
  const counts = {};
  document.querySelectorAll('[data-testid]').forEach(el => {
    const id = el.getAttribute('data-testid');
    counts[id] = (counts[id] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ testid: id, count }));
}

function ancestorChain(el, depth = 3) {
  const chain = [];
  let cur = el && el.parentElement;
  while (cur && chain.length < depth) {
    chain.push(describeEl(cur, 60));
    cur = cur.parentElement;
  }
  return chain;
}

function collectInputHtml(selector, limit = 6) {
  return Array.from(document.querySelectorAll(selector)).slice(0, limit).map(el => {
    const html = el.innerHTML || '';
    return {
      aria: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('aria-placeholder') || '',
      htmlLen: html.length,
      divBlocks: (html.match(/<div\b/gi) || []).length,
      pBlocks: (html.match(/<p\b/gi) || []).length,
      brCount: (html.match(/<br\b/gi) || []).length,
      html: html.slice(0, 500)
    };
  });
}

function collectTopicFields() {
  const els = Array.from(document.querySelectorAll(
    'input, textarea, [contenteditable="true"], [role="combobox"], [role="textbox"]'
  )).filter(el => {
    const meta = (
      (el.getAttribute && (el.getAttribute('placeholder') || '')) + ' ' +
      (el.getAttribute && (el.getAttribute('aria-label') || '')) + ' ' +
      (el.getAttribute && (el.getAttribute('aria-placeholder') || '')) + ' ' +
      ((el.textContent || '').slice(0, 60))
    ).toLowerCase();
    return /topik|komunitas|topic|community/.test(meta);
  });
  return els.slice(0, 10).map(el => describeEl(el, 80));
}

const SCHEDULE_RE = /(schedule|scheduled|jadwal|jadwalkan|calendar|kalender|tanggal|date|time|clock|jam|pukul|posting hari ini|post today)/i;

function collectScheduleControls(limit = 40) {
  const els = Array.from(document.querySelectorAll(
    'div[role="button"], button, input, [contenteditable="true"], [aria-label], [role="combobox"]'
  )).filter(el => {
    const meta = (
      (el.getAttribute && (el.getAttribute('aria-label') || '')) + ' ' +
      (el.getAttribute && (el.getAttribute('placeholder') || '')) + ' ' +
      (el.textContent || '').slice(0, 80)
    ).toLowerCase();
    return SCHEDULE_RE.test(meta);
  });
  return els.slice(0, limit).map(el => describeEl(el, 80));
}

function collectOpenDialogs(limit = 3) {
  return Array.from(document.querySelectorAll('[role="dialog"], [role="menu"]'))
    .filter(d => {
      // NOTE: do NOT check offsetParent here — Facebook dialogs are position:fixed
      // which always yields offsetParent === null even when fully visible.
      if (!d.isConnected) return false;
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .slice(0, limit)
    .map(d => ({
      ariaLabel: d.getAttribute('aria-label') || '',
      text: (d.textContent || '').slice(0, 300),
      buttons: Array.from(d.querySelectorAll('div[role="button"], button, input, [contenteditable="true"]'))
        .slice(0, 30)
        .map(el => describeEl(el, 60))
    }));
}

function collectFacebookComposer() {
  const selectors = [
    'div[contenteditable="true"][aria-label*="What\'s on your mind"]',
    'div[contenteditable="true"][aria-label*="Apa yang Anda pikirkan"]',
    'div[contenteditable="true"][aria-label*="Create a post"]',
    'div[contenteditable="true"][data-testid="post-composer-input"]',
    'div[contenteditable="true"][aria-label*="Tulis sesuatu"]',
    'div[role="dialog"] div[contenteditable="true"]',
    'div[data-testid="composer"] div[contenteditable="true"]'
  ];
  return collect(selectors.join(', '), 10);
}

function collectFacebookScheduleControls() {
  const els = Array.from(document.querySelectorAll(
    'div[role="button"], button, input, [contenteditable="true"], [aria-label], [role="combobox"], [data-testid]'
  )).filter(el => {
    const meta = (
      (el.getAttribute && (el.getAttribute('aria-label') || '')) + ' ' +
      (el.getAttribute && (el.getAttribute('placeholder') || '')) + ' ' +
      (el.getAttribute && (el.getAttribute('data-testid') || '')) + ' ' +
      (el.textContent || '').slice(0, 80)
    ).toLowerCase();
    return /schedule|jadwal|calendar|kalender|tanggal|date|time|clock|jam|pukul|posting hari ini|post today|publish|terbitkan/.test(meta);
  });
  return els.slice(0, 40).map(el => describeEl(el, 80));
}

function collectFacebookPostContainers() {
  return collect(
    'article, [role="article"], [data-testid*="post" i], [data-testid*="tweet" i], [data-testid*="feed" i], [data-testid*="Feed"], [data-testid*="timeline"], div[data-testid="ufi"]',
    5
  );
}

function collectFacebookActionButtons() {
  const els = Array.from(document.querySelectorAll(
    'button, [role="button"], a[href*="/post"], a[href*="/composer"]'
  )).filter(el => {
    const meta = (
      (el.getAttribute && (el.getAttribute('aria-label') || '')) + ' ' +
      (el.getAttribute && (el.getAttribute('data-testid') || '')) + ' ' +
      (el.textContent || '').slice(0, 80)
    ).toLowerCase();
    return FACEBOOK_KEYWORD_RE.test(meta);
  });
  return els.slice(0, 40).map(el => describeEl(el, 60));
}

export function dumpDomStructure(platform = 'unknown') {
  // Always derive the platform from the live URL so the dump label stays
  // accurate even when the caller passes a stale/incorrect value (e.g. the
  // sidepanel's last-selected platform).
  const host = window.location.hostname;
  let detected = '';
  if (host.includes('facebook.com') || host.includes('fbcdn.net')) detected = 'facebook';
  else if (host.includes('x.com') || host.includes('twitter.com')) detected = 'x';
  else if (host.includes('threads.net') || host.includes('threads.com')) detected = 'threads';
  const effectivePlatform = detected || platform || 'unknown';
  const isFacebook = effectivePlatform === 'facebook' || host.includes('facebook.com') || host.includes('fbcdn.net');

  const report = {
    platform: effectivePlatform,
    url: window.location.href,
    timestamp: new Date().toISOString(),
    composerInputs: collect(
      '[contenteditable="true"], [contenteditable], [role="textbox"], textarea, [data-testid*="composer" i], [data-testid*="Composer"]',
      10
    ),
    composerFirstAncestors: ancestorChain(document.querySelector('[contenteditable="true"], [role="textbox"], textarea')),
    composerInputHtml: collectInputHtml('div[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"]'),
    topicFieldCandidates: collectTopicFields(),
    scheduleControls: collectScheduleControls(),
    openDialogs: collectOpenDialogs(),
    composerAreaButtons: (() => {
      const input = document.querySelector('div[contenteditable="true"][role="textbox"]');
      if (!input) return [];
      const scope =
        input.closest('div[role="dialog"]') ||
        input.closest('div[class*="x78zum5"]') ||
        document;
      return Array.from(scope.querySelectorAll('div[role="button"], button'))
        .slice(0, 40)
        .map((el) => describeEl(el, 60));
    })(),
    actionButtons: collect('button, [role="button"], span[role="button"], [aria-label]', 40).filter(
      (d) =>
        d &&
        (KEYWORD_RE.test(d.text) ||
          Object.values(d.attrs).some((v) => typeof v === 'string' && KEYWORD_RE.test(v)))
    ),
    postContainers: collect(
      'article, [role="article"], [data-pressable-container], [data-testid*="post" i], [data-testid*="tweet" i], [data-testid*="feed" i], [data-testid*="Feed"]',
      5
    ),
    dataTestIdInventory: uniqueTestIds(),
    ...(isFacebook ? {
      facebookComposer: collectFacebookComposer(),
      facebookScheduleControls: collectFacebookScheduleControls(),
      facebookPostContainers: collectFacebookPostContainers(),
      facebookActionButtons: collectFacebookActionButtons()
    } : {})
  };

  const json = JSON.stringify(report, null, 2);
  console.log('[AI Operator] === DOM STRUCTURE DUMP ===');
  console.log(json);
  console.log('[AI Operator] =========================');

  try {
    navigator.clipboard.writeText(json).then(() => {
      console.log('[AI Operator] DOM dump disalin ke clipboard. Tempel di chat untuk verifikasi selector.');
    }).catch(() => {});
  } catch (e) {}

  return report;
}
