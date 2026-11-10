// What this helper does: decides if the app runs in "UI preview" mode with fake student data.
// Talks to: no API calls. It only reads environment variables on the server.
// Note: it is true only when NODE_ENV is "development" AND UI_PREVIEW is "true", never in production.
import "server-only";

// "server-only" makes the build fail if browser code imports this file. Pages read the flag on the
// server and pass it to client components as a prop (UI_PREVIEW is not visible in the browser).
// Explicitly opt in locally. Production always uses the real API.
export const uiPreview = process.env.NODE_ENV === "development" && process.env.UI_PREVIEW === "true";
