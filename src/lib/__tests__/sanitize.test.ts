import { describe, expect, it } from "vitest";
import { marked } from "marked";
import DOMPurify from "dompurify";

function render(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
  });
}

describe("README sanitization", () => {
  it("preserves benign markdown output", () => {
    const html = render("# Hello\n\nsome **bold** text and a [link](https://example.com).");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  it("strips <script> tags", () => {
    const html = render("before<script>alert('xss')</script>after");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips inline event handlers", () => {
    const html = render('<a href="x" onclick="alert(1)">click</a>');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("alert(1)");
  });

  it("strips <iframe>", () => {
    const html = render('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain("<iframe");
  });

  it("strips javascript: URLs", () => {
    const html = render('<a href="javascript:alert(1)">click</a>');
    expect(html).not.toMatch(/href="javascript:/i);
  });
});
