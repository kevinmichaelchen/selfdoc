import {
  AudioLines,
  Copy,
  Download,
  FileText,
  Flame,
  Keyboard,
  MessageSquareText,
  Pencil,
  Pilcrow,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  blockKey,
  DOC_KEY,
  exportAnnotations,
  isAnnotated,
  loadAnnotations,
  loadGrade,
  saveAnnotations,
  saveGrade,
  unwrapMarks,
  unwrapQuoteMarks,
  wrapQuote,
} from './comments.js';
import { TOGGLE_LISTEN } from './audio.js';
import { beginEdit, splice } from './editor-core.js';
import { flags } from './flags.js';
import { analyzeAll } from './heat.js';
import { onHotkeys } from './hotkeys.js';
import { VoicePanel } from './voice.jsx';

const OWN_UI =
  '.editor-shell, .block-toolbar, .comment-panel, .comment-sidebar, .heat-panel, .record-panel, .narration-layer, .ring-wrap, .topbar';

const REACTIONS = [
  ['wtf', '😕 lost me'],
  ['note', '📝 needs margin note'],
  ['kudos', '👏 kudos'],
];

const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'];

/**
 * The interactive modes. Edit mode (dev only) rewrites the source file;
 * comment mode annotates blocks into localStorage; heat mode is a derived
 * writing-lint lens. Comment and heat ship in the export.
 */
