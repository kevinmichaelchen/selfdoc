import { AudioLines, Mic, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AUDIO_CHANGED, audioKey, audioUnits, listAudio } from './audio.js';
import {
  probeDevice,
  serverKeys,
  synthesizeMissing,
  TTS_MODEL,
  TTS_VARIANTS,
  TTS_VOICES,
} from './tts.js';
import { MIC_CONSTRAINTS, RECORDER_OPTIONS, Waveform } from './player.jsx';
import {
  buildReference,
  CALIBRATION_TEXT,
  realTakes,
  referenceInfo,
  saveCalibration,
} from './voice-ref.js';

const PROVIDERS = [
  {
    id: 'pocket',
    label: 'Pocket TTS — your voice, cloned locally',
    facts: null, // rendered inline with the reference flow
  },
  {
    id: 'kokoro',
    label: 'Kokoro-82M — local, free',
    facts: null, // rendered from TTS_MODEL
  },
  {
    id: 'fish',
    label: 'Fish Audio S1 — cloud, recommended',
    facts: {
      quality: 'top open-family vendor on Artificial Analysis arena',
      cost: '$15 per 1M characters, pay-as-you-go',
      privacy: 'text is sent to Fish Audio',
      voiceHint: 'reference/voice id (blank = default)',
    },
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs — cloud',
    facts: {
      quality: 'top tier on TTS Arena (closed model)',
      cost: 'subscription credits — billed to your account',
      privacy: 'text is sent to ElevenLabs',
      voiceHint: 'voice id (blank = Rachel)',
    },
  },
];

const stored = (key, fallback = '') => localStorage.getItem(key) ?? fallback;

/**
 * The voice panel: what this machine can run, what each engine actually is
 * (size, license, cost, where your text goes — up front, before anything
 * downloads or bills), and the render flow with progress and a stop button.
 */
