import React, { useState, useRef, useEffect, useCallback } from "react";
import { Camera, Link as LinkIcon, Loader2, X, Check, AlertCircle, Zap, Share2 } from "lucide-react";
import { createWorker } from "tesseract.js";

// iota — bridge a webpage from your computer to your phone via camera + OCR.
// Aesthetic: refined minimalism. Serif display + clean mono. Lots of breathing room.

// More forgiving URL regex — catches bare domains, www., http(s)://, with paths/queries.
// OCR output is messy, so we accept a wide net then sanitize.
const URL_REGEX = /\b((?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+(?:\/[^\s]*)?)\b/gi;

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

function extractUrls(text) {
  const matches = text.match(URL_REGEX) || [];
  const cleaned = matches
    .map(cleanUrl)
    .filter(Boolean);
  // de-dupe while preserving order
  return [...new Set(cleaned)];
}

export default function Iota() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const tesseractReadyRef = useRef(false);
  const workerRef = useRef(null);
  const scanLoopRef = useRef(null);

  const [status, setStatus] = useState("idle"); // idle | loading | scanning | found | error
  const [errorMsg, setErrorMsg] = useState("");
  const [foundUrl, setFoundUrl] = useState(null);
  const [history, setHistory] = useState([]);
  const [redirectIn, setRedirectIn] = useState(null);
  const [scanCount, setScanCount] = useState(0);
  const [copied, setCopied] = useState(null); // null=not attempted, true=ok, false=failed

  // Spin up a persistent Tesseract worker once. Reusing it across frames is dramatically
  // faster than calling Tesseract.recognize from scratch each scan.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const worker = await createWorker("eng");
        if (cancelled) {
          await worker.terminate();
          return;
        }
        // Tune Tesseract for URLs:
        // - Restrict character set to URL-legal chars. Cuts hallucinated punctuation
        //   and weird unicode that mess up regex matching.
        // - PSM 7 = "treat the image as a single text line" — perfect for an address
        //   bar, and much faster than the default layout analysis.
        await worker.setParameters({
          tessedit_char_whitelist:
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#[]@!$&'()*+,;=%",
          tessedit_pageseg_mode: "7",
        });
        workerRef.current = worker;
        tesseractReadyRef.current = true;
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg("Couldn't load OCR engine. " + (e?.message || ""));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (workerRef.current) {
        workerRef.current.terminate().catch(() => {});
        workerRef.current = null;
      }
    };
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

  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !workerRef.current) return;
    if (status !== "scanning") return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.videoWidth === 0) {
      // not ready yet, retry shortly
      scanLoopRef.current = setTimeout(captureAndScan, 300);
      return;
    }

    // 1) CROP to the target band where the user is aiming the address bar.
    //    The viewfinder shows a horizontal rectangle at ~1/3 from the top, padded 6 from sides.
    //    These ratios match the JSX overlay below.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropX = Math.floor(vw * 0.05);
    const cropW = Math.floor(vw * 0.90);
    const cropY = Math.floor(vh * 0.30);
    const cropH = Math.floor(vh * 0.12);

    // 2) SCALE UP — Tesseract works best on text that's ~30-50px tall. A phone
    //    pointed at a screen often gives smaller text than that. Scale 2x.
    const scale = 2;
    const outW = cropW * scale;
    const outH = cropH * scale;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

    // 3) PREPROCESS: grayscale → contrast stretch → binarize (Otsu-ish global threshold).
    //    This is what kills the "yellow page background confuses OCR" problem.
    const img = ctx.getImageData(0, 0, outW, outH);
    const px = img.data;
    // First pass: convert to grayscale and build a histogram for threshold selection.
    const hist = new Uint32Array(256);
    const gray = new Uint8ClampedArray(px.length / 4);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      // luminance weighted average — better than naive mean for text contrast
      const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      gray[j] = g;
      hist[g]++;
    }
    // Otsu's method: pick the threshold that maximises between-class variance.
    let total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, varMax = 0, threshold = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > varMax) { varMax = between; threshold = t; }
    }
    // Decide polarity: address bars are usually dark text on light background, but
    // some dark-mode browsers invert that. Sample whether the majority is above
    // threshold (light bg) or below (dark bg) and binarize accordingly.
    let lightCount = 0;
    for (let i = 0; i < gray.length; i++) if (gray[i] > threshold) lightCount++;
    const darkBg = lightCount < gray.length / 2;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const isText = darkBg ? gray[j] > threshold : gray[j] < threshold;
      const v = isText ? 0 : 255; // text → black, bg → white (Tesseract prefers this)
      px[i] = v; px[i + 1] = v; px[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);

    try {
      const { data } = await workerRef.current.recognize(canvas);
      setScanCount(c => c + 1);
      const urls = extractUrls(data.text || "");
      if (urls.length > 0) {
        handleFound(urls[0]);
        return;
      }
    } catch (e) {
      // single-frame failure — keep going
    }

    if (status === "scanning") {
      scanLoopRef.current = setTimeout(captureAndScan, 350);
    }
  }, [status, handleFound]);

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

    if (!tesseractReadyRef.current) {
      setStatus("loading");
      // poll for readiness — first load downloads the language file (~10MB on cellular)
      const wait = setInterval(() => {
        if (tesseractReadyRef.current) {
          clearInterval(wait);
          startScan();
        }
      }, 200);
      setTimeout(() => clearInterval(wait), 30000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
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
        fontFamily: "'Fraunces', 'Cormorant Garamond', Georgia, serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&display=swap');
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        @keyframes pulse-ring {
          0% { transform: scale(0.95); opacity: 0.7; }
          70% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes scan-line {
          0% { transform: translateY(0%); }
          100% { transform: translateY(100%); }
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
            <h1 className="text-6xl font-light tracking-tight" style={{ fontFamily: "'Fraunces', serif", fontVariationSettings: "'opsz' 144" }}>
              iota
            </h1>
            <span className="mono text-xs text-stone-500 tracking-widest uppercase">v0.1</span>
          </div>
          <p className="text-stone-600 text-base leading-relaxed max-w-xs italic font-light">
            point your phone at a webpage. it'll come with you.
          </p>
        </header>

        {/* Main interaction area */}
        <main className="space-y-6">
          {status === "idle" && (
            <div className="fade-up space-y-8">
              <button
                onClick={startScan}
                className="group relative w-full aspect-square rounded-3xl bg-stone-900 text-stone-50 flex flex-col items-center justify-center gap-4 hover:bg-stone-800 transition-all overflow-hidden"
                style={{ boxShadow: "0 30px 60px -20px rgba(40, 30, 20, 0.4)" }}
              >
                <div className="absolute inset-0 opacity-20" style={{
                  backgroundImage: "radial-gradient(circle at 30% 30%, rgba(255,200,150,0.3) 0%, transparent 50%)"
                }} />
                <Camera className="w-10 h-10 stroke-1" strokeWidth={1.2} />
                <span className="text-xl font-light tracking-wide">scan a screen</span>
                <span className="mono text-[10px] text-stone-400 tracking-widest uppercase absolute bottom-6">
                  tap to begin
                </span>
              </button>

              <div className="space-y-3 text-sm text-stone-600 leading-relaxed">
                <div className="flex items-start gap-3">
                  <span className="mono text-xs text-stone-400 mt-0.5 w-4">01</span>
                  <span>Open the page on your computer.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mono text-xs text-stone-400 mt-0.5 w-4">02</span>
                  <span>Aim your phone at the address bar.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mono text-xs text-stone-400 mt-0.5 w-4">03</span>
                  <span>iota reads the URL and opens it here.</span>
                </div>
              </div>
            </div>
          )}

          {status === "loading" && (
            <div className="fade-up flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="w-6 h-6 animate-spin stroke-1" />
              <p className="mono text-xs tracking-widest uppercase text-stone-500">
                preparing optics
              </p>
            </div>
          )}

          {status === "scanning" && (
            <div className="fade-up space-y-4">
              <div className="relative aspect-[3/4] rounded-3xl overflow-hidden bg-stone-900">
                <video
                  ref={videoRef}
                  className="absolute inset-0 w-full h-full object-cover"
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
                    className="absolute border border-amber-300/60 rounded-md"
                    style={{
                      left: "5%",
                      right: "5%",
                      top: "30%",
                      height: "12%",
                    }}
                  />
                  {/* scanning line */}
                  <div
                    className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-300 to-transparent"
                    style={{ animation: "scan-line 2s linear infinite", top: 0 }}
                  />
                </div>
                {/* Status pill */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-stone-900/80 backdrop-blur-md border border-stone-700">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-amber-300" style={{ animation: "pulse-ring 1.5s infinite" }} />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-300" />
                  </span>
                  <span className="mono text-[10px] tracking-widest uppercase text-stone-200">
                    reading · {scanCount}
                  </span>
                </div>
              </div>

              <div className="text-center">
                <p className="text-sm text-stone-600 italic mb-4">
                  Hold steady. Frame the address bar.
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
