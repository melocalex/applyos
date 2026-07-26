# Privacy and data model

ApplyOS is local-first. This document describes where your data lives, what leaves your
machine, and how to control it.

---

## The short version

- **No backend. No telemetry. No accounts.** ApplyOS has no server.
- Everything you give it stays in your browser's local **IndexedDB** (via Dexie).
- The **only** outbound requests are to **OpenRouter**, and only when you have turned off
  *Local-only mode*, set an API key, and triggered an AI action.
- You can export a backup (excluding your API key) or wipe everything at any time from
  **Settings → Local data**.

---

## What is stored locally

All of the following live in IndexedDB on the device, scoped to the extension:

- **Settings** — including your OpenRouter API key, model choice, toggles, job search
  context, and any prompt overrides.
- **Experience Profile** — the structured CV data and your raw CV text.
- **Experience Database** — the optional merged markdown built from multiple CVs.
- **CV Library** — imported CV files and their summaries.
- **Answer Bank** — every answer you save or that AI generates.
  Sensitive self-identification answers are not auto-saved unless you separately opt in.
- **Jobs** — your tracker entries.
- **Job Queue** — the URLs you have imported and their review status.
- **Scan history** — a record of pages you scanned (URL, platform, field count, title,
  timestamp).
- **Job listing cache** — extracted job info, to avoid re-extracting the same listing.

Nothing here is uploaded. The `data/` folder in the repo is gitignored and is only a
convenience place for local CV files during development.

---

## What leaves your machine

**With Local-only mode ON (default): nothing.** Page scanning, field detection, fit
scoring, and Answer Bank matching all run locally in the content script and side panel.

**With Local-only mode OFF and AI triggered:** only the specific payload for that AI feature
is sent to OpenRouter. See [docs/AI.md](AI.md) for the exact contents of each request. In
summary, depending on the feature, that can include your CV text, CV summaries, the current
job's text, your job search context, the detected questions, and your saved answers — but
only for the action you triggered, and only to OpenRouter.

Your API key is sent only as the `Authorization` header to OpenRouter. It is never written
into the build and never sent anywhere else.

---

## Controlling your data

- **Show data before sending** (Settings) — preview the exact AI payload before any request.
- **Export All** (Settings → Local data) — download a JSON backup of every table except
  the OpenRouter API key. Import keeps the key already stored on the current device.
- **Import All** — restore from a backup; this replaces the matching local tables.
- **Clear Local Data** — permanently erase everything on this device. This cannot be undone.

---

## Network surface

| Destination | When | Why |
| --- | --- | --- |
| `openrouter.ai` | Only on a user-triggered AI action with Local-only mode off | The single AI provider |
| The job site you are on | When you scan | The content script reads the page you opened (it does not call out) |
| A separate listing URL | During a scan, only when ApplyOS resolves a listing URL different from the page you are on | Fetches that listing page's text (with the browser's existing cookies, like a normal navigation) to merge job requirements; the result is cached locally |

There is no analytics endpoint, no error-reporting service, and no first-party server.
