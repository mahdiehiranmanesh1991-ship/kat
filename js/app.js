// «کات» — CapCut-style editor UI.
import * as P from './core/project.js';
import * as db from './db.js';
import { importFile, loadMedia, mediaCache, elementFor, allElements, seek, audioBuffer, audioCtx } from './media.js';
import { Renderer } from './render.js';
import { exportVideo, saveVideo, outSize } from './export.js';
import { autoCaptions, modelReady } from './captions.js';
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fa = P.faDigits;
const S = { proj: null, sel: null, t: 0, playing: false, pps: 64, hist: new P.History(), quality: '1080' };
const R = new Renderer(); const cv = $('#preview'); const cx = cv.getContext('2d');
const toast = (m, ms = 1800) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); };
// ---------- persistence ----------
let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(async () => { const p = S.proj; if (!p) return; p.updated = Date.now();
  const first = p.clips.find((c) => c.type !== 'color'); p.cover = first ? mediaCache.get(first.mediaId)?.thumbs?.[0] || null : null; await db.put('projects', structuredClone(p)); }, 400); };
const edit = (fn, { push = true } = {}) => { if (push) S.hist.push(S.proj); const r = fn(S.proj); refresh(); save(); return r; };
let pushedThisSheet = false; const editLive = (fn) => { if (!pushedThisSheet) { S.hist.push(S.proj); pushedThisSheet = true; } fn(S.proj); refresh(); save(); };
// ---------- home ----------
async function renderHome() {
  const list = (await db.all('projects')).sort((a, b) => b.updated - a.updated); const g = $('#projects');
  g.innerHTML = list.length ? '' : '<div class="proj-empty">هنوز پروژه‌ای نداری. اولین ریلز را بساز ✨</div>';
  for (const p of list) { const b = document.createElement('button'); b.className = 'proj'; b.dataset.testid = 'project-card'; if (p.cover) b.style.backgroundImage = `url(${p.cover})`;
    b.innerHTML = `<em>${fa(P.fmtTime(P.duration(p)))}</em><span>${esc(p.name)}</span>`; b.onclick = () => openProject(p);
    let lp; b.oncontextmenu = (e) => { e.preventDefault(); askDelete(p); }; b.ontouchstart = () => (lp = setTimeout(() => askDelete(p), 650)); b.ontouchend = () => clearTimeout(lp); g.append(b); }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function askDelete(p) { sheet(`<h3>حذف «${esc(p.name)}»؟</h3><p class="note">ویدیوهای اصلی در گالری‌ات دست نمی‌خورند.</p><button class="btn" id="del-yes">حذف پروژه</button><button class="btn ghost" data-close>انصراف</button>`, (c) => { $('#del-yes', c).onclick = async () => { await db.del('projects', p.id); closeSheet(); renderHome(); }; }); }
let projCount = 0;
async function newProject(tpl) { projCount = (await db.all('projects')).length + 1; const p = P.newProject(`ریلز ${fa(projCount)}`); if (tpl) P.applyTemplate(p, tpl, 0); await openProject(p); }
$('#new-project').onclick = () => { $('#file-media').click(); newProject(); }; // picker must open inside the tap (iOS user-activation)
$$('#home-tpls [data-tpl]').forEach((b) => (b.onclick = () => { if (b.dataset.tpl !== 'title') $('#file-media').click(); newProject(b.dataset.tpl); }));
async function openProject(p) {
  S.proj = structuredClone(p); S.hist = new P.History(); S.sel = null; S.t = 0;
  await loadMedia([...p.clips.map((c) => c.mediaId), ...p.audios.map((a) => a.mediaId)].filter((x) => x !== 'color'));
  $('#home').hidden = true; $('#editor').hidden = false; setupCanvas(); refresh(); save(); preload();
}
$('#back').onclick = () => { pause(); save(); $('#editor').hidden = true; $('#home').hidden = false; setTimeout(renderHome, 450); };
function preload() { for (const c of S.proj.clips) if (c.type === 'video') audioBuffer(c.mediaId); for (const a of S.proj.audios) audioBuffer(a.mediaId); }
// ---------- import ----------
$('#add-media').onclick = () => $('#file-media').click();
$('#file-media').onchange = async (e) => { const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  toast(`در حال افزودن ${fa(files.length)} فایل…`, 9e9); const recs = [];
  for (const f of files) { try { recs.push(await importFile(f)); } catch (err) { console.warn(err); toast('این فایل خوانده نشد'); } }
  $('#toast').hidden = true; if (!recs.length) return;
  edit((p) => { const L = P.locate(p, S.t); let at = L ? L.index + (L.local > P.clipDur(L.clip) / 2 ? 1 : 0) : p.clips.length;
    if (p.clips.length && S.t >= P.videoDuration(p) - 0.05) at = p.clips.length;
    for (const m of recs) if (m.type !== 'audio') p.clips.splice(at++, 0, P.newClip(m)); else p.audios.push(P.newAudio(m, S.t)); });
  preload(); toast('اضافه شد ✓'); };
$('#file-audio').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; toast('در حال افزودن موسیقی…', 9e9);
  try { const m = await importFile(f); m.type = 'audio'; edit((p) => p.audios.push(P.newAudio(m, S.t, 'music'))); audioBuffer(m.id); toast('موسیقی اضافه شد ♪'); } catch { toast('فایل صوتی خوانده نشد'); } };
// ---------- preview canvas ----------
function setupCanvas() { const [W, H] = outSize(S.proj, '1080'); const k = 540 / Math.min(W, H) * (W > H ? 0.75 : 1); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const st = $('#stage'); const ar = W / H; const maxH = st.clientHeight - 10, maxW = st.clientWidth * 0.92; let h = maxH, w = h * ar; if (w > maxW) { w = maxW; h = w / ar; } cv.style.width = w + 'px'; cv.style.height = h + 'px';
  $('#aspect-btn').textContent = fa(S.proj.aspect); }
