/**
 * General-purpose DOM helpers shared across ALL platform adapters
 * (Threads, Facebook, X, ...). Keep platform-specific logic OUT of this file;
 * each platform lives in its own adapter (threads_adapter.js, facebook_adapter.js, ...).
 */

import { randomDelay } from '../../utils/dom_helpers.js';

export const GeneralHelpers = {
  MONTHS_ID: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],

  /**
   * Click an element using React-safe mouse events.
   */
  clickElement(el) {
    if (!el) return false;
    try { el.scrollIntoView?.({ block: 'center' }); } catch (e) {}
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
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
      const t = (el.textContent || '').trim();
      if (t && t.length <= limit && regex.test(t)) return el;
    }
    return null;
  },

  /**
   * First currently-visible dialog/menu matching a predicate.
   */
  findVisibleDialog(predicate) {
    return Array.from(document.querySelectorAll('[role="dialog"], [role="menu"]'))
      .filter(d => {
        const r = d.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && d.offsetParent !== null;
      })
      .find(predicate) || null;
  },

  /**
   * Default calendar-dialog detector: a visible dialog containing the weekday
   * column headers (Min..Sab) and a 4-digit year.
   */
  isCalendarDialog(d) {
    const txt = (d.textContent || '');
    return txt.includes('Min') && txt.includes('Sab') && /202\d/.test(txt);
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
      tag = 'Helper'
    } = config;
    const scope = composerRoot || document;

    // 1) Direct schedule chip (e.g. Threads "Posting hari ini pukul 17.00 WIB")
    if (chipRegex) {
      const chip = this.findByText(scope, chipRegex, 50);
      if (chip) {
        this.clickElement(chip);
        await randomDelay(1, 1.4);
        return this.findScheduleDialog(dialogCheck);
      }
    }

    // 2) Overflow menu ("Lainnya") -> "Jadwalkan..."
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
      tag = 'Helper'
    } = config;

    const dialog = await this.openScheduleDialog(config);
    if (!dialog) {
      console.warn(`[${tag}] Dialog jadwal tidak ditemukan — cek tombol schedule / menu "Lainnya" → "Jadwalkan..."`);
      return false;
    }
    this.logScheduleDialog(dialog, tag);

    await this.navigateToMonth(dialog, targetTime);
    const dayOk = this.clickDayCell(dialog, targetTime);
    const timeOk = await this.setTime(dialog, targetTime, timeInputCheck);
    console.log(`[${tag}] Jadwal: tanggal`, dayOk ? 'OK' : 'GAGAL', '| waktu', timeOk ? 'OK' : 'GAGAL');

    const selesai = this.findByText(dialog, /^selesai$/i, 20);
    if (selesai) this.clickElement(selesai);
    await randomDelay(0.8, 1.2);

    // Final confirm in composer: first matching confirm button
    const scope = composerRoot || document;
    const confirmBtn = confirmRegexes.reduce((acc, r) => acc || this.findByText(scope, r, 20), null);
    if (confirmBtn) this.clickElement(confirmBtn);
    await randomDelay(1, 1.5);
    console.log(`[${tag}] Konfirmasi jadwal:`, confirmBtn ? `klik "${confirmBtn.textContent.trim()}"` : 'tombol konfirmasi tidak ditemukan');
    return !!confirmBtn;
  },

  /**
   * Click prev/next month buttons until the calendar shows targetTime's month.
   */
  async navigateToMonth(dialog, targetTime) {
    const targetLabel = `${this.MONTHS_ID[targetTime.getMonth()]} ${targetTime.getFullYear()}`;
    for (let i = 0; i < 24; i++) {
      if ((dialog.textContent || '').includes(targetLabel)) return true;
      const m = (dialog.textContent || '').match(/([A-Za-z]+)\s+(\d{4})/);
      if (!m) return false;
      const curIdx = this.MONTHS_ID.findIndex(name => name.toLowerCase() === m[1].toLowerCase());
      const curYear = parseInt(m[2], 10);
      if (curIdx === -1 || isNaN(curYear)) return false;
      const curTotal = curYear * 12 + curIdx;
      const targetTotal = targetTime.getFullYear() * 12 + targetTime.getMonth();
      const btn = curTotal < targetTotal
        ? dialog.querySelector('button[aria-label="Bulan Berikutnya"], button[aria-label*="Bulan Berikutnya"]')
        : dialog.querySelector('button[aria-label="Bulan Sebelumnya"], button[aria-label*="Bulan Sebelumnya"]');
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

    // 1) aria-label with full date, e.g. "Kamis, 6 Agustus 2026"
    for (const c of candidates) {
      const aria = (c.getAttribute('aria-label') || '');
      if (aria && aria.includes(` ${d} `) && aria.includes(monthName) && aria.includes(yearStr)) {
        this.clickElement(c);
        return true;
      }
    }

    // 2) text date cells, e.g. "Kamis, 6 Agustus 20266" / "Sabtu, 01 Agustus 20261"
    const dayMatch = new RegExp('(\\d{1,2})\\s+' + monthName + '\\s+' + yearStr);
    for (const c of candidates) {
      const t = (c.textContent || '');
      const m = t.match(dayMatch);
      if (m && parseInt(m[1], 10) === d) {
        this.clickElement(c);
        return true;
      }
    }

    // 3) bare day number, restricted to the calendar grid
    const grid = dialog.querySelector('[role="grid"]');
    const scope = grid || dialog;
    for (const c of Array.from(scope.querySelectorAll('[role="gridcell"], td, div'))) {
      const t = (c.textContent || '').trim();
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
    const hh = String(targetTime.getHours()).padStart(2, '0');
    const mm = String(targetTime.getMinutes()).padStart(2, '0');

    // 1) native time input
    let input = dialog.querySelector('input[type="time"]');
    if (input) { this.setNativeValue(input, `${hh}:${mm}`); await randomDelay(0.4, 0.8); return true; }

    // 2) separate hour / minute text inputs (placeholder "hh" / "mm")
    const inputs = Array.from(dialog.querySelectorAll('input'));
    const hhInput = inputs.find(i => /^hh$/i.test((i.placeholder || '').trim()));
    const mmInput = inputs.find(i => /^mm$/i.test((i.placeholder || '').trim()));
    if (hhInput && mmInput) {
      this.setNativeValue(hhInput, hh);
      await randomDelay(0.2, 0.4);
      this.setNativeValue(mmInput, mm);
      await randomDelay(0.4, 0.8);
      return true;
    }

    // 3) generic heuristics
    input = inputs.find(i => {
      if (timeInputCheck && timeInputCheck(i)) return true;
      const aria = (i.getAttribute('aria-label') || '').toLowerCase();
      return /waktu|jam|pukul|time/.test(aria) || /^\d{1,2}[:.]\d{2}/.test(i.value || '') || /jam/i.test(i.placeholder || '');
    }) || null;
    if (!input) return false;
    this.setNativeValue(input, `${hh}:${mm}`);
    await randomDelay(0.4, 0.8);
    return true;
  },

  setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },

  /**
   * Compact dump of the schedule dialog for diagnosing selector failures.
   */
  logScheduleDialog(dialog, tag = 'Helper') {
    try {
      const info = {
        monthHeader: (dialog.textContent || '').match(/([A-Za-z]+)\s+\d{4}/)?.[0] || '',
        inputs: Array.from(dialog.querySelectorAll('input')).map(i => ({
          type: i.type,
          placeholder: i.placeholder,
          value: i.value,
          ariaLabel: i.getAttribute('aria-label') || ''
        })),
        buttons: Array.from(dialog.querySelectorAll('div[role="button"], button'))
          .map(b => ({ text: (b.textContent || '').trim().slice(0, 30), aria: b.getAttribute('aria-label') || '' }))
          .filter(x => x.text || x.aria)
          .slice(0, 40),
        gridCells: (() => {
          const g = dialog.querySelector('[role="grid"]');
          if (!g) return [];
          return Array.from(g.querySelectorAll('[role="gridcell"], [role="button"], td'))
            .slice(0, 15)
            .map(c => ({ aria: c.getAttribute('aria-label') || '', text: (c.textContent || '').trim() }));
        })()
      };
      console.log(`[${tag}] === DIALOG JADWAL ===`);
      console.log(JSON.stringify(info, null, 2));
      console.log(`[${tag}] ====================`);
    } catch (e) { /* noop */ }
  }
};
