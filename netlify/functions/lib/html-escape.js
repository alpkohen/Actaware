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

module.exports = { escapeHtml, safeHttpUrl, textToEmailHtml };
