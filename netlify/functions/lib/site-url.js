/** Public site base URL (no trailing slash). Used in emails and redirects. */
function getSiteUrl() {
  const u = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  return u || "https://actaware.co.uk";
}

module.exports = { getSiteUrl };
