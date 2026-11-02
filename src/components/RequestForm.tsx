"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { previewServices } from "@/lib/client/preview-services";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS } from "@/lib/emergency";
import { ACUTE_LEVEL_ID, TRIAGE_LEVELS } from "@/lib/triage";

type Service = { id: string; name: string; whoWillKnow: string };

const FIELD_LABELS: Record<string, string> = {
  serviceId: "Service",
  structuredDescription: "What you would like help with",
  preferredTimes: "Preferred times",
  triageLevelId: "How soon you need to be seen",
  freeText: "Anything else",
};

export function RequestForm({ preview = false }: { preview?: boolean }) {
  const router = useRouter();
  const serviceId = useSearchParams().get("service") ?? "";

  const [liveService, setService] = useState<Service | null>(null);
  const service = preview ? previewServices.find((s) => s.id === serviceId) ?? null : liveService;
  const [ready, setReady] = useState(preview);
  // FR-20: every new request starts empty. Nothing is pre-filled from any earlier request.
  const [description, setDescription] = useState("");
  const [freeText, setFreeText] = useState("");
  const [preferred, setPreferred] = useState("");
  const [triage, setTriage] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [submittedAcute, setSubmittedAcute] = useState(false);
  // K-17: one key per form instance — a double-click or retry replays it and creates nothing new.
  const submissionKey = useRef<string>(crypto.randomUUID());
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors.length) errorRef.current?.focus();
  }, [errors]);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    (async () => {
      const me = await api("/me");
      if (!alive) return;
      if (me.status === 401) {
        router.replace(`/sign-in?next=${encodeURIComponent(`/request/new?service=${serviceId}`)}`);
        return;
      }
      const list = await api<{ services: Service[] }>("/services");
      if (!alive) return;
      setService(list.data?.services.find((s) => s.id === serviceId) ?? null);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [router, serviceId, preview]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missing: string[] = [];
    if (!description.trim()) missing.push("structuredDescription");
    if (!preferred.trim()) missing.push("preferredTimes");
    if (triage === null) missing.push("triageLevelId"); // FR-06: no request without a level
    if (missing.length) {
      setErrors(missing);
      return;
    }

    if (preview) {
      if (triage === ACUTE_LEVEL_ID) setSubmittedAcute(true);
      else router.push(`/preview/requests?service=${encodeURIComponent(serviceId)}`);
      return;
    }

    setBusy(true);
    setErrors([]);
    const r = await api<{ acute: boolean }>("/requests", {
      method: "POST",
      body: {
        serviceId,
        structuredDescription: description,
        ...(freeText.trim() ? { freeText } : {}),
        preferredTimes: preferred,
        triageLevelId: triage,
        submissionKey: submissionKey.current,
      },
    });
    setBusy(false);

    if (r.status === 401) {
      router.replace("/sign-in");
      return;
    }
    if (!r.ok) {
      setErrors(r.fields?.length ? r.fields : ["(form)"]);
      return;
    }
    if (r.data?.acute) {
      setSubmittedAcute(true); // FR-08: do not move on to "book a slot"
      return;
    }
    router.replace("/requests?sent=1");
  }

  if (!ready) return <p>Loading…</p>;

  if (!service) {
    return (
      <p className="rounded-md border border-base-300 bg-base-100 p-4">
        Please choose a service first.{" "}
        <Link className="underline" href="/">
          Back to all services
        </Link>
      </p>
    );
  }

  if (submittedAcute) {
    return (
      <section aria-labelledby="acute-heading" className="space-y-4 alert alert-error alert-soft block p-6">
        <h2 id="acute-heading" className="text-2xl font-semibold" tabIndex={-1}>
          Please contact someone now
        </h2>
        <p>{CANNOT_HELP_NOW}</p>
        <ul className="space-y-2">
          {EMERGENCY_CONTACTS.map((c) => (
            <li key={c.tel}>
              {c.name}:{" "}
              <a className="text-xl font-bold underline underline-offset-2" href={`tel:${c.tel}`}>
                {c.phone}
              </a>{" "}
              <span className="text-sm">({c.detail})</span>
            </li>
          ))}
        </ul>
        <p>
          {preview ? "This is a sample urgent state. No request was sent and no staff have been notified. In the connected app, urgent requests are flagged for staff follow-up." : "Your request has been recorded and flagged so that a member of staff follows it up directly."} It is{" "}
          <strong>not</strong> being handled by booking a slot in this app, and a reply here may not be quick — please
          do not wait for it.
        </p>
        <Link className="inline-block underline" href={preview ? "/preview/requests" : "/requests"}>
          {preview ? "View sample dashboard" : "See my requests"}
        </Link>
      </section>
    );
  }

  const acuteSelected = triage === ACUTE_LEVEL_ID;

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto max-w-3xl space-y-6">
      <section aria-labelledby="privacy-heading" className="rounded-xl border border-base-300 bg-base-200 p-5">
        <h2 id="privacy-heading" className="text-lg font-semibold">
          Who can see this request
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Can read what you write:</strong> only the practitioners of <strong>{service.name}</strong>. Every
            time one of them opens it, that view is logged.
          </li>
          <li>
            <strong>Can see that a request exists, its urgency and status — but never what you wrote:</strong> the
            intake coordinator.
          </li>
          <li>
            <strong>Cannot see anything:</strong> lecturers and faculty, parents or guardians, other students, other
            services, and analytics — this app sends nothing to analytics.
          </li>
          <li>Reminders only ever say “You have an appointment” with a date and time — never which service or why.</li>
        </ul>
      </section>

      <div
        ref={errorRef}
        tabIndex={-1}
        role={errors.length ? "alert" : undefined}
        className={errors.length ? "alert alert-error alert-soft block p-4" : "hidden"}
      >
        <p className="font-semibold">Please check the form:</p>
        <ul className="list-disc pl-5">
          {errors.map((f) => (
            <li key={f}>{FIELD_LABELS[f] ? `${FIELD_LABELS[f]} is needed or is too long.` : "We could not send your request. Please try again."}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-6 card card-border bg-base-100 p-5 sm:p-8">
        <p className="text-sm text-base-content/70">
          Service: <strong>{service.name}</strong>
        </p>

        <div>
          <label htmlFor="description" className="block font-medium">
            What would you like help with? <span className="font-normal text-base-content/70">(a sentence or two)</span>
          </label>
          <textarea
            id="description"
            required
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={errors.includes("structuredDescription")}
            aria-describedby={errors.includes("structuredDescription") ? "description-error" : undefined}
            className="textarea mt-1 w-full"
          />
          {errors.includes("structuredDescription") && <p id="description-error" className="field-error mt-2 text-sm">Enter what you would like help with, up to 500 characters.</p>}
        </div>

        <div>
          <label htmlFor="free-text" className="block font-medium">
            Anything else? <span className="font-normal text-base-content/70">(optional)</span>
          </label>
          <p id="free-text-hint" className="text-sm text-base-content/70">
            Staff-readable: the practitioners of {service.name} will read this too.
          </p>
          <textarea
            id="free-text"
            rows={3}
            maxLength={2000}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            aria-invalid={errors.includes("freeText")}
            aria-describedby={errors.includes("freeText") ? "free-text-hint free-text-error" : "free-text-hint"}
            className="textarea mt-1 w-full"
          />
          {errors.includes("freeText") && <p id="free-text-error" className="field-error mt-2 text-sm">Keep the extra details within 2,000 characters.</p>}
        </div>

        <div>
          <label htmlFor="preferred" className="block font-medium">
            When suits you?
          </label>
          <input
            id="preferred"
            required
            maxLength={300}
            value={preferred}
            onChange={(e) => setPreferred(e.target.value)}
            aria-invalid={errors.includes("preferredTimes")}
            aria-describedby={errors.includes("preferredTimes") ? "preferred-error" : undefined}
            placeholder="e.g. weekday afternoons"
            className="input mt-1 w-full"
          />
          {errors.includes("preferredTimes") && <p id="preferred-error" className="field-error mt-2 text-sm">Enter your preferred times, up to 300 characters.</p>}
        </div>

        <fieldset className="fieldset text-base" aria-invalid={errors.includes("triageLevelId")} aria-describedby={errors.includes("triageLevelId") ? "triage-error" : undefined}>
          <legend className="fieldset-legend whitespace-normal">How soon do you need to be seen?</legend>
          <p className="text-sm text-base-content/70">Your answer decides the order staff see requests in. Nobody changes it for you.</p>
          <div className="mt-2 space-y-2">
            {TRIAGE_LEVELS.map((t) => (
              <label key={t.id} data-urgent={t.id === ACUTE_LEVEL_ID} className="flex cursor-pointer items-start gap-3 rounded-field border border-base-300 p-4 has-[:checked]:border-neutral has-[:checked]:bg-base-200">
                <input
                  type="radio"
                  name="triage"
                  value={t.id}
                  checked={triage === t.id}
                  onChange={() => setTriage(t.id)}
                  className="radio mt-0.5 shrink-0"
                />
                <span>
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-sm text-base-content/70">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.includes("triageLevelId") && <p id="triage-error" className="field-error mt-2 text-sm">Choose how soon you need to be seen.</p>}
        </fieldset>

        {acuteSelected && (
          <div role="alert" className="alert alert-error alert-soft block p-4">
            <p className="font-semibold">Please do not wait for this app.</p>
            <p className="mt-1">{CANNOT_HELP_NOW}</p>
            <ul className="mt-2 space-y-1">
              {EMERGENCY_CONTACTS.slice(0, 3).map((c) => (
                <li key={c.tel}>
                  {c.name}:{" "}
                  <a className="text-lg font-bold underline underline-offset-2" href={`tel:${c.tel}`}>
                    {c.phone}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">{preview ? "Sample only: no request is sent and no staff are notified. In the connected app, an urgent request is flagged for direct follow-up." : "You can still send this request so staff follow up with you directly."}</p>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={busy}
        className="btn btn-primary w-full sm:w-auto"
      >
        {busy ? "Sending…" : "Send request privately"}
      </button>
      {preview && <p className="text-sm text-base-content/70">Sample only. Fields stay on this screen and are discarded when you leave. Continue to see a fictional request and booking example.</p>}
    </form>
  );
}
