import fs from 'node:fs';
import path from 'node:path';
import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import remarkGfm from 'remark-gfm';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { rehypeSourcePos } from './plugins/rehype-source-pos.mjs';

const CONTENT = path.resolve(import.meta.dirname, 'content');
const PROV_DIR = path.join(CONTENT, 'provenance');

const SLUG = /^[a-z0-9_-]+$/i;
const docFile = (doc) => path.join(CONTENT, `${doc}.mdx`);

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

const countWords = (text) => (text.trim().match(/\S+/g) ?? []).length;

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

function readBody(req, onDone) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on('end', () => onDone(body));
}

/**
 * The self-editing half: a dev-only endpoint that splices a replacement into
 * the .mdx source. Ranges come from stamps the compiler itself produced, and
 * start === end means insertion. Only slug-named files inside content/ are
 * writable. Each successful save also bumps the doc's provenance edit count —
 * counted here, not in the client, so the number reflects writes that landed.
 */
function selfSave() {
  return {
    name: 'selfdoc-save',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readBody(req, (body) => {
          try {
            const { doc = 'doc', start, end, markdown } = JSON.parse(body);
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
            const { doc, readingMs, editingMs, sessions, typedChars, pastedChars } =
              JSON.parse(body);
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
    },
  };
}

// Exports are per-document: `pnpm export` builds the default doc,
// `DOC=colophon pnpm export` builds another. The single-doc module rewrite
// below keeps every other draft out of the exported bundle entirely.
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
      const dist = path.resolve(import.meta.dirname, 'dist');
      fs.renameSync(path.join(dist, 'index.html'), path.join(dist, `${EXPORT_DOC}.html`));
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

export default defineConfig({
  // Snapshot at build time so the export ships the doc's provenance (only its
  // own — other docs' stats don't leak); the dev client fetches fresh numbers
  // from the middleware instead.
  define: {
    __PROVENANCE__: JSON.stringify(
      EXPORT_DOC ? { [EXPORT_DOC]: readProvenance(EXPORT_DOC) } : allProvenance(),
    ),
  },
  plugins: [
    singleDocOnly(),
    mdxSkippingQueries(),
    react({ include: /\.(jsx|mdx)$/ }),
    selfSave(),
    // `pnpm export` inlines everything into dist/index.html for sharing.
    ...(process.env.SINGLEFILE ? [viteSingleFile()] : []),
  ],
});
