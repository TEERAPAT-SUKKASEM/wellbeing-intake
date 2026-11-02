// The interface is English; timezone stays local and is shown beside the picker.
export const bookingDateLabel = (value: string) => new Date(value).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const bookingTimeLabel = (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
