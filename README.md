# ApplyOS

ApplyOS is a **local-first Chrome extension for selective, honest job applications.**

It builds an Experience Profile from your real CV, scans job listings and application
forms, scores how well you fit, reuses answers you have written before, and fills **only
the values you explicitly approve.**

ApplyOS never:

- invents experience, metrics, employers, or skills you do not have,
- auto-submits an application or clicks **Apply** for you,
- chooses a random dropdown value to get past a required field,
- uploads files programmatically, or
- sends anything to a server unless **you** turn on the optional OpenRouter AI and trigger it.

There is no backend and no telemetry. Everything lives in your browser's local database
until you export or delete it.

---

## Table of contents

- [How it works in one paragraph](#how-it-works-in-one-paragraph)
- [Requirements](#requirements)
- [Install and build](#install-and-build)
- [Load in Chrome](#load-in-chrome)
- [Key concepts](#key-concepts)
- [The side panel tabs](#the-side-panel-tabs)
- [First-time setup](#first-time-setup)
- [Applying to a job, step by step](#applying-to-a-job-step-by-step)
- [The Job URL Queue](#the-job-url-queue)
- [Optional AI (OpenRouter)](#optional-ai-openrouter)
- [Settings reference](#settings-reference)
- [Privacy and your data](#privacy-and-your-data)
- [Permissions, and why each is needed](#permissions-and-why-each-is-needed)
- [Supported sites](#supported-sites)
- [What is filled automatically vs. sent to Manual Review](#what-is-filled-automatically-vs-sent-to-manual-review)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Limitations and honest caveats](#limitations-and-honest-caveats)

---

## How it works in one paragraph

You paste or upload your CV once. ApplyOS turns it into a structured **Experience
Profile** and a searchable **Answer Bank**. When you open a job page and click **Scan
Page**, a content script reads the form fields and (where possible) the job description,
classifies each field, and scores your fit locally. Profile values (name, email, links)
and high-confidence saved answers can be inserted into the page after you review them.
Sensitive, legal, file-upload, and unclear fields are deliberately routed to **Manual
Review** instead of being filled. If you opt in to AI, ApplyOS can draft answers to
free-text questions using **only** your documented experience, then save them for reuse.

---

## Requirements

- **Node.js 18 or newer**
- **Google Chrome** (or a Chromium browser) with side panel support
- Optional: an **[OpenRouter](https://openrouter.ai/) API key** if you want AI features.
  ApplyOS works fully without it.

---

## Install and build

```bash
npm install      # install dependencies
npm run build    # type-check and build the unpacked extension into dist/
```

`npm run build` runs `tsc --noEmit` (strict type-check) followed by `vite build`. The
production extension is written to `dist/`.

For previewing **side panel UI only** (no page scanning or extension messaging):

```bash
npm run dev
```

> Page scanning, autofill, and Chrome messaging require the built unpacked extension —
> the dev server cannot exercise them.

---

## Load in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the `dist/` directory.
5. Open a normal `http://` or `https://` job page.
6. Click the **ApplyOS** toolbar icon to open the side panel.
7. If the page was already open before you loaded the extension, **refresh it once** so the
   content script can attach.

After any code change, run `npm run build` again and click the extension's **reload**
button on `chrome://extensions`.

---

## Key concepts

| Term | What it is |
| --- | --- |
| **Experience Profile** | A structured, editable JSON view of your CV (roles, skills, projects, education, links). Used for local fit scoring and as factual grounding for AI answers. |
| **Experience Database** | An optional merged markdown document built from several CV variants. When enabled, it is the grounding source for AI answers instead of the structured profile. |
| **CV Library** | The set of CV files you import. Each gets a short summary so AI can recommend which one to upload for a given role. |
| **Answer Bank** | Your locally saved answers to application questions (screening, free-text, etc.), searched with Fuse.js and reused on future forms. |
| **Detected Fields** | The form fields ApplyOS found on the current page, each with a category, a suggested value, and a fill/review state. |
| **Adapter** | Site-specific logic that knows how a given ATS (Greenhouse, Ashby, Workday, LinkedIn Easy Apply, …) structures its forms and job descriptions. |
| **Job Queue** | A local list of job/careers URLs you paste in and review one at a time. ApplyOS never reads your open tabs automatically. |
| **Manual Review** | The state for fields ApplyOS refuses to autofill (sensitive, legal, file, or unclear), so you decide them yourself. |

---

## The side panel tabs

ApplyOS has seven tabs, shown down the side of the panel:

1. **Detected Fields** — the main working tab. Shows the page classification, extracted
   job info, your fit score, and every detected field. From here you **Scan Page**,
   **Extract Job Info**, insert values, generate AI answers, and save answers.
2. **Job Queue** — paste many URLs, deduplicate them, classify the platform, and review
   them one by one. Export to JSON/CSV.
3. **Answer Bank** — browse, search, edit, and delete your saved answers. Clean up
   duplicates.
4. **Experience** — paste or upload your CV(s), parse them into your Experience Profile,
   manage your CV Library, and (optionally) build the merged Experience Database.
5. **Profile** — the structured contact and identity values used for safe autofill
   (name, email, phone, country, links, etc.). Fully editable.
6. **Jobs** — your local job tracker and scan history.
7. **Settings** — AI configuration, prompts, autofill behavior, the queue, and local-data
   import/export.

---

## First-time setup

1. Open the **Experience** tab.
2. Paste your CV text, or upload a **TXT, PDF, or DOCX** file.
3. Click **Parse Experience Profile**. ApplyOS parses it **locally** by default. (If you
   have enabled AI and turned off Local-only mode, you can use OpenRouter parsing instead.)
4. Review and edit the structured profile. Your raw CV text remains searchable locally.
5. Open the **Profile** tab and confirm your contact details and links. These are the only
   values ApplyOS will autofill without an explicit answer match.
6. (Optional) Open **Settings** and add your job search context, configure AI, and adjust
   autofill toggles. See [Settings reference](#settings-reference).

---

## Applying to a job, step by step

1. Open a job listing, careers page, or application form in a normal tab.
2. Open ApplyOS and, on the **Detected Fields** tab, click **Scan Page**.
3. Review the page classification, extracted job, fit score, and detected fields.
4. If the page is only a listing with an **Apply** button, click **Extract Job Info** to
   capture the description, then click **Apply** yourself, and **Scan Page** again on the
   form. (On **LinkedIn**, open the **Easy Apply** modal first, then scan.)
5. Insert saved profile values or Answer Bank answers **after reviewing them**. With
   *Auto-insert fields on scan* enabled (default), safe profile values and high-confidence
   matches are filled right after the scan.
6. For free-text questions, either type your own answer or — if AI is enabled — click
   **Generate All Answers** to draft them from your documented experience.
7. Use **Save Current Answer** to add an answer you wrote on the page to your Answer Bank
   for next time.
8. Fill any **Manual Review** fields yourself (sensitive/legal/file/unclear).
9. Submit the application yourself. ApplyOS never clicks Submit.
10. Save the job to your local tracker in the **Jobs** tab if it is worth pursuing.

> **Dynamic forms:** enable dynamic-field watching to have ApplyOS notice fields that
> appear after Ajax/React re-renders for up to 15 seconds, and re-key your generated
> answers to the new fields automatically.

---

## The Job URL Queue

The **Job Queue** tab lets you paste many job or careers URLs and review them one at a
time. ApplyOS does not read your open Chrome tabs automatically.

To copy all your Chrome tab URLs on macOS:

```bash
osascript -e 'tell application "Google Chrome" to get URL of tabs of windows' | tr ',' '\n' | sed 's/^ *//' | pbcopy
```

Then:

1. Open **Job Queue**.
2. Paste into **Paste job URLs** and click **Import URLs**. ApplyOS extracts valid
   HTTP/HTTPS URLs, removes duplicates, strips common tracking parameters, and classifies
   known ATS and custom careers URLs.
3. Click **Start Review** to open the first new or manual-review URL (open behavior is
   configurable in Settings).
4. Wait for the page to load, then click **Scan Page**. ApplyOS never silently scans
   queued URLs.

---

## Optional AI (OpenRouter)

**AI is optional, disabled by default, and always user-triggered.** Out of the box,
*Local-only mode* is **on**, so ApplyOS makes no network calls at all.

To enable AI:

1. Open **Settings**.
2. Turn **Local-only mode OFF**.
3. Paste your **OpenRouter API key** (stored locally; there are no hardcoded secrets).
4. Pick an **OpenRouter model** (default: Gemini 2.0 Flash Lite — fast and cheap), or enter
   a custom `provider/model` ID.
5. Click **Save Settings**.

ApplyOS calls OpenRouter's `chat/completions` endpoint with `temperature: 0` and JSON
output. Each AI feature sends a **specific, minimal payload** — and you can preview it
first with *Show data before sending*.

**👉 The full list of AI features, exactly what data each one sends, and every editable
prompt is documented in [docs/AI.md](docs/AI.md). Read that before turning AI on.**

In short, ApplyOS uses AI for: parsing a CV into a profile, summarizing CVs, recommending
which CV to upload, re-extracting job requirements, drafting answers to free-text questions
(grounded strictly in your documented experience, then "de-AI-ified" to sound human), and
matching questions to your saved Answer Bank. The answer-writing and "de-AI-ify" prompts —
plus several others — are **fully editable** in **Settings → AI prompts**.

---

## Settings reference

All settings are local and persisted in your browser. Defaults are shown in **bold**.

### AI and OpenRouter

| Setting | Default | What it does |
| --- | --- | --- |
| Local-only mode | **On** | Keeps all data on device. Must be **off** for any OpenRouter call. |
| OpenRouter API key | empty | Your key, stored locally. Required for AI. |
| OpenRouter model | **Gemini 2.0 Flash Lite** | Preset list (Google, OpenAI, Anthropic, DeepSeek, Meta, Mistral) or a custom model ID. |
| Smart Match enabled | **Off** | Lets AI **select** the best saved Answer Bank entry for a question. It classifies and picks only — it never writes a new answer. |
| Auto-generate from Experience Profile | **Off** | Allows answer generation grounded in the structured profile. |
| Use optimized multi-CV database for answers | **On** | Sends the merged markdown Experience Database (plus the humanizer prompt) instead of the structured profile JSON when generating answers. |
| Auto-generate AI answers on scan | **On** | When AI is enabled, drafts answers to custom questions in one batch after each scan, and saves them to the Answer Bank. (No effect while Local-only mode is on.) |
| Job search context | sample text | Free text about why you are looking and what you want. Used for open-ended questions like "Why are you looking for a change?" |
| Show data before sending | **On** | Preview the exact payload before any AI call. |
| Allow raw CV for extraction | **Off** | Permits sending raw CV text for extraction features. |

### Autofill and saving

| Setting | Default | What it does |
| --- | --- | --- |
| Auto-insert fields on scan | **On** | After scanning, fills safe profile fields and high-confidence Answer Bank matches into the page. |
| Auto-save new screening answers | **On** | Saves reusable screening and application answers as you complete a page. Sensitive self-identification answers are excluded. |
| Auto-save sensitive self-identification answers | **Off** | Explicitly allows demographic, disability, veteran, age, pronoun, and voluntary-disclosure answers to be stored locally. |
| Job fit threshold | **70%** | The fit score above which a role is treated as a good match. |

### Job Queue

| Setting | Default | What it does |
| --- | --- | --- |
| Queue open behavior | **Open in current tab** | Where user-triggered Open / Start Review / Next / Previous open a URL. |
| Auto-scan after opening (prompt only) | **Off** | Prompts you to scan after opening a queued URL. It never scans silently. |
| Queue dev mode: allow localhost URLs | **Off** | Lets `localhost` URLs into the queue for local development. |

### Local data

- **Export All** — download a JSON backup (settings, profile, answers, jobs,
  queue, scan history). The OpenRouter API key is deliberately omitted.
- **Import All** — restore from a backup. This replaces the matching local tables.
- **Clear Local Data** — wipe everything on this device (irreversible).

---

## Privacy and your data

- **No backend, no telemetry, no accounts.** ApplyOS has no server of its own.
- All CV text, profiles, answers, jobs, queued URLs, and scan history live in your
  browser's local IndexedDB (via Dexie).
- The **only** outbound network requests are to **OpenRouter**, and only when **you** have
  turned off Local-only mode, added a key, and triggered an AI action.
- Your OpenRouter API key is stored locally, never embedded in the build, and omitted from exports.
- Use **Settings → Export All** to back up and **Clear Local Data** to erase everything.

For the full data model, the exact payload of every AI request, and what is and is not
sent, see **[docs/PRIVACY.md](docs/PRIVACY.md)** and **[docs/AI.md](docs/AI.md)**.

---

## Permissions, and why each is needed

ApplyOS requests only what it needs to scan the page you are on and show its side panel:

| Permission | Why |
| --- | --- |
| `storage` | Persist your settings locally. |
| `scripting` | Inject the content script into the active tab/frames so forms can be read and filled. |
| `sidePanel` | Show the ApplyOS UI in Chrome's side panel. |
| `tabs` | Know the active tab so the panel acts on the page you are viewing. |
| `webNavigation` | Re-attach the content script to embedded application iframes after they finish loading. |
| `host_permissions: http/https` | Job applications live on many domains; the content script reads the form on whatever job page you open. It runs only to detect and fill fields you approve. |

---

## Supported sites

Dedicated adapters: **Ashby, Greenhouse, Lever, Workable, Workday, SmartRecruiters,
BambooHR, Recruitee, Teamtailor, iCIMS, Gem, and LinkedIn Easy Apply.** Company-owned
careers pages (`/careers`, `/jobs`, `/apply`, …) are handled by a custom-careers adapter,
and anything else falls back to a generic adapter. Embedded ATS iframes are scanned too.

---

## What is filled automatically vs. sent to Manual Review

**Safely autofilled** (after your review, from your Profile or a confident Answer Bank
match): first/last/full name, email, phone, country, state, city, and profile links
(LinkedIn, GitHub, portfolio, website).

**Always routed to Manual Review — never auto-filled:**

- **Sensitive/voluntary** fields: gender, pronouns, race/ethnicity, disability, veteran
  status, age, and legal-authorization disclosures.
- **File uploads**: resume, cover letter, and other attachments (you upload these
  yourself).
- **Disabled or unclear** fields, and any dropdown where no confident option matches.

When AI has no relevant documented experience for a free-text question, it returns the
explicit sentinel **`NO_FIT`** (confidence 0) instead of inventing an answer, and that
field is left for you.

---

## Troubleshooting

- **"No application fields were found."** The page may be a listing, not a form. Use
  **Extract Job Info**, click **Apply** yourself, then **Scan Page** again. On LinkedIn,
  open the **Easy Apply** modal first.
- **The panel can't reach the page.** Refresh the tab once so the content script attaches,
  then scan again. Newly loaded extensions do not attach to already-open tabs.
- **AI does nothing.** Confirm Local-only mode is **off**, your OpenRouter key is set, and
  the model ID is valid. Errors surface in the panel notice.
- **Fields appear twice or stale.** Re-scan. ApplyOS de-duplicates detections and re-keys
  generated answers when a dynamic form re-renders.
- **A React/ATS field looks filled but submits empty.** ApplyOS commits values through the
  framework's own input handling; if a strict site blocks that, type the value yourself and
  use **Save Current Answer** so it is reused next time.

---

## Development

```bash
npm install
npm run dev      # side panel UI preview only
npm run build    # tsc --noEmit && vite build -> dist/
```

There is no test runner; `npm run build` (strict type-check + bundle) is the verification
gate. Behavioral changes to content scripts must be tested by loading `dist/` in Chrome on
a real job page.

High-level layout under `src/`:

| Folder | Responsibility |
| --- | --- |
| `adapters/` | Per-ATS job/field extraction and adapter selection. |
| `content/` | Content scripts: field detection, classification, and safe insertion. |
| `ai/` | OpenRouter requests and prompt assembly. |
| `matching/`, `scoring/` | Local answer matching and job-fit scoring. |
| `sidepanel/` | The React side panel UI and its tabs. |
| `shared/` | Types, constants, and cross-context utilities. |
| `db/` | Local IndexedDB (Dexie) schema and caches. |
| `background/` | Service worker: injection and message relay. |

---

## Limitations and honest caveats

- ApplyOS detects and fills forms with heuristics. It will miss fields on unusual layouts
  and occasionally mis-classify one. Always review before submitting.
- Local fit scoring is a keyword/seniority heuristic, not a judgment of your candidacy.
- AI answers are only as good as your documented experience and the model you choose; they
  are grounded in your CV but should still be read before use.
- ApplyOS deliberately does the last mile manually: you click Apply, you upload files, you
  decide sensitive fields, and you submit.
