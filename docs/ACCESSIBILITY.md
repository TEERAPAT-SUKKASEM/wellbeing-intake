# Frontend accessibility review

Reviewed 2026-11-10 after the Soft UI layout and contrast update.

## Changes

- Darkened secondary text across services, privacy notes, navigation, preview notices, and the footer.
- Increased body and input text to 16px, service descriptions to 15px, and supporting labels to readable 12–15px sizes.
- Added stronger input, checkbox, radio, and appointment-option edges while retaining raised panels and recessed fields.
- Selected slots use a checked native radio and a thicker border. Unavailable slots have readable text, a dashed edge, and an explicit label.
- Reflowed tablet services above the help panels and stacked narrow-phone context. Kept focused controls clear of the sticky header.
- Named the urgent-help link for assistive technology even when its visible text is hidden on mobile.
- Added forced-colors panel boundaries so the UI remains understandable when shadows are unavailable.

## Verification scope

Automated axe-core scans used the `wcag2a`, `wcag2aa`, `wcag21aa`, and `wcag22aa` tags in headless Microsoft Edge. Seven routes were checked at six viewport widths: 320, 390, 640, 768, 1024, and 1440px. All 42 combinations reported zero violations and no document-level horizontal overflow.

Routes: home, new request, access-key tracking, staff sign-in, practitioner workspace, administration, and emergency contacts. Staff routes used fictional API responses; no real student data or live database writes were involved.

Separate interaction checks reported zero axe violations for a selected appointment slot, access-key receipt dialog, loaded status, cancellation dialog, and mobile navigation. Dialog animations were allowed to finish before measuring their settled appearance.

Keyboard checks covered visible focus below the sticky header and Escape/focus restoration for mobile navigation. At 320px, increased line height, letter spacing, word spacing, and paragraph spacing produced no horizontal overflow on home, intake, tracking, sign-in, and emergency pages. Forced-colors emulation retained explicit card boundaries. The 640px layout also exercises the narrower content width encountered when zooming a desktop browser.

These automated and targeted browser checks do not establish full WCAG conformance. Screen-reader testing with actual assistive technology, all possible server-error states, and integration against the configured live backend were outside this review.
