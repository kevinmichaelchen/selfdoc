import { useEffect, useRef, useState } from 'react';
import {
  audioKey,
  audioUnits,
  audioUrl,
  deleteRecording,
  isAudioUnit,
  listRecorded,
  saveRecording,
} from './audio.js';
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
import { beginEdit, splice } from './editor-core.js';
import { analyzeAll } from './heat.js';

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
    return saved === 'edit' && !canEdit ? null : saved || null;
  });
  const [status, setStatus] = useState('');
  const [hover, setHover] = useState(null);
  const [commentEl, setCommentEl] = useState(null);
  const [heatMap, setHeatMap] = useState(null);
  const [grade, setGrade] = useState(() => loadGrade(slug));
  const [audioStat, setAudioStat] = useState(null);
  const [audioEl, setAudioEl] = useState(null);
  const [tick, setTick] = useState(0);

  const switchMode = (next) => {
    setStatus('');
    setCommentEl(null);
    setAudioEl(null);
    setHover(null);
    setMode((current) => (current === next ? null : next));
  };

  useEffect(() => {
    sessionStorage.setItem('selfdoc-mode', mode ?? '');
    document.body.classList.toggle('editing', mode === 'edit');
    document.body.classList.toggle('commenting', mode === 'comment');
    document.body.classList.toggle('recording', mode === 'audio');
    if (mode !== 'edit' && mode !== 'comment' && mode !== 'audio') return;
    const onClick = (event) => {
      if (event.target.closest(OWN_UI)) return;
      if (event.target.closest('a')) event.preventDefault();
      if (mode === 'audio') {
        const note = event.target.closest('aside.note[data-node-start]');
        const unit = note ?? event.target.closest('[data-edit-start]');
        if (isAudioUnit(unit)) setAudioEl(unit);
        return;
      }
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
      document.body.classList.remove('editing', 'commenting', 'recording');
      document.removeEventListener('click', onClick);
    };
  }, [mode, slug]);

  // Coverage: which narration units are read, which recordings are orphaned.
  useEffect(() => {
    if (!canEdit) return;
    const unitKeys = audioUnits().map(audioKey);
    const unitSet = new Set(unitKeys);
    listRecorded(slug).then((recorded) => {
      setAudioStat({
        total: unitSet.size,
        done: [...unitSet].filter((key) => recorded.includes(key)).length,
        orphans: recorded.filter((key) => !unitSet.has(key)),
      });
    });
  }, [canEdit, slug, mode, tick]);

  // In record mode, paint every unit by its state: read or still silent.
  useEffect(() => {
    if (mode !== 'audio') return;
    const units = audioUnits();
    listRecorded(slug).then((recorded) => {
      const set = new Set(recorded);
      units.forEach((el) => {
        el.classList.add(set.has(audioKey(el)) ? 'audio-done' : 'audio-missing');
      });
    });
    return () => {
      units.forEach((el) => el.classList.remove('audio-done', 'audio-missing'));
    };
  }, [mode, slug, tick]);

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
      {audioEl && mode === 'audio' && (
        <RecordPanel
          slug={slug}
          el={audioEl}
          onClose={() => setAudioEl(null)}
          onChange={() => setTick((t) => t + 1)}
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
      <div className="editor-shell">
        {status && <span className="editor-status">{status}</span>}
        {mode === 'audio' && audioStat && (
          <span className="editor-status">
            {audioStat.done}/{audioStat.total} sections read
            {audioStat.orphans.length > 0 && ` · ${audioStat.orphans.length} orphaned`}
          </span>
        )}
        {mode === 'audio' && audioStat?.orphans.length > 0 && (
          <button
            type="button"
            className="shell-btn"
            title="Delete recordings whose prose was rewritten"
            onClick={async () => {
              await Promise.all(audioStat.orphans.map((key) => deleteRecording(slug, key)));
              setTick((t) => t + 1);
            }}
          >
            purge orphans
          </button>
        )}
        {mode === 'comment' && (
          <button
            type="button"
            className="shell-btn"
            onClick={() => setCommentEl({ el: null, quote: null })}
          >
            🗎 whole doc
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
        {canEdit && (
          <button type="button" className="shell-btn" onClick={() => switchMode('audio')}>
            {mode === 'audio'
              ? 'Done reading'
              : `🎙 Read aloud${audioStat && audioStat.done < audioStat.total ? ` ${audioStat.done}/${audioStat.total}` : ''}`}
          </button>
        )}
        <button type="button" className="shell-btn" onClick={() => switchMode('heat')}>
          {mode === 'heat' ? 'Done with heat' : '🌡 Heat'}
        </button>
        <button type="button" className="shell-btn" onClick={() => switchMode('comment')}>
          {mode === 'comment' ? 'Done commenting' : `💬 Comment${grade ? ` · ${grade}` : ''}`}
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

/**
 * You have to hear yourself. Each unit is recorded in one take from the
 * microphone; the preview forces a listen before saving.
 */
function RecordPanel({ slug, el, onClose, onChange }) {
  const key = audioKey(el);
  const [phase, setPhase] = useState('idle'); // idle | recording | preview
  const [hasSaved, setHasSaved] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef(null);
  const blobRef = useRef(null);

  useEffect(() => {
    setPhase('idle');
    setPreviewUrl(null);
    setError('');
    blobRef.current = null;
    listRecorded(slug).then((keys) => setHasSaved(keys.includes(key)));
    return () => recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
  }, [slug, key]);

  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        blobRef.current = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setPreviewUrl(URL.createObjectURL(blobRef.current));
        setPhase('preview');
      };
      recorderRef.current = recorder;
      recorder.start();
      setPhase('recording');
    } catch (err) {
      setError(`microphone unavailable — ${err.message}`);
    }
  };

  const save = async () => {
    if (await saveRecording(slug, key, blobRef.current)) {
      setHasSaved(true);
      setPhase('idle');
      setPreviewUrl(null);
      setVersion((v) => v + 1);
      onChange();
    } else {
      setError('save failed — see terminal');
    }
  };

  return (
    <div className="record-panel comment-panel">
      <div className="comment-head">
        <span className="comment-excerpt">
          read aloud: “{el.textContent.trim().slice(0, 90)}…”
        </span>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {error && <span className="record-error">{error}</span>}
      {phase === 'idle' && hasSaved && (
        <>
          <audio controls src={`${audioUrl(slug, key)}?v=${version}`} />
          <div className="record-row">
            <button type="button" className="shell-btn" onClick={start}>
              ⏺ re-record
            </button>
            <button
              type="button"
              className="shell-btn"
              onClick={async () => {
                await deleteRecording(slug, key);
                setHasSaved(false);
                onChange();
              }}
            >
              delete
            </button>
          </div>
        </>
      )}
      {phase === 'idle' && !hasSaved && (
        <button type="button" className="shell-btn primary" onClick={start}>
          ⏺ record this section
        </button>
      )}
      {phase === 'recording' && (
        <button
          type="button"
          className="shell-btn primary rec-live"
          onClick={() => recorderRef.current?.stop()}
        >
          ⏹ stop
        </button>
      )}
      {phase === 'preview' && (
        <>
          <audio controls src={previewUrl} />
          <div className="record-row">
            <button type="button" className="shell-btn primary" onClick={save}>
              keep it
            </button>
            <button type="button" className="shell-btn" onClick={start}>
              ⏺ again
            </button>
          </div>
        </>
      )}
    </div>
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
            ⧉ json
          </button>
          <button type="button" title="Download all comments as JSON" onClick={download}>
            ⇩
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
          ×
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
