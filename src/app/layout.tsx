import type { Metadata } from "next";
import localFont from "next/font/local";
import Image from "next/image";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { uiPreview } from "@/lib/ui-preview";
import "./globals.css";

const geistSans = localFont({ src: "./fonts/geist-latin.woff2", variable: "--font-geist-sans", weight: "100 900", display: "swap" });
const headingFont = localFont({ src: "./fonts/manrope-latin.woff2", variable: "--font-heading", weight: "200 800", display: "swap" });
const editorialFont = localFont({ src: [
  { path: "./fonts/dm-serif-display-latin.woff2", weight: "400", style: "normal" },
  { path: "./fonts/dm-serif-display-latin-italic.woff2", weight: "400", style: "italic" },
], variable: "--font-editorial", display: "swap", adjustFontFallback: "Times New Roman" });

export const metadata: Metadata = {
  title: "Campus Health & Wellbeing — private booking",
  description: "Privately request and book health, counselling and wellbeing appointments on campus.",
  // Nothing here should be indexed or previewed: a booking app for sensitive needs.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-scroll-behavior="smooth" className={`${geistSans.variable} ${headingFont.variable} ${editorialFont.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-base-200 text-base-content">
        <div className="ambient-campus" aria-hidden="true"><Image src="/images/campus-courtyard.jpg" alt="" fill loading="eager" sizes="100vw" className="ambient-campus-image" /></div>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-base-100 focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to main content
        </a>
        <SiteHeader preview={uiPreview}>
        {uiPreview && <p role="status" className="preview-strip px-5 py-2 text-center text-xs">UI sample · Fictional data · Nothing is sent or saved</p>}
        <main id="main" className="page-main mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          {children}
        </main>
        <footer className="page-footer border-t border-base-300 bg-base-100">
          <p className="mx-auto max-w-7xl px-5 py-6 text-xs text-base-content/70 sm:px-8 lg:px-12">
            Demonstration system on seeded demo data only — not a live health service. Team 16, University Digital
            Campus Platform. Campus photography is illustrative.
          </p>
        </footer>
        </SiteHeader>
      </body>
    </html>
  );
}
