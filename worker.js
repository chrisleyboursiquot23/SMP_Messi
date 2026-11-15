// Cloudflare Worker — serves the site from /public and handles POST /api/generate
// Receives the client's photo + choices, asks OpenAI to render an SMP preview, returns { image: "data:image/png;base64,..." }.
// The OpenAI key lives ONLY in Cloudflare (Settings > Variables and Secrets > OPENAI_API_KEY). Never put it in the code.

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

// Allowed values for each option -> the instruction sent to the AI
const LOOK = {
  shaved: 'Render the head as a freshly buzzed, shaved head: any existing hair is clipped to a uniform very short length (like a 0.5 guard). Add SMP ONLY in the treated areas listed below; the rest of the scalp keeps its natural look, just clipped short.',
  keep: 'Keep the person\'s existing hair length and style exactly as it is (do NOT shave). Add SMP pigment dots between the existing hairs in the treated areas so thin and see-through spots look dense and full.',
};
const AREAS = {
  hairline: 'ONLY the receded front corners of the hairline (the frontal recessions / "golfes" on the left and right of the forehead): fill them in so the front hairline becomes continuous and even. Do not add pigment anywhere else on the scalp for this area',
  temples: 'the temple points on the sides of the head, above and in front of the ears, down toward the sideburns',
  crown: 'the crown / vertex at the top-back of the head',
  full: 'the entire scalp, front to back and side to side',
};
const EDGE = {
  soft: 'Hairline edge: soft and natural, with a gradual, slightly irregular feathered transition into the forehead.',
  sharp: 'Hairline edge: crisp and defined, like a fresh barber edge-up / line-up.',
};
const POSITION = {
  keep: 'Keep the front hairline at its current position.',
  lower: 'Lower the front hairline by about 1 cm: a modest, age-appropriate restoration.',
  lowest: 'Lower the front hairline by about 2 cm toward a fuller, more youthful hairline that still looks natural for this face.',
};
const SHAPE = {
  rounded: 'Hairline shape: gently rounded, curving back slightly at the temples.',
  straight: 'Hairline shape: straight across the forehead with defined corners.',
  widow: 'Hairline shape: a subtle widow\'s peak (soft V point in the center).',
};
const PIGMENT = {
  light: 'Pigment tone: light and soft — dots slightly lighter than the person\'s natural hair color.',
  medium: 'Pigment tone: medium — dots matching the person\'s natural hair color.',
  dark: 'Pigment tone: dark — dots slightly darker for a bolder, fresh-cut shadow.',
};
const COVERAGE = {
  subtle: 'Density: subtle, a light shadow effect.',
  natural: 'Density: natural, like real short hair follicles.',
  full: 'Density: full and strong, a dense, dark buzz-cut look.',
};

const pick = (map, v, dflt) => (Object.prototype.hasOwnProperty.call(map, v) ? v : dflt);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function handleGenerate(request, env) {
  if (!env.OPENAI_API_KEY) return json({ error: 'Server not configured (missing OPENAI_API_KEY).' }, 500);

  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Bad request.' }, 400); }

  const photo = form.get('photo');
  if (!photo || typeof photo === 'string') return json({ error: 'No photo.' }, 400);
  if (!/^image\//.test(photo.type || 'image/jpeg')) return json({ error: 'File must be an image.' }, 400);
  if (photo.size > MAX_BYTES) return json({ error: 'Photo too large (max 8 MB).' }, 400);

  const look = pick(LOOK, form.get('look'), 'shaved');
  let areas = String(form.get('areas') || '').split(',').filter(a => Object.prototype.hasOwnProperty.call(AREAS, a));
  if (!areas.length) areas = ['hairline'];
  if (areas.includes('full')) areas = ['full'];
  const edge = pick(EDGE, form.get('edge'), 'soft');
  const position = pick(POSITION, form.get('position'), 'keep');
  const shape = pick(SHAPE, form.get('shape'), 'rounded');
  const pigment = pick(PIGMENT, form.get('pigment'), 'medium');
  const coverage = pick(COVERAGE, form.get('coverage'), 'natural');
  // Free-text note from the client: short, single line, used as a style preference only
  const notes = String(form.get('notes') || '').replace(/[\r\n\t]+/g, ' ').replace(/[<>{}]/g, '').trim().slice(0, 200);

  const touchesHairline = areas.includes('hairline') || areas.includes('full');

  const prompt = [
    'Photo edit for a scalp micropigmentation (SMP) consultation preview.',
    'Keep the SAME person: identical face, skin tone, facial features, expression, beard, ears, clothing, background, lighting and camera angle. Do not beautify, slim, smooth or change anything except the scalp/hair area described below.',
    'SMP = thousands of tiny pigment dots that look like freshly shaved hair follicles, matching the person\'s skin tone, following the curvature and lighting of the head, with realistic skin texture still visible between the dots.',
    LOOK[look],
    `Treated areas: ${areas.map(a => AREAS[a]).join('; ')}. IMPORTANT: modify ONLY these areas. Every other part of the scalp and hair must stay exactly as in the original photo.`,
    touchesHairline ? `${EDGE[edge]} ${POSITION[position]} ${SHAPE[shape]}` : 'Do not change the position or shape of the front hairline.',
    PIGMENT[pigment],
    COVERAGE[coverage],
    notes ? `Client style preference (apply only if it concerns the scalp/hairline): "${notes}".` : '',
    'The result must look like a real, unedited photograph — no drawn lines, no text, no watermark, no plastic or airbrushed skin.',
  ].filter(Boolean).join(' ');

  const body = new FormData();
  body.append('model', env.OPENAI_IMAGE_MODEL || 'gpt-image-2');
  body.append('image', photo, 'photo.jpg');
  body.append('prompt', prompt);
  body.append('quality', env.OPENAI_IMAGE_QUALITY || 'medium');
  body.append('size', 'auto');
  body.append('n', '1');

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body,
    });
  } catch {
    return json({ error: 'Could not reach OpenAI.' }, 502);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.data || !data.data[0] || !data.data[0].b64_json) {
    console.log('OpenAI error', res.status, JSON.stringify(data && data.error));
    return json({ error: 'Preview failed.' }, 502);
  }
  return json({ image: 'data:image/png;base64,' + data.data[0].b64_json });
}

