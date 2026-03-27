/**
 * Strip invisible / format chars so "U" + zero-width still counts as 1 grapheme for our ≥2 rule.
 */
function normalizeGreetingPart(s) {
  return String(s ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

/**
 * Email greeting display name: prefer person's name over company (avoids "Hi U" when company_name is wrong).
 * Order: first_name (if ≥2 chars) → first + last → company_name (if ≥2 chars) → empty → caller uses "Hi there".
 */
function digestGreetingDisplayName(u) {
  if (!u) return "";
  const first = normalizeGreetingPart(u.first_name);
  const last = normalizeGreetingPart(u.last_name);
  const company = normalizeGreetingPart(u.company_name);
  if (first.length >= 2) return first;
  const both = [first, last].filter(Boolean).join(" ").trim();
  if (both.length >= 2) return both;
  if (company.length >= 2) return company;
  return "";
}

module.exports = { digestGreetingDisplayName };
