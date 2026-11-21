// Pianot — noterna glider ner, barnet trycker på stora tangenter
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W = 1000, H = 700, DPR = 1;

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(300, window.innerWidth);
  H = Math.max(320, window.innerHeight);
  cv.width = Math.floor(W * DPR);
  cv.height = Math.floor(H * DPR);
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  layout();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

// --- tangenter (en liten oktav, C till c) ---------------------
const KEYS = [
  { n: 'C', f: 523.25, col: '#ef6a5a' },
  { n: 'D', f: 587.33, col: '#ef9a3d' },
  { n: 'E', f: 659.25, col: '#efc93d' },
  { n: 'F', f: 698.46, col: '#6fbf85' },
  { n: 'G', f: 783.99, col: '#45b7d1' },
  { n: 'A', f: 880.00, col: '#6f7fd1' },
  { n: 'B', f: 987.77, col: '#9b6bc9' },
  { n: 'c', f: 1046.50, col: '#e56aa8' },
];

// --- låtar -----------------------------------------------------
// [ton, takter] – '-' är paus. Alla låtar går i C-dur så att åtta tangenter räcker.
const SONGS = [
  {
    id: 'blinka', titel: 'Blinka lilla stjärna', ikon: 'stjärna',
    melodi: [
      ['C',1],['C',1],['G',1],['G',1],['A',1],['A',1],['G',2],
      ['F',1],['F',1],['E',1],['E',1],['D',1],['D',1],['C',2],
      ['G',1],['G',1],['F',1],['F',1],['E',1],['E',1],['D',2],
      ['G',1],['G',1],['F',1],['F',1],['E',1],['E',1],['D',2],
      ['C',1],['C',1],['G',1],['G',1],['A',1],['A',1],['G',2],
      ['F',1],['F',1],['E',1],['E',1],['D',1],['D',1],['C',2],
      ['-',2],
    ],
  },
  {
    id: 'broder', titel: 'Broder Jakob', ikon: 'flagga',
    melodi: [
      ['C',1],['D',1],['E',1],['C',1],['C',1],['D',1],['E',1],['C',1],
      ['E',1],['F',1],['G',2],['E',1],['F',1],['G',2],
      ['G',0.5],['A',0.5],['G',0.5],['F',0.5],['E',1],['C',1],
      ['G',0.5],['A',0.5],['G',0.5],['F',0.5],['E',1],['C',1],
      ['c',1],['G',1],['c',2],['c',1],['G',1],['c',2],
      ['-',2],
    ],
  },
  {
    id: 'bab', titel: 'Bä, bä, vita lamm', ikon: 'lamm',
    melodi: [
      ['G',1],['G',1],['E',1],['E',1],['C',1],['D',1],['D',1],['C',2],
      ['G',1],['G',1],['E',1],['E',1],['C',1],['D',1],['D',1],['C',2],
      ['A',1],['A',1],['G',1],['F',1],['E',1],['D',1],['C',2],
      ['D',1],['E',1],['F',1],['E',1],['D',1],['C',2],
      ['A',1],['A',1],['G',1],['F',1],['E',1],['D',1],['C',2],
      ['D',1],['E',1],['D',1],['C',3],
      ['-',2],
    ],
  },
];

const BPM = 86;
const BEAT = 60000 / BPM;
const LEAD = 2600;          // hur lång tid en not tar att glida ner
const GAP = 0.18;           // luft mellan noterna (i takter)

// --- tillstånd -------------------------------------------------
const S = {
  mode: 'menu',            // menu | song | free | done
  song: null,
  notes: [],
  next: 0,
  t0: 0,
  now: 0,
  hits: 0,
  perfekt: 0,
  fel: 0,
  popup: null,             // { text, col, t }
  tipT: 0,
  ripples: [],
  pressed: {},             // lane -> antal fingrar
  ptr: {},                 // pointerId -> lane
  freeSpark: [],
  stars: loadStars(),
  lastGrade: '',
  hintLane: null, hintT: 0,
  holds: {}, holdTipShown: false,
};

function loadStars() {
  try { return JSON.parse(localStorage.getItem('pianot-stjarnor') || '{}'); } catch (e) { return {}; }
}
function saveStars() {
  try { localStorage.setItem('pianot-stjarnor', JSON.stringify(S.stars)); } catch (e) {}
}

// --- ljud ------------------------------------------------------
let actx = null, master = null, analyser = null;
function audio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -8; comp.knee.value = 20; comp.ratio.value = 4;
      master = actx.createGain();
      master.gain.value = 1.9;
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      // mjuk limiter så att många fingrar samtidigt inte skorrar
      const lim = actx.createDynamicsCompressor();
      lim.threshold.value = -5; lim.knee.value = 6; lim.ratio.value = 14;
      lim.attack.value = 0.004; lim.release.value = 0.12;
      master.connect(lim); lim.connect(analyser);
      lim.connect(comp); comp.connect(actx.destination);
    } catch (e) {}
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}

