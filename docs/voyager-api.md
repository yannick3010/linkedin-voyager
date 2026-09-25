# LinkedIn Voyager API reference

Voyager is LinkedIn's internal REST/GraphQL API, the one the linkedin.com web app itself calls. It is not a public or supported API. Every call here runs inside a signed-in `https://www.linkedin.com/` tab (via `evaluate_script` from the chrome-devtools MCP), using the browser's own session cookies.

Prefer Voyager over clicking through the UI. It is 10 to 50 times faster, more reliable, and returns structured data.

Endpoint shapes were last verified in September 2026. LinkedIn changes these without notice. When a shape drifts, fix this file and add a dated note next to the change.

Ready-to-run versions of these calls live in [`../snippets/`](../snippets/).

## Authentication

Every request needs the CSRF token from the `JSESSIONID` cookie, plus `credentials: 'include'` so the session cookies are sent.

```js
const csrfCookie = document.cookie
  .split(';')
  .map(c => c.trim())
  .find(c => c.startsWith('JSESSIONID='));
const token = csrfCookie ? csrfCookie.split('=')[1].replace(/"/g, '') : null;

const headers = {
  'csrf-token': token,
  'x-restli-protocol-version': '2.0.0',
  // Most snippets also send these. They produce the "normalized" response shape described below.
  accept: 'application/vnd.linkedin.normalized+json+2.1',
  'x-li-lang': 'en_US'
};
// POST requests add: 'content-type': 'application/json'
// Every fetch: credentials: 'include'
```

Never return, log, or store the cookie, the CSRF token, or request headers. Keep them inside the page evaluation.

## Session check

```
GET /voyager/api/me
```

Returns the signed-in member. Read `miniProfile.firstName`, `miniProfile.lastName`, `miniProfile.publicIdentifier`, and `miniProfile.entityUrn` (`urn:li:fs_miniProfile:<id>`). Your own `fsd_profile` URN, needed for messaging, is the same `<id>` as `urn:li:fsd_profile:<id>`.

Run this before every batch and confirm it returns HTTP 200 for the account you intend to act as. A batch where every lookup fails almost always means the selected tab is not a signed-in LinkedIn tab, not that LinkedIn blocked you. Check the session before diagnosing a rate limit.

## Rate limits

- Reads: at least 300 ms between sequential requests. Keep to about 40 requests per `evaluate_script` call.
- Invitations: at least 3 seconds between sends. Keep batches to 20 or fewer.
- LinkedIn starts returning 429 at roughly 100 requests per minute. A 429 is a hard stop. Save progress and do not retry in a loop. Resume later, after checking the session.
- LinkedIn enforces a weekly invitation ceiling of roughly 100 to 200 depending on the account. You cannot read your remaining quota. The sent-invitation list is not a quota signal.
- `evaluate_script` times out around 120 seconds. For long loops, chunk the work and keep progress in `window.__batchIdx` / `window.__batchResults` so the next call can resume.

## Endpoints

### 1. Profile lookup (connection status and basic info)

Checks whether a person is a 1st-degree connection, and returns name, headline, and profile URN.

```
GET /voyager/api/identity/dash/profiles
  ?q=memberIdentity
  &memberIdentity={slug}
  &decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-15
```

`{slug}` is the vanity part of the profile URL, e.g. `jane-doe-123` from `/in/jane-doe-123/`.

**The response is normalized.** With the standard `accept` header above, `data.data['*elements']` is an array of URN strings pointing into `data.included`. It is not an inline object, and the legacy `data.elements[0]` path returns `undefined`.

```js
// Correct
const targetUrn = data?.data?.['*elements']?.[0];
const profile   = data?.included?.find(i => i.entityUrn === targetUrn);

// Wrong: your own profile is also in `included`, so this can pick you instead of the target
const profile = data?.included?.find(i => i.firstName);
```

Key fields:

