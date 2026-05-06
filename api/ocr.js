// Vercel serverless function. Proxies a base64-encoded image to the Google
// Cloud Vision REST API and returns the extracted text.
//
// Why a serverless function rather than calling Vision directly from the
// browser: keeps VISION_API_KEY off the client. The key is in env, never
// shipped in the JS bundle.
//
// Required env: VISION_API_KEY — a Google Cloud API key with the Cloud Vision
// API enabled. Recommended: restrict the key to the Vision API in the GCP
// console so a leak can only burn vision quota.
//
// Optional env (abuse guards):
//   ALLOWED_ORIGINS         — comma-separated list of origins permitted to
//                             call this endpoint (e.g. "https://iota.example.com").
//                             If unset, all origins are allowed (useful for dev).
//   RATE_LIMIT_PER_MINUTE   — per-IP cap, default 120. Set lower to be stricter.
//   MAX_IMAGE_BYTES         — hard cap on base64 image size, default 1500000
//                             (~1.1 MB JPEG). Real cropped frames are <200KB.
//
// Logging: every request emits a single structured-ish line prefixed with
// "[ocr]" so logs can be filtered in Vercel. Includes byte size, vision
// latency, total latency, and a short preview of the recognised text. Never
// logs the image itself or the API key. Tail with: vercel logs <url> --follow

// Module-scope state. Persists across invocations within a single warm
// serverless instance. Each instance gets its own buckets — strict global
// rate limiting would need an external KV; this is "good enough" defence
// in depth that catches casual abuse without adding infra.
const RATE_BUCKETS = new Map(); // ip -> { start: number, count: number }
const RATE_WINDOW_MS = 60_000;

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function rateCheck(ip, max) {
  const now = Date.now();
  // Lazy cleanup so the map doesn't grow unbounded on long-lived instances.
  if (RATE_BUCKETS.size > 1000) {
    for (const [k, v] of RATE_BUCKETS) {
      if (now - v.start > RATE_WINDOW_MS) RATE_BUCKETS.delete(k);
    }
  }
  const b = RATE_BUCKETS.get(ip);
  if (!b || now - b.start > RATE_WINDOW_MS) {
    RATE_BUCKETS.set(ip, { start: now, count: 1 });
    return { ok: true };
  }
  b.count++;
  if (b.count > max) {
    return { ok: false, retryAfterMs: RATE_WINDOW_MS - (now - b.start) };
  }
  return { ok: true };
}

function originOk(req) {
  const raw = process.env.ALLOWED_ORIGINS || "";
  const allow = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (allow.length === 0) return true; // not configured → allow all
  const origin = (req.headers.origin || "").trim();
  const referer = (req.headers.referer || "").trim();
  return allow.some(a => origin === a || referer === a || referer.startsWith(a + "/"));
}

export default async function handler(req, res) {
  const t0 = Date.now();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  if (!originOk(req)) {
    console.warn(`[ocr] forbidden_origin origin=${req.headers.origin || ""} referer=${req.headers.referer || ""}`);
    return res.status(403).json({ error: "forbidden origin" });
  }

  const ip = getClientIp(req);
  const rateMax = Number(process.env.RATE_LIMIT_PER_MINUTE) || 120;
  const rate = rateCheck(ip, rateMax);
  if (!rate.ok) {
    const retrySec = Math.ceil(rate.retryAfterMs / 1000);
    res.setHeader("Retry-After", String(retrySec));
    console.warn(`[ocr] rate_limited ip=${ip} retry_after_s=${retrySec}`);
    return res.status(429).json({ error: "rate limit", retryAfterSec: retrySec });
  }

  const apiKey = process.env.VISION_API_KEY;
  if (!apiKey) {
    console.error("[ocr] config_error: VISION_API_KEY not set in env");
    return res.status(500).json({ error: "VISION_API_KEY not configured" });
  }

  const { image } = req.body || {};
  if (!image || typeof image !== "string") {
    console.warn("[ocr] bad_request: missing or non-string image field");
    return res.status(400).json({ error: "missing image (expected base64 string)" });
  }

  const maxBytes = Number(process.env.MAX_IMAGE_BYTES) || 1_500_000;
  if (image.length > maxBytes) {
    console.warn(`[ocr] oversize bytes=${image.length} max=${maxBytes}`);
    return res.status(413).json({ error: "image too large" });
  }

  const imageBytes = image.length;
  console.log(`[ocr] request bytes=${imageBytes} ip=${ip}`);

  const tFetch = Date.now();
  try {
    const r = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: image },
              features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
            },
          ],
        }),
      },
    );
    const visionMs = Date.now() - tFetch;

    if (!r.ok) {
      const body = await r.text();
      console.error(
        `[ocr] vision_http_error status=${r.status} latency_ms=${visionMs} body=${body.slice(0, 300)}`,
      );
      return res.status(502).json({ error: "vision api error", status: r.status, body });
    }

    const data = await r.json();
    const r0 = data.responses?.[0];
    // Vision can return 200 OK with a per-request error embedded in the
    // response. Surface that — silent "" responses make debugging hell.
    if (r0?.error) {
      console.error(
        `[ocr] vision_per_request_error code=${r0.error.code} message=${r0.error.message} latency_ms=${visionMs}`,
      );
      return res.status(502).json({ error: "vision per-request error", details: r0.error });
    }

    const text = r0?.fullTextAnnotation?.text ?? r0?.textAnnotations?.[0]?.description ?? "";
    const totalMs = Date.now() - t0;
    // 60-char preview so log lines stay readable. Strips newlines/tabs that
    // would otherwise wrap badly in the Vercel log viewer.
    const preview = text.slice(0, 60).replace(/\s+/g, " ").trim();
    console.log(
      `[ocr] success vision_ms=${visionMs} total_ms=${totalMs} text_len=${text.length} preview="${preview}"`,
    );
    return res.status(200).json({ text });
  } catch (e) {
    console.error(
      `[ocr] request_failed total_ms=${Date.now() - t0} error=${e?.message || e}`,
    );
    return res.status(500).json({ error: "vision request failed", message: e?.message });
  }
}