// pianoton: grundton + två övertoner med snabb anslag och lång avklingning
function note(freq, dur, vol) {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  const g = a.createGain();
  const v = vol || 0.22;
  const d = dur || 1.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.012);
  g.gain.setTargetAtTime(0, t + 0.06, d * 0.30);
  g.connect(master || a.destination);

  const parts = [[1, 1], [2, 0.32], [3, 0.12]];
  for (const p of parts) {
    const o = a.createOscillator();
    o.type = p[0] === 1 ? 'triangle' : 'sine';
    o.frequency.value = freq * p[0];
    const gg = a.createGain();
    gg.gain.value = p[1];
    o.connect(gg); gg.connect(g);
    o.start(t); o.stop(t + d + 0.05);
  }
}

// hållen ton: mjuk pad som börjar vid anslag och klingar tills fingret lyfts
function startHold(lane, n) {
  const a = audio(); if (!a) return;
  if (S.holds[lane]) stopHold(lane);
  const k = KEYS[lane];
  const t = a.currentTime;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + 0.03);
  const o1 = a.createOscillator(); o1.type = 'triangle'; o1.frequency.value = k.f;
  const o2 = a.createOscillator(); o2.type = 'sine'; o2.frequency.value = k.f * 2;
  const g2 = a.createGain(); g2.gain.value = 0.28;
  o1.connect(g); o2.connect(g2); g2.connect(g);
  g.connect(master || a.destination);
  o1.start(t); o2.start(t);
  S.holds[lane] = { n: n, o1: o1, o2: o2, g: g };
}

function stopHold(lane) {
  const h = S.holds[lane]; if (!h) return;
  delete S.holds[lane];
  const a = actx; if (!a) return;
  const t = a.currentTime;
  try {
    h.g.gain.cancelScheduledValues(t);
    h.g.gain.setValueAtTime(Math.max(0.0001, h.g.gain.value), t);
    h.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    h.o1.stop(t + 0.24); h.o2.stop(t + 0.24);
  } catch (e) {}
}

function stopAllHolds() {
  Object.keys(S.holds).forEach(function (lane) { stopHold(Number(lane)); });
}

function chime(grade) {
  const base = grade === 3 ? 1046 : grade === 2 ? 880 : 740;
  note(base, 0.5, 0.14);
  setTimeout(function () { note(base * 1.5, 0.45, 0.10); }, 70);
}
function thud() {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.value = 180;
  o.frequency.exponentialRampToValueAtTime(90, a.currentTime + 0.18);
  g.gain.value = 0.06; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.2);
  o.connect(g); g.connect(master);
  o.start(); o.stop(a.currentTime + 0.22);
}

function speak(txt) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = 'sv-SE'; u.rate = 0.95; u.pitch = 1.1; u.volume = 1;
    const v = (window.speechSynthesis.getVoices() || []).filter(function (x) { return (x.lang || '').indexOf('sv') === 0; })[0];
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

// --- layout ----------------------------------------------------
const L = { keys: [], laneTop: 0, hitY: 0, cards: [], done: {}, nav: {} };

function layout() {
  const portrait = H > W;
  const keysH = Math.max(150, Math.min(portrait ? H * 0.30 : H * 0.34, 300));
  const padX = Math.max(8, W * 0.02);
  const kw = (W - padX * 2) / KEYS.length;
  const keyTop = H - keysH;
  L.keys = [];
  for (let i = 0; i < KEYS.length; i++) {
    L.keys.push({ i: i, x: padX + i * kw, y: keyTop, w: kw, h: keysH });
  }
  L.hitY = keyTop - 6;
  L.laneTop = Math.max(96, H * 0.13);
  L.laneW = kw;

  // meny: fyra stora kort (3 låtar + fritt spel)
  const cols = W > 900 ? 2 : 1;
  const rows = Math.ceil(4 / cols);
  const mPad = Math.max(18, W * 0.04);
  const topY = Math.max(120, H * 0.20);
  const cw = (W - mPad * 2 - (cols - 1) * 18) / cols;
  const ch = Math.min(H > W ? 150 : 196, (H - topY - 20) / rows - 14);
  const totalH = rows * ch + (rows - 1) * 14;
  const topY2 = Math.max(topY, (H - totalH) / 2 + 10);
  L.cards = [];
  for (let i = 0; i < 4; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    L.cards.push({ i: i, x: mPad + c * (cw + 18), y: topY2 + r * (ch + 14), w: cw, h: ch });
  }
  L.done.igen = { x: W / 2 - 220, y: H * 0.66, w: 200, h: 72 };
  L.done.ny = { x: W / 2 + 20, y: H * 0.66, w: 200, h: 72 };
  L.nav = { x: 16, y: 16, w: 66, h: 66 };
}