```json
{
  "data": { "*elements": ["urn:li:fsd_profile:<PROFILE_ID>"] },
  "included": [
    {
      "$type": "com.linkedin.voyager.dash.identity.profile.Profile",
      "entityUrn": "urn:li:fsd_profile:<PROFILE_ID>",
      "firstName": "Jane",
      "lastName": "Doe",
      "headline": "VP Operations",
      "publicIdentifier": "jane-doe-123",
      "*memberRelationship": "urn:li:fsd_memberRelationship:<PROFILE_ID>"
    },
    {
      "$type": "com.linkedin.voyager.dash.relationships.MemberRelationship",
      "entityUrn": "urn:li:fsd_memberRelationship:<PROFILE_ID>",
      "memberRelationshipUnion": { "*connection": "urn:li:fsd_connection:..." }
    }
  ]
}
```

**Reading the relationship.** The profile does not carry an inline `memberRelationship` object. It carries a `*memberRelationship` URN pointer, and the relationship entity lives separately in `included`. `el.memberRelationship` is always `undefined` here, which makes everyone look not-connected. Follow the pointer:

```js
const el = data.included.find(i => i.entityUrn === data.data['*elements'][0]);
const mr = data.included.find(i => i.entityUrn === el?.['*memberRelationship']);
const union = mr?.memberRelationshipUnion || {};
const connected = ('*connection' in union) || ('connection' in union);
```

| Signal | Meaning |
|---|---|
| `memberRelationshipUnion` has `*connection` | 1st degree. They are connected. |
| `noConnection.invitationUnion['*invitation']` resolves to `invitationType=SENT`, `invitationState=PENDING` | Not connected, outbound invitation pending |
| `noConnection.invitationUnion` has `noInvitation` | Not connected, no invitation. Safe to send. |
| `noConnection` with anything else | Not connected, invitation state unknown. Not safe to send. |

Current responses sometimes resolve an invitation as `SENT` with `invitationState: null` even though it is visibly pending. Treat that as unknown and confirm with Endpoint 7. Unresolved evidence never justifies a resend.

Do not string-scan for `DISTANCE_1`. It does not appear for 1st-degree connections on this decoration.

A 403 on this lookup almost always means the slug is wrong or the profile was renamed, not a rate limit. Recover with a people search (Endpoint 3) and continue the batch.

### 2. Full profile (experience, education, skills, about)

```
GET /voyager/api/identity/dash/profiles
  ?q=memberIdentity
  &memberIdentity={slug}
  &decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-109
```

Includes `profilePositionGroups`, `profileEducations`, `profileSkills`, `summary`, `profileCertifications`, `profileLanguages`, `industry`, `geoLocation`, `profilePicture`, and account flags (`premium`, `influencer`, `creator`). This decoration does not include the relationship entities, so use Endpoint 1 for connection status.

```js
const positions = el?.profilePositionGroups?.elements || [];
positions.forEach(pg => {
  const roles = (pg.profilePositionInPositionGroup?.elements || []).map(p => ({
    title: p.title,
    companyName: p.companyName,
    startDate: p.dateRange?.start, // { month, year }
    endDate: p.dateRange?.end      // null = current role
  }));
});
```

### 3. People search

```
GET /voyager/api/graphql
  ?variables=(start:0,origin:FACETED_SEARCH,query:(keywords:{keywords},flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(PEOPLE)),{filters}),includeFiltersInResponse:false),count:{count})
  &queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0
```

Filters, added to `queryParameters`:
- Company: `(key:currentCompany,value:List({companyId}))` (get the ID from Endpoint 4)
- Network: `(key:network,value:List(F,S))` (F = 1st, S = 2nd)
- Title: put it in `keywords`, e.g. `VP Marketing`

```js
const clusters = data?.data?.searchDashClustersByAll?.elements || [];
const people = [];
clusters.forEach(c => (c.items || []).forEach(item => {
  const e = item?.item?.entityResult;
  if (e) people.push({
    name: e.title?.text,
    headline: e.primarySubtitle?.text,
    location: e.secondarySubtitle?.text,
    profileUrl: e.navigationUrl,
    degree: e.badgeText?.text || e.badgeText
  });
}));
```

