// Démineur : ton appli d'origine (HTML et code inchangés), livrée en plugin.
// Ses données sont dans le dossier du plugin, que NeoBase sauvegarde (synchro cloud et sauvegardes) ; à la première ouverture elle reprend ce que tu avais dans NeoBase.
// Elle tourne dans le bac à sable de NeoBase, avec ses outils d'interface (ctx.host) et seulement les autorisations de son plugin.json.
const HTML = "<div class=\"appWrap wide\">\n      <div class=\"agHead\"><span class=\"label\">Démineur</span><span class=\"hint\" id=\"msInfo\"></span><div class=\"agNav\"><select class=\"f gSel\" id=\"msLevel\" title=\"Taille du plateau\"></select>\n        <label class=\"check\" title=\"Le plateau se résout toujours par la logique, sans jamais devoir deviner\"><input type=\"checkbox\" id=\"msNoGuess\"> Sans hasard</label>\n        <label class=\"check\" title=\"Le clic droit pose un drapeau, puis un « ? »\"><input type=\"checkbox\" id=\"msMarks\"> Marques ?</label>\n        <button class=\"btn px\" id=\"msHint\" title=\"Ouvre une case sûre (+10 s, pas de record)\">INDICE</button><button class=\"btn main px\" id=\"msNewBtn\">NOUVELLE PARTIE</button></div></div>\n      <div class=\"gameBox msBox\"><canvas id=\"msCanvas\" width=\"160\" height=\"190\"></canvas></div>\n      <div class=\"hint\">Clic : ouvrir une case · clic droit : drapeau (puis « ? ») · clic sur un chiffre dont tous les drapeaux sont posés (ou clic molette, ou les deux boutons) : ouvre ses voisines · clic sur le visage : nouvelle partie. Le chiffre d'une case = le nombre de mines autour. Le premier clic n'est jamais une mine. « Sans hasard » : le plateau se résout toujours par la logique. Meilleurs temps et statistiques sauvegardés et synchronisés.</div>\n    </div>";
/*CSS-MOVED*/ const CSS = `.gameBox{display:grid;place-items:center;padding:10px;background:#05010b;box-shadow:0 0 0 3px var(--line2)}
.gameBox.msBox canvas{aspect-ratio:auto;image-rendering:pixelated;max-width:100%}
.gameBox canvas{width:min(100%,1152px);aspect-ratio:384/144;image-rendering:pixelated;cursor:var(--cp,pointer)}
.gameBox.tall canvas{width:auto;height:min(720px,72vh);aspect-ratio:240/320}
.gSel{width:auto;font-size:14px;padding:6px 10px;margin-right:8px}
.shGrid td.num{text-align:right}
.nbaTeam.lost .tn{color:var(--muted)}
`;  // le style de ce plugin (il utilise les variables du thème de NeoBase)
export default async function (ctx) {
  const view = ctx.view;
  if (!ctx.host) { view.textContent = "Ce plugin doit être approuvé par NeoBase pour s'ouvrir."; return; }
  const host = ctx.host, { el, toast, sfx, ask, newTab, pixIcon, PIX, WX } = host;
  const folder = ctx.folder, legacy = ctx.legacy || {};
  ctx.host.addStyle(CSS);
  view.innerHTML = HTML;
  const $ = id => id === "minesApp" ? view : (view.querySelector('#' + id) || document.getElementById(id));  // les identifiants de ta vue d'abord, puis ceux de la page (fenêtres, menus)
  const doc = async n => { try { return await folder.read(n); } catch { return null; } };
  const __icon = () => ctx.icon;  // l'icône de ce plugin
  const LEGACY_GAMES = {"top":["mines"],"best":"^mines_"};
  let games = await doc('games');
  if (games == null) {  // première ouverture : tu retrouves tes records et tes parties d'avant
    const old = legacy.api ? await legacy.api('games').catch(() => null) : null; games = { best: {} };
    if (old) { const re = new RegExp(LEGACY_GAMES.best); for (const [k, v] of Object.entries(old.best || {})) if (re.test(k)) games.best[k] = v; for (const k of LEGACY_GAMES.top) if (old[k] !== undefined) games[k] = old[k]; await folder.write('games', games); }
  }
  games = { best: {}, ...games };
  let gamesTimer = null;
  const saveGames = () => { clearTimeout(gamesTimer); gamesTimer = setTimeout(() => { gamesTimer = null; folder.write('games', games).catch(() => {}); }, 500); };
  const best = (k, v, higher = true) => { const b = games.best[k]; if (b == null || (higher ? v > b : v < b)) { games.best[k] = v; saveGames(); return true; } return false; };
  const gstore = (k, init) => (games[k] ??= init);  // la section d'un jeu
function gameLoop(st, appKey, update, draw) {
  cancelAnimationFrame(st.raf);
  const STEP = 1000 / 60; let acc = 0, last = performance.now();
  const frame = t => {
    if (!view.classList.contains('on')) { st.raf = 0; if (st.mode === 'play') st.mode = 'pause'; return; }  // leaving the tab pauses the game
    st.raf = requestAnimationFrame(frame);
    acc += Math.min(200, t - last); last = t;
    while (acc >= STEP) { if (st.mode === 'play') update(); st.tick++; acc -= STEP; }
    draw();
  };
  st.raf = requestAnimationFrame(frame);
}
function gameText(g, w, lines, y0) {  // centred pixel-font lines over a dark band
  g.fillStyle = 'rgba(11,3,28,.72)'; g.fillRect(0, y0 - 14, w, lines.length * 14 + 14);
  g.textAlign = 'center';
  lines.forEach(([text, color, size], i) => { g.fillStyle = color; g.font = (size || 8) + 'px "Press Start 2P", monospace'; g.fillText(text, w / 2, y0 + i * 14); });
  g.textAlign = 'left';
}
const px = (g, color, x, y, w = 1, h = 1) => { g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), w, h); };
function sprite(g, rows, x, y, pal) { rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const c = pal[r[i]]; if (c) px(g, c, x + i, y + j); } }); }
  // ---- ton code d'origine ----