addEventListener('resize', () => S.proj && (setupCanvas(), draw()));
const prevGet = (clip, role) => clip.type === 'color' ? null : allElements().get((role === 'prev' ? 'pp' : 'p') + clip.id) || null;
let drawing = false, again = false;
async function draw() { if (!S.proj) return; if (drawing) { again = true; return; } drawing = true;
  try { do { again = false; const p = S.proj, t = S.t; const L = P.locate(p, t);
      if (L && L.clip.type !== 'color') { const e = await elementFor('p' + L.clip.id, L.clip.mediaId); if (e && L.clip.type === 'video' && !S.playing) await seek(e, L.src); }
      const tr = P.transitionAt(p, t); if (tr && tr.prev.type !== 'color') { const e = await elementFor('pp' + tr.prev.id, tr.prev.mediaId); if (e && tr.prev.type === 'video') await seek(e, tr.prevSrc); }
      R.frame(cx, p, S.t, prevGet, { selected: S.sel }); } while (again); } finally { drawing = false; }
  $('#empty-hint').hidden = S.proj.clips.length > 0; }
// ---------- playback ----------
let srcs = [], raf, a0, t0, playingEl = null;
function schedule(t) { const ac = audioCtx(); const now = ac.currentTime + 0.06; const p = S.proj; const st = P.starts(p);
  const go = (buf, start, off, dur, rate, gainFn) => { if (!buf) return; const end = start + dur / rate; if (end <= t) return; const skip = Math.max(0, t - start);
    const s = ac.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; const g = ac.createGain(); gainFn(g, now - Math.min(0, start - t) - skip * 0, skip);
    s.connect(g).connect(ac.destination); s.start(now + Math.max(0, start - t), off + skip * rate, Math.max(0.01, dur - skip * rate)); srcs.push(s); };
  p.clips.forEach((c, i) => { if (c.type !== 'video' || c.muted) return; audioBuffer(c.mediaId).then((b) => S.playing && go(b, st[i], c.in, c.out - c.in, c.speed, (g) => (g.gain.value = c.volume))); });
  p.audios.forEach((a) => audioBuffer(a.mediaId).then((b) => S.playing && go(b, a.start, a.in, a.out - a.in, 1, (g) => { const base = now + Math.max(0, a.start - t), sk = Math.max(0, t - a.start), d = a.out - a.in;
    g.gain.setValueAtTime(P.audioGain(a, sk), base); for (let k = 1; k <= 30; k++) { const l = sk + ((d - sk) * k) / 30; g.gain.linearRampToValueAtTime(P.audioGain(a, Math.min(l, d - 0.001)), base + l - sk); } }))); }
async function play() { if (!S.proj?.clips.length && !S.proj?.texts.length) return; const T = P.duration(S.proj); if (S.t >= T - 0.05) S.t = 0;
  const ac = audioCtx(); await ac.resume(); S.playing = true; $('#play').textContent = '❚❚'; a0 = ac.currentTime; t0 = S.t; schedule(S.t);
  const tick = () => { if (!S.playing) return; const p = S.proj; S.t = t0 + (ac.currentTime - a0); if (S.t >= T) { S.t = T; pause(); return; }
    const L = P.locate(p, S.t); const e = L && L.clip.type === 'video' ? allElements().get('p' + L.clip.id) : null;
    if (L && L.clip.type === 'video' && !e) elementFor('p' + L.clip.id, L.clip.mediaId);
    if (e !== playingEl) { playingEl?.pause(); playingEl = e; if (e) { e.muted = true; e.playbackRate = L.clip.speed; e.currentTime = L.src; e.play().catch(() => {}); } }
    else if (e && Math.abs(e.currentTime - L.src) > 0.3) e.currentTime = L.src;
    R.frame(cx, p, S.t, prevGet, { selected: S.sel }); syncScroll(); updTime(); raf = requestAnimationFrame(tick); }; tick(); }
