import { audioUrl, findSpeechBounds, listAudio } from './audio.js';

/**
 * A purpose-made ~25-second read for voice cloning, designed to spend
 * Pocket's 30s prompt budget well. What it packs in:
 * - phoneme coverage: the rare fricatives (/ʒ/ pleasure, measures; /θ/
 *   three, thirty, things; /ð/ the, this), affricates (/dʒ/ jumps, joyful,
 *   gentle; /tʃ/ choose, each), /ŋ/ (singing, ending), and every English
 *   diphthong (rainbow, like, sound, voice, joyful);
 * - prosodic variety, which a state-based clone actually captures: a plain
 *   statement, a genuine question (rising melody), an exclamation, an
 *   imperative with a dynamics contrast, and a list-final cadence.
 * One monotone paragraph clones a monotone; this passage doesn't let you
 * read it flat.
 */
export const CALIBRATION_TEXT =
  'When the sunlight strikes raindrops in the air, they act as a prism and ' +
  'form a rainbow. Ask yourself a question: does this voice truly sound ' +
  'like me? The quick brown fox jumps over the lazy dog — and, with ' +
  'pleasure, measures each leap! Choose a gentle phrase, then shout the ' +
  'joyful ending. Three thousand and thirty-three things, singing all the ' +
  'while.';

// Research consensus on cloning reference length: 6–10s captures the core of
// a voice, gains are notable up to ~20s, then plateau. Clean beats long —
// the model reproduces the sample's recording quality too — so the reference
// uses trimmed speech with pause-skips cut out, never raw takes.
const TARGET_SECONDS = 20;
const CAP_SECONDS = 28;

/** What the server has: {exists, seconds, takes, builtAt} or {exists:false}. */
export async function referenceInfo() {
  try {
    return await (await fetch('/__voice')).json();
  } catch {
    return { exists: false };
  }
}

/** The takes eligible as cloning material: the author's real voice only. */
export async function realTakes(slug) {
  const recorded = await listAudio(slug);
  return Object.entries(recorded)
    .filter(([, meta]) => meta && !meta.tts && meta.t1 > meta.t0)
    .map(([key, meta]) => ({ key, meta }));
}

/**
 * Assemble ~20s of the author's cleanest speech from their real takes and
 * save it as the cloning reference: decode each take, keep only the trimmed
 * span minus pause-skips, resample everything to 24 kHz mono (Pocket's
 * native rate), and upload one wav.
 */
export async function buildReference(slug, onProgress = () => {}) {
  const takes = await realTakes(slug);
  if (!takes.length) throw new Error('no real takes to clone from — record some sections first');

  const ctx = new AudioContext();
  const picked = [];
  const usedKeys = [];
  let total = 0;
  try {
    for (const { key, meta } of takes) {
      if (total >= TARGET_SECONDS) break;
      onProgress(`gathering your voice… ${Math.round(total)}s`);
      let buffer;
      try {
        const res = await fetch(audioUrl(slug, key));
        buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        continue;
      }
      const t0 = Math.min(meta.t0 ?? 0, buffer.duration);
      const t1 = Math.min(meta.t1 ?? buffer.duration, buffer.duration);
      const skips = (meta.skips ?? [])
        .map(([s, e]) => [Math.max(s, t0), Math.min(e, t1)])
        .filter(([s, e]) => e > s)
        .sort((a, b) => a[0] - b[0]);
      const segments = [];
      let cursor = t0;
      for (const [s, e] of skips) {
        if (s > cursor) segments.push([cursor, s]);
        cursor = Math.max(cursor, e);
      }
      if (t1 > cursor) segments.push([cursor, t1]);
      let added = 0;
      for (const [s, e] of segments) {
        if (total >= CAP_SECONDS) break;
        const len = Math.min(e - s, CAP_SECONDS - total);
        picked.push({ buffer, from: s, len });
        total += len;
        added += len;
      }
      if (added > 0) usedKeys.push(key);
    }
  } finally {
    ctx.close();
  }
  if (total < 3) throw new Error('under 3s of usable speech — record a longer section first');

  onProgress('mixing the reference…');
  await renderAndUpload(picked, total, usedKeys.join(','));
  return { seconds: total, takes: usedKeys.length };
}

/**
 * One deliberate read of CALIBRATION_TEXT becomes the whole reference:
 * silence-trimmed, long pauses cut, resampled like everything else.
 */
export async function saveCalibration(blob) {
  const bounds = await findSpeechBounds(blob);
  if (bounds.silent) throw new Error('that take sounds silent');
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const t0 = Math.min(bounds.t0 ?? 0, buffer.duration);
    const t1 = Math.min(bounds.t1 ?? buffer.duration, buffer.duration);
    const gaps = (bounds.gaps ?? [])
      .map(([s, e]) => [Math.max(s, t0), Math.min(e, t1)])
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    const picked = [];
    let total = 0;
    let cursor = t0;
    for (const [s, e] of gaps) {
      if (s > cursor) {
        picked.push({ buffer, from: cursor, len: s - cursor });
        total += s - cursor;
      }
      cursor = Math.max(cursor, e);
    }
    if (t1 > cursor) {
      picked.push({ buffer, from: cursor, len: t1 - cursor });
      total += t1 - cursor;
    }
    if (total < 3) throw new Error('under 3s of usable speech in that read');
    await renderAndUpload(picked, Math.min(total, CAP_SECONDS), 'calibration');
    return { seconds: total };
  } finally {
    ctx.close();
  }
}

async function renderAndUpload(picked, total, takes) {
  const rate = 24_000;
  const offline = new OfflineAudioContext(1, Math.ceil(total * rate) + rate, rate);
  let when = 0;
  for (const { buffer, from, len } of picked) {
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(when, from, len);
    when += len;
  }
  const rendered = await offline.startRendering();
  const wav = pcm16Wav(rendered.getChannelData(0).subarray(0, Math.ceil(total * rate)), rate);
  const query = new URLSearchParams({ seconds: total.toFixed(1), takes });
  const res = await fetch(`/__voice?${query}`, { method: 'POST', body: wav });
  if (!res.ok) throw new Error(await res.text());
}

/** Minimal 16-bit mono WAV writer. */
function pcm16Wav(float32, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + float32.length * 2));
  const ascii = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + float32.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, float32.length * 2, true);
  for (let i = 0; i < float32.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, float32[i])) * 32767, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}
