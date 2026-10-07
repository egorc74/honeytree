/**
 * Defence in depth: bodies are plain Markdown, and the web app renders them with HTML disabled.
 * We additionally strip raw HTML on input so stored text never contains tags.
 */
export function stripHtml(input: string): string {
  let out = input.replace(/\u0000/g, '');
  // Loop: removing one tag can splice the remains of another into a new tag (`<scr<b>ipt>`).
  for (let i = 0; i < 5; i++) {
    const next = out
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '');
    if (next === out) break;
    out = next;
  }
  // Drop control characters except tab/newline/carriage return.
  return out.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'game';
}

export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