// --- låtbygge --------------------------------------------------
function buildNotes(song) {
  const out = [];
  let t = 3000; // liten förberedelsetid
  for (const step of song.melodi) {
    const beats = step[1];
    if (step[0] !== '-') {
      const lane = KEYS.findIndex(function (k) { return k.n === step[0]; });
      const dur = beats * BEAT * 0.92;
      if (lane >= 0) out.push({ lane: lane, time: t, dur: dur, long: dur > 900, done: false, missed: false, holding: false });
    }
    t += beats * BEAT + GAP * BEAT;
  }
  return out;
}

function startSong(song) {
  audio();
  S.mode = 'song';
  S.song = song;
  S.notes = buildNotes(song);
  S.next = 0;
  S.hits = 0; S.perfekt = 0; S.fel = 0; S.holdShort = 0;
  S.popup = null; S.ripples = [];
  stopAllHolds();
  S.holdTipShown = false;
  S.t0 = performance.now() + 900; // ge noterna en liten stund innan de börjar
  S.tipT = 7;
}

function startFree() {
  audio();
  stopAllHolds();
  S.mode = 'free';
  S.song = null;
  S.ripples = [];
}

// --- speltid ---------------------------------------------------
function songNow() { return performance.now() - S.t0; }

// --- tryck -----------------------------------------------------
function pressLane(lane, pid) {
  if (S.mode !== 'song' && S.mode !== 'free') return;
  S.pressed[lane] = (S.pressed[lane] || 0) + 1;
  const k = KEYS[lane];
  note(k.f, 0.7, 0.3);
  S.ripples.push({ lane: lane, t: 0, col: k.col, big: S.mode === 'free' });

  if (S.mode === 'free') {
    startHold(lane, null);
    // fritt spel: små gnistor far uppåt
    for (let i = 0; i < 6; i++) {
      S.freeSpark.push({
        x: L.keys[lane].x + L.keys[lane].w / 2 + (Math.random() - 0.5) * 40,
        y: L.hitY - Math.random() * 60,
        vy: -60 - Math.random() * 120, life: 1, col: k.col,
      });
    }
    return;
  }

  const now = songNow();
  let best = null, bestDt = 1e9;
  for (const n of S.notes) {
    if (n.done || n.missed || n.holding) continue;
    if (n.lane !== lane) continue;
    const dt = now - n.time;
    if (Math.abs(dt) < Math.abs(bestDt)) { best = n; bestDt = dt; }
  }

  if (best && Math.abs(bestDt) <= 340) {
    S.tipT = 0;
    const ad = Math.abs(bestDt);
    let grade = 1;
    if (ad < 130) grade = 3; else if (ad < 240) grade = 2;

    if (best.long) {
      // lång not: barnet måste hålla kvar – tonen klingar medan fingret är nere
      best.holding = true;
      best.hitAt = now;
      best.grade = grade;
      startHold(lane, best);
      if (!S.holdTipShown) {
        S.holdTipShown = true;
        S.popup = { text: 'HÅLL KVAR!', col: '#4f8ed6', t: 0, grade: 2, long: true };
      }
      return;
    }

    best.done = true;
    S.hits++;
    finishNote(grade, lane);
  } else {
    S.fel++;
    // peka vänligt mot rätt tangent i stället för att bara låta "dunk"
    let nara = null, naraDt = 1e9;
    for (const n of S.notes) {
      if (n.done || n.missed) continue;
      const dt2 = Math.abs(now - n.time);
      if (dt2 < naraDt) { naraDt = dt2; nara = n; }
    }
    if (nara && naraDt < 420) {
      S.popup = { text: 'NÄSTAN!', col: '#8d9db0', t: 0, grade: 1 };
      S.hintLane = nara.lane;
      S.hintT = 1.2;
    }
    thud();
  }
}

function finishNote(grade, lane, textOverride, colOverride) {
  if (grade === 3) S.perfekt++;
  const text = textOverride || (grade === 3 ? 'PERFEKT!' : grade === 2 ? 'JÄTTEBRA!' : 'BRA!');
  const col = colOverride || (grade === 3 ? '#2f9e69' : grade === 2 ? '#e0a12a' : '#4f8ed6');
  S.popup = { text: text, col: col, t: 0, grade: grade };
  chime(grade);
  for (let i = 0; i < 12; i++) S.ripples.push({ lane: lane, t: 0, col: col, star: true });
}

