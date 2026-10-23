// Hall Pods local server. No dependencies. Node 18+.
// Stores documents by path (e.g. pods/ABC123/members/u1) in data.json
// and pushes change notifications to browsers over Server-Sent Events.
//
// DEV CODE / DEMO MODE
// POST /api/dev {code:"demo"}   -> flushes your real data, then switches to a freshly generated
//                                  data.demo.json full of pacts, streaks, plans and study rounds.
// POST /api/dev {code:"normal"} -> switches back to your real data.json.
// While demo mode is on, nothing is ever written to data.json.
// Change the code with:  $env:DEV_CODE="mycode"; node server.js   (PowerShell)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // use 127.0.0.1 to keep it on this machine only
const DATA_FILE = path.join(__dirname, 'data.json');
const DEMO_FILE = path.join(__dirname, 'data.demo.json');
const INDEX = path.join(__dirname, 'public', 'index.html');
const FAVICON = path.join(__dirname, 'public', 'favicon.png');
const MAX_BODY = 100 * 1024;
const VALID_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+){0,5}$/;
const DEV_CODE = (process.env.DEV_CODE || 'demo').trim().toLowerCase();
const DEMO_POD = 'DEMO42';

let demoMode = false;
let activeFile = DATA_FILE;

function loadStore(file) {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))); }
  catch (e) { return new Map(); } // first run
}
let store = loadStore(DATA_FILE);

let saveTimer = null;
let dirty = false;
function writeNow() {
  const tmp = activeFile + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(store)));
    fs.renameSync(tmp, activeFile);
    dirty = false;
  } catch (e) { console.error('Could not save ' + path.basename(activeFile) + ': ' + e.message); }
}
function persist() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 300);
}
function flush(force) { clearTimeout(saveTimer); if (dirty || force) writeNow(); }

const clients = new Set();
function broadcastRaw(obj) {
  const msg = `data: ${JSON.stringify(obj)}\n\n`;
  clients.forEach(res => res.write(msg));
}
function broadcast(p) { broadcastRaw({ path: p }); }
setInterval(() => clients.forEach(res => res.write(': keepalive\n\n')), 25000);

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch (e) { reject(new Error('bad json')); }
    });
  });
}

