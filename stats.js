// Anonymous funnel tracking for the SMP site: one row per (session, screen). No names, emails or IP addresses.
// Stored in the D1 database bound as STATS. The dashboard (public/stats.html) reads it with the coach password.
const TZ = 'America/Toronto';
const todayMtl = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const STEPS = ['landing', 'preview', 'photo', 'generated', 'limit', 'form', 'formstart', 'done', 'booksy'];
const SRCS = ['instagram', 'tiktok', 'facebook', 'google', 'youtube', 'direct', 'other'];
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

let ready = false;
async function db(env) {
  if (!env.STATS) return null;
  if (!ready) {
    await env.STATS.prepare('CREATE TABLE IF NOT EXISTS ev (ts INTEGER, day TEXT, sid TEXT, step TEXT, src TEXT, g TEXT, lang TEXT, dev TEXT, heard TEXT, UNIQUE(sid, step))').run();
    await env.STATS.prepare('CREATE INDEX IF NOT EXISTS ev_day ON ev (day)').run();
    ready = true;
  }
  return env.STATS;
}

// POST /api/track  {sid, s, src, g, l, d, h}
export async function handleTrack(request, env) {
  let b; try { b = JSON.parse(await request.text()); } catch { return new Response(null, { status: 400 }); }
  if (!b || !/^[a-z0-9]{8,32}$/.test(b.sid || '') || !STEPS.includes(b.s)) return new Response(null, { status: 400 });
  const d = await db(env); if (!d) return new Response(null, { status: 204 });
  await d.prepare('INSERT OR IGNORE INTO ev (ts, day, sid, step, src, g, lang, dev, heard) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), todayMtl(), b.sid, b.s, SRCS.includes(b.src) ? b.src : 'other', ['m', 'f'].includes(b.g) ? b.g : '',
      b.l === 'en' ? 'en' : 'fr', b.d === 'm' ? 'm' : 'd', String(b.h || '').slice(0, 20)).run();
  return new Response(null, { status: 204 });
}

// GET /api/stats?days=30  (header x-pw = coach password)
export async function handleStats(url, env) {
  const d = await db(env);
  if (!d) return json({ error: 'no_db' }, 503);
  const n = Math.min(Math.max(parseInt(url.searchParams.get('days')) || 30, 1), 365);
  const from = addDays(todayMtl(), -(n - 1));
  const all = async (sql) => (await d.prepare(sql).bind(from).all()).results;
  const cnt = s => `COUNT(DISTINCT CASE WHEN step='${s}' THEN sid END)`;
  const [funnel, sources, daily, devices, genders, langs, heard] = await Promise.all([
    all('SELECT step, COUNT(DISTINCT sid) AS n FROM ev WHERE day >= ? GROUP BY step'),
    all(`SELECT src, ${cnt('landing')} AS visits, ${cnt('photo')} AS started, ${cnt('generated')} AS qualified, ${cnt('done')} AS booked FROM ev WHERE day >= ? GROUP BY src ORDER BY visits DESC`),
    all(`SELECT day, ${cnt('landing')} AS visits, ${cnt('generated')} AS started, ${cnt('done')} AS booked FROM ev WHERE day >= ? GROUP BY day ORDER BY day`),
    all(`SELECT dev AS k, ${cnt('landing')} AS visits, ${cnt('done')} AS booked FROM ev WHERE day >= ? GROUP BY dev`),
    all("SELECT heard AS k, COUNT(*) AS n FROM ev WHERE day >= ? AND step = 'generated' GROUP BY heard"),
    all(`SELECT lang AS k, ${cnt('landing')} AS visits, ${cnt('done')} AS booked FROM ev WHERE day >= ? GROUP BY lang`),
    all("SELECT heard AS k, COUNT(*) AS n FROM ev WHERE day >= ? AND step = 'done' GROUP BY heard ORDER BY n DESC"),
  ]);
  return json({ from, days: n, funnel, sources, daily, devices, genders, langs, heard });
}
