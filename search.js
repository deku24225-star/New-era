const MAX_BODY_BYTES = 4 * 1024;
const json = (data, status = 200, extraHeaders = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders },
});

// Best-effort per-isolate protection only. Add an edge rate-limit rule for a public deployment.
const requests = new Map();
function isRateLimited(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const current = requests.get(ip);
  if (!current || now - current.start >= 60_000) {
    requests.set(ip, { start: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > 20) return true;
  }
  if (requests.size > 1000) {
    for (const [key, value] of requests) {
      if (now - value.start >= 60_000) requests.delete(key);
    }
  }
  return false;
}

function originIsAllowed(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

async function readJSON(request) {
  if (!request.body) return { error: "Request body is empty.", status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: "Request too large.", status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "Could not read request body.", status: 400 };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { data: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: "Invalid JSON.", status: 400 };
  }
}

export async function onRequestPost({ request, env }) {
  if (!originIsAllowed(request)) return json({ error: "Cross-origin request blocked." }, 403);
  if (!env.JARVIS_ACCESS_TOKEN) {
    return json({ error: "JARVIS_ACCESS_TOKEN is not configured in Cloudflare." }, 503);
  }
  const authorization = request.headers.get("Authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(supplied, env.JARVIS_ACCESS_TOKEN)) return json({ error: "Access code was not accepted." }, 401);
  if (isRateLimited(request)) return json({ error: "Too many searches. Please wait a minute and try again." }, 429, { "Retry-After": "60" });

  const parsed = await readJSON(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.data;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request body." }, 400);
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 400) : "";
  if (!query) return json({ error: "Enter a search query." }, 400);
  if (!env.TAVILY_API_KEY) return json({ error: "Add TAVILY_API_KEY in Cloudflare settings first." }, 503);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: { "Authorization": "Bearer " + env.TAVILY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 5, include_answer: false }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: "Tavily search failed (" + response.status + "). Check API key." }, 502);
    const results = (Array.isArray(data.results) ? data.results : []).slice(0, 5).map(item => {
      let url = "";
      try {
        const parsedUrl = new URL(item.url);
        if (["https:", "http:"].includes(parsedUrl.protocol)) url = parsedUrl.href;
      } catch { /* ignore malformed result URLs */ }
      return {
        title: String(item.title || "Search result").slice(0, 200),
        url,
        content: String(item.content || "").slice(0, 1200),
      };
    }).filter(item => item.url);
    return json({ results });
  } catch (error) {
    return json({ error: error?.name === "AbortError" ? "Search timed out." : "Could not reach search service." }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
