/**
 * UK employer milestones shown on the dashboard calendar (same source as dashboard-compliance).
 * ai-chat includes this so answers align with what users see on the page.
 */
const COMPLIANCE_MILESTONES = [
  {
    id: "era-p1",
    date: "2026-04-06",
    title: "Employment Rights Act 2025 — Phase 1 in force",
    detail:
      "Day-one rights, paternity, flexible working request changes, and more — confirm policies and contracts.",
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

/** Plain-text block for Claude system prompts (no PII). */
function formatMilestonesForPrompt() {
  return COMPLIANCE_MILESTONES.map(
    (m) => `- ${m.date}: ${m.title}\n  ${m.detail}`
  ).join("\n");
}

module.exports = { COMPLIANCE_MILESTONES, formatMilestonesForPrompt };
