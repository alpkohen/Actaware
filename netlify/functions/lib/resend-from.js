/** Shared Resend "from" for transactional product emails. */
function getResendFrom() {
  return (
    process.env.RESEND_FROM ||
    process.env.CONTACT_FORM_FROM ||
    "ActAware <onboarding@resend.dev>"
  ).trim();
}

module.exports = { getResendFrom };
