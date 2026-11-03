export function UiIcon({ name, className = "size-5" }: { name: "talk" | "health" | "movement" | "wellbeing" | "arrow" | "close" | "shield" | "phone" | "grid" | "calendar" | "chevron" | "sign-in" | "sign-out"; className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {name === "talk" && <><path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z" /><path d="M7 10h8m-8 4h5" /></>}
    {name === "health" && <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 7v10M7 12h10" /></>}
    {name === "movement" && <><circle cx="15" cy="4" r="2" /><path d="m12 9 4 3 4-1M5 11l5-3 3 7-4 6m4-6 5 5" /></>}
    {name === "wellbeing" && <><path d="M12 20v-7m0 4C5 17 3 12 4 6c6 0 9 4 8 11Zm0-4c0-6 3-9 8-9 1 5-2 9-8 9Z" /></>}
    {name === "arrow" && <path d="M5 12h14m-6-6 6 6-6 6" />}
    {name === "close" && <path d="m6 6 12 12M6 18 18 6" />}
    {name === "shield" && <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>}
    {name === "phone" && <path d="m7 3 3 5-2 2a15 15 0 0 0 6 6l2-2 5 3-1 4C11 22 2 13 3 4l4-1Z" />}
    {name === "grid" && <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
    {name === "calendar" && <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-12 4h2m3 0h2" /></>}
    {name === "chevron" && <path d="m11 6-6 6 6 6m8-12-6 6 6 6" />}
    {name === "sign-in" && <><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5M3 12h12m-5-5 5 5-5 5" /></>}
    {name === "sign-out" && <><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5m0-9h11m-5-5 5 5-5 5" /></>}
  </svg>;
}
