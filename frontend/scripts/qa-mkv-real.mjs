import { chromium } from "@playwright/test";

const BASE = process.env.QA_BASE || "http://127.0.0.1:8888";
const PASS = process.env.WINFB_ADMIN_PASSWORD || "WinFB-2026!";
const MKV =
  "/D/Kkwans/Videos/电影/隐入尘烟.Return.to.Dust.2022.1080p.WEB-DL.H265.DDP5.1-NUMTV.mkv";

function enc(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const token = await page.evaluate(async (password) => {
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  return r.ok ? (await r.text()).trim() : "";
}, PASS);
await page.evaluate((t) => localStorage.setItem("jwt", t), token);

await page.evaluate(async ({ token }) => {
  const me = await fetch("/api/users/1", { headers: { "X-Auth": token } }).then((r) =>
    r.json()
  );
  await fetch(`/api/users/${me.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Auth": token },
    body: JSON.stringify({
      what: "user",
      which: ["PlayerPreferences"],
      data: {
        ...me,
        id: me.id,
        playerPreferences: {
          ...(me.playerPreferences || {}),
          playbackMode: "native",
          resumeMode: "resume",
        },
      },
    }),
  });
}, { token });

await page.goto(`${BASE}/files${enc(MKV)}?preview=true`, {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector(".art-video-player", { timeout: 30000 });

function snap() {
  return page.evaluate(() => {
    const stage = document.querySelector(".art-player-stage");
    const loader = stage?.querySelector(":scope > .art-loading");
    const video = document.querySelector(".art-video-player video");
    return {
      loaderVisible: !!loader && getComputedStyle(loader).display !== "none",
      loaderText: loader?.textContent?.replace(/\s+/g, " ").trim() || "",
      mode:
        document
          .querySelector(".art-control-playback-mode")
          ?.textContent?.replace(/\s+/g, " ")
          .slice(0, 20) || "",
      currentTime: video ? Math.round(video.currentTime * 10) / 10 : null,
      readyState: video?.readyState ?? null,
      videoWidth: video?.videoWidth ?? null,
      paused: video?.paused ?? null,
    };
  });
}

const samples = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(i === 0 ? 800 : 2000);
  samples.push({ t: i, ...(await snap()) });
  const last = samples[samples.length - 1];
  if (last.currentTime > 1 && !last.loaderVisible) break;
}
console.log("MKV_SAMPLES", JSON.stringify(samples, null, 2));
console.log("DONE");
await browser.close();
