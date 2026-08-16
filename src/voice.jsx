import { AudioLines, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AUDIO_CHANGED, audioKey, audioUnits, listAudio } from './audio.js';
import {
  probeDevice,
  synthesizeMissing,
  TTS_MODEL,
  TTS_VARIANTS,
  TTS_VOICES,
} from './tts.js';

/**
 * The voice panel: what this machine can run, what the model actually is
 * (size, license, engine — up front, before any download), and the render
 * button that fills unread sections with clearly-marked synthetic speech.
 */
export function VoicePanel({ slug, onClose }) {
  const [probe, setProbe] = useState(null);
  const [dtype, setDtype] = useState(null);
  const [voice, setVoice] = useState('af_heart');
  const [missing, setMissing] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    probeDevice().then((p) => {
      setProbe(p);
      setDtype(p.recommended.dtype);
    });
  }, []);

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

  const render = async () => {
    setBusy(true);
    try {
      await synthesizeMissing(
        slug,
        { dtype, device: probe.recommended.device, voice },
        setStatus,
      );
    } catch (err) {
      setStatus(`failed — ${String(err).slice(0, 90)}`);
    } finally {
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
        <dt>license</dt>
        <dd>{TTS_MODEL.license}</dd>
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
      <label className="voice-row">
        voice
        <select value={voice} onChange={(e) => setVoice(e.target.value)}>
          {TTS_VOICES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {status && <p className="voice-status">{status}</p>}
      <button
        type="button"
        className="shell-btn primary"
        disabled={busy || !probe || !missing}
        onClick={render}
      >
        <AudioLines size={12} />{' '}
        {missing ? `render ${missing} unread section${missing === 1 ? '' : 's'}` : 'all sections narrated'}
      </button>
      <p className="rec-hint">
        Synthetic takes are marked as synthetic for readers and never count as
        your reading. Re-recording a section with your own voice replaces its
        synthetic take.
      </p>
    </div>
  );
}
