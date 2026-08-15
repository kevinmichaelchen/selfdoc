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

export function saveGrade(slug, grade) {
  if (grade) localStorage.setItem(gradeKey(slug), grade);
  else localStorage.removeItem(gradeKey(slug));
}
