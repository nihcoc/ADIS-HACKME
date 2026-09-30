require('dotenv').config();
const express = require('express'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const E = process.env, PORT = E.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'data', 'event-state.json');
const PUZZLE_FILE = path.join(__dirname, 'data', 'puzzle.json');
const { SESSION_SECRET, ADMIN_PASSWORD, FINAL_CODE } = E;
if (!SESSION_SECRET || !ADMIN_PASSWORD || !FINAL_CODE) { console.error('Set SESSION_SECRET, ADMIN_PASSWORD and FINAL_CODE.'); process.exit(1); }

const env = (k, d) => (E[k] && !E[k].startsWith('replace-with') ? E[k] : d);
const HINTS = [
  env('HINT_1', 'Start by looking for personal information that appears across the fictional person\'s different profiles.'),
  env('HINT_2', 'Inspect the descriptions attached to the Grammie photographs, then compare what you discover with the professional information on Linkout.'),
  env('HINT_3', 'One clue gives you a personal name. Another gives you a meaningful year. Think about how people commonly combine those things when creating weak passwords.')
];
const parseTimes = s => { const a = String(s).split(',').map(Number); return a.length === 3 && a.every(n => isFinite(n) && n >= 0 && n <= 600) ? a : null; };

// ---- state (memory + JSON file) ----
let S = { status: 'waiting', accum: 0, since: null, times: parseTimes(E.HINT_TIMES_MINUTES) || [10, 20, 30], board: false, solvers: [] };
try { Object.assign(S, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch {}
const save = () => { try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(S)); } catch (e) { console.error('persist failed', e.message); } };
const elapsed = () => S.accum + (S.status === 'running' ? Date.now() - S.since : 0);
const released = () => S.status === 'waiting' ? [] : HINTS.map((text, i) => ({ n: i + 1, text, at: S.times[i] * 6e4 })).filter(h => elapsed() >= h.at).map(({ n, text }) => ({ n, text }));

const pc = new Set(), ac = new Set();
function snap(admin) {
  const el = elapsed(), hs = released(), next = S.times.map(t => t * 6e4).find(t => t > el);
  const s = { status: S.status, elapsedMs: el, hints: hs, nextHintMs: S.status !== 'waiting' && next !== undefined ? next - el : null,
    players: pc.size, board: S.board ? S.solvers.map((x, i) => ({ rank: i + 1, nick: x.nick, ms: x.ms })) : null };
  if (admin) Object.assign(s, { solvers: S.solvers.map((x, i) => ({ rank: i + 1, nick: x.nick, ms: x.ms, at: x.at })), times: S.times, boardEnabled: S.board, hintsReleased: hs.length });
  return s;
}
const send = (r, d) => r.write(`event: state\ndata: ${JSON.stringify(d)}\n\n`);
const broadcast = () => { const p = snap(false), a = snap(true); pc.forEach(r => send(r, p)); ac.forEach(r => send(r, a)); };
setInterval(broadcast, 1000);
function sse(req, res, set) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); set.add(res); req.on('close', () => { set.delete(res); broadcast(); });
  send(res, snap(set === ac)); if (set === pc) broadcast();
}

const eq = (a, b) => { const h = x => crypto.createHash('sha256').update(String(x)).digest(); return crypto.timingSafeEqual(h(a), h(b)); };

// ---- app ----
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } } }));
app.use(express.json({ limit: '2kb' }));
app.use(cookieParser(SESSION_SECRET));
const ck = { httpOnly: true, signed: true, sameSite: 'strict', secure: E.COOKIE_SECURE === 'true' };

app.use('/api', (req, res, next) => {
  let p = req.signedCookies.pid;
  if (!p) { p = crypto.randomBytes(12).toString('hex'); res.cookie('pid', p, { ...ck, maxAge: 3 * 864e5 }); }
  req.pid = p; next();
});

app.get('/api/event', (req, res) => res.json({ ...snap(false), solved: S.solvers.some(x => x.pid === req.pid) }));
app.get('/api/stream', (req, res) => sse(req, res, pc));
app.get('/api/puzzle', (req, res) => {
  if (S.status === 'waiting') return res.status(403).json({ error: 'EVENT NOT STARTED' });
  try { res.json(JSON.parse(fs.readFileSync(PUZZLE_FILE, 'utf8'))); } catch { res.status(500).json({ error: 'PUZZLE UNAVAILABLE' }); }
});

const att = new Map();
const subLimit = rateLimit({ windowMs: 60e3, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'TOO MANY REQUESTS' } });
app.post('/api/submit', subLimit, (req, res) => {
  const { nickname, code } = req.body || {};
  const nick = typeof nickname === 'string' ? nickname.trim() : '';
  if (!/^[\w .-]{1,20}$/.test(nick) || typeof code !== 'string' || !code.trim() || code.length > 100) return res.status(400).json({ error: 'INVALID INPUT' });
  if (S.status !== 'running') return res.status(403).json({ error: 'EVENT NOT ACTIVE' });
  if (S.solvers.some(x => x.pid === req.pid)) return res.status(409).json({ error: 'ALREADY SOLVED' });
  const now = Date.now(), a = att.get(req.pid) || { f: 0, until: 0 };
  if (now < a.until) return res.status(429).json({ error: 'COOLDOWN', retryAfter: Math.ceil((a.until - now) / 1000) });
  if (eq(code.trim(), FINAL_CODE)) {
    const ms = elapsed(); S.solvers.push({ nick, ms, at: new Date().toISOString(), pid: req.pid }); save(); broadcast();
    return res.json({ ok: true, ms, rank: S.solvers.length });
  }
  if (++a.f >= 5) { a.f = 0; a.until = now + 30e3; }
  att.set(req.pid, a);
  res.status(401).json({ error: 'ACCESS DENIED', cooldown: a.until > now ? 30 : 0 });
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
app.get('/api/admin/stream', need, (req, res) => sse(req, res, ac));
app.post('/api/admin/action', need, (req, res) => {
  const a = req.body && req.body.action, now = Date.now();
  if (a === 'start' && S.status === 'waiting') Object.assign(S, { status: 'running', accum: 0, since: now });
  else if (a === 'pause' && S.status === 'running') Object.assign(S, { accum: elapsed(), since: null, status: 'paused' });
  else if (a === 'resume' && S.status === 'paused') Object.assign(S, { status: 'running', since: now });
  else if (a === 'end' && (S.status === 'running' || S.status === 'paused')) Object.assign(S, { accum: elapsed(), since: null, status: 'ended' });
  else if (a === 'reset') { Object.assign(S, { status: 'waiting', accum: 0, since: null, solvers: [] }); att.clear(); }
  else return res.status(400).json({ error: 'INVALID ACTION' });
  save(); broadcast(); res.json({ ok: true });
});
app.post('/api/admin/config', need, (req, res) => {
  const { times, board } = req.body || {};
  if (times !== undefined) { const t = Array.isArray(times) ? parseTimes(times.join(',')) : null; if (!t) return res.status(400).json({ error: 'INVALID TIMES' }); S.times = t; }
  if (board !== undefined) S.board = board === true;
  save(); broadcast(); res.json({ ok: true });
});

// ---- static files: served from the project root (no public/ folder) ----
// Only an allowlist of paths is exposed, so server.js, .env, data/ and views/ are never reachable.
const serve = express.static(__dirname, { dotfiles: 'ignore' });
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

app.listen(PORT, () => console.log(`BREACH PROTOCOL listening on :${PORT}`));
