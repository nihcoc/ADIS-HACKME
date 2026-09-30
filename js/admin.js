const $ = s => document.querySelector(s);
const fmt = ms => { const s = Math.floor(ms / 1000); return [s / 3600 | 0, (s / 60) % 60 | 0, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
function live() {
  $('#login').hidden = true; $('#panel').hidden = false;
  const es = new EventSource('/api/admin/stream');
  es.addEventListener('state', e => {
    const s = JSON.parse(e.data);
    $('#info').textContent = `Status: ${s.status.toUpperCase()} | Elapsed: ${fmt(s.elapsedMs)} | Players: ${s.players} | Hints released: ${s.hintsReleased}/3`;
    if (document.activeElement !== $('#times')) $('#times').value = s.times.join(',');
    $('#board').checked = s.boardEnabled;
    $('#sv').replaceChildren(...s.solvers.map(x => { const tr = document.createElement('tr'); [x.rank, x.nick, fmt(x.ms), x.at].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); return tr; }));
  });
}
async function login() {
  const r = await post('/api/admin/login', { password: $('#pw').value }); $('#pw').value = '';
  r.ok ? live() : ($('#lerr').textContent = 'Denied.');
}
$('#go').addEventListener('click', login);
$('#pw').addEventListener('keydown', e => e.key === 'Enter' && login());
document.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { if (b.dataset.a !== 'reset' || confirm('Reset the event and clear solvers?')) post('/api/admin/action', { action: b.dataset.a }); }));
$('#st').addEventListener('click', async () => { const r = await post('/api/admin/config', { times: $('#times').value.split(',').map(Number) }); if (!r.ok) alert('Enter 3 numbers, e.g. 10,20,30'); });
$('#board').addEventListener('change', e => post('/api/admin/config', { board: e.target.checked }));
$('#lo').addEventListener('click', async () => { await post('/api/admin/logout'); location.reload(); });
fetch('/api/admin/me').then(r => r.ok && live());
