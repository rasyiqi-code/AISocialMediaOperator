/**
 * Shared text utilities for AI Social Media Operator
 */

/**
 * Split long text into thread parts under maxChars each.
 * Splits per line (handles AI numbered sections "1. ...\n2. ..." that have no
 * blank lines and often no sentence-ending punctuation, which broke the old
 * sentence-based splitter into producing a single oversized part).
 */
export function splitIntoThreadParts(text, maxChars = 450) {
  if (!text || text.length <= maxChars) return [cleanNumberedLine(text)];

  const lines = text.split(/\r?\n/).map(l => cleanNumberedLine(l.trim())).filter(Boolean);
  const parts = [];
  let current = '';

  const appendToCurrent = (chunk) => {
    if (current) {
      if ((current + '\n\n' + chunk).trim().length <= maxChars) {
        current = current + '\n\n' + chunk;
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

    // Hard-wrap an oversized line by words (last resort)
    const words = line.split(/\s+/);
    let buf = '';
    for (const w of words) {
      if ((buf + ' ' + w).trim().length > maxChars) {
        if (buf.trim()) appendToCurrent(buf.trim());
        buf = w;
      } else {
        buf = buf ? buf + ' ' + w : w;
      }
    }
    if (buf.trim()) appendToCurrent(buf.trim());
  };

  for (const line of lines) pushLine(line);
  if (current.trim()) parts.push(current.trim());

  return parts.length > 0 ? parts : [cleanNumberedLine(text)];
}

/**
 * Strip AI auto-numbering prefixes ("1. ", "2/ ", "3) ") left at the start of a
 * section line so they don't appear in the published post text.
 */
function cleanNumberedLine(line) {
  return (line || '').replace(/^\d+[\.\)\/]\s+/, '').trim();
}
