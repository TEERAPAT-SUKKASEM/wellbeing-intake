// What this helper does: a React hook that gives today's campus date (YYYY-MM-DD) in the browser.
// Talks to: no API calls.
// Note: on the server it returns "", so no date is frozen into the built HTML.
"use client";
import { useSyncExternalStore } from "react";
import { campusDate } from "./contracts";

// There is no "date changed" event to listen to, so subscribe does nothing and returns a no-op cleanup.
const subscribe = () => () => {};
// The value used on the server and during hydration: empty, meaning "date not known yet".
const serverDate = () => "";

// Static builds must not freeze a date into the initial form or hydrate with a
// different date days later. Read the current campus date after hydration.
// In the browser React calls campusDate() for the value; on the server it calls serverDate().
export function useCampusToday() {
  return useSyncExternalStore(subscribe, campusDate, serverDate);
}
