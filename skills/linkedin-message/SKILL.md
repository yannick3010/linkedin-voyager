---
name: linkedin-message
description: "Read the LinkedIn inbox and send direct messages to 1st-degree connections through the Voyager API. Use when the user wants to check who has replied, see whether a thread already exists with someone, read a conversation, draft messages, or send approved messages (for example, a first message to newly accepted connections). Every message is drafted for the user's approval before it is sent."
---

# LinkedIn Message

Read threads and send direct messages. Messages are the user's voice: draft, show, and send only exactly what they approved.

Read [linkedin-voyager](../linkedin-voyager/SKILL.md) first for session setup, snippet usage, and hard stops.

## Reading

1. Run `me.js` and keep `profileUrn`.
2. Run `inbox.js` with `myProfileUrn` set. To check specific people, first resolve their slugs to profile URNs with `check-profiles.js` and pass them as `profileUrns`. Use `sinceDays` to bound the walk. For recently connected people, a thread can't predate the connection, so 180 days is plenty.
3. Each thread reports `lastMessageFrom`:
   - `me`: you messaged and they haven't replied
   - `them`: they replied (or started it) and it's your turn
4. Use `read-conversation.js` for the full history of a thread.

If `inbox.js` stops on `page_limit`, say so. Don't present a partial walk as complete. If it returns `http_400`, see the queryId and parenthesis-encoding notes in [`docs/voyager-api.md`](../../docs/voyager-api.md) Endpoint 9.

## Sending

1. **Check for an existing thread** with `inbox.js` before a first message, so you don't open a duplicate conversation with someone already talking to the user.
2. **Draft** each message and show the user every recipient with the exact text. Personalize from real context (their profile via Endpoint 2, the thread history) when the user wants that.
3. **Wait for explicit approval** of the exact recipients and text. Edits mean a new draft to approve.
4. **Send** with `send-message.js`, one recipient per call, a few seconds apart. The snippet re-verifies 1st-degree status and refuses otherwise.
5. **Log** each result to `runs/YYYY-MM-DD-messages/results.jsonl` (recipient, outcome, timestamp, message URN; store the text only if the user wants it kept).
6. **Report** sent, failed, and skipped with reasons.

## Rules

- Never send text the user hasn't approved verbatim, and never "fix" an approved message silently.
- 1st-degree connections only. For others, the path is a connection request first (linkedin-connect).
- Stop on any hard stop listed in linkedin-voyager.
- No mass messaging. Keep batches small and human-paced.
