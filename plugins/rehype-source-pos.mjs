/**
 * Stamps editable prose blocks with their character range in the source .mdx
 * file. The client uses the range to splice edits back into the file, so the
 * offsets must survive untouched from remark's original parse — this is why we
 * mark blocks here instead of in the DOM.
 */
const EDITABLE = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'blockquote',
  'pre',
]);

export function rehypeSourcePos() {
  return (tree) => walk(tree);
}

function walk(node) {
  if (!node.children) return;
  for (const child of node.children) {
    const start = child.position?.start?.offset;
    const end = child.position?.end?.offset;
    if (
      child.type === 'element' &&
      EDITABLE.has(child.tagName) &&
      start != null &&
      end != null
    ) {
      child.properties ??= {};
      child.properties.dataEditStart = start;
      child.properties.dataEditEnd = end;
      // Nested blocks (a p inside a li) stay unmarked: one editable region
      // must never contain another, or their ranges would overlap.
      continue;
    }
    walk(child);
  }
}
