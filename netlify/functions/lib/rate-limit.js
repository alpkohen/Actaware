/**
 * Supabase-backed sliding-window rate limit (S-1).
 * Requires migration actaware_consume_rate + api_rate_buckets.
 */
async function consumeRateLimit(supabase, bucketKey, maxPerWindow, windowSeconds = 60) {
  const { data, error } = await supabase.rpc("actaware_consume_rate", {
    p_bucket: String(bucketKey).slice(0, 256),
    p_window_seconds: Math.max(10, Math.min(3600, windowSeconds)),
    p_max: Math.max(1, Math.min(500, maxPerWindow)),
  });

  if (error) {
    console.warn("rate-limit: actaware_consume_rate unavailable — allowing request:", error.message);
    return { allowed: true, degraded: true, hit_count: null };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const hit = row?.hit_count;
  const allowed = row?.allowed !== false;
  return { allowed, hit_count: hit, degraded: false };
}

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

module.exports = { consumeRateLimit, envInt };
