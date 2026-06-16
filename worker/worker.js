/**
 * NexBot Groq Proxy — Cloudflare Worker
 * ──────────────────────────────────────
 * Holds the Groq API key server-side. The frontend calls this Worker's
 * URL instead of Groq directly, so the key never reaches the browser.
 *
 * SETUP:
 * 1. Install Wrangler: npm install -g wrangler
 * 2. Login: wrangler login
 * 3. Set the secret (do NOT put the key in this file):
 *      wrangler secret put GROQ_API_KEY
 *    (paste your real key when prompted)
 * 4. Edit wrangler.toml: set ALLOWED_ORIGIN to your Vercel URL
 * 5. Deploy: wrangler deploy
 * 6. Copy the deployed Worker URL into the frontend's WORKER_URL constant.
 */

export default {
  async fetch(request, env) {
    // CORS: only allow your deployed frontend origin
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Basic rate limiting per IP using Cloudflare's Cache API as a counter ──
    // Free-tier-friendly: limits each visitor to N requests per hour.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rateLimitKey = new Request(`https://ratelimit.local/${ip}`);
    const cache = caches.default;

    let count = 0;
    const cached = await cache.match(rateLimitKey);
    if (cached) {
      const data = await cached.json();
      count = data.count || 0;
    }

    const HOURLY_LIMIT = 20; // adjust as needed
    if (count >= HOURLY_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Parse incoming request ──
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { query, faqContext, recentHistory } = body;
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'query' field" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are NexBot, a support assistant for an e-commerce platform. Answer the user's question helpfully and concisely (2-4 sentences). Use the FAQ knowledge below as context if relevant, but you may also answer general questions politely. If something is truly outside your scope, say you'll connect them with a human agent.

KNOWLEDGE BASE:
${faqContext || ""}`;

    const messages = [{ role: "system", content: systemPrompt }];
    if (recentHistory) {
      messages.push({ role: "system", content: "Recent conversation:\n" + recentHistory });
    }
    messages.push({ role: "user", content: query });

    // ── Call Groq with the server-side secret ──
    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages,
          max_tokens: 200,
          temperature: 0.4,
        }),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        return new Response(
          JSON.stringify({ error: "Groq API error", detail: errText }),
          { status: groqRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await groqRes.json();
      const text = data.choices?.[0]?.message?.content?.trim();

      // Update rate limit counter (1 hour TTL)
      count++;
      const newCached = new Response(JSON.stringify({ count }), {
        headers: { "Cache-Control": "max-age=3600" },
      });
      await cache.put(rateLimitKey, newCached);

      return new Response(JSON.stringify({ text: text || "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Network error", detail: e.message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
