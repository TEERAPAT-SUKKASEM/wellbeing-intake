// What this file is for: tells PostCSS (the CSS build step inside Next.js) to run Tailwind CSS 4.
// Tailwind turns the classes and the `@import "tailwindcss"` / daisyUI lines in src/app/globals.css
// into real CSS.
// When it is used: automatically by `next dev` and `next build` whenever a CSS file is compiled.
const config = {
  plugins: {
    // The Tailwind 4 PostCSS plugin. Empty options: all theme settings live in globals.css, not here.
    "@tailwindcss/postcss": {},
  },
};

export default config;
