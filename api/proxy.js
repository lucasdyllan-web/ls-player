const zlib = require("zlib");

const CF_STREAM_WORKER = "https://lsplay-proxy.lucasdyllan.workers.dev";

function rewriteRawIpToSslip(urlStr) {
  if (!urlStr) return urlStr;
  return urlStr.replace(
    /^(https?:\/\/)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?=[:\/]|$)/i,
    "$1$2.sslip.io"
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, Location");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const targetUrl = req.query && req.query.url;
  if (!targetUrl || typeof targetUrl !== "string") {
    res.status(200).send("LSplay AWS Sao Paulo (gru1) Proxy Online");
    return;
  }

  try {
    const forwardHeaders = {
      "User-Agent": "okhttp/4.12.0",
      "Accept": "*/*"
    };
    if (req.headers.range) {
      forwardHeaders["Range"] = req.headers.range;
    }

    // Step 1: Request with redirect: "manual" so stream 302s hand off directly to Cloudflare Worker + sslip.io
    const upstream = await fetch(targetUrl, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: forwardHeaders,
      redirect: "manual"
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get("location");
      if (loc) {
        const absLoc = new URL(loc, targetUrl).toString();
        const sslipLoc = rewriteRawIpToSslip(absLoc);
        const cfStreamUrl = `${CF_STREAM_WORKER}/?url=${encodeURIComponent(sslipLoc)}`;
        res.status(302);
        res.setHeader("Location", cfStreamUrl);
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      res.status(upstream.status).send(errText || `Upstream HTTP ${upstream.status}`);
      return;
    }

    const rawText = await upstream.text();
    let outJsonStr = rawText;

    // Slim massive catalogs (45k VOD / 11k Series) so payload stays ~800KB gzipped and ultra-fast on mobile/TV
    if (targetUrl.includes("action=get_vod_streams")) {
      try {
        const arr = JSON.parse(rawText);
        if (Array.isArray(arr)) {
          outJsonStr = JSON.stringify(
            arr.map((x) => ({
              stream_id: x.stream_id,
              name: x.name,
              stream_icon: x.stream_icon,
              rating: x.rating,
              added: x.added,
              category_id: x.category_id,
              container_extension: x.container_extension
            }))
          );
        }
      } catch (_) {}
    } else if (targetUrl.includes("action=get_series") && !targetUrl.includes("action=get_series_")) {
      try {
        const arr = JSON.parse(rawText);
        if (Array.isArray(arr)) {
          outJsonStr = JSON.stringify(
            arr.map((x) => ({
              series_id: x.series_id,
              name: x.name,
              cover: x.cover,
              plot: x.plot,
              genre: x.genre,
              rating: x.rating,
              last_modified: x.last_modified,
              category_id: x.category_id
            }))
          );
        }
      } catch (_) {}
    }

    const acceptEnc = String(req.headers["accept-encoding"] || "");
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (acceptEnc.includes("gzip") && outJsonStr.length > 1024) {
      const gz = zlib.gzipSync(Buffer.from(outJsonStr, "utf-8"), { level: 6 });
      res.setHeader("Content-Encoding", "gzip");
      res.status(200).send(gz);
    } else {
      res.status(200).send(outJsonStr);
    }
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
};