**To enumerate a company's people, inspect every result.** A search by `currentCompany` returns people whose headline names a different company, such as a subsidiary, as well as teams a name search would miss. Headline or keyword scans are not enough to claim someone is absent.

**Use as recovery for bad slugs.** Search `"<first> <last> <company>"` (origin `GLOBAL_SEARCH_HEADER`, PEOPLE, count 5) to find renamed profiles that 403 on Endpoint 1. Each result carries `navigationUrl` (current URL), `entityUrn` (embeds the `fsd_profile` URN, usable for sending directly), and `badgeText` (degree). Confirm identity by headline naming the company before acting. No plausible match across two keyword variants usually means the profile was deactivated.

Search `queryId` values rotate with LinkedIn frontend builds. If searches start returning 400, harvest the current one from the live page (see Endpoint 9).

### 3a. Resolve a Sales Navigator lead URL

`/sales/lead/{salesProfileId}` URLs cannot be passed to profile or invitation endpoints. Resolve them first:

```
GET /sales-api/salesApiProfiles/(profileId:{salesProfileId},authType:undefined,authToken:undefined)
  ?decoration=(entityUrn,objectUrn,firstName,lastName,fullName,headline,pendingInvitation,flagshipProfileUrl)
```

Call it from the `www.linkedin.com` tab with the CSRF and Rest.li headers. Do not URL-encode the profile ID inside the tuple. Percent-encode the decoration's parentheses and commas.

Require HTTP 200, an `entityUrn` starting with `urn:li:fs_salesProfile:({salesProfileId},`, and a valid `/in/{slug}` URL in `flagshipProfileUrl`. That exact ID match is the identity check. Then use Endpoint 1 on the returned slug. 401 or 429 is a hard stop. Other failures can fall back once to people search. Requires a Sales Navigator seat.

### 4. Company search

```
GET /voyager/api/graphql
  ?variables=(start:0,origin:SWITCH_SEARCH_VERTICAL,query:(keywords:{company_name},flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(COMPANIES))),includeFiltersInResponse:false),count:5)
  &queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0
```

The company ID is in the result's `entityUrn`: `urn:li:fsd_entityResultViewModel:(urn:li:fsd_company:{id},SEARCH_SRP,DEFAULT)`. Extract it with `/fsd_company:(\d+)/`.

### 5. Send a connection request

```
POST /voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreate
Content-Type: application/json

{ "inviteeProfileUrn": "urn:li:fsd_profile:{profileId}" }
```

Get `inviteeProfileUrn` from Endpoint 1 (`data.data['*elements'][0]`).

Success (200):

```json
{
  "data": {
    "value": {
      "invitationUrn": "urn:li:fsd_invitation:<INVITATION_ID>",
      "$type": "com.linkedin.voyager.dash.relationships.invitation.InvitationCreationResult"
    },
    "$type": "com.linkedin.restli.common.ActionResponse"
  }
}
```

The receipt is at `data.value.invitationUrn`, not `value.invitationUrn`. A parser that only checks the old path reports every successful send as failed. Check the nested path first and keep the old one as a fallback:

```js
const invitationUrn = result?.data?.value?.invitationUrn || result?.value?.invitationUrn || null;
```

A send counts as verified only with HTTP 200 plus an `invitationUrn`.

Notes:
- This sends a blank request with no note. Blank requests tend to convert better.
- `customMessage: "..."` in the body is untested. Use the UI for requests with a note.
- Wait at least 3 seconds between sends. Never fire requests in parallel.

Errors:
- `400` with `{"code":"CANT_RESEND_YET"}`: you have a pending invite to this person, or withdrew one recently, and LinkedIn's cooldown (weeks to months) applies. Do not retry this person. If you didn't expect a prior invite, the slug is probably stale and a live invite exists under the current one.
- `403`: invalid URN or blocked profile. Log it and continue.
- `429`: rate limited. Stop the batch.

### 6. Recent connections

