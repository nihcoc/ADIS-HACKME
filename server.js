require('dotenv').config();
const express = require('express'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const E = process.env, PORT = E.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'data', 'event-state.json');
const PUZZLE_FILE = path.join(__dirname, 'data', 'puzzle.json');
const { SESSION_SECRET, ADMIN_PASSWORD, FINAL_CODE } = E;
if (!SESSION_SECRET || !ADMIN_PASSWORD || !FINAL_CODE) { console.error('Set SESSION_SECRET, ADMIN_PASSWORD and FINAL_CODE.'); process.exit(1); }

const LIMIT = Math.max(1, parseInt(E.AUTO_END_AFTER, 10) || 3); // game auto-ends after this many solvers
// ---- state (memory + JSON file) ----
let S = { status: 'waiting', accum: 0, since: null, board: false, solvers: [], startAt: null, claims: {}, hints: [] };
try { Object.assign(S, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch {}
if (!Array.isArray(S.hints)) S.hints = [];
const save = () => { try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(S)); } catch (e) { console.error('persist failed', e.message); } };
const elapsed = () => S.accum + (S.status === 'running' ? Date.now() - S.since : 0);
const released = (pid, admin) => S.hints
  .map((h, i) => ({ id: h.id || String(i + 1), n: i + 1, text: h.text, target: h.target || 'all' }))
  .filter(h => admin || h.target === 'all' || h.target === classOf(pid));

const pc = new Map(), ac = new Set();
function rankedGuesses() {
  const best = new Map();
  for (const g of S.guessWaterfall || []) if (!best.has(g.cls) || g.score > best.get(g.cls).score) best.set(g.cls, g);
  return [...best.values()].sort((a, b) => b.score - a.score || a.ms - b.ms);
}
function snap(admin, pid) {
  const el = elapsed(), hs = released(pid, admin), ranked = rankedGuesses();
  const s = { status: S.status, elapsedMs: el, hints: hs,
    players: pc.size, limit: LIMIT, startAt: S.status === 'waiting' ? S.startAt : null, untilStartMs: S.status === 'waiting' && S.startAt ? Math.max(0, S.startAt - Date.now()) : null, first: S.solvers.length ? S.solvers[0].ms : null, firstCls: S.solvers.length ? S.solvers[0].cls : null, board: (S.board || S.status === 'ended') ? S.solvers.map((x, i) => ({ rank: i + 1, cls: x.cls, ms: x.ms, at: x.at })) : null,
    proximityBoard: ranked.slice(0, 6).map((x, i) => ({ rank: i + 1, cls: x.cls, score: x.score })) };
  if (admin) {
    const recent = [...(S.guessWaterfall || [])].slice(-10).reverse();
    const overallBest = ranked[0] || null;
    const pings = [...telemetry.values()].filter(x => Date.now() - x.seen < 30000);
    const pingVals = pings.map(x => x.ping).filter(Number.isFinite);
    Object.assign(s, { solvers: S.solvers.map((x, i) => ({ rank: i + 1, cls: x.cls, ms: x.ms, at: x.at })), claimed: Object.keys(S.claims).sort(), boardEnabled: S.board, hintsReleased: hs.length,
      hints: hs, closestGuess: overallBest, bestGuesses: ranked.slice(0, 10), waterfall: recent,
      network: { online: pings.length, avgPing: pingVals.length ? Math.round(pingVals.reduce((a, b) => a + b, 0) / pingVals.length) : null, maxPing: pingVals.length ? Math.max(...pingVals) : null } });
  }
  return s;
}
const send = (r, d) => r.write(`event: state\ndata: ${JSON.stringify(d)}\n\n`);
const broadcast = () => { pc.forEach((pid, r) => send(r, snap(false, pid))); const a = snap(true); ac.forEach(r => send(r, a)); };
setInterval(() => {
  if (S.status === 'waiting' && S.startAt && Date.now() >= S.startAt) { Object.assign(S, { status: 'running', accum: 0, since: Date.now(), startAt: null }); save(); } // scheduled start
  broadcast();
}, 1000);
function sse(req, res, set) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  if (set === pc) set.set(res, req.pid); else set.add(res);
  req.on('close', () => { set.delete(res); broadcast(); });
  send(res, snap(set === ac, req.pid)); if (set === pc) broadcast();
}

