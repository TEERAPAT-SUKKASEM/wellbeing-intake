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
  return <Link href="/" aria-label="Campus Health & Wellbeing home" className="brand flex items-center gap-3 font-semibold leading-tight"><span aria-hidden="true" className="brand-mark flex size-10 shrink-0 items-center justify-center"><UiIcon name="wellbeing" className="size-6" /></span><span>Campus<span className="block text-xs font-normal tracking-wide text-base-content/70">Health &amp; Wellbeing</span></span></Link>;
}

export function SiteHeader({ preview = false, children }: { preview?: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
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

  const links = preview ? [{ href: "/preview/requests", label: "My requests" }] : me ? [HOME[me.role]] : [];
  const pageTitle = pathname === "/" ? "Campus services" : pathname === "/sign-in" ? "Sign in" : pathname === "/request/new" ? "New support request" : pathname === "/practitioner" ? "Practitioner workspace" : pathname === "/coordinator" ? "Intake overview" : pathname === "/emergency" ? "Emergency contacts" : "My requests";

  function menu(mobile = false) {
    return <ul className="menu w-full gap-2 p-0">{links.map(link => <li key={link.href}><Link href={link.href} title={collapsed && !mobile ? link.label : undefined} aria-current={pathname === link.href ? "page" : undefined} className="flex min-h-11 items-center gap-3 px-3 py-2" onClick={() => { if (mobile) dialogRef.current?.close(); }}><UiIcon name="calendar" className="size-5" /><span className="nav-label">{link.label}</span></Link></li>)}</ul>;
  }

  function services(mobile = false) {
    const close = () => { if (mobile) dialogRef.current?.close(); };
    return <nav aria-label={mobile ? "Mobile campus services" : "Campus services"} className="sidebar-services">
      <h2>Campus services</h2>
      {([
        ["counselling", "Counselling", "talk"], ["health-clinic", "Health clinic", "health"], ["physiotherapy", "Physiotherapy", "movement"], ["wellbeing-advising", "Wellbeing advising", "wellbeing"],
      ] as const).map(([slug, label, icon]) => <Link key={slug} href={`/#service-${slug}`} title={collapsed && !mobile ? label : undefined} onClick={close}><span className="service-dot" aria-hidden="true" /><UiIcon name={icon} className="sidebar-service-icon size-5" /><span className="nav-label">{label}</span></Link>)}
      <Link href="/emergency" className="sidebar-emergency" title={collapsed && !mobile ? "Emergency contacts" : undefined} aria-current={pathname === "/emergency" ? "page" : undefined} onClick={close}><UiIcon name="phone" className="size-5" /><span className="nav-label">Emergency contacts</span></Link>
    </nav>;
  }

  function account(mobile = false) {
    if (preview) return null;
    return me ? <button type="button" title={collapsed && !mobile ? "Sign out" : undefined} className={`account-signout btn ${mobile ? "mt-4 w-full" : ""}`} onClick={() => { if (mobile) dialogRef.current?.close(); void signOut(); }}><UiIcon name="sign-out" className="account-icon size-5" /><span className="account-label">Sign out</span></button> : <Link title={collapsed && !mobile ? "Sign in" : undefined} className={`btn ${mobile ? "mt-4 w-full" : ""}`} href="/sign-in" onClick={() => { if (mobile) dialogRef.current?.close(); }}><UiIcon name="sign-in" className="account-icon size-5" /><span className="account-label">Sign in</span></Link>;
  }

  return (
    <>
      <div className="workspace-shell" data-nav-collapsed={collapsed}>
        <aside id="desktop-sidebar" className="workspace-sidebar retreat-sidebar hidden lg:flex" aria-label="Campus workspace">
          <button type="button" className="sidebar-toggle btn btn-ghost btn-square" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="desktop-sidebar" title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(value => !value)}><UiIcon name="chevron" className="size-5" /></button>
          <Brand />
          {links.length > 0 && <nav aria-label="Main navigation" className="workspace-nav">{menu()}</nav>}
          {services()}
          <div className="sidebar-bottom"><UiIcon name="shield" className="size-6" /><h2>Your space for support.</h2><p>Explore your options. Take the next step when you’re ready.</p>{account()}{preview && <span className="badge badge-outline">UI sample</span>}</div>
        </aside>
        <div className="workspace-body flex min-h-dvh min-w-0 flex-col">
        <header className="workspace-topbar hidden lg:flex"><div><span>Campus wellbeing</span><span aria-hidden="true">/</span><strong>{pageTitle}</strong></div>{me ? <span className="account-name text-sm"><span aria-hidden="true" className="account-initials">{me.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("")}</span>{me.displayName}</span> : <span className="topbar-privacy"><UiIcon name="shield" className="size-4" />Browse without signing in</span>}</header>
        <header className="retreat-sidebar retreat-mobile navbar justify-between gap-3 border-b px-5 py-2 lg:hidden">
          <Brand />
          <button ref={triggerRef} type="button" className="btn btn-ghost btn-square border-0" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}><svg aria-hidden="true" className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
        </header>
        {children}
        </div>
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
            {links.length > 0 && <nav aria-label="Mobile navigation" className="mt-8">{menu(true)}</nav>}
            {services(true)}
            <div className="mt-auto border-t border-base-300 pt-5"><p className="px-3 text-sm font-semibold">Support at your pace</p><p className="mt-2 px-3 text-xs leading-relaxed text-base-content/70">Browse freely. You decide when you’re ready to take the next step.</p>{account(true)}{preview && <span className="badge badge-outline mt-4 ml-3">UI sample</span>}</div>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop"><button aria-label="Dismiss navigation">Close</button></form>
      </dialog>
    </>
  );
}
