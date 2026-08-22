import { describe, expect, it } from "vitest";
import { escapeHtml, verdictBadge } from "../src/html.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-sensitive characters", () => {
    expect(escapeHtml(`<script>alert('x') & "y"</script>`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;) &amp; &quot;y&quot;&lt;/script&gt;"
    );
  });

  it("coerces null/undefined to an empty string rather than the literal text \"null\"/\"undefined\"", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("verdictBadge", () => {
  it("renders a span carrying the verdict as both the CSS class and the visible text", () => {
    expect(verdictBadge("GREEN")).toBe('<span class="badge badge-GREEN">GREEN</span>');
  });

  it("escapes its input — defense in depth, even though callers only ever pass a Verdict literal today", () => {
    expect(verdictBadge("<b>RED</b>")).not.toContain("<b>");
  });
});