function completeHold(n, lane, heldEnough) {
  if (n.done) return;
  n.done = true; n.holding = false;
  S.hits++;
  if (!heldEnough) S.holdShort = (S.holdShort || 0) + 1;
  finishNote(heldEnough ? n.grade : 1, lane,
    heldEnough ? null : 'HÅLL KVAR!',
    heldEnough ? null : '#4f8ed6');
}

function releaseLane(lane) {
  S.pressed[lane] = Math.max(0, (S.pressed[lane] || 0) - 1);
  const h = S.holds[lane];
  if (!h) return;
  stopHold(lane);
  if (S.mode !== 'song') return;
  const n = h.n;
  if (!n || n.done) return;
  const held = songNow() - n.hitAt;
  const frac = held / Math.max(1, n.dur);
  completeHold(n, lane, frac >= 0.45);
}

// --- uppdatering ----------------------------------------------
function update(dt) {
  S.now += dt;
  if (S.popup) { S.popup.t += dt; if (S.popup.t > 0.85) S.popup = null; }
  if (S.tipT > 0) S.tipT = Math.max(0, S.tipT - dt);
  if (S.hintT > 0) S.hintT = Math.max(0, S.hintT - dt);
  S.ripples = S.ripples.filter(function (r) { r.t += dt; return r.t < 0.6; });
  S.freeSpark = S.freeSpark.filter(function (p) { p.y += p.vy * dt; p.life -= dt * 1.2; return p.life > 0; });
  if (S.mode === 'free') {
    if (!S.noteDrift) S.noteDrift = [];
    if (Math.random() < dt * 2.4) {
      S.noteDrift.push({
        x: 40 + Math.random() * (W - 80), y: L.hitY - 30,
        vy: -30 - Math.random() * 40, life: 1,
        glyph: ['♪', '♫', '♩'][Math.floor(Math.random() * 3)],
        col: KEYS[Math.floor(Math.random() * KEYS.length)].col,
      });
    }
    S.noteDrift = S.noteDrift.filter(function (n) { n.y += n.vy * dt; n.life -= dt * 0.22; return n.life > 0 && n.y > -40; });
  }

  if (S.mode !== 'song') return;
  const now = songNow();

  // hållna noter: klara när barnet hållit tillräckligt länge (eller hela noten)
  for (const n of S.notes) {
    if (!n.holding || n.done) continue;
    const held = now - n.hitAt;
    if (held >= n.dur * 0.6 || now > n.time + n.dur) {
      // noten är "klar" – men tonen får klinga så länge barnet håller kvar fingret
      completeHold(n, n.lane, true);
    }
  }

  // noter som gått förbi utan att träffas
  for (const n of S.notes) {
    if (!n.done && !n.missed && !n.holding && now > n.time + 360) {
      n.missed = true;
    }
  }
  // låten är slut när sista noten är passerad
  const last = S.notes[S.notes.length - 1];
  if (last && now > last.time + 1200) {
    stopAllHolds();
    S.mode = 'done';
    let stars = Math.max(1, Math.round((S.hits / Math.max(1, S.notes.length)) * 3));
    // långa noter måste hållas för att det ska bli fullt med stjärnor
    const langa = S.notes.filter(function (n) { return n.long; }).length;
    if (langa) {
      const kort = (S.holdShort || 0) / langa;
      if (kort > 0.4) stars = Math.min(stars, 2);
    }
    S.stars[S.song.id] = Math.max(S.stars[S.song.id] || 0, stars);
    saveStars();
    S.lastStars = stars;
    S.popup = null;
    setTimeout(function () {
      note(784, 1.4, 0.16);
      setTimeout(function () { note(1046, 1.6, 0.14); }, 220);
      speak('Vilken låt!');
    }, 150);
  }
}

// --- rita ------------------------------------------------------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function starShape(x, y, r, col) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = col || '#f7c948'; ctx.fill();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f2f7fb');
  g.addColorStop(1, '#fdf3e7');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i < 5; i++) {
    const x = ((i * 260 + S.now * 8) % (W + 300)) - 150;
    const y = 40 + (i % 3) * 46;
    ctx.beginPath(); ctx.arc(x, y, 26, 0, 6.3); ctx.arc(x + 28, y + 4, 19, 0, 6.3); ctx.arc(x - 28, y + 6, 16, 0, 6.3); ctx.fill();
  }
}

