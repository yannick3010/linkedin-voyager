---
name: linkedin-connect
description: "Send blank LinkedIn connection requests through the Voyager API to a list of profiles the user provides (URLs, slugs, CSV, or Sales Navigator lead URLs), with a fresh relationship check right before each send, a 20-per-batch cap, 3-second spacing, and a local run log. Use when the user wants to send, prepare, or resume connection requests. Requires explicit authorization for each batch. Status checks go to linkedin-check-connect; messages go to linkedin-message."
---

# LinkedIn Connect

Send blank connection requests (no note) to people the user chose. This skill does not decide who to target. It takes a list, checks each person, sends only where it is safe, and records the result.

Read [linkedin-voyager](../linkedin-voyager/SKILL.md) first for session setup, snippet usage, and hard stops.

## Modes

- **Prepare** (default when the request is ambiguous): check everyone, report who is sendable, send nothing.
- **Send**: the user explicitly authorized sending to this list or the first N of it in the current conversation.
- **Resume**: continue a previous run from its log.

If the user hasn't clearly said to send, prepare and ask.

## Workflow

### 1. Normalize the list

Accept `/in/` URLs, bare slugs, CSV (a `linkedin_url` or `url` column; see [`examples/targets.csv`](../../examples/targets.csv)), or JSON.

- Convert `/in/` URLs to slugs.
- Resolve `/sales/lead/...` URLs with `snippets/resolve-sales-nav.js`. Keep only `resolved` ones.
- Deduplicate by slug.
- Drop anyone with a prior `verified_send` in `runs/*/results.jsonl`, and anyone the user excluded.

Show the user the cleaned count and anything dropped.

### 2. Session check

Run `me.js`. Confirm the account with the user if you have not already this conversation.

### 3. Prepare (optional, and the default)

Run `check-profiles.js` on the list (chunks of ~40). Only `not_connected` people are sendable. Report the counts by status, then ask how many to send.

### 4. Send

Run `send-invitations.js` with the authorized slugs, capped at 20 per call and at the authorized total. The snippet rechecks each person immediately before sending and sends only when LinkedIn explicitly reports no existing invitation. It also skips on identity mismatch (the slug now points to a different `publicIdentifier`).

If the user authorized more than N sends and some candidates get skipped, continue with the next people on their list until N verified sends or the list runs out. Never exceed the authorized number.

Append every result line to `runs/YYYY-MM-DD-connect-<n>/results.jsonl` right after each call, before starting the next chunk.

### 5. Outcomes

| Outcome | Meaning | Action |
|---|---|---|
| `verified_send` | HTTP 200 with an `invitationUrn` | Counts toward the target |
| `already_connected` | 1st degree already | Skip |
| `already_pending` | Invitation already out | Skip, never resend |
| `cant_resend_yet` | LinkedIn cooldown | Skip this person for this run |
| `identity_mismatch` | Slug now resolves to someone else | Skip, surface to user |
| `skipped_unknown` | State couldn't be confirmed | Skip. Unknown is not permission to send. |
| `lookup_error` (403) | Bad or renamed slug | Try `people-search.js` with name + company, confirm identity by headline, then include in a later batch only if the user approves |
| `ambiguous_send` | Request may have landed without a receipt | Hard stop. Check with `check-profiles.js` before anything else. Never resend blindly. |
| `hard_stop` | 401/403/429 or session failure | Stop, report, wait for the user |

### 6. Report

Report: authorized target, attempted, verified sends, skips by reason, hard stop (if any), log path, and where to resume.

## Rules

- Blank invitations only. Notes via Voyager are untested.
- Never withdraw, message, or edit profiles from this skill.
- Never send in parallel or faster than every 3 seconds.
- Never resend to someone with `already_pending`, `cant_resend_yet`, or an ambiguous prior attempt.
