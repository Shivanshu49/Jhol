#!/usr/bin/env node
/**
 * Records a captioned demo video of Jhol against the stack running on this machine.
 *
 *   pnpm dev                       # web :3000, API + worker :4000 (Redis, Supabase, OpenAI key)
 *   node scripts/record-demo.mjs   # → demo-video/jhol-demo.webm (+ .mp4 when ffmpeg is installed)
 *
 * Story: intro → the Chalak Mart test store → paste the link → a LIVE audit → a finished two-visit
 * report (recorded earlier, labelled so) → the live result → the Codex fix receipt → the PR →
 * the re-audit → outro. Anything that is not happening live is labelled on screen.
 *
 * Optional env:
 *   WEB=http://localhost:3000   STORE=http://localhost:5051/index.html (falls back to WEB/lab/chalak-mart.html)
 *   REPORT_ID=<finished audit>  FIX_ID=<audit whose Codex fix is done>  (both auto-picked if unset)
 *   LIVE=0 skip the live audit  CLICK_FIX=1 also press "Fix with Codex" on the live audit
 *   OUT=demo-video              SPEED=1.2 (shorter pauses)
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "packages/core/package.json"));
const { chromium } = require(process.env.PW_MODULE || "playwright");

const WEB = (process.env.WEB || "http://localhost:3000").replace(/\/+$/, "");
const OUT = resolve(ROOT, process.env.OUT || "demo-video");
const SPEED = Number(process.env.SPEED || 1) || 1;
const LIVE = process.env.LIVE !== "0";
const CLICK_FIX = process.env.CLICK_FIX === "1";
const DEFAULT_IDS = [
  "3489e4f9-5f98-41a3-8c39-978e58a8d883", // two-visit audit, full evidence
  "a69ba9ac-5a83-49a0-8b8e-4db4ba5c9306", // Codex fix with PR #1 → re-audit 100/100
  "383af613-ba90-42bb-aa46-6af932802a78", // Codex fix on a local branch → re-audit
];
const W = 1280, H = 720;
const BG = "#292532";

/** Which model drives the shopping agent, read from apps/api/.env (only this one key is read). */
function agentLabel() {
  try {
    const env = readFileSync(join(ROOT, "apps/api/.env"), "utf8");
    const v = env.match(/^\s*AGENT_LLM\s*=\s*["']?(\w+)/m)?.[1]?.toLowerCase() ?? "cerebras";
    return v === "openai" ? "OpenAI" : "Cerebras";
  } catch { return "OpenAI"; }
}
const AGENT = process.env.AGENT_LABEL || agentLabel();

const log = (...a) => console.log("•", ...a);
const warnings = [];
const warn = (m) => { warnings.push(m); console.log("!", m); };
const hold = (page, ms) => page.waitForTimeout(Math.round(ms / SPEED));

// ───────────────────────── data checks (before recording) ─────────────────────────

async function getView(id) {
  try {
    const r = await fetch(`${WEB}/api/audits/${id}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function reachable(url) {
  try { return (await fetch(url, { redirect: "follow" })).ok; } catch { return false; }
}

async function recentIds() {
  try {
    const html = await (await fetch(WEB + "/")).text();
    return [...new Set([...html.matchAll(/\/audits\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
  } catch { return []; }
}

const stepCount = (v) => v.runs.reduce((n, r) => n + (r.steps?.length ?? 0), 0);

async function pickAudits() {
  const ids = [...new Set([process.env.REPORT_ID, process.env.FIX_ID, ...DEFAULT_IDS, ...(await recentIds())].filter(Boolean))];
  const views = (await Promise.all(ids.map(getView))).filter((v) => v?.audit?.status === "done");
  const byId = (id) => views.find((v) => v.audit.id === id);

  const reportScore = (v) => v.findings.length * 3 + (v.audit.sessions === 2 ? 10 : 0) + Math.min(stepCount(v), 20);
  const report = byId(process.env.REPORT_ID)
    ?? views.filter((v) => v.findings.length > 0).sort((a, b) => reportScore(b) - reportScore(a))[0] ?? null;

  const fixScore = (v) => (v.audit.fix_pr_url ? 1000 : 0) + (v.fix_after?.score ?? 0);
  const fix = byId(process.env.FIX_ID)
    ?? views.filter((v) => v.audit.fix_status === "done" && v.fix_after).sort((a, b) => fixScore(b) - fixScore(a))[0] ?? null;
  return { report, fix };
}

// ───────────────────────── page transitions ─────────────────────────

// Every new document starts hidden (dark) and fades in once its content is ready, so the video
// never shows half-loaded pages. Also hides the Next.js dev indicator and adds room at the bottom
// so content can scroll above the captions.
const BASE_CSS = "nextjs-portal{display:none!important} body{padding-bottom:280px!important}";
const HIDDEN_CSS = `${BASE_CSS} html{background:${BG}!important} body{opacity:0!important}`;

function installCover(ctx) {
  return ctx.addInitScript((css) => {
    const put = () => {
      if (document.getElementById("demo-style")) return true;
      if (!document.head) return false;
      const s = document.createElement("style");
      s.id = "demo-style";
      s.textContent = css;
      document.head.appendChild(s);
      return true;
    };
    if (!put()) {
      const mo = new MutationObserver(() => { if (put()) mo.disconnect(); });
      mo.observe(document, { childList: true, subtree: true });
    }
  }, HIDDEN_CSS);
}

async function reveal(page) {
  await page.evaluate(([base, bg]) => {
    const s = document.getElementById("demo-style");
    if (!s) return;
    s.textContent = `${base} html{background:${bg}!important} body{opacity:1;transition:opacity .4s ease}`;
    setTimeout(() => { s.textContent = base; }, 450);
  }, [BASE_CSS, BG]).catch(() => {});
  await page.waitForTimeout(450);
}

async function fadeOut(page) {
  if (page.url() === "about:blank") return;
  await page.evaluate((bg) => {
    const o = document.getElementById("demo-overlay");
    if (o) o.style.opacity = "0";
    document.documentElement.style.background = bg;
    document.body.style.transition = "opacity .3s ease";
    document.body.style.opacity = "0";
  }, BG).catch(() => {});
  await page.waitForTimeout(330);
}

async function open(page, url, readySelector) {
  await fadeOut(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (readySelector) await page.locator(readySelector).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(600); // let React hydrate before adding the overlay
  await overlay(page);
  await reveal(page);
}

// ───────────────────────── captions, cursor, highlights ─────────────────────────

const OVERLAY_JS = () => {
  if (document.getElementById("demo-overlay")) return;
  const style = document.createElement("style");
  style.textContent = `
    #demo-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: "Archivo Variable", Archivo, system-ui, sans-serif; transition: opacity .3s; }
    #demo-cap { position: absolute; left: 50%; bottom: 34px; transform: translate(-50%, 12px); opacity: 0; max-width: 1060px; width: max-content;
      background: rgba(20, 18, 24, .93); color: #f8f5ef; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 12px 20px 14px;
      box-shadow: 0 18px 50px rgba(0,0,0,.35); transition: opacity .35s ease, transform .35s ease; }
    #demo-cap.on { opacity: 1; transform: translate(-50%, 0); }
    #demo-cap .lbl { font: 700 11px/1 "IBM Plex Mono", ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: #c9c3cf; margin-bottom: 7px; display: flex; align-items: center; gap: 7px; }
    #demo-cap .lbl.live { color: #ff8a73; }
    #demo-cap .lbl.live::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #ff5a3c; animation: demo-pulse 1s infinite; }
    #demo-cap .txt { font-size: 22px; line-height: 1.3; font-weight: 500; }
    #demo-cap .txt b { color: #ffb4a4; font-weight: 700; }
    #demo-cursor { position: absolute; left: 640px; top: 420px; width: 26px; height: 26px; transition: left .7s cubic-bezier(.4,.1,.2,1), top .7s cubic-bezier(.4,.1,.2,1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
    #demo-cursor.tap::after { content: ""; position: absolute; left: -9px; top: -9px; width: 26px; height: 26px; border-radius: 50%; border: 3px solid #ff5a3c; animation: demo-ring .45s ease-out forwards; }
    .demo-hl { position: absolute; border: 3px solid #ff5a3c; border-radius: 10px; box-shadow: 0 0 0 4px rgba(255,90,60,.18); animation: demo-hl .45s cubic-bezier(.2,.9,.3,1.3) both; }
    @keyframes demo-pulse { 50% { opacity: .3; } }
    @keyframes demo-ring { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
    @keyframes demo-hl { from { opacity: 0; transform: scale(1.08); } }`;
  const root = document.createElement("div");
  root.id = "demo-overlay";
  root.innerHTML = `<div id="demo-hls"></div><div id="demo-cap"><div class="lbl"></div><div class="txt"></div></div>
    <svg id="demo-cursor" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.6 L12 13.8 L19 13.8 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  document.documentElement.append(style, root);
  const pos = window.__demoCursor;
  if (pos) Object.assign(document.getElementById("demo-cursor").style, { left: pos.x + "px", top: pos.y + "px" });
};

async function overlay(page) {
  await page.evaluate(OVERLAY_JS).catch(() => {});
}

/** Caption at the bottom. label: small tag above the text; live: red pulsing dot. */
async function caption(page, text, { label = "", live = false } = {}) {
  await overlay(page);
  await page.evaluate(([text, label, live]) => {
    const cap = document.getElementById("demo-cap");
    if (!cap) return;
    const swap = () => {
      const lbl = cap.querySelector(".lbl");
      lbl.textContent = label;
      lbl.className = "lbl" + (live ? " live" : "");
      lbl.style.display = label ? "flex" : "none";
      cap.querySelector(".txt").innerHTML = text;
      cap.classList.add("on");
    };
    if (cap.classList.contains("on")) { cap.classList.remove("on"); setTimeout(swap, 250); } else swap();
  }, [text, label, live]).catch(() => {});
  await page.waitForTimeout(300);
}

/** Red pen box around every element the locator matches (viewport coordinates). */
async function ring(page, locator) {
  await overlay(page);
  const boxes = [];
  for (const el of await locator.all().catch(() => [])) {
    const b = await el.boundingBox().catch(() => null);
    if (b && b.width > 0) boxes.push(b);
  }
  await page.evaluate((boxes) => {
    const host = document.getElementById("demo-hls");
    if (!host) return;
    boxes.forEach((b, i) => {
      const d = document.createElement("div");
      d.className = "demo-hl";
      Object.assign(d.style, { left: b.x - 6 + "px", top: b.y - 5 + "px", width: b.width + 12 + "px", height: b.height + 10 + "px", animationDelay: i * 0.18 + "s" });
      host.append(d);
    });
  }, boxes).catch(() => {});
  await page.waitForTimeout(250 + boxes.length * 180);
}

async function clearRings(page) {
  await page.evaluate(() => { const h = document.getElementById("demo-hls"); if (h) h.innerHTML = ""; }).catch(() => {});
}

async function moveTo(page, locator) {
  await overlay(page);
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  const x = box.x + Math.min(box.width / 2, 120), y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => {
    window.__demoCursor = { x, y };
    const c = document.getElementById("demo-cursor");
    if (c) Object.assign(c.style, { left: x + "px", top: y + "px" });
  }, [x, y]).catch(() => {});
  await page.waitForTimeout(750);
}

async function tap(page, locator) {
  await moveTo(page, locator);
  await page.evaluate(() => {
    const c = document.getElementById("demo-cursor");
    if (!c) return;
    c.classList.remove("tap"); void c.getBoundingClientRect(); c.classList.add("tap");
  }).catch(() => {});
  await locator.click();
}

/** Smooth scroll so the element sits `offset` px from the top of the viewport. */
async function scrollToEl(page, locator, offset = 90, ms = 900) {
  const box = await locator.boundingBox().catch(() => null);
  if (box) await scrollBy(page, box.y - offset, ms);
}

async function scrollBy(page, dy, ms = 900) {
  await clearRings(page);
  await page.evaluate(([dy, ms]) => new Promise((done) => {
    const start = scrollY, t0 = performance.now();
    const ease = (t) => (t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      scrollTo(0, start + dy * ease(t));
      t < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  }), [dy, ms]).catch(() => {});
  await page.waitForTimeout(150);
}

// ───────────────────────── title cards ─────────────────────────

function fontLinks() {
  const nm = join(ROOT, "apps/web/node_modules");
  return ["@fontsource-variable/archivo/wdth.css", "@fontsource/ibm-plex-mono/600.css", "@fontsource/kalam/700.css"]
    .map((p) => join(nm, p))
    .filter(existsSync)
    .map((p) => `<link rel="stylesheet" href="${pathToFileURL(p).href}">`)
    .join("");
}

const STAMP = `
<svg width="0" height="0" style="position:absolute"><filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="warp"/>
  <feDisplacementMap in="SourceGraphic" in2="warp" scale="4" xChannelSelector="R" yChannelSelector="G" result="rough"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.18" numOctaves="3" seed="3" result="grain"/>
  <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -16 11.2" result="holes"/>
  <feComposite in="rough" in2="holes" operator="in"/></filter></svg>
<div class="stamp"><b>jhol</b><div class="rule"></div><i>CHECKED</i></div>`;

function cardHtml(body) {
  return `<!doctype html><html><head><meta charset="utf-8">${fontLinks()}<style>
  *{margin:0;box-sizing:border-box}
  html{background:${BG}}
  body{width:${W}px;height:${H}px;overflow:hidden;background:${BG};color:#f8f5ef;font-family:"Archivo Variable",Archivo,system-ui,sans-serif;
    display:flex;flex-direction:column;justify-content:center;padding:0 110px;position:relative}
  body::before{content:"";position:absolute;inset:0;background-image:linear-gradient(to right,rgba(196,74,47,.09) 1px,transparent 1px),linear-gradient(to bottom,rgba(54,123,103,.09) 1px,transparent 1px);background-size:40px 40px;-webkit-mask:radial-gradient(circle at 70% 40%,#000,transparent 75%);mask:radial-gradient(circle at 70% 40%,#000,transparent 75%)}
  .k{font:600 15px/1 "IBM Plex Mono",monospace;letter-spacing:.2em;text-transform:uppercase;color:#ff8a73}
  h1{font-stretch:62%;font-weight:800;font-size:96px;line-height:.92;letter-spacing:-.01em;margin-top:20px;max-width:1000px}
  h1 em{font-style:normal;color:#ff6b4f}
  p{font-size:26px;line-height:1.4;color:rgba(248,245,239,.78);max-width:880px;margin-top:26px}
  .narrow h1,.narrow p,.narrow .row{max-width:690px}
  .row{display:flex;gap:12px;flex-wrap:wrap;margin-top:34px}
  .pill{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);border-radius:999px;padding:10px 18px;font-size:19px;font-weight:600}
  .pill i{font-style:normal;color:#ff8a73}
  .hand{font-family:Kalam,cursive;color:#ff6b4f;font-size:28px}
  .stamp{position:absolute;right:120px;top:50%;margin-top:-150px;color:#ff5a3c;transform:rotate(-10deg);filter:url(#ink);padding:26px 40px 30px;text-align:center;animation:thump .5s cubic-bezier(.3,1.6,.5,1) .9s both}
  .stamp::before,.stamp::after{content:"";position:absolute;border:7px solid #ff5a3c;border-radius:10px}
  .stamp::before{inset:0}.stamp::after{inset:13px;border-width:3px;border-radius:5px}
  .stamp b{display:block;font-stretch:62%;font-weight:800;font-size:150px;line-height:.95}
  .stamp i{display:block;font-style:normal;font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:23px;letter-spacing:.24em;margin-top:6px;padding-left:.24em}
  .stamp .rule{height:3px;background:#ff5a3c;margin:6px 6px 0}
  .fade{animation:in .7s ease both}.d1{animation-delay:.25s}.d2{animation-delay:.5s}.d3{animation-delay:.75s}
  @keyframes in{from{opacity:0;transform:translateY(14px)}}
  @keyframes thump{from{opacity:0;transform:rotate(-10deg) scale(1.6)}}
  </style></head><body>${body}</body></html>`;
}

async function card(page, name, body, ms) {
  mkdirSync(join(OUT, "cards"), { recursive: true });
  const file = join(OUT, "cards", `${name}.html`);
  writeFileSync(file, cardHtml(body));
  await fadeOut(page);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await reveal(page);
  await hold(page, ms);
}

// ───────────────────────── segments ─────────────────────────

async function storeWalkthrough(page, store) {
  const nag = page.locator('[data-action="nag-close"]').last(); // the "Not now" link
  const closeNag = async () => {
    if (await nag.isVisible().catch(() => false)) { await tap(page, nag); await page.waitForTimeout(300); }
  };
  // The store opens the same popup ~0.7s after every page change (that is the nagging pattern).
  const settle = async () => { await page.waitForTimeout(1100); await overlay(page); await closeNag(); };
  const stap = async (loc) => {
    await clearRings(page);
    await closeNag();
    try { await tap(page, loc); } catch { await closeNag(); await loc.click({ timeout: 5000 }); }
  };
  const L = "The problem";

  await open(page, store);
  await caption(page, "Meet <b>Chalak Mart</b>: our test store with 9 tricks planted on purpose, copied from real Indian checkouts.", { label: L });
  await page.waitForTimeout(900);
  if (await nag.isVisible().catch(() => false)) {
    await hold(page, 2200);
    await caption(page, "This popup comes back on <b>every page</b>. That's a banned pattern too: nagging.", { label: L });
    await hold(page, 3000);
  } else {
    await hold(page, 3000);
  }
  await closeNag();
  await page.evaluate(() => { location.hash = "#/p/tee"; });
  await settle();
  await caption(page, "The product page says <b>₹499</b>. Plus a countdown and an “only a few left” badge.", { label: L });
  await ring(page, page.locator(".price"));
  await ring(page, page.locator(".urgent"));
  await hold(page, 3800);
  await stap(page.locator('[data-action="add"]').first());
  await settle();
  await caption(page, "In the cart: a <b>donation added for you</b>, <b>order protection pre-ticked</b>, and a ₹199/mo trial pre-ticked.", { label: L });
  await ring(page, page.locator(".row").filter({ hasText: /Donation/i }));
  await ring(page, page.locator("label.chk"));
  await hold(page, 4500);
  await stap(page.locator('[data-action="checkout"]').first());
  await page.waitForTimeout(800);
  const no = page.locator('[data-action="upsell-no"]');
  if (await no.isVisible().catch(() => false)) {
    await caption(page, "Then a guilt trip: <b>“No thanks, I don't mind if my order arrives broken.”</b>", { label: L });
    await ring(page, no);
    await hold(page, 3500);
    await stap(no);
  }
  await settle();
  if (await page.locator("[name=name]").isVisible().catch(() => false)) {
    await page.fill("[name=name]", "Test User");
    await page.fill("[name=email]", "test@example.com");
    await page.fill("[name=pincode]", "110001");
    await stap(page.locator("button[type=submit]").first());
    await settle();
  }
  await caption(page, "At the last step, two new fees appear. <b>₹499 became ₹606.</b> Nobody checks this step. Jhol does.", { label: L });
  await ring(page, page.locator(".row").filter({ hasText: /Platform fee|Handling fee/i }));
  await ring(page, page.locator(".row.total"));
  await hold(page, 5000);
  await clearRings(page);
}

async function startLiveAudit(page, store) {
  await open(page, WEB + "/", "#url");
  await caption(page, "This is <b>Jhol</b>. An AI agent that shops your store like a real customer and stops before payment.", { label: "Jhol" });
  await hold(page, 4000);
  await scrollToEl(page, page.locator("#audit"), 70, 1300);
  await caption(page, "Paste a checkout link and press run. That's the whole setup.", { label: "Jhol" });
  const chip = page.getByRole("button", { name: /False-urgency test/i });
  if ((await chip.getAttribute("aria-pressed").catch(() => null)) === "true") {
    await hold(page, 1200);
    await caption(page, "Two-visit mode (2 min apart) catches fake timers. We use <b>one visit</b> here to keep the demo short.", { label: "Jhol" });
    await tap(page, chip);
    await hold(page, 2600);
  }
  const url = page.locator("#url");
  await tap(page, url);
  await url.pressSequentially(store, { delay: 35 });
  await hold(page, 500);
  await tap(page, page.getByRole("button", { name: /Run audit/i }));
  await page.waitForURL(/\/audits\/[0-9a-f-]{36}/, { timeout: 45_000 });
  const id = page.url().match(/audits\/([0-9a-f-]{36})/)[1];
  await page.locator("h1").first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
  await overlay(page);
  await reveal(page);
  await caption(page, `A real browser is now shopping the store. The agent (${AGENT}) reads each page and decides the next click.`, { label: "Live run", live: true });
  const ev = page.locator('section[aria-label="Checkout evidence"]');
  await ev.waitFor({ timeout: 60_000 }).catch(() => {});
  if (await ev.isVisible().catch(() => false)) {
    await hold(page, 2000);
    await scrollToEl(page, ev, 80, 900);
    await caption(page, "Every step is saved with a screenshot and the price on screen, so each finding has proof.", { label: "Live run", live: true });
    await hold(page, 9000);
  } else {
    await hold(page, 8000);
  }
  return id;
}

async function finishedReport(page, report) {
  const a = report.audit;
  const L = "Recorded earlier today";
  await open(page, `${WEB}/audits/${a.id}`, "h1");
  await caption(page, a.sessions === 2
    ? "Here is a finished audit of the same store, with <b>two visits 2 minutes apart</b>."
    : "Here is a finished audit of the same store.", { label: L });
  await hold(page, 3500);
  const price = page.getByText(/Price shown/i).first();
  if (await price.isVisible().catch(() => false)) {
    await scrollToEl(page, price, 110, 900);
    const extra = a.price_final - a.price_shown;
    await caption(page, `Shown <b>₹${a.price_shown}</b>, paid <b>₹${a.price_final}</b>${extra > 0 ? ` (+₹${extra})` : ""}. Jhol score <b>${a.score}/100</b>.`, { label: L });
    await hold(page, 4500);
  }
  const findings = page.locator("ul li").filter({ has: page.locator("blockquote") });
  if (await findings.count()) {
    await scrollToEl(page, findings.first(), 120, 1000);
    await caption(page, `<b>${report.findings.length} findings</b>, each mapped to a CCPA dark pattern and quoting the exact text the agent saw.`, { label: L });
    await ring(page, findings.first().locator("blockquote"));
    await hold(page, 4500);
    await scrollBy(page, 320, 1600);
    const judged = report.findings.some((f) => f.source === "llm");
    const urgency = report.findings.some((f) => f.pattern === "false_urgency");
    await caption(page, [
      "Rules catch the money tricks.",
      judged ? "An <b>AI judge</b> catches wording like confirm-shaming, and may only quote text that was really on the page." : "",
      urgency ? "The timer reset between visits, so it's flagged as <b>false urgency</b>." : "",
    ].filter(Boolean).join(" "), { label: L });
    await hold(page, 5500);
    if (report.precedents && Object.values(report.precedents).some((l) => l?.length)) {
      const prec = page.getByText(/Regulators have acted on this before/i).first();
      if (await prec.isVisible().catch(() => false)) {
        await scrollToEl(page, prec, 220, 900);
        await caption(page, "Exa finds news and government pages where regulators acted on the <b>same pattern</b>.", { label: L });
        await hold(page, 4000);
      }
    }
  }
  const seal = page.getByText(/Report sealed/i).first();
  if (await seal.isVisible().catch(() => false)) {
    await scrollToEl(page, seal, 380, 1000);
    await caption(page, "The report is sealed with a <b>SHA-256 hash</b>, so the evidence can't be quietly edited later.", { label: L });
    await ring(page, seal);
    await hold(page, 3800);
  }
  const visit = page.locator('section[aria-label="Checkout evidence"] details').first();
  if (await visit.isVisible().catch(() => false)) {
    await scrollToEl(page, visit, 80, 1000);
    await caption(page, "Click any step to see exactly what the shopper saw at that moment.", { label: L });
    const buttons = visit.locator("ol button");
    const n = await buttons.count();
    const picks = [...new Set([3, 8, n - 1].map((i) => Math.min(i, n - 1)))].filter((i) => i >= 0);
    for (const i of picks) {
      await tap(page, buttons.nth(i));
      await hold(page, 1900);
    }
    await hold(page, 1000);
  }
}

async function liveResult(page, id, fixExpected) {
  let view = await getView(id);
  if (!view || view.audit.status === "failed") {
    warn(`The live audit ${id} failed${view?.audit.error ? `: ${view.audit.error}` : ""}. Re-run the script (or LIVE=0).`);
    return;
  }
  await open(page, `${WEB}/audits/${id}`, "h1");
  if (view.audit.status !== "done") {
    await caption(page, "Back to our live run. The agent has reached the payment page and is writing the report.", { label: "Live run", live: true });
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && !["done", "failed"].includes(view?.audit.status)) {
      await page.waitForTimeout(2000);
      view = await getView(id);
    }
    await page.waitForTimeout(2500);
  }
  if (view?.audit.status !== "done") {
    warn(`The live audit ${id} did not finish in time (status: ${view?.audit.status ?? "unknown"}).`);
    return;
  }
  await overlay(page);
  const a = view.audit;
  await caption(page, `Our live run just finished: <b>₹${a.price_shown} → ₹${a.price_final}</b>, score <b>${a.score}/100</b>, <b>${view.findings.length} findings</b>.`, { label: "Live run", live: true });
  const price = page.getByText(/Price shown/i).first();
  if (await price.isVisible().catch(() => false)) await scrollToEl(page, price, 110, 900);
  await hold(page, 4500);
  const fixBtn = page.getByRole("button", { name: /Fix with Codex/i });
  if (await fixBtn.isVisible().catch(() => false)) {
    await scrollToEl(page, fixBtn, 330, 1200);
    await caption(page, "Now the fix. One click sends the findings to <b>Codex</b>, which edits the store's checkout code.", { label: "Live run", live: true });
    await moveTo(page, fixBtn);
    await ring(page, fixBtn);
    await hold(page, 3500);
    if (CLICK_FIX) { await tap(page, fixBtn); await hold(page, 3500); }
  } else if (fixExpected) {
    warn('No "Fix with Codex" button on the live audit. The store URL must equal FIX_STORE_URL in apps/api/.env.');
  }
}

async function codexFix(page, fix) {
  const a = fix.audit, after = fix.fix_after;
  const L = "Recorded earlier today";
  await open(page, `${WEB}/audits/${a.id}`, "h1");
  const section = page.locator('section[aria-label="Codex fix"]');
  await section.waitFor({ timeout: 20_000 }).catch(() => {});
  await caption(page, "This is a fix Codex made earlier today on the same store.", { label: L });
  await hold(page, 2500);
  if (await section.isVisible().catch(() => false)) {
    await scrollToEl(page, section, 120, 1300);
    await caption(page, `Codex removed the tricks${a.fix_pr_url ? " and opened a real <b>pull request</b>" : " on a branch"}. Then Jhol <b>shopped the fixed store again</b> to check.`, { label: L });
    await hold(page, 5000);
    await caption(page, `Before: <b>₹${a.price_final}</b>, score ${a.score}/100. After: <b>₹${after.price_final}</b>, score <b>${after.score}/100</b>. Stamped <b>CHECKED BY JHOL</b>.`, { label: L });
    const stamp = page.getByText("CHECKED BY JHOL", { exact: true }).first();
    if (await stamp.isVisible().catch(() => false)) { await moveTo(page, stamp); await ring(page, stamp); }
    await hold(page, 5500);
  }
  if (a.fix_pr_url && (await reachable(a.fix_pr_url))) {
    await open(page, a.fix_pr_url + "/files", "body");
    await page.waitForTimeout(1200);
    await caption(page, "The real pull request on GitHub, with Codex's changes to the checkout code.", { label: L });
    await hold(page, 3500);
    await scrollBy(page, 420, 2200);
    await hold(page, 3500);
  } else if (a.fix_pr_url) {
    log(`PR page ${a.fix_pr_url} isn't public, skipped`);
  }
  if (after?.id) {
    await open(page, `${WEB}/audits/${after.id}`, "h1");
    const price = page.getByText(/Price shown/i).first();
    if (await price.isVisible().catch(() => false)) await scrollToEl(page, price, 110, 900);
    await caption(page, `The re-audit of the fixed store: <b>₹${after.price_final}</b> at payment, the same as the product page. <b>${after.score}/100.</b>`, { label: L });
    await hold(page, 5000);
  }
}

// ───────────────────────── main ─────────────────────────

async function main() {
  mkdirSync(OUT, { recursive: true });
  log(`web:   ${WEB}`);
  if (!(await reachable(WEB + "/"))) throw new Error(`Jhol web isn't reachable at ${WEB}. Start it first with "pnpm dev".`);

  const preferred = process.env.STORE || "http://localhost:5051/index.html";
  const store = (await reachable(preferred)) ? preferred : `${WEB}/lab/chalak-mart.html`;
  log(`store: ${store}`);
  log(`agent: ${AGENT}`);
  if (store !== preferred) warn(`${preferred} isn't running, so the lab copy is used and the "Fix with Codex" button won't appear.`);

  const { report, fix } = await pickAudits();
  log(`finished report: ${report ? `${report.audit.id} (${report.findings.length} findings, ${report.audit.sessions} visit(s))` : "none found, skipped"}`);
  log(`codex fix:       ${fix ? `${fix.audit.id} → ${fix.fix_after.id} (${fix.audit.fix_pr_url ?? "local branch"})` : "none found, skipped"}`);

  const browser = await chromium.launch();

  // Compile the Next.js dev routes off camera so the video has no compile pauses.
  {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const p = await ctx.newPage();
    for (const u of [WEB + "/", report && `${WEB}/audits/${report.audit.id}`, fix && `${WEB}/audits/${fix.audit.id}`].filter(Boolean)) {
      await p.goto(u, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => {});
      await p.waitForTimeout(1500);
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: join(OUT, "raw"), size: { width: W, height: H } },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });
  await installCover(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  log("recording…");

  await card(page, "01-intro", `${STAMP}<div class="narrow">
    <div class="k fade">DevDay Exchange · New Delhi</div>
    <h1 class="fade d1">Find the <em>jhol</em><br>in your checkout.</h1>
    <p class="fade d2">An AI agent shops your store like a real customer, catches CCPA dark patterns with proof, and gets Codex to fix them.</p></div>`, 5500);

  await card(page, "02-problem", `
    <div class="k fade">The problem</div>
    <h1 class="fade d1">₹499 on the product page.<br><em>₹606</em> at payment.</h1>
    <p class="fade d2">India's consumer regulator (CCPA) has banned 13 dark patterns. They hide after the cart, where nobody checks.</p>`, 5500);

  await storeWalkthrough(page, store);

  let liveId = null;
  if (LIVE) liveId = await startLiveAudit(page, store);
  if (report) await finishedReport(page, report);
  if (liveId) await liveResult(page, liveId, store === preferred);
  if (fix) await codexFix(page, fix);

  await card(page, "99-outro", `${STAMP}<div class="narrow">
    <div class="k fade">Find it → Prove it → Fix it</div>
    <h1 class="fade d1">Jhol</h1>
    <div class="row fade d2">
      <span class="pill"><i>OpenAI</i> agent + AI judge</span>
      <span class="pill"><i>Codex</i> fix PRs</span>
      <span class="pill"><i>Exa</i> regulator precedents</span>
      <span class="pill"><i>Cerebras</i> ready</span>
    </div>
    <p class="fade d3">On our test store, 3 runs × 2 visits caught 23 of 24 planted checks. It never pays.<br><span class="hand">github.com/Shivanshu49/Jhol</span></p></div>`, 7000);

  const video = page.video();
  await page.close();
  await ctx.close();
  await browser.close();

  const webm = join(OUT, "jhol-demo.webm");
  renameSync(await video.path(), webm);
  log(`video: ${webm}`);

  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {
    const mp4 = join(OUT, "jhol-demo.mp4");
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "inherit" });
    if (r.status === 0) log(`mp4:   ${mp4}`);
  } else {
    log("ffmpeg not found, only the .webm was written (sudo apt install ffmpeg for an .mp4)");
  }
  if (warnings.length) console.log("\nCheck before using this take:\n" + warnings.map((w) => "  - " + w).join("\n"));
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
