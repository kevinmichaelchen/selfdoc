import { Check, Mic, Pause, Play, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIO_CHANGED,
  audioKey,
  audioUnits,
  audioUrl,
  deleteRecording,
  isAudioUnit,
  listRecorded,
  saveRecording,
  STOP_NARRATION,
  unwrapWords,
  wrapWords,
} from './audio.js';

const announceChange = () => window.dispatchEvent(new Event(AUDIO_CHANGED));

/**
 * The narration rail: no mode, no button. Recorded sections carry a subtle
 * play control in the margin; playing continues section-to-section through
 * everything narrated, with an estimated word-sweep highlight (audio time
 * distributed across words by character count — an approximation, not
 * speech alignment). In dev, hovering an unrecorded section reveals a mic.
 */
export function NarrationRail({ slug }) {
  const canRecord = import.meta.env.DEV;
  const [units, setUnits] = useState([]);
  const [hoverKey, setHoverKey] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [recordEl, setRecordEl] = useState(null);
  const audioRef = useRef(null);
  const sweepRef = useRef(null);

  const refresh = useCallback(() => {
    const els = audioUnits();
    listRecorded(slug).then((recorded) => {
      const set = new Set(recorded);
      setUnits(
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          const key = audioKey(el);
          return {
            el,
            key,
            recorded: set.has(key),
            top: rect.top + window.scrollY,
            left: Math.max(6, rect.left - 36),
          };
        }),
      );
    });
  }, [slug]);

  useEffect(() => {
    refresh();
    const settle = setTimeout(refresh, 600); // fonts shift layout after paint
    window.addEventListener('resize', refresh);
    window.addEventListener(AUDIO_CHANGED, refresh);
    return () => {
      clearTimeout(settle);
      window.removeEventListener('resize', refresh);
      window.removeEventListener(AUDIO_CHANGED, refresh);
    };
  }, [refresh]);

  const clearSweep = () => {
    const sweep = sweepRef.current;
    if (!sweep) return;
    sweep.el.classList.remove('narrating');
    unwrapWords(sweep.el);
    sweepRef.current = null;
  };

  const stopPlayback = useCallback(() => {
    audioRef.current?.pause();
    clearSweep();
    setPlaying(null);
  }, []);

  useEffect(() => {
    window.addEventListener(STOP_NARRATION, stopPlayback);
    return () => {
      window.removeEventListener(STOP_NARRATION, stopPlayback);
      stopPlayback();
    };
  }, [stopPlayback]);

  // Hover reveals the record call-to-action on silent sections. The mic sits
  // in the margin, so keep the last hovered target until another section is
  // hovered — hiding it mid-travel would make it unclickable.
  useEffect(() => {
    if (!canRecord) return;
    const onOver = (event) => {
      if (event.target.closest?.('.rail-btn, .record-panel')) return;
      const note = event.target.closest?.('aside.note[data-node-start]');
      const unit = note ?? event.target.closest?.('[data-edit-start]');
      if (isAudioUnit(unit)) setHoverKey(audioKey(unit));
    };
    document.addEventListener('mouseover', onOver);
    return () => document.removeEventListener('mouseover', onOver);
  }, [canRecord]);

  const beginSweep = (el) => {
    clearSweep();
    sweepRef.current = { el, ...wrapWords(el), current: -1 };
    el.classList.add('narrating');
  };

  const onTimeUpdate = (player) => {
    const sweep = sweepRef.current;
    if (!sweep || !player.duration || !sweep.total) return;
    const pos = (player.currentTime / player.duration) * sweep.total;
    const index = sweep.cums.findIndex((cum) => cum >= pos);
    if (index === -1 || index === sweep.current) return;
    sweep.spans[sweep.current]?.classList.remove('speaking');
    sweep.spans[index].classList.add('speaking');
    sweep.current = index;
  };

  const playFrom = (key) => {
    if (playing === key) {
      stopPlayback();
      return;
    }
    const narrated = units.filter((unit) => unit.recorded);
    const start = narrated.findIndex((unit) => unit.key === key);
    if (start < 0) return;
    audioRef.current ??= new Audio();
    const player = audioRef.current;
    const playIndex = (i) => {
      if (i >= narrated.length) {
        stopPlayback();
        return;
      }
      const unit = narrated[i];
      player.src = audioUrl(slug, unit.key);
      player.onended = () => playIndex(i + 1);
      player.ontimeupdate = () => onTimeUpdate(player);
      beginSweep(unit.el);
      setPlaying(unit.key);
      player.play();
    };
    playIndex(start);
  };

  return (
    <>
      <div className="narration-layer">
        {units.map((unit) => {
          if (unit.recorded) {
            const active = playing === unit.key;
            return (
              <button
                key={unit.key}
                type="button"
                className={`rail-btn${active ? ' playing' : ''}`}
                style={{ top: unit.top, left: unit.left }}
                aria-label={active ? 'Pause narration' : 'Play narration from this section'}
                title={active ? 'Pause' : 'Listen from here'}
                onClick={() => playFrom(unit.key)}
              >
                {active ? <Pause size={12} /> : <Play size={12} />}
              </button>
            );
          }
          if (canRecord && hoverKey === unit.key) {
            return (
              <button
                key={unit.key}
                type="button"
                className="rail-btn rail-record"
                style={{ top: unit.top, left: unit.left }}
                aria-label="Record yourself reading this section"
                title="This section needs your voice"
                onClick={() => setRecordEl(unit.el)}
              >
                <Mic size={12} />
              </button>
            );
          }
          return null;
        })}
      </div>
      {recordEl && (
        <RecordPanel
          slug={slug}
          el={recordEl}
          onClose={() => setRecordEl(null)}
          onChange={announceChange}
        />
      )}
    </>
  );
}

/**
 * You have to hear yourself: one take from the microphone, a mandatory
 * listen in preview, then keep it or read it again.
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
    el.classList.add('comment-target');
    listRecorded(slug).then((keys) => setHasSaved(keys.includes(key)));
    return () => {
      el.classList.remove('comment-target');
      recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, [slug, key, el]);

  const start = async () => {
    setError('');
    window.dispatchEvent(new Event(STOP_NARRATION));
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
          <X size={16} />
        </button>
      </div>
      {error && <span className="record-error">{error}</span>}
      {phase === 'idle' && hasSaved && (
        <>
          <audio controls src={`${audioUrl(slug, key)}?v=${version}`} />
          <div className="record-row">
            <button type="button" className="shell-btn" onClick={start}>
              <RotateCcw size={12} /> re-record
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
              <Trash2 size={12} /> delete
            </button>
          </div>
        </>
      )}
      {phase === 'idle' && !hasSaved && (
        <button type="button" className="shell-btn primary" onClick={start}>
          <Mic size={12} /> record this section
        </button>
      )}
      {phase === 'recording' && (
        <button
          type="button"
          className="shell-btn primary rec-live"
          onClick={() => recorderRef.current?.stop()}
        >
          <Square size={12} /> stop
        </button>
      )}
      {phase === 'preview' && (
        <>
          <audio controls src={previewUrl} />
          <div className="record-row">
            <button type="button" className="shell-btn primary" onClick={save}>
              <Check size={12} /> keep it
            </button>
            <button type="button" className="shell-btn" onClick={start}>
              <RotateCcw size={12} /> again
            </button>
          </div>
        </>
      )}
    </div>
  );
}
