(() => {
  // src/utils/dom_helpers.js
  var waitForElement = (selectors, timeout = 1e4, parent = document) => {
    return new Promise((resolve, reject) => {
      const selectorList = Array.isArray(selectors) ? selectors : [selectors];
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
          reject(new Error(`Timeout waiting for elements: ${selectorList.join(", ")}`));
        }
      }, 250);
    });
  };
  var triggerEvents = (element) => {
    if (!element) return;
    element.focus();
    const events = ["focus", "keydown", "keypress", "textInput", "input", "keyup", "change", "blur"];
    events.forEach((eventType) => {
      try {
        let event;
        if (eventType === "textInput") {
          event = new TextEvent("textInput", { bubbles: true, cancelable: true });
        } else {
          event = new Event(eventType, { bubbles: true, cancelable: true });
        }
        element.dispatchEvent(event);
      } catch (e) {
        const event = document.createEvent("HTMLEvents");
        event.initEvent(eventType, true, true);
        element.dispatchEvent(event);
      }
    });
  };
  var setNativeInputValue = (element, text) => {
    if (!element) return;
    element.focus();
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
      const prototypeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
      const setter = valueSetter || prototypeSetter;
      if (setter) {
        setter.call(element, text);
      } else {
        element.value = text;
      }
    } else if (element.isContentEditable || element.getAttribute("contenteditable") === "true") {
      element.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = text;
      element.appendChild(p);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, text);
    }
    triggerEvents(element);
  };
  var pasteAndVerify = async (element, text) => {
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").split("\n").map((line) => `<div>${line}</div>`).join("");
      dt.setData("text/html", html);
      const evt = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(evt, "clipboardData", { get: () => dt });
      element.dispatchEvent(evt);
      await new Promise((r) => setTimeout(r, 60));
      const hasContent = (element.textContent || "").trim().length > 0;
      const expectedLines = text.split("\n").length;
      const blockCount = (element.innerHTML.match(/<(div|p)\b/gi) || []).length;
      return hasContent && blockCount >= expectedLines;
    } catch (e) {
      return false;
    }
  };
  var insertViaBeforeInput = (element, text) => {
    element.focus();
    placeCaretAtEnd(element);
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (line) {
        element.dispatchEvent(new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: line
        }));
      }
      if (i < lines.length - 1) {
        element.dispatchEvent(new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertParagraph"
        }));
      }
    });
  };
  var insertWithParagraphs = (element, text) => {
    element.focus();
    placeCaretAtEnd(element);
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (line) {
        document.execCommand("insertText", false, line);
      }
      if (i < lines.length - 1) {
        document.execCommand("insertParagraph", false, null);
      }
    });
  };
  function isDraftJsEditor(element) {
    try {
      if (!element) return false;
      return !!(element.closest(".DraftEditor-root") || element.closest(".DraftEditor-editorContainer") || element.querySelector(".DraftEditor-root") || element.querySelector(".DraftEditor-editorContainer") || (element.getAttribute("data-testid") || "").includes("tweetTextarea") || element.closest('[data-testid*="tweetTextarea"]'));
    } catch (e) {
      return false;
    }
  }
  function placeCaretAtEnd(element) {
    try {
      if (!element || !element.isConnected) return;
      element.focus();
      let target = element;
      const root = element.closest ? element.closest(".DraftEditor-root") || element.closest(".DraftEditor-editorContainer") : null;
      const scope = root || element;
      if (scope.querySelector && scope.querySelector('[data-contents="true"]')) {
        const offsetSpans = Array.from(scope.querySelectorAll("[data-offset-key]"));
        if (offsetSpans.length) {
          target = offsetSpans[offsetSpans.length - 1];
          const textSpan = target.querySelector('[data-text="true"]');
          if (textSpan && textSpan.isConnected) target = textSpan;
        } else {
          const blocks = Array.from(scope.querySelectorAll('[data-block="true"]'));
          if (blocks.length) target = blocks[blocks.length - 1];
        }
      }
      if (!target || !target.isConnected) target = element;
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
    }
  }
  function hideDraftJsPlaceholder(element) {
    try {
      const root = element.closest ? element.closest(".DraftEditor-root") || element.closest('[data-testid*="RichTextInputContainer"]') || element.parentElement : element.parentElement;
      if (root) {
        const placeholders = root.querySelectorAll('.DraftEditor-placeholder-root, [id^="placeholder-"], div[class*="placeholder"]');
        placeholders.forEach((p) => {
          p.style.display = "none";
          p.style.visibility = "hidden";
          p.style.opacity = "0";
        });
      }
    } catch (e) {
    }
  }
  var insertDraftJsPaste = (element, text) => {
    placeCaretAtEnd(element);
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      let evt;
      try {
        evt = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
      } catch (err) {
        evt = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(evt, "clipboardData", { get: () => dt, configurable: true });
      }
      element.dispatchEvent(evt);
    } catch (e) {
    }
  };
  function hasDraftBlocks(element) {
    try {
      const hasText = (element.textContent || "").trim().length > 0;
      const hasBlocks = !!element.querySelector('div[data-block="true"] [data-offset-key], [data-editor] .public-DraftStyleDefault-block');
      if (hasText && !hasBlocks) return false;
      return hasText;
    } catch (e) {
      return false;
    }
  }
  function dispatchDraftBeforeInput(element, inputType, data = null) {
    try {
      const dt = new DataTransfer();
      if (data) dt.setData("text/plain", data);
      const ev = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType,
        data
      });
      Object.defineProperty(ev, "dataTransfer", { get: () => dt, configurable: true });
      Object.defineProperty(ev, "getTargetRanges", { get: () => () => [], configurable: true });
      element.dispatchEvent(ev);
    } catch (e) {
      try {
        element.dispatchEvent(new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType,
          data
        }));
      } catch (err) {
      }
    }
  }
  async function insertDraftJsText(element, text) {
    placeCaretAtEnd(element);
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch (e) {
    }
    placeCaretAtEnd(element);
    try {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (line) document.execCommand("insertText", false, line);
        if (i < lines.length - 1) {
          document.execCommand("insertParagraph", false, null);
        }
      });
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
    }
    try {
      document.execCommand("insertText", false, " ");
      document.execCommand("delete", false, null);
      element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
    } catch (e) {
    }
    hideDraftJsPlaceholder(element);
    if (hasDraftBlocks(element)) return true;
    try {
      dispatchDraftBeforeInput(element, "insertText", text);
      await new Promise((r) => setTimeout(r, 100));
      document.execCommand("insertText", false, " ");
      document.execCommand("delete", false, null);
      element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      hideDraftJsPlaceholder(element);
    } catch (e) {
    }
    if (hasDraftBlocks(element)) return true;
    insertDraftJsPaste(element, text);
    await new Promise((r) => setTimeout(r, 100));
    hideDraftJsPlaceholder(element);
    return (element.textContent || "").trim().length > 0;
  }
  var simulateHumanTyping = async (element, text, speedMode = "medium") => {
    if (!element) return;
    let targetNode = element;
    if (element.getAttribute("contenteditable") !== "true" && element.querySelector('div[contenteditable="true"]')) {
      targetNode = element.querySelector('div[contenteditable="true"]');
    }
    targetNode.focus();
    if (targetNode.tagName === "INPUT" || targetNode.tagName === "TEXTAREA") {
      setNativeInputValue(targetNode, text);
      return;
    }
    if (isDraftJsEditor(targetNode)) {
      await insertDraftJsText(targetNode, text);
      return;
    }
    try {
      if (targetNode.isConnected) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(targetNode);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("delete", false, null);
      } else {
        targetNode.innerHTML = "";
      }
    } catch (e) {
    }
    insertViaBeforeInput(targetNode, text);
    await new Promise((r) => setTimeout(r, 60));
    if ((targetNode.textContent || "").trim()) {
      triggerEvents(targetNode);
      return;
    }
    const pasted = await pasteAndVerify(targetNode, text);
    if (pasted) {
      triggerEvents(targetNode);
      return;
    }
    insertWithParagraphs(targetNode, text);
    triggerEvents(targetNode);
  };
  var randomDelay = (minSeconds = 3, maxSeconds = 10) => {
    const ms = Math.floor((Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1e3);
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  // src/utils/text_utils.js
  function splitIntoThreadParts(text, maxChars = 450) {
    if (!text || text.length <= maxChars) return [cleanNumberedLine(text)];
    const lines = text.split(/\r?\n/).map((l) => cleanNumberedLine(l.trim())).filter(Boolean);
    const parts = [];
    let current = "";
    const appendToCurrent = (chunk) => {
      if (current) {
        if ((current + "\n\n" + chunk).trim().length <= maxChars) {
          current = current + "\n\n" + chunk;
        } else {
          if (current.trim()) parts.push(current.trim());
          current = chunk;
        }
      } else {
        current = chunk;
      }
    };
    const pushLine = (line) => {
      if (line.length <= maxChars) {
        appendToCurrent(line);
        return;
      }
      const words = line.split(/\s+/);
      let buf = "";
      for (const w of words) {
        if ((buf + " " + w).trim().length > maxChars) {
          if (buf.trim()) appendToCurrent(buf.trim());
          buf = w;
        } else {
          buf = buf ? buf + " " + w : w;
        }
      }
      if (buf.trim()) appendToCurrent(buf.trim());
    };
    for (const line of lines) pushLine(line);
    if (current.trim()) parts.push(current.trim());
    return parts.length > 0 ? parts : [cleanNumberedLine(text)];
  }
  function cleanNumberedLine(line) {
    return (line || "").replace(/^\d+[\.\)\/]\s+/, "").trim();
  }

  // src/content/adapters/general_helpers.js
  var GeneralHelpers = {
    MONTHS_ID: ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"],
    /**
     * Click an element using React-safe mouse events.
     */
    clickElement(el) {
      if (!el) return false;
      try {
        el.scrollIntoView?.({ block: "center" });
      } catch (e) {
      }
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      return true;
    },
    /**
     * First element whose trimmed text matches a regex.
     */
    findByText(root, regex, limit = 60) {
      const els = Array.from(root.querySelectorAll('div[role="button"], button, [role="menuitem"], [role="option"]'));
      for (const el of els) {
        const t = (el.textContent || "").trim();
        if (t && t.length <= limit && regex.test(t)) return el;
      }
      return null;
    },
    /**
     * First currently-visible dialog/menu matching a predicate.
     */
    findVisibleDialog(predicate) {
      return Array.from(document.querySelectorAll('[role="dialog"], [role="menu"]')).filter((d) => {
        if (!d.isConnected) return false;
        const r = d.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).find(predicate) || null;
    },
    /**
     * Default calendar-dialog detector: a visible dialog containing the weekday
     * column headers (Min..Sab) and a 4-digit year.
     */
    isCalendarDialog(d) {
      const txt = d.textContent || "";
      return txt.includes("Min") && txt.includes("Sab") && /202\d/.test(txt);
    },
    /**
     * Open a platform's native schedule dialog.
     * config: { composerRoot, chipRegex, moreRegex, itemRegex, dialogCheck, tag }
     */
    async openScheduleDialog(config = {}) {
      const {
        composerRoot,
        chipRegex,
        moreRegex,
        itemRegex,
        dialogCheck = this.isCalendarDialog,
        tag = "Helper"
      } = config;
      const scope = composerRoot || document;
      if (chipRegex) {
        const chip = this.findByText(scope, chipRegex, 50);
        if (chip) {
          this.clickElement(chip);
          await randomDelay(1, 1.4);
          return this.findScheduleDialog(dialogCheck);
        }
      }
      if (moreRegex) {
        const more = this.findByText(scope, moreRegex, 20);
        if (more) this.clickElement(more);
        await randomDelay(0.5, 0.9);
      }
      if (itemRegex) {
        const item = this.findByText(document, itemRegex, 30);
        if (item) this.clickElement(item);
        await randomDelay(1, 1.4);
      }
      return this.findScheduleDialog(dialogCheck);
    },
    findScheduleDialog(dialogCheck = this.isCalendarDialog) {
      return this.findVisibleDialog(dialogCheck) || null;
    },
    /**
     * Open the schedule dialog, pick date & time, and confirm.
     * config: { composerRoot, chipRegex, moreRegex, itemRegex, dialogCheck,
     *          confirmRegexes, timeInputCheck, tag }
     */
    async schedulePost(config = {}, targetTime) {
      const {
        composerRoot,
        confirmRegexes = [/^jadwalkan$/i, /^kirim$/i, /^post$/i],
        timeInputCheck,
        tag = "Helper"
      } = config;
      const dialog = await this.openScheduleDialog(config);
      if (!dialog) {
        console.warn(`[${tag}] Dialog jadwal tidak ditemukan \u2014 cek tombol schedule / menu "Lainnya" \u2192 "Jadwalkan..."`);
        return false;
      }
      this.logScheduleDialog(dialog, tag);
      await this.navigateToMonth(dialog, targetTime);
      const dayOk = this.clickDayCell(dialog, targetTime);
      const timeOk = await this.setTime(dialog, targetTime, timeInputCheck);
      console.log(`[${tag}] Jadwal: tanggal`, dayOk ? "OK" : "GAGAL", "| waktu", timeOk ? "OK" : "GAGAL");
      const selesai = this.findByText(dialog, /^selesai$/i, 20);
      if (selesai) this.clickElement(selesai);
      await randomDelay(0.8, 1.2);
      const scope = composerRoot || document;
      const confirmBtn = confirmRegexes.reduce((acc, r) => acc || this.findByText(scope, r, 20), null);
      if (confirmBtn) this.clickElement(confirmBtn);
      await randomDelay(1, 1.5);
      console.log(`[${tag}] Konfirmasi jadwal:`, confirmBtn ? `klik "${confirmBtn.textContent.trim()}"` : "tombol konfirmasi tidak ditemukan");
      return !!confirmBtn;
    },
    /**
     * Click prev/next month buttons until the calendar shows targetTime's month.
     */
    async navigateToMonth(dialog, targetTime) {
      const targetLabel = `${this.MONTHS_ID[targetTime.getMonth()]} ${targetTime.getFullYear()}`;
      for (let i = 0; i < 24; i++) {
        if ((dialog.textContent || "").includes(targetLabel)) return true;
        const m = (dialog.textContent || "").match(/([A-Za-z]+)\s+(\d{4})/);
        if (!m) return false;
        const curIdx = this.MONTHS_ID.findIndex((name) => name.toLowerCase() === m[1].toLowerCase());
        const curYear = parseInt(m[2], 10);
        if (curIdx === -1 || isNaN(curYear)) return false;
        const curTotal = curYear * 12 + curIdx;
        const targetTotal = targetTime.getFullYear() * 12 + targetTime.getMonth();
        const btn = curTotal < targetTotal ? dialog.querySelector('button[aria-label="Bulan Berikutnya"], button[aria-label*="Bulan Berikutnya"]') : dialog.querySelector('button[aria-label="Bulan Sebelumnya"], button[aria-label*="Bulan Sebelumnya"]');
        if (!btn) return false;
        this.clickElement(btn);
        await randomDelay(0.4, 0.7);
      }
      return false;
    },
    /**
     * Click the calendar cell matching targetTime's day. Tries, in order: an
     * aria-label with the full date, a text cell in Indonesian date format
     * ("Kamis, 6 Agustus 20266"), then a bare day number inside the grid.
     */
    clickDayCell(dialog, targetTime) {
      const d = targetTime.getDate();
      const monthName = this.MONTHS_ID[targetTime.getMonth()];
      const yearStr = String(targetTime.getFullYear());
      const candidates = Array.from(dialog.querySelectorAll('[role="gridcell"], [role="button"], td, [aria-label]'));
      for (const c of candidates) {
        const aria = c.getAttribute("aria-label") || "";
        if (aria && aria.includes(` ${d} `) && aria.includes(monthName) && aria.includes(yearStr)) {
          this.clickElement(c);
          return true;
        }
      }
      const dayMatch = new RegExp("(\\d{1,2})\\s+" + monthName + "\\s+" + yearStr);
      for (const c of candidates) {
        const t = c.textContent || "";
        const m = t.match(dayMatch);
        if (m && parseInt(m[1], 10) === d) {
          this.clickElement(c);
          return true;
        }
      }
      const grid = dialog.querySelector('[role="grid"]');
      const scope = grid || dialog;
      for (const c of Array.from(scope.querySelectorAll('[role="gridcell"], td, div'))) {
        const t = (c.textContent || "").trim();
        if (/^\d+$/.test(t) && parseInt(t, 10) === d) {
          this.clickElement(c);
          return true;
        }
      }
      return false;
    },
    /**
     * Set the time in the schedule dialog. Handles native <input type="time">,
     * separate hh/mm text inputs (e.g. Threads with placeholders "hh"/"mm"),
     * and generic heuristics.
     */
    async setTime(dialog, targetTime, timeInputCheck) {
      const hh = String(targetTime.getHours()).padStart(2, "0");
      const mm = String(targetTime.getMinutes()).padStart(2, "0");
      let input = dialog.querySelector('input[type="time"]');
      if (input) {
        this.setNativeValue(input, `${hh}:${mm}`);
        await randomDelay(0.4, 0.8);
        return true;
      }
      const inputs = Array.from(dialog.querySelectorAll("input"));
      const hhInput = inputs.find((i) => /^hh$/i.test((i.placeholder || "").trim()));
      const mmInput = inputs.find((i) => /^mm$/i.test((i.placeholder || "").trim()));
      if (hhInput && mmInput) {
        this.setNativeValue(hhInput, hh);
        await randomDelay(0.2, 0.4);
        this.setNativeValue(mmInput, mm);
        await randomDelay(0.4, 0.8);
        return true;
      }
      input = inputs.find((i) => {
        if (timeInputCheck && timeInputCheck(i)) return true;
        const aria = (i.getAttribute("aria-label") || "").toLowerCase();
        return /waktu|jam|pukul|time/.test(aria) || /^\d{1,2}[:.]\d{2}/.test(i.value || "") || /jam/i.test(i.placeholder || "");
      }) || null;
      if (!input) return false;
      this.setNativeValue(input, `${hh}:${mm}`);
      await randomDelay(0.4, 0.8);
      return true;
    },
    setNativeValue(el, value) {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    /**
     * Compact dump of the schedule dialog for diagnosing selector failures.
     */
    logScheduleDialog(dialog, tag = "Helper") {
      try {
        const info = {
          monthHeader: (dialog.textContent || "").match(/([A-Za-z]+)\s+\d{4}/)?.[0] || "",
          inputs: Array.from(dialog.querySelectorAll("input")).map((i) => ({
            type: i.type,
            placeholder: i.placeholder,
            value: i.value,
            ariaLabel: i.getAttribute("aria-label") || ""
          })),
          buttons: Array.from(dialog.querySelectorAll('div[role="button"], button')).map((b) => ({ text: (b.textContent || "").trim().slice(0, 30), aria: b.getAttribute("aria-label") || "" })).filter((x) => x.text || x.aria).slice(0, 40),
          gridCells: (() => {
            const g = dialog.querySelector('[role="grid"]');
            if (!g) return [];
            return Array.from(g.querySelectorAll('[role="gridcell"], [role="button"], td')).slice(0, 15).map((c) => ({ aria: c.getAttribute("aria-label") || "", text: (c.textContent || "").trim() }));
          })()
        };
        console.log(`[${tag}] === DIALOG JADWAL ===`);
        console.log(JSON.stringify(info, null, 2));
        console.log(`[${tag}] ====================`);
      } catch (e) {
      }
    }
  };

  // src/content/adapters/threads_adapter.js
  var ThreadsAdapter = {
    name: "Threads",
    /**
     * Find composer textbox or open modal if closed
     */
    async getComposerInput() {
      let input = document.querySelector('div[contenteditable="true"][role="textbox"]') || document.querySelector('div[data-lexical-editor="true"]') || document.querySelector('div[contenteditable="true"]');
      if (input) {
        try {
          input.click();
          input.focus();
        } catch (e) {
        }
        return input;
      }
      const candidateBtns = [
        document.querySelector('a[href*="/create"]'),
        document.querySelector('[aria-label="New thread"]'),
        document.querySelector('[aria-label="Utas baru"]'),
        document.querySelector('[aria-label*="Create"]'),
        document.querySelector('[aria-label*="Kolom teks kosong"]'),
        document.querySelector('[aria-label*="menulis postingan baru"]'),
        document.querySelector('[aria-label*="Apa yang Anda pikirkan"]'),
        document.querySelector('[aria-label*="Apa yang baru"]'),
        ...Array.from(document.querySelectorAll('div[role="button"], a')).filter((el) => {
          const txt = (el.textContent || "").toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          return txt.includes("start a thread") || txt.includes("apa yang anda pikirkan") || txt.includes("apa yang baru") || aria.includes("kolom teks kosong") || aria.includes("menulis postingan baru");
        })
      ].filter(Boolean);
      for (const btn of candidateBtns) {
        try {
          if (btn && typeof btn.click === "function") {
            btn.click();
          } else if (btn) {
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }
          await randomDelay(1, 2);
          input = document.querySelector('div[contenteditable="true"][role="textbox"]') || document.querySelector('div[data-lexical-editor="true"]') || document.querySelector('div[contenteditable="true"]');
          if (input) return input;
        } catch (e) {
        }
      }
      const res = await waitForElement([
        'div[contenteditable="true"][role="textbox"]',
        'div[data-lexical-editor="true"]',
        'div[contenteditable="true"]'
      ], 3e3).catch(() => null);
      return res ? res.element : null;
    },
    /**
     * Split long text into thread parts under maxChars each. See utils/text_utils.js
     */
    splitIntoThreadParts(text, maxChars = 450) {
      return splitIntoThreadParts(text, maxChars);
    },
    /**
     * Post content to Threads (Supports Multi-Post Utas Threads & Paragraph Preservations)
     */
    async createPost(contentText, options = {}) {
      const mode = options.threadsMode || "thread";
      if (mode === "attachment") {
        return this.createAttachmentPost(contentText, options);
      }
      if (mode === "poll") {
        return this.createPollPost(contentText, options);
      }
      const isSingleMode = mode === "short" || mode === "single";
      const threadParts = isSingleMode ? [contentText] : this.splitIntoThreadParts(contentText, 450);
      const typingSpeed = options.humanTypingSpeed || "fast";
      let currentInput = await this.getComposerInput();
      if (!currentInput) throw new Error("Input Threads tidak ditemukan. Pastikan Anda berada di halaman threads.com");
      if (options.imagePrompt) {
        console.log("[Threads] Image prompt received:", options.imagePrompt);
        await this.uploadImageToComposer(currentInput, options.imagePrompt);
        await randomDelay(1, 2);
      }
      for (let i = 0; i < threadParts.length; i++) {
        const partText = threadParts[i];
        if (i > 0) {
          const addThreadBtn = this.findAddThreadButton(currentInput);
          if (addThreadBtn) {
            try {
              addThreadBtn.scrollIntoView?.({ block: "center" });
              ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
                addThreadBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
              });
            } catch (e) {
            }
            await randomDelay(1.5, 2.5);
            const newInput = this.findComposerInputBelow(currentInput);
            if (newInput) currentInput = newInput;
          }
        }
        await simulateHumanTyping(currentInput, partText, typingSpeed);
        await randomDelay(1, 2);
        if (i === 0 && options.threadsTopicLabel) {
          await this.fillThreadsTopic(currentInput, options.threadsTopicLabel);
        }
      }
      const composerRoot = currentInput.closest('div[role="dialog"]') || currentInput.closest('div[data-testid*="composer"]') || document;
      if (options.threadsScheduledTime) {
        const when = new Date(options.threadsScheduledTime);
        const ok = await GeneralHelpers.schedulePost({
          composerRoot,
          tag: "Threads",
          chipRegex: /posting hari ini pukul|post today at|jadwal/i,
          moreRegex: /^(lainnya|more|opsi postingan)$/i,
          itemRegex: /^jadwalkan/i,
          confirmRegexes: [/^jadwalkan$/i, /^kirim$/i, /^post$/i]
        }, when);
        return {
          success: true,
          message: ok ? `Post dijadwalkan ${when.toLocaleString("id-ID")} melalui jadwal Threads` : `Konten terisi. Jadwal native belum berhasil diset (target ${when.toLocaleString("id-ID")}) \u2014 lihat log [Threads].`
        };
      }
      const postBtn = Array.from(composerRoot.querySelectorAll('div[role="button"], button')).find((el) => {
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const txt = (el.textContent || "").trim().toLowerCase();
        return aria === "post" || aria === "posting" || aria === "kirim" || txt === "post" || txt === "posting";
      });
      if (postBtn) {
        postBtn.click();
        await randomDelay(2, 3);
        return {
          success: true,
          message: threadParts.length > 1 ? `Berhasil memposting ${threadParts.length} bagian Utas (Thread) ke Threads!` : "Berhasil memposting ke Threads!"
        };
      }
      return {
        success: true,
        message: threadParts.length > 1 ? `Berhasil mengisikan ${threadParts.length} bagian Utas (Thread) ke Threads!` : "Berhasil mengisikan postingan ke Threads!"
      };
    },
    /**
     * Post a long-form text attachment on Threads.
     * Single post: main input ("Edit utas..." / isi postingan) + text attachment card ("Tuliskan lebih banyak lagi...")
     */
    async createAttachmentPost(contentText, options = {}) {
      const typingSpeed = options.humanTypingSpeed || "fast";
      let mainInput = await this.getComposerInput();
      if (!mainInput) throw new Error("Input Threads tidak ditemukan. Pastikan Anda berada di halaman threads.com");
      const cleanLines = (contentText || "").split("\n").map((l) => l.trim()).filter(Boolean);
      let titleText = options.attachmentTitle || options.postTitle || (cleanLines[0] ? cleanLines[0].replace(/^[#*-\s]+/, "").trim() : "Utas Teks Lampiran");
      if (titleText.length > 120) {
        titleText = titleText.substring(0, 117) + "...";
      }
      try {
        mainInput.click();
        mainInput.focus();
      } catch (e) {
      }
      await simulateHumanTyping(mainInput, titleText, typingSpeed);
      await randomDelay(1, 2);
      let lampirkanBtn = GeneralHelpers.findByText(document, /^Lampirkan teks$/i, 20) || GeneralHelpers.findByText(mainInput.closest('div[role="dialog"]') || document, /^Lampirkan teks$/i, 20);
      if (!lampirkanBtn) throw new Error('Tombol "Lampirkan teks" tidak ditemukan');
      GeneralHelpers.clickElement(lampirkanBtn);
      await randomDelay(1, 2);
      const bodyResult = await waitForElement([
        'div[aria-placeholder="Tuliskan lebih banyak lagi..."][contenteditable="true"]',
        'div[data-lexical-editor="true"][aria-placeholder="Tuliskan lebih banyak lagi..."]'
      ], 5e3).catch(() => null);
      const bodyInput = bodyResult ? bodyResult.element : null;
      if (!bodyInput) throw new Error('Editor body "Tuliskan lebih banyak lagi..." tidak ditemukan');
      await simulateHumanTyping(bodyInput, contentText, typingSpeed);
      await randomDelay(1, 2);
      const selesaiBtn = GeneralHelpers.findByText(document, /^Selesai$/i, 20);
      if (selesaiBtn) {
        GeneralHelpers.clickElement(selesaiBtn);
        await randomDelay(1.5, 2.5);
      }
      mainInput = await this.getComposerInput();
      if (mainInput) {
        const currentMainText = (mainInput.textContent || mainInput.innerText || "").trim();
        if (!currentMainText) {
          await simulateHumanTyping(mainInput, titleText, typingSpeed);
          await randomDelay(1, 2);
        }
      }
      if (options.threadsTopicLabel && mainInput) {
        await this.fillThreadsTopic(mainInput, options.threadsTopicLabel);
      }
      const composerRoot = mainInput && mainInput.closest('div[role="dialog"]') || document;
      if (options.threadsScheduledTime) {
        const when = new Date(options.threadsScheduledTime);
        const ok = await GeneralHelpers.schedulePost({
          composerRoot,
          tag: "Threads",
          chipRegex: /posting hari ini pukul|post today at|jadwal/i,
          moreRegex: /^(lainnya|more|opsi postingan)$/i,
          itemRegex: /^jadwalkan/i,
          confirmRegexes: [/^jadwalkan$/i, /^kirim$/i, /^post$/i]
        }, when);
        return {
          success: true,
          message: ok ? `Text attachment post dijadwalkan ${when.toLocaleString("id-ID")} melalui jadwal Threads` : `Konten text attachment terisi. Jadwal native belum berhasil diset (target ${when.toLocaleString("id-ID")}) \u2014 lihat log [Threads].`
        };
      }
      const postBtn = Array.from(composerRoot.querySelectorAll('div[role="button"], button')).find((el) => {
        const txt = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const disabled = el.getAttribute("aria-disabled") === "true";
        return !disabled && (txt === "kirim" || txt === "post" || txt === "posting" || aria === "post" || aria === "posting" || aria === "kirim");
      });
      if (postBtn) {
        postBtn.click();
        await randomDelay(2, 3);
        return { success: true, message: "Berhasil memposting text attachment ke Threads!" };
      }
      return { success: true, message: "Konten text attachment & isi postingan terisi. Klik Kirim untuk memposting." };
    },
    /**
     * Post a poll on Threads.
     * Flow: click "Tambahkan polling" → type question → type options → set duration → post.
     */
    async createPollPost(contentText, options = {}) {
      const typingSpeed = options.humanTypingSpeed || "fast";
      let mainInput = await this.getComposerInput();
      if (!mainInput) throw new Error("Input Threads tidak ditemukan. Pastikan Anda berada di halaman threads.com");
      const tambahPollingBtn = GeneralHelpers.findByText(document, /^Tambahkan polling$/i, 20) || GeneralHelpers.findByText(mainInput.closest('div[role="dialog"]') || document, /^Tambahkan polling$/i, 20);
      if (!tambahPollingBtn) throw new Error('Tombol "Tambahkan polling" tidak ditemukan');
      GeneralHelpers.clickElement(tambahPollingBtn);
      await randomDelay(1, 2);
      const parts = contentText.split("\n").map((p) => p.trim()).filter(Boolean);
      const question = parts[0] || contentText;
      const pollOptions = parts.slice(1);
      await simulateHumanTyping(mainInput, question, typingSpeed);
      await randomDelay(1, 2);
      const pollInputs = Array.from(document.querySelectorAll('input[dir="ltr"]')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.offsetParent !== null && el !== mainInput;
      });
      for (let i = 0; i < Math.min(pollOptions.length, pollInputs.length); i++) {
        await simulateHumanTyping(pollInputs[i], pollOptions[i], typingSpeed);
        await randomDelay(0.5, 1);
      }
      const durasiBtn = GeneralHelpers.findByText(document, /^Berakhir dalam/i, 20) || GeneralHelpers.findByText(mainInput.closest('div[role="dialog"]') || document, /^Berakhir dalam/i, 20);
      if (durasiBtn) {
        GeneralHelpers.clickElement(durasiBtn);
        await randomDelay(0.5, 1);
        await randomDelay(1, 2);
      }
      if (options.threadsTopicLabel) {
        await this.fillThreadsTopic(mainInput, options.threadsTopicLabel);
      }
      const composerRoot = mainInput.closest('div[role="dialog"]') || document;
      const postBtn = Array.from(composerRoot.querySelectorAll('div[role="button"], button')).find((el) => {
        const txt = (el.textContent || "").trim().toLowerCase();
        return txt === "kirim" || txt === "post" || txt === "posting";
      });
      if (postBtn) {
        postBtn.click();
        await randomDelay(2, 3);
        return { success: true, message: "Berhasil memposting polling ke Threads!" };
      }
      return { success: true, message: "Konten polling terisi. Klik Kirim untuk memposting." };
    },
    /**
     * Find the "Tambahkan ke utas" / "Add to thread" button (creates the next
     * thread item). Tries aria-labels first, then text inside the composer, then
     * a global text fallback.
     */
    findAddThreadButton(currentInput) {
      const labelSelectors = [
        '[aria-label*="Tambahkan ke utas"]',
        '[aria-label*="Add to thread"]',
        '[aria-label*="Tambah utas"]',
        '[aria-label*="add to thread"]'
      ];
      for (const sel of labelSelectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      const matchesText = (el) => {
        if (!el) return false;
        const txt = (el.textContent || "").trim().toLowerCase();
        return txt === "tambahkan ke utas" || txt === "add to thread" || txt === "tambah utas";
      };
      const root = currentInput && currentInput.closest('div[role="dialog"]') || currentInput && currentInput.closest('div[data-testid*="composer"]') || document;
      const candidates = Array.from(root.querySelectorAll('div[role="button"], button, span'));
      for (const el of candidates) {
        if (matchesText(el) && el.children.length <= 2) return el;
      }
      return Array.from(document.querySelectorAll("*")).find((el) => {
        if (!el || el.children.length > 2) return false;
        return matchesText(el);
      });
    },
    /**
     * Find the newly created thread composer input: the first visible composer
     * input strictly below the current one (same column). Falls back to the last
     * composer input inside the same container if the new item is not laid out yet.
     */
    findComposerInputBelow(currentInput) {
      if (!currentInput) return null;
      const currentRect = currentInput.getBoundingClientRect();
      const candidates = Array.from(document.querySelectorAll(
        'div[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"], div[contenteditable="true"]'
      )).filter((el) => {
        if (el === currentInput) return false;
        if (el.getBoundingClientRect().width <= 0) return false;
        const r = el.getBoundingClientRect();
        return r.top > currentRect.top + 2 && Math.abs(r.left - currentRect.left) < 300;
      });
      candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      if (candidates[0]) return candidates[0];
      const container = currentInput.closest('div[role="dialog"]') || currentInput.closest('div[data-testid*="composer"]') || currentInput.parentElement?.parentElement || document;
      const inContainer = Array.from(container.querySelectorAll(
        'div[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"], div[contenteditable="true"]'
      )).filter((el) => el !== currentInput && el.getBoundingClientRect().width > 0);
      return inContainer[inContainer.length - 1] || null;
    },
    /**
     * Find the "Komunitas atau topik" (Community or topic) field that lives on
     * the FIRST thread item. Threads labels this field via aria-placeholder /
     * aria-label ("Komunitas atau topik"), so we scan placeholder, aria-label,
     * aria-placeholder AND visible text across editable elements.
     */
    findTopicField(firstInput) {
      const root = firstInput && firstInput.closest('div[role="dialog"]') || firstInput && firstInput.closest('div[data-testid*="composer"]') || document;
      const patterns = [
        'input[placeholder*="topik" i]',
        'input[placeholder*="komunitas" i]',
        'input[aria-label*="topik" i]',
        'input[aria-label*="komunitas" i]',
        'input[aria-placeholder*="topik" i]',
        'input[aria-placeholder*="komunitas" i]',
        '[role="combobox"][aria-label*="topik" i]',
        '[role="combobox"][aria-label*="komunitas" i]',
        '[role="combobox"][aria-placeholder*="topik" i]',
        '[role="combobox"][aria-placeholder*="komunitas" i]',
        '[role="textbox"][aria-label*="topik" i]',
        '[role="textbox"][aria-label*="komunitas" i]',
        '[role="textbox"][aria-placeholder*="topik" i]',
        '[role="textbox"][aria-placeholder*="komunitas" i]',
        'div[contenteditable="true"][aria-label*="topik" i]',
        'div[contenteditable="true"][aria-label*="komunitas" i]',
        'div[contenteditable="true"][aria-placeholder*="topik" i]',
        'div[contenteditable="true"][aria-placeholder*="komunitas" i]',
        '[aria-label*="tambahkan topik" i]',
        '[aria-label*="tambahkan komunitas" i]',
        '[placeholder*="topik" i]',
        '[placeholder*="komunitas" i]',
        '[aria-placeholder*="topik" i]',
        '[aria-placeholder*="komunitas" i]'
      ];
      for (const sel of patterns) {
        const el = root.querySelector(sel);
        if (el && el.isConnected) return el;
      }
      const all = Array.from(root.querySelectorAll(
        'input, [contenteditable="true"], [role="combobox"], [role="textbox"]'
      ));
      return all.find((el) => {
        const get = (n) => el.getAttribute && (el.getAttribute(n) || "") || "";
        const meta = (get("placeholder") + " " + get("aria-label") + " " + get("aria-placeholder") + " " + (el.textContent || "").slice(0, 60)).toLowerCase();
        return /topik|komunitas|topic|community/.test(meta);
      }) || null;
    },
    /**
     * Find the actual editable element once the topic field is active: a popup /
     * expanded search box (possibly rendered in a React portal outside the dialog)
     * may have appeared after clicking, so re-scan the whole document for a
     * visible editable whose placeholder/aria/text mentions topik.
     */
    findActiveTopicInput(firstInput) {
      const all = Array.from(document.querySelectorAll(
        'input, textarea, [contenteditable="true"], [role="combobox"], [role="textbox"]'
      )).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.offsetParent !== null;
      });
      return all.find((el) => {
        const get = (n) => el.getAttribute && (el.getAttribute(n) || "") || "";
        const meta = (get("placeholder") + " " + get("aria-label") + " " + get("aria-placeholder") + " " + (el.textContent || "").slice(0, 60)).toLowerCase();
        return /topik|komunitas|topic|community/.test(meta);
      }) || null;
    },
    /**
     * Type short text into the topic field. For plain inputs uses the React value
     * tracker trick (native setter + input/change), then verifies the value, then
     * confirms with Enter.
     */
    async typeTopicText(el, text) {
      if (!el) return false;
      try {
        el.focus();
        try {
          el.click();
        } catch (e) {
        }
        const isCE = el.isContentEditable || el.getAttribute("contenteditable") === "true";
        if (isCE) {
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (e) {
          }
          for (const ch of text) {
            el.dispatchEvent(new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "insertText",
              data: ch
            }));
            await new Promise((r) => setTimeout(r, 25 + Math.random() * 40));
          }
        } else {
          const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (nativeSetter) nativeSetter.call(el, text);
          else el.value = text;
          el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          if (!(el.value || "").includes(text)) {
            try {
              el.select();
            } catch (e) {
            }
            try {
              document.execCommand("selectAll", false, null);
            } catch (e) {
            }
            document.execCommand("insertText", false, text);
          }
        }
        for (const type of ["keydown", "keypress", "keyup"]) {
          el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        }
        await new Promise((r) => setTimeout(r, 200));
        const ownVal = isCE ? el.textContent || "" : el.value || "";
        if (ownVal.includes(text)) return true;
        const ae = document.activeElement;
        if (ae && ae !== el && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) {
          return (ae.value || ae.textContent || "").includes(text);
        }
        return false;
      } catch (e) {
        return false;
      }
    },
    /**
     * Fill the "Komunitas atau topik" label on the first thread item (max 3 words).
     */
    async fillThreadsTopic(firstInput, label) {
      if (!label) return false;
      const field = this.findTopicField(firstInput);
      if (!field) {
        console.warn('[Threads] Field "Komunitas atau topik" tidak ditemukan \u2014 label dilewati:', label);
        return false;
      }
      const words = label.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
      if (!words) return false;
      try {
        field.scrollIntoView?.({ block: "center" });
        const inner = field.matches('[contenteditable="true"]') ? field : field.querySelector('div[contenteditable="true"], [contenteditable="true"], input, textarea') || field;
        inner.focus();
        try {
          inner.click();
        } catch (e) {
        }
        await new Promise((r) => setTimeout(r, 700));
        const ae = document.activeElement;
        const isEditable = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable || ae.getAttribute("contenteditable") === "true");
        const active = (isEditable ? ae : null) || this.findActiveTopicInput(firstInput) || inner;
        console.log("[Threads] Mengisi label topik:", words, "\u2192", active.tagName, "(", active.getAttribute("placeholder") || active.getAttribute("aria-placeholder") || "", ")");
        const typed = await this.typeTopicText(active, words);
        if (!typed) console.warn("[Threads] Teks label tidak masuk ke field topik:", words);
        else console.log("[Threads] Label topik berhasil diisi:", words);
        await new Promise((r) => setTimeout(r, 500));
        return typed;
      } catch (e) {
        console.warn("[Threads] Gagal mengisi label topik:", e.message);
        return false;
      }
    },
    /**
     * Upload an image to the Threads composer.
     * Tries to click "Lampirkan media" and handle the file input.
     * If image generation is not available, logs the prompt for manual use.
     */
    async uploadImageToComposer(composerInput, imagePrompt) {
      console.log("[Threads] Image prompt for generation:", imagePrompt);
      try {
        const imageUrl = await this.generateImage(imagePrompt);
        if (!imageUrl) throw new Error("No image URL returned");
        const imageResponse = await fetch(imageUrl);
        const blob = await imageResponse.blob();
        const file = new File([blob], "generated-image.png", { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const dataTransferItem = dt.items[0];
        const kind = dataTransferItem.kind;
        const type = dataTransferItem.type;
        const pasteEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        composerInput.dispatchEvent(pasteEvent);
        await randomDelay(1, 2);
        console.log("[Threads] Gambar berhasil di-paste ke composer");
        return true;
      } catch (e) {
        console.warn("[Threads] Gagal generate/unggah gambar:", e.message);
        return false;
      }
    },
    async generateImage(prompt) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: "GENERATE_IMAGE",
          payload: { prompt }
        });
        return response?.success ? response.data : null;
      } catch (e) {
        console.warn("[Threads] Image generation via background failed:", e.message);
        return null;
      }
    }
  };

  // src/content/adapters/threads_interaction.js
  var AUTO_REPLY_STATE_KEY = "autoReplyProcessed";
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
        postKeys: Array.from(state.postKeys).slice(-1e3)
      }
    });
  }
  function reactClick(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    });
  }
  function findLikeButton(container) {
    const allSvgs = Array.from(container.querySelectorAll("svg"));
    for (const svg of allSvgs) {
      const label = (svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || "").toLowerCase();
      if (label.includes("like") || label.includes("suka")) {
        let el = svg.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!el) break;
          const role = el.getAttribute("role");
          const tag = (el.tagName || "").toLowerCase();
          if (role === "button" || tag === "button") return el;
          el = el.parentElement;
        }
        return svg.parentElement;
      }
    }
    return container.querySelector('[aria-label*="Like"i]') || container.querySelector('[aria-label*="Suka"i]') || container.querySelector('[aria-label*="Unlike"i]') || container.querySelector('[aria-label*="Batalkan suka"i]') || null;
  }
  function isAlreadyLiked(container) {
    const btn = findLikeButton(container);
    if (!btn) return false;
    if (btn.getAttribute("aria-pressed") === "true") return true;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("unlike") || label.includes("batalkan")) return true;
    const svg = btn.querySelector("svg") || (btn.tagName === "svg" ? btn : null);
    if (svg) {
      const svgLabel = (svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || "").toLowerCase();
      if (svgLabel.includes("unlike") || svgLabel.includes("batalkan")) return true;
    }
    return false;
  }
  function findReplyButton(container) {
    if (!container) return null;
    const svgs = Array.from(container.querySelectorAll("svg"));
    for (const svg of svgs) {
      const label = (svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || "").toLowerCase();
      if (label.includes("reply") || label.includes("balas")) {
        let el = svg.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!el || el === container) break;
          if (el.tagName === "A" && el.getAttribute("href")?.includes("/@")) break;
          const role = el.getAttribute("role");
          const tag = el.tagName.toLowerCase();
          if (role === "button" || tag === "button") return el;
          el = el.parentElement;
        }
        return svg.parentElement;
      }
    }
    const directBtn = container.querySelector('[aria-label*="Reply"i]') || container.querySelector('[aria-label*="Balas"i]');
    if (directBtn) {
      const closestAnchor = directBtn.closest('a[href*="/@"]');
      if (!closestAnchor) {
        return directBtn.closest('div[role="button"], button') || directBtn;
      }
    }
    return null;
  }
  function getSelfUsername() {
    const profileLinks = Array.from(document.querySelectorAll('a[href*="/@"]'));
    for (const a of profileLinks) {
      const href = a.getAttribute("href") || "";
      const match = href.match(/\/@([a-zA-Z0-9_.]+)/);
      if (match && match[1]) {
        if (a.closest('header, nav, [role="navigation"]')) {
          return match[1].toLowerCase();
        }
      }
    }
    return "rasyiqi";
  }
  function extractPostText(container) {
    if (!container) return "";
    const candidates = Array.from(container.querySelectorAll('span[dir="auto"], div[dir="auto"], p'));
    const textParts = [];
    for (const el of candidates) {
      const txt = (el.textContent || "").trim();
      if (!txt || txt.length < 2) continue;
      if (/^\d+\s*(detik|menit|jam|hari|minggu|d|m|h|w|mnt|bln)$/i.test(txt)) continue;
      if (/^(follow|ikuti|diposting|balas|suka|repost|kutip|share|bagikan|balasan|like|unlike)$/i.test(txt)) continue;
      if (txt.startsWith("@")) continue;
      textParts.push(txt);
    }
    const uniqueParts = [...new Set(textParts)];
    return uniqueParts.join(" ").trim().slice(0, 600);
  }
  async function reloadFeedAfterReply(shouldResume = true) {
    await randomDelay(1.5, 2.5);
    try {
      document.querySelectorAll('div[contenteditable="true"]').forEach((el) => {
        el.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("delete", false, null);
      });
    } catch (e) {
    }
    if (shouldResume) {
      chrome.storage.local.set({ autoReplyRunning: true });
    } else {
      chrome.storage.local.remove("autoReplyRunning");
    }
    window.location.href = window.location.protocol + "//" + window.location.host + "/";
  }
  var ThreadsInteraction = {
    name: "ThreadsInteraction",
    isRunning: false,
    activeTask: null,
    // 'like' | 'repost' | 'follow' | 'reply'
    /**
     * Stop any active continuous loop and close modals / go back to feed
     */
    async stop() {
      this.isRunning = false;
      this.activeTask = null;
      try {
        chrome.storage.local.remove("autoReplyRunning");
      } catch (e) {
      }
      console.log("[ThreadsInteraction] Stopped continuous interaction loop.");
    },
    /**
     * Scan visible feed posts and return their data (Excludes self posts!)
     */
    scanFeedPosts(maxPosts = 30) {
      const posts = [];
      const selfUser = getSelfUsername();
      const selectorGroups = [
        "article",
        'div[data-pressable-container="true"]',
        '[role="article"]'
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
          const authorEl = el.querySelector("a span") || el.querySelector("strong") || el.querySelector('span[class*="username"]');
          const author = (authorEl?.textContent || "").trim().slice(0, 80);
          const authorLower = author.toLowerCase();
          if (authorLower === selfUser || authorLower === "rasyiqi") {
            continue;
          }
          const likeBtn = findLikeButton(el);
          const replyBtn = findReplyButton(el);
          const repostBtn = el.querySelector('[aria-label*="Repost"i]') || el.querySelector('[aria-label*="Kutip"i]') || el.querySelector('[aria-label*="Posting ulang"i]') || el.querySelector('[aria-label*="Rethread"i]');
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
            hasLiked: isAlreadyLiked(el)
          });
        } catch (e) {
        }
      }
      return posts;
    },
    /**
     * Like a specific post
     */
    async likePost(postData) {
      const { element } = postData;
      if (isAlreadyLiked(element)) {
        return { success: true, message: "Sudah di-like sebelumnya", skipped: true };
      }
      const freshBtn = findLikeButton(element);
      if (!freshBtn) throw new Error("Tombol Like tidak ditemukan pada postingan ini");
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
      this.activeTask = "like";
      let count = 0;
      const processedPostElements = /* @__PURE__ */ new WeakSet();
      console.log("[ThreadsInteraction] Starting continuous Auto-Like...");
      while (this.isRunning && this.activeTask === "like") {
        const posts = this.scanFeedPosts(40);
        const unlikedPost = posts.find((p) => p.likeBtn && !p.hasLiked && !processedPostElements.has(p.element));
        if (unlikedPost) {
          processedPostElements.add(unlikedPost.element);
          try {
            unlikedPost.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(0.8, 1.5);
            const res = await this.likePost(unlikedPost);
            if (res.success && !res.skipped) {
              count++;
              if (onProgressCallback) onProgressCallback({ count, author: unlikedPost.author, text: unlikedPost.text });
            }
            await randomDelay(2, 4);
          } catch (e) {
            console.warn("[ThreadsInteraction] Auto-like error on post:", e);
          }
        } else {
          window.scrollBy({ top: 600, behavior: "smooth" });
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
      this.activeTask = "repost";
      let count = 0;
      const processedElements = /* @__PURE__ */ new WeakSet();
      while (this.isRunning && this.activeTask === "repost") {
        const posts = this.scanFeedPosts(40);
        const targetPost = posts.find((p) => p.repostBtn && !processedElements.has(p.element));
        if (targetPost) {
          processedElements.add(targetPost.element);
          try {
            targetPost.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1, 2);
            const res = await this.repostPost(targetPost);
            if (res.success) {
              count++;
              if (onProgressCallback) onProgressCallback({ count, author: targetPost.author });
            }
            await randomDelay(3, 6);
          } catch (e) {
            console.warn("[ThreadsInteraction] Repost error:", e);
          }
        } else {
          window.scrollBy({ top: 600, behavior: "smooth" });
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
      this.activeTask = "follow";
      let count = 0;
      const processedElements = /* @__PURE__ */ new WeakSet();
      while (this.isRunning && this.activeTask === "follow") {
        const posts = this.scanFeedPosts(40);
        const targetPost = posts.find((p) => {
          if (processedElements.has(p.element)) return false;
          const followBtn = Array.from(p.element.querySelectorAll('div[role="button"], button, span[role="button"]')).find((el) => {
            const txt = (el.textContent || "").trim().toLowerCase();
            return txt === "follow" || txt === "ikuti";
          });
          return !!followBtn;
        });
        if (targetPost) {
          processedElements.add(targetPost.element);
          try {
            targetPost.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1, 2);
            const res = await this.followUser(targetPost);
            if (res.success) {
              count++;
              if (onProgressCallback) onProgressCallback({ count, author: targetPost.author });
            }
            await randomDelay(3, 6);
          } catch (e) {
            console.warn("[ThreadsInteraction] Follow error:", e);
          }
        } else {
          window.scrollBy({ top: 600, behavior: "smooth" });
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
      const scope = replyInput?.closest('div[role="dialog"]') || replyInput?.closest('div[role="dialog"], div[class*="x78zum5"]') || document;
      const candidates = Array.from(scope.querySelectorAll('div[role="button"], button'));
      let submitBtn = candidates.find((el) => {
        const txt = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        return ["posting", "post", "kirim", "balas", "send"].some((k) => txt === k || aria === k) || aria.includes("kirim") || aria.includes("send");
      });
      if (!submitBtn) {
        const iconBtns = candidates.filter((el) => {
          const txt = (el.textContent || "").trim();
          return txt === "" && el.querySelector("svg");
        });
        submitBtn = iconBtns[iconBtns.length - 1] || null;
      }
      if (submitBtn) {
        reactClick(submitBtn);
        await randomDelay(2, 3);
      } else {
        try {
          replyInput.focus();
          const enter = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true });
          replyInput.dispatchEvent(enter);
          await randomDelay(1.5, 2.5);
        } catch (e) {
        }
      }
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
      this.activeTask = "reply";
      let count = 0;
      const selfUser = getSelfUsername();
      const processedAuthors = /* @__PURE__ */ new Set([selfUser, "rasyiqi"]);
      const processedPostKeys = /* @__PURE__ */ new Set();
      const processedElements = /* @__PURE__ */ new WeakSet();
      const persisted = await loadAutoReplyState();
      persisted.authors.forEach((a) => processedAuthors.add(a));
      persisted.postKeys.forEach((k) => processedPostKeys.add(k));
      console.log(`[ThreadsInteraction] Starting continuous Auto AI-Reply (selfUser=${selfUser}, 1 reply per thread)...`);
      while (this.isRunning && this.activeTask === "reply") {
        if (!chrome.runtime?.id) {
          console.warn("[ThreadsInteraction] Extension context invalidated. Stopping auto-reply loop.");
          this.isRunning = false;
          this.activeTask = null;
          break;
        }
        const posts = this.scanFeedPosts(40);
        const targetPost = posts.find((p) => {
          if (!p.replyBtn || !p.text || p.text.length < 10) return false;
          const authorKey = (p.author || "").trim().toLowerCase();
          if (!authorKey || authorKey === selfUser || authorKey === "rasyiqi" || processedAuthors.has(authorKey)) {
            return false;
          }
          const postKey = `${p.author}_${p.text.slice(0, 50)}`;
          return !processedPostKeys.has(postKey) && !processedElements.has(p.element);
        });
        if (targetPost) {
          const authorKey = (targetPost.author || "").trim().toLowerCase();
          if (authorKey) processedAuthors.add(authorKey);
          const postKey = `${targetPost.author}_${targetPost.text.slice(0, 50)}`;
          processedPostKeys.add(postKey);
          processedElements.add(targetPost.element);
          persistAutoReplyState({ authors: processedAuthors, postKeys: processedPostKeys });
          try {
            targetPost.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1, 2);
            let replyText = "";
            if (generateReplyFn) {
              replyText = await generateReplyFn(targetPost.text);
            }
            if (!replyText) {
              console.warn("[ThreadsInteraction] AI reply gagal, melewati post ini.");
              await randomDelay(2, 4);
              continue;
            }
            const replyInput = await this.openReplyComposer(targetPost);
            if (replyInput) {
              await simulateHumanTyping(replyInput, replyText, "fast");
              await randomDelay(0.8, 1.5);
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
            console.warn("[ThreadsInteraction] Auto-reply error:", e);
            if (!chrome.runtime?.id) {
              this.isRunning = false;
              this.activeTask = null;
              break;
            }
            await reloadFeedAfterReply(this.isRunning);
          }
        } else {
          window.scrollBy({ top: 600, behavior: "smooth" });
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
        replyBtn.scrollIntoView({ block: "center", behavior: "smooth" });
        await randomDelay(0.3, 0.8);
        reactClick(replyBtn);
        await randomDelay(1.5, 3);
      }
      const replyInput = await new Promise((resolve) => {
        const check = setInterval(() => {
          const inputs = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
          const replyComposer = inputs.find(
            (el) => (el.getAttribute("aria-placeholder") || "").toLowerCase().startsWith("balas ke") || (el.getAttribute("aria-placeholder") || "").toLowerCase().includes("reply")
          );
          if (replyComposer) {
            clearInterval(check);
            resolve(replyComposer);
          } else if (inputs.length > 0) {
            clearInterval(check);
            resolve(inputs[inputs.length - 1]);
          }
        }, 300);
        setTimeout(() => {
          clearInterval(check);
          resolve(null);
        }, 5e3);
      });
      return replyInput;
    },
    /**
     * Post an AI reply on top/first post in feed
     */
    async replyToFirstPost(replyText) {
      const posts = this.scanFeedPosts(10);
      const targetPost = posts.find((p) => p.replyBtn) || posts[0];
      if (!targetPost) throw new Error("Postingan tidak ditemukan di feed.");
      const replyInput = await this.openReplyComposer(targetPost);
      if (!replyInput) throw new Error("Composer balasan tidak muncul.");
      await simulateHumanTyping(replyInput, replyText, "fast");
      await randomDelay(0.5, 1);
      await this.submitReply(replyInput, false);
      return { success: true, message: `Balasan dikirim ke postingan @${targetPost.author}.` };
    },
    /**
     * Repost a post
     */
    async repostPost(postData) {
      const { repostBtn } = postData;
      if (!repostBtn) throw new Error("Tombol Repost tidak ditemukan pada postingan ini");
      repostBtn.scrollIntoView({ block: "center", behavior: "smooth" });
      await randomDelay(0.5, 1);
      reactClick(repostBtn);
      await randomDelay(0.5, 1.5);
      const repostOption = Array.from(document.querySelectorAll('[role="menuitem"], div[role="button"]')).find((el) => {
        const txt = (el.textContent || "").toLowerCase();
        return txt.includes("repost") || txt.includes("rethread") || txt.includes("posting ulang");
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
      const followBtn = Array.from(element.querySelectorAll('div[role="button"], button, span[role="button"]')).find((el) => {
        const txt = (el.textContent || "").trim().toLowerCase();
        return txt === "follow" || txt === "ikuti";
      });
      if (!followBtn) return { success: false, message: `Tombol Ikuti tidak ditemukan untuk @${author}` };
      await randomDelay(0.5, 1.5);
      reactClick(followBtn);
      await randomDelay(0.5, 1);
      return { success: true, message: `Berhasil mengikuti @${author}!` };
    }
  };

  // src/content/adapters/facebook_adapter.js
  function findByAriaLabel(root, label, exact = false) {
    return Array.from(root.querySelectorAll('[role="button"], [role="dialog"], [role="menu"]')).find((el) => {
      const aria = el.getAttribute("aria-label") || "";
      return exact ? aria === label : aria.includes(label);
    }) || null;
  }
  function findByText(root, regex) {
    return Array.from(root.querySelectorAll('[role="button"]')).find((el) => {
      const txt = (el.textContent || "").trim();
      return regex.test(txt);
    }) || null;
  }
  function findComboboxes(root) {
    return Array.from(root.querySelectorAll('input[role="combobox"]'));
  }
  var FacebookAdapter = {
    name: "Facebook",
    /**
     * Find the Lexical composer textbox inside the "Buat postingan" dialog.
     * Uses aria-placeholder (confirmed by live DOM dump).
     */
    async getComposerInput() {
      const selectors = [
        'div[contenteditable="true"][role="textbox"][aria-placeholder*="Apa yang Anda pikirkan"]',
        `div[contenteditable="true"][role="textbox"][aria-placeholder*="What's on your mind"]`,
        'div[contenteditable="true"][role="textbox"][aria-label*="Apa yang Anda pikirkan"]',
        `div[contenteditable="true"][role="textbox"][aria-label*="What's on your mind"]`,
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
        `div[aria-label*="What's on your mind"]`,
        'div[role="button"]:has(span)'
      ];
      for (const sel of triggers) {
        const els = Array.from(document.querySelectorAll(sel));
        const match = els.find((e) => {
          const text = e.textContent || "";
          return text.includes("Apa yang Anda pikirkan") || text.includes("What's on your mind");
        });
        if (match) {
          GeneralHelpers.clickElement(match);
          await randomDelay(1, 2);
          const res = await waitForElement([
            'div[contenteditable="true"][role="textbox"][aria-placeholder*="Apa yang Anda pikirkan"]',
            `div[contenteditable="true"][role="textbox"][aria-placeholder*="What's on your mind"]`,
            'div[role="dialog"] div[contenteditable="true"]',
            'div[data-lexical-editor="true"][contenteditable="true"]'
          ], 5e3).catch(() => null);
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
      const btn = findByAriaLabel(document, "Berikutnya");
      if (btn) {
        GeneralHelpers.clickElement(btn);
        await waitForElement([
          'div[aria-label="Kirim"][role="button"]',
          'div[aria-label="Kirim"][role="button"] span',
          'div[role="button"][aria-label="Opsi penjadwalan"]',
          'div[role="button"][aria-label="Jadwalkan untuk nanti"]'
        ], 5e3).catch(() => {
        });
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
      const btn = findByAriaLabel(document, "Jadwalkan untuk nanti");
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
      const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
      const day = when.getDate();
      const month = months[when.getMonth()];
      const year = when.getFullYear();
      const dateStr = `${day} ${month} ${year}`;
      const hours = String(when.getHours()).padStart(2, "0");
      const mins = String(when.getMinutes()).padStart(2, "0");
      const timeStr = `${hours}:${mins}`;
      GeneralHelpers.clickElement(dateInput);
      await randomDelay(0.5, 1);
      await simulateHumanTyping(dateInput, dateStr, "fast");
      await randomDelay(0.5, 1);
      GeneralHelpers.clickElement(timeInput);
      await randomDelay(0.5, 1);
      await simulateHumanTyping(timeInput, timeStr, "fast");
      await randomDelay(0.5, 1);
      dateInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      timeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await randomDelay(0.5, 1);
      return true;
    },
    /**
     * Click the final "Kirim" (Post) button.
     */
    async clickPostButton() {
      const res = await waitForElement([
        'div[aria-label="Kirim"][role="button"]',
        'div[aria-label="Post"][role="button"]',
        'div[aria-label="Kirim"][role="button"] span',
        'div[role="button"][aria-label="Kirim"]'
      ], 8e3).catch(() => null);
      const btn = res ? res.element : findByAriaLabel(document, "Kirim");
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
      const typingSpeed = options.humanTypingSpeed || "medium";
      const input = await this.getComposerInput();
      if (!input) throw new Error('Input Facebook tidak ditemukan. Buka facebook.com dan klik "Apa yang Anda pikirkan?".');
      await simulateHumanTyping(input, contentText, typingSpeed);
      await randomDelay(1, 2);
      const nextClicked = await this.clickNextButton();
      if (!nextClicked) {
        const postBtn = findByAriaLabel(document, "Kirim");
        if (postBtn) {
          GeneralHelpers.clickElement(postBtn);
          await randomDelay(2, 4);
          return { success: true, message: "Berhasil memposting ke Facebook!" };
        }
        return { success: true, message: "Konten terisi di Facebook. Silakan klik Kirim." };
      }
      await randomDelay(1, 2);
      if (options.facebookScheduledTime) {
        const when = new Date(options.facebookScheduledTime);
        const panelOpened = await this.openSchedulePanel();
        if (panelOpened) {
          const laterClicked = await this.clickScheduleForLater();
          if (laterClicked) {
            const dtSet = await this.setScheduleDateTime(when);
            if (dtSet) {
              await randomDelay(0.5, 1);
              const posted2 = await this.clickPostButton();
              return {
                success: posted2,
                message: posted2 ? `Post dijadwalkan ${when.toLocaleString("id-ID")} via Facebook` : "Gagal klik Kirim setelah set jadwal"
              };
            }
          }
        }
        console.warn("[Facebook] Gagal set jadwal native, posting langsung");
      }
      const posted = await this.clickPostButton();
      return {
        success: posted,
        message: posted ? "Berhasil memposting ke Facebook!" : "Konten terisi. Silakan klik Kirim."
      };
    }
  };

  // src/content/adapters/facebook_interaction.js
  function fbClick(el, skipScroll = false) {
    if (!el) return;
    if (!skipScroll) {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) {
      }
    }
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const pointerOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const mouseOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerover", pointerOpts));
    el.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
    el.dispatchEvent(new PointerEvent("pointerenter", pointerOpts));
    el.dispatchEvent(new MouseEvent("mouseenter", mouseOpts));
    el.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
    el.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
    el.dispatchEvent(new PointerEvent("pointerup", pointerOpts));
    el.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
    el.dispatchEvent(new MouseEvent("click", mouseOpts));
    try {
      el.click();
    } catch (e) {
    }
  }
  function fbIsVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function findFbCommentSubmitButton(scope, inputEl = null) {
    if (!scope) return null;
    const allBtns = Array.from(scope.querySelectorAll('[role="button"], button'));
    const isUnrelated = (el) => {
      if (el.getAttribute("aria-hidden") === "true") return true;
      const label = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      const meta = label || text;
      if (!meta) return true;
      if (meta.includes("kirim ini") || meta.includes("bagikan") || meta.includes("share") || meta.includes("teman atau posting di profil") || meta.includes("tindakan untuk") || meta.includes("tandai sebagai dibaca")) return true;
      if (meta.includes("suka") || meta.includes("like") || meta.includes("reaksi") || meta.includes("reaction") || meta.includes("tutup") || meta.includes("close")) return true;
      return false;
    };
    const exactLabels = ["posting komentar", "post comment", "kirim komentar", "send comment", "kirim", "send"];
    for (const btn of allBtns) {
      if (isUnrelated(btn)) continue;
      const label = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
      if (exactLabels.includes(label)) return btn;
    }
    for (const btn of allBtns) {
      if (isUnrelated(btn)) continue;
      const label = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
      if (label.startsWith("posting") || label.startsWith("kirim")) {
        return btn;
      }
    }
    for (const btn of allBtns) {
      if (isUnrelated(btn)) continue;
      const text = (btn.textContent || "").trim().toLowerCase();
      if (text === "kirim" || text === "send" || text === "posting" || text === "post") {
        return btn;
      }
    }
    if (inputEl) {
      const container = inputEl.closest("form") || inputEl.closest('div[class*="notranslate"]') || inputEl.parentElement?.parentElement?.parentElement || inputEl.parentElement;
      if (container) {
        const iconBtns = Array.from(container.querySelectorAll('[role="button"], button')).filter((b) => {
          if (b.getAttribute("aria-hidden") === "true") return false;
          if (b.getAttribute("aria-disabled") === "true") return false;
          const label = (b.getAttribute("aria-label") || "").trim();
          const text = (b.textContent || "").trim();
          return !label && !text;
        });
        if (iconBtns.length === 1) return iconBtns[0];
      }
    }
    return null;
  }
  async function closeFbModal(dialog = null) {
    const targetDialog = dialog || Array.from(document.querySelectorAll('[role="dialog"]')).find(fbIsVisible);
    if (!targetDialog || !fbIsVisible(targetDialog)) return true;
    console.log("[FacebookInteraction] Closing open modal dialog...");
    const closeBtn = targetDialog.querySelector(
      '[aria-label="Tutup"][role="button"], [aria-label="Tutup"], [aria-label="Close"][role="button"], [aria-label="Close"]'
    );
    if (closeBtn) {
      fbClick(closeBtn, true);
      await randomDelay(1, 1.8);
      if (!Array.from(document.querySelectorAll('[role="dialog"]')).some(fbIsVisible)) return true;
    }
    const esc = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent("keydown", esc));
    window.dispatchEvent(new KeyboardEvent("keydown", esc));
    await randomDelay(1, 1.5);
    return !Array.from(document.querySelectorAll('[role="dialog"]')).some(fbIsVisible);
  }
  function fbIsAlreadyLiked(container) {
    if (!container) return false;
    const alreadyLikedBtn = container.querySelector(
      '[aria-label*="Hapus Suka"][role="button"], [aria-label*="Batalkan suka"][role="button"], [aria-label*="Ubah tanggapan"][role="button"], [aria-label*="Remove Like"][role="button"], [aria-label*="Unlike"][role="button"]'
    );
    if (alreadyLikedBtn) return true;
    const all = Array.from(container.querySelectorAll('[role="button"]'));
    return all.some((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      return label.includes("hapus suka") || label.includes("batalkan suka") || label.includes("ubah tanggapan") || label.includes("unlike") || label.includes("remove like");
    });
  }
  function findFbLikeButton(article) {
    if (!article) return null;
    if (fbIsAlreadyLiked(article)) return null;
    const all = Array.from(article.querySelectorAll('[role="button"]'));
    return all.find((el) => {
      const label = (el.getAttribute("aria-label") || "").trim();
      if (label.includes(":")) return false;
      return label === "Suka" || label === "Like";
    }) || null;
  }
  function findFbCommentButton(article) {
    if (!article) return null;
    return article.querySelector('[aria-label="Beri komentar"][role="button"]') || article.querySelector('[aria-label="Komentar"][role="button"]') || article.querySelector('[aria-label="Comment"][role="button"]') || Array.from(article.querySelectorAll('[role="button"]')).find((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      return label.includes("beri komentar") || label.includes("komentar") || label.includes("comment") || label.includes("balas") || label.includes("reply") || text === "komentar" || text === "comment" || text === "balas" || text === "reply";
    }) || null;
  }
  function findFbFollowButton(article) {
    if (!article) return null;
    return article.querySelector('[aria-label="Ikuti"][role="button"]') || article.querySelector('[aria-label="Follow"][role="button"]') || Array.from(article.querySelectorAll('[role="button"]')).find((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      return label === "ikuti" || label === "follow" || text === "ikuti" || text === "follow";
    }) || null;
  }
  function findFbShareButton(article) {
    if (!article) return null;
    return article.querySelector('[aria-label*="Kirim ini ke teman"][role="button"]') || article.querySelector('[aria-label*="Send this to friends"][role="button"]') || article.querySelector('[aria-label*="posting di profil"][role="button"]') || article.querySelector('[aria-label*="post on your profile"][role="button"]') || article.querySelector('[aria-label^="Bagikan"][role="button"]') || article.querySelector('[aria-label^="Share"][role="button"]') || Array.from(article.querySelectorAll('[role="button"]')).find((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      return label.includes("kirim ini") || label.includes("bagikan") || label.includes("share") || label.includes("send this to friends");
    }) || null;
  }
  function findFbShareDialog() {
    return Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => {
      if (!fbIsVisible(d)) return false;
      const txt = (d.textContent || "").toLowerCase();
      return txt.includes("bagikan sekarang") || txt.includes("share now");
    }) || null;
  }
  function fbNormalizeProfileUrl(href) {
    if (!href) return "";
    const url = href.startsWith("http") ? href : "https://www.facebook.com" + href;
    const idMatch = url.match(/profile\.php\?[^#]*id=(\d+)/);
    if (idMatch) return "id:" + idMatch[1];
    const path = url.replace(/^https:\/\/(www\.|web\.|m\.|mbasic\.)?facebook\.com\/?/i, "").split(/[?#]/)[0].replace(/\/$/, "");
    return path;
  }
  function findFbFriendLinks() {
    const scope = document.querySelector('div[role="main"]') || document.body;
    const skipPath = /^(friends\/?$|groups|watch|marketplace|messages|direct|story|stories|reel|reels|events|pages|settings|help|policy|about|policies|login|home|notifications|find-friends|saved|profile|me|p|sharer|intent|hashtag|photo|videos?|people|search|pay|fundraisers|gaming|jobs|shortform|friends_lists|invite|campaign|business|apps|game|live|comments|privacy|support|account|security|welcome|requests|fundraiser|payments|gifts|notes|photo_fbid|change_name|contact|friends_tab|reviews|list|wellbeing|local|shortcuts|watch_tab|gaming_tab|videos_tab)/i;
    const results = /* @__PURE__ */ new Map();
    const anchors = scope.querySelectorAll("a[href]");
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.startsWith("javascript")) continue;
      const key = fbNormalizeProfileUrl(href);
      if (!key || key === "friends" || key === "friends/" || skipPath.test(key)) continue;
      if (key.startsWith("id:")) {
      } else if (key.includes("/") || key.length < 3) {
        continue;
      }
      let name = (a.getAttribute("aria-label") || a.getAttribute("title") || "").trim();
      if (!name) {
        const img = a.querySelector("img");
        if (img) name = (img.getAttribute("alt") || "").trim();
      }
      if (!name) {
        const txt = (a.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length > 0 && txt.length < 40) name = txt;
      }
      if (!name) continue;
      if (!results.has(key)) results.set(key, { url: href, name, el: a });
    }
    return Array.from(results.values());
  }
  async function processOpenFbCommentDialog(generateCommentFn) {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(fbIsVisible);
    if (!dialog) return { done: false, dialog: false };
    const input = dialog.querySelector(
      'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label*="sebagai"], div[contenteditable="true"][aria-placeholder*="sebagai"], div[contenteditable="true"][data-lexical-editor="true"], div[contenteditable="true"]'
    );
    if (!input) {
      await closeFbModal(dialog);
      return { done: false, closed: true };
    }
    const textDivs = Array.from(dialog.querySelectorAll('div[dir="auto"], span[dir="auto"]'));
    const parts = [];
    for (const el of textDivs) {
      const txt = (el.textContent || "").trim();
      if (txt.length > 15 && !parts.includes(txt) && !txt.startsWith("Komentari sebagai")) parts.push(txt);
    }
    const postText = parts.join(" ").slice(0, 500) || "Postingan teman di Facebook";
    let commentText = "";
    if (generateCommentFn) commentText = await generateCommentFn(postText);
    if (!commentText) {
      await closeFbModal(dialog);
      return { done: false, closed: true };
    }
    try {
      input.focus();
      await randomDelay(0.5, 1);
      await simulateHumanTyping(input, commentText, "medium");
      await randomDelay(1.2, 2.2);
      const submitBtn = findFbCommentSubmitButton(dialog, input);
      if (submitBtn) {
        await randomDelay(0.5, 1);
        fbClick(submitBtn, true);
      } else {
        input.focus();
        const enterOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
        input.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
        input.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
        input.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
      }
      await randomDelay(2.5, 4);
      await closeFbModal(dialog);
      return { done: true, commentText, postText };
    } catch (e) {
      console.warn("[FacebookInteraction] Error typing comment in dialog:", e);
      await closeFbModal(dialog);
      return { done: false, closed: true };
    }
  }
  function extractFbAuthor(article) {
    if (!article) return "User";
    const strong = article.querySelector("strong a, h2 a, h3 a");
    if (strong) return (strong.textContent || "").trim().slice(0, 60);
    const spans = Array.from(article.querySelectorAll("span"));
    for (const sp of spans) {
      const txt = (sp.textContent || "").trim();
      if (txt.length > 2 && txt.length < 60 && !txt.includes("\n")) return txt;
    }
    return "User";
  }
  function extractFbPostText(article) {
    if (!article) return "";
    const textDivs = Array.from(article.querySelectorAll('div[dir="auto"], [data-ad-preview], span[dir="auto"]'));
    const parts = [];
    for (const el of textDivs) {
      const txt = (el.textContent || "").trim();
      if (txt.length > 15 && !parts.includes(txt)) parts.push(txt);
    }
    return parts.join(" ").slice(0, 500);
  }
  function isFbPostMenu(el) {
    if (!el) return false;
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    const isPostMenu = label.includes("tindakan untuk postingan") || label.includes("actions for this post") || label.includes("actions for the post") || label.includes("actions for") && !label.includes("comment");
    if (!isPostMenu) return false;
    return !label.includes("komentar") && !label.includes("comment");
  }
  function findFbPostContainers(maxPosts = 30) {
    const btnSel = 'div[role="button"], button, [role="menuitem"]';
    const menus = Array.from(document.querySelectorAll(btnSel)).filter(isFbPostMenu);
    const containers = [];
    const seen = /* @__PURE__ */ new Set();
    for (const menu of menus) {
      let cur = menu.parentElement;
      let container = null;
      for (let depth = 0; cur && depth < 12; depth++) {
        const menuCount = Array.from(cur.querySelectorAll(btnSel)).filter(isFbPostMenu).length;
        if (menuCount === 1) {
          container = cur;
        } else if (menuCount > 1) {
          break;
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
  function scanFbFeedPosts(maxPosts = 30) {
    let articles = findFbPostContainers(maxPosts);
    if (articles.length === 0) {
      articles = Array.from(document.querySelectorAll('div[role="article"], div[data-pagelet*="FeedUnit"]')).filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
        if (ariaLabel.includes("komentar oleh") || ariaLabel.includes("balasan oleh") || ariaLabel.includes("comment by") || ariaLabel.includes("reply by")) {
          return false;
        }
        const hasText = (el.textContent || "").trim().length > 0;
        const hasButtons = !!el.querySelector('[role="button"]');
        return hasText && hasButtons;
      }).slice(0, maxPosts);
    }
    if (articles.length === 0) {
      const likeBtns = Array.from(document.querySelectorAll('[aria-label="Suka"][role="button"], [aria-label="Like"][role="button"]')).filter((b) => !(b.getAttribute("aria-label") || "").includes(":"));
      articles = likeBtns.map((b) => b.closest('div[role="article"]') || b.closest("div[data-pagelet]") || b.parentElement?.parentElement?.parentElement || b).filter(Boolean).slice(0, maxPosts);
    }
    return articles.map((el, i) => ({
      index: i,
      element: el,
      author: extractFbAuthor(el),
      text: extractFbPostText(el),
      likeBtn: findFbLikeButton(el),
      commentBtn: findFbCommentButton(el),
      followBtn: findFbFollowButton(el),
      hasLiked: fbIsAlreadyLiked(el)
    }));
  }
  function fbHoverToOpenReactions(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (e) {
    }
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const events = [
      new PointerEvent("pointerover", { bubbles: true, cancelable: true, view: window, clientX, clientY }),
      new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window, clientX, clientY }),
      new PointerEvent("pointerenter", { bubbles: true, cancelable: true, view: window, clientX, clientY }),
      new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window, clientX, clientY }),
      new PointerEvent("pointermove", { bubbles: true, cancelable: true, view: window, clientX, clientY }),
      new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window, clientX, clientY })
    ];
    events.forEach((ev) => el.dispatchEvent(ev));
  }
  async function fbPerformReaction(btn, reactionChoice = "random") {
    if (!btn) return false;
    await randomDelay(0.3, 0.5);
    const reactionsList = ["Suka", "Super", "Peduli", "Haha", "Wow"];
    let chosenReaction = reactionChoice;
    if (!chosenReaction || chosenReaction === "random") {
      chosenReaction = reactionsList[Math.floor(Math.random() * reactionsList.length)];
    }
    if (chosenReaction === "Suka") {
      fbClick(btn);
      await randomDelay(0.5, 0.8);
      return true;
    }
    fbHoverToOpenReactions(btn);
    await randomDelay(0.8, 1.2);
    let dialog = document.querySelector('[aria-label="Tanggapan"]') || Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => (d.textContent || "").includes("Tanggapan") || (d.textContent || "").includes("Super"));
    if (!dialog) {
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      await randomDelay(0.8, 1.2);
      dialog = document.querySelector('[aria-label="Tanggapan"]') || Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => (d.textContent || "").includes("Tanggapan") || (d.textContent || "").includes("Super"));
    }
    if (dialog) {
      let rxBtn = dialog.querySelector(`[aria-label="${chosenReaction}"][role="button"]`) || dialog.querySelector(`[aria-label*="${chosenReaction}"][role="button"]`);
      if (!rxBtn) {
        rxBtn = Array.from(dialog.querySelectorAll('[role="button"]')).find((b) => {
          const label = (b.getAttribute("aria-label") || "").toLowerCase();
          const txt = (b.textContent || "").toLowerCase();
          return label.includes(chosenReaction.toLowerCase()) || txt.includes(chosenReaction.toLowerCase());
        });
      }
      if (!rxBtn) {
        rxBtn = dialog.querySelector('[aria-label="Super"][role="button"]') || Array.from(dialog.querySelectorAll('[role="button"]'))[0];
      }
      if (rxBtn) {
        fbClick(rxBtn, true);
        await randomDelay(0.5, 0.9);
        return true;
      }
    }
    fbClick(btn);
    await randomDelay(0.5, 0.8);
    return true;
  }
  var FacebookInteraction = {
    name: "FacebookInteraction",
    isRunning: false,
    activeTask: null,
    async stop() {
      this.isRunning = false;
      this.activeTask = null;
      console.log("[FacebookInteraction] Stopped.");
    },
    /**
     * Auto-Like / Auto-Reaction continuous loop.
     */
    async startContinuousAutoLike(onProgressCallback, options = {}) {
      if (this.isRunning) await this.stop();
      this.isRunning = true;
      this.activeTask = "like";
      const chosenReaction = options?.reaction || "Suka";
      let count = 0;
      const processed = /* @__PURE__ */ new WeakSet();
      console.log("[FacebookInteraction] Auto-Like/Reaction started with target reaction:", chosenReaction);
      while (this.isRunning && this.activeTask === "like") {
        const posts = scanFbFeedPosts(40);
        const target = posts.find((p) => p.likeBtn && !p.hasLiked && !processed.has(p.element));
        if (target) {
          processed.add(target.element);
          try {
            target.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(0.8, 1.5);
            const freshBtn = findFbLikeButton(target.element);
            if (freshBtn && !fbIsAlreadyLiked(target.element)) {
              await fbPerformReaction(freshBtn, chosenReaction);
              count++;
              if (onProgressCallback) onProgressCallback({ count, author: target.author, reaction: chosenReaction });
            }
            await randomDelay(2.5, 4.5);
          } catch (e) {
            console.warn("[FacebookInteraction] Auto-like error:", e);
          }
        } else {
          const rawBtns = Array.from(document.querySelectorAll('[aria-label="Suka"][role="button"], [aria-label="Like"][role="button"]')).filter((b) => {
            const label = (b.getAttribute("aria-label") || "").trim();
            if (label.includes(":")) return false;
            const parent = b.closest('div[role="article"]') || b.parentElement;
            if (processed.has(b) || parent && processed.has(parent)) return false;
            if (parent && fbIsAlreadyLiked(parent)) return false;
            return true;
          });
          if (rawBtns.length > 0) {
            const btn = rawBtns[0];
            const parent = btn.closest('div[role="article"]') || btn.parentElement;
            if (parent) processed.add(parent);
            processed.add(btn);
            try {
              btn.scrollIntoView({ behavior: "smooth", block: "center" });
              await randomDelay(0.8, 1.5);
              await fbPerformReaction(btn, chosenReaction);
              count++;
              if (onProgressCallback) onProgressCallback({ count, author: "User", reaction: chosenReaction });
              await randomDelay(2.5, 4.5);
            } catch (e) {
              console.warn("[FacebookInteraction] Fallback like error:", e);
            }
          } else {
            window.scrollBy({ top: 600, behavior: "smooth" });
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
      this.activeTask = "comment";
      let count = 0;
      const processedAuthors = /* @__PURE__ */ new Set();
      const processedElements = /* @__PURE__ */ new WeakSet();
      let failedDialogCloses = 0;
      console.log("[FacebookInteraction] Auto-Comment started...");
      while (this.isRunning && this.activeTask === "comment") {
        if (!chrome.runtime?.id) {
          console.warn("[FacebookInteraction] Extension context invalidated. Stopping.");
          this.isRunning = false;
          break;
        }
        const currentUrl = window.location.href;
        if (currentUrl.includes("/reel/") || currentUrl.includes("/reels/")) {
          console.log("[FacebookInteraction] Skipping Reel page, scrolling past...");
          window.scrollBy({ top: 800, behavior: "smooth" });
          await randomDelay(2, 3.5);
          continue;
        }
        const openDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(fbIsVisible);
        if (openDialog) {
          failedDialogCloses = 0;
          const dialogCommentInput = openDialog.querySelector(
            'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label*="sebagai"], div[contenteditable="true"][aria-placeholder*="sebagai"], div[contenteditable="true"][data-lexical-editor="true"], div[contenteditable="true"]'
          );
          if (dialogCommentInput && !processedElements.has(dialogCommentInput)) {
            processedElements.add(dialogCommentInput);
            processedElements.add(openDialog);
            console.log("[FacebookInteraction] Dialog modal detected on screen! Processing comment...");
            const dialogTextDivs = Array.from(openDialog.querySelectorAll('div[dir="auto"], span[dir="auto"]'));
            const dialogTextParts = [];
            for (const el of dialogTextDivs) {
              const txt = (el.textContent || "").trim();
              if (txt.length > 15 && !dialogTextParts.includes(txt) && !txt.startsWith("Komentari sebagai")) {
                dialogTextParts.push(txt);
              }
            }
            const postText = dialogTextParts.join(" ").slice(0, 500) || "Postingan Facebook populer";
            console.log("[FacebookInteraction] Dialog post text:", postText.slice(0, 100));
            let commentText = "";
            if (generateCommentFn) {
              console.log("[FacebookInteraction] Generating AI comment...");
              commentText = await generateCommentFn(postText);
              console.log("[FacebookInteraction] AI generated comment:", commentText ? commentText.slice(0, 100) : "(empty)");
            }
            if (commentText) {
              try {
                dialogCommentInput.focus();
                await randomDelay(0.5, 1);
                console.log("[FacebookInteraction] Typing comment into input...");
                await simulateHumanTyping(dialogCommentInput, commentText, "medium");
                await randomDelay(1.2, 2.2);
                const submitBtn = findFbCommentSubmitButton(openDialog, dialogCommentInput);
                if (submitBtn) {
                  console.log("[FacebookInteraction] Found submit button:", submitBtn.getAttribute("aria-label") || submitBtn.textContent?.slice(0, 30));
                  await randomDelay(0.5, 1);
                  fbClick(submitBtn, true);
                  console.log("[FacebookInteraction] Clicked submit button.");
                } else {
                  dialogCommentInput.focus();
                  const enterOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
                  dialogCommentInput.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
                  dialogCommentInput.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
                  dialogCommentInput.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
                  console.log("[FacebookInteraction] Pressed Enter to submit.");
                }
                await randomDelay(2.5, 4);
                count++;
                const author = extractFbAuthor(openDialog) || "User";
                if (onProgressCallback) onProgressCallback({ count, author, replyText: commentText });
                console.log("[FacebookInteraction] Comment posted! Refreshing facebook.com...");
                await randomDelay(1, 2);
                window.location.href = "https://www.facebook.com";
                return { success: true, totalProcessed: count };
              } catch (e) {
                console.warn("[FacebookInteraction] Error commenting on dialog:", e);
              }
            }
          }
          console.log("[FacebookInteraction] Closing open dialog modal...");
          const dialogClosed = await closeFbModal(openDialog);
          if (!dialogClosed) {
            failedDialogCloses++;
            console.warn(`[FacebookInteraction] Dialog masih terbuka setelah percobaan ke-${failedDialogCloses}.`);
            if (failedDialogCloses >= 3) {
              console.warn("[FacebookInteraction] Dialog tidak dapat ditutup. Menghentikan Auto-Comment untuk mencegah loop tak berujung.");
              this.isRunning = false;
              break;
            }
          }
          await randomDelay(1.5, 2.5);
          continue;
        }
        failedDialogCloses = 0;
        const posts = scanFbFeedPosts(40);
        let target = posts.find((p) => {
          if (!p.commentBtn) return false;
          const authorKey = (p.author || "").trim().toLowerCase();
          if (authorKey && authorKey !== "user" && processedAuthors.has(authorKey)) return false;
          return !processedElements.has(p.element);
        });
        console.log("[FacebookInteraction] Feed scan:", posts.length, "posts found,", target ? `target: ${target.author}` : "no target");
        if (target) {
          const authorKey = (target.author || "").trim().toLowerCase();
          if (authorKey && authorKey !== "user") processedAuthors.add(authorKey);
          processedElements.add(target.element);
          try {
            console.log("[FacebookInteraction] Scrolling feed to target post:", target.author);
            target.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1.2, 2.2);
            console.log("[FacebookInteraction] Clicking comment button to open post modal...");
            fbClick(target.commentBtn);
            await randomDelay(2, 3.5);
            continue;
          } catch (e) {
            console.warn("[FacebookInteraction] Error clicking comment button:", e);
          }
        } else {
          console.log("[FacebookInteraction] No target on current view, scrolling feed down...");
          window.scrollBy({ top: 500, behavior: "smooth" });
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
      this.activeTask = "follow";
      let count = 0;
      const processed = /* @__PURE__ */ new WeakSet();
      console.log("[FacebookInteraction] Auto-Follow started...");
      while (this.isRunning && this.activeTask === "follow") {
        const posts = scanFbFeedPosts(40);
        const target = posts.find((p) => p.followBtn && !processed.has(p.element));
        if (target) {
          processed.add(target.element);
          try {
            target.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1, 2);
            const freshBtn = findFbFollowButton(target.element);
            if (freshBtn) {
              fbClick(freshBtn);
              count++;
              if (onProgressCallback) onProgressCallback({ count, author: target.author });
            }
            await randomDelay(3, 6);
          } catch (e) {
            console.warn("[FacebookInteraction] Auto-follow error:", e);
          }
        } else {
          window.scrollBy({ top: 700, behavior: "smooth" });
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
      this.activeTask = "share";
      let count = 0;
      const processed = /* @__PURE__ */ new WeakSet();
      console.log("[FacebookInteraction] Auto-Share started...");
      while (this.isRunning && this.activeTask === "share") {
        const articles = scanFbFeedPosts(40).map((p) => p.element);
        const target = articles.find((art) => {
          if (processed.has(art)) return false;
          return !!findFbShareButton(art);
        });
        if (target) {
          processed.add(target);
          try {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1, 2);
            const shareBtn = findFbShareButton(target);
            if (shareBtn) {
              fbClick(shareBtn);
              await randomDelay(1.5, 2.5);
              let dialog = findFbShareDialog();
              for (let i = 0; i < 5 && !dialog; i++) {
                await randomDelay(0.5, 1);
                dialog = findFbShareDialog();
              }
              const shareNowBtn = dialog ? Array.from(dialog.querySelectorAll('[role="button"]')).find((el) => {
                const txt = (el.textContent || "").trim().toLowerCase();
                return txt === "bagikan sekarang" || txt === "share now";
              }) : null;
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
            console.warn("[FacebookInteraction] Auto-share error:", e);
          }
        } else {
          window.scrollBy({ top: 700, behavior: "smooth" });
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
      this.activeTask = "personal";
      console.log("[FacebookInteraction] Auto-Interaksi Personal dimulai...");
      if (!window.location.href.includes("facebook.com/friends")) {
        console.log("[FacebookInteraction] Menuju https://www.facebook.com/friends/ ...");
        try {
          await chrome.storage.local.set({ fbAutoPersonalPending: true });
        } catch (e) {
        }
        window.location.href = "https://www.facebook.com/friends/";
        return { success: true, totalVisited: 0, navigated: true };
      }
      const visitedFriends = /* @__PURE__ */ new Set();
      const processedPosts = /* @__PURE__ */ new WeakSet();
      let friendsVisited = 0;
      let likeCount = 0;
      let commentCount = 0;
      let currentFriendName = "";
      let profileActions = 0;
      let profileActionBudget = 0;
      let profileScrollFails = 0;
      while (this.isRunning && this.activeTask === "personal") {
        if (!chrome.runtime?.id) {
          console.warn("[FacebookInteraction] Extension context invalidated. Stopping.");
          this.isRunning = false;
          break;
        }
        const url = window.location.href;
        const dialogRes = await processOpenFbCommentDialog(generateCommentFn);
        if (dialogRes.done) {
          commentCount++;
          profileActions++;
          if (onProgressCallback) onProgressCallback({
            count: friendsVisited,
            likes: likeCount,
            comments: commentCount,
            author: currentFriendName,
            replyText: dialogRes.commentText
          });
          await randomDelay(2, 3.5);
          continue;
        }
        if (url.includes("facebook.com/friends")) {
          const friends = findFbFriendLinks();
          console.log("[FacebookInteraction] Friends terdeteksi:", friends.length);
          const next = friends.find((f) => !visitedFriends.has(fbNormalizeProfileUrl(f.url)));
          if (next) {
            const key = fbNormalizeProfileUrl(next.url);
            visitedFriends.add(key);
            currentFriendName = next.name;
            profileActions = 0;
            profileActionBudget = 2 + Math.floor(Math.random() * 4);
            profileScrollFails = 0;
            console.log(`[FacebookInteraction] Mengunjungi profil teman: ${next.name} (budget ${profileActionBudget} aksi)`);
            next.el.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(0.8, 1.5);
            fbClick(next.el, true);
            await randomDelay(4, 6);
            continue;
          }
          console.log("[FacebookInteraction] Semua teman yang terlihat sudah dikunjungi, scroll untuk memuat lebih...");
          window.scrollBy({ top: 900, behavior: "smooth" });
          await randomDelay(2, 3.5);
          continue;
        }
        if (!currentFriendName) {
          console.log("[FacebookInteraction] Berada di halaman yang bukan daftar teman, kembali ke /friends...");
          try {
            await chrome.storage.local.set({ fbAutoPersonalPending: true });
          } catch (e) {
          }
          window.location.href = "https://www.facebook.com/friends/";
          return { success: true, totalVisited: friendsVisited, navigated: true };
        }
        if (profileActionBudget > 0 && profileActions >= profileActionBudget) {
          friendsVisited++;
          console.log(`[FacebookInteraction] Selesai dengan ${currentFriendName}, kembali ke daftar teman...`);
          if (onProgressCallback) onProgressCallback({
            count: friendsVisited,
            likes: likeCount,
            comments: commentCount,
            author: currentFriendName,
            doneFriend: true
          });
          window.history.back();
          await randomDelay(4, 6);
          continue;
        }
        const posts = scanFbFeedPosts(20);
        const unprocessed = posts.filter((p) => !processedPosts.has(p.element));
        if (unprocessed.length > 0) {
          profileScrollFails = 0;
          const post = unprocessed[Math.floor(Math.random() * unprocessed.length)];
          processedPosts.add(post.element);
          const roll = Math.random();
          if (roll < 0.55 && post.likeBtn) {
            post.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(0.8, 1.5);
            const freshBtn = findFbLikeButton(post.element);
            if (freshBtn && !fbIsAlreadyLiked(post.element)) {
              await fbPerformReaction(freshBtn, "Suka");
              likeCount++;
              profileActions++;
              if (onProgressCallback) onProgressCallback({
                count: friendsVisited,
                likes: likeCount,
                comments: commentCount,
                author: currentFriendName
              });
            }
          } else if (roll < 0.82 && post.commentBtn) {
            post.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(0.8, 1.5);
            console.log("[FacebookInteraction] Membuka komentar untuk menyapa teman (AI)...");
            fbClick(post.commentBtn);
          } else {
            console.log("[FacebookInteraction] Postingan dilewati secara acak.");
          }
          await randomDelay(2.5, 4.5);
        } else {
          profileScrollFails++;
          window.scrollBy({ top: 700, behavior: "smooth" });
          await randomDelay(2.5, 4);
          if (profileScrollFails >= 3) {
            console.log("[FacebookInteraction] Tidak ada postingan baru di profil ini, pindah ke teman berikutnya...");
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
      this.activeTask = "story";
      let count = 0;
      console.log("[FacebookInteraction] Auto-View Story started...");
      if (!window.location.href.includes("facebook.com/stories")) {
        console.log("[FacebookInteraction] Navigating to https://www.facebook.com/stories/ ...");
        try {
          await chrome.storage.local.set({ fbAutoStoryPending: true });
        } catch (e) {
        }
        window.location.href = "https://www.facebook.com/stories/";
        return { success: true, totalProcessed: 0, navigated: true };
      }
      const isStoryCard = (el) => {
        const text = (el.textContent || "").trim();
        return /^(Cerita|Story)\s/.test(text);
      };
      const visibleCards = () => Array.from(document.querySelectorAll('div[role="button"], a[role="link"]')).filter((el) => fbIsVisible(el) && isStoryCard(el) && !!el.getAttribute("id"));
      let initialCards = visibleCards();
      for (let i = 0; initialCards.length === 0 && i < 10; i++) {
        await randomDelay(1, 1.5);
        initialCards = visibleCards();
      }
      console.log(`[FacebookInteraction] ${initialCards.length} story found.`);
      const processedIds = /* @__PURE__ */ new Set();
      if (initialCards.length > 0) {
        if (initialCards[0].getAttribute("id")) processedIds.add(initialCards[0].getAttribute("id"));
        fbClick(initialCards[0]);
        await randomDelay(3, 5);
      } else {
        const storyCard = document.querySelector('div[aria-label*="Cerita"][role="button"], div[role="button"][aria-label*="Story"]');
        if (storyCard) {
          fbClick(storyCard);
          await randomDelay(3, 5);
        }
      }
      while (this.isRunning && this.activeTask === "story") {
        try {
          count++;
          if (onProgressCallback) onProgressCallback({ count });
          await randomDelay(5, 8);
          const nextBtn = document.querySelector(
            '[aria-label="Cerita Berikutnya"][role="button"], [aria-label="Next story"][role="button"], [aria-label="Selanjutnya"][role="button"]'
          );
          if (nextBtn && fbIsVisible(nextBtn)) {
            fbClick(nextBtn);
            continue;
          }
          const cards = visibleCards().filter((c) => !processedIds.has(c.getAttribute("id")));
          const next = cards[0];
          if (next) {
            processedIds.add(next.getAttribute("id"));
            fbClick(next);
          } else {
            console.log("[FacebookInteraction] Semua cerita sudah dilihat, menghentikan.");
            break;
          }
        } catch (e) {
          console.warn("[FacebookInteraction] Auto-story error:", e);
          break;
        }
      }
      return { success: true, totalProcessed: count };
    }
  };

  // src/content/adapters/x_adapter.js
  var XAdapter = {
    name: "X (Twitter)",
    /**
     * Find tweet composer textbox
     */
    async getComposerInput() {
      let input = document.querySelector('div[data-testid="tweetTextarea_0"]') || document.querySelector('div[role="textbox"][aria-label*="Post text"]') || document.querySelector('div[role="textbox"][aria-label*="Tweet text"]') || document.querySelector('div[role="textbox"]');
      if (input) return input;
      const postSideBtn = document.querySelector('a[data-testid="SideNav_NewTweet_Button"]') || document.querySelector('button[aria-label="Post"]');
      if (postSideBtn) {
        postSideBtn.click();
        await randomDelay(1, 2);
        const res = await waitForElement([
          'div[data-testid="tweetTextarea_0"]',
          'div[role="textbox"]'
        ], 5e3).catch(() => null);
        return res ? res.element : null;
      }
      return null;
    },
    /**
     * Post tweet to X
     */
    async createPost(contentText, options = {}) {
      const input = await this.getComposerInput();
      if (!input) throw new Error("Input X / Twitter tidak ditemukan. Buka x.com dan pastikan Anda sudah login.");
      const typingSpeed = options.humanTypingSpeed || "medium";
      await simulateHumanTyping(input, contentText, typingSpeed);
      await randomDelay(1, 3);
      const container = input.closest('div[data-testid*="modal"]') || document;
      const postBtn = container.querySelector('button[data-testid="tweetButtonInline"]') || container.querySelector('button[data-testid="tweetButton"]') || Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === "Post" || b.textContent.trim() === "Reply");
      if (postBtn && !postBtn.disabled) {
        postBtn.click();
        await randomDelay(2, 4);
        return { success: true, message: "Berhasil memposting ke X (Twitter)!" };
      } else {
        return { success: true, message: "Konten terisi ke Tweet composer. Silakan klik Post." };
      }
    }
  };

  // src/content/adapters/x_interaction.js
  function xClick(el, skipScroll = false) {
    if (!el) return;
    if (!skipScroll) {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) {
      }
    }
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    ["pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 }));
    });
    try {
      el.click();
    } catch (e) {
    }
  }
  function findXReplyDialog() {
    return Array.from(document.querySelectorAll('div[role="dialog"]')).find((d) => {
      const rect = d.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return !!d.querySelector(
        'div[data-testid="tweetTextarea_0"], div[data-testid="tweetTextarea_0RichTextInputContainer"], div[role="textbox"][aria-label*="Post text"]'
      );
    }) || null;
  }
  function findXReplyInput(dialog) {
    const scope = dialog || document;
    return scope.querySelector('div[data-testid="tweetTextarea_0"]') || scope.querySelector('div[role="textbox"][aria-label*="Post text"]') || scope.querySelector('div[contenteditable="true"]') || null;
  }
  function findXReplySubmit(dialog) {
    if (dialog) {
      return dialog.querySelector('button[data-testid="tweetButton"]') || dialog.querySelector('button[data-testid="tweetButtonInline"]') || null;
    }
    const activeInput = document.querySelector('div[data-testid="tweetTextarea_0"]') || document.querySelector('div[role="textbox"][aria-label*="Post text"]');
    if (activeInput) {
      const container = activeInput.closest('[data-testid*="RichTextInputContainer"]') || activeInput.closest(".DraftEditor-root")?.parentElement?.parentElement || activeInput.closest("article") || document;
      const btn = container.querySelector('button[data-testid="tweetButtonInline"]') || container.querySelector('button[data-testid="tweetButton"]');
      if (btn) return btn;
    }
    return document.querySelector('button[data-testid="tweetButtonInline"]') || document.querySelector('button[data-testid="tweetButton"]') || null;
  }
  function scanXTweets(maxTweets = 30) {
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).slice(0, maxTweets);
    return articles.map((el, i) => {
      const likeBtn = el.querySelector('[data-testid="like"]') || el.querySelector('[aria-label*="Like"]');
      const unlikeBtn = el.querySelector('[data-testid="unlike"]') || el.querySelector('[aria-label*="Liked"]');
      const replyBtn = el.querySelector('[data-testid="reply"]');
      const retweetBtn = el.querySelector('[data-testid="retweet"]');
      const followBtn = el.querySelector('[data-testid*="-follow"]') || Array.from(el.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "Follow");
      const authorEl = el.querySelector('[data-testid="User-Name"]');
      const author = authorEl ? (authorEl.textContent || "").split("@")[0].trim() : "User";
      const textEl = el.querySelector('[data-testid="tweetText"]');
      const text = textEl ? (textEl.textContent || "").trim() : "";
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
  var XInteraction = {
    name: "XInteraction",
    isRunning: false,
    activeTask: null,
    async stop() {
      this.isRunning = false;
      this.activeTask = null;
      console.log("[XInteraction] Stopped.");
    },
    async startContinuousAutoLike(onProgressCallback) {
      if (this.isRunning) await this.stop();
      this.isRunning = true;
      this.activeTask = "like";
      let count = 0;
      const processed = /* @__PURE__ */ new WeakSet();
      while (this.isRunning && this.activeTask === "like") {
        const tweets = scanXTweets(40);
        const target = tweets.find((t) => t.likeBtn && !t.hasLiked && !processed.has(t.element));
        if (target) {
          processed.add(target.element);
          try {
            target.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(0.8, 1.5);
            xClick(target.likeBtn);
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: target.author });
            await randomDelay(2, 4);
          } catch (e) {
            console.warn("[XInteraction] Auto-like error:", e);
          }
        } else {
          window.scrollBy({ top: 700, behavior: "smooth" });
          await randomDelay(2, 3.5);
        }
      }
      return { success: true, totalProcessed: count };
    },
    async startContinuousAutoReply(onProgressCallback, generateReplyFn) {
      if (this.isRunning) await this.stop();
      this.isRunning = true;
      this.activeTask = "reply";
      let count = 0;
      const processedArticles = /* @__PURE__ */ new WeakSet();
      const processedUrls = /* @__PURE__ */ new Set();
      console.log("[XInteraction] Auto-Reply (Status Page Flow) started...");
      while (this.isRunning && this.activeTask === "reply") {
        if (!chrome.runtime?.id) {
          console.warn("[XInteraction] Extension context invalidated. Stopping.");
          this.isRunning = false;
          break;
        }
        const currentUrl = window.location.href;
        if (currentUrl.includes("/status/")) {
          console.log("[XInteraction] Detected status page:", currentUrl);
          const input = document.querySelector('div[data-testid="tweetTextarea_0"]') || document.querySelector('div[role="textbox"][aria-label*="Post text"]') || document.querySelector('div[contenteditable="true"]');
          const mainTweet = document.querySelector('article[data-testid="tweet"]');
          const tweetTextEl = mainTweet ? mainTweet.querySelector('[data-testid="tweetText"]') : null;
          const postText = tweetTextEl ? (tweetTextEl.textContent || "").trim() : "";
          const authorEl = mainTweet ? mainTweet.querySelector('[data-testid="User-Name"]') : null;
          const author = authorEl ? (authorEl.textContent || "").split("@")[0].trim() : "User";
          if (input && postText && !processedUrls.has(currentUrl)) {
            processedUrls.add(currentUrl);
            console.log("[XInteraction] Target tweet found on status page:", author, postText.slice(0, 60));
            let replyText = "";
            if (generateReplyFn) replyText = await generateReplyFn(postText);
            if (replyText) {
              try {
                xClick(input);
                input.focus();
                await randomDelay(0.4, 0.8);
                console.log("[XInteraction] Typing reply into status page composer...");
                await simulateHumanTyping(input, replyText, "medium");
                await randomDelay(1.2, 2);
                const currentTypedLen = (input.textContent || "").trim().length;
                const sendBtn = findXReplySubmit();
                if (sendBtn && currentTypedLen > 0) {
                  if (sendBtn.getAttribute("aria-disabled") === "true") {
                    sendBtn.removeAttribute("aria-disabled");
                  }
                  if (sendBtn.disabled) {
                    sendBtn.disabled = false;
                  }
                  console.log("[XInteraction] Executing click on Reply button...");
                  xClick(sendBtn, true);
                  try {
                    sendBtn.click();
                  } catch (e) {
                  }
                  count++;
                  if (onProgressCallback) onProgressCallback({ count, author, replyText });
                  console.log("[XInteraction] Tweet reply posted successfully! Waiting before navigating back...");
                  await randomDelay(4, 6);
                } else {
                  console.warn("[XInteraction] Could not locate valid submit button or text empty.");
                }
              } catch (e) {
                console.warn("[XInteraction] Error replying on status page:", e);
              }
            }
          }
          console.log("[XInteraction] Reloading https://x.com/home...");
          await randomDelay(1.5, 2.5);
          window.location.href = "https://x.com/home";
          return { success: true, totalProcessed: count };
        }
        if (window.scrollY < 200) {
          console.log("[XInteraction] Reloaded home timeline. Scrolling down first to reveal fresh tweets...");
          window.scrollBy({ top: 600, behavior: "smooth" });
          await randomDelay(2, 3.5);
        }
        const tweets = scanXTweets(40);
        let target = tweets.find((t) => {
          if (!t.text || t.text.length < 10) return false;
          if (processedArticles.has(t.element)) return false;
          const link = t.element.querySelector('a[href*="/status/"]');
          if (!link) return false;
          const href = link.getAttribute("href") || "";
          return !processedUrls.has(href);
        });
        console.log("[XInteraction] Timeline scan:", tweets.length, "tweets found,", target ? `target: ${target.author}` : "no target");
        if (target) {
          processedArticles.add(target.element);
          const link = target.element.querySelector('a[href*="/status/"]');
          const href = link ? link.getAttribute("href") : "";
          if (href) processedUrls.add(href);
          try {
            console.log("[XInteraction] Target found:", target.author, href);
            target.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1, 1.8);
            const targetUrl = href.startsWith("http") ? href : "https://x.com" + href;
            console.log("[XInteraction] Navigating directly to tweet status page:", targetUrl);
            window.location.href = targetUrl;
            return { success: true, totalProcessed: count };
          } catch (e) {
            console.warn("[XInteraction] Error navigating to status page:", e);
          }
        } else {
          console.log("[XInteraction] No target on current view, scrolling timeline down...");
          window.scrollBy({ top: 600, behavior: "smooth" });
          await randomDelay(2.5, 4);
        }
      }
      return { success: true, totalProcessed: count };
    },
    async startContinuousAutoRetweet(onProgressCallback) {
      if (this.isRunning) await this.stop();
      this.isRunning = true;
      this.activeTask = "retweet";
      let count = 0;
      const processed = /* @__PURE__ */ new WeakSet();
      while (this.isRunning && this.activeTask === "retweet") {
        const tweets = scanXTweets(40);
        const target = tweets.find((t) => t.retweetBtn && !processed.has(t.element));
        if (target) {
          processed.add(target.element);
          try {
            target.element.scrollIntoView({ behavior: "smooth", block: "center" });
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
            console.warn("[XInteraction] Auto-retweet error:", e);
          }
        } else {
          window.scrollBy({ top: 700, behavior: "smooth" });
          await randomDelay(2, 3.5);
        }
      }
      return { success: true, totalProcessed: count };
    },
    async startContinuousAutoFollow(onProgressCallback) {
      if (this.isRunning) await this.stop();
      this.isRunning = true;
      this.activeTask = "follow";
      let count = 0;
      const processed = /* @__PURE__ */ new WeakSet();
      while (this.isRunning && this.activeTask === "follow") {
        const tweets = scanXTweets(40);
        const target = tweets.find((t) => t.followBtn && !processed.has(t.element));
        if (target) {
          processed.add(target.element);
          try {
            target.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1, 2);
            xClick(target.followBtn);
            count++;
            if (onProgressCallback) onProgressCallback({ count, author: target.author });
            await randomDelay(3, 6);
          } catch (e) {
            console.warn("[XInteraction] Auto-follow error:", e);
          }
        } else {
          window.scrollBy({ top: 700, behavior: "smooth" });
          await randomDelay(2, 4);
        }
      }
      return { success: true, totalProcessed: count };
    },
    async startContinuousAutoQuote(onProgressCallback, generateReplyFn) {
      if (this.isRunning) await this.stop();
      this.isRunning = true;
      this.activeTask = "quote";
      let count = 0;
      const processedArticles = /* @__PURE__ */ new WeakSet();
      console.log("[XInteraction] Auto Quote Tweet started...");
      while (this.isRunning && this.activeTask === "quote") {
        if (!chrome.runtime?.id) {
          this.isRunning = false;
          break;
        }
        if (window.scrollY < 200) {
          window.scrollBy({ top: 600, behavior: "smooth" });
          await randomDelay(2, 3.5);
        }
        const tweets = scanXTweets(40);
        const target = tweets.find((t) => t.retweetBtn && t.text && t.text.length > 10 && !processedArticles.has(t.element));
        if (target) {
          processedArticles.add(target.element);
          try {
            target.element.scrollIntoView({ behavior: "smooth", block: "center" });
            await randomDelay(1, 1.8);
            xClick(target.retweetBtn);
            await randomDelay(1, 1.5);
            const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], a[role="menuitem"]'));
            const quoteOption = menuItems.find((el) => el.textContent.toLowerCase().includes("quote")) || menuItems[1];
            if (quoteOption) {
              xClick(quoteOption);
              await randomDelay(1.5, 2.5);
              const input = await new Promise((resolve) => {
                const check = setInterval(() => {
                  const dlg = findXReplyDialog();
                  if (dlg && findXReplyInput(dlg)) {
                    clearInterval(check);
                    resolve(findXReplyInput(dlg));
                  }
                }, 300);
                setTimeout(() => {
                  clearInterval(check);
                  resolve(null);
                }, 6e3);
              });
              if (input) {
                let quoteText = "";
                if (generateReplyFn) quoteText = await generateReplyFn(target.text);
                if (quoteText) {
                  xClick(input);
                  input.focus();
                  await randomDelay(0.4, 0.8);
                  await simulateHumanTyping(input, quoteText, "medium");
                  await randomDelay(1.2, 2);
                  const currentTypedLen = (input.textContent || "").trim().length;
                  const dlg = findXReplyDialog();
                  const sendBtn = dlg ? findXReplySubmit(dlg) : findXReplySubmit();
                  if (sendBtn && currentTypedLen > 0) {
                    if (sendBtn.getAttribute("aria-disabled") === "true") sendBtn.removeAttribute("aria-disabled");
                    if (sendBtn.disabled) sendBtn.disabled = false;
                    xClick(sendBtn, true);
                    try {
                      sendBtn.click();
                    } catch (e) {
                    }
                    count++;
                    if (onProgressCallback) onProgressCallback({ count, author: target.author, quoteText });
                    await randomDelay(4, 6);
                  }
                }
              }
            }
            console.log("[XInteraction] Reloading https://x.com/home after Quote...");
            window.location.href = "https://x.com/home";
            return { success: true, totalProcessed: count };
          } catch (e) {
            console.warn("[XInteraction] Error doing Quote Tweet:", e);
          }
        } else {
          window.scrollBy({ top: 600, behavior: "smooth" });
          await randomDelay(2.5, 4);
        }
      }
      return { success: true, totalProcessed: count };
    }
  };

  // src/content/injected_ui.js
  var InjectedUIWidget = class {
    constructor(platformName) {
      this.platform = platformName;
      this.activeInput = null;
      this.floatingBtn = null;
      this.selectedTone = "engaging";
    }
    init() {
      this.startObserver();
    }
    startObserver() {
      setInterval(() => {
        this.detectAndAttachWidget();
      }, 1500);
    }
    detectAndAttachWidget() {
      let selector = "";
      if (this.platform === "x") {
        selector = 'div[data-testid="tweetTextarea_0"], div[role="textbox"]';
      } else if (this.platform === "threads") {
        selector = 'div[contenteditable="true"][role="textbox"], div[data-lexical-editor="true"]';
      } else if (this.platform === "facebook") {
        selector = 'div[contenteditable="true"][role="textbox"], div[role="dialog"] div[contenteditable="true"]';
      }
      const inputs = document.querySelectorAll(selector);
      inputs.forEach((input) => {
        if (input.dataset.aiWidgetAttached) return;
        input.dataset.aiWidgetAttached = "true";
        this.attachButton(input);
      });
    }
    attachButton(targetInput) {
      const btn = document.createElement("div");
      btn.className = "ai-operator-floating-btn";
      btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"/>
      </svg>
      <span>\u2728 AI Assist</span>
    `;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.activeInput = targetInput;
        this.openPromptModal();
      });
      const composerRoot = targetInput.closest('div[role="dialog"]') || targetInput.closest("article") || targetInput.closest("form") || targetInput.parentElement;
      if (composerRoot) {
        if (getComputedStyle(composerRoot).position === "static") {
          composerRoot.style.position = "relative";
        }
        btn.style.position = "absolute";
        btn.style.right = "20px";
        btn.style.top = "52px";
        btn.style.zIndex = "99999";
        composerRoot.appendChild(btn);
      }
    }
    openPromptModal() {
      const existingModal = document.querySelector(".ai-operator-modal-overlay");
      if (existingModal) existingModal.remove();
      let existingText = "";
      if (this.activeInput) {
        existingText = (this.activeInput.value || this.activeInput.innerText || "").trim();
      }
      const overlay = document.createElement("div");
      overlay.className = "ai-operator-modal-overlay";
      overlay.innerHTML = `
      <div class="ai-operator-modal">
        <div class="ai-operator-modal-header">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"/>
            </svg>
            AI Content Assistant (${this.platform.toUpperCase()})
          </h3>
          <button class="ai-operator-modal-close">&times;</button>
        </div>
        <div class="ai-operator-modal-body">
          <label class="ai-operator-field-label">Topik, Ide Konten, atau Teks Draf</label>
          <input type="text" class="ai-operator-input" id="aiTopicInput" placeholder="Misal: 5 Tips Produktivitas Kerja Remote" value="${existingText ? existingText.replace(/"/g, "&quot;") : ""}" />

          <label class="ai-operator-field-label">Quick AI Actions</label>
          <div class="ai-operator-pills" style="margin-bottom:10px;">
            <button class="ai-operator-pill action-chip" data-action="rewrite">\u{1FA84} Polish & Rapikan Draf</button>
            <button class="ai-operator-pill action-chip" data-action="bullets">\u{1F9F5} Ubah ke Poin-Poin</button>
            <button class="ai-operator-pill action-chip" data-action="translate">\u{1F310} Terjemahkan Bahasa Inggris</button>
          </div>

          <label class="ai-operator-field-label">Pilih Tone Konten</label>
          <div class="ai-operator-pills">
            <button class="ai-operator-pill active tone-chip" data-tone="engaging">\u{1F525} Viral / Engaging</button>
            <button class="ai-operator-pill tone-chip" data-tone="professional">\u{1F4BC} Profesional</button>
            <button class="ai-operator-pill tone-chip" data-tone="casual">\u{1F60A} Santai / Storytelling</button>
            <button class="ai-operator-pill tone-chip" data-tone="humorous">\u{1F604} Lucu / Humor</button>
          </div>

          <button class="ai-operator-btn-generate" id="aiBtnSubmit">
            <span>Buat Konten AI & Isikan</span>
          </button>

          <div id="aiResultContainer" style="display:none;">
            <div class="ai-operator-result-box" id="aiResultBox"></div>
          </div>
        </div>
      </div>
    `;
      document.body.appendChild(overlay);
      const topicInput = overlay.querySelector("#aiTopicInput");
      const actionChips = overlay.querySelectorAll(".action-chip");
      actionChips.forEach((chip) => {
        chip.addEventListener("click", () => {
          const actionType = chip.dataset.action;
          const currentInputVal = topicInput.value.trim();
          if (actionType === "rewrite") {
            topicInput.value = currentInputVal ? `Polish & perbaiki draf ini agar lebih menarik: "${currentInputVal}"` : "Perbaiki draf postingan saya agar lebih profesional & rapi";
          } else if (actionType === "bullets") {
            topicInput.value = currentInputVal ? `Ubah teks ini jadi poin-poin thread menarik: "${currentInputVal}"` : "Buat ringkasan poin-poin singkat tentang topik ini";
          } else if (actionType === "translate") {
            topicInput.value = currentInputVal ? `Terjemahkan ke Bahasa Inggris gaya sosial media: "${currentInputVal}"` : "Terjemahkan pesan ini ke Bahasa Inggris";
          }
        });
      });
      overlay.querySelector(".ai-operator-modal-close").addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
      });
      const pills = overlay.querySelectorAll(".ai-operator-pill");
      pills.forEach((p) => {
        p.addEventListener("click", () => {
          pills.forEach((x) => x.classList.remove("active"));
          p.classList.add("active");
          this.selectedTone = p.dataset.tone;
        });
      });
      const submitBtn = overlay.querySelector("#aiBtnSubmit");
      topicInput.focus();
      submitBtn.addEventListener("click", async () => {
        const topic = topicInput.value.trim();
        if (!topic) {
          topicInput.style.borderColor = "#ef4444";
          return;
        }
        submitBtn.disabled = true;
        submitBtn.innerHTML = "<span>\u{1F916} Generating content...</span>";
        try {
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: "GENERATE_CONTENT",
              payload: {
                prompt: topic,
                platform: this.platform,
                tone: this.selectedTone
              }
            }, (res) => {
              if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
              if (!res || !res.success) return reject(res ? res.error : "Gagal menghasilkan konten");
              resolve(res.data);
            });
          });
          overlay.remove();
          if (this.activeInput) {
            await simulateHumanTyping(this.activeInput, response, "medium");
          }
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = "<span>Buat Konten AI & Isikan</span>";
          const resBox = overlay.querySelector("#aiResultBox");
          const resContainer = overlay.querySelector("#aiResultContainer");
          resContainer.style.display = "block";
          resBox.style.color = "#f87171";
          resBox.textContent = "Error: " + err.toString();
        }
      });
    }
  };

  // src/content/dom_inspector.js
  var KEYWORD_RE = /(like|unlike|suka|reply|balas|repost|kutip|rethread|follow|ikuti|post|posting|kirim|share|bagikan|new thread|utas baru)/i;
  var FACEBOOK_KEYWORD_RE = /(like|unlike|suka|reply|balas|repost|kutip|follow|ikuti|post|posting|kirim|share|bagikan|jadwalkan|schedule|publish|terbitkan)/i;
  function describeEl(el, maxText = 120) {
    if (!el) return null;
    const attrs = {};
    for (const attr of el.attributes) {
      const name = attr.name;
      if (name === "id" || name === "role" || name === "dir" || name === "contenteditable" || name === "aria-pressed" || name.startsWith("aria-") || name.startsWith("data-") || name === "title") {
        attrs[name] = attr.value;
      } else if (name === "class" && attr.value.length < 120) {
        attrs.class = attr.value;
      }
    }
    const text = (el.textContent || "").trim();
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
    document.querySelectorAll("[data-testid]").forEach((el) => {
      const id = el.getAttribute("data-testid");
      counts[id] = (counts[id] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, count]) => ({ testid: id, count }));
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
    return Array.from(document.querySelectorAll(selector)).slice(0, limit).map((el) => {
      const html = el.innerHTML || "";
      return {
        aria: el.getAttribute("aria-label") || "",
        placeholder: el.getAttribute("aria-placeholder") || "",
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
    )).filter((el) => {
      const meta = ((el.getAttribute && (el.getAttribute("placeholder") || "")) + " " + (el.getAttribute && (el.getAttribute("aria-label") || "")) + " " + (el.getAttribute && (el.getAttribute("aria-placeholder") || "")) + " " + (el.textContent || "").slice(0, 60)).toLowerCase();
      return /topik|komunitas|topic|community/.test(meta);
    });
    return els.slice(0, 10).map((el) => describeEl(el, 80));
  }
  var SCHEDULE_RE = /(schedule|scheduled|jadwal|jadwalkan|calendar|kalender|tanggal|date|time|clock|jam|pukul|posting hari ini|post today)/i;
  function collectScheduleControls(limit = 40) {
    const els = Array.from(document.querySelectorAll(
      'div[role="button"], button, input, [contenteditable="true"], [aria-label], [role="combobox"]'
    )).filter((el) => {
      const meta = ((el.getAttribute && (el.getAttribute("aria-label") || "")) + " " + (el.getAttribute && (el.getAttribute("placeholder") || "")) + " " + (el.textContent || "").slice(0, 80)).toLowerCase();
      return SCHEDULE_RE.test(meta);
    });
    return els.slice(0, limit).map((el) => describeEl(el, 80));
  }
  function collectOpenDialogs(limit = 3) {
    return Array.from(document.querySelectorAll('[role="dialog"], [role="menu"]')).filter((d) => {
      if (!d.isConnected) return false;
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).slice(0, limit).map((d) => ({
      ariaLabel: d.getAttribute("aria-label") || "",
      text: (d.textContent || "").slice(0, 300),
      buttons: Array.from(d.querySelectorAll('div[role="button"], button, input, [contenteditable="true"]')).slice(0, 30).map((el) => describeEl(el, 60))
    }));
  }
  function collectFacebookComposer() {
    const selectors = [
      `div[contenteditable="true"][aria-label*="What's on your mind"]`,
      'div[contenteditable="true"][aria-label*="Apa yang Anda pikirkan"]',
      'div[contenteditable="true"][aria-label*="Create a post"]',
      'div[contenteditable="true"][data-testid="post-composer-input"]',
      'div[contenteditable="true"][aria-label*="Tulis sesuatu"]',
      'div[role="dialog"] div[contenteditable="true"]',
      'div[data-testid="composer"] div[contenteditable="true"]'
    ];
    return collect(selectors.join(", "), 10);
  }
  function collectFacebookScheduleControls() {
    const els = Array.from(document.querySelectorAll(
      'div[role="button"], button, input, [contenteditable="true"], [aria-label], [role="combobox"], [data-testid]'
    )).filter((el) => {
      const meta = ((el.getAttribute && (el.getAttribute("aria-label") || "")) + " " + (el.getAttribute && (el.getAttribute("placeholder") || "")) + " " + (el.getAttribute && (el.getAttribute("data-testid") || "")) + " " + (el.textContent || "").slice(0, 80)).toLowerCase();
      return /schedule|jadwal|calendar|kalender|tanggal|date|time|clock|jam|pukul|posting hari ini|post today|publish|terbitkan/.test(meta);
    });
    return els.slice(0, 40).map((el) => describeEl(el, 80));
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
    )).filter((el) => {
      const meta = ((el.getAttribute && (el.getAttribute("aria-label") || "")) + " " + (el.getAttribute && (el.getAttribute("data-testid") || "")) + " " + (el.textContent || "").slice(0, 80)).toLowerCase();
      return FACEBOOK_KEYWORD_RE.test(meta);
    });
    return els.slice(0, 40).map((el) => describeEl(el, 60));
  }
  function dumpDomStructure(platform = "unknown") {
    const host = window.location.hostname;
    let detected = "";
    if (host.includes("facebook.com") || host.includes("fbcdn.net")) detected = "facebook";
    else if (host.includes("x.com") || host.includes("twitter.com")) detected = "x";
    else if (host.includes("threads.net") || host.includes("threads.com")) detected = "threads";
    const effectivePlatform = detected || platform || "unknown";
    const isFacebook = effectivePlatform === "facebook" || host.includes("facebook.com") || host.includes("fbcdn.net");
    const report = {
      platform: effectivePlatform,
      url: window.location.href,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
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
        const scope = input.closest('div[role="dialog"]') || input.closest('div[class*="x78zum5"]') || document;
        return Array.from(scope.querySelectorAll('div[role="button"], button')).slice(0, 40).map((el) => describeEl(el, 60));
      })(),
      actionButtons: collect('button, [role="button"], span[role="button"], [aria-label]', 40).filter(
        (d) => d && (KEYWORD_RE.test(d.text) || Object.values(d.attrs).some((v) => typeof v === "string" && KEYWORD_RE.test(v)))
      ),
      postContainers: collect(
        'article, [role="article"], [data-pressable-container], [data-testid*="post" i], [data-testid*="tweet" i], [data-testid*="feed" i], [data-testid*="Feed"]',
        5
      ),
      dataTestIdInventory: uniqueTestIds(),
      ...isFacebook ? {
        facebookComposer: collectFacebookComposer(),
        facebookScheduleControls: collectFacebookScheduleControls(),
        facebookPostContainers: collectFacebookPostContainers(),
        facebookActionButtons: collectFacebookActionButtons()
      } : {}
    };
    const json = JSON.stringify(report, null, 2);
    console.log("[AI Operator] === DOM STRUCTURE DUMP ===");
    console.log(json);
    console.log("[AI Operator] =========================");
    try {
      navigator.clipboard.writeText(json).then(() => {
        console.log("[AI Operator] DOM dump disalin ke clipboard. Tempel di chat untuk verifikasi selector.");
      }).catch(() => {
      });
    } catch (e) {
    }
    return report;
  }

  // src/content/content_main.js
  function cleanAiResponseText(rawText) {
    if (!rawText) return "";
    let cleaned = rawText.trim();
    cleaned = cleaned.replace(/^TOPIC LABEL:\s*.+$/im, "").trim();
    cleaned = cleaned.replace(/^===VARIANT\s*\d+===/im, "").trim();
    cleaned = cleaned.replace(/^===(IMAGE|POLL)===.+$/im, "").trim();
    cleaned = cleaned.replace(/<[^>]*>/g, "").trim();
    return cleaned;
  }
  var ContentScriptController = class {
    constructor() {
      this.hostname = window.location.hostname;
      this.adapter = null;
      this.platformKey = "";
      this.widget = null;
      this.interaction = null;
    }
    init() {
      if (this.hostname.includes("threads.net") || this.hostname.includes("threads.com")) {
        this.platformKey = "threads";
        this.adapter = ThreadsAdapter;
        this.interaction = ThreadsInteraction;
      } else if (this.hostname.includes("facebook.com")) {
        this.platformKey = "facebook";
        this.adapter = FacebookAdapter;
        this.interaction = FacebookInteraction;
      } else if (this.hostname.includes("x.com") || this.hostname.includes("twitter.com")) {
        this.platformKey = "x";
        this.adapter = XAdapter;
        this.interaction = XInteraction;
      } else {
        return;
      }
      console.log(`[AI Social Media Operator] Initialized on ${this.adapter.name}`);
      this.widget = new InjectedUIWidget(this.platformKey);
      this.widget.init();
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleBackgroundMessage(message, sendResponse);
        return true;
      });
      window.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey && (e.key === "D" || e.key === "d")) {
          e.preventDefault();
          dumpDomStructure(this.platformKey);
        }
      });
      if (this.platformKey === "threads") {
        chrome.storage.local.remove("autoReplyRunning");
      }
      if (this.platformKey === "x") {
        const activeReplyMode = sessionStorage.getItem("xAutoLoopMode");
        if (activeReplyMode === "reply") {
          console.log("[AI Social Media Operator] Resuming X Auto AI-Reply after reload...");
          setTimeout(() => {
            this._startXAutoReply();
          }, 1500);
        } else if (activeReplyMode === "quote") {
          console.log("[AI Social Media Operator] Resuming X Auto Quote Tweet after reload...");
          setTimeout(() => {
            this._startXAutoQuote();
          }, 1500);
        } else {
          chrome.storage.local.remove(["xAutoReplyPending", "xAutoQuotePending"]);
        }
      }
      if (this.platformKey === "facebook" && window.location.href.includes("facebook.com/stories")) {
        chrome.storage.local.get("fbAutoStoryPending", (res) => {
          if (res.fbAutoStoryPending) {
            chrome.storage.local.remove("fbAutoStoryPending");
            this._startFbAutoStory();
          }
        });
      }
      if (this.platformKey === "facebook" && window.location.href.includes("facebook.com/friends")) {
        chrome.storage.local.get("fbAutoPersonalPending", (res) => {
          if (res.fbAutoPersonalPending) {
            chrome.storage.local.remove("fbAutoPersonalPending");
            this._startFbAutoPersonal();
          }
        });
      }
    }
    async handleBackgroundMessage(message, sendResponse) {
      const { action, payload } = message;
      if (action === "EXECUTE_AUTO_POST") {
        try {
          const result = await this.adapter.createPost(payload.content, payload.options);
          sendResponse({ success: true, result });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else if (action === "DEBUG_DUMP_DOM") {
        try {
          const report = dumpDomStructure(this.platformKey);
          sendResponse({ success: true, result: report });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else if (action === "EXECUTE_INTERACTION") {
        try {
          const { type, options } = payload;
          if (type === "debug_dom") {
            const platform = options?.platform || this.platformKey;
            sendResponse({ success: true, result: dumpDomStructure(platform) });
            return;
          }
          if (!this.interaction) throw new Error("Fitur interaksi tidak tersedia di platform ini.");
          switch (type) {
            // ── Threads ──
            case "start_auto_like":
              this.interaction.startContinuousAutoLike((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "like", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "Continuous Auto-Like dimulai." });
              break;
            case "start_auto_reply": {
              this._startAutoReply();
              sendResponse({ success: true, message: "Continuous Auto AI-Reply dimulai." });
              break;
            }
            case "start_auto_repost":
              this.interaction.startContinuousAutoRepost((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "repost", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "Continuous Auto-Repost dimulai." });
              break;
            case "start_auto_follow":
              this.interaction.startContinuousAutoFollow((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "follow", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "Continuous Auto-Follow dimulai." });
              break;
            // ── Facebook ──
            case "start_fb_auto_like":
              this.interaction.startContinuousAutoLike((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "fb_like", progress } }).catch(() => {
                });
              }, options).catch(console.error);
              sendResponse({ success: true, message: "FB Auto-Like dimulai." });
              break;
            case "start_fb_auto_comment":
              this._startFbAutoComment();
              sendResponse({ success: true, message: "FB Auto AI-Comment dimulai." });
              break;
            case "start_fb_auto_share":
              this.interaction.startContinuousAutoShare((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "fb_share", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "FB Auto-Share dimulai." });
              break;
            case "start_fb_auto_follow":
              this.interaction.startContinuousAutoFollow((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "fb_follow", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "FB Auto-Follow dimulai." });
              break;
            case "start_fb_auto_story":
              this.interaction.startContinuousAutoStory((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "fb_story", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "FB Auto-View Story dimulai." });
              break;
            case "start_fb_auto_personal":
              this._startFbAutoPersonal();
              sendResponse({ success: true, message: "FB Auto-Interaksi Personal dimulai." });
              break;
            // ── X / Twitter ──
            case "start_x_auto_like":
              this.interaction.startContinuousAutoLike((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "x_like", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "X Auto-Like dimulai." });
              break;
            case "start_x_auto_reply":
              this._startXAutoReply();
              sendResponse({ success: true, message: "X Auto AI-Reply dimulai." });
              break;
            case "start_x_auto_quote":
              this._startXAutoQuote();
              sendResponse({ success: true, message: "X Auto AI-Quote Tweet dimulai." });
              break;
            case "start_x_auto_retweet":
              this.interaction.startContinuousAutoRetweet((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "x_retweet", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "X Auto-Retweet dimulai." });
              break;
            case "start_x_auto_follow":
              this.interaction.startContinuousAutoFollow((progress) => {
                chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "x_follow", progress } }).catch(() => {
                });
              }).catch(console.error);
              sendResponse({ success: true, message: "X Auto-Follow dimulai." });
              break;
            // ── Global Stop Commands ──
            case "stop_auto_like":
            case "stop_auto_reply":
            case "stop_auto_repost":
            case "stop_auto_follow":
            case "stop_fb_auto_like":
            case "stop_fb_auto_comment":
            case "stop_fb_auto_share":
            case "stop_fb_auto_follow":
            case "stop_fb_auto_story":
            case "stop_fb_auto_personal":
            case "stop_x_auto_like":
            case "stop_x_auto_reply":
            case "stop_x_auto_quote":
            case "stop_x_auto_retweet":
            case "stop_x_auto_follow":
            case "stop_all":
              this.interaction.stop();
              sessionStorage.removeItem("xAutoLoopMode");
              chrome.storage.local.remove(["autoReplyRunning", "fbAutoStoryPending", "fbAutoPersonalPending", "xAutoReplyPending", "xAutoQuotePending"]);
              sendResponse({ success: true, message: "Interaksi dihentikan." });
              break;
            case "reply_post": {
              const replyText = options?.replyText || "";
              const res = await this.interaction.replyToFirstPost(replyText);
              sendResponse({ success: true, result: res });
              break;
            }
            default:
              throw new Error(`Tipe interaksi tidak dikenal: ${type}`);
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      }
    }
    /**
     * Build the AI reply generator and start the continuous auto-reply loop
     */
    _startThreadsAutoReply() {
      const generateAIReplyHelper = async (postText) => {
        return new Promise((resolve) => {
          const prompt = `ISI POSTINGAN THREADS TARGET:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 balasan yang santai, relevan dan spesifik mengomentari postingan di atas.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam isi postingan target di atas. Tulis balasan Anda dalam BAHASA YANG SAMA PERSIS dengan postingan target (misalnya: jika postingan berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; jika Spanyol/Jepang/dll, jawab dalam bahasa tersebut). Gunakan gaya bahasa alami yang pas untuk bahasa target.
Tanpa hashtag. Berikan teks balasan saja.`;
          chrome.runtime.sendMessage({
            action: "GENERATE_CONTENT",
            payload: { prompt, platform: "threads", tone: "casual" }
          }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success) {
              resolve("");
            } else {
              resolve(cleanAiResponseText(res.data));
            }
          });
        });
      };
      this.interaction.startContinuousAutoReply((progress) => {
        chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "reply", progress } }).catch(() => {
        });
      }, generateAIReplyHelper).catch(console.error);
    }
    _startFbAutoComment() {
      const generateFBCommentHelper = async (postText) => {
        return new Promise((resolve) => {
          const prompt = `ISI POSTINGAN FACEBOOK TARGET:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 komentar Facebook yang santai, relevan dan spesifik mengomentari postingan di atas.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam isi postingan target di atas. Tulis komentar Anda dalam BAHASA YANG SAMA PERSIS dengan postingan target (misalnya: jika postingan berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; jika Spanyol/Jepang/dll, jawab dalam bahasa tersebut).
1 kalimat saja, tanpa hashtag. Berikan teks komentar saja.`;
          chrome.runtime.sendMessage({
            action: "GENERATE_CONTENT",
            payload: { prompt, platform: "facebook", tone: "casual" }
          }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success) {
              resolve("");
            } else {
              resolve(cleanAiResponseText(res.data));
            }
          });
        });
      };
      this.interaction.startContinuousAutoComment((progress) => {
        chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "fb_comment", progress } }).catch(() => {
        });
      }, generateFBCommentHelper).catch(console.error);
    }
    _startFbAutoStory() {
      this.interaction.startContinuousAutoStory((progress) => {
        chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "fb_story", progress } }).catch(() => {
        });
      }).catch(console.error);
    }
    _startFbAutoPersonal() {
      const generateFbPersonalComment = async (postText) => {
        return new Promise((resolve) => {
          const prompt = `ISI POSTINGAN TEMAN DI FACEBOOK:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 komentar untuk teman Anda di Facebook yang santai, hangat, spesifik dan relevan mengomentari isi postingan di atas.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam isi postingan teman di atas. Tulis komentar Anda dalam BAHASA YANG SAMA PERSIS dengan postingan teman tersebut (misalnya: jika postingan berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; dst.).
1 kalimat saja, tanpa hashtag. Berikan teks komentar saja.`;
          chrome.runtime.sendMessage({
            action: "GENERATE_CONTENT",
            payload: { prompt, platform: "facebook", tone: "casual" }
          }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success) {
              resolve("");
            } else {
              resolve(cleanAiResponseText(res.data));
            }
          });
        });
      };
      this.interaction.startContinuousAutoPersonalInteraction((progress) => {
        chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "fb_personal", progress } }).catch(() => {
        });
      }, generateFbPersonalComment).catch(console.error);
    }
    _startXAutoReply() {
      sessionStorage.setItem("xAutoLoopMode", "reply");
      chrome.storage.local.set({ xAutoReplyPending: true, xAutoQuotePending: false });
      const generateXReplyHelper = async (postText) => {
        return new Promise((resolve) => {
          const prompt = `ISI TWEET TARGET:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 balasan tweet (maksimal 200 karakter) yang relevan, punchy, dan alami.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam ISI TWEET TARGET di atas. Tulis balasan Anda dalam BAHASA YANG SAMA PERSIS dengan tweet target (misalnya: jika tweet berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; jika Jepang, jawab bahasa Jepang, dst.). Gunakan gaya bahasa dan slang lokal yang pas.
Tanpa hashtag. Berikan teks balasan saja.`;
          chrome.runtime.sendMessage({
            action: "GENERATE_CONTENT",
            payload: { prompt, platform: "x", tone: "casual" }
          }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success) {
              resolve("");
            } else {
              resolve(cleanAiResponseText(res.data));
            }
          });
        });
      };
      this.interaction.startContinuousAutoReply((progress) => {
        chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "x_reply", progress } }).catch(() => {
        });
      }, generateXReplyHelper).catch(console.error);
    }
    _startXAutoQuote() {
      sessionStorage.setItem("xAutoLoopMode", "quote");
      chrome.storage.local.set({ xAutoQuotePending: true, xAutoReplyPending: false });
      const generateXQuoteHelper = async (postText) => {
        return new Promise((resolve) => {
          const prompt = `ISI TWEET TARGET:
"${postText.slice(0, 700)}"

TUGAS:
Tulis 1 komentar kutipan (quote tweet, maksimal 200 karakter) yang relevan, punchy, dan cerdas.
ATURAN BAHASA (MANDATORY & PENTING):
Deteksi secara otomatis bahasa yang digunakan dalam ISI TWEET TARGET di atas. Tulis komentar Anda dalam BAHASA YANG SAMA PERSIS dengan tweet target (misalnya: jika tweet berbahasa Inggris, jawab sepenuhnya dalam bahasa Inggris; jika Indonesia, jawab bahasa Indonesia; jika Spanyol, jawab bahasa Spanyol, dst.).
Tanpa hashtag. Berikan teks balasan saja.`;
          chrome.runtime.sendMessage({
            action: "GENERATE_CONTENT",
            payload: { prompt, platform: "x", tone: "casual" }
          }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success) {
              resolve("");
            } else {
              resolve(cleanAiResponseText(res.data));
            }
          });
        });
      };
      this.interaction.startContinuousAutoQuote((progress) => {
        chrome.runtime.sendMessage({ action: "INTERACTION_PROGRESS", payload: { type: "x_quote", progress } }).catch(() => {
        });
      }, generateXQuoteHelper).catch(console.error);
    }
  };
  var controller = new ContentScriptController();
  controller.init();
})();
