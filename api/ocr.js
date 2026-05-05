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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const apiKey = process.env.VISION_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "VISION_API_KEY not configured" });
  }

  const { image } = req.body || {};
  if (!image || typeof image !== "string") {
    return res.status(400).json({ error: "missing image (expected base64 string)" });
  }

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

    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ error: "vision api error", status: r.status, body });
    }

    const data = await r.json();
    const text =
      data.responses?.[0]?.fullTextAnnotation?.text ??
      data.responses?.[0]?.textAnnotations?.[0]?.description ??
      "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "vision request failed", message: e?.message });
  }
}
