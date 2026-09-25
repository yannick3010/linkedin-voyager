# LinkedIn Voyager kit

Agent skills for running LinkedIn from Claude Code (or any agent that reads `AGENTS.md` and skills). Send connection requests, check who accepted, read your inbox, and send messages, all through LinkedIn's internal Voyager API instead of clicking through the UI.

It works by running small JavaScript functions inside a Chrome tab where you're signed in to LinkedIn. LinkedIn sees normal requests from your own session. No API keys, no third-party service.

## What's in here

```
AGENTS.md / CLAUDE.md     Entry point the agent reads first
.mcp.json                 Connects the chrome-devtools MCP (as `linkedin-chrome`) to your Chrome
scripts/doctor.mjs        Setup check: finds and explains whatever is misconfigured
skills/
  linkedin-voyager/       Foundation: session check, snippets, limits, hard stops
  linkedin-connect/       Send blank connection requests to a list
  linkedin-check-connect/ Who accepted, who's pending, withdraw stale invites
  linkedin-message/       Read inbox, draft + send DMs (with approval)
snippets/                 Ready-to-run browser functions for each Voyager call
docs/voyager-api.md       Full endpoint reference, response shapes, gotchas
docs/chrome-setup.md      One-time browser setup
examples/targets.csv      Input format for a list of people
runs/                     Local logs of each run (gitignored)
```

## Setup (about 5 minutes)

Requirements: Claude Code, Node.js 18+ (for `npx`), Google Chrome.

1. Clone this repo.
2. Start a dedicated Chrome with remote debugging and sign in to LinkedIn. See [docs/chrome-setup.md](docs/chrome-setup.md).
3. Run the setup check and fix anything it flags:
   ```bash
   node scripts/doctor.mjs
   ```
4. Open Claude Code in the repo folder and approve the `linkedin-chrome` MCP server when prompted.
5. Ask: *"Check my LinkedIn session."* It should reply with your name.

## Things to ask

- "Who's in this list and am I connected to them?" (paste URLs or point at a CSV)
- "Send connection requests to the first 15 people in `examples/targets.csv`."
- "Did anyone from last week's connect run accept?"
- "List my pending invitations older than a month." Then optionally: "Withdraw those."
- "Who has replied to me in the last 30 days?"
- "Draft a short first message to everyone who accepted this week." You approve, then it sends.
- "Find the VP of Operations at Example Co."

## How it keeps your account safe

- Nothing is sent, messaged, or withdrawn without your explicit OK for that specific batch.
- Every invitation re-checks the person's current relationship state right before sending, and only sends when LinkedIn confirms there's no existing invite.
- At most 20 invitations per batch, at least 3 seconds apart. Reads are throttled too.
- Any rate limit, login wall, CAPTCHA, wrong account, or unclear result stops the run.
- Cookies and tokens never leave the browser tab and are never written to disk.

## Plugging in your own tools

The skills stop at LinkedIn. Each run writes one JSON line per person to `runs/<date>-<name>/results.jsonl` with fields like `slug`, `name`, `profileUrn`, `outcome`, and `invitationUrn`. To sync with a CRM, sheet, or Slack, add a step (or your own skill) that reads those logs. Keep the LinkedIn skills as they are.

## Caveats

- **Voyager is unofficial.** It's the private API LinkedIn's own website uses. It can change without notice, and automating it goes against LinkedIn's User Agreement. Accounts that push volume get restricted. Keep volumes human-like, which is what the default limits are for.
- **Endpoints drift.** When something breaks, the agent is instructed to inspect the live response, fix the snippet, and note the change in `docs/voyager-api.md`. Messaging and search `queryId`s rotate most often.
- **Connection notes aren't supported.** Invitations are blank. Notes via the API are untested.
- The weekly invitation ceiling (roughly 100 to 200) is LinkedIn's and can't be read ahead of time.
