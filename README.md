# NexBot — Deployment Guide

Two pieces, both on free tiers, neither holds a secret in client-readable code:

```
frontend/   → Vercel (static HTML, the chatbot UI)
worker/     → Cloudflare Worker (holds your Groq API key, proxies one endpoint)
```

## Why this split

A static HTML file on Vercel is fully readable by anyone (view-source). The
Cloudflare Worker is the only piece that ever touches your real Groq key —
it lives as a server-side "secret" that the browser never receives.

---

## Step 1 — Deploy the Cloudflare Worker

1. Install Wrangler (Cloudflare's CLI):
   ```
   npm install -g wrangler
   ```

2. Log in:
   ```
   cd worker
   wrangler login
   ```

3. Set your real Groq key as a secret (you'll be prompted to paste it —
   it is NOT written to any file):
   ```
   wrangler secret put GROQ_API_KEY
   ```
   Get a free key at https://console.groq.com/keys

4. Deploy:
   ```
   wrangler deploy
   ```
   You'll get a URL like:
   ```
   https://nexbot-groq-proxy.<your-subdomain>.workers.dev
   ```

---

## Step 2 — Wire the frontend to your Worker

1. Open `frontend/index.html`
2. Find this line near the top of the `<script>` block:
   ```js
   const WORKER_URL = "https://nexbot-groq-proxy.YOUR-SUBDOMAIN.workers.dev";
   ```
3. Replace `YOUR-SUBDOMAIN` with the subdomain from Step 1's output.

---

## Step 3 — Deploy the frontend to Vercel

Option A — Vercel CLI:
```
npm install -g vercel
cd frontend
vercel --prod
```

Option B — Vercel dashboard:
- Push the `frontend/` folder to a GitHub repo
- Import the repo at vercel.com → Deploy (no build settings needed,
  it's a static HTML file)

---

## Step 4 — Lock down CORS (recommended, takes 1 minute)

Once you have your Vercel URL (e.g. `https://nexbot.vercel.app`):

1. Open `worker/wrangler.toml`
2. Change:
   ```toml
   [vars]
   ALLOWED_ORIGIN = "*"
   ```
   to:
   ```toml
   [vars]
   ALLOWED_ORIGIN = "https://nexbot.vercel.app"
   ```
3. Redeploy the worker:
   ```
   cd worker
   wrangler deploy
   ```

This stops other websites from using your Worker (and burning your Groq
quota) even though the Worker URL itself is public.

---

## What's safe to commit to GitHub

✅ Everything in this folder, as committed — no secrets are present.
The Groq key lives only in Cloudflare's secret store (set via
`wrangler secret put`), never in a file.

---

## Rate limits in place

- **Worker**: 20 requests/hour per visitor IP (edit `HOURLY_LIMIT` in
  `worker.js` to change)
- **Frontend**: soft cap of 10 Groq fallback calls per browser session
  (edit `GROQ_FALLBACK_LIMIT` in `index.html`)

The fallback only fires when semantic similarity to all FAQs is below
30% — most queries never reach Groq at all.