```
GET /voyager/api/relationships/dash/connections?q=search&count={count}&start=0&sortType=RECENTLY_ADDED
```

```json
{ "elements": [{ "connectedMember": "urn:li:fsd_profile:<PROFILE_ID>", "createdAt": 1775871620000, "entityUrn": "urn:li:fsd_connection:<PROFILE_ID>" }] }
```

Returns profile URNs only. Resolve names through Endpoint 1 if needed.

### 7. List active sent invitations (bulk pending check)

The fastest way to check many pending invitations at once: pull the whole outbound list, then compare.

```
GET /voyager/api/voyagerRelationshipsDashSentInvitationViews
  ?count=100&q=invitationType&invitationType=CONNECTION&start={offset}
```

Do not pass a `decorationId`. This endpoint returns 400 if you do.

Per element:

```json
{
  "title": { "text": "Jane Doe" },
  "subtitle": { "text": "VP Operations at Example Co" },
  "cardActionTarget": "https://www.linkedin.com/in/jane-doe-123",
  "sentTimeLabel": "Sent 2 days ago",
  "invitationUrn": "urn:li:fsd_invitation:<INVITATION_ID>"
}
```

Pagination: no total is returned. Loop until a page returns fewer than `count` elements.

The shape has flipped before. Elements are currently top-level. Read defensively: `j.elements || j.data?.elements || []`.

**How to use it for status checks:** if someone's slug or stored invitation URN is in the list, they are still pending. Absence does not prove they accepted, because they may have declined, or you or LinkedIn may have withdrawn the invite. For anyone missing from the list, confirm with Endpoint 1. Do not rely on diffing two snapshots of this list either. A request sent and accepted between checks shows up in neither.

The older `/voyager/api/relationships/sentInvitationViewsV2` also works but returns a larger response. Keep it as a fallback.

### 8. Withdraw a connection request

```
POST /voyager/api/relationships/invitations/{numericId}?action=withdraw
Content-Type: application/json
Body: {}
```

`{numericId}` is the number at the end of the `invitationUrn`.

Success: `{ "data": { "value": "Invitation withdrawn" } }`.

Use this legacy endpoint. The newer Dash equivalents (`voyagerRelationshipsDashInvitationViews/...?action=closeInvitation`, `voyagerRelationshipsDashSentInvitationViews/...?action=closeInvitation`) return 400.

Throttle with a random 1 to 2.5 second delay. Around 300 withdrawals in about 12 minutes has run without rate limiting. Chunk to about 50 per `evaluate_script` call to stay under the timeout. Withdrawing puts that person in the resend cooldown.

### 9. Read messaging conversations

Only the GraphQL gateway works. The legacy REST path (`/voyager/api/messaging/conversations`) and the Dash `voyagerMessagingDashMessengerConversations` finders return 400/500.

**Messaging `queryId`s rotate with every LinkedIn frontend build.** If a call returns 400, harvest the current one: open `https://www.linkedin.com/messaging/`, then read `performance.getEntriesByType('resource')` for a `voyagerMessagingGraphQL/graphql?queryId=messengerConversations.*` request, and copy the live `queryId` and variables shape. The values below were current in mid-2026.

```
# Cursor-paginated inbox. Use this to walk the whole inbox.
GET /voyager/api/voyagerMessagingGraphQL/graphql
  ?queryId=messengerConversations.9501074288a12f3ae9e3c7ea243bccbf
  &variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20,mailboxUrn:{yourProfileUrn},nextCursor:{cursor})

# Recent inbox only (about 20 threads, does not paginate backward)
GET /voyager/api/voyagerMessagingGraphQL/graphql
  ?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48
  &variables=(mailboxUrn:{yourProfileUrn})
```

- `{yourProfileUrn}` is your `urn:li:fsd_profile:<id>` from `/voyager/api/me`, URL-encoded.
- Pagination: omit `nextCursor` on the first page, then pass the response's `"nextCursor"` URL-encoded. Stop when it is missing or repeats, or when `lastActivityAt` passes your date floor. If you stop on a page limit, say so. Don't silently cap.

