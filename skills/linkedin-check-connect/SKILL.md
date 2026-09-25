---
name: linkedin-check-connect
description: "Check whether people you sent LinkedIn connection requests to have accepted, are still pending, or dropped off, using the bulk sent-invitations inventory plus per-profile verification through the Voyager API. Read-only. Use when the user asks who accepted, wants a status check on a list or a previous connect run, or wants to see all outstanding invitations. Can also list or (with explicit approval) withdraw stale invitations."
---

# LinkedIn Check Connect

Find out the current state of connection requests. Read-only unless the user explicitly asks to withdraw.

Read [linkedin-voyager](../linkedin-voyager/SKILL.md) first for session setup, snippet usage, and hard stops.

## Input

Any of:
- a previous run folder (`runs/<run>/results.jsonl`, using its `verified_send` rows)
- a list of URLs/slugs from the user
- nothing: report the full outstanding-invitation inventory

## Workflow

1. **Session check** with `me.js`.
2. **Pull the full inventory** with `sent-invitations.js`. Require `complete: true`. If it's incomplete, fall back to step 4 for everyone.
3. **Match.** A person whose slug or stored `invitationUrn` appears in the inventory is **still pending**. No further call is needed.
4. **Verify the rest** with `check-profiles.js` (chunks of ~40). Absence from the inventory does not prove acceptance. They may have declined, or the invite may have been withdrawn or expired.
   - `connected`: **accepted**
   - `outbound_pending`: **still pending** (inventory can lag or the slug changed)
   - `not_connected`: **no longer pending** (declined, ignored and expired, or withdrawn). LinkedIn does not say which.
   - `unknown` / `lookup_error`: **unresolved**. Report it and don't guess. For 403s, try `people-search.js` recovery.
5. **Save** results to `runs/YYYY-MM-DD-check/results.jsonl`.
6. **Report** counts for accepted / pending / no longer pending / unresolved, with names and profile URLs for the accepted list. If the user ran connect earlier, compare against those send dates.

Don't diff two inventory snapshots to detect acceptances. Someone who was invited and accepted between checks appears in neither. Always check against the list of people you actually invited.

## Withdrawing stale invitations

Only when the user explicitly asks. Withdrawing puts each person in LinkedIn's weeks-to-months resend cooldown.

1. From the inventory, build the exact list (e.g. `sentTimeLabel` of 3+ weeks) and show it to the user with the count.
2. After a clear yes for that list, run `withdraw-invitations.js` in chunks of up to 50.
3. Log results and report successes and failures.
