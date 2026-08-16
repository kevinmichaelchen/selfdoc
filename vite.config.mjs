import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import remarkGfm from 'remark-gfm';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { rehypeSourcePos } from './plugins/rehype-source-pos.mjs';

const ROOT = import.meta.dirname;
const CONTENT = path.resolve(ROOT, 'content');
const PROV_DIR = path.join(CONTENT, 'provenance');
const AUDIO_DIR = path.join(CONTENT, 'audio');

const SLUG = /^[a-z0-9_-]+$/i;
// Cloud TTS keys, resolved from the environment so secrets stay out of the
// browser entirely. secretspec.toml declares these for secret managers.
const TTS_ENV_KEYS = { elevenlabs: 'ELEVENLABS_API_KEY', fish: 'FISH_API_KEY' };
const AUDIO_KEY = /^[a-z0-9]+$/;
const docFile = (doc) => path.join(CONTENT, `${doc}.mdx`);

// --- provenance ---------------------------------------------------------

function readProvenance(doc) {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROV_DIR, `${doc}.json`), 'utf8'));
  } catch {
    return {};
  }
}

const COUNTERS = [
  'sessions',
  'readingMs',
  'editingMs',
  'edits',
  'typedChars',
  'pastedChars',
  'wordsAdded',
  'wordsRemoved',
];

function bumpProvenance(doc, patch) {
  const prev = readProvenance(doc);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const merged = Object.fromEntries(
    COUNTERS.map((key) => [key, (prev[key] ?? 0) + (patch[key] ?? 0)]),
  );
  merged.days = (prev.days ?? 0) + (prev.lastDay === today ? 0 : 1);
  merged.lastDay = today;
  merged.firstSeen = prev.firstSeen ?? now;
  merged.lastSeen = now;
  fs.mkdirSync(PROV_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROV_DIR, `${doc}.json`), `${JSON.stringify(merged, null, 2)}\n`);
}

function allProvenance() {
  const map = {};
  try {
    for (const file of fs.readdirSync(PROV_DIR)) {
      if (file.endsWith('.json')) map[file.replace(/\.json$/, '')] = readProvenance(file.replace(/\.json$/, ''));
    }
  } catch {
    // no provenance yet
  }
  return map;
}

const countWords = (text) => (text.trim().match(/\S+/g) ?? []).length;

// --- narration ----------------------------------------------------------

function audioFile(doc, key) {
  return path.join(AUDIO_DIR, doc, `${key}.webm`);
}

function audioKeys(doc) {
  try {
    return fs
      .readdirSync(path.join(AUDIO_DIR, doc))
      .filter((f) => f.endsWith('.webm'))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

const metaFile = (doc) => path.join(AUDIO_DIR, doc, 'meta.json');

function readAudioMeta(doc) {
  try {
    return JSON.parse(fs.readFileSync(metaFile(doc), 'utf8'));
  } catch {
    return {};
  }
}

function writeAudioMeta(doc, meta) {
  fs.writeFileSync(metaFile(doc), `${JSON.stringify(meta, null, 2)}\n`);
}

/** key → trim bounds ({t0, t1}) or null for untrimmed takes. */
function audioIndex(doc) {
  const meta = readAudioMeta(doc);
  return Object.fromEntries(audioKeys(doc).map((key) => [key, meta[key] ?? null]));
}

function allAudioIndex() {
  try {
    return Object.fromEntries(
      fs
        .readdirSync(AUDIO_DIR)
        .filter((d) => SLUG.test(d))
        .map((d) => [d, audioIndex(d)]),
    );
  } catch {
    return {};
  }
}

// --- voice cloning (Pocket TTS) -----------------------------------------

// The author's voice reference: ~20s assembled client-side from their real
// takes (research: 6–10s captures the core of a voice, gains plateau ~20s).
// Pocket TTS clones from it locally via a long-lived Python worker.
const VOICE_DIR = path.join(CONTENT, 'voice');
const VOICE_REF = path.join(VOICE_DIR, 'reference.wav');
const VOICE_META = path.join(VOICE_DIR, 'reference.json');

let uvOk = null;
function pocketRuntimeOk() {
  uvOk ??= spawnSync('uv', ['--version']).status === 0;
  return uvOk;
}

let pocket = null; // { proc, ready, pending }
let pocketSeq = 0;
let pocketQueue = Promise.resolve();

function startPocketWorker() {
  if (pocket) return pocket.ready;
  const proc = spawn(
    'uv',
    ['run', '--with', 'pocket-tts', 'python', path.join(ROOT, 'scripts/pocket_worker.py'), VOICE_REF],
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const state = { proc, pending: [] };
  state.ready = new Promise((resolve, reject) => {
    proc.on('error', (err) => {
      pocket = null;
      reject(err);
    });
    proc.on('exit', (code) => {
      pocket = null;
      reject(new Error(`pocket worker exited (${code})`));
      state.pending.splice(0).forEach((p) => p.reject(new Error('pocket worker exited')));
    });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.ready) return resolve();
      if (msg.fatal) {
        pocket = null;
        return reject(new Error(msg.fatal));
      }
      state.pending.shift()?.[msg.error ? 'reject' : 'resolve'](
        msg.error ? new Error(msg.error) : msg,
      );
    });
  });
  pocket = state;
  return state.ready;
}

