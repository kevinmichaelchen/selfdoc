/**
 * Single-letter hotkeys with the tri-state rule (borrowed from TanStack
 * Hotkeys): plain letters never fire from editable regions — inputs,
 * textareas, selects, contentEditable blocks mid-edit — while Escape fires
 * everywhere. Modifier chords are left to the browser.
 */
const inEditable = (target) =>
  target.isContentEditable ||
  Boolean(target.closest?.('input, textarea, select, [contenteditable="true"]'));

export function onHotkeys(bindings) {
  const handler = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const fn = bindings[event.key];
    if (!fn) return;
    if (event.key !== 'Escape' && inEditable(event.target)) return;
    event.preventDefault();
    fn(event);
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
