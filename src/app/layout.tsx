import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { uiPreview } from "@/lib/ui-preview";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campus Health & Wellbeing — private booking",
  description:
    "Privately request and book health, counselling and wellbeing appointments on campus.",
  // Nothing here should be indexed or previewed: a booking app for sensitive needs.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-base-200 text-base-content">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-base-100 focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to main content
        </a>
        <SiteHeader preview={uiPreview}>
          {uiPreview && (
            <p
              role="status"
              className="preview-strip px-5 py-2 text-center text-xs"
            >
              Student UI preview · Fictional student data · Staff screens use
              the connected backend
            </p>
          )}
          <main id="main" className="page-main">
            {children}
          </main>
          <footer className="page-footer">
            <div className="footer-inner">
              <p className="footer-disclaimer">
                Demonstration system · Fictional data only · Not a live health
                service. Team 16, University Digital Campus Platform.
              </p>
            </div>
          </footer>
        </SiteHeader>
      </body>
    </html>
  );
}
