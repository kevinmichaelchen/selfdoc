/**
 * Reader annotations are browser-state, not document-state: they live in
 * localStorage so they work in the exported single-file HTML too. Each block's
 * entry holds comments (`c`) and one-tap reactions (`r`). Blocks are keyed by
 * a hash of their text — stable across offset shifts from edits elsewhere,
 * orphaned if the annotated block itself is rewritten.
 */
export function blockKey(el) {
  const text = el.textContent.trim().slice(0, 120);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// Namespaced per doc: file:// pages can share one storage bucket.
const storageKey = (slug) => `selfdoc:${slug}:comments`;
const gradeKey = (slug) => `selfdoc:${slug}:grade`;

const normalize = (entry) =>
  Array.isArray(entry)
    ? { c: entry, r: {} }
    : { c: entry?.c ?? [], r: entry?.r ?? {} };

export const isAnnotated = (entry) =>
  Boolean(entry && (entry.c.length > 0 || Object.values(entry.r).some(Boolean)));

export function loadAnnotations(slug) {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(storageKey(slug)) ?? '{}');
  } catch {
    raw = {};
  }
  return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, normalize(entry)]));
}

export function saveAnnotations(slug, map) {
  const pruned = Object.fromEntries(
    Object.entries(map).filter(([, entry]) => isAnnotated(entry)),
  );
  localStorage.setItem(storageKey(slug), JSON.stringify(pruned));
}

export const loadGrade = (slug) => localStorage.getItem(gradeKey(slug)) ?? '';

/** Pseudo-key for feedback on the document as a whole. */
export const DOC_KEY = '__doc__';

export function unwrapQuoteMarks() {
  document.querySelectorAll('mark.annot').forEach((mark) => {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  });
}

/**
 * Highlight a quoted phrase inside its block. Quotes anchor by text match, so
 * they survive edits elsewhere and vanish (with their comments) when the
 * quoted text is rewritten — the same rule as block annotations.
 */
export function wrapQuote(el, quote) {
  const idx = el.textContent.indexOf(quote);
  if (idx < 0) return;
  const endIdx = idx + quote.length;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode;
  let startOffset = 0;
  let endNode;
  let endOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = pos + node.data.length;
    if (!startNode && next > idx) {
      startNode = node;
      startOffset = idx - pos;
    }
    if (next >= endIdx) {
      endNode = node;
      endOffset = endIdx - pos;
      break;
    }
    pos = next;
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const mark = document.createElement('mark');
  mark.className = 'annot';
  try {
    range.surroundContents(mark);
  } catch {
    // The quote crosses an inline-element boundary (e.g. spans a link);
    // skip the highlight — the comment still lists the quote.
  }
}

export function saveGrade(slug, grade) {
  if (grade) localStorage.setItem(gradeKey(slug), grade);
  else localStorage.removeItem(gradeKey(slug));
}
