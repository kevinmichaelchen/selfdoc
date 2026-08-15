import { useEffect, useState } from 'react';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
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

function blockToMarkdown(el) {
  const clone = el.cloneNode(true);
  clone.removeAttribute('contenteditable');
  return escapeMdx(turndown.turndown(clone.outerHTML));
}

function beginEdit(el, setStatus) {
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
    const res = await fetch('/__save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        start: Number(el.dataset.editStart),
        end: Number(el.dataset.editEnd),
        markdown: blockToMarkdown(el),
      }),
    });
    // On success Vite reloads the page with fresh offsets; the status is
    // only ever visible when the save failed.
    setStatus(res.ok ? 'saved' : 'save failed — see terminal');
  };

  el.contentEditable = 'true';
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
  el.focus();
  setStatus('editing — click away or ⌘⏎ to save, esc to cancel');
}

export function EditorShell() {
  const [editing, setEditing] = useState(
    () => sessionStorage.getItem('selfdoc-editing') === '1',
  );
  const [status, setStatus] = useState('');

  useEffect(() => {
    sessionStorage.setItem('selfdoc-editing', editing ? '1' : '0');
    if (!editing) return;
    document.body.classList.add('editing');
    const onClick = (event) => {
      if (event.target.closest('a')) event.preventDefault();
      const el = event.target.closest('[data-edit-start]');
      if (el && !el.isContentEditable) beginEdit(el, setStatus);
    };
    document.addEventListener('click', onClick);
    return () => {
      document.body.classList.remove('editing');
      document.removeEventListener('click', onClick);
    };
  }, [editing]);

  return (
    <div className="editor-shell">
      {status && <span className="editor-status">{status}</span>}
      <button
        type="button"
        className="editor-toggle"
        onClick={() => {
          setStatus('');
          setEditing((v) => !v);
        }}
      >
        {editing ? 'Done editing' : '✏️ Edit this page'}
      </button>
    </div>
  );
}
