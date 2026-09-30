const $ = s => document.querySelector(s), out = $('#out'), inp = $('#in');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = ms => { const s = Math.floor(ms / 1000); return [s / 3600 | 0, (s / 60) % 60 | 0, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const LABEL = { waiting: 'EVENT NOT STARTED', running: 'EVENT LIVE', paused: 'EVENT PAUSED', ended: 'EVENT ENDED' };
let st = null, puz = null, solved = false, nick = sessionStorage.getItem('nick') || '', cool = 0, rainT;

function log(t, c = '') { const d = document.createElement('div'); d.className = c; d.textContent = t; out.appendChild(d); out.scrollTop = out.scrollHeight; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function type(t, c = '') { const d = document.createElement('div'); d.className = c; out.appendChild(d); for (const ch of t) { d.textContent += ch; await sleep(10); } out.scrollTop = out.scrollHeight; }

// ---- live state ----
function bar() { if (st) $('#bar').textContent = `${LABEL[st.status]} | ${fmt(st.elapsedMs)} | ${st.players} online`; boardUI(); }
function boardUI() { const b = $('#board'); if (b) b.innerHTML = st && st.board && st.board.length ? '<b>LEADERBOARD</b><br>' + st.board.map(x => `#${x.rank} ${esc(x.nick)} ${fmt(x.ms)}`).join('<br>') : ''; }
const MSG = { running: '>> EVENT STARTED. Systems unlocked.', paused: '>> EVENT PAUSED.', ended: '>> EVENT ENDED.', waiting: '>> EVENT RESET. Awaiting start.' };
const es = new EventSource('/api/stream');
es.addEventListener('state', e => {
  const o = st; st = JSON.parse(e.data); bar();
  if (o && o.status !== st.status) log(MSG[st.status], st.status === 'waiting' || st.status === 'ended' ? 'err' : 'ok');
  if (o) st.hints.filter(h => !o.hints.some(x => x.n === h.n)).forEach(h => log(`[HINT ${h.n} RELEASED] ${h.text}`, 'hint'));
  if (st.status === 'waiting') { puz = null; solved = false; $('#desk').hidden = true; }
  else if (!puz) load();
});
async function load() {
  const r = await fetch('/api/puzzle'); if (!r.ok) return;
  puz = await r.json(); solved = (await (await fetch('/api/event')).json()).solved; desk();
}

// ---- fictional sites ----
const img = (s, a = '') => `<img src="${esc(s)}" alt="${esc(a)}">`;
const ph = () => Object.assign(document.createElement('div'), { className: 'ph', textContent: '📷' });
const SITES = {
  grammie() {
    const g = puz.grammie;
    return `<div class="gh"><div class="av">${img(g.avatar)}</div><div><h3>${esc(puz.person.name)}</h3><b>@${esc(g.username)}</b><p>${esc(g.bio)}</p><p><b>${g.followers}</b> followers &nbsp; <b>${g.following}</b> following</p></div></div>
    <div class="grid">${g.posts.map((p, i) => `<button class="post" data-i="${i}" aria-label="Open post ${i + 1}">${img(p.image, p.description)}</button>`).join('')}</div><div id="pd"></div>`;
  },
  linkout() {
    const l = puz.linkout, it = x => `<p><b>${esc(x.org)}</b>${x.title ? '<br>' + esc(x.title) : ''}<br><small>${esc(x.period)}</small></p>`;
    return `<div class="lb"><div class="ban"></div><div class="pic"></div><h3>${esc(puz.person.name)}</h3><p>${esc(l.headline)}</p><small>${esc(l.location)}</small></div>
    <div class="lb"><h3>Experience</h3>${l.experience.map(it).join('')}</div><div class="lb"><h3>Education</h3>${l.education.map(it).join('')}</div>`;
  },
  hooked() {
    const h = puz.hooked, ps = puz.grammie.posts;
    return `<div class="hk">${img(ps[0].image)}<div class="in"><h3>${esc(h.name)}, ${h.age}</h3><p>📍 ${esc(h.location)} &nbsp; Born ${puz.person.born}</p><p><b>Looking for:</b> ${esc(h.lookingFor)}</p>
    <p>${h.hobbies.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</p><div class="strip">${ps.slice(1).map(p => img(p.image)).join('')}</div></div></div>`;
  }
};
function site(n) {
  const v = $('#site'); v.className = 's-' + n; v.innerHTML = SITES[n]();
  v.querySelectorAll('img').forEach(i => i.addEventListener('error', () => i.replaceWith(ph())));
  v.querySelectorAll('.post').forEach(b => b.addEventListener('click', () => {
    const p = puz.grammie.posts[b.dataset.i];
    $('#pd').innerHTML = `${img(p.image, p.description)}<p><b>${esc(p.caption)}</b></p><small>${esc(p.date)} &middot; ${esc(p.location)}</small><div class="desc"><b>Image description:</b> ${esc(p.description)}</div>`;
    $('#pd img').addEventListener('error', e => e.target.replaceWith(ph()));
  }));
}
function desk() {
  const d = $('#desk'); d.hidden = false;
  d.innerHTML = `<span class="tag">FICTIONAL CYBERSECURITY TRAINING PROFILE</span><h2>${esc(puz.person.name)}</h2>
  <nav id="apps"><button data-s="grammie">📷<b>GRAMMIE</b><i>photo sharing</i></button><button data-s="linkout">💼<b>LINKOUT</b><i>professional network</i></button><button data-s="hooked">🔥<b>HOOKED</b><i>social discovery</i></button></nav>
  <div id="site"><p>Select an application.</p></div><div id="board"></div>`;
  d.querySelectorAll('#apps button').forEach(b => b.addEventListener('click', () => site(b.dataset.s)));
  boardUI();
}

// ---- commands ----
const C = {
  help: () => ['help            show commands', 'legend          how this exercise works', 'hints           show released hints', 'status          event, timer and hint status', 'submit <code>  submit your answer', 'clear           clear the screen'],
  legend: () => ['All people, sites and photos here are fictional and made for this exercise.', 'Three public profiles belong to one fictional person. Open each one and look closely.', 'Work out the weak password they chose, then: submit <code>'],
  hints: () => st.hints.length ? st.hints.map(h => `HINT ${h.n}: ${h.text}`) : ['No hints released yet.'],
  status: () => [`Event:  ${LABEL[st.status]}`, `Elapsed: ${fmt(st.elapsedMs)}`, `Player: ${solved ? 'SOLVED' : Date.now() < cool ? 'COOLDOWN' : 'ACTIVE'} (${nick})`,
    `Hints:  ${st.hints.length}/3 released` + (st.nextHintMs != null ? `, next in ${fmt(st.nextHintMs)}` : '')],
  clear: () => { out.innerHTML = ''; return []; }
};
async function submit(code) {
  if (!code) return log('usage: submit <code>', 'err');
  if (!st || st.status !== 'running') return log('EVENT NOT ACTIVE', 'err');
  if (solved) return log('ALREADY SOLVED', 'err');
  const r = await fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, code }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.ok) return win(j);
  if (r.status === 401) { log('ACCESS DENIED', 'err'); document.body.classList.add('shake'); setTimeout(() => document.body.classList.remove('shake'), 500); }
  if (j.cooldown) log(`Too many attempts. Locked for ${j.cooldown}s.`, 'err');
  else if (r.status === 429) log(j.retryAfter ? `Cooldown: wait ${j.retryAfter}s.` : 'Slow down.', 'err');
  else if (r.status !== 401) log(j.error || 'ERROR', 'err');
  if (j.cooldown || j.retryAfter) cool = Date.now() + (j.cooldown || j.retryAfter) * 1000;
}
inp.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const v = inp.value.trim(); inp.value = ''; if (!v) return;
  log('> ' + v, 'dim');
  if (!nick) { if (!/^[\w .-]{1,20}$/.test(v)) return log('Callsign: 1-20 letters, numbers, space . - _', 'err'); nick = v; sessionStorage.setItem('nick', nick); return log(`Welcome, ${nick}. Type "help".`, 'ok'); }
  if (!st) return log('Connecting... try again.', 'err');
  const [cmd, ...rest] = v.split(/\s+/);
  if (cmd.toLowerCase() === 'submit') return submit(rest.join(' '));
  const f = C[cmd.toLowerCase()];
  f ? f().forEach(l => log(l)) : log(`Unknown command: ${cmd}. Type "help".`, 'err');
});

