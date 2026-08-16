import { Check, Mic, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIO_CHANGED,
  audioKey,
  audioUnits,
  audioUrl,
  findSpeechBounds,
  isAudioUnit,
  listAudio,
  saveRecording,
  STOP_NARRATION,
  tokensOf,
  unwrapWords,
  wrapWords,
} from './audio.js';
import { ALIGN_STATUS, alignTake } from './audio-ai.js';

const announceChange = () => window.dispatchEvent(new Event(AUDIO_CHANGED));

/**
 * The narration rail: no mode, no button. Recorded sections carry a subtle
 * play control in the margin; playing continues section-to-section through
 * everything narrated, honoring each take's silence-trim bounds, with an
 * estimated word-sweep highlight (audio time distributed across words by
 * character count — an approximation, not speech alignment). In dev,
 * hovering a section reveals a mic: record it, or re-record a stale read.
 */
export function NarrationRail({ slug }) {
  const canRecord = import.meta.env.DEV;
  const [units, setUnits] = useState([]);
  const [hoverKey, setHoverKey] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [recordEl, setRecordEl] = useState(null);
  const [alignMsg, setAlignMsg] = useState('');
  const audioRef = useRef(null);
  const sweepRef = useRef(null);

  // Alignment progress toast (model download, transcription, result).
  useEffect(() => {
    if (!canRecord) return;
    let timer;
    const onStatus = (event) => {
      setAlignMsg(event.detail);
      clearTimeout(timer);
      if (event.detail.endsWith('✓')) timer = setTimeout(() => setAlignMsg(''), 4000);
    };
    window.addEventListener(ALIGN_STATUS, onStatus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(ALIGN_STATUS, onStatus);
    };
  }, [canRecord]);

  const refresh = useCallback(() => {
    const els = audioUnits();
    listAudio(slug).then((recorded) => {
      setUnits(
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          const key = audioKey(el);
          return {
            el,
            key,
            recorded: key in recorded,
            meta: recorded[key] ?? null,
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

  // Hover reveals the mic on sections. It sits in the margin, so keep the
  // last hovered target until another section is hovered — hiding it
  // mid-travel would make it unclickable.
  useEffect(() => {
    if (!canRecord) return;
    const onOver = (event) => {
      if (event.target.closest?.('.rail-btn, .rec-overlay')) return;
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

  const onTimeUpdate = (player, meta) => {
    const sweep = sweepRef.current;
    if (!sweep || !player.duration || !sweep.total) return;
    let index;
    if (meta?.words?.length === sweep.spans.length) {
      // Model-aligned timing: the word whose timestamp we've passed.
      const t = player.currentTime;
      index = meta.words.findLastIndex((start) => start <= t);
      if (index === -1) index = 0;
    } else {
      // Estimate: clip time spread across words by character count.
      const t0 = meta?.t0 ?? 0;
      const t1 = meta?.t1 ?? player.duration;
      const progress = Math.min(1, Math.max(0, (player.currentTime - t0) / (t1 - t0 || 1)));
      index = sweep.cums.findIndex((cum) => cum >= progress * sweep.total);
      if (index === -1) return;
    }
    if (index === sweep.current) return;
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
      const meta = unit.meta;
      const advance = () => playIndex(i + 1);
      player.src = audioUrl(slug, unit.key);
      player.onloadedmetadata = () => {
        if (meta?.t0) player.currentTime = meta.t0;
      };
      player.onended = advance;
      player.ontimeupdate = () => {
        if (meta?.t1 && player.currentTime >= meta.t1) {
          player.pause();
          advance();
          return;
        }
        // Jump the dead air and cut fillers the model found.
        const skip = meta?.skips?.find(
          ([s, e]) => player.currentTime >= s && player.currentTime < e - 0.05,
        );
        if (skip) {
          player.currentTime = skip[1];
          return;
        }
        onTimeUpdate(player, meta);
      };
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
          const hovered = canRecord && hoverKey === unit.key;
          return (
            <span key={unit.key}>
              {unit.recorded && (
                <button
                  type="button"
                  className={`rail-btn${playing === unit.key ? ' playing' : ''}`}
                  style={{ top: unit.top, left: unit.left }}
                  aria-label={
                    playing === unit.key ? 'Pause narration' : 'Play narration from this section'
                  }
                  title={playing === unit.key ? 'Pause' : 'Listen from here'}
                  onClick={() => playFrom(unit.key)}
                >
                  {playing === unit.key ? <Pause size={12} /> : <Play size={12} />}
                </button>
              )}
              {hovered && (
                <button
                  type="button"
                  className="rail-btn rail-record"
                  style={{ top: unit.top + (unit.recorded ? 30 : 0), left: unit.left }}
                  aria-label={
                    unit.recorded
                      ? 'Re-record this section'
                      : 'Record yourself reading this section'
                  }
                  title={unit.recorded ? 'Read it again' : 'This section needs your voice'}
                  onClick={() => {
                    window.dispatchEvent(new Event(STOP_NARRATION));
                    setRecordEl(unit.el);
                  }}
                >
                  <Mic size={12} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {alignMsg && <div className="align-toast">{alignMsg}</div>}
      {recordEl && (
        <RecordFlow
          slug={slug}
          el={recordEl}
          onClose={() => setRecordEl(null)}
          onChange={announceChange}
        />
      )}
    </>
  );
}

/** Live frequency bars driven by the microphone stream. */
function Waveform({ stream }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const canvas = canvasRef.current;
    const paint = canvas.getContext('2d');
    let raf;
    const draw = () => {
      analyser.getByteFrequencyData(bins);
      paint.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = canvas.width / bins.length;
      bins.forEach((value, i) => {
        const height = Math.max(2, (value / 255) * canvas.height);
        paint.fillStyle = '#246f61';
        paint.fillRect(i * barWidth, (canvas.height - height) / 2, barWidth - 1.5, height);
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ctx.close();
    };
  }, [stream]);
  return <canvas ref={canvasRef} className="rec-wave" width="420" height="90" />;
}

/**
 * The recording ritual: a flashing 3-second countdown (Escape cancels), a
 * floating live waveform of your voice while the take runs, then an explicit
 * save-or-discard decision. Leading and trailing silence is measured on save
 * and stored as trim bounds — the take itself stays untouched.
 */
function RecordFlow({ slug, el, onClose, onChange }) {
  const key = audioKey(el);
  const [phase, setPhase] = useState('countdown'); // countdown | live | review | saving
  const [count, setCount] = useState(3);
  const [stream, setStream] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [error, setError] = useState('');
  const recorderRef = useRef(null);
  const blobRef = useRef(null);

  const killStream = () => {
    recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  };

  useEffect(() => {
    el.classList.add('comment-target');
    // The whole point is reading the section — keep it in view, above the dock.
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return () => {
      el.classList.remove('comment-target');
      killStream();
    };
  }, [el]);

  // Ask for the mic up front so the countdown ends straight into a live take.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        setStream(s);
      })
      .catch((err) => setError(`microphone unavailable — ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, []);

  // The countdown, and Escape-to-cancel at every phase before review.
  useEffect(() => {
    if (phase !== 'countdown' || !stream) return;
    if (count === 0) {
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = async () => {
        blobRef.current = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setPreviewUrl(URL.createObjectURL(blobRef.current));
        try {
          setBounds(await findSpeechBounds(blobRef.current));
        } catch {
          setBounds(null);
        }
        setPhase('review');
      };
      recorderRef.current = recorder;
      recorder.start();
      setPhase('live');
      return;
    }
    const tick = setTimeout(() => setCount((c) => c - 1), 800);
    return () => clearTimeout(tick);
  }, [phase, count, stream]);

  useEffect(() => {
    if (phase !== 'live') return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (phase === 'live') recorderRef.current?.stop();
      else if (phase !== 'review') {
        killStream();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const again = () => {
    killStream();
    setElapsed(0);
    setCount(3);
    setPreviewUrl(null);
    setBounds(null);
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(setStream)
      .catch((err) => setError(`microphone unavailable — ${err.message}`));
    setPhase('countdown');
  };

  const save = async () => {
    setPhase('saving');
    const trim = bounds && !bounds.silent ? { t0: bounds.t0, t1: bounds.t1 } : null;
    if (await saveRecording(slug, key, blobRef.current, trim)) {
      // Fire-and-forget: the speech model aligns word timing and finds
      // filler/pause skips in the background, then updates the meta.
      alignTake(slug, key, blobRef.current, bounds, tokensOf(el));
      killStream();
      onChange();
      onClose();
    } else {
      setError('save failed — see terminal');
      setPhase('review');
    }
  };

  const trimmed = bounds && !bounds.silent ? bounds.duration - (bounds.t1 - bounds.t0) : 0;

  return (
    <div className="rec-dock rec-overlay">
      {error && (
        <>
          <p className="record-error">{error}</p>
          <button type="button" className="shell-btn" onClick={onClose}>
            close
          </button>
        </>
      )}
      {!error && phase === 'countdown' && (
        <div className="rec-row-wide">
          <span className="rec-count">{stream ? count || '●' : '…'}</span>
          <p className="rec-hint">
            get ready to read the highlighted section — esc cancels
          </p>
        </div>
      )}
      {!error && phase === 'live' && stream && (
        <>
          <p className="rec-hint">read the highlighted section</p>
          <Waveform stream={stream} />
          <div className="record-row">
            <span className="rec-elapsed">{elapsed}s</span>
            <button
              type="button"
              className="shell-btn primary rec-live"
              onClick={() => recorderRef.current?.stop()}
            >
              <Square size={12} /> stop
            </button>
          </div>
        </>
      )}
      {!error && (phase === 'review' || phase === 'saving') && (
        <>
          <p className="rec-hint">the take — you have to hear it once:</p>
          <audio controls src={previewUrl} />
          {bounds?.silent && <p className="record-error">that take sounds silent</p>}
          {trimmed > 0.2 && (
            <p className="rec-hint">
              will trim {trimmed.toFixed(1)}s of silence (keeping {bounds.t0.toFixed(1)}s →{' '}
              {bounds.t1.toFixed(1)}s)
            </p>
          )}
          <div className="record-row">
            <button
              type="button"
              className="shell-btn primary"
              disabled={phase === 'saving'}
              onClick={save}
            >
              <Check size={12} /> {phase === 'saving' ? 'saving…' : 'keep it'}
            </button>
            <button type="button" className="shell-btn" onClick={again}>
              <RotateCcw size={12} /> again
            </button>
            <button
              type="button"
              className="shell-btn"
              onClick={() => {
                killStream();
                onClose();
              }}
            >
              <Trash2 size={12} /> discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
