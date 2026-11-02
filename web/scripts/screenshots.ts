// Usage: npm run screenshots  (app running at APP_URL, default http://localhost:3000)
// Signs in as each demo role and saves full-page screenshots to docs/screenshots.
// Uses the locally installed Microsoft Edge (or Chrome with BROWSER=chrome).
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const OUT = path.resolve(__dirname, "../../docs/screenshots");
const channel = process.env.BROWSER === "chrome" ? "chrome" : "msedge";

const ROLES = [
  {
    email: "admin@univ.edu",
    password: "Admin@123",
    pages: [
      ["admin-overview", "/admin"],
      ["admin-students", "/admin/students"],
      ["admin-mentors", "/admin/mentors"],
      ["admin-activities", "/admin/activities"],
      ["admin-schedule", "/admin/schedule"],
      ["admin-attendance", "/admin/attendance"],
      ["admin-feedback", "/admin/feedback"],
      ["admin-graph", "/admin/graph"],
    ],
  },
  { email: "priya.iyer@univ.edu", password: "Mentor@123", pages: [["mentor-dashboard", "/mentor"]] },
  {
    email: "aarav.sharma@univ.edu",
    password: "Student@123",
    pages: [
      ["student-dashboard", "/student"],
      ["student-matchmaking", "/matchmaking"],
    ],
  },
] as const;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.querySelector('[role="status"] .animate-spin'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ channel });
  for (const scheme of ["light"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "login.png") });
    for (const role of ROLES) {
      await ctx.clearCookies();
      await page.goto(`${BASE}/login`);
      await page.fill('input[type="email"]', role.email);
      await page.fill('input[type="password"]', role.password);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
      for (const [name, url] of role.pages) {
        await page.goto(`${BASE}${url}`);
        await settle(page);
        await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
        console.log(`saved ${name}.png`);
      }
    }
    await ctx.close();
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
