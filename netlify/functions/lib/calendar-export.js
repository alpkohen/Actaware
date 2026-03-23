/**
 * Google Calendar deep link + iCalendar (.ics) for compliance milestones.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function icsEscape(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * @param {{ id: string, date: string, title: string, detail?: string }} m date YYYY-MM-DD
 */
function buildCalendarPayload(m) {
  const dateStr = m.date;
  const parts = dateStr.split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return { googleUrl: "", ics: "" };
  }
  const [y, mo, da] = parts;
  const start = `${String(y).padStart(4, "0")}${pad2(mo)}${pad2(da)}`;
  const endDt = new Date(Date.UTC(y, mo - 1, da + 1));
  const ey = endDt.getUTCFullYear();
  const em = endDt.getUTCMonth() + 1;
  const ed = endDt.getUTCDate();
  const end = `${String(ey).padStart(4, "0")}${pad2(em)}${pad2(ed)}`;

  const text = encodeURIComponent(m.title);
  const details = encodeURIComponent(m.detail || "");
  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&details=${details}`;

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "") + "Z";
  const uid = `actaware-${m.id}-${start}@actaware.co.uk`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ActAware//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${icsEscape(m.title)}`,
    `DESCRIPTION:${icsEscape(m.detail || "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return { googleUrl, ics };
}

module.exports = { buildCalendarPayload };
