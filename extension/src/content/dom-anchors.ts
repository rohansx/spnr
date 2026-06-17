// The ONLY module coupled to claude.ai's markup. If claude.ai changes its DOM, this
// is the single place to update. Everything here is read-only structure probing — it
// NEVER reads the text content of the composer (content firewall, invariant 2).

/** The prompt composer (a contenteditable / textarea). Used only to attach the
 *  Enter-key listener — its value is never read. */
export function findComposer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('div[contenteditable="true"]') ??
    document.querySelector<HTMLElement>("textarea")
  );
}

/** The composer's outer rounded box — the visual container that wraps any top notice
 *  (e.g. "Claude Fable 5 is currently unavailable") AND the input. We anchor the ad
 *  banner just above THIS so it doesn't collide with claude.ai's own top strip.
 *
 *  Found by climbing from the input to the nearest sizeable ancestor with a rounded
 *  border (the composer card). Falls back to the form, then the input. */
export function findComposerBox(): HTMLElement | null {
  const c = findComposer();
  if (!c) return null;
  let el: HTMLElement | null = c;
  for (let i = 0; i < 8 && el; i++) {
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    const w = el.getBoundingClientRect().width;
    if (radius >= 10 && w > 300) return el; // the rounded composer card
    el = el.parentElement;
  }
  return (c.closest("form") as HTMLElement | null) ?? c.parentElement ?? c;
}

/** The send button, matched by aria-label across claude.ai variants. */
export function findSendButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    'button[aria-label*="Send" i], button[aria-label*="submit" i]',
  );
}

/** The stop button, present only while a response is streaming. */
function findStopButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    'button[aria-label*="Stop" i], button[aria-label*="cancel" i]',
  );
}

/** True while Claude is generating a response (proxy: the stop control exists). */
export function isStreaming(): boolean {
  return findStopButton() !== null;
}
