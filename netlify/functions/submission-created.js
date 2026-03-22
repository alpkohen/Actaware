/**
 * Netlify event: runs when a verified form submission is created.
 * Sends you an email via Resend (same key as digest emails).
 *
 * Optional env: CONTACT_FORM_NOTIFY_EMAIL (defaults to akohen@uniq-tr.com)
 */
const Resend = require("resend").Resend;

const DEFAULT_NOTIFY = "akohen@uniq-tr.com";

function escapeText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

exports.handler = async function (event) {
  if (!event.body) {
    return { statusCode: 200, body: "ok" };
  }

  let parsed;
  try {
    parsed = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch (e) {
    console.error("submission-created: invalid JSON", e.message);
    return { statusCode: 200, body: "ok" };
  }

  const payload = parsed.payload || parsed;
  const data = payload.data || payload.human_fields || {};

  const formName =
    data["form-name"] ||
    payload.form_name ||
    payload.formName ||
    (Array.isArray(payload.ordered_human_fields) &&
      payload.ordered_human_fields.find((f) => f.name === "form-name")?.value);

  if (formName && String(formName).trim() !== "actaware-contact") {
    return { statusCode: 200, body: "ignored" };
  }

  const name = data.name || "";
  const email = data.email || "";
  const subject = data.subject || "(no subject)";
  const message = data.message || "";

  if (!email && !message && !name) {
    console.warn("submission-created: empty actaware-contact payload?");
    return { statusCode: 200, body: "ok" };
  }

  const to = (process.env.CONTACT_FORM_NOTIFY_EMAIL || DEFAULT_NOTIFY).trim();
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("submission-created: RESEND_API_KEY missing");
    return { statusCode: 200, body: "ok" };
  }

  const from =
    process.env.CONTACT_FORM_FROM ||
    process.env.RESEND_FROM ||
    "ActAware <onboarding@resend.dev>";

  const text = [
    "New message from actaware.co.uk contact form",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Subject: ${subject}`,
    "",
    "Message:",
    message,
    "",
    `Submitted at: ${payload.created_at || new Date().toISOString()}`,
  ].join("\n");

  const html = `
    <h2 style="font-family:sans-serif;">ActAware — contact form</h2>
    <p style="font-family:sans-serif;font-size:14px;line-height:1.5;">
      <strong>Name:</strong> ${escapeText(name)}<br>
      <strong>Email:</strong> <a href="mailto:${escapeText(email)}">${escapeText(email)}</a><br>
      <strong>Subject:</strong> ${escapeText(subject)}
    </p>
    <pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;background:#f4f4f5;padding:16px;border-radius:8px;">${escapeText(
      message
    )}</pre>
  `;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(email).trim())
        ? { replyTo: String(email).trim() }
        : {}),
      subject: `[ActAware Contact] ${subject}`,
      text,
      html,
    });
    if (error) {
      console.error("submission-created: Resend error", error);
    }
  } catch (err) {
    console.error("submission-created:", err.message);
  }

  return { statusCode: 200, body: "ok" };
};
