// POST /api/v1/mock/hub: a stand-in Notification Hub that checks the webhooks we send (tests and demos).
// PUT /api/v1/mock/hub: switch a pretend Hub outage on or off, to show that delivery retries work.
// Who can call it: POST is open but accepts only correctly signed events; PUT needs the machine token.
// What it does: POST checks the HMAC signature (made with a shared secret) on the raw body, then checks
//   the body has exactly the fields of the event contract, then logs the event id and type.
//   PUT stores the "fail" flag that POST reads.
// Returns: POST 202 { accepted, eventId }, or 401 invalid_signature, 400 invalid_json,
//   422 body_outside_contract, 503 during a pretend outage. PUT 200 { fail }, or 401.
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { CORRELATION_HEADER, machineAuthorized } from "@/lib/http";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, outboundEvent, verify } from "@/lib/events/contract";

// Contract mock of the Notification Hub: it verifies the signature and the exact event body over REAL
// HTTP, so "mock the consumer" still exercises the true delivery path. Enabled only when
// MOCK_HUB_ENABLED=true; 404 otherwise.
//
// PUT toggles an outage for the degradation rehearsal:  { "fail": true | false }
// (requires `Authorization: Bearer <DISPATCH_TOKEN>`)

// The outage flag is kept in server memory on globalThis (so it survives a module reload in dev).
// It belongs to one server instance and resets on restart, which is fine for a test stand-in.
const state = globalThis as unknown as { __mockHubFail?: boolean };

// Not wrapped by route(): the signature must be checked on the exact raw body text, and route()
// would read the body as JSON first. So this file builds its own simple replies.
function reply(status: number, json: unknown, cid: string) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", [CORRELATION_HEADER]: cid },
  });
}

export async function POST(req: Request): Promise<Response> {
  const cid = req.headers.get(CORRELATION_HEADER) ?? randomUUID();
  if (!env.mockHubEnabled) return reply(404, { error: "not_found" }, cid);
  // During a pretend outage, answer 503 so our dispatcher counts it as a failure and retries later.
  if (state.__mockHubFail) return reply(503, { error: "mock_hub_outage" }, cid);

  // Read the body as raw text: the signature covers these exact characters. Parsing and re-writing
  // the JSON could change spacing or key order and break the check.
  const rawBody = await req.text();
  // Uses the same secret our dispatcher signs with. verify() also refuses a timestamp older than
  // 5 minutes, so an old captured message cannot be replayed.
  const verdict = verify(rawBody, req.headers.get(SIGNATURE_HEADER), req.headers.get(TIMESTAMP_HEADER), env.hubSigningSecret);
  if (!verdict.ok) return reply(401, { error: "invalid_signature", reason: verdict.reason }, cid);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reply(400, { error: "invalid_json" }, cid);
  }
  // outboundEvent is the shared contract: a confirmed or cancelled event with no extra fields.
  // 422 means "signed correctly, but the body breaks the contract" (for example it carries a note).
  const parsed = outboundEvent.safeParse(body);
  if (!parsed.success) return reply(422, { error: "body_outside_contract" }, cid);

  // X-Event-Id stays the same on every retry of one event, so a real Hub can drop duplicates with it.
  // The log line holds ids and the event type only, never the body.
  const eventId = req.headers.get(EVENT_ID_HEADER);
  console.log(
    JSON.stringify({ t: new Date().toISOString(), svc: "mock-hub", cid, eventId, type: parsed.data.event_type, accepted: true }),
  );
  return reply(202, { accepted: true, eventId }, cid);
}

export async function PUT(req: Request): Promise<Response> {
  const cid = req.headers.get(CORRELATION_HEADER) ?? randomUUID();
  if (!env.mockHubEnabled) return reply(404, { error: "not_found" }, cid);
  // The outage switch is an operator action: it needs the machine credential, not anonymity.
  if (!machineAuthorized(req)) return reply(401, { error: "unauthenticated" }, cid);
  // A missing or broken body counts as {}, and anything but "fail": true switches the outage off.
  const body = (await req.json().catch(() => ({}))) as { fail?: boolean };
  state.__mockHubFail = body.fail === true;
  return reply(200, { fail: state.__mockHubFail }, cid);
}
