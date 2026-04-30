import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Render untrusted markdown (READMEs, release bodies) to HTML, stripping
 * anything that could execute script: <script>, <iframe>, inline event
 * handlers, javascript: URLs, etc.
 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
  });
}
