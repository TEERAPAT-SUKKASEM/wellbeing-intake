export function UiIcon({ name, className = "size-5" }: { name: "talk" | "health" | "movement" | "wellbeing" | "arrow" | "close"; className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {name === "talk" && <><path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z" /><path d="M7 10h8m-8 4h5" /></>}
    {name === "health" && <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 7v10M7 12h10" /></>}
    {name === "movement" && <><circle cx="15" cy="4" r="2" /><path d="m12 9 4 3 4-1M5 11l5-3 3 7-4 6m4-6 5 5" /></>}
    {name === "wellbeing" && <><path d="M12 20v-7m0 4C5 17 3 12 4 6c6 0 9 4 8 11Zm0-4c0-6 3-9 8-9 1 5-2 9-8 9Z" /></>}
    {name === "arrow" && <path d="M5 12h14m-6-6 6 6-6 6" />}
    {name === "close" && <path d="m6 6 12 12M6 18 18 6" />}
  </svg>;
}
