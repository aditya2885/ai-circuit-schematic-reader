import { Fragment, type ReactNode } from "react";

// A small, safe Markdown renderer for assistant replies: it builds React elements (no HTML strings),
// covering what the model writes: headings, paragraphs, lists, code, tables, bold/italic and links.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2] || m[3]) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else if (m[4]) out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    else if (m[5]) {
      const label = tok.slice(1, tok.indexOf("]("));
      out.push(<a key={k} href={m[6]} target="_blank" rel="noreferrer noopener">{label}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${b++}`;
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key}><code>{body.join("\n")}</code></pre>);
    } else if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const content = inline(line.replace(/^#+\s*/, ""), key);
      blocks.push(level === 1 ? <h2 key={key}>{content}</h2> : level === 2 ? <h3 key={key}>{content}</h3> : <h4 key={key}>{content}</h4>);
      i++;
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const start = ordered ? parseInt(line.trim(), 10) : 1;
      const sameKind = (l: string) => (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(l);
      const items: string[] = [];
      while (i < lines.length && sameKind(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
        // Models often put a blank line between items: keep one list if the next item follows.
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j > i && j < lines.length && sameKind(lines[j])) i = j;
      }
      const lis = items.map((it, j) => <li key={j}>{inline(it, `${key}-${j}`)}</li>);
      blocks.push(ordered ? <ol key={key} start={start}>{lis}</ol> : <ul key={key}>{lis}</ul>);
    } else if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table>
            <thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c, `${key}${j}${k}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={key}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `${key}-${j}`)}</Fragment>)}</p>);
    }
  }
  return <div className={streaming ? "prose-chat caret-last" : "prose-chat"}>{blocks}{streaming && <span className="caret" />}</div>;
}