export function VoicePanel({ slug, onClose }) {
  const [probe, setProbe] = useState(null);
  const [provider, setProvider] = useState(() => stored('selfdoc-tts-provider', 'pocket'));
  const [envKeys, setEnvKeys] = useState({});
  const [dtype, setDtype] = useState(null);
  const [voice, setVoice] = useState(() => stored('selfdoc-tts-voice', 'af_heart'));
  const [apiKey, setApiKey] = useState(() => stored(`selfdoc-tts-key-${stored('selfdoc-tts-provider', 'kokoro')}`));
  const [cloudVoice, setCloudVoice] = useState(() => stored('selfdoc-tts-cloud-voice'));
  const [missing, setMissing] = useState(0);
  const [voiceRef, setVoiceRef] = useState(null);
  const [takeCount, setTakeCount] = useState(0);
  const [calibrating, setCalibrating] = useState(false);
  const [status, setStatus] = useState('');
  const [pct, setPct] = useState(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef({ current: false });

  useEffect(() => {
    probeDevice().then((p) => {
      setProbe(p);
      setDtype(p.recommended.dtype);
    });
    // The author's own cloned voice is the default engine — the whole point
    // is hearing your words in something close to your voice.
    Promise.all([serverKeys(), referenceInfo()]).then(([keys, ref]) => {
      setEnvKeys(keys);
      setVoiceRef(ref);
    });
  }, []);

  useEffect(() => {
    const refresh = () => realTakes(slug).then((takes) => setTakeCount(takes.length));
    refresh();
    window.addEventListener(AUDIO_CHANGED, refresh);
    return () => window.removeEventListener(AUDIO_CHANGED, refresh);
  }, [slug]);

  useEffect(() => {
    localStorage.setItem('selfdoc-tts-provider', provider);
    setApiKey(stored(`selfdoc-tts-key-${provider}`));
  }, [provider]);

  useEffect(() => {
    const refresh = () => {
      const units = audioUnits().map(audioKey);
      listAudio(slug).then((recorded) => {
        setMissing(units.filter((key) => !(key in recorded)).length);
      });
    };
    refresh();
    window.addEventListener(AUDIO_CHANGED, refresh);
    return () => window.removeEventListener(AUDIO_CHANGED, refresh);
  }, [slug]);

  const meta = PROVIDERS.find((p) => p.id === provider);
  const needsKey = provider === 'elevenlabs' || provider === 'fish';
  const pocketReady = Boolean(envKeys.pocket && voiceRef?.exists);

  const rebuild = async () => {
    setBusy(true);
    try {
      const built = await buildReference(slug, setStatus);
      setVoiceRef(await referenceInfo());
      setStatus(`voice reference built: ${Math.round(built.seconds)}s from ${built.takes} take(s) ✓`);
    } catch (err) {
      setStatus(`reference failed — ${String(err.message ?? err).slice(0, 110)}`);
    } finally {
      setBusy(false);
    }
  };

  const render = async () => {
    setBusy(true);
    setPct(null);
    cancelRef.current.current = false;
    try {
      await synthesizeMissing(
        slug,
        {
          provider,
          dtype,
          device: probe.recommended.device,
          voice,
          apiKey,
          cloudVoice: cloudVoice.trim(),
        },
        (text, fraction = null) => {
          setStatus(text);
          setPct(fraction);
        },
        cancelRef.current,
      );
    } catch (err) {
      setStatus(`failed — ${String(err).slice(0, 110)}`);
    } finally {
      setPct(null);
      setBusy(false);
    }
  };

  return (
    <div className="comment-panel voice-panel">
      <div className="comment-head">
        <span className="toc-eyebrow">Synthetic voice</span>
        <button type="button" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <label className="voice-row">
        engine
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {provider === 'pocket' && (
        <>
          <dl className="voice-facts">
            <dt>model</dt>
            <dd>
              <a href="https://github.com/kyutai-labs/pocket-tts" target="_blank" rel="noreferrer">
                Kyutai Pocket TTS
              </a>{' '}
              · 100M params
            </dd>
            <dt>runs</dt>
            <dd>on this machine — your voice and text never leave it</dd>
            <dt>cost</dt>
            <dd>free · MIT code, gated weights (one-time terms on Hugging Face)</dd>
          </dl>
          {!envKeys.pocket && (
            <p className="voice-probe">
              needs{' '}
              <a href="https://docs.astral.sh/uv/" target="_blank" rel="noreferrer">
                uv
              </a>{' '}
              on your PATH — the worker runs via “uv run --with pocket-tts”
            </p>
          )}
          {voiceRef?.exists ? (
            <p className="voice-probe">
              voice reference: {voiceRef.seconds}s{' '}
              {voiceRef.takes[0] === 'calibration'
                ? 'from a calibration read'
                : `from ${voiceRef.takes.length} of your real takes`}{' '}
              ✓
            </p>
          ) : (
            <p className="voice-probe">
              no voice reference yet — do the ~25s calibration read, or build one from your
              recordings ({takeCount} usable in this doc)
            </p>
          )}
          <div className="record-row">
            <button
              type="button"
              className="shell-btn"
              disabled={busy}
              onClick={() => setCalibrating(true)}
            >
              <Mic size={12} /> calibration read (~25s)
            </button>
            <button
              type="button"
              className="shell-btn"
              disabled={busy || !takeCount}
              onClick={rebuild}
            >
              build from takes
            </button>
          </div>
          <details className="voice-adv">
            <summary>first-time setup</summary>
            <p className="rec-hint">
              Cloning weights are gated: accept the terms at{' '}
              <a
                href="https://huggingface.co/kyutai/pocket-tts"
                target="_blank"
                rel="noreferrer"
              >
                huggingface.co/kyutai/pocket-tts
              </a>
              , then run “uvx hf auth login” once. The first render downloads the model and
              takes a few minutes; after that it stays warm.
            </p>
          </details>
        </>
      )}

      {provider === 'kokoro' && (
        <>
          {probe && (
            <p className="voice-probe">
              this machine: {probe.webgpu ? `WebGPU ✓ (${probe.maxBufferMB} MB buffers` : 'no WebGPU ('}
              {probe.webgpu && probe.f16 ? ', f16' : ''}) · {probe.cores} cores
              {probe.memoryGB ? ` · ~${probe.memoryGB} GB` : ''} → recommended:{' '}
              <strong>
                {probe.recommended.device} / {probe.recommended.dtype}
              </strong>
            </p>
          )}
          <label className="voice-row">
            voice
            <select
              value={voice}
              onChange={(e) => {
                setVoice(e.target.value);
                localStorage.setItem('selfdoc-tts-voice', e.target.value);
              }}
            >
              {TTS_VOICES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <details className="voice-adv">
            <summary>
              model details — {TTS_MODEL.params} · {TTS_MODEL.license}
            </summary>
            <dl className="voice-facts">
              <dt>model</dt>
              <dd>
                <a href={TTS_MODEL.hf} target="_blank" rel="noreferrer">
                  {TTS_MODEL.name}
                </a>{' '}
                · {TTS_MODEL.params}
              </dd>
              <dt>engine</dt>
              <dd>{TTS_MODEL.type}</dd>
              <dt>languages</dt>
              <dd>{TTS_MODEL.languages}</dd>
            </dl>
            <label className="voice-row">
              variant
              <select value={dtype ?? ''} onChange={(e) => setDtype(e.target.value)}>
                {TTS_VARIANTS.map((v) => (
                  <option key={v.dtype} value={v.dtype}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </details>
        </>
      )}

      {needsKey && (
        <>
          <dl className="voice-facts">
            <dt>quality</dt>
            <dd>{meta.facts.quality}</dd>
            <dt>cost</dt>
            <dd>{meta.facts.cost}</dd>
            <dt>privacy</dt>
            <dd>{meta.facts.privacy}</dd>
          </dl>
          {envKeys[provider] ? (
            <p className="voice-probe">
              API key: from the server environment ✓ — the browser never holds it
            </p>
          ) : (
            <input
              className="voice-key"
              type="password"
              placeholder="API key (better: set it in the server env — see docs/adr/0002)"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                localStorage.setItem(`selfdoc-tts-key-${provider}`, e.target.value);
              }}
            />
          )}
          <details className="voice-adv">
            <summary>voice override</summary>
            <input
              className="voice-key"
              type="text"
              placeholder={meta.facts.voiceHint}
              value={cloudVoice}
              onChange={(e) => {
                setCloudVoice(e.target.value);
                localStorage.setItem('selfdoc-tts-cloud-voice', e.target.value);
              }}
            />
          </details>
        </>
      )}

      {status && <p className="voice-status">{status}</p>}
      {pct != null && (
        <div className="voice-bar">
          <div style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
      )}

      {busy ? (
        <button
          type="button"
          className="shell-btn"
          onClick={() => {
            cancelRef.current.current = true;
            setStatus('stopping…');
          }}
        >
          <Square size={12} /> stop
        </button>
      ) : (
        <button
          type="button"
          className="shell-btn primary"
          disabled={
            !probe ||
            !missing ||
            (needsKey && !apiKey.trim() && !envKeys[provider]) ||
            (provider === 'pocket' && !pocketReady)
          }
          onClick={render}
        >
          <AudioLines size={12} />{' '}
          {missing
            ? `render ${missing} unread section${missing === 1 ? '' : 's'}`
            : 'all sections narrated'}
        </button>
      )}
      <p className="rec-hint">
        Synthetic takes are marked as synthetic for readers and never count as
        your reading. Re-recording a section with your own voice replaces its
        synthetic take.
      </p>
      {calibrating && (
        <CalibrationFlow
          onClose={() => setCalibrating(false)}
          onDone={async (seconds) => {
            setCalibrating(false);
            setVoiceRef(await referenceInfo());
            setStatus(`calibration reference saved: ${Math.round(seconds)}s ✓`);
          }}
        />
      )}
    </div>
  );
}

/**
 * The calibration ritual, same shape as recording a section: countdown,
 * live waveform while you read the passage, then a forced listen before
 * keep-or-discard. One clean read becomes the whole cloning reference.
 */
function CalibrationFlow({ onClose, onDone }) {
  const [phase, setPhase] = useState('countdown'); // countdown | live | review | saving
  const [count, setCount] = useState(3);
  const [stream, setStream] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState('');
  const recorderRef = useRef(null);
  const blobRef = useRef(null);

  const killStream = () => {
    recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia(MIC_CONSTRAINTS)
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        setStream(s);
      })
      .catch((err) => setError(`microphone unavailable — ${err.message}`));
    return () => {
      cancelled = true;
      killStream();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'countdown' || !stream) return;
    if (count === 0) {
      const recorder = new MediaRecorder(stream, RECORDER_OPTIONS);
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => {
        blobRef.current = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setPreviewUrl(URL.createObjectURL(blobRef.current));
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

  const save = async () => {
    setPhase('saving');
    try {
      const { seconds } = await saveCalibration(blobRef.current);
      killStream();
      onDone(seconds);
    } catch (err) {
      setError(String(err.message ?? err).slice(0, 110));
      setPhase('review');
    }
  };

  return (
    <div className="rec-dock rec-overlay">
      <p className="calib-text">“{CALIBRATION_TEXT}”</p>
      {error && <p className="record-error">{error}</p>}
      {!error && phase === 'countdown' && (
        <div className="rec-row-wide">
          <span className="rec-count">{stream ? count || '●' : '…'}</span>
          <p className="rec-hint">read the passage above, naturally — don’t flatten it</p>
        </div>
      )}
      {phase === 'live' && stream && (
        <>
          <Waveform stream={stream} />
          <button
            type="button"
            className="shell-btn primary rec-live"
            onClick={() => recorderRef.current?.stop()}
          >
            <Square size={12} /> done reading
          </button>
        </>
      )}
      {(phase === 'review' || phase === 'saving') && (
        <>
          <p className="rec-hint">your voice, once through the ear:</p>
          <audio controls src={previewUrl} />
          <div className="record-row">
            <button
              type="button"
              className="shell-btn primary"
              disabled={phase === 'saving'}
              onClick={save}
            >
              {phase === 'saving' ? 'saving…' : 'use as my voice'}
            </button>
            <button
              type="button"
              className="shell-btn"
              onClick={() => {
                killStream();
                onClose();
              }}
            >
              discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
