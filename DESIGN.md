# Visual direction: calm campus wellbeing

The user requested cinematic, luxury, immersive visuals, soft glassmorphism, a calm palette, environmental motion, and premium booking interactions.

The user clarified this is a campus platform and rejected forest/nature imagery as unrelated. Use university architecture and student spaces rather than nature, hospitality, holiday, or resort positioning. The visual quality remains considered and calm, while copy, navigation, and booking explicitly concern student support and campus practitioners.

Use pine navigation, translucent glass reading surfaces, restrained champagne actions, and photographic campus views. Geist remains the functional face; Cormorant Garamond supplies expressive headings. Keep icons in the shared 1.5px SVG family. Use daisyUI components for controls, alerts, cards, menu, modal, steps, and fields.

The university courtyard is a fixed, full-viewport page background across routes and scrolling, never an image confined to a hero or booking section. A dark tint supports light foreground headings and CTAs. Homepage and task cards share the original hero panel's glass recipe: 6.3% white background, 22% white border, 18px backdrop blur, and a soft shadow. The redundant “Your campus. Your support.” hero panel is removed. Bright body text and the darker photographic tint preserve readability; inputs, tables, warnings, and errors retain steadier surfaces. Requests and emergency page wrappers remain transparent. The campus background is static, with no motion control.

Large screens (1024px and wider) use a sticky horizontal top navbar. Mobile and tablet use the accessible hamburger dialog with focus containment, Escape, and focus restoration. There is no desktop sidebar or content offset. The task remains understandable without imagery or motion.

Motion: a quiet hero entrance, short booking-state reveals, and immediate control feedback. Keep the campus background static and honor reduced motion. No autoplay audio, fake inventory, prices, ratings, or availability claims.

Preview and connected student dashboards share the same components under `src/components/requests`. The preview changes the data source only and keeps a visible development disclaimer. Live booking uses the existing API slot IDs, a selection summary, and explicit confirmation. Dates follow the English interface and display the device timezone. Duration, end time, and location are not invented when absent from API responses. A cancelled appointment does not reopen its handled request.

Photography is illustrative, not a depiction of the user's actual campus. Active image source: https://images.unsplash.com/photo-1562774053-701939374585 (university courtyard), stored at public/images/campus-courtyard.jpg. Earlier forest and coast assets are not used by the UI.