function drawLanes() {
  // mjuka fält bakom varje tangent
  for (let i = 0; i < KEYS.length; i++) {
    const k = L.keys[i];
    const g = ctx.createLinearGradient(0, L.laneTop, 0, L.hitY);
    const c = KEYS[i].col;
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, hexA(c, 0.16));
    ctx.fillStyle = g;
    ctx.fillRect(k.x + 2, L.laneTop, k.w - 4, L.hitY - L.laneTop);
  }
  // träfflinjen
  const g2 = ctx.createLinearGradient(0, L.hitY - 8, 0, L.hitY + 10);
  g2.addColorStop(0, 'rgba(74,63,57,.05)');
  g2.addColorStop(0.5, 'rgba(74,63,57,.28)');
  g2.addColorStop(1, 'rgba(74,63,57,.05)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, L.hitY - 8, W, 18);
}

function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function drawNotes() {
  if (S.mode !== 'song') return;
  const now = songNow();
  const span = L.hitY - L.laneTop;
  for (const n of S.notes) {
    if (n.done) continue;
    if (n.holding) {
      // noten "brinner ner" medan barnet håller – det som är kvar syns ovanför linjen
      const k = L.keys[n.lane];
      const remain = Math.max(0, (n.time + n.dur) - now);
      const h2 = Math.max(12, (remain / LEAD) * span);
      const w = k.w * 0.74, x = k.x + (k.w - w) / 2;
      ctx.fillStyle = hexA(KEYS[n.lane].col, 0.55 + 0.25 * Math.sin(S.now * 12));
      roundRect(x, L.hitY - h2, w, h2, Math.min(18, w * 0.34)); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.font = 'bold ' + Math.round(Math.min(26, w * 0.36)) + 'px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('HÅLL', x + w / 2, L.hitY - Math.min(h2 - 8, 26));
      continue;
    }
    const k = L.keys[n.lane];
    const yHead = L.hitY - ((n.time - now) / LEAD) * span;
    const h = Math.max(26, (n.dur / LEAD) * span);
    const y = yHead - h;
    if (y > L.hitY + 40) continue;
    if (y + h < L.laneTop - 200) continue;
    const col = n.missed ? 'rgba(150,140,132,.45)' : KEYS[n.lane].col;
    const w = k.w * 0.74;
    const x = k.x + (k.w - w) / 2;

    ctx.fillStyle = 'rgba(0,0,0,.10)';
    roundRect(x + 3, y + 4, w, h, Math.min(18, w * 0.34)); ctx.fill();
    ctx.fillStyle = col;
    roundRect(x, y, w, h, Math.min(18, w * 0.34)); ctx.fill();
    if (!n.missed) {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      roundRect(x + w * 0.16, y + Math.min(8, h * 0.16), w * 0.22, Math.max(8, h - Math.min(16, h * 0.32)), 8); ctx.fill();
    }
    // bokstaven på noten
    ctx.fillStyle = n.missed ? 'rgba(255,255,255,.7)' : '#fff';
    ctx.font = 'bold ' + Math.round(Math.min(30, w * 0.42)) + 'px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(KEYS[n.lane].n.toUpperCase(), x + w / 2, y + Math.min(h - 8, Math.max(26, h * 0.55)));
  }
}

function drawHint() {
  if (S.mode !== 'song') return;
  if (S.hintT > 0 && S.hintLane !== undefined && S.hintLane !== null) {
    const k = L.keys[S.hintLane];
    const u = S.hintT / 1.2;
    ctx.strokeStyle = hexA(KEYS[S.hintLane].col, 0.9 * u);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(k.x + k.w / 2, L.hitY - 2, k.w * (0.36 + 0.1 * (1 - u)), 0, 6.3);
    ctx.stroke();
  }
  const now = songNow();
  for (const n of S.notes) {
    if (n.done || n.missed) continue;
    const dt = n.time - now;
    if (dt > 0 && dt < 1000) {
      const k = L.keys[n.lane];
      const a = 0.25 + 0.25 * Math.sin(S.now * 10);
      ctx.strokeStyle = hexA(KEYS[n.lane].col, a + 0.25);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(k.x + k.w / 2, L.hitY - 2, k.w * 0.33, 0, 6.3);
      ctx.stroke();
      break;
    }
  }
}

