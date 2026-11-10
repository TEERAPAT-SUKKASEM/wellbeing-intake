// What this helper does: runs a "check for changes" function on a timer, so a screen keeps itself up to
// date without anyone pressing Refresh (this is called auto-refresh or polling).
// Used by: PractitionerDesk (queue and schedule), HelpdeskReferrals (the referrals list) and
// RequestsDashboard (a student's tracked request).
// Talks to: no API itself; each screen passes its own check function.
// Rules:
// - It only checks while the browser tab is visible, so a tab left in the background costs nothing.
// - When the tab becomes visible again it checks at once, then carries on with the timer.
// - It never starts a check while the previous one is still waiting for an answer.
// - The screen can pause it (enabled = false), for example while a decision is being saved.
// Why not "push" (Supabase Realtime)? Push would need the browser to read the database directly, but our
// database refuses every browser read (deny-all security rules) and students have no account. A check
// every 15 or 30 seconds looks live on screen and keeps that privacy design unchanged.
"use client";
import { useEffect, useRef } from "react";

// How often each screen checks. Staff screens check more often than the student page because staff
// are waiting for new bookings and referrals to arrive.
export const STAFF_REFRESH_MS = 15_000;
export const STUDENT_REFRESH_MS = 30_000;

// What the timer needs to know about the page: is it visible now, and a way to hear when that changes.
// In the browser this is document.visibilityState; the unit tests pass a fake one.
export type PageVisibility = {
  isVisible: () => boolean;
  onChange: (listener: () => void) => () => void;
};

/**
 * Starts the timer and returns a function that stops it.
 * check: the screen's check. It may return a promise; until that settles, the next turn is skipped.
 * A check that throws or rejects is ignored, and the timer keeps going.
 */
export function startAutoRefresh(
  check: () => unknown,
  intervalMs: number,
  page: PageVisibility,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  // running: a check has started and has not answered yet.
  let running = false;
  const run = () => {
    if (running) return; // the last check is still waiting: skip this turn
    running = true;
    let result: unknown;
    try {
      result = check();
    } catch {
      result = undefined;
    }
    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  const startTimer = () => {
    if (timer === null) timer = setInterval(run, intervalMs);
  };
  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  // Hidden tab: stop the timer. Visible again: check at once, then start the timer again.
  const unsubscribe = page.onChange(() => {
    if (page.isVisible()) {
      run();
      startTimer();
    } else {
      stopTimer();
    }
  });
  if (page.isVisible()) startTimer();
  return () => {
    stopTimer();
    unsubscribe();
  };
}

// The real page: the browser's visibility state and its "visibilitychange" event.
const browserPage: PageVisibility = {
  isVisible: () => document.visibilityState === "visible",
  onChange: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/**
 * React hook: calls check() every intervalMs while enabled is true and the tab is visible.
 * The latest check() is always used (kept in a ref), so the timer does not restart on every render.
 */
export function useAutoRefresh(check: () => unknown, intervalMs: number, enabled: boolean): void {
  const latest = useRef(check);
  useEffect(() => {
    latest.current = check;
  });
  useEffect(() => {
    if (!enabled) return;
    return startAutoRefresh(() => latest.current(), intervalMs, browserPage);
  }, [enabled, intervalMs]);
}

/** The time of the last successful check, in campus time with seconds, e.g. "17:42:05". */
export const lastUpdatedTime = (date: Date): string =>
  date.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