/* ---------- demo data generator ---------- */
// Dates are relative to "now", so streaks are always current when demo mode is switched on.
function buildDemo(uid, name) {
  const now = Date.now(), DAY = 86400000, rnd = Math.random;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const dayKey = off => { const d = new Date(now); d.setDate(d.getDate() + off); return ymd(d); };
  const dow = k => new Date(k + 'T00:00').getDay();
  const hm = (k, s) => { const [h, m] = s.split(':').map(Number); return new Date(k + 'T00:00').getTime() + (h * 60 + m) * 60000; };
  const sched = (p, k) => !p.days.length || p.days.includes(dow(k));
  // a random check-in time inside the pact's window for day k, optionally clamped
  const when = (p, k, loCap, hiCap) => {
    const day = new Date(k + 'T00:00').getTime();
    let lo = p.opens ? hm(k, p.opens) : p.due ? hm(k, p.due) - 3 * 3600000 : day + 7 * 3600000;
    let hi = p.due ? hm(k, p.due) - 5 * 60000 : p.opens ? lo + 4 * 3600000 : day + 22 * 3600000;
    if (loCap != null) lo = Math.max(lo, loCap);
    if (hi < lo) hi = lo;
    if (hiCap != null) { hi = Math.min(hi, hiCap); lo = Math.min(lo, hi); }
    return Math.round(lo + rnd() * (hi - lo));
  };

  const docs = {};
  const created = now - 30 * DAY;
  const me = uid || 'demo0';
  docs['pods/' + DEMO_POD] = { name: 'Level 3 East', created };

  const others = [['demo1', 'Mei'], ['demo2', 'Arjun'], ['demo3', 'Sofia'], ['demo4', 'Daniel'], ['demo5', 'Priya']];
  const people = [[me, name || 'You'], ...others];
  people.forEach(([id, n], i) => {
    const pomos = 1 + Math.floor(rnd() * 5);
    const log = {}; // minutes studied per day, so Goals has history to show
    for (let d = 1; d <= 20; d++) if (rnd() < 0.7) log[dayKey(-d)] = 25 * (1 + Math.floor(rnd() * 5));
    log[dayKey(0)] = pomos * 25;
    docs[`pods/${DEMO_POD}/members/${id}`] = { name: n, day: dayKey(0), pomos, mins: pomos * 25, focusUntil: 0, log, joinedAt: created + i * 3600000 };
  });
  docs[`pods/${DEMO_POD}/members/demo2`].focusUntil = now + 11 * 60000; // shows a "Focusing" tag

  const PACTS = [
    { id: 'pdemo1', emoji: '🌙', title: 'Lights down together', rule: 'Phones on the charger, lights off. No scrolling in bed.', days: [], opens: '22:30', due: '23:30', mode: 'group', stakes: 'The slipper buys bubble tea', by: 'me', who: ['me', 'demo1', 'demo2', 'demo3', 'demo4', 'demo5'], len: 12 },
    { id: 'pdemo2', emoji: '🍽️', title: 'Eat dinner on time', rule: 'Have dinner in the window, not at midnight.', days: [], opens: '18:00', due: '19:30', mode: 'solo', stakes: '', by: 'demo1', who: ['me', 'demo1', 'demo3', 'demo4'] },
    { id: 'pdemo3', emoji: '💪', title: 'Hit the gym', rule: 'Any workout counts. Show up.', days: [1, 3, 5], opens: '', due: '', mode: 'group', stakes: 'Slipper buys the post-gym drinks', by: 'demo2', who: ['me', 'demo2', 'demo4', 'demo5'], len: 5 },
    { id: 'pdemo4', emoji: '💧', title: 'Drink enough water', rule: 'Finish your bottle before the day ends.', days: [], opens: '', due: '21:00', mode: 'solo', stakes: '', by: 'me', who: ['me', 'demo1', 'demo2', 'demo3', 'demo5'] },
    { id: 'pdemo5', emoji: '📚', title: 'Study for 2 hours', rule: 'Two focused hours, phone away.', days: [1, 2, 3, 4, 5], opens: '', due: '', mode: 'solo', stakes: '', by: 'demo3', who: ['me', 'demo2', 'demo3', 'demo5'] },
    { id: 'pdemo6', emoji: '⏰', title: 'Up by 8 AM', rule: 'Out of bed when the alarm goes. No snooze spiral.', days: [], opens: '06:00', due: '08:00', mode: 'group', stakes: '', by: 'demo5', who: ['demo1', 'demo2', 'demo5'], len: 7 } // you have not joined this one
  ];

  const kToday = dayKey(0);
  let myOpenLeft = 2; // leave two open pacts unchecked for you, so you can demo tapping Check in
  PACTS.forEach(p => {
    const pc = now - 28 * DAY;
    docs[`pods/${DEMO_POD}/pacts/${p.id}`] = { title: p.title, emoji: p.emoji, rule: p.rule, days: p.days, opens: p.opens, due: p.due, mode: p.mode, stakes: p.stakes, by: p.by === 'me' ? me : p.by, created: pc };
    const group = p.mode === 'group';
    const ppl = p.who.map(w => w === 'me' ? me : w);
    const breaker = group ? pick(ppl) : null;
    ppl.forEach(u => {
      const isMe = u === me;
      const sLen = group ? p.len : isMe ? 4 + Math.floor(rnd() * 14) : Math.floor(rnd() * 22);
      const days = {};
      let j = 0;
      for (let i = 1; i <= 28; i++) {
        const k = dayKey(-i);
        if (!sched(p, k)) continue;
        const done = j < sLen ? true : j === sLen ? (group && u !== breaker) : rnd() < 0.78;
        if (done) days[k] = when(p, k);
        else if (p.due && rnd() < 0.4) days[k] = hm(k, p.due) + Math.round((10 + rnd() * 80) * 60000); // a late one
        j++;
      }
      // today
      if (sched(p, kToday)) {
        const openTs = p.opens ? hm(kToday, p.opens) : null;
        const dueTs = p.due ? hm(kToday, p.due) + 59999 : null;
        const phase = openTs && now < openTs ? 'wait' : dueTs && now > dueTs ? 'past' : 'open';
        let check = false;
        if (phase === 'open') check = isMe ? myOpenLeft-- <= 0 : rnd() < 0.6;
        else if (phase === 'past') check = isMe || group || rnd() < 0.85;
        if (check) days[kToday] = phase === 'past' ? when(p, kToday) : when(p, kToday, now - 4 * 3600000, now - 60000);
      }
      docs[`pods/${DEMO_POD}/pledges/${p.id}-${u}`] = { p: p.id, u, joined: pc + 3600000, days };
    });
  });

  // upcoming plans
  const EV = [['Pod dinner', '18:30', '20:00', 'Canteen B'], ['Gym together', '17:30', '18:30', ''], ['Game night', '20:00', '22:30', 'Common room'],
    ['Study together', '14:00', '16:00', 'Library level 2'], ['Breakfast run', '08:00', '09:00', ''], ['Movie night', '20:30', '23:00', 'Bring snacks']];
  EV.forEach((e, i) => {
    const going = people.map(x => x[0]).filter(() => rnd() < 0.6);
    const by = i < 2 ? me : pick(people)[0];
    if (!going.includes(by)) going.push(by);
    docs[`pods/${DEMO_POD}/events/edemo${i}`] = { title: e[0], date: dayKey(i === 0 ? 0 : 1 + Math.floor(rnd() * 9)), start: e[1], end: e[2], note: e[3], by, going, created: now - i * 3600000 };
  });
  // personal goals for you (study hours come from the focus log above)
  const gLog = (days, f) => { const o = {}; for (let d = 1; d <= days; d++) { const v = f(); if (v) o[dayKey(-d)] = v; } return o; };
  const goal = (id, g) => { docs[`pods/${DEMO_POD}/goals/${id}`] = { u: me, created: now - 14 * DAY, log: {}, ...g }; };
  goal('gdemo1', { title: 'Study time', emoji: '📚', type: 'focus', unit: 'hr', target: 2, period: 'day' });
  goal('gdemo2', { title: 'Weekly study', emoji: '🎓', type: 'focus', unit: 'hr', target: 8, period: 'week' });
  goal('gdemo3', { title: 'Sleep', emoji: '😴', type: 'atleast', unit: 'hr', target: 7, period: 'day', log: gLog(13, () => Math.round((5.5 + rnd() * 3) * 4) / 4) });
  goal('gdemo4', { title: 'Supper out', emoji: '🍜', type: 'atmost', unit: 'times', target: 2, period: 'week', log: gLog(13, () => (rnd() < 0.2 ? 1 : 0)) });
  return docs;
}