function drawKeys() {
  for (let i = 0; i < L.keys.length; i++) {
    const k = L.keys[i], c = KEYS[i].col;
    const down = (S.pressed[i] || 0) > 0;
    const lift = down ? 5 : 0;
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    roundRect(k.x + 3, k.y + 6, k.w - 6, k.h - 8, 16); ctx.fill();
    const g = ctx.createLinearGradient(0, k.y, 0, k.y + k.h);
    g.addColorStop(0, down ? c : shade(c, 1.14));
    g.addColorStop(1, down ? shade(c, 0.78) : c);
    ctx.fillStyle = g;
    roundRect(k.x + 3, k.y + lift, k.w - 6, k.h - 8 - lift, 16); ctx.fill();

    // glans
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    roundRect(k.x + k.w * 0.16, k.y + 12 + lift, k.w * 0.18, k.h * 0.5, 9); ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.font = 'bold ' + Math.round(Math.min(36, k.w * 0.44)) + 'px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(KEYS[i].n.toUpperCase(), k.x + k.w / 2, k.y + k.h * 0.62 + lift);

    // håller barnet kvar: ring som fylls + sken runt tangenten
    const h = S.holds[i];
    if (h) {
      let prog = 0.15;
      if (h.n && h.n.dur) prog = Math.min(1, (songNow() - h.n.hitAt) / (h.n.dur * 0.6));
      // hela tangenten lyser svagt medan den hålls
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.12 * Math.sin(S.now * 8);
      ctx.fillStyle = '#fff';
      roundRect(k.x + 3, k.y + lift, k.w - 6, k.h - 8 - lift, 16); ctx.fill();
      ctx.restore();
      // vit ram runt tangenten
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 9;
      roundRect(k.x + 5, k.y + lift + 2, k.w - 10, k.h - 12 - lift, 15); ctx.stroke();
      // tangenten fylls underifrån medan barnet håller – lätt att se hur länge
      const fh = (k.h - 12 - lift) * prog;
      ctx.save();
      ctx.beginPath();
      roundRect(k.x + 5, k.y + lift + 2, k.w - 10, k.h - 12 - lift, 15);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.fillRect(k.x + 5, k.y + k.h - 10 - lift - fh, k.w - 10, fh);
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.fillRect(k.x + 5, k.y + k.h - 10 - lift - fh - 4, k.w - 10, 6);
      ctx.restore();
    }
  }
}

function shade(hex, k) {
  const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * k));
  const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * k));
  const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * k));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function drawRipples() {
  for (const r of S.ripples) {
    const k = L.keys[r.lane];
    const u = r.t / 0.6;
    if (r.star) {
      const a = 1 - u;
      ctx.globalAlpha = a;
      starShape(k.x + k.w / 2 + Math.sin(r.t * 20) * 30, L.hitY - 40 - u * 120, 9, '#f7c948');
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = hexA(r.col, (1 - u) * 0.7);
      ctx.lineWidth = 8 * (1 - u) + 1;
      ctx.beginPath();
      ctx.arc(k.x + k.w / 2, L.hitY - 4, 14 + u * 70, 0, 6.3);
      ctx.stroke();
    }
  }
  if (S.mode === 'free' && S.noteDrift) {
    for (const n of S.noteDrift) {
      ctx.globalAlpha = Math.max(0, Math.min(1, n.life)) * 0.85;
      ctx.fillStyle = n.col;
      ctx.font = 'bold 44px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(n.glyph, n.x, n.y);
      ctx.globalAlpha = 1;
    }
  }
  for (const p of S.freeSpark) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 6.3); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawTip() {
  if (S.tipT <= 0 || S.mode !== 'song' || S.popup) return;
  const a = Math.min(1, S.tipT) * Math.min(1, (7 - S.tipT) / 0.6);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  const w = Math.min(700, W * 0.92);
  const ty = L.laneTop + 4;
  ctx.fillStyle = 'rgba(74,63,57,.86)';
  roundRect(W / 2 - w / 2, ty, w, 58, 26); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold ' + Math.round(Math.min(22, W / 24)) + 'px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Tryck när noten når linjen – håll kvar på de långa!', W / 2, ty + 37);
  ctx.restore();
}

function drawPopup() {
  if (!S.popup) return;
  const p = S.popup;
  const u = Math.min(1, p.t / 0.18);
  const out = p.t > 0.65 ? 1 - (p.t - 0.65) / 0.2 : 1;
  const s = 0.7 + 0.3 * u + (p.grade === 3 ? 0.06 * Math.sin(p.t * 18) : 0);
  ctx.save();
  ctx.globalAlpha = Math.max(0, out);
  ctx.translate(W / 2, H * 0.16);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(255,250,243,.95)';
  roundRect(-170, -44, 340, 88, 30); ctx.fill();
  ctx.strokeStyle = p.col; ctx.lineWidth = 5;
  roundRect(-170, -44, 340, 88, 30); ctx.stroke();
  ctx.fillStyle = p.col;
  ctx.font = 'bold 44px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(p.text, 0, 16);
  ctx.restore();
}

