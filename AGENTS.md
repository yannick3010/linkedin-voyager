# LinkedIn Voyager kit: agent entry point

This repo lets an agent operate LinkedIn through Voyager, LinkedIn's internal web API, from inside a signed-in Chrome tab via the chrome-devtools MCP. It is a building block. It has no CRM, scheduler, or notification integrations. Results are written to local JSONL run logs under `runs/`.

## Task routing

| Task | Skill |
|---|---|
| Session setup, lookups, search, enrichment, Sales Navigator resolution, broken endpoints | [`skills/linkedin-voyager`](skills/linkedin-voyager/SKILL.md) (read first for every LinkedIn task) |
| Send connection requests | [`skills/linkedin-connect`](skills/linkedin-connect/SKILL.md) |
| Check who accepted, list or withdraw pending invitations | [`skills/linkedin-check-connect`](skills/linkedin-check-connect/SKILL.md) |
| Read the inbox, draft and send direct messages | [`skills/linkedin-message`](skills/linkedin-message/SKILL.md) |

Reference: [`docs/voyager-api.md`](docs/voyager-api.md) (endpoints, response shapes, gotchas). Runnable calls: [`snippets/`](snippets/). Browser setup: [`docs/chrome-setup.md`](docs/chrome-setup.md).

## Non-negotiables

- Sending invitations, sending messages, and withdrawing invitations each need the user's explicit approval in the current conversation for that exact batch. Preparing a list is not approval.
- Stop on 429, 401, login/CAPTCHA/checkpoint pages, the wrong signed-in account, or an ambiguous send. Report, don't retry.
- At least 3 s between invitations, at most 20 per batch, never parallel.
- Never output or store cookies, CSRF tokens, request headers, or the DevTools WebSocket URL.
- Use only the chrome-devtools MCP `evaluate_script` path. Don't build a separate CDP client or daemon; those have proven fragile (session drops, repeated re-authorization).
- If the chrome-devtools MCP isn't connected, point the user to `docs/chrome-setup.md` instead of trying to control a browser another way.
