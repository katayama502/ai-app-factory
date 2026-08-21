import { describe, expect, it } from "vitest";
import { escapeHtml, pageShell } from "../src/html.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;"
    );
  });

  it("treats null/undefined as empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("pageShell", () => {
  it("escapes the title and embeds the body verbatim", () => {
    const html = pageShell(`<b>Title</b>`, "<p>body</p>");
    expect(html).toContain("&lt;b&gt;Title&lt;/b&gt;");
    expect(html).toContain("<p>body</p>");
  });
});
