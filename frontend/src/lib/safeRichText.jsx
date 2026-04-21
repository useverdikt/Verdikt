import React from "react";

/**
 * Renders a string with **bold** segments only — no raw HTML.
 * Use for API/LLM-derived copy to avoid DOM XSS via dangerouslySetInnerHTML.
 */
export function BoldMarkdownText({ text, style, strongStyle }) {
  const t = String(text ?? "");
  const parts = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  let key = 0;
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) {
      parts.push(
        <span key={key++} style={style}>
          {t.slice(last, m.index)}
        </span>
      );
    }
    parts.push(
      <strong key={key++} style={strongStyle}>
        {m[1]}
      </strong>
    );
    last = m.index + m[0].length;
  }
  if (last < t.length) {
    parts.push(
      <span key={key++} style={style}>
        {t.slice(last)}
      </span>
    );
  }
  return parts.length ? parts : <span style={style}>{t}</span>;
}
