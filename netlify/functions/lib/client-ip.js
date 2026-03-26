/**
 * Best-effort client IP for Netlify Functions (rate limiting).
 */
function getClientIp(event) {
  const xf = event.headers["x-forwarded-for"] || event.headers["X-Forwarded-For"] || "";
  const first = String(xf).split(",")[0].trim();
  if (first) return first.slice(0, 128);
  const nf =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["X-Nf-Client-Connection-Ip"] ||
    event.headers["client-ip"] ||
    "";
  const t = String(nf).trim();
  return (t || "unknown").slice(0, 128);
}

module.exports = { getClientIp };