/* ---------- jeu "Démineur": open every cell without a mine. The number of a cell = mines around it. Right click: flag, then "?" ;
   clicking a number whose flags are all placed opens its neighbours. The first click is never a mine and opens an area.
   "Sans hasard": the mines are placed so the board can be solved by logic alone, never by guessing (checked by a small solver).
   Levels Débutant / Intermédiaire / Expert / Perso; best times and stats per level in games.json (synced). ---------- */
const MS = {S: 16, PAD: 8, BAR: 30,
  levels: {debutant: ['Débutant', 9, 9, 10], intermediaire: ['Intermédiaire', 16, 16, 40], expert: ['Expert', 30, 16, 99], perso: ['Perso', 20, 14, 45]},
  num: ['', '#7fe0ee', '#8ee8a0', '#ff5ad9', '#b46aee', '#ff7a4f', '#4fd0c8', '#ffffff', '#ffd07a'],
  mine: ['...o.o...', '..ooooo..', '.ooowoo..', 'ooowwooo.', '.ooooooo.', 'ooooooooo', '.ooooooo.', '..ooooo..', '...o.o...'],
  flag: ['..rr.....', '..rrrr...', '..rrrrrr.', '..rrrr...', '..rr.....', '..k......', '..k......', '.kkkk....', 'kkkkkk...'],
};
const msSave = () => gstore('mines', {stats: {}, level: 'debutant', noGuess: true, marks: true, perso: [20, 14, 45]});
let ms = null;
const msIdx = (x, y) => y * ms.w + x;
function msAround(i, w = ms.w, h = ms.h) {
  const x = i % w, y = i / w | 0, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) out.push(Y * w + X); }
  return out;
}
function msNew(level = msSave().level) {
  const s = msSave(), [, W, H, N] = level === 'perso' ? ['Perso', ...s.perso] : MS.levels[level];
  ms = {level, w: W, h: H, n: Math.min(N, W * H - 9), cells: Array.from({length: W * H}, () => ({mine: false, open: false, flag: 0, n: 0})), state: 'ready', t0: 0, time: 0, hints: 0, boom: -1, press: -1, anim: 0, guessFree: s.noGuess, parts: []};
  s.level = level; if ($('msLevel').options.length) $('msLevel').value = level;
  msSize(); msDraw(); msInfo();
}
// mines placed away from the first click; "sans hasard": placed again until the solver opens the whole board from that click
function msPlace(first) {
  const safe = new Set([first, ...msAround(first)]), tries = ms.guessFree ? 400 : 1;
  for (let t = 0; t < tries; t++) {
    const free = ms.cells.map((_, i) => i).filter(i => !safe.has(i));
    for (const c of ms.cells) c.mine = false;
    for (let k = 0; k < ms.n; k++) { const j = Math.floor(Math.random() * free.length); ms.cells[free[j]].mine = true; free.splice(j, 1); }
    for (let i = 0; i < ms.cells.length; i++) ms.cells[i].n = msAround(i).filter(j => ms.cells[j].mine).length;
    if (!ms.guessFree || msSolvable(first)) { ms.solvable = ms.guessFree; return; }
  }
  ms.solvable = false;  // shortcut: after 400 boards none could be solved by this small solver (huge densities): a normal board is kept
}
// the logic a player uses: a number whose mines are all known frees its other neighbours; a number with as many hidden neighbours as missing mines
// marks them all; and the difference of two overlapping numbers. True when that alone opens every safe cell.
function msSolvable(first) {
  const C = ms.cells, N = C.length, open = new Uint8Array(N), mine = new Uint8Array(N);
  const reveal = i => { const todo = [i]; while (todo.length) { const j = todo.pop(); if (open[j]) continue; open[j] = 1; if (!C[j].n) for (const k of msAround(j)) if (!open[k] && !C[k].mine) todo.push(k); } };
  reveal(first);
  for (let changed = true; changed;) {
    changed = false;
    const front = [];
    for (let i = 0; i < N; i++) {
      if (!open[i] || !C[i].n) continue;
      const nb = msAround(i), hid = nb.filter(j => !open[j] && !mine[j]), known = nb.filter(j => mine[j]).length;
      if (!hid.length) continue;
      if (known === C[i].n) { for (const j of hid) reveal(j); changed = true; }
      else if (known + hid.length === C[i].n) { for (const j of hid) mine[j] = 1; changed = true; }
      else front.push([new Set(hid), C[i].n - known]);
    }
    if (changed) continue;
    for (const [a, na] of front) for (const [b, nb2] of front) {  // b inside a: the rest of a holds na - nb2 mines
      if (a === b || b.size >= a.size || ![...b].every(j => a.has(j))) continue;
      const rest = [...a].filter(j => !b.has(j)), m = na - nb2;
      if (m === 0) { for (const j of rest) reveal(j); changed = true; } else if (m === rest.length) { for (const j of rest) mine[j] = 1; changed = true; }
    }
  }
  for (let i = 0; i < N; i++) if (!C[i].mine && !open[i]) return false;
  return true;
}
function msOpen(i) {
  const c = ms.cells[i];
  if (ms.state === 'won' || ms.state === 'lost' || c.open || c.flag === 1) return;
  if (ms.state === 'ready') { msPlace(i); ms.state = 'play'; ms.t0 = performance.now(); msTimer(); }
  if (c.mine) return msLose(i);
  const todo = [i];
  while (todo.length) {
    const j = todo.pop(), d = ms.cells[j];
    if (d.open || d.flag === 1) continue;
    d.open = true; d.flag = 0;
    if (!d.n) for (const k of msAround(j)) if (!ms.cells[k].open) todo.push(k);
  }
  sfx('click');
  if (ms.cells.every(d => d.open || d.mine)) msWin();
}
function msChord(i) {  // a number with all its flags placed: its other neighbours open
  const c = ms.cells[i]; if (!c.open || !c.n) return;
  const nb = msAround(i);
  if (nb.filter(j => ms.cells[j].flag === 1).length !== c.n) return;
  for (const j of nb) if (!ms.cells[j].open && ms.cells[j].flag !== 1) { msOpen(j); if (ms.state === 'lost') return; }
}
function msFlag(i) {
  const c = ms.cells[i]; if (c.open || ms.state === 'won' || ms.state === 'lost') return;
  c.flag = (c.flag + 1) % (msSave().marks ? 3 : 2); sfx('type');
}
function msHint() {  // opens a safe cell next to what is already open (or anywhere at the start); costs 10 seconds and the record
  if (ms.state !== 'play') { if (ms.state === 'ready') msOpen(msIdx(ms.w >> 1, ms.h >> 1)); msDraw(); return; }
  const near = ms.cells.map((c, i) => i).filter(i => !ms.cells[i].open && !ms.cells[i].mine && ms.cells[i].flag !== 1);
  const front = near.filter(i => msAround(i).some(j => ms.cells[j].open)), pick = (front.length ? front : near)[Math.floor(Math.random() * (front.length || near.length))];
  if (pick == null) return;
  ms.hints++; ms.t0 -= 10000; msOpen(pick); ms.hintAt = pick; msDraw();
}
function msLose(i) {
  ms.state = 'lost'; ms.boom = i; ms.time = performance.now() - ms.t0;
  for (const c of ms.cells) if (c.mine) c.open = true;
  for (let k = 0; k < 40; k++) ms.parts.push({x: (i % ms.w) * MS.S + 8, y: (i / ms.w | 0) * MS.S + 8, vx: (Math.random() - .5) * 5, vy: (Math.random() - .8) * 5, t: 50, c: ['#ff4f6d', '#ffd07a', '#ff7a4f'][k % 3]});
  msRecord(false); sfx('error'); msAnim();
}
function msWin() {
  ms.state = 'won'; ms.time = performance.now() - ms.t0;
  for (const c of ms.cells) if (c.mine) c.flag = 1;
  const secs = Math.round(ms.time / 100) / 10;
  ms.record = !ms.hints && ms.level !== 'perso' && best('mines_' + ms.level, secs, false);
  for (let k = 0; k < 60; k++) ms.parts.push({x: Math.random() * ms.w * MS.S, y: ms.h * MS.S, vx: (Math.random() - .5) * 2, vy: -2 - Math.random() * 4, t: 70, c: ['#ffd07a', '#8ee8a0', '#ff5ad9', '#7fe0ee'][k % 4]});
  msRecord(true); sfx('launch'); msAnim();
}
function msRecord(won) {
  const st = (msSave().stats[ms.level] ||= {played: 0, won: 0, streak: 0, best: 0});
  st.played++; if (won) { st.won++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
  saveGames(); msInfo();
}
let msTimerId = 0;
function msTimer() { clearInterval(msTimerId); msTimerId = setInterval(() => { if (ms?.state !== 'play') return clearInterval(msTimerId); if (view.classList.contains('on')) msDraw(); }, 250); }
function msAnim() { cancelAnimationFrame(ms.raf); const f = () => { for (const p of ms.parts) { p.x += p.vx; p.y += p.vy; p.vy += .18; p.t--; } ms.parts = ms.parts.filter(p => p.t > 0); msDraw(); if (ms.parts.length) ms.raf = requestAnimationFrame(f); }; ms.raf = requestAnimationFrame(f); }
/* ---------- drawing: raised tiles, open cells, pixel numbers and sprites ---------- */
function msSize() {
  const cv = $('msCanvas'), W = ms.w * MS.S + MS.PAD * 2, H = ms.h * MS.S + MS.PAD * 2 + MS.BAR;
  cv.width = W; cv.height = H;
  const box = cv.parentElement, k = Math.max(1, Math.floor(Math.min((box.clientWidth - 24) / W, (innerHeight * .68) / H) * 2) / 2);
  cv.style.width = W * k + 'px'; cv.style.height = H * k + 'px';
}
addEventListener('resize', () => { if (ms && view.classList.contains('on')) msSize(), msDraw(); });
const MS_DIGITS = {0: ['xxx', 'x.x', 'x.x', 'x.x', 'xxx'], 1: ['.x.', 'xx.', '.x.', '.x.', 'xxx'], 2: ['xxx', '..x', 'xxx', 'x..', 'xxx'], 3: ['xxx', '..x', '.xx', '..x', 'xxx'], 4: ['x.x', 'x.x', 'xxx', '..x', '..x'],
  5: ['xxx', 'x..', 'xxx', '..x', 'xxx'], 6: ['xxx', 'x..', 'xxx', 'x.x', 'xxx'], 7: ['xxx', '..x', '.x.', '.x.', '.x.'], 8: ['xxx', 'x.x', 'xxx', 'x.x', 'xxx'], 9: ['xxx', 'x.x', 'xxx', '..x', 'xxx'], '-': ['...', '...', 'xxx', '...', '...']};
function msDigits(g, str, x, y, col, k = 2) { [...str].forEach((d, i) => MS_DIGITS[d].forEach((r, j) => [...r].forEach((ch, l) => { if (ch === 'x') px(g, col, x + i * 4 * k + l * k, y + j * k, k, k); }))); }
function msDraw() {
  if (!ms) return;
  const g = $('msCanvas').getContext('2d'), S = MS.S, X0 = MS.PAD, Y0 = MS.PAD + MS.BAR, W = $('msCanvas').width, H = $('msCanvas').height, t = performance.now();
  g.fillStyle = '#12082a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2a1d52'; g.fillRect(X0 - 3, Y0 - 3, ms.w * S + 6, ms.h * S + 6);
  // top bar: mines left, a face button (new game), time
  const left = ms.n - ms.cells.filter(c => c.flag === 1).length, secs = ms.state === 'play' ? (t - ms.t0) / 1000 : ms.time / 1000;
  g.fillStyle = '#05010b'; g.fillRect(X0, 6, 34, 18); g.fillRect(W - X0 - 34, 6, 34, 18);
  msDigits(g, String(Math.max(-99, Math.min(999, left))).padStart(3, '0').replace(/^0(?=-)/, ''), X0 + 4, 9, '#ff4f6d');
  msDigits(g, String(Math.min(999, Math.floor(secs))).padStart(3, '0'), W - X0 - 30, 9, '#ffd07a');
  const fx = W / 2 - 10, face = ms.state === 'lost' ? 'lost' : ms.state === 'won' ? 'won' : ms.press >= 0 ? 'oh' : 'ok';
  msTile(g, fx, 5, 20, 20, false);
  g.fillStyle = '#ffd07a'; g.fillRect(fx + 4, 9, 12, 12); g.fillRect(fx + 5, 8, 10, 14); g.fillRect(fx + 3, 10, 14, 10);
  g.fillStyle = '#3a2008';
  if (face === 'lost') { for (const ex of [6, 12]) { px(g, '#3a2008', fx + ex, 11); px(g, '#3a2008', fx + ex + 2, 11); px(g, '#3a2008', fx + ex + 1, 12); px(g, '#3a2008', fx + ex, 13); px(g, '#3a2008', fx + ex + 2, 13); } g.fillRect(fx + 7, 17, 6, 1); g.fillRect(fx + 6, 18, 1, 1); g.fillRect(fx + 13, 18, 1, 1); }
  else if (face === 'won') { g.fillRect(fx + 5, 11, 10, 2); g.fillRect(fx + 6, 13, 3, 1); g.fillRect(fx + 11, 13, 3, 1); g.fillRect(fx + 6, 16, 8, 1); g.fillRect(fx + 7, 17, 6, 1); }
  else { g.fillRect(fx + 7, 12, 2, 2); g.fillRect(fx + 11, 12, 2, 2); if (face === 'oh') g.fillRect(fx + 9, 16, 2, 3); else { g.fillRect(fx + 7, 17, 6, 1); px(g, '#3a2008', fx + 6, 16); px(g, '#3a2008', fx + 13, 16); } }
  // the board
  for (let i = 0; i < ms.cells.length; i++) {
    const c = ms.cells[i], x = X0 + (i % ms.w) * S, y = Y0 + (i / ms.w | 0) * S;
    if (!c.open) {
      const pressed = ms.press === i || (ms.pressAround?.includes(i) && !c.flag);
      msTile(g, x, y, S, S, pressed);
      if (c.flag === 1) { if (ms.state === 'lost' && !c.mine) { sprite(g, MS.flag, x + 4, y + 3, {r: '#5e4d85', k: '#3a2a6e'}); g.fillStyle = '#ff4f6d'; for (let k = 0; k < 10; k++) { g.fillRect(x + 3 + k, y + 3 + k, 1, 1); g.fillRect(x + 12 - k, y + 3 + k, 1, 1); } } else sprite(g, MS.flag, x + 4, y + 3, {r: '#ff4f6d', k: '#1c1238'}); }
      else if (c.flag === 2) msQ(g, x, y);
      continue;
    }
    g.fillStyle = i === ms.boom ? '#ff4f6d' : (i % ms.w + (i / ms.w | 0)) % 2 ? '#1c1238' : '#201540'; g.fillRect(x, y, S, S);
    g.fillStyle = '#2a1d52'; g.fillRect(x, y, S, 1); g.fillRect(x, y, 1, S);
    if (c.mine) { sprite(g, MS.mine, x + 3, y + 3, i === ms.boom ? {o: '#1c1238', w: '#ffd07a'} : {o: '#c9bdf0', w: '#ffffff'}); continue; }
    if (c.n) { const col = MS.num[c.n]; msNumber(g, c.n, x + 5, y + 3, col); }
    if (i === ms.hintAt && ms.state === 'play') { g.strokeStyle = '#8ee8a0'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, S - 1, S - 1); }
  }
  for (const p of ms.parts) { g.fillStyle = p.c; g.fillRect(X0 + p.x | 0, Y0 + p.y | 0, 2, 2); }
  if (ms.state === 'won' || ms.state === 'lost') gameText(g, W, ms.state === 'won' ? [['GAGNÉ EN ' + (ms.time / 1000).toFixed(1).replace('.', ',') + ' S', '#8ee8a0', 8], [ms.record ? 'NOUVEAU RECORD !' : ms.hints ? ms.hints + ' INDICE' + (ms.hints > 1 ? 'S' : '') + ' : PAS DE RECORD' : 'CLIC SUR LE VISAGE : REJOUER', ms.record ? '#ffd07a' : '#d9c6ff', 7]]
    : [['BOUM !', '#ff4f6d', 10], ['CLIC SUR LE VISAGE : REJOUER', '#d9c6ff', 7]], Y0 + ms.h * S / 2 - 6);
}
const MS_NUMS = {1: ['.x.', 'xx.', '.x.', '.x.', '.x.', 'xxx'], 2: ['xx.', '..x', '..x', '.x.', 'x..', 'xxx'], 3: ['xx.', '..x', '.x.', '..x', '..x', 'xx.'], 4: ['x.x', 'x.x', 'x.x', 'xxx', '..x', '..x'],
  5: ['xxx', 'x..', 'xx.', '..x', '..x', 'xx.'], 6: ['.xx', 'x..', 'xx.', 'x.x', 'x.x', '.x.'], 7: ['xxx', '..x', '..x', '.x.', '.x.', '.x.'], 8: ['.x.', 'x.x', '.x.', 'x.x', 'x.x', '.x.']};
