---
name: linkedin-voyager
description: "Foundation for all LinkedIn automation in this repo: how to reach LinkedIn's internal Voyager API through the chrome-devtools MCP, verify the session, run the ready-made snippets, and respect rate limits and hard stops. Use for any LinkedIn lookup, search, profile enrichment, Sales Navigator URL resolution, withdrawal, or when a Voyager call fails or returns an unexpected shape. Sending invitations lives in linkedin-connect, status checks in linkedin-check-connect, and messaging in linkedin-message; each of those builds on this skill."
---

# LinkedIn Voyager

All LinkedIn work runs as JavaScript inside a signed-in `https://www.linkedin.com/` tab, called through the chrome-devtools MCP's `evaluate_script` tool. The page's own session cookies authenticate every request. There is no separate API key, CLI, or bridge.

## Before any batch

1. `list_pages`. Reuse an open `www.linkedin.com` tab. If none exists, `new_page` to `https://www.linkedin.com/feed/` and `select_page` it.
2. Run [`snippets/me.js`](../../snippets/me.js) with `evaluate_script`.
3. Require `ok: true`, HTTP 200, and the name/`publicIdentifier` the user expects to act as. Keep `profileUrn` for messaging.
4. On failure, stop and tell the user. The usual fixes: sign in to LinkedIn in the automation Chrome, or start Chrome with remote debugging (see [`docs/chrome-setup.md`](../../docs/chrome-setup.md)).

If every lookup in a batch fails, rerun the session check before assuming a block or rate limit. The selected tab is usually the problem.

## Running a snippet

Each file in [`snippets/`](../../snippets/) is a single `async () => { ... }` function. To run one:

1. Read the file.
2. Replace only the `const INPUT = { ... };` literal with the real values.
3. Pass the whole function text as `evaluate_script`'s `function` argument.
4. Parse the returned JSON.

| Snippet | Does | Side effects |
|---|---|---|
| `me.js` | Session and identity check | none |
| `check-profiles.js` | Relationship status for up to ~40 slugs | none |
| `sent-invitations.js` | Every active outbound invitation | none |
| `people-search.js` | People or company search | none |
| `resolve-sales-nav.js` | Sales Navigator lead URL to `/in/` URL | none |
| `inbox.js` | Walk message threads | none |
| `read-conversation.js` | Messages in one thread | none |
| `send-invitations.js` | Blank connection requests | **sends invitations** |
| `send-message.js` | One direct message | **sends a message** |
| `withdraw-invitations.js` | Withdraw pending invitations | **withdraws, triggers cooldown** |

For anything not covered by a snippet (full profile enrichment, recent connections), write the call from [`docs/voyager-api.md`](../../docs/voyager-api.md). Read that doc before changing a snippet or diagnosing an unexpected response.

## Authorization

Read-only snippets can run whenever the user asks for information.

Anything that sends, messages, or withdraws requires the user's explicit go-ahead in the current conversation for that exact batch: who, how many, and (for messages) the exact text. Researching or preparing a list is not authorization to send. An approval for one batch does not carry over to the next.

## Hard stops

Stop the run, report what happened, and do not retry when you see any of:

- HTTP 429 or 401, or a snippet returning `hardStop`
- a login page, CAPTCHA, "unusual activity" or security checkpoint
- `/me` returning a different account than expected
- a send that may have reached LinkedIn without a clear receipt (`ambiguous_send`)

Resume only when the user asks, after a fresh session check.

## Limits

- Reads: at least 300 ms apart, about 40 per `evaluate_script` call.
- Invitations: at least 3 s apart, at most 20 per batch. Never send in parallel.
- Messages: one per call, a few seconds apart.
- `evaluate_script` times out around 120 s. Chunk longer work.
- LinkedIn's weekly invitation ceiling is roughly 100 to 200 and is not readable. Don't try to infer remaining quota.

## Security

Never return, print, log, or save `document.cookie`, `JSESSIONID`, the CSRF token, request headers, or the DevTools WebSocket URL. Keep them inside the page function. Run logs hold only sanitized results.

## Tab discipline

Keep all work in one LinkedIn tab and do not close it mid-call. That wedges the MCP's selected page. Don't navigate the tab away from linkedin.com while a batch is running.

## Run logs

Save each batch's sanitized results as JSONL under `runs/YYYY-MM-DD-<short-name>/` (gitignored), one line per person, so a run can be resumed or audited. Before sending to anyone, check existing run logs for a prior `verified_send` to that slug.

## When an endpoint breaks

LinkedIn changes Voyager without notice. On a new 400/404 or an empty parse:

1. Log `Object.keys(response)` and compare with the documented shape.
2. For messaging or search 400s, check parenthesis encoding first, then harvest a fresh `queryId` from the live page's network requests.
3. Fix the snippet and add a dated note in `docs/voyager-api.md`.
