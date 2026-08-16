import {
  AUDIO_CHANGED,
  audioKey,
  audioUnits,
  audioUrl,
  findSpeechBounds,
  listAudio,
  saveRecording,
  tokensOf,
} from './audio.js';
import { alignTranscript, mergeSkips } from './audio-align.js';

/**
 * Author-side speech model, dev only: whisper-base.en via Transformers.js,
 * downloaded once and run on the author's machine at save time. Its output —
 * per-word timestamps and filler skips — lands in the take's meta beside the
 * trim bounds, so readers, exports, and the deployed site stay model-free.
 *
 * Known limitation (see ROADMAP "alignment robustness"): on some real-mic
 * takes whisper degenerates into repetition loops and alignment falls back
 * to the char-proportional estimate. Bounds and silence skips are unaffected
 * (they're RMS-based, no model involved).
 */
export const ALIGN_STATUS = 'selfdoc:align-status';

const say = (message) =>
  window.dispatchEvent(new CustomEvent(ALIGN_STATUS, { detail: message }));

let asrPromise = null;

async function toMono16k(blob) {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * 16_000), 16_000);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    ctx.close();
  }
}

/**
 * Repair/backfill: recompute trim bounds and word alignment for every take
 * that's missing them (e.g. recorded before alignment existed, or with
 * damaged meta). Dev console: `await __selfdocRealign('doc-slug')`.
 */
export async function realignAll(slug) {
  if (!import.meta.env.DEV) return 0;
  const recorded = await listAudio(slug);
  const units = audioUnits()
    .map((el) => ({ el, key: audioKey(el) }))
    .filter((unit) => unit.key in recorded && !recorded[unit.key]?.words);
  let fixed = 0;
  for (const unit of units) {
    say(`repairing ${++fixed}/${units.length}…`);
    const blob = await (await fetch(audioUrl(slug, unit.key))).blob();
    const bounds = await findSpeechBounds(blob);
    await saveRecording(
      slug,
      unit.key,
      blob,
      bounds.silent ? null : { t0: bounds.t0, t1: bounds.t1 },
    );
    await alignTake(slug, unit.key, blob, bounds, tokensOf(unit.el));
  }
  window.dispatchEvent(new Event(AUDIO_CHANGED));
  say(`repaired ${fixed} take(s) ✓`);
  return fixed;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__selfdocRealign = realignAll;
}

export async function alignTake(slug, key, blob, bounds, targetTokens) {
  if (import.meta.env.DEV) {
    try {
      say('loading speech model…');
      const { pipeline } = await import('@huggingface/transformers');
      // fp32 encoder + q4 decoder: the quantization combo that reliably
      // creates WASM sessions (plain q8 hits QDQ opset errors in ort-web).
      asrPromise ??= pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en_timestamped', {
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file?.endsWith('.onnx')) {
            say(`downloading speech model ${Math.round(p.progress ?? 0)}%`);
          }
        },
      });
      const asr = await asrPromise;
      say('aligning words to your voice…');
      const output = await asr(await toMono16k(blob), {
        return_timestamps: 'word',
        chunk_length_s: 30,
      });
      const transcript = (output.chunks ?? [])
        .filter((c) => Array.isArray(c.timestamp))
        .map((c) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] }));
      console.debug('[selfdoc] heard:', transcript.map((w) => w.text).join(''));
      const { times, fillerSkips } = alignTranscript(transcript, targetTokens);
      const skips = mergeSkips([...(bounds?.gaps ?? []), ...fillerSkips]);

      const payload = {};
      if (times) payload.words = times;
      if (skips.length) payload.skips = skips;
      if (Object.keys(payload).length) {
        await fetch(`/__audio/${slug}/${key}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        window.dispatchEvent(new Event(AUDIO_CHANGED));
      }
      say(
        times
          ? `word timing aligned${skips.length ? `, ${skips.length} skip(s)` : ''} ✓`
          : 'no clear speech match — keeping estimated timing ✓',
      );
    } catch (err) {
      say(`alignment failed — keeping estimated timing (${String(err).slice(0, 70)}) ✓`);
    }
  }
}