const eq = (a, b) => { const h = x => crypto.createHash('sha256').update(String(x)).digest(); return crypto.timingSafeEqual(h(a), h(b)); };

// ---- app ----
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: {
  'upgrade-insecure-requests': null,
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']
} } }));
app.use(express.json({ limit: '2kb' }));
app.use(cookieParser(SESSION_SECRET));
const ck = { httpOnly: true, signed: true, sameSite: 'strict', secure: E.COOKIE_SECURE === 'true' };

app.use('/api', (req, res, next) => {
  let p = req.signedCookies.pid;
  if (!p) { p = crypto.randomBytes(12).toString('hex'); res.cookie('pid', p, { ...ck, maxAge: 3 * 864e5 }); }
  req.pid = p; next();
});

app.get('/api/event', (req, res) => res.json({ ...snap(false, req.pid), solved: S.solvers.some(x => x.pid === req.pid) }));
app.get('/api/stream', (req, res) => sse(req, res, pc));
app.get('/api/puzzle', (req, res) => {
  if (S.status === 'waiting') return res.status(403).json({ error: 'EVENT NOT STARTED' });
  try { res.json(JSON.parse(fs.readFileSync(PUZZLE_FILE, 'utf8'))); } catch { res.status(500).json({ error: 'PUZZLE UNAVAILABLE' }); }
});

const CLASS_RE = /^(?:9[A-G]|10[A-H]|1[12][A-G])$/;
S.claims ||= {};
for (const c of Object.keys(S.claims)) if (!CLASS_RE.test(c)) delete S.claims[c];
const classOf = p => Object.keys(S.claims).find(k => S.claims[k] === p) || null;
const guesses = new Map(), pxUsed = new Map(), telemetry = new Map(); // per player: guesses, proximity checks, network stats

// Closeness of a guess to FINAL_CODE, 0-100. Works for ANY password: it only compares characters.
// 60% "coverage" = share of the password found in the guess as shared chunks (2+ chars, each char used once)
// 40% edit-distance similarity (Levenshtein). Case-insensitive.
function lev(a, b) {
  let p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const c = [i];
    for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[b.length];
}
function cover(a, b) {
  const g = [...a], p = [...b]; let tot = 0;
  for (;;) {
    let best = 0, bi = 0, bj = 0;
    for (let i = 0; i < g.length; i++) for (let j = 0; j < p.length; j++) {
      let k = 0;
      while (i + k < g.length && j + k < p.length && g[i + k] !== null && g[i + k] === p[j + k]) k++;
      if (k > best) { best = k; bi = i; bj = j; }
    }
    if (best < 2) return tot;
    for (let k = 0; k < best; k++) { g[bi + k] = null; p[bj + k] = null; }
    tot += best;
  }
}
const score = guess => {
  const a = guess.toLowerCase(), b = FINAL_CODE.toLowerCase();
  return Math.round(100 * (0.6 * Math.min(1, cover(a, b) / b.length) + 0.4 * Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length))));
};
const tier = s => s >= 70 ? 'HOT' : s >= 35 ? 'WARM' : 'COLD';
const subLimit = rateLimit({ windowMs: 60e3, limit: 30, keyGenerator: req => req.pid, standardHeaders: true, legacyHeaders: false, message: { error: 'TOO MANY REQUESTS' } });
app.post('/api/submit', subLimit, (req, res) => {
  const { code } = req.body || {};
  if (typeof code !== 'string' || !code.trim() || code.length > 100) return res.status(400).json({ error: 'INVALID INPUT' });
  const cls = classOf(req.pid);
  if (!cls) return res.status(400).json({ error: 'SELECT A CLASS' });
  if (S.status !== 'running') return res.status(403).json({ error: 'EVENT NOT ACTIVE' });
  if (S.solvers.some(x => x.pid === req.pid)) return res.status(409).json({ error: 'ALREADY SOLVED' });
  if (eq(code.trim(), FINAL_CODE)) {
    const ms = elapsed(); S.solvers.push({ cls, ms, at: new Date().toISOString(), pid: req.pid });
    const solvedClasses = new Set(S.solvers.map(x => x.cls)).size;
    if (solvedClasses >= LIMIT && S.status === 'running') Object.assign(S, { accum: elapsed(), since: null, status: 'ended' });
    save(); broadcast();
    return res.json({ ok: true, ms, rank: S.solvers.length });
  }
  const gs = guesses.get(req.pid) || []; gs.push({ g: code.trim(), s: score(code.trim()) }); guesses.set(req.pid, gs.slice(-200));
  const sc = score(code.trim());
  if (!Array.isArray(S.guessWaterfall)) S.guessWaterfall = [];
  S.guessWaterfall.push({ cls, guess: code.trim(), score: sc, tier: tier(sc), ms: elapsed(), at: new Date().toISOString() });
  if (S.guessWaterfall.length > 500) S.guessWaterfall.splice(0, S.guessWaterfall.length - 500);
  save();
  broadcast();
  res.status(401).json({ error: 'ACCESS DENIED' });
});

