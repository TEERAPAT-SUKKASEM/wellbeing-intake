# Wellbeing — student support application

The user requested Soft UI, simplification using Impeccable, and then a bento layout. The current direction is a task-focused counselling application: modern sans-serif type, teal actions, a bento homepage, and readable form panels on a pale blue-gray background. Paired light and offset shadows provide the Soft UI treatment; form fields are subtly recessed and retain clear borders. The PRD tasks and API contract are preserved.

The earlier photographic/glass interface and the later ivory/serif/nature treatment have been replaced. Neither visual treatment is active. No photographs, large editorial serif headings, glass effects, or page-background images appear in the current design. Backend contracts and booking behavior remain unchanged.

## Composition

Desktop uses a rounded, softly raised horizontal header with the Wellbeing wordmark and “Campus counselling” descriptor. Services, tracking, urgent help, and staff access remain available. Authenticated staff gain their workspace link. At 1100px and below, navigation is a full-height left drawer, up to 340px wide, sliding in over a dimmed backdrop in 260ms. The native dialog retains focus containment, Escape, backdrop/link dismissal, focus restoration, and automatic closing on desktop resize. Reduced motion disables the slide. The close action is at the top and staff access stays at the bottom; redundant close controls and menu decoration are omitted.

The homepage starts with “Counselling appointments” and a short explanation of anonymous access. Its bento grid has a wide booking area, a compact expandable service-matching tile, and distinct urgent-help and request-tracking tiles. Each service shows its actual API name, duration, description, and time-selection action. The first service occupies a wider mint tile, with the remaining services in paired neutral tiles; this layout does not indicate a clinical recommendation. The 15-minute buffer is explained once below the grid. No promotional hero, fake metrics, imagery, or process panel is used.

The bento grid uses a two-thirds booking column and one-third support column on desktop. Below 1000px the two support tiles share a row, followed by the booking area. Below 640px, emergency information comes first, followed by matching and services, then tracking. Content is limited to 1180px overall and 820px for intake, with 40px outer gutters on larger screens and 20px on phones. Intake and tracking retain a linear task flow. The footer contains only the demo disclosure.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| base-100 | #f8fafd | Cards and forms |
| base-200 | #eef2f7 | Main page background |
| base-300 | #d7e0e9 | Borders and dividers |
| base-content | #233b4b | Main text |
| primary | #137a70 | Main actions and selected navigation |
| primary-content | #ffffff | Primary action text |
| secondary | #e2f2ed | Selected appointment times |
| secondary-content | #176052 | Selected-state text |
| accent | #eaf0ff | Supporting blue surfaces |
| accent-content | #40558d | Blue-surface text |
| neutral | #233b4b | Navy tracking surface |
| neutral-content | #ffffff | Navy-surface text |
| info | #3d5e9a | Informational meaning |
| success | #217557 | Positive status |
| warning | #83531b | Caution |
| error | #a53f42 | Urgent and destructive meaning |

Emergency information uses #fff4ed with a visible light border. Normal task surfaces use base-100; selected slots use secondary. No decorative color categories or icon tiles are used for services. Urgency always has a text label.

## Typography and controls

Manrope is the heading and brand face; Geist is the body and control face. Both use the existing self-hosted fonts. The serif font has been removed from the root layout and is not loaded. Main body and input text is 16px, service descriptions 15px, service titles 18px, desktop page headings 34px, and phone headings 29px. Supporting text is generally 12–15px. The welcome heading scales between 32px and 46px. On phones, the small brand descriptor is hidden instead of being squeezed into unreadably small text.

Buttons have 14px radii and a minimum 46px height. Form inputs and selects have a minimum 50px height with visible borders and a recessed shadow. Cards use 24–25px radii; the welcome panel uses 30px on desktop. Raised surfaces combine a soft lower-right shadow with a light upper-left edge. Smaller controls and icon tiles use a reduced version of that shadow. Selected navigation is recessed; primary actions remain saturated teal for clear contrast. Ghost and disabled controls do not carry raised shadows. Access keys retain monospace text; schedules use tabular time values.

## Product screens and states

The appointment form is a single task panel preserving slot selection, optional alias, note, manual urgency, AI consent, retry recovery, and access-key confirmation. A concise inline note explains key tracking and that staff cannot contact anonymous students. Optional AI assessment uses a native disclosure; consent and the check action appear when opened, and the summary states when consent is enabled. Manual submission never depends on opening it. Tracking uses a prominent key input and clear status. Staff sign-in is a single form with a student link. Practitioner and admin functions, including schedule buffers, remain intact.

Loading, empty, retry, success, permission, and error states remain intact. Native dialogs protect cancellation and staff decisions. Keyboard focus uses a teal outline; color is never the only state indicator. Main controls and navigation targets remain at least 44px. Motion is limited to 160ms control feedback and is disabled for reduced motion. The emergency page remains force-static and independent of the database.

## Accessibility and layout refinements

