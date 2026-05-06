import React, { useState, useRef, useEffect, useCallback } from "react";
import { Camera, Link as LinkIcon, Check, AlertCircle, Zap, Share2 } from "lucide-react";
import { TOP_DOMAINS, correctDomain } from "./topDomains.js";

// iota — bridge a webpage from your computer to your phone via camera + OCR.
// Aesthetic: refined minimalism. Serif display + clean mono. Lots of breathing room.

// More forgiving URL regex — catches bare domains, www., http(s)://, with paths/queries.
// OCR output is messy, so we accept a wide net then sanitize.
const URL_REGEX = /\b((?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+(?:\/[^\s]*)?)\b/gi;

// Common TLDs we trust most — when scoring candidates, ones ending in these (or
// containing one followed by a slash) outrank random ones Tesseract hallucinated.
const COMMON_TLDS = [
  "com", "org", "net", "io", "co", "gov", "edu", "app", "dev", "ai", "uk", "us",
  "ca", "de", "fr", "jp", "au", "info", "biz", "me", "tv", "xyz", "site",
];

const COMMON_OCR_FIXES = [
  [/\s+/g, ""],          // strip stray spaces inside URL
  [/[,;]+$/g, ""],       // trailing punctuation
  [/^[.\-]+/g, ""],      // leading junk
];

function cleanUrl(raw) {
  let url = raw.trim();
  COMMON_OCR_FIXES.forEach(([pat, rep]) => { url = url.replace(pat, rep); });
  // ensure protocol so window.open / anchor href works
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const u = new URL(url);
    return u.toString();
  } catch {
    return null;
  }
}

// Score a URL candidate. Higher = more likely a real URL.
// Penalizes uppercase-leading domains (favicon smush), short hostnames, weird TLDs.
// Rewards lowercase, common TLDs, and the presence of a path (more signal).
// Big bonus when the host is in (or near) the curated top-domains dictionary —
// that's our strongest signal that an OCR read corresponds to a real site.
function scoreUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let score = 0;
    // host parts
    const parts = host.split(".");
    const tld = parts[parts.length - 1];
    if (COMMON_TLDS.includes(tld)) score += 3;
    if (host.length >= 6 && host.length <= 50) score += 1;
    // lowercase domains are normal; uppercase first letter on the un-lowered
    // hostname is a smoking gun for favicon-glyph fusion
    if (/^[a-z]/.test(u.hostname)) score += 2;
    if (/^[A-Z]/.test(u.hostname)) score -= 2;
    // mostly lowercase host
    const upperRatio = (u.hostname.match(/[A-Z]/g) || []).length / u.hostname.length;
    if (upperRatio < 0.1) score += 1;
    // having a path adds signal that this is a real navigated URL
    if (u.pathname && u.pathname.length > 1) score += 1;
    // dictionary hit: exact match is decisive, near-match is strong
    if (TOP_DOMAINS.has(host)) score += 5;
    return score;
  } catch { return -10; }
}

// Try to map a candidate URL onto a known domain. Returns the corrected URL
// string (with original path/query preserved) or null if nothing close enough.
function dictionaryCorrect(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (TOP_DOMAINS.has(host)) return null; // already exact, no rewrite needed
    const match = correctDomain(host);
    if (!match || match.dist === 0) return null;
    u.hostname = match.host;
    return u.toString();
  } catch { return null; }
}

function extractUrls(text) {
  const matches = text.match(URL_REGEX) || [];
  const candidates = new Set();
  const addWithCorrection = (raw) => {
    const c = cleanUrl(raw);
    if (!c) return;
    candidates.add(c);
    const corrected = dictionaryCorrect(c);
    if (corrected) candidates.add(corrected);
  };
  for (const m of matches) {
    addWithCorrection(m);
    // Also try trimming the first character — recovers "Sstudyfinds.com" →
    // "studyfinds.com" when a favicon glyph fused into the leading letter.
    // Combined with dictionary correction, this also rescues cases where the
    // favicon adds a different junk character (e.g. "estudyfinds.com").
    if (m.length > 8) {
      addWithCorrection(m.slice(1));
    }
  }
  // Sort by score descending — best candidate wins.
  return [...candidates].sort((a, b) => scoreUrl(b) - scoreUrl(a));
}

