/**
 * Cap for sent_alerts.alert_summary — align with digest_snapshots (Postgres TEXT).
 * Previous 500-char trim broke My alerts mid-sentence.
 */
const MAX_ALERT_SUMMARY_CHARS = 120000;

module.exports = { MAX_ALERT_SUMMARY_CHARS };
