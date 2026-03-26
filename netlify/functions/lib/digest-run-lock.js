/**
 * S-5: single successful run per lock_key (duplicate Netlify cron invocations).
 */
async function tryAcquireDigestLock(supabase, lockKey, runId) {
  const key = String(lockKey).slice(0, 256);
  const { error } = await supabase.from("digest_run_lock").insert({
    lock_key: key,
    run_id: String(runId).slice(0, 200),
  });

  if (!error) return { acquired: true };

  const code = error.code || error?.details;
  const msg = String(error.message || "").toLowerCase();
  if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
    return { acquired: false, duplicate: true };
  }

  return { acquired: false, duplicate: false, error };
}

module.exports = { tryAcquireDigestLock };
