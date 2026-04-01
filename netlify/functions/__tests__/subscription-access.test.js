const { hasProductAccess, hasProTierFeatures } = require("../lib/subscription-access");

describe("subscription-access", () => {
  const future = "2026-06-01T00:00:00.000Z";
  const past = "2025-01-01T00:00:00.000Z";

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("hasProductAccess: false when inactive", () => {
    expect(hasProductAccess({ status: "inactive", plan: "professional", stripe_subscription_id: "sub_x" })).toBe(
      false
    );
  });

  test("hasProductAccess: Stripe subscription id grants access", () => {
    expect(
      hasProductAccess({
        status: "active",
        plan: "starter",
        stripe_subscription_id: "sub_123",
      })
    ).toBe(true);
  });

  test("hasProductAccess: legacy trial with future trial_ends_at", () => {
    expect(
      hasProductAccess({
        status: "active",
        plan: "trial",
        trial_ends_at: future,
        stripe_subscription_id: null,
      })
    ).toBe(true);
  });

  test("hasProductAccess: professional without Stripe while trial active", () => {
    expect(
      hasProductAccess({
        status: "active",
        plan: "professional",
        trial_ends_at: future,
        stripe_subscription_id: null,
      })
    ).toBe(true);
  });

  test("hasProductAccess: professional trial expired", () => {
    expect(
      hasProductAccess({
        status: "active",
        plan: "professional",
        trial_ends_at: past,
        stripe_subscription_id: null,
      })
    ).toBe(false);
  });

  test("hasProTierFeatures: legacy trial plan uses starter-like tools", () => {
    expect(
      hasProTierFeatures({
        status: "active",
        plan: "trial",
        trial_ends_at: future,
        stripe_subscription_id: null,
      })
    ).toBe(false);
  });

  test("hasProTierFeatures: paid professional", () => {
    expect(
      hasProTierFeatures({
        status: "active",
        plan: "professional",
        stripe_subscription_id: "sub_x",
      })
    ).toBe(true);
  });

  test("hasProTierFeatures: professional time-limited trial", () => {
    expect(
      hasProTierFeatures({
        status: "active",
        plan: "professional",
        trial_ends_at: future,
        stripe_subscription_id: null,
      })
    ).toBe(true);
  });
});
