# RDV Barbershop — SMP landing page + AI preview

## What's in here
- `index.html` — the landing page (orange version, with the preview tool)
- `img/` — before/after photos
- `functions/api/generate.js` — the server piece that talks to OpenAI (Cloudflare Pages runs it automatically)

## Deploy (Cloudflare Pages + GitHub)
1. Create a **private** GitHub repo and upload everything in this folder, keeping the same structure (`functions/api/generate.js` must stay in that path).
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → pick the repo.
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/`
3. After the first deploy: Project → Settings → Variables and Secrets → Add
   - Type: **Secret** · Name: `OPENAI_API_KEY` · Value: your key · Environment: Production
4. Deployments → latest → ⋯ → **Retry deployment** (secrets only apply to new deploys).
5. Open your `*.pages.dev` link, upload a photo. AI result = working. If you see the "Ajuste la hauteur de ta hairline" slider, it fell back to the simulation → check Functions logs.

## Optional settings (same place as the key, type Text)
- `OPENAI_IMAGE_MODEL` — default `gpt-image-2`
- `OPENAI_IMAGE_QUALITY` — `low` / `medium` (default) / `high`

## Safety
- Never paste the key in `index.html`, GitHub, or a chat.
- Set a monthly budget limit on platform.openai.com → Settings → Limits.
- If the key ever leaks: revoke it in OpenAI → API keys and create a new one.