function pause() { S.playing = false; cancelAnimationFrame(raf); playingEl?.pause(); playingEl = null; srcs.forEach((s) => { try { s.stop(); } catch {} }); srcs = []; $('#play').textContent = '▶'; draw(); updTime(); }
$('#play').onclick = () => (S.playing ? pause() : play());
function updTime() { $('#time').textContent = `${P.fmtTime(S.t)} / ${P.fmtTime(P.duration(S.proj))}`; }
// ---------- timeline ----------
const tl = $('#tl'), inner = $('#tl-inner'); let ignoreScroll = false;
const pad = () => tl.clientWidth / 2;
function syncScroll() { ignoreScroll = true; tl.scrollLeft = S.t * S.pps; requestAnimationFrame(() => (ignoreScroll = false)); }
tl.addEventListener('scroll', () => { if (ignoreScroll) return; if (S.playing) pause(); S.t = P.clamp(tl.scrollLeft / S.pps, 0, P.duration(S.proj)); updTime(); draw(); }, { passive: true });
function renderTimeline() {
  const p = S.proj, T = P.duration(p), pp = pad(), W = T * S.pps; inner.style.width = W + pp * 2 + 'px'; let h = '';
  const step = S.pps > 120 ? 0.5 : S.pps > 40 ? 1 : S.pps > 15 ? 5 : 10; h += `<div class="ruler" style="left:${pp}px;width:${W}px">`;
  for (let s = 0; s <= T + 0.001; s += step) h += `<b style="left:${s * S.pps}px"></b>` + (Math.round(s / step) % 2 === 0 ? `<i style="left:${s * S.pps}px">${P.fmtTime(s)}</i>` : '');
  h += '</div><div class="track" style="top:28px">'; const st = P.starts(p);
  p.clips.forEach((c, i) => { const x = pp + st[i] * S.pps, w = Math.max(4, P.clipDur(c) * S.pps - 2); const m = mediaCache.get(c.mediaId);
    let inside = ''; if (c.type === 'color') inside = '⚖️ کارت عنوان'; else if (m?.thumbs?.length) { const n = Math.ceil(w / 32); for (let k = 0; k < n; k++) { const src = m.type === 'image' ? m.thumbs[0] : m.thumbs[Math.min(m.thumbs.length - 1, Math.floor(((c.in + ((k + 0.5) / n) * (c.out - c.in)) / m.duration) * m.thumbs.length))]; inside += `<img src="${src}" alt="">`; } }
    const badge = [c.speed !== 1 ? `${fa(c.speed)}x` : '', c.muted ? '🔇' : '', c.filter !== 'none' ? '✨' : ''].filter(Boolean).join(' ') + ' ' + fa(P.clipDur(c).toFixed(1)) + 'ث';
    h += `<div class="clip ${c.type === 'color' ? 'color' : ''} ${S.sel === c.id ? 'sel' : ''}" data-id="${c.id}" data-testid="clip" style="left:${x}px;width:${w}px">${inside}<span class="badge">${badge}</span><div class="handle l" data-h="start"></div><div class="handle r" data-h="end"></div></div>`;
    if (i > 0) h += `<button class="tr-chip ${c.transition.type !== 'none' ? 'on' : ''}" data-tr="${c.id}" data-testid="tr-chip" style="left:${x - 1}px">${c.transition.type !== 'none' ? '⧓' : '│'}</button>`; });
  h += '</div>';
  const lanes = { text: 90, sticker: 90, caption: 120 };
  for (const t of p.texts) { const top = lanes[t.kind] ?? 90; h += `<div class="bar ${t.kind} ${S.sel === t.id ? 'sel' : ''}" data-id="${t.id}" data-testid="text-bar" style="top:${top}px;left:${pp + t.start * S.pps}px;width:${Math.max(18, t.dur * S.pps - 2)}px">${t.kind === 'sticker' ? t.text : 'T ' + esc(t.text)}</div>`; }
  for (const a of p.audios) h += `<div class="bar ${a.kind} ${S.sel === a.id ? 'sel' : ''}" data-id="${a.id}" data-testid="audio-bar" style="top:152px;left:${pp + a.start * S.pps}px;width:${Math.max(18, (a.out - a.in) * S.pps - 2)}px"><span class="wave"></span>${a.kind === 'voice' ? '🎙️ صدای من' : '♪ ' + esc(mediaCache.get(a.mediaId)?.name || 'موسیقی')}</div>`;
  inner.innerHTML = h; syncScroll();
}
inner.addEventListener('click', (e) => { const tr = e.target.closest('[data-tr]'); if (tr) { S.sel = tr.dataset.tr; refresh(); return openTransition(); }
  const el = e.target.closest('[data-id]'); if (!el || dragMoved) return; S.sel = S.sel === el.dataset.id ? null : el.dataset.id; refresh(); });
// drag: trim handles + move text/audio bars
let drag = null, dragMoved = false;
inner.addEventListener('pointerdown', (e) => { const hd = e.target.closest('.handle'), bar = e.target.closest('.bar'); dragMoved = false;
  if (hd) { const id = hd.parentElement.dataset.id; drag = { kind: 'trim', id, side: hd.dataset.h, x: e.clientX, pushed: false }; }
  else if (bar && S.sel === bar.dataset.id) drag = { kind: 'move', id: bar.dataset.id, x: e.clientX, pushed: false }; else return;
  e.preventDefault(); e.stopPropagation(); tl.style.touchAction = 'none'; inner.setPointerCapture(e.pointerId); });
inner.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) < 3) return; dragMoved = true; drag.x = e.clientX;
  if (!drag.pushed) { S.hist.push(S.proj); drag.pushed = true; } const d = dx / S.pps;
  if (drag.kind === 'trim') P.trim(S.proj, drag.id, drag.side, drag.side === 'start' ? d : d);
  else { const [, it] = P.find(S.proj, drag.id); if (it) it.start = P.r3(Math.max(0, it.start + d)); }
  renderTimeline(); draw(); });
const endDrag = () => { if (!drag) return; drag = null; tl.style.touchAction = ''; refresh(); save(); setTimeout(() => (dragMoved = false), 50); };
inner.addEventListener('pointerup', endDrag); inner.addEventListener('pointercancel', endDrag);
// pinch zoom
let pinch = null; const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
tl.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: dist(e.touches), pps: S.pps }; }, { passive: true });
tl.addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.pps * dist(e.touches) / pinch.d); } }, { passive: false });
tl.addEventListener('touchend', () => (pinch = null));
tl.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(S.pps * (e.deltaY < 0 ? 1.15 : 0.87)); } }, { passive: false });
function setZoom(v) { S.pps = P.clamp(v, 8, 400); renderTimeline(); }
$('#zoom-fit').onclick = () => setZoom((tl.clientWidth - 40) / Math.max(1, P.duration(S.proj)));
// ---------- preview interactions (select / drag text) ----------
let pdrag = null;
cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const hit = Object.entries(R.boxes || {}).reverse().find(([, b]) => Math.abs(x - b.x) < b.w / 2 + 0.03 && Math.abs(y - b.y) < b.h / 2 + 0.03);
  if (!hit) { if (S.sel && P.find(S.proj, S.sel)[0] === 'texts') { S.sel = null; refresh(); } return; }
  const id = hit[0]; if (S.sel === id && e.detail >= 2) return openText(id); if (S.sel !== id) { S.sel = id; refresh(); }
  pdrag = { id, x, y, pushed: false }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => { if (!pdrag) return; const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const [, t] = P.find(S.proj, pdrag.id); if (!t) return; if (!pdrag.pushed) { S.hist.push(S.proj); pdrag.pushed = true; }
  t.x = P.r3(P.clamp(t.x + x - pdrag.x, 0.05, 0.95)); t.y = P.r3(P.clamp(t.y + y - pdrag.y, 0.05, 0.95)); pdrag.x = x; pdrag.y = y; draw(); });
