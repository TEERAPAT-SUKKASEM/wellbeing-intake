"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { UiIcon } from "@/components/UiIcon";

type Me = { role: "student" | "practitioner" | "coordinator"; displayName: string };
const HOME: Record<Me["role"], { href: string; label: string }> = {
  student: { href: "/requests", label: "My requests" },
  practitioner: { href: "/practitioner", label: "My queue" },
  coordinator: { href: "/coordinator", label: "Overview" },
};

function Brand() {
  return <Link href="/" aria-label="Campus Health & Wellbeing home" className="flex items-center gap-3 font-semibold leading-tight"><span aria-hidden="true" className="brand-mark flex size-10 shrink-0 items-center justify-center rounded-field bg-neutral text-2xl text-neutral-content">+</span><span>Campus Health<span className="block text-xs font-normal tracking-wide text-base-content/70">&amp; Wellbeing</span></span></Link>;
}

export function SiteHeader({ preview = false, children }: { preview?: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    api<Me>("/me").then(r => { if (alive) setMe(r.ok ? r.data : null); });
    return () => { alive = false; };
  }, [pathname, preview]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    function closeOnDesktop() { if (desktop.matches) dialogRef.current?.close(); }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  async function signOut() {
    await api("/session", { method: "DELETE" });
    setMe(null);
    router.replace("/");
    router.refresh();
  }

  const links = [
    { href: "/", label: "Services" },
    ...(preview ? [{ href: "/preview/requests", label: "My requests" }] : me ? [{ ...HOME[me.role], kind: "requests" }] : []),
    { href: "/emergency", label: "Emergency contacts" },
  ];

  function menu(mobile = false) {
    return <ul className={`menu p-0 ${mobile ? "w-full gap-1" : "menu-horizontal gap-4"}`}>{links.map(link => <li key={link.href}><Link href={link.href} aria-current={pathname === link.href ? "page" : undefined} className="flex min-h-11 items-center px-3 py-2" onClick={() => { if (mobile) dialogRef.current?.close(); }}><span>{link.label}</span></Link></li>)}</ul>;
  }

  function account(mobile = false) {
    if (preview) return null;
    return me ? <button type="button" className={`btn ${mobile ? "mt-4 w-full" : ""}`} onClick={() => { if (mobile) dialogRef.current?.close(); void signOut(); }}>Sign out</button> : <Link className={`btn ${mobile ? "mt-4 w-full" : ""}`} href="/sign-in" onClick={() => { if (mobile) dialogRef.current?.close(); }}>Sign in</Link>;
  }

  return (
    <>
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="retreat-sidebar sticky top-0 z-20 hidden border-b lg:block">
          <div className="navbar mx-auto max-w-6xl gap-8 px-8 py-3">
            <div className="navbar-start w-auto flex-1"><Brand /></div>
            <nav aria-label="Main navigation" className="navbar-end w-auto gap-6">{menu()}{account()}</nav>
          </div>
        </header>
        <header className="retreat-sidebar retreat-mobile navbar justify-between gap-3 border-b px-5 py-2 lg:hidden">
          <Brand />
          <button ref={triggerRef} type="button" className="btn btn-ghost btn-square border-0" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}><svg aria-hidden="true" className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
        </header>
        {children}
      </div>
      <dialog ref={dialogRef} id="mobile-navigation" aria-label="Navigation menu" className="modal justify-items-start" onClick={event => { if ((event.target as HTMLElement).closest("a")) dialogRef.current?.close(); }} onKeyDown={event => {
        if (event.key !== "Tab") return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }} onClose={() => { setOpen(false); if (!window.matchMedia("(min-width: 1024px)").matches) triggerRef.current?.focus(); }}>
        <div className="retreat-sidebar modal-box m-0 h-dvh max-h-dvh w-72 max-w-[90vw] rounded-none border-r border-base-300 p-5">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2"><Brand /><button type="button" className="btn btn-ghost btn-square shrink-0 border-0" aria-label="Close navigation" onClick={() => dialogRef.current?.close()}><UiIcon name="close" /></button></div>
            <p className="mb-3 mt-10 px-3 text-xs font-semibold uppercase tracking-widest text-base-content/70">Student support</p>
            <nav aria-label="Mobile navigation">{menu(true)}</nav>
            <div className="mt-auto border-t border-base-300 pt-5"><p className="px-3 text-sm font-semibold">Support at your pace</p><p className="mt-2 px-3 text-xs leading-relaxed text-base-content/70">Browse freely. You decide when you’re ready to take the next step.</p>{account(true)}{preview && <span className="badge badge-outline mt-4 ml-3">UI sample</span>}</div>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop"><button aria-label="Dismiss navigation">Close</button></form>
      </dialog>
    </>
  );
}
