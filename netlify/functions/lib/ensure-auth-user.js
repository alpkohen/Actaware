const { createClient } = require("@supabase/supabase-js");

/**
 * Create a confirmed Supabase Auth user with email+password (no confirmation email),
 * or if the email already exists, verify the password via sign-in.
 * Uses service role for create; anon client only for password check.
 */
async function ensureAuthUserWithPassword(adminSupabase, emailNorm, password, userMetadata = {}) {
  if (!password || password.length < 8 || password.length > 128) {
    return { ok: false, status: 400, message: "Password must be between 8 and 128 characters." };
  }

  const { error: createErr } = await adminSupabase.auth.admin.createUser({
    email: emailNorm,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });

  if (!createErr) return { ok: true };

  const msg = String(createErr.message || "").toLowerCase();
  const duplicate =
    msg.includes("already") ||
    msg.includes("registered") ||
    msg.includes("exists") ||
    createErr.code === "email_exists";

  if (!duplicate) {
    return {
      ok: false,
      status: 400,
      message: createErr.message || "Could not create your login. Try again or use a different email.",
    };
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, status: 503, message: "Server misconfigured." };
  }

  const anonClient = createClient(url, anon);
  const { error: signErr } = await anonClient.auth.signInWithPassword({
    email: emailNorm,
    password,
  });

  if (signErr) {
    return {
      ok: false,
      status: 401,
      message:
        "This email is already registered. Sign in at My alerts with your password, or use Forgot password on the sign-in page.",
    };
  }

  return { ok: true };
}

module.exports = { ensureAuthUserWithPassword };
