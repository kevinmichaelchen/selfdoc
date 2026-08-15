import fs from 'node:fs';
import path from 'node:path';
import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { rehypeSourcePos } from './plugins/rehype-source-pos.mjs';

const DOC = path.resolve(import.meta.dirname, 'content/doc.mdx');

/**
 * The self-editing half: a dev-only endpoint that splices an edited block back
 * into the .mdx source. It only ever writes the one document, and only within
 * a range the compiler itself stamped, so there is no path or file choice to
 * get wrong. Writing the file triggers Vite's reload, which recompiles the doc
 * and hands every block fresh offsets.
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
            const { start, end, markdown } = JSON.parse(body);
            const src = fs.readFileSync(DOC, 'utf8');
            const valid =
              Number.isInteger(start) &&
              Number.isInteger(end) &&
              start >= 0 &&
              end <= src.length &&
              start < end &&
              typeof markdown === 'string';
            if (!valid) {
              res.statusCode = 400;
              return res.end('bad range');
            }
            fs.writeFileSync(DOC, src.slice(0, start) + markdown + src.slice(end));
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
    { enforce: 'pre', ...mdx({ rehypePlugins: [rehypeSourcePos] }) },
    react({ include: /\.(jsx|mdx)$/ }),
    selfSave(),
  ],
});
