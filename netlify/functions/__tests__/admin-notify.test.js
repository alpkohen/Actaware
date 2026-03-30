const { parseAdminNotifyRecipients, formatPlanLabel } = require("../lib/admin-notify");

describe("admin-notify", () => {
  const prev = process.env.ADMIN_NOTIFY_EMAIL;

  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_NOTIFY_EMAIL;
    else process.env.ADMIN_NOTIFY_EMAIL = prev;
  });

  test("parseAdminNotifyRecipients empty when unset", () => {
    delete process.env.ADMIN_NOTIFY_EMAIL;
    expect(parseAdminNotifyRecipients()).toEqual([]);
  });

  test("parseAdminNotifyRecipients splits and trims", () => {
    process.env.ADMIN_NOTIFY_EMAIL = " a@b.co , c@d.com ; bad ";
    expect(parseAdminNotifyRecipients()).toEqual(["a@b.co", "c@d.com"]);
  });

  test("formatPlanLabel", () => {
    expect(formatPlanLabel("professional")).toBe("Professional");
    expect(formatPlanLabel("trial")).toBe("Trial");
  });
});
