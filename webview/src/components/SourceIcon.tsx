import type { DecisionSource } from "../types";

export function SourceIcon({ sources }: { sources?: DecisionSource[] | null }) {
  if (!sources?.length) return null;
  return (
    <span className="pf-src" tabIndex={0}>
      <span className="pf-src__icon" aria-hidden>
        ⎘
      </span>
      <span className="pf-src__tip" role="tooltip">
        <span className="pf-src__tip-title">Sources</span>
        <ul>
          {sources.map((s) => (
            <li key={s.id}>
              <span className={`pf-src__kind pf-src__kind--${s.kind}`}>{s.kind}</span>
              {s.label}
            </li>
          ))}
        </ul>
      </span>
    </span>
  );
}
