const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ARCHIVE_DAYS_LIMITED = 30;
const MAX_ALERTS_LIMITED = 100;
const MAX_ALERTS_FULL = 500;

/** YYYY-MM-DD in Europe/London — must match send-alerts digest_snapshots.digest_date. */
function getLondonDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function fullArchiveEligible(plan, status) {
  if (status !== "active") return false;
  return plan === "professional" || plan === "agency";
}

/** How many digest_snapshots rows exist in the same window as the dashboard fallback (for empty-state copy). */
async function countDigestSnapshotsInWindow(supabaseAdmin) {
  const todayStr = getLondonDateString();
  const sinceDate = new Date();
  sinceDate.setTime(sinceDate.getTime() - ARCHIVE_DAYS_LIMITED * 24 * 60 * 60 * 1000);
  const sinceStr = getLondonDateString(sinceDate);
  const { count, error } = await supabaseAdmin
    .from("digest_snapshots")
    .select("*", { count: "exact", head: true })
    .gte("digest_date", sinceStr)
    .lte("digest_date", todayStr);
  if (error) {
    console.warn("dashboard-alerts count digest_snapshots:", error.message);
    return null;
  }
  return count ?? 0;
}

/** When sent_alerts is empty, show recent rows from digest_snapshots (same 30-day window). */
async function fetchSharedBriefings(supabaseAdmin, searchTrim) {
  const todayStr = getLondonDateString();
  const sinceDate = new Date();
  sinceDate.setTime(sinceDate.getTime() - ARCHIVE_DAYS_LIMITED * 24 * 60 * 60 * 1000);
  const sinceStr = getLondonDateString(sinceDate);

  const { data: snaps, error } = await supabaseAdmin
    .from("digest_snapshots")
    .select("*")
    .gte("digest_date", sinceStr)
    .lte("digest_date", todayStr)
    .order("digest_date", { ascending: false })
    .limit(60);

  if (error) {
    console.warn("dashboard-alerts digest_snapshots:", error.message);
    return [];
  }
  let rows = snaps || [];
  const q = String(searchTrim || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (row) =>
        String(row.alert_title || "").toLowerCase().includes(q) ||
        String(row.alert_summary || "").toLowerCase().includes(q)
    );
  }
  return rows.map((row) => ({
    id: `snapshot-${row.id}`,
    alert_title: row.alert_title,
    alert_summary: row.alert_summary,
    alert_source: row.alert_source,
    importance: row.importance,
    sent_at: row.created_at || `${row.digest_date}T12:00:00.000Z`,
    _source: "shared_briefing",
  }));
}

exports.handler = async function (event) {
  const h = (extra = {}) => makeCorsHeaders(event, extra);

  if (event.httpMethod === "OPTIONS") return preflight(event);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: h(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return {
      statusCode: 401,
      headers: h({ "Content-Type": "application/json" }),
      body: JSON.stringify({ error: "Sign in required. Use your email and password on this page." }),
    };
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      statusCode: 503,
      headers: h({ "Content-Type": "application/json" }),
      body: JSON.stringify({ error: "Server misconfigured (missing Supabase anon key)" }),
    };
  }

  const authClient = createClient(url, anon);
  const {
    data: { user: authUser },
    error: authErr,
  } = await authClient.auth.getUser(token);

  if (authErr || !authUser?.email) {
    return {
      statusCode: 401,
      headers: h({ "Content-Type": "application/json" }),
      body: JSON.stringify({ error: "Invalid or expired session. Sign in again with your email and password." }),
    };
  }

  const emailNorm = String(authUser.email).trim().toLowerCase();

  try {
    const body = JSON.parse(event.body || "{}");
    const search = body.search;
    const importance = String(body.importance || "all").toLowerCase();
    const sourceFilter = String(body.source || "").trim().toLowerCase();
    const dateFrom = body.dateFrom ? String(body.dateFrom).trim() : "";
    const dateTo = body.dateTo ? String(body.dateTo).trim() : "";

    const { data: dbUser, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", emailNorm)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!dbUser) {
      return {
        statusCode: 404,
        headers: h({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          error:
            "No ActAware account found for this email. Subscribe or start a trial with the same address you use to sign in.",
        }),
      };
    }

    const { data: subRow, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", dbUser.id)
      .maybeSingle();

    if (subErr) throw subErr;

    const plan = subRow?.plan || "starter";
    const status = subRow?.status || "inactive";
    const unlimited = fullArchiveEligible(plan, status);
    const proTools =
      status === "active" && (plan === "professional" || plan === "agency");

    const useAdvancedFilters =
      proTools &&
      (importance !== "all" ||
        sourceFilter ||
        (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) ||
        (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)));

    let query = supabaseAdmin
      .from("sent_alerts")
      .select("*")
      .eq("user_id", dbUser.id)
      .order("sent_at", { ascending: false })
      .limit(unlimited ? MAX_ALERTS_FULL : MAX_ALERTS_LIMITED);

    if (!unlimited) {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - ARCHIVE_DAYS_LIMITED);
      query = query.gte("sent_at", since.toISOString());
    }

    const searchTrim = search && String(search).trim();
    if (searchTrim) {
      const q = searchTrim.replace(/%/g, "\\%").replace(/_/g, "\\_");
      query = query.or(`alert_summary.ilike.%${q}%,alert_title.ilike.%${q}%`);
    }

    if (useAdvancedFilters) {
      if (importance !== "all" && ["critical", "high", "medium", "low"].includes(importance)) {
        query = query.eq("importance", importance);
      }
      if (sourceFilter) {
        query = query.ilike("alert_source", `%${sourceFilter}%`);
      }
      if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        query = query.gte("sent_at", `${dateFrom}T00:00:00.000Z`);
      }
      if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        query = query.lte("sent_at", `${dateTo}T23:59:59.999Z`);
      }
    }

    const { data: alerts, error: qErr } = await query;
    if (qErr) throw qErr;

    let personal = alerts || [];

    let sharedBriefings = [];
    if (personal.length === 0) {
      let allowSharedFallback = true;
      if (searchTrim) {
        const { count, error: cErr } = await supabaseAdmin
          .from("sent_alerts")
          .select("*", { count: "exact", head: true })
          .eq("user_id", dbUser.id);
        if (cErr) throw cErr;
        if ((count ?? 0) > 0) allowSharedFallback = false;
      }
      if (allowSharedFallback) {
        sharedBriefings = await fetchSharedBriefings(supabaseAdmin, searchTrim);
      }
    }

    let digestSnapshotsInWindow = null;
    if (personal.length === 0 && sharedBriefings.length === 0) {
      digestSnapshotsInWindow = await countDigestSnapshotsInWindow(supabaseAdmin);
    }

    return {
      statusCode: 200,
      headers: h({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        alerts: personal,
        sharedBriefings,
        meta: {
          plan,
          subscriptionStatus: status,
          archiveFullHistory: unlimited,
          archiveDays: unlimited ? null : ARCHIVE_DAYS_LIMITED,
          showingSharedBriefings: personal.length === 0 && sharedBriefings.length > 0,
          digestSnapshotsInWindow,
          proFilters: proTools,
        },
      }),
    };
  } catch (err) {
    console.error("dashboard-alerts:", err.message);
    return {
      statusCode: 500,
      headers: h({ "Content-Type": "application/json" }),
      body: JSON.stringify({ error: "Something went wrong" }),
    };
  }
};
