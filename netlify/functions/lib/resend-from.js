/** Shared Resend "from" for transactional product emails. */
function getResendFrom() {
  const raw =
    process.env.RESEND_FROM ||
    process.env.CONTACT_FORM_FROM ||
    "ActAware <onboarding@resend.dev>";
  const t = String(raw).trim();
  return t || "ActAware <onboarding@resend.dev>";
}

module.exports = { getResendFrom };
