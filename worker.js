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
// Secrets to set in Cloudflare: RESEND_API_KEY, NOTIFY_EMAIL (where alerts go).
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

async function handleBook(request, env) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return json({ error: 'Server not configured (RESEND_API_KEY / NOTIFY_EMAIL).' }, 500);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (b.website) return json({ ok: true }); // honeypot: bots fill the hidden field

  const name = clip(b.name, 80);
  let digits = String(b.phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  const procedure = clip(b.procedure, 80);
  const mode = b.mode === 'online' ? 'En ligne (appel vidéo)' : 'Au shop (en personne)';
  const when = clip(b.when, 60);
  if (name.split(' ').length < 2 || digits.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) || !when) {
    return json({ error: 'Missing or invalid fields.' }, 400);
  }

  const phonePretty = `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`;
  const first = name.split(' ')[0];
  const smsBody = `Salut ${first}! C'est Messi de RDV Barbershop. Ta consultation SMP gratuite est confirmée ${when}` +
    (b.mode === 'online' ? ', par appel vidéo. Je t\'envoie le lien juste avant.' : ' au 622 Rue Saint-Thomas, Longueuil.') +
    ' Un empêchement? Réponds juste à ce texto.';
  const smsLink = `sms:+1${digits}?&body=${encodeURIComponent(smsBody)}`;

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#141416">
    <p style="font-size:12px;letter-spacing:2px;color:#FF7A1A;font-weight:bold;margin:0 0 6px">NOUVEAU RENDEZ-VOUS SMP</p>
    <h2 style="margin:0 0 16px">${esc(name)}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      <tr><td style="padding:8px 0;color:#777;width:110px">Quand</td><td style="padding:8px 0"><b>${esc(when)}</b></td></tr>
      <tr><td style="padding:8px 0;color:#777">Téléphone</td><td style="padding:8px 0"><a href="tel:+1${digits}">${phonePretty}</a></td></tr>
      <tr><td style="padding:8px 0;color:#777">Procédure</td><td style="padding:8px 0">${esc(procedure)}</td></tr>
      <tr><td style="padding:8px 0;color:#777">Type</td><td style="padding:8px 0">${esc(mode)}</td></tr>
    </table>
    <p style="margin:22px 0 8px"><a href="${esc(smsLink)}" style="display:inline-block;background:#FF7A1A;color:#1A1407;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:999px">Texter le client pour confirmer</a></p>
    <p style="margin:0 0 18px"><a href="tel:+1${digits}" style="color:#FF7A1A">ou appeler ${phonePretty}</a></p>
    <p style="font-size:13px;color:#777;border-top:1px solid #eee;padding-top:12px">Texto prêt à envoyer :<br><i>${esc(smsBody)}</i></p>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL || 'RDV SMP <onboarding@resend.dev>',
      to: [env.NOTIFY_EMAIL],
      subject: `Nouveau RDV SMP : ${name} — ${when}`,
      html,
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    console.log('Resend error', res && res.status, res && await res.text().catch(() => ''));
    return json({ error: 'Could not send.' }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/book') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return handleBook(request, env);
    }
    if (url.pathname === '/api/generate') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return handleGenerate(request, env);
    }
    return env.ASSETS.fetch(request); // index.html, photos
  },
};