cv.addEventListener('pointerup', () => { if (pdrag?.pushed) save(); pdrag = null; }); cv.addEventListener('dblclick', () => S.sel && P.find(S.proj, S.sel)[0] === 'texts' && openText(S.sel));
// ---------- undo/redo ----------
$('#undo').onclick = () => { const s = S.hist.undo(S.proj); if (s) { S.proj = s; S.sel = null; setupCanvas(); refresh(); save(); toast('واگرد'); } };
$('#redo').onclick = () => { const s = S.hist.redo(S.proj); if (s) { S.proj = s; S.sel = null; setupCanvas(); refresh(); save(); toast('ازنو'); } };
// ---------- toolbar ----------
const T = (icon, label, fn, cls = '', tid = '') => ({ icon, label, fn, cls, tid });
function tools() { const [kind, it] = S.sel ? P.find(S.proj, S.sel) : [null, null];
  const back = T('‹', 'بازگشت', () => { S.sel = null; refresh(); }, 'back', 'tool-back');
  if (kind === 'clips') return [back, T('✂︎', 'تقسیم', doSplit, '', 'tool-split'), T('⏩', 'سرعت', openSpeed, '', 'tool-speed'), T(it.muted ? '🔇' : '🔊', 'صدا', openVolume, '', 'tool-volume'),
    T('✨', 'فیلتر', openFilters, '', 'tool-filter'), T('🎚️', 'تنظیم', openAdjust, '', 'tool-adjust'), T('▣', 'قاب', openFit, '', 'tool-fit'), T('⧓', 'انتقال', openTransition, '', 'tool-transition'),
    T('⧉', 'تکثیر', () => { const id = edit((p) => P.duplicate(p, S.sel)); S.sel = id; refresh(); toast('تکثیر شد'); }, '', 'tool-dup'),
    T('→', 'جلوتر', () => edit((p) => P.move(p, S.sel, 1)), '', 'tool-move-r'), T('←', 'عقب‌تر', () => edit((p) => P.move(p, S.sel, -1)), '', 'tool-move-l'),
    T('🗑', 'حذف', () => { edit((p) => P.remove(p, S.sel)); S.sel = null; refresh(); toast('حذف شد'); }, 'danger', 'tool-delete')];
  if (kind === 'texts') return [back, T('✎', 'ویرایش', () => openText(S.sel), '', 'tool-edit-text'), T('⏱', 'مدت', openTextDur, '', 'tool-text-dur'), T('⧉', 'تکثیر', () => { S.sel = edit((p) => P.duplicate(p, S.sel)); refresh(); }), T('🗑', 'حذف', () => { edit((p) => P.remove(p, S.sel)); S.sel = null; refresh(); }, 'danger', 'tool-delete')];
  if (kind === 'audios') return [back, T('🔊', 'حجم و محو', openAudio, '', 'tool-audio'), T('✂︎', 'کوتاه‌کردن', openAudio), T('⧉', 'تکثیر', () => { S.sel = edit((p) => P.duplicate(p, S.sel)); refresh(); }), T('🗑', 'حذف', () => { edit((p) => P.remove(p, S.sel)); S.sel = null; refresh(); }, 'danger', 'tool-delete')];
  return [T('✂︎', 'ویرایش', () => { const L = P.locate(S.proj, S.t); if (L) { S.sel = L.clip.id; refresh(); } else toast('اول ویدیو اضافه کن'); }, '', 'tool-edit'),
    T('♪', 'موسیقی', () => $('#file-audio').click(), '', 'tool-music'), T('🎙️', 'صداگذاری', openVoice, '', 'tool-voice'), T('Ｔ', 'متن', () => addText(), '', 'tool-text'),
    T('😀', 'استیکر', openStickers, '', 'tool-sticker'), T('💬', 'زیرنویس', openCaptions, '', 'tool-captions'), T('⚖️', 'قالب حقوقی', openTemplates, '', 'tool-templates'),
    T('✨', 'فیلتر', () => { const L = P.locate(S.proj, S.t); if (L) { S.sel = L.clip.id; refresh(); openFilters(); } }, '', ''), T('▭', 'نسبت', openAspect, '', 'tool-aspect'), T('◐', 'پس‌زمینه', openBg, '', 'tool-bg')];
}
function renderToolbar() { const bar = $('#toolbar'); bar.innerHTML = ''; for (const t of tools()) { const b = document.createElement('button'); b.className = 'tool ' + t.cls; if (t.tid) b.dataset.testid = t.tid; b.innerHTML = `<i>${t.icon}</i>${t.label}`; b.onclick = t.fn; bar.append(b); } }
function refresh() { if (!S.proj) return; renderTimeline(); renderToolbar(); updTime(); $('#undo').disabled = !S.hist.canUndo; $('#redo').disabled = !S.hist.canRedo; draw(); }
function doSplit() { const r = edit((p) => P.split(p, S.sel, S.t)); if (!r) { S.hist.undo(S.proj); toast('نشانگر را روی وسط کلیپ ببر'); refresh(); } else toast('تقسیم شد ✂︎'); }
// ---------- sheets ----------
function sheet(html, init) { pushedThisSheet = false; const c = $('#sheet-card'); c.innerHTML = html; $('#sheet').hidden = false; $$('[data-close]', c).forEach((b) => (b.onclick = closeSheet)); init?.(c); }
function closeSheet() { $('#sheet').hidden = true; pushedThisSheet = false; refresh(); }
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
const head = (t) => `<h3>${t}<button class="done" data-close data-testid="sheet-done">تأیید</button></h3>`;
const cur = () => P.find(S.proj, S.sel)[1];
function slider(c, sel, fn) { const r = $(sel, c); r.oninput = () => fn(+r.value); }
function openSpeed() { const c0 = cur(); sheet(`${head('سرعت')}<div class="lbl"><span>سرعت کلیپ</span><b id="sv">${fa(c0.speed)}x</b></div>
  <input type="range" id="sp" data-testid="speed-range" min="0" max="7" step="1" value="${Math.max(0, P.SPEEDS.indexOf(c0.speed))}"><div class="speed-marks">${P.SPEEDS.map((s) => `<span>${s}x</span>`).join('')}</div>
  <p class="note">سرعت آهسته برای تأکید روی یک لحظه، سریع برای گذر از بخش‌های طولانی. صدا هم با سرعت تغییر می‌کند.</p>`, (c) => slider(c, '#sp', (i) => { editLive((p) => P.setSpeed(p, S.sel, P.SPEEDS[i])); $('#sv', c).textContent = fa(P.SPEEDS[i]) + 'x'; })); }