app.post('/api/ping', subLimit, (req, res) => {
  const cls = classOf(req.pid), ping = Number(req.body && req.body.ping);
  if (!cls || !Number.isFinite(ping) || ping < 0 || ping > 60000) return res.status(400).json({ error: 'INVALID PING' });
  const old = telemetry.get(req.pid), samples = [...(old ? old.samples : []), Math.round(ping)].slice(-10);
  telemetry.set(req.pid, { cls, ping: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length), samples, seen: Date.now() });
  res.json({ ok: true });
});

app.get('/api/classes', (req, res) => res.json({ taken: Object.keys(S.claims), mine: classOf(req.pid) }));
app.post('/api/class', subLimit, (req, res) => {
  const c = req.body && req.body.cls;
  if (typeof c !== 'string' || !CLASS_RE.test(c)) return res.status(400).json({ error: 'INVALID CLASS' });
  const mine = classOf(req.pid);
  if (mine) return res.json({ ok: true, cls: mine });
  if (S.claims[c]) return res.status(409).json({ error: 'CLASS TAKEN' });
  S.claims[c] = req.pid; save(); res.json({ ok: true, cls: c });
});
// On request, a player sees the hottest and coldest of their own wrong guesses (5 requests each).
app.post('/api/proximity', subLimit, (req, res) => {
  if (S.status !== 'running') return res.status(403).json({ error: 'EVENT NOT ACTIVE' });
  const gs = guesses.get(req.pid) || [], n = pxUsed.get(req.pid) || 0;
  if (!gs.length) return res.status(400).json({ error: 'SUBMIT A GUESS FIRST' });
  if (n >= 5) return res.status(403).json({ error: 'NO PROXIMITY CHECKS LEFT', checksLeft: 0 });
  pxUsed.set(req.pid, n + 1);
  const hot = gs.reduce((a, b) => b.s > a.s ? b : a), cold = gs.reduce((a, b) => b.s < a.s ? b : a), o = x => ({ guess: x.g, tier: tier(x.s), score: x.s });
  res.json({ hot: o(hot), cold: o(cold), checksLeft: 4 - n });
});

// ---- admin ----
const sessions = new Map();
const isAdmin = req => { const t = req.signedCookies.adm, x = t && sessions.get(t); return !!x && x > Date.now(); };
const need = (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: 'UNAUTHORIZED' });
const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'TOO MANY ATTEMPTS' } });
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
app.post('/api/admin/login', loginLimit, (req, res) => {
  const pw = req.body && req.body.password;
  if (typeof pw !== 'string' || pw.length > 200 || !eq(pw, ADMIN_PASSWORD)) return res.status(401).json({ error: 'DENIED' });
  const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now() + 8 * 3600e3);
  res.cookie('adm', t, { ...ck, maxAge: 8 * 3600e3 }).json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { sessions.delete(req.signedCookies.adm); res.clearCookie('adm').json({ ok: true }); });
