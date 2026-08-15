import { useToc } from './chrome.jsx';

// `rest` carries the data-node-start/end stamps so components are removable
// as a unit from the edit-mode toolbar.

export function Callout({ title, children, ...rest }) {
  return (
    <div className="callout" {...rest}>
      {title && <strong className="callout-title">{title}</strong>}
      {children}
    </div>
  );
}

export function Note({ children, ...rest }) {
  return (
    <aside className="note" {...rest}>
      {children}
    </aside>
  );
}

export function StatRow({ children, ...rest }) {
  return (
    <div className="stat-row" {...rest}>
      {children}
    </div>
  );
}

export function Stat({ value, label, ...rest }) {
  return (
    <div className="stat" {...rest}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function Toc(props) {
  const { toc } = useToc();
  return (
    <nav className="toc" aria-label="Contents" {...props}>
      <p className="toc-eyebrow">Contents</p>
      <ol className="toc-list">
        {toc.map((entry) => (
          <li key={entry.id}>
            <a href={`#${entry.id}`}>
              <span className="toc-text">{entry.text}</span>
              <span className="toc-min">{entry.minutes} min</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const components = { Callout, Note, StatRow, Stat, Toc };
