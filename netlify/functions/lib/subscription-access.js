/**
 * Single source of truth for "can use ActAware product" (emails, dashboard, pro tools).
 *
 * Paid Stripe subscription → access.
 * Otherwise: time-limited trial — legacy plan "trial", or plan professional/agency without Stripe while trial_ends_at is in the future.
 *
 * Does not mutate rows (no auto-downgrade to starter).
 */

/**
 * @param {object|null|undefined} row - subscriptions row
 * @returns {boolean}
 */
function hasProductAccess(row) {
  if (!row) return false;
  if (String(row.status || "").toLowerCase() !== "active") return false;
  const stripe = row.stripe_subscription_id && String(row.stripe_subscription_id).trim();
  if (stripe) return true;
  const endMs = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0;
  if (!endMs || endMs <= Date.now()) return false;
  const plan = String(row.plan || "").toLowerCase();
  if (plan === "trial") return true;
  if ((plan === "professional" || plan === "agency") && !stripe) return true;
  return false;
}

/**
 * Professional / Agency dashboard features (calendar, checklist, filters, AI chat tier).
 * Requires product access and pro plan slug (legacy "trial" plan uses starter-like dashboard for tools).
 *
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
function hasProTierFeatures(row) {
  if (!hasProductAccess(row)) return false;
  const plan = String(row.plan || "").toLowerCase();
  return plan === "professional" || plan === "agency";
}

module.exports = { hasProductAccess, hasProTierFeatures };
