import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../sanitize";

describe("renderMarkdown", () => {
  it("preserves benign markdown output", () => {
    const html = renderMarkdown(
      "# Hello\n\nsome **bold** text and a [link](https://example.com).",
    );
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  it("strips <script> tags", () => {
    const html = renderMarkdown("before<script>alert('xss')</script>after");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips inline event handlers", () => {
    const html = renderMarkdown('<a href="x" onclick="alert(1)">click</a>');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("alert(1)");
  });

  it("strips <iframe>", () => {
    const html = renderMarkdown('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain("<iframe");
  });

  it("strips javascript: URLs", () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">click</a>');
    expect(html).not.toMatch(/href="javascript:/i);
  });
});
