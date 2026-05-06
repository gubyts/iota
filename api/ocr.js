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
// Logging: every request emits a single structured-ish line prefixed with
// "[ocr]" so logs can be filtered in Vercel. Includes byte size, vision
// latency, total latency, and a short preview of the recognised text. Never
// logs the image itself or the API key. Tail with: vercel logs <url> --follow

export default async function handler(req, res) {
  const t0 = Date.now();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
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

  const imageBytes = image.length;
  console.log(`[ocr] request bytes=${imageBytes}`);

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
