import fs from 'node:fs';
import path from 'node:path';
import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import remarkGfm from 'remark-gfm';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { rehypeSourcePos } from './plugins/rehype-source-pos.mjs';

const CONTENT = path.resolve(import.meta.dirname, 'content');

/**
 * The self-editing half: a dev-only endpoint that splices a replacement into
 * the .mdx source. Ranges come from stamps the compiler itself produced, and
 * start === end means insertion. Only slug-named files inside content/ are
 * writable. Writing triggers Vite's reload, which recompiles the doc and
 * hands every block fresh offsets.
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
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const { doc = 'doc', start, end, markdown } = JSON.parse(body);
            if (typeof doc !== 'string' || !/^[a-z0-9_-]+$/i.test(doc)) {
              res.statusCode = 400;
              return res.end('bad doc');
            }
            const file = path.join(CONTENT, `${doc}.mdx`);
            if (!fs.existsSync(file)) {
              res.statusCode = 400;
              return res.end('unknown doc');
            }
            const src = fs.readFileSync(file, 'utf8');
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
            fs.writeFileSync(file, src.slice(0, start) + markdown + src.slice(end));
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
