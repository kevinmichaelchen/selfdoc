const modules = import.meta.glob('../content/*.mdx', { eager: true });

export const docs = {};
for (const [file, mod] of Object.entries(modules)) {
  docs[file.match(/([^/]+)\.mdx$/)[1]] = mod.default;
}

export const DEFAULT_DOC = docs.doc ? 'doc' : Object.keys(docs)[0];
