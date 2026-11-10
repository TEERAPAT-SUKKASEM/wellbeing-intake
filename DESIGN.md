# Wellbeing — Swiss Modernism

## Direction

The frontend uses Swiss Modernism across student booking, matching, tracking, emergency contacts, staff sign-in, and staff workspaces. The user explicitly selected this direction for the whole frontend. It replaces the former Soft UI and bento visual identity.

This is a task interface for students seeking counselling and staff managing appointments. Clarity and calm take priority: asymmetric alignment, a disciplined grid, strong sans-serif typography, generous section spacing, and fine horizontal rules. The signature is the service catalogue presented as horizontal rows with consistently aligned booking actions.

## Typography and palette

Use the existing self-hosted Geist variable font for headings, text, and controls. No external font requests. Large page headings scale from 36px on phones to 64px on desktop; service headings use 22–23px. Supporting text remains readable at 13–16px. Use tabular numerals for schedules and monospace only for private access keys.

| Token | Value | Purpose |
| --- | --- | --- |
| base-100 | #ffffff | Forms and task surfaces |
| base-200 | #f5f4f0 | Off-white page ground |
| base-300 | #d1d0ca | Fine dividers |
| base-content | #20211f | Main type and structural rules |
| primary | #b33224 | Vermilion primary actions and focus |
| secondary | #edf1eb | Suggested-service and positive-state ground |
| secondary-content | #30513b | Text on secondary surfaces |
| info | #3e535f | Information |
| success | #305b3e | Positive states |
| warning | #76521c | Caution |
| error | #a42e25 | Urgent and destructive meaning |

Muted text uses #595b55. Controls use #85877e boundaries. Urgent-help surfaces use a pale warm ground and explicit text. Never encode state by color alone.

## Composition and components

Desktop content remains limited to 1180px with 40px outer gutters. A ruled, two-column page introduction aligns the title with its explanation. The catalogue occupies two thirds of the content area; emergency help and tracking occupy the supporting third. Service rows have equal visual priority, fine separating rules, published duration and description, and an aligned Choose a time action. No first-service highlight implies a recommendation.

Below 1000px the intro becomes linear and support content shares a row. Below 640px emergency information comes first, followed by matching and services, then tracking. Service actions span the available width. Phone gutters remain 20px.

Surfaces and controls have square corners and no decorative shadows. Panels use fine borders, with strong black rules reserved for major divisions. Native radio controls retain their circular shape. Forms, calendars, modal dialogs, navigation drawers, tracking, and staff tabs share this geometry. Selected calendar days use a dark fill with white type. Staff tabs use an underline rather than raised pills.

## Service matching

The matcher is an optional native disclosure. Consent, data handling notices, local-preview labelling, and request behavior remain intact. Feedback uses a separate bordered region with a prominent heading. Suggestions use a pale semantic green ground, published service names, fixed reasons, and explicit Choose a time actions. Loading, unavailable, no-match, and urgent-help states have distinct headings. Urgent guidance links directly to emergency contacts and suppresses service recommendations. Feedback remains a polite live region.

## Accessibility and behavior

Preserve all booking, tracking, cancellation, staff, and emergency workflows. Keep native dialogs and their focus containment, keyboard navigation, mobile drawer dismissal, focus restoration, and reduced-motion support. Controls remain at least 44px high. Focus uses the vermilion token; selected controls also use text, borders, native checked state, or pressed state. Forced-colors mode retains explicit boundaries. Motion is limited to existing functional control and drawer transitions.

## Practitioner monthly schedule

The schedule defaults to Day, with Week and Month available. The monthly view uses a Monday-first calendar showing daily appointment totals and pending counts. Previous, Today, and Next navigate the calendar; the selected date also remains editable. Selecting a day reveals its full appointment list and privacy buffers below, and selecting a visit opens its private details in a native modal popup with approval, rescheduling, cancellation, and privacy-buffer information. Escape, the X button, and backdrop clicks dismiss the popup and restore focus to the appointment. Dismissal is blocked while a decision is being saved; confirmation dialogs open above the booking popup. Dates and counts use Bangkok campus time. Monthly requests fetch only the first through last date of the month to stay within the API's 31-day range. Small screens retain seven columns with compact counts and accessible full-date labels.
