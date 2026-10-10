# APLYNX website → Client Hub

Endpoint: `https://aplynx-client-hub.hands-on-cha-3500.chatgpt.site/api/leads`

The Vercel website submits browser forms to its same-origin `/api/inquiry` function. That function forwards individual new inquiries to this private CRM endpoint and keeps the existing Web3Forms notification. No historical contacts are imported.

## Server configuration

Vercel Production environment variables (already configured during integration):
- `CRM_LEAD_ENDPOINT`: endpoint above.
- `CRM_WEBSITE_LEAD_KEY`: secret shared with the CRM's environment variable of the same name.
- `CRM_SITES_SERVICE_TOKEN`: secret Sites service-access token for this private Site.
- `WEB3FORMS_ACCESS_KEY`: existing notification service access key, stored server-side.

Never put these credentials in HTML, browser JavaScript, public-prefixed variables, source control, or the CRM interface. Configure secret values directly in the two hosting dashboards; redeploy the website after changing Vercel variables. Keep the Site private. Rotate the shared lead key on both platforms together; update Vercel if the Sites service token changes.

## Request contract

Server-to-server `POST`, JSON, with `Authorization: Bearer <CRM_WEBSITE_LEAD_KEY>` and `OAI-Sites-Authorization: Bearer <CRM_SITES_SERVICE_TOKEN>`.

```json
{
  "submission_id": "APX-unique-reference-0001",
  "name": "Example contact",
  "email": "example@example.com",
  "phone": "4705550100",
  "inquiry_type": "apartment",
  "submitted_at": "2026-10-10T04:00:00Z",
  "requirements": "2 bedrooms, near MARTA",
  "area": "Atlanta",
  "budget": "1500",
  "timeline": "November"
}
```

Types: `apartment`, `buyer`, `seller`, `room`, `management`. Email or a valid phone is required. Source is fixed by the receiver. Maximum JSON body: 20,000 characters. IDs are 10–100 letters, digits, underscores, or hyphens. Reuse the exact reference and payload on retry. A reference reused with different data returns 409.

Email is matched case-insensitively; phone ignores common formatting and the US +1 prefix. A match updates the existing lead's stage to New inquiry and fills empty contact/search fields. It preserves original details, marketing permission, notes, follow-ups, and creation date. Every submission stores its full details in inquiry history and the client's activity feed. Ambiguous matches return 409 for review rather than merging records.

A successful POST returns `ok`, `client_id`, `submission_id`, and whether a client was created. Authorized `GET ?submission_id=...` reads back delivery evidence. The Vercel bridge records email-provider acceptance, reads the saved record back, then verifies the connection. The CRM displays awaiting test until that sequence succeeds.

## Deployment and verification

1. Deploy CRM schema and API.
2. Configure the four Vercel variables above; preserve existing environment entries.
3. Deploy `api/inquiry.mjs` and updated form handlers in `index.html` and `list-your-property.html`.
4. Submit a clearly named connection test through the live website `/api/inquiry` using the same payload as a browser form.
5. Confirm the saved reference and New inquiry client, plus email notification acceptance. Do not claim mailbox delivery without checking the inbox.
6. In CRM → Team & website, the connection becomes verified only after successful readback. Each form uses this same path. Future retries reuse references to avoid duplicate lead/activity records; the website retains answers on failures.

Notification failures do not erase a saved CRM inquiry. CRM outages trigger the existing email channel with a review notice and return an error so the visitor can retry. Rare interrupted acknowledgments can result in duplicate notification emails; the CRM reference remains idempotent. The website rate limit is per server instance; the CRM endpoint additionally requires both service access and the private lead key.
