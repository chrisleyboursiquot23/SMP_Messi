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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/generate') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return handleGenerate(request, env);
    }
    return env.ASSETS.fetch(request); // index.html, photos
  },
};