function drawHud() {
  // poäng och stjärnor (bara när man spelar en låt)
  if (S.mode === 'song') {
    ctx.fillStyle = 'rgba(255,250,243,.94)';
    roundRect(W - 190, 16, 174, 62, 20); ctx.fill();
    starShape(W - 162, 47, 16);
    ctx.fillStyle = '#4a3f39';
    ctx.font = 'bold 24px "Trebuchet MS", sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('× ' + S.hits, W - 138, 56);
  } else {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#4a3f39';
    ctx.font = 'bold ' + Math.round(Math.min(38, W * 0.05)) + 'px "Trebuchet MS", sans-serif';
    ctx.fillText('SPELA FRITT', W / 2, 52);
    ctx.fillStyle = '#a08e80';
    ctx.font = 'bold 17px "Trebuchet MS", sans-serif';
    ctx.fillText('tryck på tangenterna!', W / 2, 80);
  }

  // bakåtknapp
  ctx.fillStyle = 'rgba(255,250,243,.94)';
  roundRect(L.nav.x, L.nav.y, L.nav.w, L.nav.h, 20); ctx.fill();
  ctx.fillStyle = '#4a3f39';
  ctx.beginPath();
  ctx.moveTo(L.nav.x + 42, L.nav.y + 20);
  ctx.lineTo(L.nav.x + 42, L.nav.y + L.nav.h - 20);
  ctx.lineTo(L.nav.x + 22, L.nav.y + L.nav.h / 2);
  ctx.closePath(); ctx.fill();

  // låtens namn
  if (S.song) {
    ctx.fillStyle = 'rgba(74,63,57,.55)';
    ctx.font = 'bold 15px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(S.song.titel.toUpperCase(), W / 2, 40);
  }
}

function drawMenu() {
  drawBackground();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4a3f39';
  ctx.font = 'bold ' + Math.round(Math.min(42, W * 0.06)) + 'px "Trebuchet MS", sans-serif';
  ctx.fillText('Vad vill du spela?', W / 2, Math.max(64, H * 0.11));
  ctx.fillStyle = '#a08e80';
  ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
  ctx.fillText('tryck på en låt', W / 2, Math.max(88, H * 0.11) + 26);

  const items = SONGS.map(function (s) { return s; }).concat([{ id: 'free', titel: 'Spela fritt', ikon: 'hand' }]);
  for (let i = 0; i < L.cards.length; i++) {
    const c = L.cards[i], item = items[i];
    if (!item) continue;
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    roundRect(c.x + 4, c.y + 6, c.w, c.h, 24); ctx.fill();
    ctx.fillStyle = '#fffaf3';
    roundRect(c.x, c.y, c.w, c.h, 24); ctx.fill();
    ctx.strokeStyle = 'rgba(74,63,57,.10)'; ctx.lineWidth = 3;
    roundRect(c.x, c.y, c.w, c.h, 24); ctx.stroke();

    // liten klaviatur som ikon
    const iw = Math.min(150, c.w * 0.34), ih = iw * 0.62;
    const ix = c.x + 22, iy = c.y + (c.h - ih) / 2;
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = KEYS[k * 1.4 | 0].col;
      roundRect(ix + k * (iw / 5) + 2, iy, iw / 5 - 4, ih, 8); ctx.fill();
    }
    ctx.fillStyle = '#4a3f39';
    ctx.textAlign = 'left';
    ctx.font = 'bold ' + Math.round(Math.min(30, c.w * 0.055)) + 'px "Trebuchet MS", sans-serif';
    ctx.fillText(item.titel, ix + iw + 22, c.y + c.h / 2 + 2);

    // stjärnor för klarat spel
    if (item.id !== 'free') {
      const got = S.stars[item.id] || 0;
      for (let s = 0; s < 3; s++) {
        starShape(ix + iw + 26 + s * 26, c.y + c.h / 2 + 30, 10, s < got ? '#f7c948' : 'rgba(74,63,57,.14)');
      }
    }
  }
}

function drawDone() {
  drawBackground();
  ctx.textAlign = 'center';
  const stars = S.lastStars || 1;
  ctx.fillStyle = '#4a3f39';
  ctx.font = 'bold ' + Math.round(Math.min(44, W * 0.065)) + 'px "Trebuchet MS", sans-serif';
  ctx.fillText('VILKEN LÅT!', W / 2, H * 0.30);
  for (let i = 0; i < 3; i++) {
    starShape(W / 2 - 80 + i * 80, H * 0.44, 32, i < stars ? '#f7c948' : 'rgba(74,63,57,.12)');
  }
  ctx.fillStyle = '#a08e80';
  ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
  ctx.fillText(S.hits + ' rätt av ' + S.notes.length + ' noter', W / 2, H * 0.55);

  for (const key of ['igen', 'ny']) {
    const b = L.done[key];
    ctx.fillStyle = key === 'igen' ? '#63bda8' : '#ef8064';
    roundRect(b.x, b.y, b.w, b.h, 26); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px "Trebuchet MS", sans-serif';
    ctx.fillText(key === 'igen' ? 'IGEN' : 'NY LÅT', b.x + b.w / 2, b.y + b.h / 2 + 8);
  }
}