function stopPocketWorker() {
  pocket?.proc.kill();
  pocket = null;
}

/** One synthesis request; serialized, model+voice state stay hot in memory. */
function pocketSynthesize(text) {
  const job = pocketQueue.then(async () => {
    // First start downloads deps + weights — allow it plenty of time.
    await withTimeout(startPocketWorker(), 900_000, 'pocket worker start');
    const out = path.join(os.tmpdir(), `selfdoc-pocket-${process.pid}-${pocketSeq++}.wav`);
    const reply = withTimeout(
      new Promise((resolve, reject) => pocket.pending.push({ resolve, reject })),
      300_000,
      'pocket synthesis',
    );
    pocket.proc.stdin.write(`${JSON.stringify({ text, out })}\n`);
    await reply;
    const wav = fs.readFileSync(out);
    fs.rmSync(out, { force: true });
    return wav;
  });
  pocketQueue = job.catch(stopPocketWorker); // a wedged worker restarts fresh
  return job;
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    }),
  ]);
}

// --- per-document export ------------------------------------------------

// Exports are per-document: `pnpm export` builds the default doc,
// `DOC=colophon pnpm export` builds another, `AUDIO=1` bundles narration.
// The single-doc module rewrite below keeps every other draft out of the
// exported bundle entirely.
function exportDocSlug() {
  if (process.env.DOC) return process.env.DOC;
  const slugs = fs
    .readdirSync(CONTENT)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => f.replace(/\.mdx$/, ''));
  if (slugs.includes('building-selfdoc')) return 'building-selfdoc';
  return slugs.includes('doc') ? 'doc' : slugs[0];
}
const EXPORT_DOC = process.env.SINGLEFILE ? exportDocSlug() : null;
const EXPORT_AUDIO = Boolean(EXPORT_DOC && process.env.AUDIO);
if (EXPORT_DOC && !fs.existsSync(docFile(EXPORT_DOC))) {
  throw new Error(`DOC=${EXPORT_DOC}: no content/${EXPORT_DOC}.mdx`);
}

function singleDocOnly() {
  return {
    name: 'selfdoc-single-doc',
    enforce: 'pre',
    transform(_code, id) {
      if (!EXPORT_DOC || !id.endsWith('/src/docs.js')) return null;
      return `
import Doc from '../content/${EXPORT_DOC}.mdx';
import raw from '../content/${EXPORT_DOC}.mdx?raw';
export const docs = { '${EXPORT_DOC}': Doc };
export const sources = { '${EXPORT_DOC}': raw };
export const DEFAULT_DOC = '${EXPORT_DOC}';
export function docMeta() {
  return { title: '${EXPORT_DOC}', excerpt: '', minutes: 1 };
}
`;
    },
    closeBundle() {
      if (!EXPORT_DOC) return;
      const dist = path.resolve(ROOT, 'dist');
      fs.renameSync(path.join(dist, 'index.html'), path.join(dist, `${EXPORT_DOC}.html`));
    },
  };
}

// The multi-doc site (dev preview, GitHub Pages) serves narration as static
// files next to the bundle instead of inlining it.
function copyAudioToDist() {
  return {
    name: 'selfdoc-copy-audio',
    apply: 'build',
    closeBundle() {
      if (EXPORT_DOC || !fs.existsSync(AUDIO_DIR)) return;
      fs.cpSync(AUDIO_DIR, path.resolve(ROOT, 'dist/audio'), { recursive: true });
    },
  };
}