function openVolume() { const c0 = cur(); sheet(`${head('صدای کلیپ')}<div class="lbl"><span>بلندی</span><b id="vv">${fa(Math.round(c0.volume * 100))}٪</b></div><input type="range" id="vol" min="0" max="2" step="0.05" value="${c0.volume}">
  <div class="row"><button class="chip ${c0.muted ? 'on' : ''}" id="mute" data-testid="mute">🔇 بی‌صدا</button></div>`, (c) => { slider(c, '#vol', (v) => { editLive(() => (cur().volume = v)); $('#vv', c).textContent = fa(Math.round(v * 100)) + '٪'; });
  $('#mute', c).onclick = (e) => { editLive(() => (cur().muted = !cur().muted)); e.target.classList.toggle('on', cur().muted); }; }); }
function openFilters() { const c0 = cur(); if (!c0) return; const m = mediaCache.get(c0.mediaId); const th = m?.thumbs?.[0] || '';
  const css = (f) => { const F = P.FILTERS[f]; return `filter:brightness(${1 + F.b * 2}) contrast(${1 + F.c}) saturate(${1 + F.s}) sepia(${Math.max(0, F.w)}) hue-rotate(${F.w < 0 ? -20 : 0}deg)`; };
  sheet(`${head('فیلتر')}<div class="grid4">${Object.entries(P.FILTERS).map(([k, f]) => `<button class="flt ${c0.filter === k ? 'on' : ''}" data-f="${k}" data-testid="filter-${k}"><span style="background-image:url(${th});${css(k)}"></span>${f.name}</button>`).join('')}</div>
  <div class="row"><button class="chip" id="f-all">اعمال روی همه‌ی کلیپ‌ها</button></div>`, (c) => { $$('[data-f]', c).forEach((b) => (b.onclick = () => { editLive(() => (cur().filter = b.dataset.f)); $$('[data-f]', c).forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#f-all', c).onclick = () => { editLive((p) => p.clips.forEach((x) => (x.filter = cur().filter))); toast('روی همه اعمال شد'); }; }); }
function openAdjust() { const a = cur().adj; const rows = [['b', 'روشنایی'], ['c', 'کنتراست'], ['s', 'اشباع رنگ'], ['w', 'گرمی'], ['v', 'وینیت']];
  sheet(`${head('تنظیمات تصویر')}${rows.map(([k, n]) => `<div class="lbl"><span>${n}</span><b id="a-${k}v">${fa(Math.round(a[k] * 100))}</b></div><input type="range" id="a-${k}" data-testid="adj-${k}" min="${k === 'v' ? 0 : -0.5}" max="0.5" step="0.01" value="${a[k]}">`).join('')}`,
  (c) => rows.forEach(([k]) => slider(c, '#a-' + k, (v) => { editLive(() => (cur().adj[k] = v)); $(`#a-${k}v`, c).textContent = fa(Math.round(v * 100)); }))); }
function openFit() { const c0 = cur(); sheet(`${head('قاب و برش')}<div class="row"><button class="chip ${c0.fit === 'fill' ? 'on' : ''}" data-fit="fill" data-testid="fit-fill">پر کردن کادر</button><button class="chip ${c0.fit === 'fit' ? 'on' : ''}" data-fit="fit" data-testid="fit-fit">جا دادن کامل</button></div>
  <p class="note">«جا دادن» کل تصویر را نشان می‌دهد و دور آن را با پس‌زمینه‌ی تار یا رنگی پر می‌کند (از منوی پس‌زمینه).</p>`, (c) => $$('[data-fit]', c).forEach((b) => (b.onclick = () => { editLive(() => (cur().fit = b.dataset.fit)); $$('[data-fit]', c).forEach((x) => x.classList.toggle('on', x === b)); }))); }
function openTransition() { const c0 = cur(); const i = S.proj.clips.indexOf(c0); if (i < 1) return toast('انتقال بین دو کلیپ است؛ کلیپ دوم را انتخاب کن');
  sheet(`${head('انتقال به این کلیپ')}<div class="row">${Object.entries(P.TRANSITIONS).map(([k, n]) => `<button class="chip ${c0.transition.type === k ? 'on' : ''}" data-tr="${k}" data-testid="tr-${k}">${n}</button>`).join('')}</div>
  <div class="lbl"><span>مدت</span><b id="tdv">${fa(c0.transition.dur)} ث</b></div><input type="range" id="tdur" min="0.2" max="1.5" step="0.1" value="${c0.transition.dur}">
  <div class="row"><button class="chip" id="tr-all">اعمال روی همه</button></div>`, (c) => { $$('[data-tr]', c).forEach((b) => (b.onclick = () => { editLive(() => (cur().transition.type = b.dataset.tr)); $$('[data-tr]', c).forEach((x) => x.classList.toggle('on', x === b)); S.t = P.starts(S.proj)[i] + 0.15; syncScroll(); draw(); }));
  slider(c, '#tdur', (v) => { editLive(() => (cur().transition.dur = v)); $('#tdv', c).textContent = fa(v) + ' ث'; });
  $('#tr-all', c).onclick = () => { editLive((p) => p.clips.forEach((x, k) => k && (x.transition = { ...cur().transition }))); toast('روی همه اعمال شد'); }; }); }
const COLORS = ['#ffffff', '#e6b54a', '#ff3d7f', '#22e1d6', '#8b5cf6', '#111111', '#ffd60a', '#ff6b35'];
function addText(opts = {}) { const id = edit((p) => { const t = P.newText(opts.text || 'متن خود را بنویس', S.t, opts); p.texts.push(t); return t.id; }); S.sel = id; refresh(); if (!opts.text || opts.kind === 'caption') openText(id, true); }
function openText(id, fresh) { const t = P.find(S.proj, id)[1]; if (!t) return; S.sel = id;
  sheet(`${head(t.kind === 'caption' ? 'زیرنویس' : 'متن')}<textarea class="tin" id="tin" data-testid="text-input" dir="rtl" placeholder="متن…">${esc(fresh && !t.text.startsWith('متن خود') ? t.text : fresh ? '' : t.text)}</textarea>
  <div class="lbl"><span>سبک</span></div><div class="row">${Object.entries(P.TEXT_STYLES).map(([k, n]) => `<button class="chip ${t.style === k ? 'on' : ''}" data-st="${k}" data-testid="style-${k}">${n}</button>`).join('')}</div>
  <div class="lbl"><span>رنگ</span></div><div class="swatches">${COLORS.map((c) => `<button class="sw ${t.color === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
  <div class="lbl"><span>انیمیشن ورود</span></div><div class="row">${Object.entries(P.TEXT_ANIMS).map(([k, n]) => `<button class="chip ${t.anim === k ? 'on' : ''}" data-an="${k}" data-testid="anim-${k}">${n}</button>`).join('')}</div>
  <div class="lbl"><span>اندازه</span></div><input type="range" id="tsz" min="0.03" max="0.14" step="0.005" value="${t.size}">`, (c) => {
    const ta = $('#tin', c); ta.oninput = () => editLive(() => (cur().text = ta.value || ' ')); if (fresh) setTimeout(() => ta.focus(), 250);
    $$('[data-st]', c).forEach((b) => (b.onclick = () => { editLive(() => (cur().style = b.dataset.st)); $$('[data-st]', c).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('[data-an]', c).forEach((b) => (b.onclick = () => { editLive(() => (cur().anim = b.dataset.an)); $$('[data-an]', c).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('[data-c]', c).forEach((b) => (b.onclick = () => { editLive(() => (cur().color = b.dataset.c)); $$('[data-c]', c).forEach((x) => x.classList.toggle('on', x === b)); }));
    slider(c, '#tsz', (v) => editLive(() => (cur().size = v))); }); }
function openTextDur() { const t = cur(); sheet(`${head('زمان نمایش')}<div class="lbl"><span>مدت</span><b id="dv">${fa(t.dur.toFixed(1))} ث</b></div><input type="range" id="dur" min="0.5" max="${Math.max(10, P.duration(S.proj))}" step="0.1" value="${t.dur}">
  <p class="note">برای جابه‌جایی زمان، نوار متن را در تایم‌لاین بکش.</p>`, (c) => slider(c, '#dur', (v) => { editLive(() => (cur().dur = v)); $('#dv', c).textContent = fa(v.toFixed(1)) + ' ث'; })); }
const STICKERS = ['⚖️', '📜', '🏛️', '🔨', '✅', '❌', '⚠️', '❓', '💡', '📌', '👩‍⚖️', '🤝', '💰', '🏠', '🚗', '📝', '🔥', '⭐', '❤️', '👏', '👇', '👉', '😮', '🙏'];
function openStickers() { sheet(`${head('استیکر')}<div class="grid4" style="grid-template-columns:repeat(6,1fr)">${STICKERS.map((s) => `<button class="stk" data-s="${s}" data-testid="sticker">${s}</button>`).join('')}</div>`,
  (c) => $$('[data-s]', c).forEach((b) => (b.onclick = () => { closeSheet(); const id = edit((p) => { const t = P.newText(b.dataset.s, S.t, { kind: 'sticker', style: 'plain', anim: 'pop', size: 0.05, x: 0.72, y: 0.3 }); p.texts.push(t); return t.id; }); S.sel = id; refresh(); }))); }
function openTemplates() { sheet(`${head('قالب‌های ریلز حقوقی')}<div class="row" style="flex-direction:column">
  <button class="chip" data-tp="title" data-testid="tpl-title">⚖️ کارت عنوان «آوای عدالت» (۳ ثانیه‌ی اول)</button><button class="chip" data-tp="qa" data-testid="tpl-qa">❓ پرسش و پاسخ (روی همین لحظه)</button>
  <button class="chip" data-tp="lower3" data-testid="tpl-lower3">🎙️ زیرنویس پایین معرفی وکیل</button><button class="chip" data-tp="outro" data-testid="tpl-outro">🔔 پایان‌بندی «دنبال کنید»</button></div><p class="note">بعد از افزودن، روی هر متن بزن تا ویرایشش کنی.</p>`,
  (c) => $$('[data-tp]', c).forEach((b) => (b.onclick = () => { closeSheet(); edit((p) => P.applyTemplate(p, b.dataset.tp, S.t)); toast('قالب اضافه شد'); }))); }
function openAspect() { sheet(`${head('نسبت تصویر')}<div class="row">${[['9:16', 'ریلز / استوری'], ['1:1', 'پست مربع'], ['4:5', 'پست عمودی'], ['16:9', 'یوتیوب']].map(([k, n]) => `<button class="chip ${S.proj.aspect === k ? 'on' : ''}" data-ar="${k}" data-testid="ar-${k}"><b>${fa(k)}</b> ${n}</button>`).join('')}</div>`,
  (c) => $$('[data-ar]', c).forEach((b) => (b.onclick = () => { editLive((p) => (p.aspect = b.dataset.ar)); setupCanvas(); draw(); $$('[data-ar]', c).forEach((x) => x.classList.toggle('on', x === b)); }))); }
function openBg() { const bg = S.proj.bg; sheet(`${head('پس‌زمینه')}<p class="note">برای کلیپ‌هایی که «جا دادن کامل» دارند.</p><div class="row"><button class="chip ${bg.mode === 'blur' ? 'on' : ''}" data-bg="blur" data-testid="bg-blur">تار</button>${['#0b0b12', '#ffffff', '#1d2a5b', '#3a1238', '#e6b54a', '#14806f'].map((c) => `<button class="sw ${bg.mode === 'color' && bg.color === c ? 'on' : ''}" data-col="${c}" style="background:${c}"></button>`).join('')}</div>
  <div class="row"><button class="chip" id="all-fit" data-testid="all-fit">همه‌ی کلیپ‌ها: جا دادن کامل</button><button class="chip" id="all-fill">همه: پر کردن</button></div>`, (c) => {
    $('[data-bg]', c).onclick = () => editLive((p) => (p.bg = { mode: 'blur', color: p.bg.color })); $$('[data-col]', c).forEach((b) => (b.onclick = () => editLive((p) => (p.bg = { mode: 'color', color: b.dataset.col }))));
    $('#all-fit', c).onclick = () => editLive((p) => p.clips.forEach((x) => (x.fit = 'fit'))); $('#all-fill', c).onclick = () => editLive((p) => p.clips.forEach((x) => (x.fit = 'fill'))); }); }
function openAudio() { const a = cur(); const d = a.out - a.in; sheet(`${head(a.kind === 'voice' ? 'صدای ضبط‌شده' : 'موسیقی')}<div class="lbl"><span>بلندی</span><b id="av">${fa(Math.round(a.volume * 100))}٪</b></div><input type="range" id="avol" min="0" max="1.5" step="0.05" value="${a.volume}">
  <div class="lbl"><span>محو ورودی</span><b id="fiv">${fa(a.fadeIn)} ث</b></div><input type="range" id="fi" data-testid="fade-in" min="0" max="5" step="0.5" value="${a.fadeIn}">
  <div class="lbl"><span>محو خروجی</span><b id="fov">${fa(a.fadeOut)} ث</b></div><input type="range" id="fo" min="0" max="5" step="0.5" value="${a.fadeOut}">
  <div class="lbl"><span>طول (ثانیه)</span><b id="lv">${fa(d.toFixed(1))}</b></div><input type="range" id="alen" min="1" max="${a.srcDur.toFixed(1)}" step="0.5" value="${d}">
  <div class="row"><button class="chip" id="fit-v">هم‌اندازه با ویدیو</button></div>`, (c) => {
    slider(c, '#avol', (v) => { editLive(() => (cur().volume = v)); $('#av', c).textContent = fa(Math.round(v * 100)) + '٪'; });
    slider(c, '#fi', (v) => { editLive(() => (cur().fadeIn = v)); $('#fiv', c).textContent = fa(v) + ' ث'; }); slider(c, '#fo', (v) => { editLive(() => (cur().fadeOut = v)); $('#fov', c).textContent = fa(v) + ' ث'; });
    slider(c, '#alen', (v) => { editLive(() => (cur().out = P.r3(Math.min(cur().srcDur, cur().in + v)))); $('#lv', c).textContent = fa(v.toFixed(1)); });
    $('#fit-v', c).onclick = () => editLive((p) => { const x = cur(); x.start = 0; x.out = P.r3(Math.min(x.srcDur, x.in + P.videoDuration(p))); }); }); }
// voiceover
function openVoice() { let rec, chunks = [], stream, t0;
  sheet(`${head('صداگذاری')}<p class="note">صدایت از همین لحظه‌ی نشانگر (${P.fmtTime(S.t)}) روی ویدیو قرار می‌گیرد. حین ضبط، ویدیو بی‌صدا پخش می‌شود.</p><button class="btn" id="rec" data-testid="rec-btn">● شروع ضبط</button><div class="lbl" id="rec-t"></div>`, (c) => {
    const btn = $('#rec', c); btn.onclick = async () => {
      if (!rec) { try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { return toast('اجازه‌ی میکروفون داده نشد'); }
        const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || ''; rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
        rec.ondataavailable = (e) => chunks.push(e.data); rec.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); const type = (rec.mimeType || 'audio/mp4').split(';')[0];
          const f = new File(chunks, `voice.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type }); try { const m = await importFile(f); m.type = 'audio'; edit((p) => p.audios.push(P.newAudio(m, t0, 'voice'))); audioBuffer(m.id); toast('صدای تو اضافه شد 🎙️'); } catch (e) { toast('ضبط ذخیره نشد'); } closeSheet(); };
        t0 = S.t; rec.start(250); btn.innerHTML = '■ پایان ضبط'; const st = Date.now(); const iv = setInterval(() => { if (rec.state !== 'recording') return clearInterval(iv); $('#rec-t', c).innerHTML = `<span class="rec-dot"></span> ${P.fmtTime((Date.now() - st) / 1000)}`; }, 200);
        if (S.proj.clips.length) { const keep = S.proj.clips.map((x) => x.muted); S.proj.clips.forEach((x) => (x.muted = true)); play(); rec.addEventListener('stop', () => { S.proj.clips.forEach((x, i) => (x.muted = keep[i] ?? x.muted)); pause(); }); }
      } else if (rec.state === 'recording') rec.stop(); }; }); }