export function Shell({ slug }) {
  const canEdit = import.meta.env.DEV;
  const [mode, setMode] = useState(() => {
    const saved = sessionStorage.getItem('selfdoc-mode');
    if (saved === 'edit' && !canEdit) return null;
    if (saved === 'heat' && !flags.heat) return null;
    if (saved === 'audio') return null; // retired mode
    return saved || null;
  });
  const [status, setStatus] = useState('');
  const [hover, setHover] = useState(null);
  const [commentEl, setCommentEl] = useState(null);
  const [heatMap, setHeatMap] = useState(null);
  const [grade, setGrade] = useState(() => loadGrade(slug));
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tick, setTick] = useState(0);

  const switchMode = (next) => {
    setStatus('');
    setCommentEl(null);
    setHover(null);
    setMode((current) => (current === next ? null : next));
  };

  // Single-letter hotkeys; Escape unwinds the topmost thing that's open.
  // Escape inside a contentEditable block belongs to the editor (save+blur).
  useEffect(
    () =>
      onHotkeys({
        c: () => switchMode('comment'),
        p: () => window.dispatchEvent(new Event(TOGGLE_LISTEN)),
        '?': () => setHelpOpen((open) => !open),
        ...(canEdit && {
          e: () => switchMode('edit'),
          v: () => setVoiceOpen((open) => !open),
        }),
        Escape: (event) => {
          if (event.target.isContentEditable) return;
          if (helpOpen) setHelpOpen(false);
          else if (voiceOpen) setVoiceOpen(false);
          else if (commentEl) setCommentEl(null);
          else if (mode) switchMode(mode);
        },
      }),
    [canEdit, helpOpen, voiceOpen, commentEl, mode],
  );

  useEffect(() => {
    sessionStorage.setItem('selfdoc-mode', mode ?? '');
    document.body.classList.toggle('editing', mode === 'edit');
    document.body.classList.toggle('commenting', mode === 'comment');
    if (mode !== 'edit' && mode !== 'comment') return;
    const onClick = (event) => {
      if (event.target.closest(OWN_UI)) return;
      if (event.target.closest('a')) event.preventDefault();
      const el = event.target.closest('[data-edit-start]');
      if (!el) return;
      if (mode === 'edit') {
        if (!el.isContentEditable) beginEdit(slug, el, setStatus);
      } else {
        // A text selection narrows the annotation from the block to the
        // selected phrase — confusion rarely spans a whole paragraph.
        const selection = window.getSelection();
        const quote =
          selection && !selection.isCollapsed && el.contains(selection.anchorNode)
            ? selection.toString().trim().slice(0, 240)
            : null;
        setCommentEl({ el, quote });
      }
    };
    document.addEventListener('click', onClick);
    return () => {
      document.body.classList.remove('editing', 'commenting');
      document.removeEventListener('click', onClick);
    };
  }, [mode, slug]);

  // The block toolbar (edit) and signal panel (heat) follow the hovered block.
  useEffect(() => {
    if (mode !== 'edit' && mode !== 'heat') return;
    const onOver = (event) => {
      if (event.target.closest?.('.block-toolbar, .heat-panel')) return;
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

  // Heat is recomputed on toggle and leaves nothing behind on toggle-off.
  useEffect(() => {
    if (mode !== 'heat') {
      setHeatMap(null);
      return;
    }
    const map = analyzeAll();
    map.forEach((result, el) =>
      el.classList.add(result.level === 2 ? 'heat-hot' : 'heat-warm'),
    );
    setHeatMap(map);
    const warm = [...map.values()].filter((r) => r.level === 1).length;
    setStatus(
      map.size
        ? `${map.size - warm} hot · ${warm} warm — hover a highlighted block`
        : 'nothing runs hot',
    );
    return () => map.forEach((_, el) => el.classList.remove('heat-hot', 'heat-warm'));
  }, [mode]);

  // Marker dots on annotated blocks and highlights on quoted phrases,
  // visible in every mode.
  useEffect(() => {
    const store = loadAnnotations(slug);
    unwrapQuoteMarks();
    document.querySelectorAll('[data-edit-start]').forEach((el) => {
      const entry = store[blockKey(el)];
      el.classList.toggle('has-comment', isAnnotated(entry));
      entry?.c.forEach((comment) => {
        if (comment.quote) wrapQuote(el, comment.quote);
      });
    });
  }, [slug, mode, commentEl, tick]);

  // Show what's being annotated while the panel is open: amber outline on the
  // targeted block, a live highlight on a phrase target, the whole document
  // outlined for global notes.
  useEffect(() => {
    if (mode !== 'comment' || !commentEl) return;
    const el = commentEl.el;
    if (!el) {
      const main = document.querySelector('main');
      main?.classList.add('comment-target-doc');
      return () => main?.classList.remove('comment-target-doc');
    }
    el.classList.add('comment-target');
    if (commentEl.quote) wrapQuote(el, commentEl.quote, 'annot-pending');
    return () => {
      el.classList.remove('comment-target');
      unwrapMarks('mark.annot-pending');
    };
  }, [commentEl, mode]);

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

  void tick; // reposition floating panels on scroll
  const rect =
    hover?.isConnected && (mode === 'edit' || mode === 'heat') && !hover.isContentEditable
      ? hover.getBoundingClientRect()
      : null;
  const heat = mode === 'heat' && rect ? heatMap?.get(hover) : null;

  return (
    <>
      {mode === 'edit' && rect && (
        <div
          className="block-toolbar"
          style={{ top: Math.max(8, rect.top - 34), left: Math.max(8, rect.right - 168) }}
        >
          <button type="button" title="Add paragraph after" onClick={() => act('para')}>
            <Pilcrow size={13} />
          </button>
          <button type="button" title="Add margin note after" onClick={() => act('note')}>
            <StickyNote size={13} />
          </button>
          <button type="button" title="Delete block" onClick={() => act('delete')}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
      {heat && (
        <div
          className="heat-panel"
          style={{
            top: Math.min(window.innerHeight - 40 - heat.signals.length * 22, rect.bottom + 6),
            left: Math.max(8, rect.left),
          }}
        >
          <ul>
            {heat.signals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'comment' && (
        <CommentSidebar
          slug={slug}
          tick={tick}
          onOpen={(target) => {
            target.el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setCommentEl(target);
          }}
        />
      )}
      {commentEl && mode === 'comment' && (
        <CommentPanel
          slug={slug}
          target={commentEl}
          onClose={() => setCommentEl(null)}
          onChange={() => setTick((t) => t + 1)}
        />
      )}
      {voiceOpen && canEdit && <VoicePanel slug={slug} onClose={() => setVoiceOpen(false)} />}
      {helpOpen && (
        <div className="comment-panel hotkey-help">
          <div className="comment-head">
            <span className="toc-eyebrow">Keyboard</span>
            <button type="button" aria-label="Close" onClick={() => setHelpOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <dl>
            <dt>
              <kbd>p</kbd>
            </dt>
            <dd>listen from the top / pause</dd>
            <dt>
              <kbd>c</kbd>
            </dt>
            <dd>comment mode</dd>
            {canEdit && (
              <>
                <dt>
                  <kbd>e</kbd>
                </dt>
                <dd>edit mode</dd>
                <dt>
                  <kbd>v</kbd>
                </dt>
                <dd>synthetic voice panel</dd>
              </>
            )}
            <dt>
              <kbd>⌘⏎</kbd>
            </dt>
            <dd>submit a comment</dd>
            <dt>
              <kbd>esc</kbd>
            </dt>
            <dd>close whatever is open, then exit the mode</dd>
          </dl>
        </div>
      )}
      <div className="editor-shell">
        {status && <span className="editor-status">{status}</span>}
        {mode === 'comment' && (
          <button
            type="button"
            className="shell-btn"
            onClick={() => setCommentEl({ el: null, quote: null })}
          >
            <FileText size={12} /> whole doc
          </button>
        )}
        {mode === 'comment' && (
          <label className="grade-pick">
            grade
            <select
              value={grade}
              onChange={(event) => {
                setGrade(event.target.value);
                saveGrade(slug, event.target.value);
              }}
            >
              <option value="">—</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="shell-btn"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelpOpen((open) => !open)}
        >
          <Keyboard size={12} />
        </button>
        {canEdit && (
          <button type="button" className="shell-btn" onClick={() => setVoiceOpen((v) => !v)}>
            <AudioLines size={12} /> Voice
          </button>
        )}
        {flags.heat && (
          <button type="button" className="shell-btn" onClick={() => switchMode('heat')}>
            <Flame size={12} /> {mode === 'heat' ? 'Done with heat' : 'Heat'}
          </button>
        )}
        <button type="button" className="shell-btn" onClick={() => switchMode('comment')}>
          <MessageSquareText size={12} />{' '}
          {mode === 'comment' ? 'Done commenting' : `Comment${grade ? ` · ${grade}` : ''}`}
        </button>
        {canEdit && (
          <button type="button" className="shell-btn primary" onClick={() => switchMode('edit')}>
            <Pencil size={12} /> {mode === 'edit' ? 'Done editing' : 'Edit'}
          </button>
        )}
      </div>
    </>
  );
}

const REACTION_EMOJI = { wtf: '😕', note: '📝', kudos: '👏' };

function CommentSidebar({ slug, tick, onOpen }) {
  void tick; // annotations changed; rebuild the list
  const blocks = new Map();
  document.querySelectorAll('[data-edit-start]').forEach((el) => {
    blocks.set(blockKey(el), el);
  });
  const items = Object.entries(loadAnnotations(slug))
    .map(([key, entry]) => {
      const el = key === DOC_KEY ? null : (blocks.get(key) ?? null);
      return {
        key,
        el,
        entry,
        order: key === DOC_KEY ? -1 : el ? Number(el.dataset.editStart) : Infinity,
        excerpt:
          key === DOC_KEY
            ? 'Whole document'
            : (el?.textContent.trim().slice(0, 70) ?? '(block was rewritten — orphaned)'),
      };
    })
    .sort((a, b) => a.order - b.order);

  const download = () => {
    const data = JSON.stringify(exportAnnotations(slug), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `${slug}-comments.json`,
    });
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="comment-sidebar" aria-label="All comments">
      <div className="sidebar-head">
        <span className="toc-eyebrow">Comments</span>
        <span className="sidebar-actions">
          <button
            type="button"
            title="Copy all comments as JSON, for feeding to an agent"
            onClick={() =>
              navigator.clipboard.writeText(JSON.stringify(exportAnnotations(slug), null, 2))
            }
          >
            <Copy size={11} /> json
          </button>
          <button type="button" title="Download all comments as JSON" onClick={download}>
            <Download size={11} />
          </button>
        </span>
      </div>
      {items.length === 0 && (
        <p className="sidebar-empty">
          Nothing yet. Click a block — or select a phrase first — to leave the
          first comment.
        </p>
      )}
      <ol>
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className="sidebar-item"
              disabled={!item.el && item.key !== DOC_KEY}
              onClick={() => onOpen({ el: item.el, quote: null })}
            >
              <span className="sidebar-excerpt">
                {Object.keys(item.entry.r)
                  .filter((r) => item.entry.r[r])
                  .map((r) => REACTION_EMOJI[r])
                  .join(' ')}{' '}
                “{item.excerpt}”
              </span>
              {item.entry.c.map((comment, i) => (
                <span key={comment.at + i} className="sidebar-comment">
                  {comment.quote && <em>re “{comment.quote.slice(0, 40)}”: </em>}
                  {comment.text}
                </span>
              ))}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function CommentPanel({ slug, target, onClose, onChange }) {
  const { el, quote } = target;
  const key = el ? blockKey(el) : DOC_KEY;
  const [entry, setEntry] = useState(() => loadAnnotations(slug)[key] ?? { c: [], r: {} });
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setEntry(loadAnnotations(slug)[key] ?? { c: [], r: {} });
    setDraft('');
  }, [slug, key]);

  const persist = (next) => {
    const store = loadAnnotations(slug);
    store[key] = next;
    saveAnnotations(slug, store);
    setEntry(next);
    onChange();
  };

  const addComment = () => {
    if (!draft.trim()) return;
    persist({
      ...entry,
      c: [...entry.c, { text: draft.trim(), at: new Date().toISOString(), ...(quote && { quote }) }],
    });
    setDraft('');
  };

  return (
    <div className="comment-panel">
      <div className="comment-head">
        <span className="comment-excerpt">
          {quote
            ? `on the phrase “${quote.slice(0, 70)}${quote.length > 70 ? '…' : ''}”`
            : el
              ? `“${el.textContent.trim().slice(0, 70)}…”`
              : 'on the whole document'}
        </span>
        <button type="button" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="reaction-row">
        {REACTIONS.map(([key2, label]) => (
          <button
            key={key2}
            type="button"
            className={entry.r[key2] ? 'active' : ''}
            onClick={() => persist({ ...entry, r: { ...entry.r, [key2]: !entry.r[key2] } })}
          >
            {label}
          </button>
        ))}
      </div>
      {entry.c.length > 0 && (
        <ol className="comment-list">
          {entry.c.map((comment, i) => (
            <li key={comment.at + i}>
              {comment.quote && (
                <span className="comment-quote">re: “{comment.quote.slice(0, 60)}”</span>
              )}
              <p>{comment.text}</p>
              <span className="comment-meta">
                {new Date(comment.at).toLocaleString()}
                <button
                  type="button"
                  onClick={() => persist({ ...entry, c: entry.c.filter((_, j) => j !== i) })}
                >
                  delete
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <textarea
        value={draft}
        placeholder={`Leave a comment… (${navigator.platform.includes('Mac') ? '⌘⏎' : 'Ctrl+⏎'} to submit)`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            addComment();
          }
        }}
      />
      <button
        type="button"
        className="shell-btn primary"
        disabled={!draft.trim()}
        onClick={addComment}
      >
        Add comment
      </button>
    </div>
  );
}
