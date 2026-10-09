# JARVIS Browser Assistant

A mobile-friendly, single-page JARVIS UI with Gemini chat, OpenRouter, Tavily web search, voice input where supported, and local tasks, notes, and a timer. The visual design is intentionally kept simple; this revision adds an access-code gate and stricter API request handling.

## Before deploying

1. Keep this repository **private** while you configure and test it.
2. Create a long, unique access token (at least 32 random characters; a password manager can generate one). Add it to Cloudflare Pages as the encrypted secret `JARVIS_ACCESS_TOKEN`.
3. Add whichever provider secrets you plan to use:
   - `GEMINI_API_KEY` — encrypted secret for Gemini.
   - `TAVILY_API_KEY` — encrypted secret for web search.
   - `OPENROUTER_API_KEY` — encrypted secret for OpenRouter.
4. Add these optional/non-secret variables when needed:
   - `GEMINI_MODEL` — optional; defaults to `gemini-2.5-flash`.
   - `OPENROUTER_MODEL` — required if you want to use OpenRouter.
5. In Cloudflare, create a Pages project connected to the Git repository. Project root is `/`; this plain HTML project does not need a build command. Keep the `functions/` directory at the repository root so Pages deploys the API routes.
6. Under **Settings → Variables and Secrets**, create secrets/variables for the production environment (and preview environment only if you intend to use it there), then redeploy.
7. Open the deployed site over HTTPS. Enter the same `JARVIS_ACCESS_TOKEN` in the Access code field and tap **Unlock**. The browser keeps it in `sessionStorage` for the current tab session; it is not written into the source code or local storage. Tap **Lock** to clear it from that tab.

## Local development

Use Cloudflare's Pages local development tooling, with local secrets in `.dev.vars` (never commit this file). Start from `.dev.vars.example` and fill it only on your own machine:

```sh
npx wrangler pages dev .
```

If you use the dashboard-only workflow, you do not need a local secrets file.

## Security notes

- Never commit real API keys or the access token to HTML, GitHub, or this chat. Put them in Cloudflare's encrypted Secrets settings.
- The access-code gate protects the AI and search routes from casual anonymous use. Anyone who obtains the access token can use those routes, so do not share the token publicly.
- The included per-isolate rate limits are a best-effort safeguard, not a reliable quota or abuse boundary. For a publicly accessible deployment, add a Cloudflare edge rate-limiting rule and monitor provider usage. An access code and an in-memory limit cannot guarantee that API usage stays within a budget.
- Tasks and notes are stored in that browser's `localStorage`; they are not synced across devices. The timer runs only while the page remains open and active enough for browser timers to run.
- Voice input depends on browser support and permission.
- The provider integration has been checked locally with mocked responses; it has not been live-tested against your actual Cloudflare project or API accounts.

## API routes

- `GET /api/health` — requires the access token; reports whether provider secrets are configured.
- `POST /api/chat` — requires the access token; accepts recent chat messages and optional search context.
- `POST /api/search` — requires the access token; accepts a query and returns sanitized HTTP(S) result URLs.

This project uses Cloudflare Pages Functions. No real API secrets belong in the repository.
