import "server-only";

// Explicitly opt in locally. Production always uses the real API.
export const uiPreview = process.env.NODE_ENV === "development" && process.env.UI_PREVIEW === "true";