export default function Iota() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const votesRef = useRef(new Map()); // hostname -> count of frames that agreed
  const scanStartRef = useRef(0); // timestamp when scanning started
  const bestCandidateRef = useRef(null); // {url, score} — fallback if budget expires
  const skipCountRef = useRef(0); // consecutive frames skipped by the sharpness gate

  const [status, setStatus] = useState("idle"); // idle | scanning | found | needsRetry | error
  const [errorMsg, setErrorMsg] = useState("");
  const [foundUrl, setFoundUrl] = useState(null);
  const [history, setHistory] = useState([]);
  const [redirectIn, setRedirectIn] = useState(null);
  const [scanCount, setScanCount] = useState(0);
  const [copied, setCopied] = useState(null); // null=not attempted, true=ok, false=failed
  const [sharpness, setSharpness] = useState(0); // 0-1 estimated focus quality
  const [focusPulse, setFocusPulse] = useState(null); // {x, y, key} for tap-to-focus indicator
  const [diagnostic, setDiagnostic] = useState(null); // {kind:"error"|"empty"|"noUrl", message:string} | null

  // OCR runs server-side via /api/ocr (Google Cloud Vision). No worker init
  // needed in the browser — we just capture frames and POST them up.
  const recognizeRemote = useCallback(async (canvas) => {
    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return "";
    const base64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => {
        const result = fr.result || "";
        const idx = String(result).indexOf(",");
        resolve(idx >= 0 ? String(result).slice(idx + 1) : "");
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    const resp = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64 }),
    });
    // Carry the API's actual error message through so the UI can show it.
    // resp.text() rather than json() because a misconfigured rewrite can
    // return HTML, which would otherwise blow up the JSON parser.
    if (!resp.ok) {
      const body = await resp.text();
      let detail = body.slice(0, 200);
      try { detail = JSON.parse(body).error || detail; } catch { /* not json */ }
      throw new Error(`${resp.status}: ${detail}`);
    }
    const data = await resp.json();
    return data.text || "";
  }, []);

  const stopCamera = useCallback(() => {
    if (scanLoopRef.current) {
      clearTimeout(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Copy with a textarea fallback for older webviews / non-secure contexts
  const copyToClipboard = useCallback(async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const handleFound = useCallback(async (url) => {
    stopCamera();
    setFoundUrl(url);
    setStatus("found");
    setHistory(h => [{ url, t: Date.now() }, ...h].slice(0, 8));
    // copy to clipboard immediately so user has it even if redirect is blocked
    const ok = await copyToClipboard(url);
    setCopied(ok);
    // auto-redirect countdown
    let n = 3;
    setRedirectIn(n);
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        setRedirectIn(0);
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        setRedirectIn(n);
        scanLoopRef.current = setTimeout(tick, 1000);
      }
    };
    scanLoopRef.current = setTimeout(tick, 1000);
  }, [stopCamera, copyToClipboard]);

  // Tap-to-focus: send a focus point hint to the camera, fire visual pulse.
  // iOS Safari accepts pointsOfInterest in MediaTrackConstraints on iOS 16+.
  const handleVideoTap = useCallback(async (e) => {
    if (!videoRef.current || !streamRef.current) return;
    const rect = videoRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;   // 0..1
    const y = (e.clientY - rect.top) / rect.height;   // 0..1
    setFocusPulse({ x: e.clientX - rect.left, y: e.clientY - rect.top, key: Date.now() });

    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (track && track.applyConstraints) {
        // Re-trigger AF/AE by toggling out of continuous and applying a focus point.
        await track.applyConstraints({
          advanced: [
            { focusMode: "single-shot", pointsOfInterest: [{ x, y }] },
            { exposureMode: "single-shot", pointsOfInterest: [{ x, y }] },
          ],
        }).catch(() => {});
        // After ~1.5s, return to continuous so it keeps tracking.
        setTimeout(() => {
          track.applyConstraints({
            advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }],
          }).catch(() => {});
        }, 1500);
      }
    } catch { /* noop */ }
  }, []);

  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (status !== "scanning") return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.videoWidth === 0) {
      // not ready yet, retry shortly
      scanLoopRef.current = setTimeout(captureAndScan, 300);
      return;
    }

    // 1) CROP to a band sized for one line of address-bar text. Wide enough
    //    to capture full URLs (long paths run off the right side, which is OK
    //    — we'll still get the domain). The cropped band is what we send to
    //    the Vision API: smaller payload, less noise, faster response.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropX = Math.floor(vw * 0.05);
    const cropW = Math.floor(vw * 0.90);
    const cropY = Math.floor(vh * 0.45);
    const cropH = Math.floor(vh * 0.10);

    // No upscale: Vision handles small text well at native resolution and a
    // 3x upscale would triple the JPEG payload for no accuracy gain.
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // 2) SHARPNESS GATE via Laplacian variance. Each Vision call is a network
    //    round trip and costs money — don't waste one on a blurry frame.
    //    Skip up to 3 frames in a row, then force a call so a borderline
    //    stream still produces reads.
    const img = ctx.getImageData(0, 0, cropW, cropH);
    const px = img.data;
    const w = cropW, h = cropH;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      gray[j] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    }
    let lapSum = 0, lapSumSq = 0, lapCount = 0;
    for (let y = 1; y < h - 1; y += 4) {
      for (let x = 1; x < w - 1; x += 4) {
        const i = y * w + x;
        const lap = -gray[i - w] - gray[i - 1] + 4 * gray[i] - gray[i + 1] - gray[i + w];
        lapSum += lap;
        lapSumSq += lap * lap;
        lapCount++;
      }
    }
    const lapMean = lapSum / lapCount;
    const lapVar = lapSumSq / lapCount - lapMean * lapMean;
    setSharpness(Math.min(1, lapVar / 600));

    if (lapVar < 60 && skipCountRef.current < 3) {
      skipCountRef.current++;
      if (status === "scanning") {
        scanLoopRef.current = setTimeout(captureAndScan, 200);
      }
      return;
    }
    skipCountRef.current = 0;

    // 3) OCR via /api/ocr (Google Cloud Vision). One round trip per frame.
    //    Vision is trained on natural images, so we send the raw cropped band
    //    — no binarization, no contrast stretch.
    let url = null;
    try {
      const text = await recognizeRemote(canvas);
      if (!text) {
        setDiagnostic({ kind: "empty", message: "vision returned no text" });
      } else {
        const urls = extractUrls(text);
        if (urls.length > 0) {
          url = urls[0];
          setDiagnostic(null);
        } else {
          // Vision saw something but no URL parsed out — show a preview so we
          // can tell whether it's reading the wrong region, garbled text, etc.
          const preview = text.slice(0, 80).replace(/\s+/g, " ").trim();
          setDiagnostic({ kind: "noUrl", message: preview });
        }
      }
    } catch (e) {
      setDiagnostic({ kind: "error", message: String(e?.message || e) });
    }
    setScanCount(c => c + 1);

    const elapsed = Date.now() - scanStartRef.current;

    if (url) {
      try {
        const host = new URL(url).hostname;
        const conf = scoreUrl(url);

        // Track the best candidate we've seen. If the time budget runs out,
        // we'll fall back to this rather than scanning forever.
        const best = bestCandidateRef.current;
        if (!best || conf > best.score) {
          bestCandidateRef.current = { url, score: conf };
        }

        // Confidence-based locking:
        // - Reads scoring >= 5 (lowercase domain + common TLD, or dictionary
        //   hit) lock in immediately
        // - Lower-confidence reads need 3 frames in agreement before locking
        //   in. Two was too eager: a single OCR misread repeated twice could
        //   slip through; three near-identical reads is a much stronger signal.
        if (conf >= 5) {
          handleFound(url);
          return;
        }
        const votes = votesRef.current;
        votes.set(host, (votes.get(host) || 0) + 1);
        if (votes.get(host) >= 3) {
          handleFound(url);
          return;
        }
      } catch { /* malformed url, skip */ }
    }

    // Time budget. The 4s gate fires only if we've seen a *plausible* candidate
    // (score >= 4: lowercase host with a common TLD at minimum). Accepting a
    // junk read is worse than asking the user to re-aim — wrong redirects are
    // the user's loudest complaint. If nothing acceptable exists yet, give the
    // camera until 6s on slower phones, then bail with a graceful retry prompt.
    if (elapsed > 4000) {
      const best = bestCandidateRef.current;
      if (best && best.score >= 4) {
        handleFound(best.url);
        return;
      }
      if (elapsed > 6000) {
        stopCamera();
        setStatus("needsRetry");
        return;
      }
    }

    if (status === "scanning") {
      // 600ms between frames — each scan is a network round trip to Vision,
      // so going faster just queues up duplicate in-flight requests.
      scanLoopRef.current = setTimeout(captureAndScan, 600);
    }
  }, [status, handleFound, recognizeRemote, stopCamera]);

  // kick off the scan loop once status flips to scanning
  useEffect(() => {
    if (status === "scanning") {
      scanLoopRef.current = setTimeout(captureAndScan, 800);
    }
    return () => {
      if (scanLoopRef.current) clearTimeout(scanLoopRef.current);
    };
  }, [status, captureAndScan]);

  const startScan = async () => {
    setErrorMsg("");
    setFoundUrl(null);
    setRedirectIn(null);
    setScanCount(0);
    setCopied(null);
    setSharpness(0);
    setFocusPulse(null);
    setDiagnostic(null);
    votesRef.current = new Map();
    bestCandidateRef.current = null;
    skipCountRef.current = 0;
    scanStartRef.current = Date.now();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          // Hint to the browser to prefer a continuous-AF camera mode. iOS doesn't
          // expose all of these, but the ones it ignores are harmless.
          focusMode: { ideal: "continuous" },
          exposureMode: { ideal: "continuous" },
          whiteBalanceMode: { ideal: "continuous" },
          frameRate: { ideal: 30 },
        },
      });

      // Try to apply advanced constraints after the stream starts. Some iOS versions
      // accept these via applyConstraints even when they reject them in getUserMedia.
      try {
        const track = stream.getVideoTracks()[0];
        if (track && track.applyConstraints) {
          await track.applyConstraints({
            advanced: [
              { focusMode: "continuous" },
              { exposureMode: "continuous" },
              { whiteBalanceMode: "continuous" },
            ],
          }).catch(() => {});
        }
      } catch { /* noop — many browsers don't support advanced constraints */ }
      streamRef.current = stream;
      // Important: set status first so the video element renders. We attach the stream
      // in a useEffect below once the ref is populated. iOS Safari requires the video
      // element to exist BEFORE we set srcObject.
      setStatus("scanning");
    } catch (e) {
      setStatus("error");
      if (e.name === "NotAllowedError") {
        setErrorMsg("Camera permission denied. Enable it in your browser settings.");
      } else if (e.name === "NotFoundError") {
        setErrorMsg("No camera found on this device.");
      } else {
        setErrorMsg("Couldn't start the camera. " + (e.message || ""));
      }
    }
  };

  // Attach the camera stream to the video element once both exist.
  // iOS Safari needs the element mounted, muted, and playsinline before play().
  useEffect(() => {
    if (status === "scanning" && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      video.srcObject = streamRef.current;
      video.muted = true; // must be set before play() on iOS
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((err) => {
          // iOS may reject if not muted or not in a user gesture. Try once more.
          video.muted = true;
          video.play().catch(() => {
            setStatus("error");
            setErrorMsg("Couldn't start the camera preview. " + (err?.message || ""));
          });
        });
      }
    }
  }, [status]);

  const cancelScan = () => {
    stopCamera();
    setStatus("idle");
    setRedirectIn(null);
  };

  const cancelRedirect = () => {
    if (scanLoopRef.current) clearTimeout(scanLoopRef.current);
    setRedirectIn(null);
  };

  const openNow = () => {
    if (scanLoopRef.current) clearTimeout(scanLoopRef.current);
    if (foundUrl) window.open(foundUrl, "_blank", "noopener,noreferrer");
    setRedirectIn(null);
  };

  const handleShare = async () => {
    if (!foundUrl) return;
    // Use the native iOS / Android share sheet when available
    if (navigator.share) {
      try {
        await navigator.share({
          title: "iota",
          url: foundUrl,
        });
        return;
      } catch (e) {
        // User cancelled the share sheet, or share failed — fall through to copy
        if (e?.name === "AbortError") return;
      }
    }
    // Fallback for desktop or unsupported browsers
    const ok = await copyToClipboard(foundUrl);
    setCopied(ok);
  };

  return (
    <div
      className="min-h-screen w-full text-stone-900"
      style={{
        background: "radial-gradient(ellipse at top, #faf8f3 0%, #f0ebe0 100%)",
        fontFamily: "'Italiana', 'Cormorant Garamond', Georgia, serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Italiana&family=JetBrains+Mono:wght@400;500&display=swap');
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        .display { font-family: 'Italiana', 'Cormorant Garamond', Georgia, serif; letter-spacing: 0.01em; }
        @keyframes pulse-ring {
          0% { transform: scale(0.95); opacity: 0.7; }
          70% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes scan-line {
          0% { transform: translateY(0%); }
          100% { transform: translateY(100%); }
        }
        @keyframes focus-pulse {
          0% { transform: scale(1.3); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: scale(0.6); opacity: 0; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fade-up 0.5s ease-out forwards; }
        .grain::before {
          content: "";
          position: absolute; inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");
          opacity: 0.05;
          pointer-events: none;
          mix-blend-mode: multiply;
        }
      `}</style>

      <div
        className="relative grain max-w-md mx-auto px-6 min-h-screen"
        style={{
          paddingTop: "max(3rem, env(safe-area-inset-top))",
          paddingBottom: "max(6rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* Header */}
        <header className="mb-12 fade-up">
          <div className="flex items-baseline gap-3 mb-2">
            <h1 className="display text-7xl font-normal leading-none">
              iota
            </h1>
            <span className="mono text-xs text-stone-500 tracking-widest uppercase">v0.1</span>
          </div>
          <p className="text-stone-600 text-base leading-relaxed max-w-xs font-light">
            point your phone at a webpage. it'll come with you.
          </p>
        </header>

        {/* Main interaction area */}
        <main className="space-y-6">
          {status === "idle" && (
            <div className="fade-up space-y-10">
              <div className="space-y-4 text-sm text-stone-600 leading-relaxed">
                <div className="flex items-start gap-4">
                  <span className="mono text-[10px] text-stone-400 mt-1 tracking-widest">01</span>
                  <span>Open the page on your computer.</span>
                </div>
                <div className="flex items-start gap-4">
                  <span className="mono text-[10px] text-stone-400 mt-1 tracking-widest">02</span>
                  <span>Aim your phone at the address bar.</span>
                </div>
                <div className="flex items-start gap-4">
                  <span className="mono text-[10px] text-stone-400 mt-1 tracking-widest">03</span>
                  <span>iota reads the URL and opens it here.</span>
                </div>
              </div>

              <button
                onClick={startScan}
                className="group w-full rounded-full bg-stone-900 text-stone-50 px-6 py-4 flex items-center justify-center gap-3 hover:bg-stone-800 transition-colors"
              >
                <Camera className="w-4 h-4" strokeWidth={1.5} />
                <span className="text-sm tracking-wide font-light">scan a screen</span>
              </button>
            </div>
          )}

          {status === "scanning" && (
            <div className="fade-up space-y-4">
              <div
                className="relative aspect-[3/4] rounded-3xl overflow-hidden bg-stone-900 cursor-pointer select-none"
                onClick={handleVideoTap}
              >
                <video
                  ref={videoRef}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  playsInline
                  webkit-playsinline="true"
                  muted
                  autoPlay
                />
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  {/* corner brackets */}
                  <div className="absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-amber-300/80" />
                  <div className="absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-amber-300/80" />
                  <div className="absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-amber-300/80" />
                  <div className="absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-amber-300/80" />
                  {/* target band — must match the crop ratios in captureAndScan */}
                  <div
                    className="absolute border-2 border-amber-300/70 rounded-md"
                    style={{
                      left: "5%",
                      right: "5%",
                      top: "45%",
                      height: "10%",
                    }}
                  />
                  {/* scanning line */}
                  <div
                    className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-300 to-transparent"
                    style={{ animation: "scan-line 2s linear infinite", top: 0 }}
                  />
                  {/* tap-to-focus pulse */}
                  {focusPulse && (
                    <div
                      key={focusPulse.key}
                      className="absolute w-16 h-16 -ml-8 -mt-8 rounded-full border-2 border-amber-300"
                      style={{
                        left: focusPulse.x,
                        top: focusPulse.y,
                        animation: "focus-pulse 0.8s ease-out forwards",
                      }}
                    />
                  )}
                </div>
                {/* Status pill with sharpness meter */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-stone-900/80 backdrop-blur-md border border-stone-700">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-amber-300" style={{ animation: "pulse-ring 1.5s infinite" }} />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-300" />
                  </span>
                  <span className="mono text-[10px] tracking-widest uppercase text-stone-200">
                    reading · {scanCount}
                  </span>
                  <span className="w-px h-3 bg-stone-700" />
                  {/* sharpness bars */}
                  <div className="flex items-end gap-0.5 h-3" aria-label="focus quality">
                    {[0.2, 0.4, 0.6, 0.8].map((thresh, i) => (
                      <span
                        key={i}
                        className="w-0.5 rounded-full transition-colors"
                        style={{
                          height: `${(i + 1) * 25}%`,
                          backgroundColor: sharpness > thresh ? "#fcd34d" : "#44403c",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-center">
                <p className="text-sm text-stone-600 italic mb-4">
                  Aim the URL inside the box. Tap to focus.
                </p>
                <button
                  onClick={cancelScan}
                  className="mono text-xs tracking-widest uppercase text-stone-500 hover:text-stone-900 transition-colors"
                >
                  cancel
                </button>
              </div>
            </div>
          )}

          {status === "found" && foundUrl && (
            <div className="fade-up space-y-6">
              <div className="rounded-3xl bg-white border border-stone-200 p-6 space-y-5"
                   style={{ boxShadow: "0 20px 40px -15px rgba(40, 30, 20, 0.15)" }}>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
                    <Check className="w-4 h-4 text-emerald-700" strokeWidth={2} />
                  </div>
                  <span className="mono text-[10px] tracking-widest uppercase text-emerald-700">
                    captured
                  </span>
                </div>

                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wider mb-2 mono">url</p>
                  <p className="mono text-sm break-all text-stone-900 leading-relaxed">
                    {foundUrl}
                  </p>
                  {copied && (
                    <p className="mt-3 mono text-[10px] tracking-widest uppercase text-emerald-700 flex items-center gap-1.5">
                      <Check className="w-3 h-3" strokeWidth={2.5} />
                      copied to clipboard
                    </p>
                  )}
                  {copied === false && (
                    <p className="mt-3 mono text-[10px] tracking-widest uppercase text-stone-500">
                      couldn't auto-copy — tap to copy
                    </p>
                  )}
                </div>

                {redirectIn !== null && redirectIn > 0 && (
                  <div className="flex items-center justify-between pt-4 border-t border-stone-100">
                    <span className="text-sm text-stone-600 italic">
                      opening in {redirectIn}…
                    </span>
                    <button
                      onClick={cancelRedirect}
                      className="mono text-[10px] tracking-widest uppercase text-stone-500 hover:text-stone-900"
                    >
                      cancel
                    </button>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={openNow}
                    className="flex-1 bg-stone-900 text-stone-50 rounded-xl py-3 text-sm hover:bg-stone-800 transition-colors flex items-center justify-center gap-2"
                  >
                    <Zap className="w-4 h-4" strokeWidth={1.5} />
                    open now
                  </button>
                  <button
                    onClick={handleShare}
                    className="px-4 bg-stone-100 text-stone-700 rounded-xl py-3 text-sm hover:bg-stone-200 transition-colors flex items-center justify-center gap-2"
                    aria-label="share url"
                  >
                    <Share2 className="w-4 h-4" strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => { setStatus("idle"); setFoundUrl(null); setRedirectIn(null); setCopied(null); }}
                    className="px-4 bg-stone-100 text-stone-700 rounded-xl py-3 text-sm hover:bg-stone-200 transition-colors"
                  >
                    again
                  </button>
                </div>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="fade-up rounded-3xl bg-white border border-stone-200 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4 text-red-700" strokeWidth={2} />
                </div>
                <span className="mono text-[10px] tracking-widest uppercase text-red-700">
                  trouble
                </span>
              </div>
              <p className="text-sm text-stone-700 leading-relaxed">{errorMsg}</p>
              <button
                onClick={() => { setStatus("idle"); setErrorMsg(""); }}
                className="mono text-xs tracking-widest uppercase text-stone-500 hover:text-stone-900"
              >
                try again
              </button>
            </div>
          )}

          {status === "needsRetry" && (
            <div className="fade-up rounded-3xl bg-white border border-stone-200 p-6 space-y-4"
                 style={{ boxShadow: "0 20px 40px -15px rgba(40, 30, 20, 0.15)" }}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4 text-amber-700" strokeWidth={2} />
                </div>
                <span className="mono text-[10px] tracking-widest uppercase text-amber-700">
                  hold steadier
                </span>
              </div>
              <p className="text-sm text-stone-700 leading-relaxed italic">
                Couldn't read the URL clearly. Try moving closer, holding steadier,
                or tapping to refocus.
              </p>
              {diagnostic && (
                <div className="rounded-xl bg-stone-50 border border-stone-200 px-3 py-2">
                  <p className="mono text-[9px] tracking-widest uppercase text-stone-500 mb-1">
                    {diagnostic.kind === "error" ? "api error" :
                     diagnostic.kind === "empty" ? "no text from vision" :
                     "vision read"}
                  </p>
                  <p className="mono text-[11px] text-stone-700 break-all leading-snug">
                    {diagnostic.message || "(empty)"}
                  </p>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={startScan}
                  className="flex-1 bg-stone-900 text-stone-50 rounded-xl py-3 text-sm hover:bg-stone-800 transition-colors flex items-center justify-center gap-2"
                >
                  <Camera className="w-4 h-4" strokeWidth={1.5} />
                  scan again
                </button>
                <button
                  onClick={() => setStatus("idle")}
                  className="px-4 bg-stone-100 text-stone-700 rounded-xl py-3 text-sm hover:bg-stone-200 transition-colors"
                >
                  cancel
                </button>
              </div>
            </div>
          )}
        </main>

        {/* History */}
        {history.length > 0 && status === "idle" && (
          <section className="mt-16 fade-up">
            <h2 className="mono text-[10px] tracking-widest uppercase text-stone-500 mb-4">
              recent
            </h2>
            <ul className="space-y-2">
              {history.map((item, i) => (
                <li key={item.t}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 py-2 border-b border-stone-200/60 hover:border-stone-400 transition-colors"
                  >
                    <LinkIcon className="w-3 h-3 text-stone-400 group-hover:text-stone-700 shrink-0" strokeWidth={1.5} />
                    <span className="mono text-xs text-stone-600 group-hover:text-stone-900 truncate">
                      {item.url.replace(/^https?:\/\//, "")}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="absolute bottom-6 left-0 right-0 text-center">
          <p className="mono text-[9px] tracking-[0.3em] uppercase text-stone-400">
            ι · bridge between screens
          </p>
        </footer>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