app.get('/api/admin/me', need, (req, res) => res.json({ ok: true }));
app.get('/api/admin/state', need, (req, res) => res.json(snap(true)));
app.get('/api/admin/stream', need, (req, res) => sse(req, res, ac));
app.post('/api/admin/action', need, (req, res) => {
  const a = req.body && req.body.action, now = Date.now();
  if (a === 'start' && S.status === 'waiting') Object.assign(S, { status: 'running', accum: 0, since: now, startAt: null });
  else if (a === 'pause' && S.status === 'running') Object.assign(S, { accum: elapsed(), since: null, status: 'paused' });
  else if (a === 'resume' && S.status === 'paused') Object.assign(S, { status: 'running', since: now });
  else if (a === 'end' && (S.status === 'running' || S.status === 'paused')) Object.assign(S, { accum: elapsed(), since: null, status: 'ended' });
  else if (a === 'reset') { Object.assign(S, { status: 'waiting', accum: 0, since: null, solvers: [], startAt: null, claims: {}, hints: [], guessWaterfall: [] }); guesses.clear(); pxUsed.clear(); telemetry.clear(); }
  else return res.status(400).json({ error: 'INVALID ACTION' });
  save(); broadcast(); res.json({ ok: true });
});
app.post('/api/admin/config', need, (req, res) => {
  const { board, startAt } = req.body || {};
  if (startAt !== undefined) {
    if (S.status !== 'waiting') return res.status(400).json({ error: 'EVENT ALREADY STARTED' });
    if (startAt === null) S.startAt = null;
    else if (Number.isFinite(startAt) && startAt > Date.now()) S.startAt = Math.floor(startAt);
    else return res.status(400).json({ error: 'PICK A FUTURE TIME' });
  }
  if (board !== undefined) S.board = board === true;
  save(); broadcast(); res.json({ ok: true });
});

app.post('/api/admin/release', need, (req, res) => {
  const c = req.body && req.body.cls;
  if (typeof c !== 'string' || !S.claims[c]) return res.status(400).json({ error: 'NOT CLAIMED' });
  delete S.claims[c]; save(); broadcast(); res.json({ ok: true });
});

app.post('/api/admin/message', need, (req, res) => {
  const text = typeof (req.body && req.body.text) === 'string' ? req.body.text.trim() : '';
  const targetRaw = typeof (req.body && req.body.target) === 'string' ? req.body.target.trim().toUpperCase() : 'ALL';
  const target = !targetRaw || targetRaw === 'ALL' ? 'all' : targetRaw;
  if (!text || text.length > 500) return res.status(400).json({ error: 'MESSAGE MUST BE 1–500 CHARACTERS' });
  if (target !== 'all' && !CLASS_RE.test(target)) return res.status(400).json({ error: 'ENTER ALL OR A VALID CLASS' });
  if (S.hints.length >= 100) return res.status(400).json({ error: 'MESSAGE LIMIT REACHED; RESET THE EVENT TO CLEAR MESSAGES' });
  S.hints.push({ id: crypto.randomBytes(8).toString('hex'), text, target, at: new Date().toISOString() });
  save(); broadcast(); res.json({ ok: true, n: S.hints.length });
});

// ---- static files: served from the project root (no public/ folder) ----
// Only an allowlist of paths is exposed, so server.js, .env, data/ and views/ are never reachable.
const serve = express.static(__dirname, { dotfiles: 'ignore', setHeaders: (res, f) => { if (/[\\/]assets[\\/]/.test(f)) res.set('Cache-Control', 'public, max-age=3600'); } });
const OPEN = ['/css/', '/js/', '/assets/'];
app.use((req, res, next) => {
  const p = req.path;
  if (p.includes('..')) return res.status(400).end();
  if (p === '/' || p === '/index.html' || OPEN.some(o => p.startsWith(o))) {
    if (p.startsWith('/assets/grammie/') && S.status === 'waiting') return res.status(403).end();
    return serve(req, res, next);
  }
  res.status(404).end();
});

app.listen(PORT, () => console.log(`PassTrace listening on :${PORT}`));