Parsing: conversations are in `included`, keyed by `$type`:
- `...Conversation`: `entityUrn`, `lastActivityAt` (ms), `unreadCount`, `*conversationParticipants`.
- `...MessagingParticipant`: `hostIdentityUrn` is the bare `urn:li:fsd_profile:<id>`. There is no slug here, so match on profile ID.
- `...Message`: the latest message per conversation. `*sender` is a participant URN. Compare its profile ID to yours to tell who spoke last.

To check whether you already have a thread with someone, resolve their slug to a profile URN with Endpoint 1, then intersect with inbox participants. A thread where the last message is yours means "sent, awaiting reply". A thread where they spoke last means "replied".

Read one conversation:

```
GET /voyager/api/voyagerMessagingGraphQL/graphql
  ?queryId=messengerMessages.5846eeb71c981f11e0134cb6626cc314
  &variables=(conversationUrn:{conversationUrn})
```

**Parenthesis encoding.** Conversation URNs contain literal parentheses, e.g. `urn:li:msg_conversation:(urn:li:fsd_profile:...,2-...)`. `encodeURIComponent` does not encode `(` and `)`, so they break the `variables=(...)` wrapper and the call returns 400. That looks like a rotated `queryId` but isn't. Encode like this:

```js
encodeURIComponent(urn).replace(/\(/g, '%28').replace(/\)/g, '%29')
```

### 10. Send a direct message

Works for 1st-degree connections, for both new conversations and replies.

```
POST /voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage
Content-Type: application/json
```

```json
{
  "message": {
    "body": { "attributes": [], "text": "<message text>" },
    "originToken": "<UUID v4>",
    "renderContentUnions": []
  },
  "mailboxUrn": "urn:li:fsd_profile:<your_id>",
  "trackingId": "<16 random bytes as a Latin-1 string>",
  "dedupeByClientGeneratedToken": false,
  "hostRecipientUrns": ["urn:li:fsd_profile:<recipient_id>"]
}
```

- `hostRecipientUrns` is top-level. Wrapping the recipient in `conversationCreate.recipients` returns 400.
- `originToken`: `crypto.randomUUID()`.
- `trackingId`: `String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))`. Non-ASCII bytes are expected.
- `mailboxUrn`: from `/voyager/api/me`, `miniProfile.entityUrn` with `fs_miniProfile` swapped for `fsd_profile`.
- Recipient URN: from Endpoint 1.

Success is HTTP 200 with the new message URN. The UI also sends delivery acknowledgements and marks the thread read. Those are telemetry and not needed.

## What doesn't work (or is untested)

| Action | Status | Alternative |
|---|---|---|
| Connection request with a note | `customMessage` untested | UI |
| Accept an incoming request | Untested | UI |
| Follow / unfollow | Untested | UI |

## Gotchas

1. `noConnection` alone does not tell pending from never-sent. Use Endpoint 7 membership, or resolve Endpoint 1's invitation pointer. Unknown is not permission to resend.
2. On LinkedIn pages, `<main>` is the scroll container, not `window` (`document.body` has `overflow: hidden`). Scroll with `main.scrollTop = main.scrollHeight`.
3. Profile `<a>` tags on the sent-invitations page have empty text. The name is in `link.parentElement.innerText`. Match by slug, not name.
4. Sales Navigator URLs must be resolved (Endpoint 3a) before use.
5. These are internal endpoints. If one starts returning 400/404, the path, `queryId`, or decoration ID probably changed. Open the matching LinkedIn page, read network requests, and update this file.
6. Decoration IDs control the returned data. `WebTopCardCore-15` (and `-22`) carry relationship state. `FullProfileWithEntities-109` carries enrichment but not relationships.
7. Some Dash endpoints reject explicit decoration IDs (e.g. Endpoint 7). Try without one before assuming a path is broken.
8. Withdraw uses the legacy invitation resource, not the Dash view resource.
9. Always log `Object.keys(response)` once when touching an endpoint for the first time. Several parser bugs came from silent shape changes.
