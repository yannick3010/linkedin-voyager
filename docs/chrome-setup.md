# Chrome setup

The skills drive a real Chrome window, signed in to your LinkedIn account, through the [chrome-devtools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp). Use a dedicated Chrome profile for this so automation never touches your everyday browsing.

## 1. Start a dedicated Chrome with remote debugging

Chrome won't expose remote debugging on your default profile, so give it its own profile directory.

macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-linkedin-automation"
```

Windows (PowerShell):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.chrome-linkedin-automation"
```

Linux:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-linkedin-automation"
```

Leave this window running while you use the skills. Minimizing it is fine.

## 2. Sign in to LinkedIn

In that window, go to https://www.linkedin.com/ and sign in. The profile directory keeps the session, so you only do this once (until LinkedIn logs you out).

## 3. Check the connection

`http://127.0.0.1:9222/json/version` should return JSON in any browser. The repo's `.mcp.json` points the chrome-devtools MCP at that address. When you open Claude Code in this repo it will ask to enable the project MCP server. Approve it.

If Chrome shows an **"Allow remote debugging?"** prompt, click Allow in that dedicated window.

## Troubleshooting

| Symptom | Fix |
|---|---|
| MCP tools time out on `list_pages` | Chrome isn't running with `--remote-debugging-port=9222`, or another Chrome instance grabbed the profile. Quit all Chrome windows using that profile and relaunch with the command above. |
| `me.js` returns `not_logged_in_or_wrong_tab` | Sign in to LinkedIn in the dedicated window, or make sure the selected tab is on `www.linkedin.com`. |
| Every lookup fails | Usually the wrong tab is selected. Run `me.js` again before assuming a block. |
| Login page, CAPTCHA, or "unusual activity" | Stop. Resolve it by hand in the browser and wait before running anything else. |

Port 9222 gives full control of that browser to anything running on your machine. Only run it on a machine you trust, and don't expose the port to your network.
