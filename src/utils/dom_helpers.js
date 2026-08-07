/**
 * DOM Helper Utilities with Humanized Typist & Event Dispatcher
 * Works across React, DraftJS, Lexical, and Slate editors used by X, Facebook, and Threads.
 */

/**
 * Wait for element to appear in DOM with timeout
 */
export const waitForElement = (selectors, timeout = 10000, parent = document) => {
  return new Promise((resolve, reject) => {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    
    // Check if already present
    for (const selector of selectorList) {
      const el = parent.querySelector(selector);
      if (el) return resolve({ element: el, matchedSelector: selector });
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      for (const selector of selectorList) {
        const el = parent.querySelector(selector);
        if (el) {
          clearInterval(interval);
          return resolve({ element: el, matchedSelector: selector });
        }
      }

      if (Date.now() - startTime >= timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for elements: ${selectorList.join(', ')}`));
      }
    }, 250);
  });
};

/**
 * Dispatch necessary events for React / Draft.js / Lexical rich text inputs
 */
export const triggerEvents = (element) => {
  if (!element) return;
  element.focus();

  const events = ['focus', 'keydown', 'keypress', 'textInput', 'input', 'keyup', 'change', 'blur'];
  events.forEach(eventType => {
    try {
      let event;
      if (eventType === 'textInput') {
        event = new TextEvent('textInput', { bubbles: true, cancelable: true });
      } else {
        event = new Event(eventType, { bubbles: true, cancelable: true });
      }
      element.dispatchEvent(event);
    } catch (e) {
      // Fallback
      const event = document.createEvent('HTMLEvents');
      event.initEvent(eventType, true, true);
      element.dispatchEvent(event);
    }
  });
};

/**
 * Set value on input or contenteditable element safely
 */
export const setNativeInputValue = (element, text) => {
  if (!element) return;
  element.focus();

  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototypeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    const setter = valueSetter || prototypeSetter;

    if (setter) {
      setter.call(element, text);
    } else {
      element.value = text;
    }
  } else if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
    // For Lexical/DraftJS/Slate contenteditable
    element.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    element.appendChild(p);

    // Alternative fallback if innerHTML replace clears framework internal state
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, text);
  }
  
  triggerEvents(element);
};

/**
 * Simulate a paste so contenteditable editors (Lexical/DraftJS) preserve
 * paragraph breaks. Returns true only if content landed AND the paragraph
 * block structure survived (blank lines present), so callers can fall back
 * when the editor flattens everything into soft breaks.
 */
const pasteAndVerify = async (element, text) => {
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split('\n')
      .map(line => `<div>${line}</div>`)
      .join('');
    dt.setData('text/html', html);

    const evt = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clipboardData', { get: () => dt });
    element.dispatchEvent(evt);

    // Give the editor a beat to commit the paste asynchronously
    await new Promise(r => setTimeout(r, 60));

    const hasContent = (element.textContent || '').trim().length > 0;
    const expectedLines = text.split('\n').length;
    const blockCount = (element.innerHTML.match(/<(div|p)\b/gi) || []).length;
    return hasContent && blockCount >= expectedLines;
  } catch (e) {
    return false;
  }
};

/**
 * Lexical-friendly insertion via synthetic `beforeinput` events.
 * Lexical (Threads) handles inputType 'insertText' and 'insertParagraph'
 * directly, so real paragraph breaks ("alinea") are created instead of the
 * soft `<br>` line breaks that execCommand('insertText') produces.
 */
const insertViaBeforeInput = (element, text) => {
  element.focus();
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {}

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line) {
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: line
      }));
    }
    if (i < lines.length - 1) {
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertParagraph'
      }));
    }
  });
};

/**
 * Paragraph-aware last-resort fallback: insert each line with
 * execCommand('insertText'), then execCommand('insertParagraph') between lines.
 */
const insertWithParagraphs = (element, text) => {
  element.focus();
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {}

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line) {
      document.execCommand('insertText', false, line);
    }
    if (i < lines.length - 1) {
      document.execCommand('insertParagraph', false, null);
    }
  });
};

/**
 * Single, clean, reliable typing simulator without double paste/execCommand duplication
 */
export const simulateHumanTyping = async (element, text, speedMode = 'medium') => {
  if (!element) return;
  element.focus();

  // Clear existing content inside input element cleanly
  try {
    if (element.isConnected) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    } else {
      element.innerHTML = '';
    }
  } catch (e) {}

  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    setNativeInputValue(element, text);
    return;
  }

  // 1) Lexical-friendly beforeinput (insertText + insertParagraph) — this is
  //    what Threads actually honors, creating REAL paragraph breaks for blank
  //    lines instead of the soft `<br>` breaks execCommand produces.
  insertViaBeforeInput(element, text);
  await new Promise(r => setTimeout(r, 60));
  if ((element.textContent || '').trim()) { triggerEvents(element); return; }

  // 2) Paste simulation — paragraph preservation for editors that accept it.
  const pasted = await pasteAndVerify(element, text);
  if (pasted) { triggerEvents(element); return; }

  // 3) Last resort: legacy execCommand path.
  insertWithParagraphs(element, text);
  triggerEvents(element);
};

/**
 * Random delay helper
 */
export const randomDelay = (minSeconds = 3, maxSeconds = 10) => {
  const ms = Math.floor((Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000);
  return new Promise(resolve => setTimeout(resolve, ms));
};
