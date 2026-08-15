/**
 * Reader comments are browser-state, not document-state: they live in
 * localStorage so they work in the exported single-file HTML too. Blocks are
 * keyed by a hash of their text — stable across offset shifts from edits
 * elsewhere, orphaned if the commented block itself is rewritten.
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

export function loadComments(slug) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(slug)) ?? '{}');
  } catch {
    return {};
  }
}

export function saveComments(slug, map) {
  localStorage.setItem(storageKey(slug), JSON.stringify(map));
}
