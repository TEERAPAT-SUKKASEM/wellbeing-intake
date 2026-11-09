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

const state = globalThis as unknown as { __mockHubFail?: boolean };

function reply(status: number, json: unknown, cid: string) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", [CORRELATION_HEADER]: cid },
  });
}

export async function POST(req: Request): Promise<Response> {
  const cid = req.headers.get(CORRELATION_HEADER) ?? randomUUID();
  if (!env.mockHubEnabled) return reply(404, { error: "not_found" }, cid);
  if (state.__mockHubFail) return reply(503, { error: "mock_hub_outage" }, cid);

  const rawBody = await req.text();
  const verdict = verify(rawBody, req.headers.get(SIGNATURE_HEADER), req.headers.get(TIMESTAMP_HEADER), env.hubSigningSecret);
  if (!verdict.ok) return reply(401, { error: "invalid_signature", reason: verdict.reason }, cid);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reply(400, { error: "invalid_json" }, cid);
  }
  const parsed = outboundEvent.safeParse(body);
  if (!parsed.success) return reply(422, { error: "body_outside_contract" }, cid);

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
  const body = (await req.json().catch(() => ({}))) as { fail?: boolean };
  state.__mockHubFail = body.fail === true;
  return reply(200, { fail: state.__mockHubFail }, cid);
}
