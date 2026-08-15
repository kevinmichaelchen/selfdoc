/**
 * Heat signals: derived writing lint over the rendered blocks. Nothing is
 * stored — it's a lens, recomputed on toggle, gone on toggle-off.
 */
const FILLER = new Set([
  'very',
  'really',
  'just',
  'actually',
  'basically',
  'literally',
  'simply',
  'clearly',
  'obviously',
  'moreover',
  'furthermore',
  'additionally',
  'notably',
  'ultimately',
  'delve',
  'leverage',
  'utilize',
  'robust',
  'seamless',
  'seamlessly',
  'comprehensive',
  'crucial',
  'pivotal',
]);

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  let groups = w.match(/[aeiouy]+/g)?.length ?? 1;
  if (groups > 1 && w.endsWith('e') && !w.endsWith('le')) groups--;
  return Math.max(1, groups);
}

export function analyzeBlock(el) {
  if (el.tagName === 'PRE') return null;
  const text = el.textContent.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 8) return null;

  const sentences = Math.max(1, (text.match(/[.!?](\s|$)/g) ?? []).length);
  const syllableCount = words.reduce((n, w) => n + syllables(w), 0);
  const wordsPerSentence = words.length / sentences;
  const syllablesPerWord = syllableCount / words.length;
  const flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const emDashes = (text.match(/—/g) ?? []).length;
  const filler = [
    ...new Set(
      words.map((w) => w.toLowerCase().replace(/[^a-z']/g, '')).filter((w) => FILLER.has(w)),
    ),
  ];

  const signals = [];
  if (words.length > 90) signals.push(`long: ${words.length} words`);
  if (wordsPerSentence > 28) signals.push(`run-on: ~${Math.round(wordsPerSentence)} words/sentence`);
  if (syllablesPerWord > 1.85) signals.push(`dense: ${syllablesPerWord.toFixed(2)} syllables/word`);
  if (flesch < 30) signals.push(`hard to read: Flesch ${Math.round(flesch)}`);
  if (emDashes >= 3) signals.push(`${emDashes} em dashes`);
  if (filler.length) signals.push(`filler: ${filler.join(', ')}`);
  if (!signals.length) return null;

  return { signals, level: signals.length >= 2 ? 2 : 1 };
}

export function analyzeAll() {
  const map = new Map();
  document.querySelectorAll('[data-edit-start]').forEach((el) => {
    const result = analyzeBlock(el);
    if (result) map.set(el, result);
  });
  return map;
}
