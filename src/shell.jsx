import { useEffect, useState } from 'react';
import { blockKey, loadComments, saveComments } from './comments.js';
import { beginEdit, splice } from './editor-core.js';

const OWN_UI = '.editor-shell, .block-toolbar, .comment-panel, .ring-wrap, .topbar';

/**
 * The two interactive modes. Edit mode (dev only) rewrites the source file;
 * comment mode annotates blocks into localStorage and ships in the export.
 */
export function Shell({ slug }) {
  const canEdit = import.meta.env.DEV;
  const [mode, setMode] = useState(() => {
    const saved = sessionStorage.getItem('selfdoc-mode');
    return saved === 'edit' && !canEdit ? null : saved || null;
  });
  const [status, setStatus] = useState('');
  const [hover, setHover] = useState(null);
  const [commentEl, setCommentEl] = useState(null);
  const [tick, setTick] = useState(0);

  const switchMode = (next) => {
    setStatus('');
    setCommentEl(null);
    setHover(null);
    setMode((current) => (current === next ? null : next));
  };

  useEffect(() => {
    sessionStorage.setItem('selfdoc-mode', mode ?? '');
    document.body.classList.toggle('editing', mode === 'edit');
    document.body.classList.toggle('commenting', mode === 'comment');
    if (!mode) return;
    const onClick = (event) => {
      if (event.target.closest(OWN_UI)) return;
      if (event.target.closest('a')) event.preventDefault();
      const el = event.target.closest('[data-edit-start]');
      if (!el) return;
      if (mode === 'edit') {
        if (!el.isContentEditable) beginEdit(slug, el, setStatus);
      } else {
        setCommentEl(el);
      }
    };
    document.addEventListener('click', onClick);
    return () => {
      document.body.classList.remove('editing', 'commenting');
      document.removeEventListener('click', onClick);
    };
  }, [mode, slug]);

  // The block toolbar follows the hovered block in edit mode.
  useEffect(() => {
    if (mode !== 'edit') return;
    const onOver = (event) => {
      if (event.target.closest?.('.block-toolbar')) return;
      const el = event.target.closest?.('[data-edit-start], [data-node-start]');
      if (el) setHover(el);
    };
    const onScroll = () => setTick((t) => t + 1);
    document.addEventListener('mouseover', onOver);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('mouseover', onOver);
      window.removeEventListener('scroll', onScroll);
    };
  }, [mode]);

  // Marker dots on blocks that carry comments, visible in every mode.
  useEffect(() => {
    const store = loadComments(slug);
    document.querySelectorAll('[data-edit-start]').forEach((el) => {
      el.classList.toggle('has-comment', Boolean(store[blockKey(el)]?.length));
    });
  }, [slug, mode, commentEl, tick]);

  const act = async (action) => {
    const el = hover;
    if (!el) return;
    const start = Number(el.dataset.editStart ?? el.dataset.nodeStart);
    const end = Number(el.dataset.editEnd ?? el.dataset.nodeEnd);
    let ok = false;
    if (action === 'para') {
      ok = await splice(slug, end, end, '\n\nNew paragraph — click to edit.');
    } else if (action === 'note') {
      ok = await splice(slug, end, end, '\n\n<Note>\n  New margin note — click to edit.\n</Note>');
    } else if (action === 'delete') {
      if (!window.confirm('Delete this block? (git has your back)')) return;
      ok = await splice(slug, start, end, '');
    }
    setStatus(ok ? 'saved' : 'save failed — see terminal');
    if (ok) location.reload();
  };

  void tick; // reposition the toolbar on scroll
  const rect =
    mode === 'edit' && hover?.isConnected && !hover.isContentEditable
      ? hover.getBoundingClientRect()
      : null;

  return (
    <>
      {rect && (
        <div
          className="block-toolbar"
          style={{ top: Math.max(8, rect.top - 34), left: Math.max(8, rect.right - 168) }}
        >
          <button type="button" title="Add paragraph after" onClick={() => act('para')}>
            + ¶
          </button>
          <button type="button" title="Add margin note after" onClick={() => act('note')}>
            + note
          </button>
          <button type="button" title="Delete block" onClick={() => act('delete')}>
            ✕
          </button>
        </div>
      )}
      {commentEl && mode === 'comment' && (
        <CommentPanel
          slug={slug}
          el={commentEl}
          onClose={() => setCommentEl(null)}
          onChange={() => setTick((t) => t + 1)}
        />
      )}
      <div className="editor-shell">
        {status && <span className="editor-status">{status}</span>}
        <button type="button" className="shell-btn" onClick={() => switchMode('comment')}>
          {mode === 'comment' ? 'Done commenting' : '💬 Comment'}
        </button>
        {canEdit && (
          <button type="button" className="shell-btn primary" onClick={() => switchMode('edit')}>
            {mode === 'edit' ? 'Done editing' : '✏️ Edit'}
          </button>
        )}
      </div>
    </>
  );
}

function CommentPanel({ slug, el, onClose, onChange }) {
  const key = blockKey(el);
  const [items, setItems] = useState(() => loadComments(slug)[key] ?? []);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setItems(loadComments(slug)[key] ?? []);
    setDraft('');
  }, [slug, key]);

  const persist = (next) => {
    const store = loadComments(slug);
    if (next.length) store[key] = next;
    else delete store[key];
    saveComments(slug, store);
    setItems(next);
    onChange();
  };

  return (
    <div className="comment-panel">
      <div className="comment-head">
        <span className="comment-excerpt">“{el.textContent.trim().slice(0, 70)}…”</span>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {items.length > 0 && (
        <ol className="comment-list">
          {items.map((comment, i) => (
            <li key={comment.at + i}>
              <p>{comment.text}</p>
              <span className="comment-meta">
                {new Date(comment.at).toLocaleString()}
                <button type="button" onClick={() => persist(items.filter((_, j) => j !== i))}>
                  delete
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <textarea
        value={draft}
        placeholder="Leave a comment on this block…"
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        className="shell-btn primary"
        disabled={!draft.trim()}
        onClick={() => {
          persist([...items, { text: draft.trim(), at: new Date().toISOString() }]);
          setDraft('');
        }}
      >
        Add comment
      </button>
    </div>
  );
}