function draw() {
  // håll koll på storleken även när webbläsaren inte skickar resize (iPad-delad skärm, rotation)
  if (Math.abs(window.innerWidth - W) > 1 || Math.abs(window.innerHeight - H) > 1) resize();
  const dt = Math.min(0.05, (performance.now() - (draw.last || performance.now())) / 1000);
  draw.last = performance.now();
  update(dt);

  ctx.clearRect(0, 0, W, H);
  if (S.mode === 'menu') { drawMenu(); }
  else if (S.mode === 'done') { drawDone(); }
  else {
    drawBackground();
    drawLanes();
    drawNotes();
    drawHint();
    drawRipples();
    drawTip();
    drawKeys();
    drawPopup();
    drawHud();
  }
  requestAnimationFrame(draw);
}

// --- inmatning -------------------------------------------------
function pos(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function inRect(r, p) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

cv.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  audio();
  const p = pos(e);

  if (S.mode === 'menu') {
    for (const c of L.cards) {
      if (inRect(c, p)) {
        if (c.i < SONGS.length) startSong(SONGS[c.i]);
        else startFree();
        return;
      }
    }
    return;
  }
  if (S.mode === 'done') {
    if (inRect(L.done.igen, p)) { startSong(S.song); return; }
    if (inRect(L.done.ny, p)) { S.mode = 'menu'; S.song = null; return; }
    return;
  }
  if (inRect(L.nav, p)) { stopAllHolds(); S.mode = 'menu'; S.song = null; S.pressed = {}; return; }

  if (p.y >= L.hitY - Math.max(70, H * 0.10)) {
    const lane = Math.floor((p.x - L.keys[0].x) / L.laneW);
    if (lane >= 0 && lane < KEYS.length) {
      S.ptr[e.pointerId] = lane;
      pressLane(lane, e.pointerId);
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    }
  }
});

function endPointer(e) {
  const lane = S.ptr[e.pointerId];
  if (lane !== undefined) { releaseLane(lane); delete S.ptr[e.pointerId]; }
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', endPointer);
document.addEventListener('blur', function () { S.pressed = {}; S.ptr = {}; });

window.addEventListener('keydown', function (e) {
  const map = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7 };
  const lane = map[e.key.toLowerCase()];
  if (lane !== undefined && !e.repeat) pressLane(lane, 'kb');
});
window.addEventListener('keyup', function (e) {
  const map = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7 };
  const lane = map[e.key.toLowerCase()];
  if (lane !== undefined) releaseLane(lane);
});

// --- testkrokar ------------------------------------------------
window.__pn = {
  state: function () {
    return {
      mode: S.mode, hits: S.hits, fel: S.fel, popup: S.popup ? S.popup.text : null,
      notes: S.notes.length, nextTime: S.notes[S.next] ? S.notes[S.next].time : null,
      now: S.mode === 'song' ? songNow() : 0,
      stars: S.lastStars || 0, holdShort: S.holdShort || 0,
      longNotes: S.notes.filter(function (n) { return n.long; }).length,
    };
  },
  play: function (id) {
    const s = SONGS.filter(function (x) { return x.id === id; })[0];
    if (s) startSong(s); else startFree();
  },
  tap: function (lane) { pressLane(lane, 'test'); releaseLane(lane); },
  free: function () { startFree(); },
  menu: function () { S.mode = 'menu'; S.song = null; },
  seek: function (ms) { S.t0 = performance.now() - ms; },
  plan: function () { return S.notes.map(function (n) { return { lane: n.lane, time: n.time, dur: n.dur }; }); },
  keys: function () { return L.keys.map(function (k) { return { x: k.x, y: k.y, w: k.w, h: k.h }; }); },
  level: function () {
    if (!analyser) return { ready: false };
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (let i = 0; i < buf.length; i++) { sum += buf[i] * buf[i]; peak = Math.max(peak, Math.abs(buf[i])); }
    return { ready: true, rms: Math.sqrt(sum / buf.length), peak: peak, state: actx.state };
  },
  auto: function (offset) {
    // spela låten automatiskt med en liten förskjutning (för test)
    const off = offset || 0;
    S.notes.forEach(function (n) {
      setTimeout(function () { pressLane(n.lane, 'auto'); releaseLane(n.lane); }, Math.max(0, n.time + off - songNow()));
    });
  },
};

resize();
requestAnimationFrame(draw);