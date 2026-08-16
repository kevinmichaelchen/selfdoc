/**
 * Forced alignment of an imperfect transcript onto the known section text.
 * Pure functions, no DOM, no vite — unit-testable in Node.
 *
 * The trick that makes this easy: we don't need a good transcription, we
 * already know what was read. Edit-distance alignment maps each transcript
 * word (which carries a timestamp) onto a target word; substitutions still
 * donate their timing, unmatched targets interpolate, and transcript-only
 * insertions that look like disfluencies become skip ranges.
 */
const FILLERS = new Set(['um', 'uh', 'uhm', 'umm', 'erm', 'er', 'ah', 'hmm', 'hm', 'mm', 'mmm']);

export const normalizeWord = (word) =>
  word
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9']/g, '');

/**
 * @param transcript [{text, start, end}] — words with timestamps (seconds)
 * @param targets [string] — the section's word tokens, in span order
 * @returns {times: number[]|null, fillerSkips: [number,number][]}
 */
export function alignTranscript(transcript, targets) {
  const spoken = transcript
    .map((w) => ({ ...w, norm: normalizeWord(w.text) }))
    .filter((w) => w.norm && Number.isFinite(w.start));
  const targetNorms = targets.map(normalizeWord);
  const m = spoken.length;
  const n = targetNorms.length;
  if (!m || !n) return { times: null, fillerSkips: [] };

  // Edit-distance DP with backtrace: rows = spoken words, cols = targets.
  const cost = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) cost[i][0] = i;
  for (let j = 1; j <= n; j++) cost[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const match = spoken[i - 1].norm === targetNorms[j - 1] ? 0 : 1;
      cost[i][j] = Math.min(
        cost[i - 1][j - 1] + match,
        cost[i - 1][j] + 1, // spoken word matches no target (insertion)
        cost[i][j - 1] + 1, // target word never spoken (deletion)
      );
    }
  }

  const times = new Array(n).fill(null);
  let exact = 0;
  const fillerSkips = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const match = spoken[i - 1].norm === targetNorms[j - 1] ? 0 : 1;
    if (cost[i][j] === cost[i - 1][j - 1] + match) {
      // Match or substitution: either way the timing belongs to this target.
      times[j - 1] = spoken[i - 1].start;
      if (match === 0) exact++;
      i--;
      j--;
    } else if (cost[i][j] === cost[i - 1][j] + 1) {
      const extra = spoken[i - 1];
      if (FILLERS.has(extra.norm) && Number.isFinite(extra.end)) {
        fillerSkips.push([Math.max(0, extra.start - 0.03), extra.end + 0.03]);
      }
      i--;
    } else {
      j--;
    }
  }
  while (i > 0) {
    const extra = spoken[i - 1];
    if (FILLERS.has(extra.norm) && Number.isFinite(extra.end)) {
      fillerSkips.push([Math.max(0, extra.start - 0.03), extra.end + 0.03]);
    }
    i--;
  }
  fillerSkips.reverse();

  // Too little agreement means the timing would be noise, not signal.
  if (exact / n < 0.5) return { times: null, fillerSkips };

  // Interpolate unmatched targets between their timed neighbors.
  let firstKnown = times.findIndex((t) => t != null);
  for (let k = 0; k < firstKnown; k++) times[k] = times[firstKnown];
  let prev = firstKnown;
  for (let k = firstKnown + 1; k < n; k++) {
    if (times[k] == null) continue;
    const span = k - prev;
    for (let g = 1; g < span; g++) {
      times[prev + g] = times[prev] + ((times[k] - times[prev]) * g) / span;
    }
    prev = k;
  }
  for (let k = prev + 1; k < n; k++) times[k] = times[prev];

  // Monotonic, rounded.
  for (let k = 1; k < n; k++) times[k] = Math.max(times[k], times[k - 1]);
  return { times: times.map((t) => Math.round(t * 100) / 100), fillerSkips };
}

/** Sort, clamp, and merge overlapping/adjacent skip ranges. */
export function mergeSkips(ranges) {
  const sorted = ranges
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e - s > 0.05)
    .map(([s, e]) => [Math.round(s * 100) / 100, Math.round(e * 100) / 100])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 0.05) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}
