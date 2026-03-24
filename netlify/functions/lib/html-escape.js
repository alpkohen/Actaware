/**
 * Escape text for safe insertion into HTML body (not inside <script>).
 */
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only allow http(s) URLs for href to reduce javascript: / data: injection. */
function safeHttpUrl(url) {
  if (url == null) return "";
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) return "";
  return u;
}

/** Plain text → safe HTML paragraph fragments (newlines → <br>). */
function textToEmailHtml(text) {
  return escapeHtml(text == null ? "" : String(text)).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

const LI_STYLE = 'margin:6px 0;line-height:1.5;';
const UL_STYLE = 'margin:0;padding-left:20px;';

/**
 * Sector note from Claude: may be "- bullet" plain text or wrongly HTML <ul>/<li>.
 * Always emit safe list HTML so email clients render bullets (never escaped raw tags).
 */
function formatSectorNoteForEmail(raw) {
  if (raw == null || !String(raw).trim()) return "";
  let s = String(raw).trim();

  const liMatches = [...s.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
  if (liMatches.length > 0) {
    const items = liMatches
      .map((m) => String(m[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (items.length > 0) {
      return `<ul style="${UL_STYLE}">${items.map((item) => `<li style="${LI_STYLE}">${escapeHtml(item)}</li>`).join("")}</ul>`;
    }
  }

  const stripped = s.replace(/<[^>]+>/g, "\n").replace(/\n+/g, "\n").trim();
  const lines = stripped
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean);
  if (lines.length > 0) {
    return `<ul style="${UL_STYLE}">${lines.map((l) => `<li style="${LI_STYLE}">${escapeHtml(l)}</li>`).join("")}</ul>`;
  }

  return textToEmailHtml(stripped);
}

module.exports = { escapeHtml, safeHttpUrl, textToEmailHtml, formatSectorNoteForEmail };
