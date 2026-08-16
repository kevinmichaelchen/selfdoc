import {
  AUDIO_CHANGED,
  audioKey,
  audioUnits,
  findSpeechBounds,
  listAudio,
  saveRecording,
} from './audio.js';

/**
 * Synthetic narration, author-side: Kokoro-82M runs once in the dev page
 * (same pattern as whisper alignment), fills the sections the author hasn't
 * read, and saves ordinary takes flagged `tts` in meta. Readers and exports
 * never load a model — and synthetic sections are always marked as such;
 * a human re-record replaces them.
 */
export const TTS_MODEL = {
  name: 'Kokoro-82M',
  params: '82M parameters',
  type: 'StyleTTS2-class, ONNX',
  license: 'Apache-2.0',
  languages: 'English (American + British voices)',
  hf: 'https://huggingface.co/hexgrad/Kokoro-82M',
  repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
};

export const TTS_VARIANTS = [
  { dtype: 'q8', label: 'q8 — 92 MB download, best for WASM/CPU' },
  { dtype: 'fp16', label: 'fp16 — 163 MB, best on WebGPU' },
  { dtype: 'fp32', label: 'fp32 — 326 MB, reference quality' },
];

export const TTS_VOICES = [
  ['af_heart', 'Heart — American female (default)'],
  ['af_bella', 'Bella — American female'],
  ['af_nicole', 'Nicole — American female, soft'],
  ['af_sky', 'Sky — American female'],
  ['am_michael', 'Michael — American male'],
  ['am_adam', 'Adam — American male'],
  ['am_puck', 'Puck — American male'],
  ['bf_emma', 'Emma — British female'],
  ['bm_george', 'George — British male'],
  ['bm_fable', 'Fable — British male'],
];

/** What this machine can run, via the only capability APIs the web exposes. */
export async function probeDevice() {
  let adapter = null;
  if (navigator.gpu) {
    adapter = await navigator.gpu.requestAdapter().catch(() => null);
  }
  const probe = {
    webgpu: Boolean(adapter),
    f16: adapter?.features?.has('shader-f16') ?? false,
    maxBufferMB: Math.round((adapter?.limits?.maxBufferSize ?? 0) / 1_048_576),
    cores: navigator.hardwareConcurrency ?? 1,
    memoryGB: navigator.deviceMemory ?? null, // Chromium-only, clamped ≤ 8
    isolated: crossOriginIsolated,
  };
  probe.recommended =
    probe.webgpu && probe.maxBufferMB >= 256
      ? { device: 'webgpu', dtype: probe.f16 ? 'fp16' : 'fp32' }
      : { device: 'wasm', dtype: 'q8' };
  return probe;
}

// "Read accordingly": meaningful emoji get spoken names, decorative UI
// glyphs are dropped rather than read as garbage.
const EMOJI_WORDS = {
  '😕': 'confused face',
  '👏': 'applause',
  '📝': 'note',
  '✓': 'check',
  '❤️': 'heart',
  '🔥': 'fire',
  '⚠️': 'warning',
  '💡': 'idea',
  '👍': 'thumbs up',
  '👎': 'thumbs down',
  '🎉': 'celebration',
};

