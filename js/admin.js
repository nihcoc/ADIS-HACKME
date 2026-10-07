const $ = s => document.querySelector(s);
const fmt = ms => { const s = Math.floor(ms / 1000); return [s / 3600 | 0, (s / 60) % 60 | 0, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const gst = t => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' GST';
const post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
function live() {
  $('#login').hidden = true; $('#panel').hidden = false;
  const es = new EventSource('/api/admin/stream');
  const render = s => {
    $('#info').textContent = `Status: ${s.status.toUpperCase()} | Elapsed: ${fmt(s.elapsedMs)} | Players: ${s.players} | Messages released: ${s.hintsReleased}`;
    $('#board').checked = s.boardEnabled;
    $('#claimed').textContent = s.claimed.join(', ') || 'none';
    $('#sinfo').textContent = s.startAt ? 'Scheduled: ' + gst(s.startAt) : 'Not scheduled';
    $('#sv').replaceChildren(...s.solvers.map(x => { const tr = document.createElement('tr'); [x.rank, x.cls || '', fmt(x.ms), gst(x.at)].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); return tr; }));
    $('#network').textContent = `Players reporting: ${s.network.online} | Average ping: ${s.network.avgPing == null ? '—' : `${s.network.avgPing} ms`} | Highest ping: ${s.network.maxPing == null ? '—' : `${s.network.maxPing} ms`}`;
    const tableRows = (id, heads, items, fields) => {
      const header = document.createElement('tr');
      heads.forEach(v => { const th = document.createElement('th'); th.textContent = v; header.appendChild(th); });
      const body = items.length ? items.map(x => { const tr = document.createElement('tr'); fields(x).forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); return tr; }) : (() => { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = heads.length; td.textContent = 'No guesses yet.'; tr.appendChild(td); return [tr]; })();
      $('#'+id).replaceChildren(header, ...body);
    };
    tableRows('best', ['CLASS', 'GUESS', 'SCORE', 'TIME'], s.bestGuesses || [], x => [x.cls || '', x.guess, `${x.tier} (${x.score}%)`, fmt(x.ms)]);
    tableRows('waterfall', ['AT', 'CLASS', 'GUESS', 'SCORE', 'ELAPSED'], s.waterfall || [], x => [gst(x.at), x.cls || '', x.guess, `${x.tier} (${x.score}%)`, fmt(x.ms)]);
    $('#msgInfo').textContent = s.hints && s.hints.length ? `Released: ${s.hints.map(h => h.text).join(' | ')}` : 'Nothing released yet.';
  };
  let last = Date.now();
  es.addEventListener('state', e => { last = Date.now(); render(JSON.parse(e.data)); });
  const poll = () => fetch('/api/admin/state').then(r => r.json()).then(render).catch(() => {});
  poll();
  setInterval(() => { if (Date.now() - last > 3500) poll(); }, 2000);
}
async function login() {
  const r = await post('/api/admin/login', { password: $('#pw').value }); $('#pw').value = '';
  r.ok ? live() : ($('#lerr').textContent = 'Denied.');
}
$('#go').addEventListener('click', login);
$('#pw').addEventListener('keydown', e => e.key === 'Enter' && login());
document.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { if (b.dataset.a !== 'reset' || confirm('Reset the event and clear solvers?')) post('/api/admin/action', { action: b.dataset.a }); }));
$('#releaseMessage').addEventListener('click', async () => { const text = $('#message').value.trim(); if (!text) return; const r = await post('/api/admin/message', { text }); if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'Could not release message.'); return; } $('#message').value = ''; });
$('#ss').addEventListener('click', async () => { const v = $('#sched').value; if (!v) return alert('Pick a date and time (GST)'); const r = await post('/api/admin/config', { startAt: Date.parse(v + ':00+04:00') }); if (!r.ok) alert('Pick a future time, and schedule only before the event starts.'); });
$('#sc').addEventListener('click', () => post('/api/admin/config', { startAt: null }));
$('#rb').addEventListener('click', async () => { const r = await post('/api/admin/release', { cls: $('#rel').value.trim().toUpperCase() }); if (!r.ok) alert('That class is not claimed.'); $('#rel').value = ''; });
$('#board').addEventListener('change', e => post('/api/admin/config', { board: e.target.checked }));
$('#lo').addEventListener('click', async () => { await post('/api/admin/logout'); location.reload(); });
fetch('/api/admin/me').then(r => r.ok && live());
