const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

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
  for (let i = 0; i < length; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export async function onRequestGet({ request, env }) {
  if (!originIsAllowed(request)) return json({ error: "Cross-origin request blocked." }, 403);
  if (!env.JARVIS_ACCESS_TOKEN) {
    return json({ error: "JARVIS_ACCESS_TOKEN is not configured in Cloudflare." }, 503);
  }

  const authorization = request.headers.get("Authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(supplied, env.JARVIS_ACCESS_TOKEN)) {
    return json({ error: "Access code was not accepted." }, 401);
  }

  return json({
    ok: true,
    service: "jarvis-api",
    configured: Boolean(env.GEMINI_API_KEY || env.OPENROUTER_API_KEY),
    providers: {
      gemini: Boolean(env.GEMINI_API_KEY),
      openrouter: Boolean(env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL),
      tavily: Boolean(env.TAVILY_API_KEY),
    },
  });
}