export function ttsText(el) {
  let text = el.textContent;
  for (const [emoji, word] of Object.entries(EMOJI_WORDS)) {
    text = text.replaceAll(emoji, ` ${word} `);
  }
  return text
    .replace(/[\p{Extended_Pictographic}️]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class Cancelled extends Error {}

/**
 * Re-encode synthesized PCM through MediaRecorder so synthetic takes are the
 * same 32 kbps opus/webm as human ones. Realtime by nature — MediaRecorder
 * can't run faster than the clock — which is why this phase gets a progress
 * bar and a cancel check.
 */
async function encodeOpus(float32, sampleRate, onPct, cancel) {
  const ctx = new AudioContext();
  const duration = float32.length / sampleRate;
  let cancelled = false;
  try {
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    const dest = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(dest);
    const recorder = new MediaRecorder(dest.stream, { audioBitsPerSecond: 32_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    source.onended = () => recorder.stop();
    const startedAt = ctx.currentTime;
    const ticker = setInterval(() => {
      onPct?.(Math.min(1, (ctx.currentTime - startedAt) / duration));
      if (cancel?.current && !cancelled) {
        cancelled = true;
        source.stop();
      }
    }, 150);
    recorder.start();
    source.start();
    await done;
    clearInterval(ticker);
    if (cancelled) throw new Cancelled();
    return new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  } finally {
    ctx.close();
  }
}

let ttsPromise = null;
let ttsConfig = '';

async function kokoroSynthesize({ dtype, device, voice }, text, onProgress, cancel) {
  const { KokoroTTS, TextSplitterStream } = await import('kokoro-js');
  const config = `${dtype}/${device}`;
  if (ttsConfig !== config) {
    ttsConfig = config;
    onProgress(`loading ${TTS_MODEL.name} (${dtype}, ${device})…`);
    ttsPromise = KokoroTTS.from_pretrained(TTS_MODEL.repo, {
      dtype,
      device,
      progress_callback: (p) => {
        if (p.status === 'progress' && p.file?.endsWith('.onnx')) {
          onProgress(`downloading voice model…`, (p.progress ?? 0) / 100);
        }
      },
    });
  }
  const tts = await ttsPromise;
  // Stream through the splitter so long sections stay under the model's
  // phoneme limit; concatenate the sentence chunks.
  const splitter = new TextSplitterStream();
  const stream = tts.stream(splitter, { voice });
  splitter.push(text);
  splitter.close();
  const parts = [];
  let sampleRate = 24_000;
  for await (const chunk of stream) {
    if (cancel?.current) throw new Cancelled();
    parts.push(chunk.audio.audio);
    sampleRate = chunk.audio.sampling_rate;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    pcm.set(part, offset);
    offset += part.length;
  }
  return { pcm, sampleRate };
}

// Cloud providers go through the dev middleware (no CORS, and the request
// shape stays in one place). Keys live in the author's localStorage only.
async function cloudSynthesize(provider, apiKey, cloudVoice, text) {
  const res = await fetch('/__tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, key: apiKey, voice: cloudVoice, text }),
  });
  if (!res.ok) throw new Error(`${provider}: ${(await res.text()).slice(0, 140)}`);
  return await res.blob();
}

export const PROVIDER_LABELS = {
  kokoro: 'Kokoro-82M',
  elevenlabs: 'ElevenLabs',
  fish: 'Fish Audio',
};

export async function synthesizeMissing(slug, options, onProgress, cancel) {
  if (import.meta.env.DEV) {
    const { provider = 'kokoro', voice, apiKey, cloudVoice } = options;
    const recorded = await listAudio(slug);
    const missing = audioUnits()
      .map((el) => ({ el, key: audioKey(el) }))
      .filter((unit) => !(unit.key in recorded));
    if (!missing.length) {
      onProgress('nothing to render — every section is narrated ✓');
      return;
    }

    let rendered = 0;
    try {
      for (const [i, unit] of missing.entries()) {
        if (cancel?.current) throw new Cancelled();
        const label = unit.el.textContent.trim().slice(0, 36);
        const text = ttsText(unit.el);
        if (!text) continue;

        let blob;
        if (provider === 'kokoro') {
          onProgress(`${i + 1}/${missing.length} · reading “${label}…”`);
          const { pcm, sampleRate } = await kokoroSynthesize(options, text, onProgress, cancel);
          onProgress(`${i + 1}/${missing.length} · encoding “${label}…”`, 0);
          blob = await encodeOpus(pcm, sampleRate, (pct) => {
            onProgress(`${i + 1}/${missing.length} · encoding “${label}…”`, pct);
          }, cancel);
        } else {
          onProgress(`${i + 1}/${missing.length} · requesting “${label}…”`);
          blob = await cloudSynthesize(provider, apiKey, cloudVoice, text);
        }
        if (cancel?.current) throw new Cancelled();

        const bounds = await findSpeechBounds(blob);
        await saveRecording(
          slug,
          unit.key,
          blob,
          bounds.silent ? null : { t0: bounds.t0, t1: bounds.t1 },
        );
        await fetch(`/__audio/${slug}/${unit.key}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tts: { model: PROVIDER_LABELS[provider] ?? provider, voice: voice ?? cloudVoice ?? '' },
          }),
        });
        rendered++;
        window.dispatchEvent(new Event(AUDIO_CHANGED));
      }
      onProgress(`rendered ${rendered} section(s) ✓`);
    } catch (err) {
      if (err instanceof Cancelled) {
        onProgress(`stopped — ${rendered} section(s) kept ✗`);
        return;
      }
      throw err;
    }
  }
}
