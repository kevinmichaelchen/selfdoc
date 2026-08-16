import { AudioLines, Square, X } from 'lucide-react';
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

const PROVIDERS = [
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
  const [provider, setProvider] = useState(() => stored('selfdoc-tts-provider', 'kokoro'));
  const [envKeys, setEnvKeys] = useState({});
  const chosenRef = useRef(localStorage.getItem('selfdoc-tts-provider') != null);
  const [dtype, setDtype] = useState(null);
  const [voice, setVoice] = useState(() => stored('selfdoc-tts-voice', 'af_heart'));
  const [apiKey, setApiKey] = useState(() => stored(`selfdoc-tts-key-${stored('selfdoc-tts-provider', 'kokoro')}`));
  const [cloudVoice, setCloudVoice] = useState(() => stored('selfdoc-tts-cloud-voice'));
  const [missing, setMissing] = useState(0);
  const [status, setStatus] = useState('');
  const [pct, setPct] = useState(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef({ current: false });

  useEffect(() => {
    probeDevice().then((p) => {
      setProbe(p);
      setDtype(p.recommended.dtype);
    });
    // A key in the server environment makes its provider ready to use with
    // zero setup — and Fish is the default pick when the author never chose.
    serverKeys().then((keys) => {
      setEnvKeys(keys);
      if (!chosenRef.current && keys.fish) setProvider('fish');
    });
  }, []);

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
  const needsKey = provider !== 'kokoro';

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
          disabled={!probe || !missing || (needsKey && !apiKey.trim() && !envKeys[provider])}
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
    </div>
  );
}
