/**
 * Compliance calendar (static milestones), checklist definitions, and per-user checklist progress.
 * Professional / Agency only for writes; all signed-in users can read calendar + definitions.
 */
const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/** Key UK employer compliance dates (update periodically). */
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
      .select("id")
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
    const canUseChecklist = proPlan(plan, status);

    if (event.httpMethod === "GET") {
      let completed = {};
      if (canUseChecklist) {
        const { data: rows, error: cErr } = await supabaseAdmin
          .from("user_compliance_checklist")
          .select("item_id, completed_at")
          .eq("user_id", userRow.id);
        if (cErr) throw cErr;
        for (const r of rows || []) {
          completed[r.item_id] = r.completed_at;
        }
      }

      const total = CHECKLIST_ITEMS.length;
      const doneCount = CHECKLIST_ITEMS.filter((it) => completed[it.id]).length;
      const scorePercent = total ? Math.round((doneCount / total) * 100) : 0;

      return {
        statusCode: 200,
        headers: h(),
        body: JSON.stringify({
          milestones: COMPLIANCE_MILESTONES,
          checklistItems: CHECKLIST_ITEMS,
          completed,
          scorePercent,
          doneCount,
          totalChecklistItems: total,
          plan,
          checklistEditable: canUseChecklist,
        }),
      };
    }

    if (event.httpMethod === "POST") {
      if (!canUseChecklist) {
        return {
          statusCode: 403,
          headers: h(),
          body: JSON.stringify({
            error: "Compliance checklist is included on Professional and Agency plans.",
          }),
        };
      }

      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Invalid JSON" }) };
      }

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
