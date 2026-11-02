// Cloudflare Worker — serves the site from /public and handles POST /api/generate
// Receives the client's photo + choices, asks OpenAI to render an SMP preview, returns { image: "data:image/png;base64,..." }.
// The OpenAI key lives ONLY in Cloudflare (Settings > Variables and Secrets > OPENAI_API_KEY). Never put it in index.html.

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const STYLE = {
  natural: 'a natural, soft, slightly irregular front hairline with a gradual feathered transition into the forehead, age-appropriate temples',
  sharp: 'a crisp, defined, straight "line-up" front hairline with clean edges, like a fresh barber line-up',
  density: 'NO change to the existing hairline position: only add density to thinning areas behind the current hairline',
};
const DENSITY = {
  light: 'light density, a subtle soft shadow like a very short buzz cut',
  medium: 'medium density, like a fresh 0.5 guard buzz cut',
  full: 'full density, a strong dark shaved-head look like a fresh 1 guard buzz cut',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function handleGenerate(request, env) {
  if (!env.OPENAI_API_KEY) return json({ error: 'Server not configured (missing OPENAI_API_KEY).' }, 500);

  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Bad request.' }, 400); }

  const photo = form.get('photo');
  const style = STYLE[form.get('style')] ? form.get('style') : 'natural';
  const density = DENSITY[form.get('density')] ? form.get('density') : 'medium';

  if (!photo || typeof photo === 'string') return json({ error: 'No photo.' }, 400);
  if (!/^image\//.test(photo.type || 'image/jpeg')) return json({ error: 'File must be an image.' }, 400);
  if (photo.size > MAX_BYTES) return json({ error: 'Photo too large (max 8 MB).' }, 400);

  const prompt = [
    'Photo edit for a scalp micropigmentation (SMP) consultation preview.',
    'Keep the SAME person: identical face, skin tone, facial features, expression, beard, clothing, background, lighting and camera angle. Do not beautify or change anything except the scalp.',
    'On the scalp, render realistic SMP: thousands of tiny pigment dots that look like freshly shaved hair follicles, matching the person\'s natural hair color and skin tone, following the curvature and lighting of the head.',
    `Hairline: ${STYLE[style]}.`,
    `Density: ${DENSITY[density]}.`,
    'The result must look like a real, unedited photograph — no drawn lines, no text, no watermark, no plastic skin.',
  ].join(' ');

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
