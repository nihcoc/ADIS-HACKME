const $ = s => document.querySelector(s), out = $('#out'), inp = $('#in');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = ms => { const s = Math.floor(ms / 1000); return [s / 3600 | 0, (s / 60) % 60 | 0, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const GST = { timeZone: 'Asia/Dubai' }; // Gulf Standard Time, UTC+4
const gstTime = t => new Date(t).toLocaleTimeString('en-GB', { ...GST, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' GST';
const gstDay = t => new Date(t).toLocaleString('en-GB', { ...GST, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' GST';
const LABEL = { waiting: 'EVENT NOT STARTED', running: 'EVENT LIVE', paused: 'EVENT PAUSED', ended: 'EVENT ENDED' };
let st = null, puz = null, solved = false, cls = '', rainT, finalShown = false;

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  b.classList.remove('clicked'); void b.offsetWidth; b.classList.add('clicked');
  setTimeout(() => b.classList.remove('clicked'), 260);
});

function log(t, c = '') { const d = document.createElement('div'); d.className = c; d.textContent = t; out.appendChild(d); out.scrollTop = out.scrollHeight; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function type(t, c = '') { const d = document.createElement('div'); d.className = c; out.appendChild(d); for (const ch of t) { d.textContent += ch; await sleep(10); } out.scrollTop = out.scrollHeight; }

// ---- hint popup ----
const hq = [];
function popup(h) { hq.push(h); if (!$('#hp')) nextPop(); }
function nextPop() {
  const h = hq.shift(); if (!h) return;
  const d = document.createElement('div'); d.id = 'hp';
  d.innerHTML = `<div class="box"><h3>MESSAGE ${h.n} RELEASED</h3><p>${esc(h.text)}</p><button>GOT IT</button></div>`;
  d.querySelector('button').addEventListener('click', () => { d.remove(); nextPop(); });
  document.body.appendChild(d);
}

// ---- event transition overlay ----
let overlayTimer = null;
function eventOverlay(mode) {
  const el = $('#eventOverlay');
  clearInterval(overlayTimer); overlayTimer = null;
  if (mode === 'paused') {
    el.className = 'event-overlay is-paused';
    el.innerHTML = '<div class="event-overlay-card"><span class="event-kicker">EVENT STATUS</span><strong class="pause-symbol">Ⅱ</strong><span class="event-label">EVENT PAUSED</span><small>Waiting for the admin to resume</small></div>';
    el.hidden = false; return;
  }
  if (mode !== 'running') { el.hidden = true; el.className = 'event-overlay'; return; }
  el.className = 'event-overlay'; el.hidden = false;
  let count = 3;
  const draw = () => { el.innerHTML = `<div class="event-overlay-card"><span class="event-kicker">SYSTEMS UNLOCKING</span><strong class="count-number">${count > 0 ? count : 'GO'}</strong><span class="event-label">EVENT LIVE</span></div>`; };
  draw();
  overlayTimer = setInterval(() => {
    count -= 1; draw();
    if (count <= 0) { clearInterval(overlayTimer); overlayTimer = setTimeout(() => { el.hidden = true; overlayTimer = null; }, 650); }
  }, 900);
}

// ---- live state ----
const left = () => st && st.untilStartMs != null ? Math.max(0, st.untilStartMs - (Date.now() - st.rx)) : null;
function bar() {
  if (st) {
    const l = left();
    $('#bar').textContent = st.status === 'waiting' ? (l != null ? `STARTS IN ${fmt(l)} | ${st.players} online` : `EVENT NOT STARTED | ${st.players} online`) : `${LABEL[st.status]} | ${fmt(st.elapsedMs)} | ${st.players} online`;
    const c = $('#cd'); if (c) c.textContent = l != null ? fmt(l) : '--:--:--';
    const sc = $('#sched'); if (sc) sc.textContent = st.startAt ? `Starts at ${gstDay(st.startAt)}` : 'Start time will be announced by the admin';
    const m = $('#mycls'); if (m) m.textContent = cls ? `Class ${cls}` : '';
  }
  boardUI(); const f = $('#fb'); if (f) f.textContent = st && st.first != null ? `FIRST SUBMISSION RECEIVED at ${fmt(st.first)} by ${st.firstCls || 'a class'}` : '';
}
setInterval(bar, 250);
function proximityBoard() {
  const rows = st && st.proximityBoard || [];
  return rows.length ? `<div class="proximity-board"><h3>CLASS PROGRESS</h3><table class="lbt"><tr><th>RANK</th><th>CLASS</th><th>PROXIMITY</th><th>STATUS</th></tr>${rows.map(x => `<tr><td>#${x.rank}</td><td>${esc(x.cls)}</td><td>${x.score}%</td><td>${x.solved ? `SOLVED · ${fmt(x.ms)}` : (x.tier || 'IN PLAY')}</td></tr>`).join('')}</table></div>` : '<div class="proximity-board"><h3>CLASS PROGRESS</h3><p class="dim">No scored guesses yet.</p></div>';
}
function boardUI() { const b = $('#board'); if (b) b.innerHTML = st && st.board && st.board.length ? '<b>LEADERBOARD</b><br>' + st.board.map(x => `#${x.rank} ${esc(x.cls || '')} ${fmt(x.ms)}`).join('<br>') : ''; const p = $('#proximityBoard'); if (p) p.innerHTML = proximityBoard(); }
const MSG = { running: '>> EVENT STARTED. Systems unlocked.', paused: '>> EVENT PAUSED.', ended: '>> EVENT ENDED.', waiting: '>> EVENT RESET. Awaiting start.' };
function onState(d) {
  d.rx = Date.now(); const o = st; st = d; bar();
  if (o && st.status === 'running' && o.status !== 'running') eventOverlay('running');
  else if (st.status === 'paused' && (!o || o.status !== 'paused')) eventOverlay('paused');
  else if (st.status === 'waiting' || st.status === 'ended') eventOverlay('hide');
  if (o && o.status !== st.status) log(MSG[st.status], st.status === 'waiting' || st.status === 'ended' ? 'err' : 'ok');
  if (o) st.hints.filter(h => !o.hints.some(x => h.id ? x.id === h.id : x.n === h.n)).forEach(h => { log(`[MESSAGE ${h.n} RELEASED] ${h.text}`, 'hint'); popup(h); });
  if (o && o.first == null && st.first != null) log(`>> FIRST SUBMISSION RECEIVED at ${fmt(st.first)} by ${st.firstCls || 'a class'}. The race is on.`, 'ok');
  if (st.status === 'ended' && (!o || o.status !== 'ended')) showFinal();
  if (st.status === 'waiting') { stopRain(); puz = null; solved = false; finalShown = false; $('#win').hidden = true; waiting(); if (o && o.status !== 'waiting') ensureClass(); }
  else if (!puz) load();
}
// Live updates over SSE, with a polling fallback for networks/tunnels that buffer or block event streams.
let last = Date.now();
const es = new EventSource('/api/stream');
es.addEventListener('state', e => { last = Date.now(); onState(JSON.parse(e.data)); });
const poll = () => fetch('/api/event').then(r => r.json()).then(onState).catch(() => {});
poll();
setInterval(() => { if (Date.now() - last > 3500) poll(); }, 2000);
async function load() {
  const r = await fetch('/api/puzzle'); if (!r.ok) return;
  puz = await r.json(); solved = (await (await fetch('/api/event')).json()).solved; desk();
}
async function sendPing() {
  const start = performance.now();
  try {
    const r = await fetch('/api/event', { cache: 'no-store' });
    if (!r.ok) return;
    const ping = Math.round(performance.now() - start);
    await fetch('/api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ping }) });
  } catch {}
}
sendPing(); setInterval(sendPing, 10000);

// ---- fictional sites ----
const img = (s, a = '') => `<img src="${esc(s)}" alt="${esc(a)}">`;
const POST_ORDER = [1, 5, 3, 0, 2, 4, 6]; // shuffled display order; metadata stays with each photo
const postImage = p => cls.match(/^12[A-G]$/) ? p.image.replace(/photo1\.jpg$/, 'photokes.jpg') : p.image;
const ph = () => Object.assign(document.createElement('div'), { className: 'ph', textContent: '📷' });
const cmts = p => p.comments && p.comments.length ? `<div class="cmts"><b>Comments (${p.comments.length})</b>${p.comments.map(c => `<p><b>${esc(c.user)}</b> ${esc(c.text)}<small>${esc(c.date)}</small></p>`).join('')}</div>` : '';
const SITES = {
  grammie() {
    const g = puz.grammie;
    const bio = esc(g.bio).replace(/\n/g, '<br>').replace('@idk.dosa', '<span class="bio-link">@idk.dosa</span>');
    return `<div class="gh"><div class="av">${img(g.avatar)}</div><div><div class="gidentity"><h3>${esc(puz.person.name)}</h3><b>@${esc(g.username)}</b></div><p>${bio}</p><p><b>${g.followers}</b> followers &nbsp; <b>${g.following}</b> following</p></div></div>
    <div class="grid">${POST_ORDER.map((i, rank) => `<button class="post" data-i="${i}" aria-label="Open post ${rank + 1}">${img(postImage(g.posts[i]))}</button>`).join('')}</div><div id="pd"></div>`;
  },
  linkout() {
    const l = puz.linkout, it = x => `<p><b>${esc(x.org)}</b>${x.title ? '<br>' + esc(x.title) : ''}<br><small>${esc(x.period)}</small></p>`;
    return `<div class="lb"><div class="ban"></div><div class="pic">${img(puz.grammie.avatar)}</div><h3>${esc(puz.person.name)}</h3><p>${esc(l.headline)}</p><small>${esc(l.location)}</small></div>
    <div class="lb"><h3>Experience</h3>${l.experience.map(it).join('')}</div><div class="lb"><h3>Education</h3>${l.education.map(it).join('')}</div>`;
  },
  hooked() {
    const h = puz.hooked, ps = puz.grammie.posts;
    return `<div class="hk">${img(postImage(ps[POST_ORDER[0]]))}<div class="in"><h3>${esc(h.name)}, ${h.age}</h3><p>📍 ${esc(h.location)} &nbsp; Born ${puz.person.born}</p><p><b>Looking for:</b> ${esc(h.lookingFor)}</p>
    <p>${h.hobbies.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</p><div class="strip">${POST_ORDER.slice(1).map(i => img(postImage(ps[i]))).join('')}</div></div></div>`;
  }
};
function site(n) {
  const hosts = { grammie: 'grammie.social', linkout: 'linkout.network', hooked: 'hooked.app' };
  const address = $('#browserAddress'); if (address) address.textContent = hosts[n];
  const v = $('#site'); v.className = 's-' + n; v.innerHTML = `<div class="sh">${ICON[n]}<b>${n.toUpperCase()}</b></div>` + SITES[n]();
  v.querySelectorAll('img').forEach(i => i.addEventListener('error', () => i.replaceWith(ph())));
  v.querySelectorAll('.post').forEach(b => b.addEventListener('click', () => {
    const p = puz.grammie.posts[b.dataset.i];
    $('#pd').innerHTML = `${img(postImage(p))}<p><b>${esc(p.caption)}</b></p><small>${esc(p.date)} &middot; ${esc(p.location)}</small>${cmts(p)}`;
    $('#pd img').addEventListener('error', e => e.target.replaceWith(ph()));
  }));
}
const ICON = {
  grammie: '<svg viewBox="0 0 48 48" class="ico"><defs><linearGradient id="gg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f9a03f"/><stop offset=".55" stop-color="#dd2a7b"/><stop offset="1" stop-color="#8134af"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#gg)"/><rect x="10" y="8" width="28" height="32" rx="3" fill="#fff"/><rect x="13" y="11" width="22" height="19" fill="#2b2b3a"/><path d="M13 30l7-9 5 6 4-4 6 7z" fill="#f9a03f"/><circle cx="29" cy="17" r="2.6" fill="#fff"/></svg>',
  linkout: '<svg viewBox="0 0 48 48" class="ico"><defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a66c2"/><stop offset="1" stop-color="#4aa3f0"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#gl)"/><path d="M19 17v-3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" fill="none" stroke="#fff" stroke-width="3"/><rect x="9" y="17" width="30" height="20" rx="3" fill="#fff"/><rect x="9" y="25" width="30" height="3" fill="#0a66c2"/><rect x="21" y="23" width="6" height="7" rx="1.5" fill="#0a66c2"/></svg>',
  hooked: '<svg viewBox="0 0 48 48" class="ico"><defs><linearGradient id="gh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7854"/><stop offset="1" stop-color="#fd267a"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#gh)"/><path d="M24 40C9 30 10 18 18 18c3 0 5 2 6 4 1-2 3-4 6-4 8 0 9 12-6 22z" fill="#fff"/><path d="M31 6v8a4.5 4.5 0 0 1-9 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>'
};
const APPS = [['grammie', 'GRAMMIE', 'photo sharing'], ['linkout', 'LINKOUT', 'professional network'], ['hooked', 'HOOKED', 'social discovery']];
const appTiles = locked => APPS.map(a => locked
  ? `<div class="app ${a[0]}">${ICON[a[0]]}<b>${a[1]}</b><i>locked</i></div>`
  : `<button class="app ${a[0]}" data-s="${a[0]}">${ICON[a[0]]}<b>${a[1]}</b><i>${a[2]}</i></button>`).join('');

function waiting() {
  const d = $('#desk'); if (d.dataset.m === 'w') return; d.dataset.m = 'w'; d.hidden = false;
  d.innerHTML = `<div class="pulse">&#9679; EVENT NOT STARTED</div>
  <div class="cdbox"><div id="sched"></div><div id="cd" class="cd">--:--:--</div><small class="dim"><span id="mycls"></span> | all times in GST (UTC+4)</small></div>
  <h2>Mission briefing</h2>
  <p class="dim">The clock starts for every player at the same moment. This screen unlocks by itself, so keep the page open.</p>
  <nav id="apps" class="locked">${appTiles(true)}</nav>
  <h3>Rules and regulations</h3>
  <ol class="rules">
    <li>Everything here is fictional: the person, the websites, the companies and the photos.</li>
    <li>Select your class. Each class can be claimed by one player, and claimed classes are greyed out.</li>
    <li>The event opens automatically at the start time set by the admin, shown above in GST. The clock starts for everyone at the same moment.</li>
    <li>When it starts, three fictional public profiles unlock: Grammie, Linkout and Hooked.</li>
    <li>Investigate them, correlate what you find, and work out the weak password the person chose.</li>
    <li>You can solve once. Rank is decided by finishing time.</li>
    <li>Proximity: type <b>proximity</b> to see the percentage for your latest, hottest and coldest guesses. You get 5 proximity checks.</li>
    <li>The event ends automatically once players from ${st.limit || 3} different classes solve it. The final leaderboard, challenge password, precautions and tips are then shown to everyone.</li>
    <li>Admins can release hints or messages live. Type <b>hints</b> to read released messages.</li>
    <li>The first correct submission is announced live to all players.</li>
    <li>Play fair: do not share answers, and do not attack the server or any real person or account.</li>
  </ol>
  <h3>How to submit</h3>
  <pre class="sub">&gt; submit &lt;your answer&gt;

ACCESS GRANTED  -> finishing time, rank, security tips
ACCESS DENIED   -> try again, or type proximity to check how close you are</pre>
  <p class="dim">Commands are listed in the command map above the console.</p>`;
}
function desk() {
  const d = $('#desk'); d.hidden = false;
  d.dataset.m = 'g'; d.innerHTML = `<span class="tag">FICTIONAL CYBERSECURITY TRAINING PROFILE</span><h2>${esc(puz.person.name)}</h2>
  <div id="proximityBoard">${proximityBoard()}</div><div id="fb"></div><nav id="apps">${appTiles(false)}</nav><div id="clues"><b>CLUES</b><ul><li>The password is related to his personal life.</li></ul></div>
  <div class="browser-frame"><div class="browser-chrome"><div class="browser-dots"><i></i><i></i><i></i></div><div class="browser-address"><span>⌑</span><span id="browserAddress">Choose an application</span></div><span class="browser-menu">•••</span></div><div id="site"><p>Select an application.</p></div></div><div id="board"></div>`;
  d.querySelectorAll('#apps button').forEach(b => b.addEventListener('click', () => site(b.dataset.s)));
  boardUI();
}

// ---- commands ----
const COMMANDS = ['legend: how this exercise works', 'hints: show released messages', 'status: event, timer and message status', 'submit <code>: submit your answer', 'proximity: latest, hottest and coldest guesses with percentages (5 checks)', 'clear: clear the screen'];
const commandList = $('#commandList');
if (commandList) COMMANDS.forEach(command => {
  const item = document.createElement('div');
  item.textContent = command;
  commandList.appendChild(item);
});
const C = {
  legend: () => ['PassTrace // cybersecurity awareness exercise', 'All people, sites and photos here are fictional and made for this exercise.', 'Three public profiles belong to one fictional person. Open each one and look closely.', 'Work out the weak password they chose, then: submit <code>', 'COMMANDS:', ...COMMANDS],
  hints: () => st.hints.length ? st.hints.map(h => `MESSAGE ${h.n}: ${h.text}`) : ['No messages released yet.'],
  status: () => [`Event:  ${LABEL[st.status]}`, `Elapsed: ${fmt(st.elapsedMs)}`, `Player: ${solved ? 'SOLVED' : 'ACTIVE'} (${cls})`, `Time:   ${gstTime(Date.now())}`,
    `Messages: ${st.hints.length} released`],
  clear: () => { out.innerHTML = ''; return []; }
};
let proximityPending = false;
async function proximity() {
  if (proximityPending) return log('Proximity check already in progress…', 'dim');
  proximityPending = true;
  try {
  const r = await fetch('/api/proximity', { method: 'POST' }), j = await r.json().catch(() => ({}));
  if (!r.ok) {
    log(j.error || 'ERROR', 'err');
    if (Number.isInteger(j.checksLeft)) log(`${j.checksLeft} of 5 proximity checks left`, 'dim');
    return;
  }
  const line = (l, x) => log(`${l}: ${x.guess}   [${x.tier} ${x.score}%]`, x.tier === 'COLD' ? 'dim' : 'hint');
  line('LATEST guess', j.latest);
  line('HOTTEST guess', j.hot);
  if (j.cold.guess !== j.hot.guess) line('COLDEST guess', j.cold); else log('(only one guess so far, so it is both your hottest and coldest)', 'dim');
  log(`${j.checksLeft} of 5 proximity checks left`, 'dim');
  } finally { proximityPending = false; }
}
async function submit(code) {
  if (!code) return log('usage: submit <code>', 'err');
  if (!st || st.status !== 'running') return log('EVENT NOT ACTIVE', 'err');
  if (solved) return log('ALREADY SOLVED', 'err');
  const r = await fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.ok) return win(j);
  if (r.status === 401) { log('ACCESS DENIED', 'err'); document.body.classList.add('shake'); setTimeout(() => document.body.classList.remove('shake'), 500); }
  if (r.status === 429) log('Too many submissions. Try again shortly.', 'err');
  else if (r.status !== 401) log(j.error || 'ERROR', 'err');
}
inp.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const v = inp.value.trim(); inp.value = ''; if (!v) return;
  log('> ' + v, 'dim');
  if (!cls) return log('Select your class first.', 'err');
  if (!st) return log('Connecting... try again.', 'err');
  const [cmd, ...rest] = v.split(/\s+/);
  if (cmd.toLowerCase() === 'submit') return submit(rest.join(' '));
  if (cmd.toLowerCase() === 'proximity') return proximity();
  const f = C[cmd.toLowerCase()];
  f ? f().forEach(l => log(l)) : log(`Unknown command: ${cmd}. See the command map above.`, 'err');
});

// ---- victory ----
const TIPS = `<h3>TOP 5 SECURITY TIPS</h3><ol><li>Don't use personal information in passwords.</li><li>Avoid combining pet names, dates, school information, or other public details.</li><li>Assume information posted publicly can be collected and correlated.</li><li>Use long, unique, randomly generated passwords.</li><li>Use MFA or passkeys whenever available.</li></ol>`;
const LESSON = `<h3>WHAT THIS ATTACK TEACHES</h3><p>Publicly available information can be combined to make passwords predictable. Pet names, birth and graduation years, schools, employers, locations, hobbies, family names, relationships and social-media posts each look harmless alone, but together they produce useful guesses. A pattern like <i>pet name + meaningful year + common symbol</i> is easy to predict. This exercise shows why to avoid such patterns. Never try this against real people or accounts.</p>
    ${TIPS}<h3>PRECAUTIONS</h3><ul><li>Review what your public profiles reveal: pet names, school and graduation years, employers, locations and hobbies.</li><li>Tighten privacy settings and delete old posts that give away personal details.</li><li>Never reuse a password. Keep unique ones in a password manager.</li><li>Avoid security questions whose answers can be found online.</li><li>Turn on MFA or passkeys for email, banking and social accounts.</li><li>Never try this against real people or accounts.</li></ul>`;
const THANKS_GROUPS = [
  { title: 'Leadership', names: ['Principal Sir', 'Vice Principal', "Bindu Ma'am", "Juhi Ma'am", "Lekshmi Ma'am"] },
  { title: 'Student organisers', names: ['Tanish', 'Harish', 'Mohit', 'Dakshaharan', 'Arnold', 'Daniel', 'Ihsaan', 'Aman', 'Joel', 'Fizan', 'Advay', 'Kartik', 'Kaustubh', 'Aarav Kasurde', 'Nathaniel Philip', 'Akash', 'Nuraaz', 'Agam', 'Anshuman', 'Atul', 'M.D. Anas', 'Tamilvanan', 'Tony', 'Hamdan', 'Rubhan', 'Marmik', 'Ahil', 'Ujjwal', 'Shivek', 'Jaijith', 'Ibrahim', 'Zac', 'Keshav Ramnath', 'Claude'] }
];
function creditsRoll() {
  const credits = `${THANKS_GROUPS.map(group => `<section class="credits-group${group.title === 'Student organisers' ? ' credits-students' : ''}"><h3>${esc(group.title)}</h3><div class="credit-list">${group.names.map(name => `<p class="credit-name">${esc(name)}</p>`).join('')}</div></section>`).join('')}<p class="credits-signoff">Thank you for your participation.<br>With love, NeuralNex</p><p class="credits-signoff credits-creator">Created by Alfred and Haron -12C</p>`;
  const copy = `<div class="credits-copy">${credits}<div class="credits-gap" aria-hidden="true"></div></div>`;
  return `${copy}<div class="credits-copy" aria-hidden="true">${credits}<div class="credits-gap"></div></div>`;
}
function startRain() {
  const cv = $('#rain'); cv.hidden = false;
  if (rainT) return;
  cv.width = innerWidth; cv.height = innerHeight;
  const x = cv.getContext('2d'), cols = Array(Math.ceil(cv.width / 16)).fill(0);
  rainT = setInterval(() => { x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, 0, cv.width, cv.height); x.font = '16px monospace';
    cols.forEach((y, i) => { x.fillStyle = i % 2 ? '#27a9ff' : '#00ff66'; x.fillText(String.fromCharCode(0x30A0 + Math.random() * 96), i * 16, y * 16); cols[i] = y * 16 > cv.height && Math.random() > .975 ? 0 : y + 1; }); }, 50);
}
function stopRain() { if (rainT) clearInterval(rainT); rainT = null; $('#rain').hidden = true; }
addEventListener('resize', () => { if (rainT) { const cv = $('#rain'); cv.width = innerWidth; cv.height = innerHeight; } });
function showFinal() {
  if (!st || st.status !== 'ended') return;
  if (finalShown) return;
  finalShown = true; startRain();
  const w = $('#win'); w.hidden = false;
  w.innerHTML = `<div class="box end-layout"><section class="end-panel"><h2 class="glitch" data-t="EVENT ENDED">EVENT ENDED</h2><p>The event is over. Final class progress:</p>${st.revealedPassword ? `<p>Challenge password: <b>${esc(st.revealedPassword)}</b></p>` : ''}${proximityBoard()}${LESSON}</section><section class="credits-panel"><h2 class="glitch" data-t="CREDITS">CREDITS</h2><div class="credits-viewport" aria-label="Rolling event credits"><div class="credits-roll">${creditsRoll()}</div></div></section></div>`;
}
function showWinner(j) {
  startRain();
  const w = $('#win'); w.hidden = false;
  w.innerHTML = `<div class="box"><h2 class="glitch" data-t="ACCESS GRANTED">ACCESS GRANTED</h2><p>You solved the challenge.</p><p>Rank: <b>#${j.rank}</b> &nbsp; Time: <b>${fmt(j.ms)}</b></p>${TIPS}<p class="dim">The event continues until players from ${st.limit || 3} different classes solve it.</p><button id="dismissWin" type="button">RETURN TO TERMINAL</button></div>`;
  $('#dismissWin').addEventListener('click', () => { w.hidden = true; stopRain(); });
}
async function win(j) {
  solved = true;
  log(`ACCESS GRANTED — rank #${j.rank}, finishing time ${fmt(j.ms)}.`, 'ok');
  try {
    const r = await fetch('/api/event', { cache: 'no-store' });
    if (r.ok) onState(await r.json());
  } catch {}
  if (st && st.status === 'ended') showFinal(); else showWinner(j);
}

// ---- class selection + intro ----
function pickClass(taken) {
  return new Promise(res => {
    const o = $('#cls'); o.hidden = false;
    const rows = [9, 10, 11, 12].map(g => `<div class="crow${g === 10 ? ' crow-eight' : ''}">${(g === 10 ? 'ABCDEFGH' : 'ABCDEFG').split('').map(l => `<button data-c="${g}${l}">${g}${l}</button>`).join('')}</div>`).join('');
    o.innerHTML = `<div class="box"><h2 class="glitch" data-t="SELECT YOUR CLASS">SELECT YOUR CLASS</h2><p class="dim">The event is class wise. Each class can be claimed once. Greyed-out classes are already taken.</p>${rows}<p id="cmsg" class="err"></p></div>`;
    const mark = t => o.querySelectorAll('button').forEach(b => { b.disabled = t.includes(b.dataset.c); });
    mark(taken);
    const iv = setInterval(() => fetch('/api/classes').then(r => r.json()).then(r => mark(r.taken)).catch(() => {}), 3000);
    o.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
      const r = await fetch('/api/class', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cls: b.dataset.c }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { cls = j.cls; clearInterval(iv); o.hidden = true; res(); }
      else { $('#cmsg').textContent = j.error === 'CLASS TAKEN' ? 'That class was just taken. Pick another.' : 'Could not select that class. Try again.'; if (j.error === 'CLASS TAKEN') b.disabled = true; }
    }));
  });
}
async function ensureClass() {
  const r = await fetch('/api/classes').then(x => x.json()).catch(() => null);
  if (r && r.mine) { cls = r.mine; return; }
  cls = ''; await pickClass(r ? r.taken : []);
}
(async () => {
  await ensureClass();
  await type('PassTrace // cybersecurity awareness exercise');
  await type('All people, sites and photos are fictional and created for this exercise.', 'dim');
  await type(`Class ${cls} registered. Commands are listed above.`);
  inp.focus();
})();
