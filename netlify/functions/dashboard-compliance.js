/**
 * Compliance calendar (+ calendar export for Pro/Agency), checklist review log, definitions.
 */
const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { buildCalendarPayload } = require("./lib/calendar-export");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const COMPLIANCE_MILESTONES = [
  {
    id: "era-p1",
    date: "2026-04-06",
    title: "Employment Rights Act 2025 — Phase 1 in force",
    detail: "Day-one rights, paternity, flexible working request changes, and more — confirm policies and contracts.",
    urgency: "critical",
  },
  {
    id: "era-p2-jul",
    date: "2026-07-01",
    title: "ERA 2025 — further measures (e.g. flexible working / zero-hours)",
    detail: "Track DBT / GOV.UK for exact commencement — plan handbook and roster updates.",
    urgency: "high",
  },
  {
    id: "era-p3-2027",
    date: "2027-01-01",
    title: "Unfair dismissal qualifying period & cap changes",
    detail: "Review dismissal procedures and insurance / legal cover.",
    urgency: "high",
  },
  {
    id: "fwa",
    date: "2026-01-01",
    title: "Fair Work Agency — monitor enforcement",
    detail: "Subscribe to digests; ensure payroll and NMW records audit-ready.",
    urgency: "medium",
  },
  {
    id: "nlw-review",
    date: "2026-04-01",
    title: "National Living Wage / NMW — annual uprating",
    detail: "Check HMRC and DBT each April; update pay rates and posters.",
    urgency: "high",
  },
];

const CHECKLIST_ITEMS = [
  {
    id: "era-handbook",
    category: "ERA 2025",
    title: "Handbook updated for Phase 1 (day-one rights, paternity, flexible requests)",
  },
  {
    id: "era-contracts",
    category: "ERA 2025",
    title: "Contracts and offer letters reviewed for Phase 1 changes",
  },
  {
    id: "payroll-nmw",
    category: "Payroll",
    title: "NLW/NMW rates and payroll software checked after April uprating",
  },
  {
    id: "right-to-work",
    category: "Immigration",
    title: "Right-to-work checks process reviewed (Home Office guidance)",
  },
  {
    id: "ico-dp",
    category: "Data protection",
    title: "Employer GDPR / ICO-relevant policies (privacy, retention, subject access)",
  },
  {
    id: "hse-risk",
    category: "Health & safety",
    title: "Risk assessments and H&S responsibilities documented for your sites",
  },
  {
    id: "pensions-ae",
    category: "Pensions",
    title: "Auto-enrolment duties and TPR communications monitored",
  },
  {
    id: "equality-ehrc",
    category: "Equality",
    title: "Equality policy and reasonable adjustments process fit for EHRC expectations",
  },
];

function proPlan(plan, status) {
  if (status !== "active") return false;
  return plan === "professional" || plan === "agency";
}