function switchMode(toDemo, uid, name) {
  flush(false); // whatever is active gets saved first, so real data is never lost
  if (toDemo) {
    store = new Map(Object.entries(buildDemo(uid, name)));
    activeFile = DEMO_FILE; demoMode = true;
    flush(true);
  } else {
    store = loadStore(DATA_FILE);
    activeFile = DATA_FILE; demoMode = false;
  }
  console.log(demoMode ? 'Demo mode ON  (using data.demo.json)' : 'Demo mode OFF (back to data.json)');
  broadcastRaw({ reset: true });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500); return res.end('public/index.html is missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  }

  if (url.pathname === '/favicon.png' || url.pathname === '/favicon.ico') {
    return fs.readFile(FAVICON, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(buf);
    });
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/dev') {
    if (req.method === 'GET') return send(res, 200, { demo: demoMode, pod: DEMO_POD });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    try {
      const body = await readBody(req);
      const code = String(body.code || '').trim().toLowerCase();
      if (code === 'normal') {
        if (demoMode) switchMode(false);
        return send(res, 200, { ok: true, demo: false });
      }
      if (code === DEV_CODE) {
        const uid = typeof body.uid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(body.uid) ? body.uid : null;
        switchMode(true, uid, String(body.name || '').slice(0, 20));
        return send(res, 200, { ok: true, demo: true, pod: DEMO_POD });
      }
      return send(res, 403, { error: 'That dev code is not recognised.' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/doc' || url.pathname === '/api/col') {
    const p = url.searchParams.get('path') || '';
    if (!VALID_PATH.test(p)) return send(res, 400, { error: 'bad path' });

    if (url.pathname === '/api/col') {
      const docs = [];
      for (const [k, v] of store) {
        if (k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')) {
          docs.push({ id: k.slice(p.length + 1), data: v });
        }
      }
      return send(res, 200, { docs });
    }

    try {
      if (req.method === 'GET') {
        return send(res, 200, store.has(p) ? { exists: true, data: store.get(p) } : { exists: false });
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const body = await readBody(req);
        if (typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'object expected' });
        store.set(p, req.method === 'PUT' ? body : { ...(store.get(p) || {}), ...body });
      } else if (req.method === 'DELETE') {
        store.delete(p);
      } else {
        return send(res, 405, { error: 'method not allowed' });
      }
      persist();
      broadcast(p);
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Hall Pods running.\n  This machine: http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list) if (n.family === 'IPv4' && !n.internal) console.log(`  Same Wi-Fi:   http://${n.address}:${PORT}`);
    }
  }
  console.log(`  Dev code: "${DEV_CODE}" turns on demo data, "normal" turns it off`);
});
