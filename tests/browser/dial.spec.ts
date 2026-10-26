import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("independent browsers collect real shared and individual ratings, recover queued data, and export actual reports", async ({ browser, page }) => {
  const directory = mkdtempSync(join(tmpdir(), "dialit-browser-clip-")), fixture = join(directory, "test.mp4");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25", "-t", "40", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", fixture]);
  const participantContext1 = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true }), participantContext2 = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true }), displayContext = await browser.newContext();
  const one = await participantContext1.newPage(), two = await participantContext2.newPage(), display = await displayContext.newPage();
  try {
    await page.goto("/");
    await page.getByLabel("Username", { exact: true }).fill("browser-test"); await page.getByLabel("Password", { exact: true }).fill("isolated-browser-test-password"); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.getByLabel("Project name").fill("ISOLATED AUTOMATED BROWSER TEST — NOT RESEARCH"); await page.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Project", exact: true })).not.toHaveValue("");
    await page.getByLabel("Session name").fill("Browser workflow"); await page.getByRole("button", { name: "Create session", exact: true }).click();
    await page.getByRole("link", { name: "Moderate", exact: true }).click();
    await page.getByLabel("Clip title").fill("Synthetic browser test clip"); await page.getByLabel("H.264 / AAC MP4").setInputFiles(fixture); await page.getByRole("button", { name: "Upload video", exact: true }).click();
    await expect(page.getByLabel("Selected clip")).not.toHaveValue("");
    await page.getByLabel("Enable separate reaction button").check(); await page.getByRole("button", { name: "Save configuration", exact: true }).click();
    const code = await page.locator(".join-code").innerText();
    for (const participant of [one, two]) { await participant.goto(`/join?code=${code}`); await participant.getByRole("button", { name: "Join session", exact: true }).click(); await expect(participant.getByText(/PARTICIPANT · P/)).toBeVisible(); }
    const sessionId = page.url().split("/moderator/")[1];
    const firstIdentity = await one.evaluate((sid) => JSON.parse(localStorage.getItem(`dialit:identity:${sid}`)!), sessionId);
    await page.getByRole("button", { name: "Generate / rotate shared-display link" }).click();
    const displayLink = await page.getByRole("link", { name: "Open shared display", exact: true }).getAttribute("href");
    await display.goto(displayLink!);
    await page.getByRole("button", { name: "Prepare new viewing", exact: true }).click();
    await expect.poll(() => display.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(3);
    await display.getByRole("button", { name: /Tap to Ready/ }).click();
    await one.getByRole("button", { name: "Tap to Ready", exact: true }).click(); await two.getByRole("button", { name: "Tap to Ready", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(one.locator("#dial")).toBeEnabled();
    await one.locator("#dial").focus(); await one.locator("#dial").press("End"); await two.locator("#dial").focus(); await two.locator("#dial").press("Home");
    await expect(one.locator("output")).toHaveText("100"); await expect(two.locator("output")).toHaveText("0");
    await expect.poll(async () => { const response = await page.request.get(`/api/sessions/${sessionId}/state`); return (await response.json()).quality?.samples ?? 0; }, { timeout: 12000 }).toBeGreaterThanOrEqual(4);
    await one.getByRole("button", { name: "Mark a reaction", exact: true }).click(); await one.getByRole("button", { name: "Mark a reaction", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/sessions/${sessionId}/state`)).json()).quality.reactions).toBe(2);
    await participantContext1.setOffline(true);
    await expect.poll(() => one.evaluate(async () => {
      return await new Promise<number>((resolve, reject) => { const request = indexedDB.open("dialit-capture-v1"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const count = db.transaction("ratings").objectStore("ratings").count(); count.onsuccess = () => { resolve(count.result); db.close(); }; }; });
    }), { timeout: 8000 }).toBeGreaterThan(0);
    await participantContext1.setOffline(false); await one.reload();
    await expect(one.getByText(/PARTICIPANT · P01/)).toBeVisible();
    await expect.poll(() => one.evaluate((sid) => JSON.parse(localStorage.getItem(`dialit:identity:${sid}`)!).participantId, sessionId)).toBe(firstIdentity.participantId);
    await page.getByRole("button", { name: "Pause", exact: true }).click(); await expect(one.locator("#dial")).toBeDisabled();
    await expect(one.getByText("All locally queued records acknowledged")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "End viewing", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/sessions/${sessionId}/state`)).json()).quality.provisional, { timeout: 10000 }).toBe(false);
    await page.getByRole("link", { name: "Open reporting", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Mean rating ±1 sample SD", exact: true })).toBeVisible();
    await expect(page.locator(".chart canvas")).toBeVisible();
    const canvas = page.locator(".chart canvas"), bounds = await canvas.boundingBox(); expect(bounds).not.toBeNull();
    await canvas.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
    await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(5);
    const momentButton = page.locator(".link-button").first(), momentTime = Number((await momentButton.innerText()).split("s")[0]);
    await momentButton.click(); await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(momentTime, 0);
    await page.locator("video").evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(momentTime + .25);
    await page.locator("video").evaluate((video: HTMLVideoElement) => video.pause());
    await page.screenshot({ path: "/tmp/dialit-dashboard.png", fullPage: true });
    const csvDownload = page.waitForEvent("download"); await page.getByRole("link", { name: "statistics CSV", exact: true }).click(); const csv = await csvDownload; const csvPath = await csv.path(); expect(readFileSync(csvPath!, "utf8")).toContain("sample_sd");
    const pngDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Chart PNG", exact: true }).click(); const png = await pngDownload; const pngPath = await png.path(); expect(readFileSync(pngPath!).subarray(1, 4).toString()).toBe("PNG");
    await page.getByRole("link", { name: "Moderator console", exact: true }).click();
    await page.getByLabel("Presentation mode").selectOption("individual"); await page.getByRole("button", { name: "Save configuration", exact: true }).click();
    await page.getByRole("button", { name: "Prepare new viewing", exact: true }).click();
    for (const participant of [one, two]) {
      await expect.poll(() => participant.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(3);
      await participant.getByRole("button", { name: /Tap to Ready/ }).click();
    }
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect.poll(() => one.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime), { timeout: 6000 }).toBeGreaterThan(1);
    await expect.poll(async () => { const response = await page.request.get(`/api/sessions/${sessionId}/state`); return (await response.json()).quality?.samples ?? 0; }, { timeout: 10000 }).toBeGreaterThanOrEqual(4);
    const runState = await (await page.request.get(`/api/sessions/${sessionId}/state`)).json(); expect(runState.run.state).toBe("recording");
    console.log(`Observed Chromium reported drift (single snapshot, 2 contexts): ${runState.participants.map((person: { telemetry: { driftMs: number } }) => Math.abs(person.telemetry.driftMs).toFixed(1)).join(", ")}ms; target 300ms. Not a physical-device measurement.`);
    expect(runState.participants.every((person: { telemetry: { driftMs: number } }) => Math.abs(person.telemetry.driftMs) <= 300)).toBeTruthy();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    for (const participant of [one, two]) await participant.getByRole("button", { name: /Ready/ }).click();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect.poll(() => one.locator("video").evaluate((video: HTMLVideoElement) => video.paused), { timeout: 6000 }).toBe(false);
    await page.getByRole("button", { name: "End viewing", exact: true }).click();
    const runs = await (await page.request.get(`/api/sessions/${sessionId}/runs`)).json(); expect(runs).toHaveLength(2); expect(runs[0].id).not.toBe(runs[1].id);
    const raw = await (await page.request.get(`/api/runs/${runs[0].id}/export/ratings`)).text(); expect(raw).toContain("local-video");
  } finally { await participantContext1.close(); await participantContext2.close(); await displayContext.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("a denied IndexedDB write is visible and prevents readiness instead of silently collecting in memory", async ({ browser, page }) => {
  const login = await page.request.post("/api/auth/login", { data: { username: "browser-test", password: "isolated-browser-test-password" } }); expect(login.ok()).toBeTruthy();
  const project = await (await page.request.post("/api/projects", { data: { name: "ISOLATED STORAGE FAILURE TEST" } })).json();
  const session = await (await page.request.post("/api/sessions", { data: { projectId: project.id, name: "Storage failure" } })).json();
  const context = await browser.newContext();
  await context.addInitScript(() => { Object.defineProperty(IDBFactory.prototype, "open", { value: () => { throw new DOMException("Simulated storage quota denial", "QuotaExceededError"); } }); });
  try {
    const tablet = await context.newPage(); await tablet.goto(`/join?code=${session.code}`); await tablet.getByRole("button", { name: "Join session", exact: true }).click();
    await expect(tablet.getByText(/Ratings cannot be safely stored on this tablet:/)).toBeVisible({ timeout: 8000 });
    const state = await (await page.request.get(`/api/sessions/${session.id}/state`)).json();
    expect(state.participants).toHaveLength(1); expect(state.participants[0].telemetry.ready).toBe(false); expect(state.participants[0].telemetry.error).toContain("storage");
    expect(state.run).toBeNull();
  } finally { await context.close(); }
});

test("a replacement browser cannot certify an old empty upload; the original durable queue can recover and reconcile it", async ({ browser, page }) => {
  await page.request.post("/api/auth/login", { data: { username: "browser-test", password: "isolated-browser-test-password" } });
  const project = await (await page.request.post("/api/projects", { data: { name: "ISOLATED CREDENTIAL RECOVERY TEST" } })).json();
  const session = await (await page.request.post("/api/sessions", { data: { projectId: project.id, name: "Pending capture recovery" } })).json();
  const directory = mkdtempSync(join(tmpdir(), "dialit-recovery-clip-")), file = join(directory, "clip.mp4");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=green:s=320x240:r=25", "-t", "20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file]);
  const upload = await page.request.post(`/api/projects/${project.id}/clips`, { multipart: { title: "Synthetic recovery fixture", video: { name: "clip.mp4", mimeType: "video/mp4", buffer: readFileSync(file) } } }); expect(upload.ok()).toBeTruthy();
  const clip = await upload.json(), displayGrant = await (await page.request.post(`/api/sessions/${session.id}/display-token`)).json();
  const original = await browser.newContext(), replacement = await browser.newContext(), screen = await browser.newContext();
  try {
    const tablet = await original.newPage(), display = await screen.newPage(), fresh = await replacement.newPage();
    await tablet.goto(`/join?code=${session.code}`); await tablet.getByRole("button", { name: "Join session", exact: true }).click(); await expect(tablet.getByText(/PARTICIPANT · P01/)).toBeVisible();
    const identity = await tablet.evaluate((sid) => JSON.parse(localStorage.getItem(`dialit:identity:${sid}`)!), session.id);
    await display.goto(`/display/${session.id}?token=${displayGrant.token}`);
    // A live moderator connection is required even though HTTP is convenient for arranging this test.
    await page.goto(`/moderator/${session.id}`);
    await page.request.post(`/api/sessions/${session.id}/runs`, { data: { clipId: clip.id, practice: false } });
    await expect.poll(() => display.locator("video").evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(3);
    await display.getByRole("button", { name: /Tap to Ready/ }).click(); await tablet.getByRole("button", { name: "Tap to Ready", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(tablet.locator("#dial")).toBeEnabled(); await original.setOffline(true);
    await expect(tablet.getByText(/records pending upload/)).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "End viewing", exact: true }).click();
    const before = await (await page.request.get(`/api/sessions/${session.id}/state`)).json(); expect(before.quality.samples).toBe(0); expect(before.quality.provisional).toBe(true);
    const recovery = await (await page.request.post(`/api/sessions/${session.id}/participants/${identity.participantId}/credential`)).json();
    const recoveryUrl = `/dial/${session.id}?credential=${recovery.token}`;
    await fresh.goto(recoveryUrl); await expect(fresh.getByRole("heading", { name: "Viewing finished", exact: true })).toBeVisible();
    // Deliberately wait through two 1.5s flush cycles: absence of a false final receipt is the behavior under test.
    await fresh.waitForTimeout(3500);
    const stillPending = await (await page.request.get(`/api/sessions/${session.id}/state`)).json(); expect(stillPending.quality.samples).toBe(0); expect(stillPending.quality.provisional).toBe(true);
    await original.setOffline(false); await tablet.goto(recoveryUrl);
    await expect(tablet.getByText("Final capture counts reconciled", { exact: true })).toBeVisible({ timeout: 10000 });
    const recovered = await (await page.request.get(`/api/sessions/${session.id}/state`)).json(); expect(recovered.quality.samples).toBeGreaterThan(0); expect(recovered.quality.provisional).toBe(false);
    const sameId = await tablet.evaluate((sid) => JSON.parse(localStorage.getItem(`dialit:identity:${sid}`)!).participantId, session.id); expect(sameId).toBe(identity.participantId);
  } finally { await original.close(); await replacement.close(); await screen.close(); rmSync(directory, { recursive: true, force: true }); }
});
