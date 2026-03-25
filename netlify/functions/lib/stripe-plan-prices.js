/**
 * Stripe Price IDs per plan. Override with Netlify env for live mode (test/live IDs must match STRIPE_SECRET_KEY).
 * Defaults are the repo’s test Dashboard prices.
 */
const DEFAULT_PLAN_PRICE_IDS = {
  starter: "price_1TECr11Xanrz03nulyrRqRNC",
  professional: "price_1TECrS1Xanrz03nucwVjBqTK",
  agency: "price_1TECrg1Xanrz03nuEkFymBFg",
};

function pick(envKey, fallback) {
  const v = String(process.env[envKey] ?? "").trim();
  return v || fallback;
}

function getPlanPriceIds() {
  return {
    starter: pick("STRIPE_PRICE_STARTER", DEFAULT_PLAN_PRICE_IDS.starter),
    professional: pick("STRIPE_PRICE_PROFESSIONAL", DEFAULT_PLAN_PRICE_IDS.professional),
    agency: pick("STRIPE_PRICE_AGENCY", DEFAULT_PLAN_PRICE_IDS.agency),
  };
}

module.exports = { getPlanPriceIds, DEFAULT_PLAN_PRICE_IDS };