// captions
function openCaptions() { const caps = S.proj.texts.filter((t) => t.kind === 'caption').sort((a, b) => a.start - b.start);
  sheet(`${head('زیرنویس')}<button class="btn" id="auto-cap" data-testid="auto-captions">🪄 زیرنویس خودکار فارسی (روی گوشی)</button><div class="progress" id="cp" hidden><i></i></div><div class="note" id="cpn"></div>
  <button class="btn ghost" id="man-cap" data-testid="manual-caption">＋ زیرنویس دستی در لحظه‌ی ${P.fmtTime(S.t)}</button>
  <div id="cap-list">${caps.map((t) => `<div class="lbl"><span>${P.fmtTime(t.start)} → ${P.fmtTime(t.start + t.dur)}</span></div><textarea class="tin" data-cap="${t.id}" style="min-height:44px">${esc(t.text)}</textarea>`).join('')}</div>
  ${caps.length ? '<button class="btn ghost" id="srt">⬇ فایل SRT</button>' : ''}
  <p class="note">مدل گفتار (۱۰۸ مگ، یک‌بار) از سایت «حرف» خودت دانلود می‌شود و صدا از گوشی بیرون نمی‌رود. دقت فارسی متوسط است؛ بعدش متن‌ها را ویرایش کن.</p>`, async (c) => {
    modelReady().then((ok) => ok && ($('#cpn', c).textContent = 'مدل گفتار آماده است ✓'));
    $('#man-cap', c).onclick = () => { closeSheet(); addText({ text: 'زیرنویس', kind: 'caption', style: 'caption', anim: 'none', y: 0.78, size: 0.055, dur: 2.5 }); };
    $$('[data-cap]', c).forEach((ta) => (ta.oninput = () => editLive((p) => (p.texts.find((x) => x.id === ta.dataset.cap).text = ta.value))));
    $('#srt', c) && ($('#srt', c).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([P.toSRT(S.proj)], { type: 'text/plain' })); a.download = 'captions.srt'; a.click(); });
    $('#auto-cap', c).onclick = async () => { if (!S.proj.clips.length) return toast('اول ویدیو اضافه کن'); const pr = $('#cp', c); pr.hidden = false; $('#auto-cap', c).disabled = true;
      try { S.hist.push(S.proj); const n = await autoCaptions(S.proj, (k, m) => { $('i', pr).style.width = k * 100 + '%'; $('#cpn', c).textContent = m; }); save(); toast(`${fa(n)} زیرنویس ساخته شد`); closeSheet(); }
      catch (e) { console.warn(e); $('#cpn', c).textContent = 'زیرنویس خودکار انجام نشد (' + (e.message || e) + '). می‌توانی دستی بنویسی.'; $('#auto-cap', c).disabled = false; } }; }); }
