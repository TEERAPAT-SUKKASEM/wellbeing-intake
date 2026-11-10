// What this test file does: checks the auto-refresh timer behind the staff desk, the referrals list and
// the student tracking page (startAutoRefresh in src/lib/client/auto-refresh.ts). A fake clock and a fake
// "is the tab visible?" switch are used, so no browser and no network are needed.
// Why it matters: the screens must keep themselves up to date, but a tab left in the background must not
// keep calling the API, a slow answer must not pile up more calls, and one failed check must not stop
// the next ones.
// How to run it: `pnpm test`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAutoRefresh, type PageVisibility } from "@/lib/client/auto-refresh";

// A fake page whose visibility the test can switch, like minimising and reopening a browser tab.
function fakePage(visible = true) {
  let isVisible = visible;
  const listeners = new Set<() => void>();
  const page: PageVisibility = {
    isVisible: () => isVisible,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const setVisible = (next: boolean) => {
    isVisible = next;
    listeners.forEach((listener) => listener());
  };
  return { page, setVisible, listenerCount: () => listeners.size };
}

describe("auto-refresh timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks once per interval while the tab is visible, not straight away", async () => {
    const check = vi.fn();
    const { page } = fakePage();
    const stop = startAutoRefresh(check, 15_000, page);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
  });

  it("makes no calls while the tab is hidden, then checks at once when it is visible again", async () => {
    const check = vi.fn();
    const { page, setVisible } = fakePage();
    const stop = startAutoRefresh(check, 15_000, page);
    setVisible(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(check).not.toHaveBeenCalled();
    setVisible(true);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not start while the page opens hidden", async () => {
    const check = vi.fn();
    const { page } = fakePage(false);
    const stop = startAutoRefresh(check, 15_000, page);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).not.toHaveBeenCalled();
    stop();
  });

  it("skips a turn while the previous check is still waiting for an answer", async () => {
    let answer: () => void = () => {};
    const check = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)));
    const { page } = fakePage();
    const stop = startAutoRefresh(check, 15_000, page);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(45_000); // three more turns pass with no answer
    expect(check).toHaveBeenCalledTimes(1);
    answer();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps going after a check throws or its promise rejects", async () => {
    const check = vi
      .fn<() => unknown>()
      .mockImplementationOnce(() => {
        throw new Error("network down");
      })
      .mockImplementationOnce(() => Promise.reject(new Error("server error")))
      .mockImplementation(() => undefined);
    const { page } = fakePage();
    const stop = startAutoRefresh(check, 15_000, page);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stop() ends the timer and stops listening for tab changes", async () => {
    const check = vi.fn();
    const { page, setVisible, listenerCount } = fakePage();
    const stop = startAutoRefresh(check, 15_000, page);
    expect(listenerCount()).toBe(1);
    stop();
    expect(listenerCount()).toBe(0);
    setVisible(false);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).not.toHaveBeenCalled();
  });
});