async function getAuthUserEmail(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
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

exports.handler = async function (event) {
  const h = (extra = {}) => makeCorsHeaders(event, { "Content-Type": "application/json", ...extra });

  if (event.httpMethod === "OPTIONS") return preflight(event);

  const auth = await getAuthUserEmail(event);
  if (auth.error === "unauthorized") {
    return { statusCode: 401, headers: h(), body: JSON.stringify({ error: "Sign in required." }) };
  }
  if (auth.error === "misconfigured") {
    return { statusCode: 503, headers: h(), body: JSON.stringify({ error: "Server misconfigured." }) };
  }
  if (auth.error === "invalid_session") {
    return { statusCode: 401, headers: h(), body: JSON.stringify({ error: "Invalid or expired session." }) };
  }

  try {
    const { data: userRow, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id, first_name, last_name")
      .eq("email", auth.email)
      .maybeSingle();
    if (uErr) throw uErr;
    if (!userRow) {
      return {
        statusCode: 404,
        headers: h(),
        body: JSON.stringify({ error: "No account found for this email." }),
      };
    }

    const { data: subRow, error: sErr } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", userRow.id)
      .maybeSingle();
    if (sErr) throw sErr;

    const plan = subRow?.plan || "starter";
    const status = subRow?.status || "inactive";
    const canUseProTools = proPlan(plan, status);

    if (event.httpMethod === "GET") {
      const milestones = COMPLIANCE_MILESTONES.map((m) => ({
        ...m,
        ...(canUseProTools ? { calendar: buildCalendarPayload(m) } : {}),
      }));

      let legacyCompleted = {};
      let reviewsByItem = {};

      if (canUseProTools) {
        const { data: leg, error: lErr } = await supabaseAdmin
          .from("user_compliance_checklist")
          .select("item_id, completed_at")
          .eq("user_id", userRow.id);
        if (lErr) throw lErr;
        for (const r of leg || []) {
          legacyCompleted[r.item_id] = r.completed_at;
        }

        const { data: revRows, error: rErr } = await supabaseAdmin
          .from("compliance_checklist_reviews")
          .select("item_id, note, created_at")
          .eq("user_id", userRow.id)
          .order("created_at", { ascending: false });
        if (rErr) throw rErr;

        for (const row of revRows || []) {
          const id = row.item_id;
          if (!reviewsByItem[id]) reviewsByItem[id] = [];
          reviewsByItem[id].push({
            note: row.note || "",
            created_at: row.created_at,
          });
        }
      }

      const checklistWithState = CHECKLIST_ITEMS.map((it) => {
        const revs = reviewsByItem[it.id] || [];
        const lastReviewAt = revs[0]?.created_at || null;
        const reviewCount = revs.length;
        const hasLegacy = !!legacyCompleted[it.id];
        const covered = reviewCount > 0 || hasLegacy;
        return {
          ...it,
          lastReviewAt,
          reviewCount,
          hasLegacyTick: hasLegacy,
          covered,
          recentReviews: revs.slice(0, 8),
        };
      });

      const total = CHECKLIST_ITEMS.length;
      const doneCount = checklistWithState.filter((x) => x.covered).length;
      const scorePercent = total ? Math.round((doneCount / total) * 100) : 0;

      return {
        statusCode: 200,
        headers: h(),
        body: JSON.stringify({
          milestones,
          checklistItems: checklistWithState,
          scorePercent,
          doneCount,
          totalChecklistItems: total,
          plan,
          checklistEditable: canUseProTools,
          calendarActionsEnabled: canUseProTools,
        }),
      };
    }

    if (event.httpMethod === "POST") {
      if (!canUseProTools) {
        return {
          statusCode: 403,
          headers: h(),
          body: JSON.stringify({
            error: "This feature is included on Professional and Agency plans.",
          }),
        };
      }

      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Invalid JSON" }) };
      }

      const action = String(body.action || "addReview").toLowerCase();

      if (action === "addreview" || action === "add_review") {
        const itemId = String(body.itemId || "").trim();
        const note = String(body.note ?? "").trim().slice(0, 2000);
        if (!itemId || !CHECKLIST_ITEMS.some((x) => x.id === itemId)) {
          return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Invalid itemId" }) };
        }

        const { error: insErr } = await supabaseAdmin.from("compliance_checklist_reviews").insert({
          user_id: userRow.id,
          item_id: itemId,
          note: note || null,
        });
        if (insErr) throw insErr;

        return {
          statusCode: 200,
          headers: h(),
          body: JSON.stringify({ ok: true, itemId }),
        };
      }

      /** @deprecated Legacy checkbox sync — still supported for older clients */
      if (action === "toggle" || body.itemId) {
        const itemId = String(body.itemId || "").trim();
        const done = !!body.done;
        if (!itemId || !CHECKLIST_ITEMS.some((x) => x.id === itemId)) {
          return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Invalid itemId" }) };
        }
        if (done) {
          const { error: upErr } = await supabaseAdmin.from("user_compliance_checklist").upsert(
            {
              user_id: userRow.id,
              item_id: itemId,
              completed_at: new Date().toISOString(),
            },
            { onConflict: "user_id,item_id" }
          );
          if (upErr) throw upErr;
        } else {
          const { error: delErr } = await supabaseAdmin
            .from("user_compliance_checklist")
            .delete()
            .eq("user_id", userRow.id)
            .eq("item_id", itemId);
          if (delErr) throw delErr;
        }
        return {
          statusCode: 200,
          headers: h(),
          body: JSON.stringify({ ok: true, itemId, done }),
        };
      }

      return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Unknown action" }) };
    }

    return { statusCode: 405, headers: h(), body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("dashboard-compliance:", err.message);
    return {
      statusCode: 500,
      headers: h(),
      body: JSON.stringify({ error: "Something went wrong" }),
    };
  }
};