// ---------- export ----------
$('#q-btn').onclick = () => { S.quality = S.quality === '1080' ? '720' : '1080'; $('#q-btn').textContent = S.quality + 'p'; };
$('#aspect-btn').onclick = openAspect;
$('#export-btn').onclick = () => { if (!S.proj.clips.length) return toast('اول ویدیو اضافه کن'); pause(); const [W, H] = outSize(S.proj, S.quality); let ctrl;
  sheet(`<h3>خروجی ویدیو<button class="done" data-close>بستن</button></h3><div class="row"><button class="chip ${S.quality === '1080' ? 'on' : ''}" data-q="1080">1080p</button><button class="chip ${S.quality === '720' ? 'on' : ''}" data-q="720">720p</button></div>
  <p class="note" id="ex-info">${fa(W)}×${fa(H)} · ۳۰ فریم · ${fa(P.fmtTime(P.duration(S.proj)))} · MP4</p><button class="btn" id="ex-go" data-testid="export-go">ساخت ویدیو</button>
  <div class="progress" id="ex-p" hidden><i></i></div><div class="note" id="ex-m"></div><div id="ex-out"></div>
  <p class="note">تا پایان ساخت، صفحه را باز نگه دار. سپس «ذخیره» را بزن و در منوی اشتراک «Save Video» را انتخاب کن تا در Photos ذخیره شود.</p>`, (c) => {
    $$('[data-q]', c).forEach((b) => (b.onclick = () => { S.quality = b.dataset.q; $('#q-btn').textContent = S.quality + 'p'; $$('[data-q]', c).forEach((x) => x.classList.toggle('on', x === b)); const [w, h] = outSize(S.proj, S.quality); $('#ex-info', c).textContent = `${fa(w)}×${fa(h)} · ۳۰ فریم · MP4`; }));
    $('#ex-go', c).onclick = async () => { const b = $('#ex-go', c); b.disabled = true; b.textContent = 'در حال ساخت…'; $('#ex-p', c).hidden = false; ctrl = new AbortController(); const t0 = performance.now();
      try { const res = await exportVideo(S.proj, { quality: S.quality, signal: ctrl.signal, ...(window.__katExportOpts || {}), onProgress: (k, m) => { $('#ex-p i', c).style.width = k * 100 + '%'; $('#ex-m', c).textContent = `${m} ${fa(Math.round(k * 100))}٪`; } });
        window.__lastExport = res; res.ms = performance.now() - t0; const url = URL.createObjectURL(res.blob);
        $('#ex-m', c).textContent = `آماده شد ✓ (${fa((res.blob.size / 1048576).toFixed(1))} مگابایت)`; b.hidden = true;
        $('#ex-out', c).innerHTML = `<video class="result" src="${url}" controls playsinline data-testid="export-video"></video><button class="btn" id="ex-save" data-testid="export-save">⬇ ذخیره در گالری / اشتراک</button>`;
        $('#ex-save', c).onclick = async () => { const r = await saveVideo(res, (S.proj.name || 'kat').replace(/\s+/g, '-')); if (r !== 'cancel') toast(r === 'shared' ? 'ذخیره شد ✓' : 'دانلود شد ✓'); };
      } catch (e) { console.error(e); $('#ex-m', c).textContent = 'خطا در ساخت ویدیو: ' + (e.message || e); b.disabled = false; b.textContent = 'تلاش دوباره'; } };
    $('[data-close]', c).addEventListener('click', () => ctrl?.abort()); }); };
// ---------- boot ----------
window.__kat = { S, P, refresh, draw };
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
document.fonts?.ready.then(() => S.proj && draw()); renderHome();
// fit the preview canvas inside the stage (CSS max-height on a grid item doesn't constrain it reliably)
{ const st = $('#stage'); const fit = () => { const r = st.getBoundingClientRect(); const aw = r.width * 0.92, ah = r.height - 10; if (aw <= 0 || ah <= 0) return; const k = Math.min(aw / cv.width, ah / cv.height); cv.style.width = Math.floor(cv.width * k) + 'px'; cv.style.height = Math.floor(cv.height * k) + 'px'; };
  new ResizeObserver(fit).observe(st); new MutationObserver(fit).observe(cv, { attributes: true, attributeFilter: ['width', 'height'] }); }
