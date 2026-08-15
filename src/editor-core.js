import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// remark-gfm renders a citation as <sup><a data-footnote-ref href="#...-fn-id">.
// Without this rule a round-trip would flatten it into a broken regular link.
turndown.addRule('footnoteRef', {
  filter: (node) =>
    node.nodeName === 'A' && node.getAttribute('data-footnote-ref') != null,
  replacement: (_content, node) => {
    const id = /fn-(.+)$/.exec(node.getAttribute('href') ?? '');
    return `[^${id ? decodeURIComponent(id[1]) : node.textContent.trim()}]`;
  },
});

/**
 * Escape MDX-significant characters ({ and <) outside code spans and fences,
 * so a stray brace typed into a paragraph can't break the compile.
 */
function escapeMdx(markdown) {
  return markdown
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((segment, i) =>
      i % 2 ? segment : segment.replace(/[{<]/g, (ch) => `\\${ch}`),
    )
    .join('');
}

export function blockToMarkdown(el) {
  const clone = el.cloneNode(true);
  clone.removeAttribute('contenteditable');
  const markdown = escapeMdx(turndown.turndown(clone.outerHTML));
  // turndown escapes literal brackets, which would neuter a hand-typed
  // citation like [^ref]; restore those so new refs can be typed inline.
  return markdown.replace(/\\\[\^/g, '[^');
}

export async function splice(doc, start, end, markdown) {
  const res = await fetch('/__save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ doc, start, end, markdown }),
  });
  return res.ok;
}

export function beginEdit(slug, el, setStatus) {
  const original = el.innerHTML;
  let cancelled = false;

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelled = true;
      el.blur();
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      el.blur();
    }
  };

  const onBlur = async () => {
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    el.contentEditable = 'false';
    if (cancelled || el.innerHTML === original) {
      el.innerHTML = original;
      setStatus(cancelled ? 'cancelled' : 'no changes');
      return;
    }
    setStatus('saving…');
    const ok = await splice(
      slug,
      Number(el.dataset.editStart),
      Number(el.dataset.editEnd),
      blockToMarkdown(el),
    );
    setStatus(ok ? 'saved' : 'save failed — see terminal');
    // Reload so every block re-renders with fresh offsets and the reading
    // chrome (TOC ids, durations, comment markers) recomputes.
    if (ok) location.reload();
  };

  el.contentEditable = 'true';
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
  el.focus();
  setStatus('editing — click away or ⌘⏎ to save, esc to cancel');
}
