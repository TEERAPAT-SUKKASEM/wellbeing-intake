// What this file is for: the Next.js settings for this app. It turns off two Next.js defaults and adds
// security headers to every response (pages, API routes and files).
// When it is used: read by `next dev`, `next build` and `next start`, so also by every Vercel deploy.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the small Next.js badge that `next dev` shows in a corner of the page (cleaner demos and
  // screenshots). Build and runtime errors are still shown.
  devIndicators: false,
  // Do not send the "X-Powered-By: Next.js" header, so responses do not advertise the framework.
  poweredByHeader: false,
  // Extra HTTP headers. The source "/:path*" matches every URL of the app.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The browser must trust the declared file type and never guess ("sniff") another one.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No other website may show our pages inside a frame (protects against clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // NFR-07: never leak a page address to another site.
          { key: "Referrer-Policy", value: "no-referrer" },
          // The app never needs the camera, microphone or location, so the browser blocks all three.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
