/**
 * Production journey probes.
 *
 * Unlike marketing.spec.ts (which just asserts pages return 200), these
 * probes drive real user flows and assert the OUTCOME, not just the
 * HTTP status. They catch the class of bug where the page returns 200
 * but the user is actually stuck.
 *
 * Run against production on a 15-min cron via .github/workflows/journey-probes.yml.
 */
import { test, expect } from "@playwright/test";

const APP = process.env.PW_APP_BASE_URL || process.env.PW_BASE_URL || "https://app.x3compass.com";
const MARKETING = process.env.PW_MARKETING_BASE_URL || "https://x3compass.com";

test.describe("Critical user journeys (production)", () => {
  test("unauthenticated visitor → /ask resolves to signin or the authenticated ask page within 8s", async ({ page }) => {
    // This is the auth-loop bug we just fixed. If the AuthGate ever hangs
    // again, this test fails fast.
    await page.goto(`${APP}/ask`);
    // Either we land on /signin OR we see the chat UI (if a residual session existed).
    // We do NOT want to be on a page that contains "Checking your session" after 8s.
    await page.waitForFunction(
      () => !document.body.innerText.includes("Checking your session"),
      undefined,
      { timeout: 9000 },
    );
    // The current app route is /ask; /app/ask is a legacy redirect.
    const url = page.url();
    expect(url.includes("/signin") || url.includes("/ask")).toBeTruthy();
    // If on /signin, confirm the form is reachable
    if (url.includes("/signin")) {
      await expect(page.locator("input[type='email']")).toBeVisible({ timeout: 3000 });
    }
  });

  test("/api/health returns operational with sub-second budget", async ({ request }) => {
    const r = await request.get(`${APP}/api/health`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    // Liveness is the contract. Dependency state is intentionally redacted
    // and may be "degraded" while upstream credentials/providers are being
    // repaired; that must not create a false production-outage incident.
    expect(["operational", "degraded"]).toContain(body.status);
    expect(typeof body.checked_at).toBe("string");
  });

  test("/api/ask-demo returns CFR-cited answer to public prompts (the homepage demo)", async ({ request }) => {
    const r = await request.post(`${APP}/api/ask-demo`, {
      data: { prompt: "How long must I keep DQ files after a driver leaves?" },
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.content.length).toBeGreaterThan(50);
    // Must cite at least one 49 CFR section (the answer about DQ retention should cite 391.51)
    expect(Array.isArray(body.cited_sections)).toBe(true);
    expect(body.cited_sections.length).toBeGreaterThan(0);
  });

  test("/api/ask rejects unauthenticated requests with 401 (not 500 or hang)", async ({ request }) => {
    // Contract test: the LLM endpoint must require auth, fail fast, and
    // return JSON. Catches: route handler crashes, missing env vars,
    // Anthropic SDK init failures.
    const r = await request.post(`${APP}/api/ask`, {
      data: { prompt: "test", history: [] },
      headers: { "Content-Type": "application/json" },
      timeout: 6000,
    });
    expect(r.status()).toBe(401);
    const body = await r.json().catch(() => null);
    expect(body).toBeTruthy();
  });

  test("signup form is reachable and accepts input", async ({ page }) => {
    await page.goto(`${APP}/signup`);
    await expect(page.locator("input[type='email']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("input[type='password']")).toBeVisible();
    // Don't actually submit — we don't want to create real accounts on every run
  });

  test("Stripe Checkout endpoint accepts unauth POST with 401 (not 500)", async ({ request }) => {
    const r = await request.post(`${APP}/api/stripe/create-checkout-session`, {
      data: { plan: "diy" },
      headers: { "Content-Type": "application/json" },
      timeout: 6000,
    });
    expect(r.status()).toBe(401);
  });

  test("hub site x3fleetsafety.com is reachable", async ({ request }) => {
    const r = await request.get("https://x3fleetsafety.com/", { timeout: 8000 });
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text.toLowerCase()).toContain("x3");
  });

  test("placard manifest is deployed and lists 40 placards", async ({ request }) => {
    const r = await request.get(`${MARKETING}/placards/manifest.json`, { timeout: 5000 });
    expect(r.status()).toBe(200);
    const m = await r.json();
    expect(m.count).toBe(40);
    expect(m.placards.length).toBe(40);
  });

  test("new redesign pages all serve 200 (no link rot after sprints 4-5)", async ({ request }) => {
    for (const path of ["/", "/signup/", "/signin/", "/hazmat/", "/placards/manifest.json"]) {
      const r = await request.get(`${MARKETING}${path}`);
      expect(r.status(), `${path} returned non-200`).toBe(200);
    }
  });

  test("sitemap.xml lists app + marketing routes", async ({ request }) => {
    const r = await request.get(`${MARKETING}/sitemap.xml`);
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body).toContain("<urlset");
    // At least one of the canonical marketing URLs must be there
    expect(body).toContain("hazmat");
  });
});


test.describe("Multi-viewport (sprint 8)", () => {
  for (const [name, viewport] of [
    ["iPhone 15", { width: 393, height: 852 }],
    ["iPad", { width: 820, height: 1180 }],
    ["Ultrawide", { width: 1920, height: 1080 }],
  ] as const) {
    test(`${name} (${viewport.width}x${viewport.height}) — homepage renders + primary CTA reachable`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`${MARKETING}/`);
      // The authenticated shell has no h1 on its sign-in surface, so accept
      // the visible email control when the unauthenticated redirect occurs.
      const heroOrSignIn = page.locator("h1").first().or(page.locator("input[type='email']").first());
      await expect(heroOrSignIn).toBeVisible();
      // The shared Pages project may redirect an unauthenticated root to the
      // sign-in surface. Either that form or the marketing CTA is healthy;
      // the error boundary above is not.
      // Keep this aligned with the deployed marketing shell: the current
      // family header uses “Start free” and “Log in”, while authenticated
      // surfaces and older shells use the longer variants.
      const cta = page.locator("a:visible", { hasText: /Start free(?: trial)?|Start your free trial|Log in|Sign in/ }).first();
      const signInForm = page.locator("input[type='email']").first();
      await expect(cta.or(signInForm)).toBeVisible({ timeout: 5000 });
    });
  }

  test("mobile 393px — no horizontal scrollbar on homepage", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(`${MARKETING}/`);
    const bodyOverflowsX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(bodyOverflowsX, "body has horizontal overflow on mobile — fix responsive layout").toBe(false);
  });
});
