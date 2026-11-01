"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

const STAGES = [
  {
    id: "product",
    label: "Product",
    hash: "#/p/tee",
    caption: "The first price the shopper sees",
    meta: "₹499",
    flag: "Fake timer + fake stock",
  },
  {
    id: "cart",
    label: "Cart",
    hash: "#/cart",
    caption: "Two extras sneak into the basket",
    meta: "₹558",
    flag: "₹59 you never picked",
  },
  {
    id: "review",
    label: "Review",
    hash: "#/review",
    caption: "Fees appear only at the end",
    meta: "₹606",
    flag: "₹48 of drip pricing",
  },
  {
    id: "report",
    label: "Report",
    hash: "#/review",
    caption: "Six patterns, with the exact text",
    meta: "32/100",
    flag: "Report sealed",
  },
] as const;

type StageId = (typeof STAGES)[number]["id"];

const DECORATIONS = [
  "Donation to Green India Fund",
  "Order Protection",
  "ChalakPlus",
  "Platform fee",
  "Handling fee",
  "Deal ends in",
  "left in stock",
];

const REPORT_FINDINGS = [
  { label: "Drip pricing", value: "Platform ₹19 · Handling ₹29" },
  { label: "Basket sneaking", value: "Donation ₹10 · Protection ₹49" },
  { label: "Subscription trap", value: "ChalakPlus renews at ₹199/mo" },
  { label: "False urgency", value: "Timer restarts on every visit" },
  { label: "Confirm shaming", value: "\u201cI don\u2019t mind if my order arrives broken\u201d" },
  { label: "Nagging", value: "\u201cGet 10% off\u201d on every page" },
];

const IFRAME_CSS = `
  :root {
    --color-primary: var(--jhol-primary);
    --color-primary-hover: var(--jhol-primary-hover);
    --color-secondary: var(--jhol-secondary);
    --color-secondary-hover: var(--jhol-secondary-hover);
    --color-accent: var(--jhol-accent);
    --color-surface: var(--jhol-surface);
    --color-surface-raised: var(--jhol-surface-raised);
    --color-ink: var(--jhol-ink);
    --color-paper: var(--jhol-paper);
    --color-muted: color-mix(in srgb, var(--jhol-paper) 72%, var(--jhol-surface));
    --color-line: color-mix(in srgb, var(--jhol-paper) 16%, transparent);
  }
  html, body { height: 100% !important; overflow: hidden !important; scroll-behavior: auto !important; }
  body { display: flex !important; flex-direction: column !important; }
  * { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; }
  .modal-bg { display: none !important; }
  footer { display: none !important; }
  main {
    width: 100% !important;
    flex: 1 !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-start !important;
    padding: 12px !important;
  }
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; }
  .grid > .card { min-width: 0; margin-bottom: 0 !important; padding: 10px !important; }
  .grid .muted { font-size: 12px !important; line-height: 1.35 !important; }
  .grid .btn { display: block; width: 100%; padding: 9px 8px !important; text-align: center; font-size: 14px !important; }
  main > a { display: inline-block !important; margin-bottom: 8px !important; }
  .urgent { border-left: 2px solid var(--color-secondary); border-radius: 6px; padding: 5px 8px; color: var(--color-paper); background: color-mix(in srgb, var(--color-secondary) 28%, var(--color-surface)); }
  h1 { font-size: 21px !important; margin: 4px 0 8px !important; }
  .card { padding: 12px !important; margin-bottom: 8px !important; }
  .row {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: center;
    column-gap: 20px !important;
    padding: 7px 0 !important;
  }
  .row > span:first-child { min-width: 0; overflow-wrap: anywhere; }
  .row > span:last-child { white-space: nowrap; text-align: right; }
  .chk { padding: 5px 0 !important; }
  .emoji { font-size: 40px !important; }
  .btn { padding: 10px 14px !important; }
  .row.total {
    margin-top: 6px !important;
    border-top: 1px solid var(--color-line) !important;
    border-radius: 8px !important;
    padding: 12px 10px !important;
    color: var(--color-paper) !important;
    background: color-mix(in srgb, var(--color-primary) 28%, var(--color-surface)) !important;
  }
  .jhol-flag {
    position: relative;
    color: var(--color-paper) !important;
    background: color-mix(in srgb, var(--color-primary) 32%, var(--color-surface)) !important;
    box-shadow: inset 3px 0 0 var(--color-secondary);
    border-radius: 6px;
    padding-right: 16px !important;
    animation: jhol-flag-pulse 1.8s ease-in-out infinite;
  }
  .jhol-flag::after {
    content: "";
    position: absolute;
    right: 5px;
    top: 50%;
    width: 5px;
    height: 5px;
    margin-top: -2.5px;
    border-radius: 999px;
    background: var(--color-secondary);
  }
  .row.jhol-flag,
  .chk.jhol-flag {
    margin: 5px 0 !important;
    padding: 8px 10px !important;
    border-radius: 8px !important;
  }
  .row.jhol-flag { border-bottom: 0 !important; }
  @keyframes jhol-flag-pulse {
    0%, 100% { background: color-mix(in srgb, var(--color-primary) 32%, var(--color-surface)) !important; }
    50% { background: color-mix(in srgb, var(--color-primary) 48%, var(--color-surface)) !important; }
  }
  @media (min-width: 560px) {
    .grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  }
`;

