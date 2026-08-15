const modules = import.meta.glob('../content/*.mdx', { eager: true });
const raws = import.meta.glob('../content/*.mdx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const docs = {};
export const sources = {};
for (const [file, mod] of Object.entries(modules)) {
  docs[file.match(/([^/]+)\.mdx$/)[1]] = mod.default;
}
for (const [file, raw] of Object.entries(raws)) {
  sources[file.match(/([^/]+)\.mdx$/)[1]] = raw;
}

export const DEFAULT_DOC = docs['building-selfdoc']
  ? 'building-selfdoc'
  : (docs.doc ? 'doc' : Object.keys(docs)[0]);

/** Card metadata for the home grid, derived from the raw source. */
export function docMeta(slug) {
  const raw = sources[slug];
  const title = raw.match(/^#\s+(.+)$/m)?.[1] ?? slug;
  const body = raw.replace(/^#\s+.+$/m, '');
  const paragraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !/^[<#>[|`]/.test(block));
  const excerpt = paragraph?.replace(/\s+/g, ' ').replace(/[*_`]/g, '').slice(0, 180) ?? '';
  const minutes = Math.max(1, Math.round((raw.match(/\S+/g) ?? []).length / 220));
  return { title, excerpt, minutes };
}
