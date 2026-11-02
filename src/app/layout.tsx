import type { Metadata } from "next";
import { Geist, Cormorant_Garamond } from "next/font/google";
import type { ReactNode } from "react";
import Image from "next/image";
import { SiteHeader } from "@/components/SiteHeader";
import { uiPreview } from "@/lib/ui-preview";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const retreatSerif = Cormorant_Garamond({ variable: "--font-retreat-serif", subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], display: "swap" });

export const metadata: Metadata = {
  title: "Campus Health & Wellbeing — private booking",
  description: "Privately request and book health, counselling and wellbeing appointments on campus.",
  // Nothing here should be indexed or previewed: a booking app for sensitive needs.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${geistSans.variable} ${retreatSerif.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-base-200 text-base-content">
        <div className="campus-backdrop" aria-hidden="true">
          <Image src="/images/campus-courtyard.jpg" alt="" fill priority sizes="100vw" className="scene-image" />
          <div className="page-backdrop-shade" />
        </div>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-base-100 focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to main content
        </a>
        <SiteHeader preview={uiPreview}>
        {uiPreview && <p role="status" className="preview-strip px-5 py-2 text-center text-xs">UI sample · Fictional data · Nothing is sent or saved</p>}
        <main id="main" className="page-main mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8 sm:py-8 lg:py-10">
          {children}
        </main>
        <footer className="page-footer border-t border-base-300 bg-base-100">
          <p className="mx-auto max-w-6xl px-5 py-6 text-xs text-base-content/70 sm:px-8">
            Demonstration system on seeded demo data only — not a live health service. Team 16, University Digital
            Campus Platform.
          </p>
        </footer>
        </SiteHeader>
      </body>
    </html>
  );
}
