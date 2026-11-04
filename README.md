# RDV Barbershop — SMP site (Cloudflare Workers version)

- `public/` — the landing page + photos (what visitors see)
- `worker.js` — serves the page and handles the AI preview (`/api/generate`)
- `wrangler.jsonc` — tells Cloudflare how to deploy

## Deploy
1. Upload everything in this folder to your GitHub repo (keep the structure).
2. Cloudflare → Workers & Pages → Create → Connect GitHub → pick the repo.
   - Build command: leave empty
   - Deploy command: `npx wrangler deploy` (default)
3. After the first deploy: your Worker → Settings → Variables and Secrets → Add
   - Type **Secret**, name `OPENAI_API_KEY`, value = your key → Deploy.
4. Open the `*.workers.dev` link and test with a front-facing photo.

Booking alerts (form -> email):
   - Secret `RESEND_API_KEY` = API key from resend.com (free plan)
   - Secret `NOTIFY_EMAIL` = the email that receives new bookings (must be the email of your Resend account until a domain is verified)
   - Opening hours: edit `HOURS` in public/index.html (booking form script)

Optional (type Text): `OPENAI_IMAGE_MODEL` (default gpt-image-2), `OPENAI_IMAGE_QUALITY` (low / medium / high).
Never put the key in the code or on GitHub.
