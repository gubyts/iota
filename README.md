# iota

> bridge a webpage from your computer to your phone via camera + OCR

Point your phone camera at the address bar on your work computer. iota reads the URL and opens it on your phone.

## Run locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (e.g. `http://localhost:5173`) on your phone over the same wifi network. Note: iOS Safari requires HTTPS for camera access **except** on `localhost`. To test on your phone, use one of the deploy options below.

## Deploy

### Vercel (recommended, ~2 min)

1. Push this folder to a GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new), import the repo, click Deploy.
3. Open the URL it gives you on your iPhone in Safari.
4. Tap "Allow" when Safari asks for camera permission.
5. (Optional) Tap the share button → "Add to Home Screen" so it feels like a native app.

### Netlify

```bash
npm install -g netlify-cli
npm run build
netlify deploy --prod --dir=dist
```

## How it works

- Tesseract.js runs OCR locally in the browser — no server, no data leaves your phone.
- The address bar's URL is extracted via regex from the OCR'd text.
- The first valid URL found triggers a 3-second redirect with cancel option.
- The URL is also auto-copied to your clipboard.

## iOS notes

- First scan downloads the OCR language file (~10MB). Subsequent scans are instant.
- Camera access requires HTTPS — won't work on plain `http://` URLs.
- If permission is denied: Settings → Safari → Camera → Allow, then reload.

## Tech

Vite + React + Tailwind + Tesseract.js + lucide-react