// ---- victory ----
function win(j) {
  solved = true; const cv = $('#rain'); cv.hidden = false; cv.width = innerWidth; cv.height = innerHeight;
  const x = cv.getContext('2d'), cols = Array(Math.ceil(cv.width / 16)).fill(0);
  rainT = setInterval(() => { x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, 0, cv.width, cv.height); x.fillStyle = '#00ff66'; x.font = '16px monospace';
    cols.forEach((y, i) => { x.fillText(String.fromCharCode(0x30A0 + Math.random() * 96), i * 16, y * 16); cols[i] = y * 16 > cv.height && Math.random() > .975 ? 0 : y + 1; }); }, 50);
  setTimeout(() => {
    const w = $('#win'); w.hidden = false;
    w.innerHTML = `<div class="box"><h2 class="glitch" data-t="ACCESS GRANTED">ACCESS GRANTED</h2><p>Finishing time: <b>${fmt(j.ms)}</b> &nbsp; Rank: <b>#${j.rank}</b></p>
    <h3>WHAT THIS ATTACK TEACHES</h3><p>Publicly available information can be combined to make passwords predictable. Pet names, birth and graduation years, schools, employers, locations, hobbies, family names, relationships and social-media posts each look harmless alone, but together they produce useful guesses. A pattern like <i>pet name + meaningful year + common symbol</i> is easy to predict. This exercise shows why to avoid such patterns. Never try this against real people or accounts.</p>
    <h3>TOP 5 SECURITY TIPS</h3><ol><li>Don't use personal information in passwords.</li><li>Avoid combining pet names, dates, school information, or other public details.</li><li>Assume information posted publicly can be collected and correlated.</li><li>Use long, unique, randomly generated passwords.</li><li>Use MFA or passkeys whenever available.</li></ol><button id="cl">CLOSE</button></div>`;
    $('#cl').addEventListener('click', () => { w.hidden = true; clearInterval(rainT); cv.hidden = true; });
  }, 2500);
}

// ---- intro ----
(async () => {
  await type('HACKME // cybersecurity awareness exercise');
  await type('All people, sites and photos are fictional and created for this exercise. submit using "submit <code>" for hints type "hints" ', 'dim');
  await type(nick ? `Welcome back, ${nick}. Type "help".` : 'Enter your callsign (nickname):');
  inp.focus();
})();
