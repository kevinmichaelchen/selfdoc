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

export const DEFAULT_DOC = docs.doc ? 'doc' : Object.keys(docs)[0];
