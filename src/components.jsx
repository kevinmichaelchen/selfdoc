export function Callout({ title, children }) {
  return (
    <div className="callout">
      {title && <strong className="callout-title">{title}</strong>}
      {children}
    </div>
  );
}

export function Note({ children }) {
  return <aside className="note">{children}</aside>;
}

export function StatRow({ children }) {
  return <div className="stat-row">{children}</div>;
}

export function Stat({ value, label }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export const components = { Callout, Note, StatRow, Stat };