// @mdx-js/rollup strips queries when matching, so without this guard it would
// also compile `doc.mdx?raw` imports — which must stay raw source strings for
// the copy-as-markdown button.
function mdxSkippingQueries() {
  const plugin = mdx({ remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSourcePos] });
  return {
    ...plugin,
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('?')) return null;
      return plugin.transform.call(this, code, id);
    },
  };
}

// --- dev middleware -----------------------------------------------------

function readBody(req, onDone) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 25_000_000) return req.destroy();
    chunks.push(chunk);
  });
  req.on('end', () => onDone(Buffer.concat(chunks)));
}

/**
 * The self-editing half: dev-only endpoints. /__save splices edits into the
 * .mdx source (ranges come from compiler stamps; start === end inserts) and
 * bumps provenance server-side. /__provenance merges time heartbeats.
 * /__audio stores per-section narration. /__export runs a per-doc build and
 * streams the result. Everything is allowlisted to slug-named files inside
 * content/.
 */
function selfServe() {
  return {
    name: 'selfdoc-serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readBody(req, (body) => {
          try {
            const { doc = 'doc', start, end, markdown } = JSON.parse(body.toString('utf8'));
            if (typeof doc !== 'string' || !SLUG.test(doc) || !fs.existsSync(docFile(doc))) {
              res.statusCode = 400;
              return res.end('bad doc');
            }
            const src = fs.readFileSync(docFile(doc), 'utf8');
            const valid =
              Number.isInteger(start) &&
              Number.isInteger(end) &&
              start >= 0 &&
              end <= src.length &&
              start <= end &&
              typeof markdown === 'string';
            if (!valid) {
              res.statusCode = 400;
              return res.end('bad range');
            }
            fs.writeFileSync(docFile(doc), src.slice(0, start) + markdown + src.slice(end));
            // Word deltas come from the splice that actually landed, not from
            // anything the client claims.
            const before = countWords(src.slice(start, end));
            const after = countWords(markdown);
            bumpProvenance(doc, {
              edits: 1,
              wordsAdded: Math.max(0, after - before),
              wordsRemoved: Math.max(0, before - after),
            });
            res.end('ok');
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });

      server.middlewares.use('/__provenance', (req, res) => {
        if (req.method === 'GET') {
          const doc = new URLSearchParams(req.url.split('?')[1] ?? '').get('doc') ?? '';
          if (!SLUG.test(doc)) {
            res.statusCode = 400;
            return res.end('bad doc');
          }
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(readProvenance(doc)));
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readBody(req, (body) => {
          try {
            const { doc, readingMs, editingMs, sessions, typedChars, pastedChars } = JSON.parse(
              body.toString('utf8'),
            );
            if (typeof doc !== 'string' || !SLUG.test(doc) || !fs.existsSync(docFile(doc))) {
              res.statusCode = 400;
              return res.end('bad doc');
            }
            const clamp = (n, max) => Math.min(Math.max(Number(n) || 0, 0), max);
            const reading = clamp(readingMs, 3_600_000);
            bumpProvenance(doc, {
              readingMs: reading,
              editingMs: clamp(editingMs, reading),
              sessions: sessions ? 1 : 0,
              typedChars: clamp(typedChars, 200_000),
              pastedChars: clamp(pastedChars, 1_000_000),
            });
            res.end('ok');
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });

      server.middlewares.use('/__audio', (req, res) => {
        const [route, query] = req.url.split('?');
        if (req.method === 'GET' && (route === '' || route === '/')) {
          const doc = new URLSearchParams(query ?? '').get('doc') ?? '';
          if (!SLUG.test(doc)) {
            res.statusCode = 400;
            return res.end('bad doc');
          }
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(audioIndex(doc)));
        }
        const match = route.match(/^\/([^/]+)\/([^/]+)$/);
        const doc = match?.[1] ?? '';
        const key = match?.[2] ?? '';
        if (!SLUG.test(doc) || !AUDIO_KEY.test(key) || !fs.existsSync(docFile(doc))) {
          res.statusCode = 400;
          return res.end('bad target');
        }
        const file = audioFile(doc, key);
        if (req.method === 'GET') {
          if (!fs.existsSync(file)) {
            res.statusCode = 404;
            return res.end();
          }
          res.setHeader('content-type', 'audio/webm');
          return fs.createReadStream(file).pipe(res);
        }
        if (req.method === 'POST') {
          return readBody(req, (body) => {
            if (!body.length) {
              res.statusCode = 400;
              return res.end('empty');
            }
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, body);
            const params = new URLSearchParams(query ?? '');
            const t0 = Number(params.get('t0'));
            const t1 = Number(params.get('t1'));
            const meta = readAudioMeta(doc);
            if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 && t0 >= 0) {
              meta[key] = { t0, t1 };
            } else {
              delete meta[key];
            }
            writeAudioMeta(doc, meta);
            res.end('ok');
          });
        }
        // Alignment results (word timestamps, skip ranges) merge into the
        // take's meta after the fact.
        if (req.method === 'PUT') {
          return readBody(req, (body) => {
            try {
              const { words, skips, tts, heard } = JSON.parse(body.toString('utf8'));
              const patch = {};
              if (
                Array.isArray(words) &&
                words.length <= 5000 &&
                words.every((t) => Number.isFinite(t))
              ) {
                patch.words = words;
              }
              if (
                Array.isArray(skips) &&
                skips.length <= 500 &&
                skips.every(
                  (r) =>
                    Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0],
                )
              ) {
                patch.skips = skips;
              }
              if (tts && typeof tts.model === 'string' && typeof tts.voice === 'string') {
                patch.tts = { model: tts.model.slice(0, 64), voice: tts.voice.slice(0, 64) };
              }
              // The author listened to this synthetic take all the way through.
              if (heard === true) patch.heard = true;
              if (!Object.keys(patch).length) {
                res.statusCode = 400;
                return res.end('nothing valid');
              }
              const meta = readAudioMeta(doc);
              meta[key] = { ...meta[key], ...patch };
              writeAudioMeta(doc, meta);
              res.end('ok');
            } catch (err) {
              res.statusCode = 400;
              res.end(String(err));
            }
          });
        }
        if (req.method === 'DELETE') {
          fs.rmSync(file, { force: true });
          const meta = readAudioMeta(doc);
          delete meta[key];
          writeAudioMeta(doc, meta);
          return res.end('ok');
        }
        res.statusCode = 405;
        res.end();
      });

      // The author's voice reference for cloning: assembled client-side from
      // real takes, stored beside the content it came from.
      server.middlewares.use('/__voice', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          try {
            return res.end(fs.readFileSync(VOICE_META, 'utf8'));
          } catch {
            return res.end(JSON.stringify({ exists: false }));
          }
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readBody(req, (body) => {
          const params = new URLSearchParams(req.url.split('?')[1] ?? '');
          const seconds = Number(params.get('seconds'));
          const takes = (params.get('takes') ?? '').split(',').filter((k) => AUDIO_KEY.test(k));
          if (!body.length || !Number.isFinite(seconds) || !takes.length) {
            res.statusCode = 400;
            return res.end('bad reference');
          }
          fs.mkdirSync(VOICE_DIR, { recursive: true });
          fs.writeFileSync(VOICE_REF, body);
          fs.writeFileSync(
            VOICE_META,
            `${JSON.stringify(
              {
                exists: true,
                seconds: Math.round(seconds * 10) / 10,
                takes,
                builtAt: new Date().toISOString(),
              },
              null,
              2,
            )}\n`,
          );
          stopPocketWorker(); // next synthesis re-derives the voice state
          res.end('ok');
        });
      });

      // Cloud TTS proxy. Keys resolve server-side first — from the process
      // environment (works with plain `export`, secretspec, varlock, any
      // secret manager that injects env vars) so the browser never holds a
      // secret. A key typed into the Voice panel overrides per-request and
      // is never persisted here. GET reports which providers have env keys
      // (booleans only, never the values).
      server.middlewares.use('/__tts', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          return res.end(
            JSON.stringify({
              ...Object.fromEntries(
                Object.entries(TTS_ENV_KEYS).map(([p, envVar]) => [p, Boolean(process.env[envVar])]),
              ),
              pocket: pocketRuntimeOk(),
            }),
          );
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readBody(req, async (body) => {
          try {
            const { provider, key: clientKey, voice, text } = JSON.parse(body.toString('utf8'));
            if (typeof text !== 'string' || !text || text.length > 5000) {
              res.statusCode = 400;
              return res.end('bad request');
            }
            // Pocket runs locally — no key, no upstream, audio never leaves.
            if (provider === 'pocket') {
              if (!fs.existsSync(VOICE_REF)) {
                res.statusCode = 400;
                return res.end('no voice reference — build one in the Voice panel first');
              }
              try {
                const wav = await pocketSynthesize(text);
                res.setHeader('content-type', 'audio/wav');
                return res.end(wav);
              } catch (err) {
                res.statusCode = 502;
                return res.end(String(err.message ?? err));
              }
            }
            const key =
              (typeof clientKey === 'string' && clientKey) ||
              process.env[TTS_ENV_KEYS[provider] ?? ''] ||
              '';
            if (!key) {
              res.statusCode = 400;
              return res.end('bad request');
            }
            let upstream;
            if (provider === 'elevenlabs') {
              const voiceId = typeof voice === 'string' && voice ? voice : '21m00Tcm4TlvDq8ikWAM';
              upstream = await fetch(
                `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`,
                {
                  method: 'POST',
                  headers: { 'xi-api-key': key, 'content-type': 'application/json' },
                  body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5' }),
                },
              );
            } else if (provider === 'fish') {
              upstream = await fetch('https://api.fish.audio/v1/tts', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${key}`,
                  'content-type': 'application/json',
                  model: 's1',
                },
                body: JSON.stringify({
                  text,
                  format: 'mp3',
                  ...(typeof voice === 'string' && voice ? { reference_id: voice } : {}),
                }),
              });
            } else {
              res.statusCode = 400;
              return res.end('unknown provider');
            }
            if (!upstream.ok) {
              res.statusCode = upstream.status;
              return res.end(await upstream.text().catch(() => 'upstream error'));
            }
            res.setHeader('content-type', upstream.headers.get('content-type') ?? 'audio/mpeg');
            res.end(Buffer.from(await upstream.arrayBuffer()));
          } catch (err) {
            res.statusCode = 502;
            res.end(String(err));
          }
        });
      });

      server.middlewares.use('/__export', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readBody(req, (body) => {
          try {
            const { doc, audio } = JSON.parse(body.toString('utf8'));
            if (typeof doc !== 'string' || !SLUG.test(doc) || !fs.existsSync(docFile(doc))) {
              res.statusCode = 400;
              return res.end('bad doc');
            }
            const result = spawnSync('pnpm', ['export'], {
              cwd: ROOT,
              timeout: 120_000,
              env: { ...process.env, SINGLEFILE: '1', DOC: doc, AUDIO: audio ? '1' : '' },
            });
            if (result.status !== 0) {
              res.statusCode = 500;
              return res.end(String(result.stderr));
            }
            res.setHeader('content-type', 'text/html');
            res.setHeader(
              'content-disposition',
              `attachment; filename="${doc}${audio ? '.audio' : ''}.html"`,
            );
            fs.createReadStream(path.resolve(ROOT, 'dist', `${doc}.html`)).pipe(res);
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the build works at any mount point: GitHub Pages
  // project paths, file://, subdirectories.
  base: './',
  // Snapshot at build time so builds ship provenance and the narration index
  // (per-doc exports only their own — other docs' data doesn't leak); the dev
  // client fetches fresh numbers from the middleware instead.
  define: {
    __PROVENANCE__: JSON.stringify(
      EXPORT_DOC ? { [EXPORT_DOC]: readProvenance(EXPORT_DOC) } : allProvenance(),
    ),
    __AUDIO_INDEX__: JSON.stringify(
      EXPORT_DOC
        ? EXPORT_AUDIO
          ? { [EXPORT_DOC]: audioIndex(EXPORT_DOC) }
          : {}
        : allAudioIndex(),
    ),
    __AUDIO_DATA__: JSON.stringify(
      EXPORT_AUDIO
        ? Object.fromEntries(
            audioKeys(EXPORT_DOC).map((key) => [
              key,
              `data:audio/webm;base64,${fs.readFileSync(audioFile(EXPORT_DOC, key)).toString('base64')}`,
            ]),
          )
        : null,
    ),
  },
  plugins: [
    singleDocOnly(),
    mdxSkippingQueries(),
    react({ include: /\.(jsx|mdx)$/ }),
    selfServe(),
    copyAudioToDist(),
    // `pnpm export` inlines everything into one file for sharing.
    ...(process.env.SINGLEFILE ? [viteSingleFile()] : []),
  ],
});
