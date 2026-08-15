import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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

function allAudioIndex() {
  try {
    return Object.fromEntries(
      fs
        .readdirSync(AUDIO_DIR)
        .filter((d) => SLUG.test(d))
        .map((d) => [d, audioKeys(d)]),
    );
  } catch {
    return {};
  }
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
          return res.end(JSON.stringify(audioKeys(doc)));
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
            res.end('ok');
          });
        }
        if (req.method === 'DELETE') {
          fs.rmSync(file, { force: true });
          return res.end('ok');
        }
        res.statusCode = 405;
        res.end();
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
          ? { [EXPORT_DOC]: audioKeys(EXPORT_DOC) }
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
