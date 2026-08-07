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
 * Detect a Draft.js editor (X / Twitter). Draft.js only advances its
 * EditorState for events it explicitly handles; raw DOM mutations or bare
 * `beforeinput`/`keydown` events leave the state empty even though text may
 * appear in the DOM. It must be driven via paste or native input.
 */
function isDraftJsEditor(element) {
  try {
    if (!element) return false;
    return !!(
      element.closest('.DraftEditor-root') ||
      element.closest('.DraftEditor-editorContainer') ||
      element.querySelector('.DraftEditor-root') ||
      element.querySelector('.DraftEditor-editorContainer') ||
      (element.getAttribute('data-testid') || '').includes('tweetTextarea') ||
      element.closest('[data-testid*="tweetTextarea"]')
    );
  } catch (e) {
    return false;
  }
}

/**
 * Place the caret at the end of a contenteditable editor. For Draft.js editors
 * (X reply composer) the caret MUST be placed inside a Draft block
 * (`[data-block="true"]`), not on the outer editor node: Draft.js only picks up
 * native edits` (such as `execCommand('insertText')`) when the selection lives
 * inside one of its blocks. A caret on the outer node writes flat text outside
 * the blocks, which never reaches EditorState and so the Reply button stays
 * disabled. Fall back to a direct node scan if the attribute selector differs.
 */
function placeCaretAtEnd(element) {
  try {
    if (!element || !element.isConnected) return;
    element.focus();

    // Pick a target that is guaranteed connected. Start with the editor node
    // itself; if it exposes a Draft block tree, descend into the last block so
    // native edits land inside a block (and avoid "range isn't in document"
    // errors by skipping any node that is detached).
    let target = element;
    if (element.closest && element.closest('.DraftEditor-root') && element.querySelector('[data-contents="true"]')) {
      const container = element.querySelector('[data-contents="true"]');
      const blocks = Array.from(container.querySelectorAll('[data-block="true"]'));
      if (blocks.length) {
        target = blocks[blocks.length - 1];
        if (!target.isConnected) target = element;
      }
    }

    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {}
}

/**
 * Draft.js-safe insertion via paste simulation. Draft.js handles `paste` by
 * reading clipboardData and committing the text into its EditorState — the only
 * synthetic path that reliably enables the Reply button (unlike execCommand or
 * DOM writes, which leave EditorState empty so the placeholder never clears).
 */
const insertDraftJsPaste = (element, text) => {
  placeCaretAtEnd(element);
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
  } catch (e) {}
};

/**
 * Detect whether text landed inside Draft.js's block structure (data-editor
 * blocks with <span data-offset-key>), which means EditorState was updated and
 * the Reply button will enable. Flat text (no data-blocks) means Draft state is
 * still empty and the placeholder/disabled button persist.
 */
function hasDraftBlocks(element) {
  try {
    const hasText = (element.textContent || '').trim().length > 0;
    const hasBlocks = !!element.querySelector('div[data-block="true"] [data-offset-key], [data-editor] .public-DraftStyleDefault-block');
    if (hasText && !hasBlocks) return false;
    return hasText;
  } catch (e) {
    return false;
  }
}

/**
 * Safely dispatch a synthetic beforeinput event for Draft.js with mock dataTransfer.types
 * and getTargetRanges to prevent uncaught TypeErrors in X's Draft.js bundle.
 */
function dispatchDraftBeforeInput(element, inputType, data = null) {
  try {
    const dt = new DataTransfer();
    if (data) dt.setData('text/plain', data);

    const ev = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType,
      data
    });
    Object.defineProperty(ev, 'dataTransfer', { get: () => dt, configurable: true });
    Object.defineProperty(ev, 'getTargetRanges', { get: () => () => [], configurable: true });
    element.dispatchEvent(ev);
  } catch (e) {
    try {
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType, data
      }));
    } catch (err) {}
  }
}

/**
 * Draft.js-safe insertion for X's reply composer.
 *
 * The decisive detail is CARET PLACEMENT + native insertion: Draft.js only
 * commits edits when the selection sits INSIDE one of its `[data-block]` elements.
 * Preserving the `[data-block]` DOM tree (by using selectAll+delete instead of
 * innerHTML='') and placing caret inside the block allows native `execCommand('insertText')`
 * to update Draft.js EditorState and enable the Reply button (aria-disabled="false").
 */
async function insertDraftJsText(element, text) {
  placeCaretAtEnd(element);

  // Clear existing text via selectAll+delete to preserve Draft.js block tree
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  } catch (e) {}

  placeCaretAtEnd(element);

  // Primary: Native execCommand('insertText') inside the block
  try {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (line) document.execCommand('insertText', false, line);
      if (i < lines.length - 1) {
        document.execCommand('insertParagraph', false, null);
      }
    });
    await new Promise(r => setTimeout(r, 150));
  } catch (e) {}

  if (hasDraftBlocks(element)) return true;

  // Fallback 1: dispatchDraftBeforeInput with mock dataTransfer
  try {
    dispatchDraftBeforeInput(element, 'insertText', text);
    await new Promise(r => setTimeout(r, 150));
  } catch (e) {}

  if (hasDraftBlocks(element)) return true;

  // Fallback 2: paste simulation
  insertDraftJsPaste(element, text);
  await new Promise(r => setTimeout(r, 150));

  return (element.textContent || '').trim().length > 0;
}

/**
 * Single, clean, reliable typing simulator without double paste/execCommand duplication
 */
export const simulateHumanTyping = async (element, text, speedMode = 'medium') => {
  if (!element) return;

  // Resolve to actual contenteditable element if wrapper passed
  let targetNode = element;
  if (element.getAttribute('contenteditable') !== 'true' && element.querySelector('div[contenteditable="true"]')) {
    targetNode = element.querySelector('div[contenteditable="true"]');
  }

  targetNode.focus();

  if (targetNode.tagName === 'INPUT' || targetNode.tagName === 'TEXTAREA') {
    setNativeInputValue(targetNode, text);
    return;
  }

  // Draft.js (X / Twitter) editors must preserve data-block structure
  if (isDraftJsEditor(targetNode)) {
    await insertDraftJsText(targetNode, text);
    return;
  }

  // Clear existing content inside standard input elements cleanly
  try {
    if (targetNode.isConnected) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(targetNode);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    } else {
      targetNode.innerHTML = '';
    }
  } catch (e) {}

  // 1) Lexical-friendly beforeinput (insertText + insertParagraph)
  insertViaBeforeInput(targetNode, text);
  await new Promise(r => setTimeout(r, 60));
  if ((targetNode.textContent || '').trim()) { triggerEvents(targetNode); return; }

  // 2) Paste simulation
  const pasted = await pasteAndVerify(targetNode, text);
  if (pasted) { triggerEvents(targetNode); return; }

  // 3) Last resort: legacy execCommand path.
  insertWithParagraphs(targetNode, text);
  triggerEvents(targetNode);
};

/**
 * Random delay helper
 */
export const randomDelay = (minSeconds = 3, maxSeconds = 10) => {
  const ms = Math.floor((Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000);
  return new Promise(resolve => setTimeout(resolve, ms));
};
