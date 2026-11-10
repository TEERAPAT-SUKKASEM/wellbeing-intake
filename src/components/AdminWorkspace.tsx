// What this component shows: the admin page to edit the counselling services (name, session length,
// description, and whether students can see it) and the weekly opening hours of the shared calendar.
// Used on: /admin (signed-in administrators only).
// Talks to: GET /api/v1/admin/services, GET /api/v1/admin/availability,
// PATCH /api/v1/admin/services/{id} and PUT /api/v1/admin/availability.
// Note: saving settings never moves existing appointments; they keep their times.
//
// How this component is organised:
// 1. State, then one effect that loads services and opening hours together.
// 2. updateService() changes a service on screen only. saveService() sends one service to the server.
//    discardDraft() puts back the last saved copy when an edit form is closed without saving.
// 3. saveHours() checks the opening windows, then replaces the whole week on the server.
// 4. Markup: a list of services, each with a fold-out edit form, then the opening hours form.
//    Each save has its own busy state, so only the button that is saving shows "Saving…".
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import {
  errorMessage,
  type Availability,
  type Service,
} from "@/lib/client/contracts";
import { UiIcon } from "./UiIcon";
import { ScrollingTimePicker } from "./ScrollingTimePicker";
// Day names by number, as the API uses them: 0 = Sunday ... 6 = Saturday.
const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function AdminWorkspace() {
  const router = useRouter();
  // services and availability are null while loading. error: loading failed. message: save result.
  // refresh: a counter for "Retry loading".
  // savingService: the ID of the service being saved (or null). savingHours: the opening hours are being saved.
  // editingService: the ID of the service whose edit form is open (only one at a time).
  const [services, setServices] = useState<Service[] | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  // Two busy states instead of one shared flag, so saving one form does not block or relabel the other.
  const [savingService, setSavingService] = useState<string | null>(null);
  const [savingHours, setSavingHours] = useState(false);
  const [editingService, setEditingService] = useState<string | null>(null);
  // locked stops a second click on the same save while it is running. A ref changes at once, before React re-renders.
  // One lock for service saves and one for the opening hours, so one save never blocks the other.
  const locked = useRef({ service: false, hours: false });
  // savedServices: the last copy of every service that the server confirmed. Closing an edit form
  // without saving puts this copy back. A ref is enough because it is never shown directly.
  const savedServices = useRef<Service[]>([]);
  // Load all services (also inactive ones) and the opening hours at the same time.
  // 401 = not signed in: go to sign-in, then come back (next=/admin).
  // 404 = signed in, but not an administrator. "alive" ignores an answer after the page is closed.
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<Service[]>("/admin/services"),
      api<Availability>("/admin/availability"),
    ]).then(([s, a]) => {
      if (!alive) return;
      if (s.status === 401 || a.status === 401) {
        router.replace("/sign-in?next=/admin");
        return;
      }
      if (!s.ok || !a.ok) {
        setError(
          s.status === 404 || a.status === 404
            ? "This workspace is available to administrators only."
            : "We could not load services and opening hours.",
        );
        return;
      }
      setServices(s.data ?? []);
      // Remember the loaded services as the saved copy that unsaved edits go back to.
      savedServices.current = s.data ?? [];
      setAvailability(a.data);
      setError("");
    });
    return () => {
      alive = false;
    };
  }, [refresh, router]);
  // Change one service on screen only. Nothing is saved until "Save service" is pressed.
  function updateService(index: number, patch: Partial<Service>) {
    setServices(
      (rows) =>
        rows?.map((s, i) => (i === index ? { ...s, ...patch } : s)) ?? null,
    );
  }
  // Close an edit form without saving: throw away its changes and show the last saved copy again.
  // The status message only says so when something had really changed.
  function discardDraft(id: string) {
    const saved = savedServices.current.find((s) => s.id === id);
    const draft = services?.find((s) => s.id === id);
    if (!saved || !draft) return;
    const changed =
      draft.name !== saved.name ||
      draft.description !== saved.description ||
      draft.duration_minutes !== saved.duration_minutes ||
      draft.is_active !== saved.is_active;
    if (!changed) return;
    setServices((rows) => rows?.map((s) => (s.id === id ? saved : s)) ?? null);
    setMessage("Unsaved changes were discarded.");
  }
  // Save one service. Only the editable fields are sent (not the ID), and the name is trimmed.
  async function saveService(service: Service) {
    if (locked.current.service) return;
    locked.current.service = true;
    // Mark only this service as saving, so only its button shows "Saving…".
    setSavingService(service.id);
    setMessage("");
    const { name, description, duration_minutes, is_active } = service;
    const r = await api<Service>(
      `/admin/services/${encodeURIComponent(service.id)}`,
      {
        method: "PATCH",
        body: { name: name.trim(), description, duration_minutes, is_active },
      },
    );
    locked.current.service = false;
    setSavingService(null);
    // On success, replace the service with the server's saved copy, on screen and as the saved copy.
    // 409 name_exists: another service already has this name.
    if (r.ok && r.data) {
      setServices(
        (rows) => rows?.map((s) => (s.id === service.id ? r.data! : s)) ?? null,
      );
      // The server's copy is the new saved copy that later unsaved edits go back to.
      savedServices.current = savedServices.current.map((s) =>
        s.id === service.id ? r.data! : s,
      );
      setMessage(
        `Saved ${r.data.name}. Existing appointments keep their times.`,
      );
    } else
      setMessage(
        r.error === "name_exists"
          ? "Another service already uses that name. Choose a different name."
          : errorMessage(r.error),
      );
  }
  async function saveHours(e: React.FormEvent) {
    e.preventDefault();
    if (!availability || locked.current.hours) return;
    // Check the windows before saving. Sort them by day and start time, then make sure each window
    // ends after it starts and does not overlap the window before it on the same day.
    // "HH:MM" times compare correctly as text, because they always have two digits.
    const sorted = [...availability.windows].sort(
      (a, b) =>
        a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
    );
    if (
      sorted.some(
        (w, i) =>
          w.start_time >= w.end_time ||
          (i > 0 &&
            sorted[i - 1].weekday === w.weekday &&
            sorted[i - 1].end_time > w.start_time),
      )
    ) {
      setMessage(
        "Opening windows must end after they start and must not overlap on the same day.",
      );
      return;
    }
    locked.current.hours = true;
    // Mark only the opening hours as saving, so the service buttons stay as they are.
    setSavingHours(true);
    setMessage("");
    // PUT replaces the whole week at once, so every window on screen is sent,
    // including several windows on the same day. The server checks the data again.
    const r = await api<Availability>("/admin/availability", {
      method: "PUT",
      body: availability,
    });
    locked.current.hours = false;
    setSavingHours(false);
    if (r.ok && r.data) {
      setAvailability(r.data);
      setMessage(
        "Weekly opening hours saved. Existing appointments keep their times.",
      );
    } else setMessage(errorMessage(r.error));
  }
  // Each service has an "Edit" button that folds its form open or closed.
  // aria-expanded and aria-controls tell screen readers whether the form is open and which form it is.
  // Closing a form (or opening another one) without saving throws away its unsaved changes.
  // Only the form being saved is disabled (fieldset disabled) while its save is running.
  // The "Edit" buttons are disabled while a service is saving, so that form stays open until it is done.
  return (
    <div className="space-y-6">
      <header className="route-intro">
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Services & opening hours
        </h1>
        <p>
          Configure the shared counselling calendar. Existing appointments keep
          their times when settings change.
        </p>
      </header>
      {message && (
        <p role="status" className="card p-5">
          {message}
        </p>
      )}
      {error ? (
        <div role="alert" className="card gap-3 p-5">
          <p>{error}</p>
          <button
            className="btn self-start"
            onClick={() => {
              setError("");
              setRefresh((n) => n + 1);
            }}
          >
            Retry loading
          </button>
        </div>
      ) : !services || !availability ? (
        <div
          className="skeleton h-60 w-full"
          role="status"
          aria-label="Loading administrator workspace"
        />
      ) : (
        <>
          <section className="card card-border gap-5 p-5 sm:p-6">
            <h2 className="text-2xl font-semibold">Service categories</h2>
            {services.length === 0 && <p>No services are configured.</p>}
            <ul className="admin-service-list">
              {services.map((service, index) => (
                <li key={service.id}>
                  <h3><button type="button" className="admin-service-toggle" disabled={savingService !== null} aria-expanded={editingService === service.id} aria-controls={`service-editor-${service.id}`} onClick={() => { /* The form that closes loses its unsaved changes. */ if (editingService) discardDraft(editingService); setEditingService(editingService === service.id ? null : service.id); }}><span className="admin-service-title"><span className="admin-service-number">{index + 1}.</span><span>{service.name}</span></span><span className="admin-service-edit-label">{editingService === service.id ? "Close" : "Edit"}<UiIcon name="arrow" className={editingService === service.id ? "size-4 -rotate-90" : "size-4 rotate-90"} /></span></button></h3>
                  <div id={`service-editor-${service.id}`} hidden={editingService !== service.id}>
                <form
                  className="admin-service-editor space-y-4"
                  aria-label={`Edit ${service.name}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveService(service);
                  }}
                >
                  {/* Only this service's form is locked while this service is saving. */}
                  <fieldset
                    disabled={savingService === service.id}
                    className="grid gap-4 sm:grid-cols-2"
                  >
                    <label>
                      <span className="mb-2 block font-medium">
                        Service name
                      </span>
                      <input
                        className="input w-full"
                        required
                        maxLength={80}
                        value={service.name}
                        onChange={(e) =>
                          updateService(index, { name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span className="mb-2 block font-medium">
                        Session length (minutes)
                      </span>
                      <input
                        className="input w-full"
                        type="number"
                        min={15}
                        max={120}
                        step={5}
                        required
                        value={service.duration_minutes}
                        onChange={(e) =>
                          updateService(index, {
                            duration_minutes: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="sm:col-span-2">
                      <span className="mb-2 block font-medium">
                        Description
                      </span>
                      <textarea
                        className="textarea w-full"
                        maxLength={500}
                        value={service.description}
                        onChange={(e) =>
                          updateService(index, { description: e.target.value })
                        }
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-3">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={service.is_active}
                        onChange={(e) =>
                          updateService(index, { is_active: e.target.checked })
                        }
                      />
                      Available to students
                    </label>
                    <button className="btn btn-primary sm:justify-self-end" disabled={savingService === service.id}>
                      {savingService === service.id ? "Saving…" : "Save service"}
                    </button>
                  </fieldset>
                </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <form
            className="card card-border gap-5 p-5 sm:p-6"
            onSubmit={saveHours}
          >
            <h2 className="text-2xl font-semibold">Weekly opening hours</h2>
            <p className="text-sm text-base-content/70">
              Campus time (Bangkok, UTC+7). A day without a window is closed.
              Each session and its 15-minute buffer must fit inside a window.
            </p>
            {/* Only the opening hours form is locked while the opening hours are saving. */}
            <fieldset disabled={savingHours} className="space-y-4">
              {/* One row per opening window: a day, an "Opens" time and a "Closes" time. */}
              {/* A day can have several windows. Edits stay on screen until the week is saved. */}
              {availability.windows.map((window, index) => (
                <div
                  className="opening-window-row"
                  key={index}
                >
                  <span className="opening-window-number" aria-hidden="true">{index + 1}.</span>
                  <label>
                    <span className="mb-2 block text-sm">Day</span>
                    <select
                      className="select w-full"
                      value={window.weekday}
                      onChange={(e) =>
                        setAvailability({
                          windows: availability.windows.map((w, i) =>
                            i === index
                              ? { ...w, weekday: Number(e.target.value) }
                              : w,
                          ),
                        })
                      }
                    >
                      {weekdays.map((name, day) => (
                        <option key={name} value={day}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ScrollingTimePicker
                      label="Opens"
                      value={window.start_time}
                      onChange={(time) =>
                        setAvailability({
                          windows: availability.windows.map((w, i) =>
                            i === index
                              ? { ...w, start_time: time }
                              : w,
                          ),
                        })
                      }
                    />
                  <ScrollingTimePicker
                      label="Closes"
                      value={window.end_time}
                      onChange={(time) =>
                        setAvailability({
                          windows: availability.windows.map((w, i) =>
                            i === index
                              ? { ...w, end_time: time }
                              : w,
                          ),
                        })
                      }
                    />
                  <button
                    className="opening-window-remove"
                    type="button"
                    aria-label={`Remove ${weekdays[window.weekday]} window ${index + 1}`}
                    onClick={() =>
                      setAvailability({
                        windows: availability.windows.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {availability.windows.length === 0 && (
                <p>
                  All days are closed. Add an opening window to offer
                  appointment times.
                </p>
              )}
              {/* A new window starts as Monday 09:00-17:00. At most 50 windows are allowed. */}
              <button
                className="opening-window-add"
                type="button"
                disabled={availability.windows.length >= 50}
                onClick={() =>
                  setAvailability({
                    windows: [
                      ...availability.windows,
                      { weekday: 1, start_time: "09:00", end_time: "17:00" },
                    ],
                  })
                }
              >
                Add opening window
              </button>
            </fieldset>
            <button className="btn btn-primary self-start" disabled={savingHours}>
              {savingHours ? "Saving…" : "Save weekly opening hours"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
