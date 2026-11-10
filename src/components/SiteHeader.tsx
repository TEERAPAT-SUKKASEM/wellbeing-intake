// What this component shows: the top bar of every page: the Wellbeing logo, the main links, an
// "Urgent help" link, staff sign-in or sign-out, and a menu dialog for small screens.
// The page content (children) is rendered below the header.
// Used on: every page. src/app/layout.tsx wraps all pages in it.
// Talks to: GET /api/v1/me (who is signed in, to add the staff workspace link)
// and DELETE /api/v1/session (sign out).
// Note: students never sign in. For them /me answers 401, and the header shows only the public links.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { UiIcon } from "./UiIcon";

// The signed-in staff member, as returned by GET /me.
type Me = { role: "practitioner" | "admin"; displayName: string };

export function SiteHeader({
  preview = false,
  children,
}: {
  preview?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // me: the signed-in staff member, or null. open: the mobile menu is open.
  // signingOut and error: progress and error text for the sign-out button.
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  // dialog is the mobile menu. trigger is the "Menu" button, so focus can return to it on close.
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // The staff pages. In preview mode, /me is only checked on these pages.
  const staffPage =
    pathname === "/practitioner" ||
    pathname === "/admin" ||
    pathname === "/sign-in";
  // Ask the server who is signed in each time the page changes.
  // "alive" becomes false on cleanup, so an answer for an old page is ignored.
  useEffect(() => {
    if (preview && !staffPage) return;
    let alive = true;
    api<Me>("/me").then((r) => {
      if (alive) setMe(r.ok ? r.data : null);
    });
    return () => {
      alive = false;
    };
  }, [pathname, preview, staffPage]);
  // If the window becomes desktop width, close the mobile menu, because the desktop links are visible then.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1101px)");
    const close = () => {
      if (desktop.matches) dialog.current?.close();
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
  // The logo link. It is used twice: in the header bar and at the top of the mobile menu.
  const brand = (
    <Link href="/" className="wellbeing-brand" aria-label="Wellbeing home">
      <span className="brand-symbol">
        <UiIcon name="wellbeing" className="size-6" />
      </span>
      <span>
        Wellbeing
        <span className="brand-description">Campus counselling</span>
      </span>
    </Link>
  );
  // Links for everyone, plus one workspace link that depends on the staff role.
  // "active" marks the link for the current page (Book is also active on /request/new).
  const links = [
    {
      id: "book",
      href: "/",
      label: "Book an appointment",
      description: "Choose a service and time",
      icon: "calendar" as const,
      active: pathname === "/" || pathname === "/request/new",
    },
    {
      href: "/requests",
      id: "track",
      label: "Track a request",
      description: "Use your private access key",
      icon: "shield" as const,
      active: pathname === "/requests",
    },
    ...(me?.role === "practitioner"
      ? [
          {
            href: "/practitioner",
            id: "workspace",
            label: "Queue & schedule",
            description: "Review and manage appointments",
            icon: "talk" as const,
            active: pathname === "/practitioner",
          },
        ]
      : me?.role === "admin"
        ? [
            {
              href: "/admin",
              id: "workspace",
              label: "Services & hours",
              description: "Manage services and opening hours",
              icon: "grid" as const,
              active: pathname === "/admin",
            },
          ]
        : []),
  ];
  // Sign out: DELETE /session clears the HttpOnly session cookies on the server.
  // Then go to the home page and refresh, so no staff data stays on screen.
  async function signOut() {
    setSigningOut(true);
    setError("");
    const r = await api("/session", { method: "DELETE" });
    setSigningOut(false);
    if (!r.ok) {
      setError("We could not sign you out. Please try again.");
      return;
    }
    dialog.current?.close();
    setMe(null);
    router.replace("/");
    router.refresh();
  }
  // "Sign out" for signed-in staff, "Staff sign in" for everyone else.
  // mobile = true adds the menu-drawer style and an icon.
  function account(mobile = false) {
    return me ? (
      <button
        className={`btn btn-ghost ${mobile ? "drawer-account-link" : ""}`}
        disabled={signingOut}
        onClick={() => void signOut()}
      >
        {mobile && <UiIcon name="sign-out" />}
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    ) : (
      <Link href="/sign-in" className={`staff-link ${mobile ? "drawer-account-link" : ""}`} aria-current={pathname === "/sign-in" ? "page" : undefined}>
        <UiIcon name="sign-in" /><span className="staff-entry-title">Staff sign in</span>
      </Link>
    );
  }
  // aria-current tells screen readers where the user is: "page" for the exact page,
  // "location" for a page inside that section (for example /request/new under "Book an appointment").
  // The mobile menu is a native <dialog> opened with showModal(), so focus stays inside it.
  // Clicking the backdrop or any link closes it, and onClose moves focus back to the Menu button.
  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="site-header-inner navbar">
          {brand}
          <nav className="desktop-navigation" aria-label="Main navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={link.active ? link.href === pathname ? "page" : "location" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <Link href="/emergency" className="emergency-nav" aria-label="Urgent help and emergency contacts" aria-current={pathname === "/emergency" ? "page" : undefined}>
              <UiIcon name="phone" className="size-4" />
              <span>Urgent help</span>
            </Link>
            <span className="desktop-account">{account()}</span>
            <button
              ref={trigger}
              className="mobile-menu-button btn btn-ghost"
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="mobile-navigation"
              onClick={() => {
                dialog.current?.showModal();
                setOpen(true);
              }}
            >
              <svg
                className="size-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              <span className="mobile-menu-label">Menu</span>
            </button>
          </div>
        </div>
      </header>
      {error && !open && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {children}
      <dialog
        ref={dialog}
        id="mobile-navigation"
        className="modal mobile-navigation"
        aria-label="Navigation menu"
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest("a")) {
            dialog.current?.close();
          }
        }}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className="modal-box">
          <div className="mobile-menu-heading">
            {brand}
            <button
              className="btn btn-ghost btn-square"
              aria-label="Close navigation"
              onClick={() => dialog.current?.close()}
            >
              <UiIcon name="close" />
            </button>
          </div>
          <nav aria-label="Mobile navigation" className="drawer-navigation">
            <ul className="menu">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="drawer-link"
                    aria-label={link.label}
                    aria-describedby={`drawer-${link.id}-detail`}
                    aria-current={link.active ? link.href === pathname ? "page" : "location" : undefined}
                  >
                    <UiIcon name={link.icon} />
                    <span><span className="drawer-link-title">{link.label}</span><span className="drawer-link-detail" id={`drawer-${link.id}-detail`}>{link.description}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Link href="/emergency" className="drawer-urgent" aria-label="Urgent help and emergency contacts" aria-current={pathname === "/emergency" ? "page" : undefined}><UiIcon name="phone" /><span><span className="drawer-link-title">Urgent help</span><span className="drawer-link-detail">Emergency contacts</span></span></Link>
          <div className="mobile-account">{me && <div className="drawer-identity"><p>{me.displayName}</p><span>{me.role === "admin" ? "Administrator" : "Practitioner"}</span></div>}{error && <p className="drawer-account-error" role="alert">{error}</p>}{account(true)}</div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button aria-label="Dismiss navigation">Close</button>
        </form>
      </dialog>
    </div>
  );
}
