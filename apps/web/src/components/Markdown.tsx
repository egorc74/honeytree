import { Fragment, type ReactNode } from "react";

/**
 * Minimal, dependency-free Markdown renderer producing React elements (never raw HTML),
 * so user content cannot inject markup. Supports headings, paragraphs, lists, quotes,
 * fenced code, **bold**, *italic*, `code` and http(s)/mailto links.
 */

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (tok.startsWith("**")) out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key} className="rounded bg-surface px-1 py-0.5 text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      out.push(
        SAFE_URL.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-link underline">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++} className="overflow-x-auto rounded-md bg-surface p-3 text-sm">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "text-2xl" : level === 2 ? "text-xl" : "text-lg";
      // Page already has an <h1>; demote description headings to h3/h4.
      const Tag = level === 1 ? "h3" : "h4";
      blocks.push(
        <Tag key={k++} className={`${cls} mt-4 font-heading font-semibold`}>
          {renderInline(h[2], `h${k}`)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={k++} className="border-l-4 border-primary pl-4 italic text-muted">
          {renderInline(q.join(" "), `q${k}`)}
        </blockquote>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(lines[i++].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, ""));
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k++} className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-6`}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `l${k}-${j}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|```|\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={k++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(p, `p${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={`space-y-3 ${className ?? ""}`}>{blocks}</div>;
}
