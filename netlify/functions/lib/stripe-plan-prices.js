/**
 * Stripe Price IDs per plan. Override with Netlify env for live mode (test/live IDs must match STRIPE_SECRET_KEY).
 * Defaults are the repo's test Dashboard prices — do NOT use these with a live STRIPE_SECRET_KEY.
 */
const DEFAULT_PLAN_PRICE_IDS = {
  starter: "price_1TECr11Xanrz03nulyrRqRNC",
  professional: "price_1TECrS1Xanrz03nucwVjBqTK",
  agency: "price_1TECrg1Xanrz03nuEkFymBFg",
};

const TEST_PRICE_ID_PREFIX = "price_1TECr";

function pick(envKey, fallback) {
  const v = String(process.env[envKey] ?? "").trim();
  return v || fallback;
}

function getPlanPriceIds() {
  const ids = {
    starter: pick("STRIPE_PRICE_STARTER", DEFAULT_PLAN_PRICE_IDS.starter),
    professional: pick("STRIPE_PRICE_PROFESSIONAL", DEFAULT_PLAN_PRICE_IDS.professional),
    agency: pick("STRIPE_PRICE_AGENCY", DEFAULT_PLAN_PRICE_IDS.agency),
  };

  // Guard: warn loudly if live secret key is paired with test price IDs.
  const stripeKey = String(process.env.STRIPE_SECRET_KEY || "");
  if (stripeKey.startsWith("sk_live_")) {
    const hasTestDefault = Object.values(ids).some((id) => id.startsWith(TEST_PRICE_ID_PREFIX));
    if (hasTestDefault) {
      console.error(
        "[stripe-plan-prices] CONFIGURATION ERROR: Live STRIPE_SECRET_KEY detected but one or more " +
        "Price IDs are still the hardcoded test defaults. Set STRIPE_PRICE_STARTER, " +
        "STRIPE_PRICE_PROFESSIONAL, and STRIPE_PRICE_AGENCY in your Netlify environment variables " +
        "to the live Price IDs from your Stripe dashboard. Checkouts WILL fail."
      );
    }
  }

  return ids;
}

module.exports = { getPlanPriceIds, DEFAULT_PLAN_PRICE_IDS };
