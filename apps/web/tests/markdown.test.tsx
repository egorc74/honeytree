import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/Markdown";

const html = (src: string) => renderToStaticMarkup(<Markdown source={src} />);

describe("Markdown", () => {
  it("renders headings, emphasis, lists and quotes", () => {
    const out = html("# Title\n\nSome **bold** and *italic* and `code`.\n\n- one\n- two\n\n> quoted");
    expect(out).toContain("<h3");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<code");
    expect(out).toContain("<ul");
    expect(out).toContain("<blockquote");
  });

  it("never emits raw HTML from user content", () => {
    const out = html('<script>alert(1)</script><img src=x onerror="alert(2)">');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });

  it("only links http(s) and mailto, and adds rel protections", () => {
    const ok = html("[site](https://example.com)");
    expect(ok).toContain('href="https://example.com"');
    expect(ok).toContain("noopener");
    expect(ok).toContain("nofollow");
    const bad = html("[click](javascript:alert(1))");
    expect(bad).not.toContain("href");
    expect(bad).toContain("click");
  });

  it("renders fenced code verbatim", () => {
    expect(html("```\n<b>x</b>\n```")).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
