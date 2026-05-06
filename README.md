# iota

> bridge a webpage from your computer to your phone via camera + OCR

Point your phone camera at the address bar on your work computer. iota reads the URL via Google Cloud Vision, scores the candidates against a curated dictionary of well-known domains, and opens the page on your phone.

## How it works

- **Camera capture** — rear camera streams at 2560×1440, with continuous autofocus and tap-to-focus. A horizontal band at the middle of the frame is cropped to the address-bar region.
- **Sharpness gate** — a fast Laplacian-variance check skips obviously blurry frames so we don't burn API calls on them. After three skipped frames in a row we force a recognition pass anyway, so a borderline-soft stream still produces reads.
- **OCR** — the cropped frame is JPEG-encoded and POSTed to `/api/ocr`, a Vercel serverless function that proxies to Google Cloud Vision. The function is the only thing that holds the API key.
- **URL extraction** — Vision's text comes back through a permissive URL regex. Each candidate is scored on heuristics (lowercase host, common TLD, path presence) and against a curated list of ~700 popular domains; near-misses (favicon-glyph fusion, OCR letter swaps) are corrected via bounded Damerau-Levenshtein. Subdomains are preserved when their apex is in the dictionary.
- **Confidence locking** — high-score candidates lock immediately; lower-score reads need three frames in agreement. A 4-second budget extends to 6 if nothing plausible has been seen, otherwise the UI shows a graceful "hold steadier" prompt rather than redirecting to a junk URL.
- **Hand-off** — the URL is auto-copied to the clipboard, then a 3-second redirect kicks in. Native iOS/Android share sheet is wired up for AirDrop / share-to-iMessage / etc.

## Deploy

This app is built around Vercel: the `/api/ocr` serverless function is the OCR backend.

1. Push this repo to GitHub.
2. **Google Cloud Console** → enable the [Cloud Vision API](https://console.cloud.google.com/apis/library/vision.googleapis.com) on a project.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy the key. *Restrict the key to the Cloud Vision API* so a leak can only burn Vision quota.
4. **Vercel** → import the repo → deploy.
5. **Vercel project Settings → Environment Variables** → add the variables below for both **Production** and **Preview** (and **Development** if you'll run `vercel dev` locally).
6. Trigger a redeploy so the env vars land in the runtime.
7. Open the deployed URL on your phone in Safari, allow camera access, and (optional) Share → Add to Home Screen for a native-feeling PWA.

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VISION_API_KEY` | yes | — | Google Cloud API key with Vision API enabled. |
| `ALLOWED_ORIGINS` | no | (none = allow all) | Comma-separated origins permitted to call `/api/ocr`. Set this to your deploy URL(s) to block direct API abuse. Example: `https://iota.example.com,https://iota-preview.vercel.app` |
| `RATE_LIMIT_PER_MINUTE` | no | `120` | Per-IP cap on `/api/ocr` calls. In-memory, per-instance — defence in depth, not a strict global cap. |
| `MAX_IMAGE_BYTES` | no | `1500000` | Hard cap on the base64 image size. Real cropped frames are <200 KB; this exists to reject obvious abuse. |

### Cost expectations

Google Cloud Vision: **first 1000 calls/month free**, then ~$1.50 per 1000 (TEXT_DETECTION). A normal scan that locks in on the first frame is ~1 call; a scan that runs the full 4 s budget is ~6 calls. Casual personal use is comfortably inside the free tier.

If you want a hard cap on spend regardless of abuse, set a [Cloud Billing budget alert](https://console.cloud.google.com/billing/budgets) — Google will email you and (optionally) shut off the API project when you cross a threshold.

## Run locally

```bash
npm install
npm run dev
```

Caveat: `vite dev` does **not** serve `/api/*` routes, so OCR won't work in pure dev. Two options:

1. **Recommended**: develop UI changes against `vite dev`, then push to a branch and test OCR on the Vercel preview URL from your phone.
2. **Or**: install the Vercel CLI, run `vercel link` once, then `vercel dev` — that serves both the Vite frontend and the `/api/*` functions, reading env vars from your linked project.

## iOS notes

- Camera access requires HTTPS — won't work on plain `http://` URLs (except `localhost`).
- If permission is denied: Settings → Safari → Camera → Allow, then reload.
- iOS auto-switches to the macro lens when you get very close (~10 cm) — the resulting frames have smaller per-character pixel counts and OCR struggles. Hold the phone ~15–20 cm from the screen.

## Logs and troubleshooting

Every request to `/api/ocr` emits a single `[ocr]`-prefixed log line in Vercel. Tail with:

```bash
vercel logs <deploy-url> --follow
```

Or filter by `[ocr]` in the dashboard. Successful requests log `vision_ms`, `total_ms`, text length, and a 60-char preview of what Vision read. Rate-limited or rejected requests log the reason. Image content and the API key are never logged.

The frontend surfaces the most recent diagnostic in the "hold steadier" panel — API errors, "no text from vision", or the first 80 chars of what Vision actually saw — so most debugging can be done from the phone without opening the Vercel dashboard.

## Tech

Vite + React + Tailwind + lucide-react + Google Cloud Vision (via Vercel serverless).