function msNumber(g, n, x, y, col) { MS_NUMS[n].forEach((r, j) => [...r].forEach((ch, l) => { if (ch === 'x') { px(g, '#05010b', x + l * 2 + 1, y + j * 2 + 1, 2, 2); } })); MS_NUMS[n].forEach((r, j) => [...r].forEach((ch, l) => { if (ch === 'x') px(g, col, x + l * 2, y + j * 2, 2, 2); })); }
function msQ(g, x, y) { ['.xx.', 'x..x', '...x', '..x.', '..x.', '....', '..x.'].forEach((r, j) => [...r].forEach((ch, l) => { if (ch === 'x') px(g, '#d9c6ff', x + 4 + l * 2, y + 1 + j * 2, 2, 2); })); }
function msTile(g, x, y, w, h, pressed) {  // a raised tile, or pressed in
  g.fillStyle = pressed ? '#2a1d52' : '#5e4d85'; g.fillRect(x, y, w, h);
  if (pressed) { g.fillStyle = '#1c1238'; g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h); return; }
  g.fillStyle = '#9a86d0'; g.fillRect(x, y, w - 1, 2); g.fillRect(x, y, 2, h - 1);
  g.fillStyle = '#2a1d52'; g.fillRect(x + 1, y + h - 2, w - 1, 2); g.fillRect(x + w - 2, y + 1, 2, h - 1);
  g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x + 4, y + 4, 2, 2);
}
/* ---------- mouse ---------- */
function msAt(e) {
  const cv = $('msCanvas'), r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * cv.width, y = (e.clientY - r.top) / r.height * cv.height;
  const cx = Math.floor((x - MS.PAD) / MS.S), cy = Math.floor((y - MS.PAD - MS.BAR) / MS.S);
  if (y < MS.PAD + MS.BAR && Math.abs(x - cv.width / 2) < 12) return 'face';
  return cx >= 0 && cy >= 0 && cx < ms.w && cy < ms.h ? msIdx(cx, cy) : -1;
}
$('msCanvas').oncontextmenu = e => e.preventDefault();
$('msCanvas').onpointerdown = e => {
  if (!ms) return;
  const i = msAt(e);
  if (i === 'face') { msNew(ms.level); return; }
  if (i < 0) return;
  ms.buttons = e.buttons;
  if (e.button === 2 && !(e.buttons & 1)) { msFlag(i); msDraw(); return; }  // right: flag
  ms.press = i; ms.pressAround = e.button === 1 || e.buttons === 3 || ms.cells[i].open ? msAround(i) : null; msDraw();
};
$('msCanvas').onpointermove = e => { if (!ms || ms.press < 0) return; const i = msAt(e); if (typeof i === 'number' && i >= 0 && i !== ms.press) { ms.press = i; if (ms.pressAround) ms.pressAround = msAround(i); msDraw(); } };
$('msCanvas').onpointerup = e => {
  if (!ms || ms.press < 0) return;
  const i = ms.press, both = ms.pressAround; ms.press = -1; ms.pressAround = null;
  if (both || ms.cells[i].open) msChord(i); else if (e.button === 0) msOpen(i);
  msDraw();
};
$('msCanvas').onpointerleave = () => { if (ms) { ms.press = -1; ms.pressAround = null; msDraw(); } };
/* ---------- page ---------- */
function msInfo() {
  const s = msSave(), parts = Object.keys(MS.levels).filter(k => k !== 'perso').map(k => MS.levels[k][0] + ' ' + (games?.best['mines_' + k] != null ? String(games.best['mines_' + k]).replace('.', ',') + ' s' : '—'));
  const st = s.stats[ms?.level]; $('msInfo').textContent = 'Records : ' + parts.join(' · ') + (st ? ' · ' + st.won + ' / ' + st.played + ' gagnées · série ' + st.streak : '');
}
function msOpenApp() {
  const s = msSave();
  $('msLevel').replaceChildren(...Object.entries(MS.levels).map(([k, [n, w, h, m]]) => Object.assign(el('option', '', n + (k === 'perso' ? ' (' + s.perso.join(' × ').replace(/ × (\d+)$/, ', $1 mines') + ')' : ' · ' + w + ' × ' + h + ', ' + m + ' mines')), {value: k})));
  $('msLevel').value = s.level; $('msNoGuess').checked = s.noGuess; $('msMarks').checked = s.marks;
  if (!ms) msNew(s.level); else { msSize(); msDraw(); }
  msInfo();
}
$('msLevel').onchange = async () => {
  const v = $('msLevel').value, s = msSave();
  if (v === 'perso') {
    const a = await ask('Plateau perso', s.perso.join(' x '), 'largeur x hauteur x mines, par exemple 24 x 18 x 70');
    const n = (a || '').match(/\d+/g)?.map(Number);
    if (n?.length === 3) s.perso = [Math.min(40, Math.max(5, n[0])), Math.min(30, Math.max(5, n[1])), Math.max(1, n[2])];
  }
  saveGames(); msNew(v); msOpenApp();
};
$('msNoGuess').onchange = () => { msSave().noGuess = $('msNoGuess').checked; saveGames(); msNew(ms.level); };
$('msMarks').onchange = () => { msSave().marks = $('msMarks').checked; saveGames(); };
$('msHint').onclick = () => msHint();
$('msNewBtn').onclick = () => msNew(ms?.level);
{  // self-check: neighbours at a corner and in the middle; a board solved by the solver; first click always safe
  console.assert(msAround(0, 9, 9).length === 3 && msAround(40, 9, 9).length === 8, 'msAround');
}  // (non indenté : les textes sur plusieurs lignes restent exactement les tiens)
  // ---- fin ----
  ctx.onOpen(() => { msOpenApp(); });
}
