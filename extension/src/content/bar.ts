// The sponsored banner — a persistent strip styled like claude.ai's own composer
// notices ("Claude Fable 5 is currently unavailable · Learn more"): label + ad text on
// the left, a "Learn more ↗" link on the right.
//
// Reliability first: the host is appended to document.body (so it ALWAYS renders,
// independent of finding claude.ai's markup) and positioned as a fixed band glued to
// the top edge of the composer box. If the composer box can't be found, it falls back
// to a centered band near the bottom so it is never invisible. Shadow DOM isolates our
// styles both ways.
import type { FeaturedAd } from "../config.js";
import { findComposerBox } from "./dom-anchors.js";

const HOST_ID = "spnr-host";

let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let link: HTMLAnchorElement | null = null;
let textEl: HTMLSpanElement | null = null;
let currentAd: FeaturedAd | null = null;

function build(): void {
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;z-index:2147483647;display:none;pointer-events:none;";
  root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .banner{
      box-sizing:border-box;pointer-events:auto;width:100%;
      display:flex;align-items:center;justify-content:space-between;gap:12px;
      padding:8px 16px;
      background:#ffffff;border:1px solid rgba(0,0,0,.10);border-bottom:none;
      border-radius:14px 14px 0 0;box-shadow:0 -2px 10px rgba(0,0,0,.05);
      font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
      color:#2b2b2b;
    }
    .left{display:flex;align-items:center;gap:8px;min-width:0;}
    .tag{font-weight:700;color:#7a5cff;flex:0 0 auto;}
    .txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3a3a3a;}
    a.cta{color:#6b4f2a;text-decoration:underline;text-underline-offset:2px;
      white-space:nowrap;flex:0 0 auto;cursor:pointer;}
    a.cta:hover{opacity:.8;}
    @media (prefers-color-scheme: dark){
      .banner{background:#1f1f22;border-color:rgba(255,255,255,.12);color:#e6e6e6;
        box-shadow:0 -2px 10px rgba(0,0,0,.3);}
      .tag{color:#9d86ff;} .txt{color:#cfcfcf;} a.cta{color:#d8c39a;}
    }
  `;

  const banner = document.createElement("div");
  banner.className = "banner";
  const left = document.createElement("div");
  left.className = "left";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = "Sponsored";
  textEl = document.createElement("span");
  textEl.className = "txt";
  textEl.textContent = "loading…"; // placeholder until the first ad arrives
  left.append(tag, textEl);
  link = document.createElement("a");
  link.className = "cta";
  link.target = "_blank";
  link.rel = "noopener noreferrer nofollow";
  link.textContent = "Learn more ↗";
  banner.append(left, link);
  root.append(style, banner);

  document.body.appendChild(host);
}

function ensureMounted(): void {
  if (!host) build();
  else if (!host.isConnected) document.body.appendChild(host);
}

/** Glue the band to the top edge of the composer box; fall back to bottom-center. */
function reposition(): void {
  if (!host) return;
  const box = findComposerBox();
  if (box) {
    const r = box.getBoundingClientRect();
    const h = host.offsetHeight || 34; // our banner's rendered height
    host.style.right = "auto";
    host.style.bottom = "auto";
    host.style.transform = "none";
    host.style.left = `${r.left}px`;
    host.style.width = `${r.width}px`;
    host.style.top = `${Math.max(4, r.top - h)}px`; // sit flush ABOVE the box
  } else {
    host.style.top = "auto";
    host.style.right = "auto";
    host.style.left = "50%";
    host.style.transform = "translateX(-50%)";
    host.style.width = "min(720px,90vw)";
    host.style.bottom = "96px";
  }
}

/** Mount the banner and keep it positioned over the composer box. */
export function mountBanner(): void {
  ensureMounted(); // build + position, but stay hidden until the user starts querying
  reposition();
  setInterval(() => {
    ensureMounted();
    reposition();
  }, 250);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
}

/** Set/replace the displayed ad and reveal the banner. Persists until the next call. */
export function setAd(ad: FeaturedAd): void {
  currentAd = ad;
  ensureMounted();
  if (!host || !textEl || !link) return;
  textEl.textContent = ad.text;
  link.href = ad.clickUrl;
  host.style.display = "block";
  reposition();
}

/** The currently displayed ad (if any) — used to attribute impressions. */
export function getAd(): FeaturedAd | null {
  return currentAd;
}
