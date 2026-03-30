const { Resend } = require("resend");
const { getResendFrom } = require("./resend-from");

function formatPlanLabel(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "professional") return "Professional";
  if (p === "agency") return "Agency";
  if (p === "starter") return "Starter";
  if (p === "trial") return "Trial";
  return plan || "—";
}

/** Comma/semicolon-separated admin inboxes. Empty = feature off. */
function parseAdminNotifyRecipients() {
  const raw = process.env.ADMIN_NOTIFY_EMAIL || "";
  if (!String(raw).trim()) return [];
  return String(raw)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

/**
 * Email ops team when someone starts trial or completes paid checkout.
 * Set ADMIN_NOTIFY_EMAIL (e.g. you@domain.com or a,b@c.com). No key = no send.
 *
 * @param {object} p
 * @param {"trial"|"paid"} p.kind
 * @param {string} p.email
 * @param {string} [p.plan]
 * @param {string} [p.firstName]
 * @param {string} [p.lastName]
 * @param {string} [p.companyName]
 * @param {string} [p.trialEndsAt] ISO
 */
async function notifyAdminNewSignup(p) {
  const to = parseAdminNotifyRecipients();
  if (to.length === 0) return { sent: false, reason: "no_admin_recipients" };

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("admin-notify: RESEND_API_KEY missing, skip");
    return { sent: false, reason: "no_resend" };
  }

  const email = String(p.email || "").trim().toLowerCase();
  const planLabel = formatPlanLabel(p.plan);
  const subject =
    p.kind === "trial"
      ? `[ActAware] New trial — ${email}`
      : `[ActAware] New subscription — ${planLabel} — ${email}`;

  const lines = [
    "New ActAware signup",
    "",
    p.kind === "trial" ? "Type: Free trial" : "Type: Paid subscription",
    `Email: ${email}`,
    `Plan: ${planLabel}`,
  ];
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  if (name) lines.push(`Name: ${name}`);
  if (p.companyName) lines.push(`Company: ${p.companyName}`);
  if (p.trialEndsAt) lines.push(`Trial ends: ${p.trialEndsAt}`);
  lines.push("", `Time (UTC): ${new Date().toISOString()}`);

  const text = lines.join("\n");

  try {
    const resend = new Resend(key);
    const { error, data } = await resend.emails.send({
      from: getResendFrom(),
      to,
      subject,
      text,
    });
    if (error) {
      const msg = typeof error === "string" ? error : error.message || JSON.stringify(error);
      console.error("admin-notify Resend:", msg);
      return { sent: false, reason: msg };
    }
    console.log("admin-notify: sent", data?.id, subject);
    return { sent: true };
  } catch (e) {
    console.error("admin-notify:", e?.message || e);
    return { sent: false, reason: e?.message || String(e) };
  }
}

module.exports = {
  notifyAdminNewSignup,
  parseAdminNotifyRecipients,
  formatPlanLabel,
};
