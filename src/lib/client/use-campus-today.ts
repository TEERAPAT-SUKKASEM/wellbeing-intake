"use client";
import { useSyncExternalStore } from "react";
import { campusDate } from "./contracts";

const subscribe = () => () => {};
const serverDate = () => "";

// Static builds must not freeze a date into the initial form or hydrate with a
// different date days later. Read the current campus date after hydration.
export function useCampusToday() {
  return useSyncExternalStore(subscribe, campusDate, serverDate);
}
