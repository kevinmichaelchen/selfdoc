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

function bumpProvenance(doc, patch) {
  const prev = readProvenance(doc);
  const now = new Date().toISOString();
  const merged = {
    sessions: (prev.sessions ?? 0) + (patch.sessions ?? 0),
    readingMs: (prev.readingMs ?? 0) + (patch.readingMs ?? 0),
    editingMs: (prev.editingMs ?? 0) + (patch.editingMs ?? 0),
    edits: (prev.edits ?? 0) + (patch.edits ?? 0),
    firstSeen: prev.firstSeen ?? now,
    lastSeen: now,
  };
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
            bumpProvenance(doc, { edits: 1 });
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
            const { doc, readingMs, editingMs, sessions } = JSON.parse(body);
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

export default defineConfig({
  // Snapshot at build time so the export ships the doc's provenance; the dev
  // client fetches fresh numbers from the middleware instead.
  define: { __PROVENANCE__: JSON.stringify(allProvenance()) },
  plugins: [
    {
      enforce: 'pre',
      ...mdx({ remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSourcePos] }),
    },
    react({ include: /\.(jsx|mdx)$/ }),
    selfSave(),
    // `pnpm export` inlines everything into dist/index.html for sharing.
    ...(process.env.SINGLEFILE ? [viteSingleFile()] : []),
  ],
});