The primary action is “Choose a time” within each service tile. Service titles and descriptions lead; duration is supporting metadata. Matching, urgent help, and tracking are task tiles with distinct supporting colors. The page heading introduces the task directly. Reassurance and process panels remain omitted.

The tracking result is an appointment card: the catalogue service name leads, a separate status label explains approval, and a divided schedule area groups date, time and Bangkok timezone. Pending times are labelled “Requested date.” Status-specific guidance follows the schedule; private-note reassurance and cancellation sit in a separate footer. Internal request references are omitted from the student card; students use their Private Access Key. Declined and cancelled requests offer a link to choose another appointment. Service-name lookup is optional and falls back to “Counselling appointment” if the catalogue is unavailable; it never blocks access-key lookup.

The existing-request tile is explicitly separate from booking: “Already sent a request?” leads to an underlined blue “Check request status” link with a clipboard-check icon. Supporting text explains that the private access key is shown after submitting a request. It has no button surface or booking arrow treatment, keeping existing-request tracking visually distinct from the outlined teal service actions.

Secondary text uses `--text-muted: #4b6070`, blue-surface text uses `--text-blue: #435e80`, and mint-surface text uses `--text-green: #365e54`. Input and slot edges use `--control-edge: #6e8293`, so controls remain identifiable without their Soft UI shadows. Selected slots have a stronger teal border and native checked radio; unavailable slots keep readable text and a dashed outline rather than fading the whole option.

Tablet and phone layouts follow a linear flow without secondary sidebars. Sticky-header clearance and focus scroll margins are 140px. Forced-colors mode supplies explicit boundaries when shadows disappear. The urgent-help icon has an explicit accessible name at every viewport.

## Removed complexity

- Promotional hero, reassurance tiles, tracking invitation, process-step panel, repeated privacy sidebar, and decorative service icons: replaced by the task heading, service list, navigation, and concise contextual instructions.
- Duplicate preview notices: the shared development-only strip remains the single notice.
- Sign-in introduction and repeated footer navigation: replaced by a compact staff form and existing main navigation.
- Always-expanded AI controls: moved into a labelled native disclosure without changing consent or fallback behavior.
- Orphaned components, fixtures, and styles for the retired authenticated-student booking flow: removed after confirming they had no active imports.

No required feature was removed. Emergency contacts, key confirmation and copying, status lookup, cancellation, staff decisions, admin configuration, AI consent/fallback, and privacy buffers remain available.

## Optional service matching

Impeccable's clarify/Operate pass made the booking and tracking states actionable without adding decorative steps: a Monday–Sunday date strip with weekdays above dates, previous/next-week controls, a text “Selected” state on time options, and a short explanation when submission is waiting for a time or note. The strip starts on the current Bangkok week; “Full calendar” opens a month-selection dialog with previous/next-month controls. Selecting a date updates the visible week and clears the selected time. Past dates are disabled; today and the selected date have separate indicators. The calendar closes on selection, Escape, or backdrop click and restores focus to its opener. The access-key dialog emphasizes copying the key and restores focus on closing. Tracking explains where the key comes from and its recovery limit, changes “Check status” to “Refresh status” after a successful lookup, and shows its clear action only when there is something to clear. Clearing returns focus to the key input; completed cancellation returns focus to the updated status.

Navigation uses task labels: “Book an appointment” and “Track a request”. The mobile drawer pairs consistent leading icons with concise descriptions, then separates urgent help into its own warm-tinted link. Staff access stays at the bottom; signed-in staff see their display name, role, and workspace destination. Active states cover booking substeps, tracking, urgent help, and sign-in. Sign-out errors appear inside the drawer and successful sign-out closes it. The menu remains scrollable on short screens, and its opener includes a visible “Menu” label where space allows.

At the user's request, a collapsed “Not sure which service? Get a suggestion” helper sits above the catalogue. It requests a short description and explicit consent before submitting to the proposed `/api/v1/finder/suggest` endpoint. Suggestions use only current active catalogue entries and fixed reason codes; no model-written advice is displayed. Browsing remains available when the helper is unavailable, returns no match, or times out. Editing, clearing, revoking consent, or closing invalidates previous results. The preview is labelled as local word matching, not AI. The backend contract and remaining server work are in `docs/refine-backend.md`.

Automated axe checks found no violations in the tested WCAG A/AA rules across seven routes at 320, 390, 640, 768, 1024, and 1440px, or in the selected-slot, receipt, status, cancellation, and menu states. Keyboard focus visibility/restoration, text-spacing reflow, and forced-colors boundaries were checked separately. See `docs/ACCESSIBILITY.md` for scope and limitations.

## Implementation and verification

Next.js 16, React, Tailwind 4, and daisyUI 5 remain the stack. No external templates, generated imagery, new fonts, or backend changes were introduced for this redesign. Existing photographic files remain in the repository but are not rendered.

Browser verification covers anonymous submission, key handoff, status lookup, cancellation, keyboard navigation, absence of homepage imagery and serif headings, and seven routes at 320, 390, 768, 1024, and 1440px. Staff screen checks use fictional mocked API responses; testing against a real database still requires the collaborator's server configuration.
