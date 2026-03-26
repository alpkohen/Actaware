const { createClient } = require("@supabase/supabase-js");

function parseBearerToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return token;
}

/**
 * Same shape as legacy getAuthEmail / getAuthUserEmail consumers.
 * @returns {Promise<{ error: 'unauthorized'|'misconfigured'|'invalid_session'|null, email?: string }>}
 */
async function getAuthEmailFromEvent(event) {
  const token = parseBearerToken(event);
  if (!token) return { error: "unauthorized" };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { error: "misconfigured" };

  const authClient = createClient(url, anon);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);
  if (error || !user?.email) return { error: "invalid_session" };
  return { error: null, email: String(user.email).trim().toLowerCase() };
}

const DEFAULT_MESSAGES = {
  unauthorized: "Sign in required.",
  misconfigured: "Server misconfigured.",
  invalid_session: "Invalid or expired session.",
};

/**
 * @param {object} event - Netlify event
 * @param {Partial<typeof DEFAULT_MESSAGES>} [customMessages]
 * @returns {Promise<{ ok: true, email: string } | { ok: false, status: number, message: string }>}
 */
async function verifyBearerAuth(event, customMessages = {}) {
  const msg = { ...DEFAULT_MESSAGES, ...customMessages };
  const r = await getAuthEmailFromEvent(event);
  if (r.error === "unauthorized") {
    return { ok: false, status: 401, message: msg.unauthorized };
  }
  if (r.error === "misconfigured") {
    return { ok: false, status: 503, message: msg.misconfigured };
  }
  if (r.error === "invalid_session") {
    return { ok: false, status: 401, message: msg.invalid_session };
  }
  return { ok: true, email: r.email };
}

module.exports = {
  parseBearerToken,
  getAuthEmailFromEvent,
  verifyBearerAuth,
};