const SPRING = { type: "spring", stiffness: 500, damping: 35 } as const;

export function LiveWindow() {
  const reduce = useReducedMotion();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const [src, setSrc] = useState<string>();
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [current, setCurrent] = useState<StageId>("product");
  const [auto, setAuto] = useState(true);
  const [hovered, setHovered] = useState(false);

  const stage = STAGES.find((s) => s.id === current) ?? STAGES[0];

  // Seed a deterministic cart before the iframe boots, so every stage has content.
  useEffect(() => {
    setMounted(true);
    try {
      sessionStorage.setItem(
        "chalak-mart",
        JSON.stringify({
          cart: [{ id: "tee", qty: 1 }],
          donation: true,
          protection: true,
          trial: true,
          upsellDone: true,
          insurance: false,
          customer: { name: "Jhol Agent", email: "agent@jhol.test", pincode: "560001" },
        }),
      );
    } catch {
      /* storage blocked: the store falls back to a fresh in-memory cart */
    }
    setSrc("/lab/chalak-mart.html");
  }, []);

  const decorate = useCallback((doc?: Document | null) => {
    const target = doc ?? frameRef.current?.contentDocument;
    if (!target || !target.head) return;

    if (!target.getElementById("jhol-embed-style")) {
      const style = target.createElement("style");
      style.id = "jhol-embed-style";
      const theme = getComputedStyle(document.documentElement);
      style.textContent = `
        :root {
          --jhol-primary: ${theme.getPropertyValue("--color-primary").trim()};
          --jhol-primary-hover: ${theme.getPropertyValue("--color-primary-hover").trim()};
          --jhol-secondary: ${theme.getPropertyValue("--color-secondary").trim()};
          --jhol-secondary-hover: ${theme.getPropertyValue("--color-secondary-hover").trim()};
          --jhol-accent: ${theme.getPropertyValue("--color-accent").trim()};
          --jhol-surface: ${theme.getPropertyValue("--color-surface").trim()};
          --jhol-surface-raised: ${theme.getPropertyValue("--color-surface-raised").trim()};
          --jhol-ink: ${theme.getPropertyValue("--color-ink").trim()};
          --jhol-paper: ${theme.getPropertyValue("--color-paper").trim()};
        }
        ${IFRAME_CSS}
      `;
      target.head.appendChild(style);
    }

    target.querySelectorAll(".jhol-flag").forEach((el) => el.classList.remove("jhol-flag"));
    for (const needle of DECORATIONS) {
      target.querySelectorAll<HTMLElement>(".row, .chk, .urgent").forEach((el) => {
        if (el.classList.contains("jhol-flag")) return;
        if ((el.textContent ?? "").includes(needle)) {
          el.classList.add("jhol-flag");
        }
      });
    }
  }, []);

  const handleLoad = useCallback(() => {
    setReady(true);
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    decorate(doc);

    observerRef.current?.disconnect();
    const app = doc.getElementById("app");
    if (!app) return;
    const observer = new MutationObserver(() => decorate(doc));
    observer.observe(app, { childList: true, subtree: true });
    observerRef.current = observer;
  }, [decorate]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Drive the store's own hash router from our stage tabs.
  useEffect(() => {
    if (!ready) return;
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    try {
      if (win.location.hash !== stage.hash) win.location.hash = stage.hash;
      const t = window.setTimeout(() => decorate(), 80);
      return () => window.clearTimeout(t);
    } catch {
      /* iframe not reachable: leave the preview on its current page */
    }
  }, [ready, stage.hash, decorate]);

  // Auto-advance, pausing on hover and reduced-motion.
  useEffect(() => {
    if (!auto || hovered || reduce) return;
    const index = STAGES.findIndex((s) => s.id === current);
    const next = STAGES[(index + 1) % STAGES.length].id;
    const delay = current === "report" ? 6500 : current === "product" ? 4000 : current === "cart" ? 4200 : 5000;
    const timer = window.setTimeout(() => setCurrent(next), delay);
    return () => window.clearTimeout(timer);
  }, [auto, hovered, reduce, current]);

  function goTo(id: StageId) {
    setCurrent(id);
    setAuto(false);
  }

  const scanning = Boolean(mounted && auto && !hovered && !reduce);

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="absolute -inset-3 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/10 via-transparent to-secondary/20 blur-xl"
        aria-hidden
      />

      <div className="overflow-hidden rounded-2xl border border-ink/15 bg-white shadow-2xl shadow-ink/15">
        {/* browser chrome */}
        <div className="flex items-center gap-2.5 border-b border-white/15 bg-accent px-3 py-2 text-white">
          <div className="flex shrink-0 gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="h-2.5 w-2.5 rounded-full bg-secondary" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/75" />
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-ink/10 bg-white px-2 py-1 text-[10px] text-ink/45">
            <LockIcon />
            <span className="truncate">
              <span className="text-ink/70">jhol.test</span>/lab/chalak-mart.html
              <span className="text-ink/40">{stage.hash}</span>
            </span>
          </div>

          <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            <span className="h-1 w-1 animate-pulse rounded-full bg-secondary" />
            Live
          </span>

          <button
            type="button"
            onClick={() => setAuto((v) => !v)}
            aria-label={auto ? "Pause the demo" : "Play the demo"}
            aria-pressed={auto}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-white/65 transition-colors hover:bg-white/10 hover:text-white"
          >
            {auto ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>

        {/* browser tabs double as the four audit stages */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-ink/10 bg-paper/40 px-2 py-1.5">
          {STAGES.map((s) => {
            const active = current === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goTo(s.id)}
                aria-pressed={active}
                className="relative shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-secondary/10"
              >
                {active && (
                  <motion.span
                    layoutId="jhol-stage-pill"
                    className="absolute inset-0 rounded-md bg-white shadow-sm ring-1 ring-ink/10"
                    transition={SPRING}
                  />
                )}
                <span className={`relative z-10 ${active ? "text-ink" : "text-ink/50 hover:text-ink/80"}`}>
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* the live site */}
        <div className="relative h-[320px] overflow-hidden bg-paper sm:h-[540px]">
          {src ? (
            <iframe
              ref={frameRef}
              src={src}
              title="Live preview of the Chalak Mart test store"
              aria-hidden
              tabIndex={-1}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin"
              onLoad={handleLoad}
              style={{ pointerEvents: "none" }}
              className="absolute inset-0 h-full w-full border-0 bg-paper"
            />
          ) : (
            <div className="absolute inset-0 animate-pulse bg-paper" />
          )}
          <span className="sr-only">
            An animated preview of Chalak Mart, a fictional test store with deliberate dark patterns. The stage tabs
            change its pages; open the real store for a hands-on look.
          </span>

          <AnimatePresence>
            {scanning && (
              <motion.div
                key="scan"
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
              >
                <motion.div
                  className="absolute inset-x-0 h-20 bg-gradient-to-b from-transparent via-primary/15 to-transparent"
                  animate={{ top: ["-25%", "115%"] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
                />
                <motion.div
                  className="absolute inset-x-0 h-px bg-primary/50"
                  animate={{ top: ["-2%", "102%"] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {current === "report" && (
              <ReportOverlay
                key="report"
                reduce={Boolean(reduce)}
                onReplay={() => {
                  setCurrent("product");
                  setAuto(true);
                }}
                onClose={() => goTo("review")}
              />
            )}
          </AnimatePresence>
        </div>

        {/* status strip */}
        <div className="flex items-center justify-between gap-4 border-t border-ink/10 bg-white px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={stage.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {current !== "report" && (
                  <p className="text-[9px] font-bold leading-tight uppercase tracking-[0.16em] text-ink">
                    <span className="rounded bg-primary px-1 py-0.5 text-white">Jhol found</span> · {stage.flag}
                  </p>
                )}
                <p className="mt-0.5 truncate text-[11px] font-medium text-ink/60">{stage.caption}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="shrink-0 rounded-lg bg-paper px-2.5 py-1.5 text-right">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-ink/40">
              {current === "report" ? "Jhol score" : "Total"}
            </span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={stage.meta}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className={`block text-sm font-black leading-tight ${current === "report" ? "text-secondary" : "text-ink"}`}
              >
                {stage.meta}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-ink/40">
        <span>Live preview · Chalak Mart test store</span>
        <a
          href="/lab/chalak-mart.html"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-primary transition-colors hover:text-primary-hover"
        >
          Open the real store ↗
        </a>
      </div>
    </div>
  );
}

function ReportOverlay({
  reduce,
  onReplay,
  onClose,
}: {
  reduce: boolean;
  onReplay: () => void;
  onClose: () => void;
}) {
  const R = 26;
  const C = 2 * Math.PI * R;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      role="dialog"
      aria-label="Jhol report preview"
      className="absolute inset-0 z-30 flex items-center justify-center bg-accent/30 p-3 backdrop-blur-sm sm:p-5"
    >
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 34, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? undefined : { opacity: 0, y: 18, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-surface p-4 text-paper shadow-2xl sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-primary">Audit complete</p>
            <h3 className="mt-0.5 text-lg font-black leading-tight text-primary">Chalak Mart</h3>
            <p className="text-[11px] text-white/65">{REPORT_FINDINGS.length} findings · sealed report</p>
          </div>
          <div className="relative grid h-16 w-16 shrink-0 place-items-center">
            <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden>
              <circle cx="32" cy="32" r={R} fill="none" strokeWidth="6" className="stroke-white/20" />
              <motion.circle
                cx="32"
                cy="32"
                r={R}
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={C}
                className="stroke-primary"
                initial={reduce ? false : { strokeDashoffset: C }}
                animate={{ strokeDashoffset: C * 0.68 }}
                transition={{ duration: 1.1, delay: 0.15, ease: "easeOut" }}
              />
            </svg>
            <span className="absolute text-sm font-black">32</span>
          </div>
        </div>

        <ul className="mt-3 space-y-1.5">
          {REPORT_FINDINGS.map((f, i) => (
            <motion.li
              key={f.label}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduce ? 0 : 0.18 + i * 0.06, duration: 0.3 }}
              className="flex items-start gap-2 text-[11px] leading-snug"
            >
              <span className="mt-px shrink-0 rounded-full bg-secondary/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-paper">
                {f.label}
              </span>
              <span className="text-white/75">{f.value}</span>
            </motion.li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/15 pt-3">
          <span className="truncate font-mono text-[9px] text-white/55">SHA-256 · 9f2c…4a71</span>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/20 px-2.5 py-1 text-[10px] font-semibold text-white/75 transition-colors hover:border-secondary/50 hover:bg-secondary/10 hover:text-white"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onReplay}
              className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-primary-hover"
            >
              Replay
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 shrink-0" fill="none" aria-hidden>
      <rect x="3.5" y="7" width="9" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
      <path d="M5 3.6c0-.8.9-1.3 1.6-.9l6 4.4c.6.4.6 1.3 0 1.7l-6 4.4c-.7.4-1.6-.1-1.6-.9V3.6Z" />
    </svg>
  );
}
