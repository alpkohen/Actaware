/**
 * Production canonical origin (emails, Stripe return URLs, footers).
 * Netlify injects URL / DEPLOY_PRIME_URL as *.netlify.app; teams sometimes set SITE_URL
 * to the same. We never use netlify.app for customer-facing links.
 */
const PRODUCTION_SITE_URL = "https://actaware.co.uk";

function isNetlifyDeployHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h.endsWith(".netlify.app") || h.endsWith(".netlify.live");
}

/**
 * First env value that parses as https? URL and is not a Netlify deploy hostname.
 * Order: explicit SITE_URL, then Netlify's URL, then DEPLOY_PRIME_URL.
 */
function pickPublicSiteFromEnv() {
  const candidates = [process.env.SITE_URL, process.env.URL, process.env.DEPLOY_PRIME_URL];
  for (const c of candidates) {
    const raw = String(c || "").trim().replace(/\/+$/, "");
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const host = u.hostname.toLowerCase();
      if (isNetlifyDeployHost(host)) continue;
      return raw;
    } catch (_) {
      continue;
    }
  }
  return null;
}

/** Public site base URL (no trailing slash). Used in emails and redirects. */
function getSiteUrl() {
  return pickPublicSiteFromEnv() || PRODUCTION_SITE_URL;
}

module.exports = { getSiteUrl, PRODUCTION_SITE_URL };
