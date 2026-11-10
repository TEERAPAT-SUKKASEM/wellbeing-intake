# Wellbeing (Team 16) — integration bundle for Helpdesk (Team 14)

**Contract 2.0 (2026-11-10).** This replaces 1.2. `GET /services` changed shape on 2026-11-09; see
§0 of the contract for exactly what changed and what you need to update. Nothing here needs a key, an
account or a secret.

| File | What it is |
| --- | --- |
| [`Team14-Integration-Contract.md`](Team14-Integration-Contract.md) | **Start here.** §0 lists every change since 1.2; the rest answers all 22 items of your checklist |
| [`openapi.yaml`](openapi.yaml) | Our full OpenAPI 3.1 contract (you only need `GET /services` and `GET /health`) |
| [`Wellbeing-Team16.postman_collection.json`](Wellbeing-Team16.postman_collection.json) | Postman collection with assertions: *Import* → run the collection |
| [`wellbeing-client.mjs`](wellbeing-client.mjs) | Reference consumer (Node 18+, no dependencies): timeout, cache, never throws when we are down |
| [`smoke-test.mjs`](smoke-test.mjs) | Your test plan (tests 1–4, 7, 8) run against our live API |
| [`examples/`](examples) | Real responses captured from the live API on 2026-11-10 |

## Two-minute check

```bash
curl -i https://wellbeing-intake.vercel.app/api/v1/services -H "X-Correlation-Id: team14-v2-0001"
node smoke-test.mjs        # expect: All applicable tests passed
```

## The six things that will save you time

1. **The response is now a plain array**, not `{ "services": [...] }`.
2. **Store `id`.** `srv_academic_stress`, `srv_general_counselling` and `srv_urgent_drop_in` never
   change. There is no `slug` any more. Old slugs: `counselling` and `wellbeing-advising` →
   `srv_general_counselling`; `health-clinic` and `physiotherapy` have no replacement.
3. **Immediate danger comes first.** If a ticket suggests someone may hurt themselves or others, show
   **1669** and **1323** straight away. Our services, even Urgent Drop-in, are appointments, not
   crisis support.
4. **No student data, ever.** We share the public service catalogue only. Students book with us
   anonymously; never ask them for their Wellbeing access key. Point the student to us, and they book
   themselves (contract §2).
5. **Call us from your server.** We send no CORS headers, so a browser on your origin cannot read us.
6. **Never block a ticket on us.** Cache the catalogue for up to 10 minutes; if we are down, hide the
   suggestion.

## Using the reference client

```js
import { createWellbeingClient } from "./wellbeing-client.mjs";

const wellbeing = createWellbeingClient();

const { services, available, stale } = await wellbeing.listServices();
// services: [{ id, name, description, durationMinutes }]
// available:false -> hide the Wellbeing suggestion; stale:true -> served from your cache during an outage

const { service } = await wellbeing.getService(ticket.wellbeing_service_id);
// service === null -> not offered right now (your "not found" case)
```

## Checking the new version together

Tell us just before you run your first 2.0 call with `X-Correlation-Id: team14-v2-0001`. Our hosting
keeps server logs for about an hour, and we will send you our provider-side log line for that ID.

Contact: Teerapat Sukkasem, Team 16 · Source: <https://github.com/TEERAPAT-SUKKASEM/wellbeing-intake>