// ---- Booking requests: POST /api/book -> email alert (via Resend) ----
// Secrets to set in Cloudflare: RESEND_API_KEY, NOTIFY_EMAIL (where alerts go, several allowed: a@x.com,b@y.com).
const MESSI_EMAIL = 'rdvbarbershop@gmail.com'; // Messi always gets the booking email
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

async function handleBook(request, env, ctx) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return json({ error: 'Server not configured (RESEND_API_KEY / NOTIFY_EMAIL).' }, 500);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (b.website) return json({ ok: true }); // honeypot: bots fill the hidden field

  const name = clip(b.name, 80);
  let digits = String(b.phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  const email = clip(b.email, 120).toLowerCase();
  const procedure = clip(b.procedure, 80);
  const mode = b.mode === 'online' ? 'En ligne (appel vidéo)' : 'Au shop (en personne)';
  const when = clip(b.when, 60);
  if (name.split(' ').length < 2 || digits.length !== 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) || !when) {
    return json({ error: 'Missing or invalid fields.' }, 400);
  }

  const phonePretty = `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`;
  const first = name.split(' ')[0];
  const en = b.lang === 'en';
  const smsBody = en
    ? `Hi ${first}, this is Messi from RDV Barbershop. Your free SMP consultation is confirmed for ${clip(b.whenEn || when, 60)}` +
      (b.mode === 'online' ? ', by video call. I\'ll send you the link right before.' : ', at 622 Rue Saint-Thomas, Longueuil.') +
      " If something comes up, just reply to this message."
    : `Bonjour ${first}, ici Messi de RDV Barbershop. Ta consultation SMP gratuite est confirmée ${when}` +
    (b.mode === 'online' ? ', par appel vidéo. Je t\'enverrai le lien juste avant.' : ', au 622 Rue Saint-Thomas, Longueuil.') +
    ' En cas d\'empêchement, réponds simplement à ce message.';
  // Gmail strips sms: links, so the button opens a page on our site that launches Messages
  const smsLink = `${new URL(request.url).origin}/api/texto?n=${digits}&b=${encodeURIComponent(smsBody).replace(/'/g, '%27')}`;

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#141416">
    <p style="font-size:12px;letter-spacing:2px;color:#FF7A1A;font-weight:bold;margin:0 0 6px">NOUVEAU RENDEZ-VOUS SMP</p>
    <h2 style="margin:0 0 16px">${esc(name)}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      <tr><td style="padding:8px 0;color:#777;width:110px">Quand</td><td style="padding:8px 0"><b>${esc(when)}</b></td></tr>
      <tr><td style="padding:8px 0;color:#777">Téléphone</td><td style="padding:8px 0"><a href="tel:+1${digits}">${phonePretty}</a></td></tr>
      <tr><td style="padding:8px 0;color:#777">Courriel</td><td style="padding:8px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
      <tr><td style="padding:8px 0;color:#777">Procédure</td><td style="padding:8px 0">${esc(procedure)}</td></tr>
      <tr><td style="padding:8px 0;color:#777">Type</td><td style="padding:8px 0">${esc(mode)}</td></tr>
      <tr><td style="padding:8px 0;color:#777">Langue</td><td style="padding:8px 0">${en ? '<b>Anglais</b> (le texto est prêt en anglais)' : 'Français'}</td></tr>
    </table>
    <p style="margin:22px 0 8px"><a href="${esc(smsLink)}" style="display:inline-block;background:#FF7A1A;color:#1A1407;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:999px">Texter le client pour confirmer</a></p>
    <p style="margin:0 0 18px"><a href="tel:+1${digits}" style="color:#FF7A1A">ou appeler ${phonePretty}</a></p>
    <p style="font-size:13px;color:#777;border-top:1px solid #eee;padding-top:12px">Texto prêt à envoyer :<br><i>${esc(smsBody)}</i></p>
  </div>`;

  // Keep the lead first, so it is never lost even if an email fails
  const SRC = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', google: 'Google', youtube: 'YouTube', direct: 'Direct', other: 'Autre site' };
  const leadRow = { name, phone: phonePretty, email, procedure, mode, preview: clip(b.preview, 80) || 'Non', src: SRC[b.src] || 'Direct', lang: en ? 'Anglais' : 'Français' };
  try { await saveLead(env, { call_when: when, ...leadRow }); } catch (e) { console.log('saveLead error', e && e.message); }
  const job = pushSheet(env, { type: 'lead', when, ...leadRow }); // Google Sheet (Rendez-vous tab)
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;

  // One email per recipient: NOTIFY_EMAIL (can hold several, separated by commas) + Messi's shop address
  const to = [...new Set(String(env.NOTIFY_EMAIL || '').split(',').concat(MESSI_EMAIL).map(x => x.trim().toLowerCase()).filter(x => x.includes('@')))];
  const sent = await Promise.all(to.map(async addr => {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.FROM_EMAIL || 'RDV SMP <onboarding@resend.dev>', to: [addr], subject: `Nouveau RDV SMP : ${name} — ${when}`, html }),
    }).catch(() => null);
    if (!r || !r.ok) console.log('Resend error', addr, r && r.status, r && await r.text().catch(() => ''));
    return !!(r && r.ok);
  }));
  if (!sent.some(Boolean)) return json({ error: 'Could not send.' }, 502);
  return json({ ok: true });
}

// Sends one row to the Google Sheet through its Apps Script web app (secrets SHEET_URL + SHEET_SECRET in Cloudflare).
// Small page that opens the phone's Messages app with the confirmation text ready (email apps block sms: links)
function textoPage(url) {
  const n = (url.searchParams.get('n') || '').replace(/\D/g, '').slice(-10), body = (url.searchParams.get('b') || '').slice(0, 600);
  const e = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sms = `sms:+1${n}?&body=${encodeURIComponent(body)}`, pretty = n.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2-$3');
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Texter ${e(pretty)}</title>
<style>body{margin:0;background:#000;color:#fff;font:16px/1.5 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}main{max-width:420px;padding:24px;text-align:center}
a.b,button{display:block;width:100%;box-sizing:border-box;border:0;border-radius:14px;background:#FF7A1A;color:#1A1407;font:800 16px system-ui;padding:16px;text-decoration:none;margin-top:14px;cursor:pointer}
button{background:none;color:#fff;border:1.5px solid #444}p.m{background:#1b1b1b;border-radius:16px;padding:14px;text-align:left;color:#ddd;white-space:pre-line;margin-top:18px}small{color:#888}</style></head>
<body><main><h2 style="margin:0">Texter ${e(pretty)}</h2><p class="m" id="m">${e(body)}</p>
<a class="b" href="${e(sms)}">Ouvrir Messages</a><button id="c">Copier le texte</button><a class="b" style="background:none;color:#FF7A1A" href="tel:+1${n}">Appeler ${e(pretty)}</a>
<small>Si Messages ne s'ouvre pas, copie le texte et envoie-le au ${e(pretty)}.</small></main>
<script>document.getElementById('c').onclick=function(){navigator.clipboard.writeText(document.getElementById('m').textContent).then(()=>{this.textContent='Texte copié ✓'})};setTimeout(function(){location.href=${JSON.stringify(sms)}},400);</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function pushSheet(env, row) {
  if (!env.SHEET_URL || !env.SHEET_SECRET) return;
  try {
    const r = await fetch(env.SHEET_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...row, secret: env.SHEET_SECRET }) });
    if (!r.ok) console.log('sheet error', r.status);
  } catch (e) { console.log('sheet error', e && e.message); }
}

import { handleTrack, handleStats, saveLead, handleLeads } from './stats.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/texto') return textoPage(url);
    if (url.pathname === '/api/book') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return handleBook(request, env, ctx);
    }
    if (url.pathname === '/api/generate') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return handleGenerate(request, env);
    }
    if (url.pathname === '/api/track') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return handleTrack(request, env);
    }
    if (url.pathname === '/api/stats' || url.pathname === '/api/leads') {
      const pw = request.headers.get('x-pw') || '';
      if (!env.STATS_PASSWORD || pw.length !== env.STATS_PASSWORD.length || pw !== env.STATS_PASSWORD) return json({ error: 'unauthorized' }, 401);
      return url.pathname === '/api/stats' ? handleStats(url, env) : handleLeads(url, env);
    }
    const res = await env.ASSETS.fetch(request); // index.html, photos
    // Link previews (Facebook, iMessage, WhatsApp) need absolute URLs: fill them in from the current domain
    if ((res.headers.get('content-type') || '').includes('text/html')) {
      return new HTMLRewriter()
        .on('meta[property="og:image"]', { element: e => e.setAttribute('content', url.origin + '/img/og.jpg') })
        .on('meta[property="og:url"]', { element: e => e.setAttribute('content', url.origin + url.pathname) })
        .transform(res);
    }
    return res;
  },
};
