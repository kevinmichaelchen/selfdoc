/**
 * Stamps blocks with their character range in the source .mdx file. The client
 * uses the range to splice edits back into the file, so the offsets must
 * survive untouched from remark's original parse — this is why we mark blocks
 * here instead of in the DOM.
 *
 * Two kinds of stamps:
 * - data-edit-start/end on prose blocks: text-editable in the page.
 * - data-node-start/end on JSX components: removable as a unit, but their text
 *   lives in stamped prose children, so a component's body is still editable
 *   while its props and tag stay file-edited.
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
    // The generated endnotes section round-trips badly through HTML→markdown
    // (turndown has no footnote syntax), so it stays file-edited.
    if (child.type === 'element' && child.properties?.dataFootnotes != null) {
      continue;
    }
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
    if (child.type === 'mdxJsxFlowElement' && start != null && end != null) {
      child.attributes ??= [];
      child.attributes.push(
        { type: 'mdxJsxAttribute', name: 'data-node-start', value: String(start) },
        { type: 'mdxJsxAttribute', name: 'data-node-end', value: String(end) },
      );
      walk(child);
      continue;
    }
    walk(child);
  }
}
