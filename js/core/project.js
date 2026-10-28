// «کات» — pure project model (no DOM). Used by app, renderer, exporter and unit tests.
export const ASPECTS = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080], '4:5': [1080, 1350] };
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const r3 = (x) => Math.round(x * 1000) / 1000;

export const FILTERS = {
  none: { name: 'اصلی', b: 0, c: 0, s: 0, w: 0, v: 0 },
  vivid: { name: 'زنده', b: 0.03, c: 0.15, s: 0.35, w: 0.05, v: 0.1 },
  warm: { name: 'گرم', b: 0.02, c: 0.05, s: 0.1, w: 0.35, v: 0.15 },
  cool: { name: 'سرد', b: 0, c: 0.08, s: -0.05, w: -0.35, v: 0.1 },
  mono: { name: 'سیاه‌وسفید', b: 0, c: 0.2, s: -1, w: 0, v: 0.25 },
  film: { name: 'فیلم', b: -0.03, c: 0.12, s: -0.2, w: 0.2, v: 0.35 },
  court: { name: 'دادگاه', b: -0.02, c: 0.18, s: -0.25, w: 0.12, v: 0.4 },
  pastel: { name: 'پاستل', b: 0.08, c: -0.12, s: -0.1, w: 0.08, v: 0 },
};
export const TRANSITIONS = { none: 'بدون', fade: 'محو', black: 'سیاهی', slide: 'کشویی', zoom: 'زوم', wipe: 'پرده' };
export const TEXT_STYLES = { plain: 'ساده', box: 'کادر', outline: 'دورخط', neon: 'نئون', lower3: 'زیرنویس پایین', question: 'پرسش', answer: 'پاسخ', caption: 'زیرنویس', title: 'عنوان' };
export const TEXT_ANIMS = { none: 'بدون', fade: 'محو', pop: 'پاپ', up: 'بالا آمدن', type: 'تایپ' };

export function newProject(name = 'پروژه جدید', aspect = '9:16') {
  return { id: uid(), name, aspect, created: Date.now(), updated: Date.now(), clips: [], texts: [], audios: [], bg: { mode: 'blur', color: '#0b0b12' } };
}
export function newClip(media, opts = {}) {
  const dur = media.type === 'video' ? media.duration : (opts.dur || 3);
  return { id: uid(), mediaId: media.id, type: media.type, in: 0, out: r3(dur), srcDur: media.type === 'video' ? media.duration : 9999,
    speed: 1, volume: 1, muted: false, fit: 'fill', filter: 'none', adj: { b: 0, c: 0, s: 0, w: 0, v: 0 }, transition: { type: 'none', dur: 0.5 }, color: opts.color || null, ...opts.extra };
}
export const clipDur = (c) => r3((c.out - c.in) / c.speed);
export const duration = (p) => r3(Math.max(p.clips.reduce((a, c) => a + clipDur(c), 0),
  ...p.texts.map((t) => t.start + t.dur), ...p.audios.map((a) => a.start + (a.out - a.in)), 0));
export const videoDuration = (p) => r3(p.clips.reduce((a, c) => a + clipDur(c), 0));
export function starts(p) { let s = 0; return p.clips.map((c) => { const v = s; s += clipDur(c); return v; }); }
/** Which clip is on screen at time t, and source time within its media. */
export function locate(p, t) {
  let s = 0;
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i], d = clipDur(c);
    if (t < s + d || i === p.clips.length - 1) { const local = clamp(t - s, 0, d); return { index: i, clip: c, start: s, local, src: r3(c.in + local * c.speed) }; }
    s += d;
  }
  return null;
}
/** Transition state at t: incoming clip i with its own transition (applied at its head). */
export function transitionAt(p, t) {
  const L = locate(p, t); if (!L || L.index === 0) return null;
  const tr = L.clip.transition; if (!tr || tr.type === 'none') return null;
  const d = Math.min(tr.dur, clipDur(L.clip) / 2, clipDur(p.clips[L.index - 1]) / 2);
  if (L.local >= d) return null;
  return { type: tr.type, k: d > 0 ? L.local / d : 1, prev: p.clips[L.index - 1], prevSrc: p.clips[L.index - 1].out - 0.04 };
}
export function split(p, id, t) {
  const i = p.clips.findIndex((c) => c.id === id); if (i < 0) return false;
  const st = starts(p)[i], c = p.clips[i], local = t - st;
  if (local < 0.1 || local > clipDur(c) - 0.1) return false;
  const at = r3(c.in + local * c.speed);
  const b = { ...structuredClone(c), id: uid(), in: at, transition: { type: 'none', dur: 0.5 } };
  c.out = at; p.clips.splice(i + 1, 0, b); return b.id;
}
export function trim(p, id, side, delta) { // delta in timeline seconds
  const c = p.clips.find((x) => x.id === id); if (!c) return;
  const ds = delta * c.speed, min = 0.2 * c.speed;
  if (side === 'start') c.in = r3(clamp(c.in + ds, 0, c.out - min));
  else c.out = r3(clamp(c.out + ds, c.in + min, c.srcDur));
}
export function remove(p, id) {
  for (const k of ['clips', 'texts', 'audios']) { const i = p[k].findIndex((x) => x.id === id); if (i >= 0) { p[k].splice(i, 1); return k; } }
  return null;
}
export function duplicate(p, id) {
  for (const k of ['clips', 'texts', 'audios']) {
    const i = p[k].findIndex((x) => x.id === id); if (i < 0) continue;
    const n = { ...structuredClone(p[k][i]), id: uid() };
    if (k === 'clips') p.clips.splice(i + 1, 0, n); else { n.start = r3(n.start + (n.dur ?? (n.out - n.in))); p[k].push(n); }
    return n.id;
  }
  return null;
}
export function move(p, id, dir) {
  const i = p.clips.findIndex((c) => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.clips.length) return false;
  [p.clips[i], p.clips[j]] = [p.clips[j], p.clips[i]]; return true;
}
export function setSpeed(p, id, s) { const c = p.clips.find((x) => x.id === id); if (c) c.speed = clamp(s, 0.25, 4); }
export function find(p, id) { for (const k of ['clips', 'texts', 'audios']) { const x = p[k].find((y) => y.id === id); if (x) return [k, x]; } return [null, null]; }

export function newText(text, start, opts = {}) {
  return { id: uid(), text, start: r3(start), dur: 3, x: 0.5, y: 0.5, size: 0.065, color: '#ffffff', accent: '#e6b54a', style: 'box', anim: 'pop', kind: 'text', ...opts };
}
/** Animation params for a text at timeline t → {alpha, scale, dy, chars} or null when hidden. */
export function textAnim(tx, t) {
  const l = t - tx.start; if (l < 0 || l > tx.dur) return null;
  const inK = clamp(l / 0.35, 0, 1), outK = clamp((tx.dur - l) / 0.25, 0, 1);
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  let alpha = 1, scale = 1, dy = 0, chars = Infinity;
  if (tx.anim === 'fade') alpha = ease(inK);
  if (tx.anim === 'pop') { scale = inK < 1 ? 0.6 + 0.4 * ease(inK) + Math.sin(inK * Math.PI) * 0.12 : 1; alpha = ease(Math.min(1, inK * 2)); }
  if (tx.anim === 'up') { dy = (1 - ease(inK)) * 0.06; alpha = ease(inK); }
  if (tx.anim === 'type') chars = Math.floor([...tx.text].length * clamp(l / Math.min(1.2, tx.dur * 0.6), 0, 1));
  if (tx.anim !== 'none') alpha *= ease(outK);
  return { alpha, scale, dy, chars };
}
export function newAudio(media, start, kind = 'music') {
  return { id: uid(), mediaId: media.id, kind, start: r3(start), in: 0, out: r3(media.duration), srcDur: media.duration, volume: kind === 'music' ? 0.6 : 1, fadeIn: kind === 'music' ? 1 : 0, fadeOut: kind === 'music' ? 1.5 : 0 };
}
/** Gain envelope of an audio item at local time l (seconds from item start). */
export function audioGain(a, l) {
  const d = a.out - a.in; if (l < 0 || l > d) return 0;
  let g = a.volume;
  if (a.fadeIn > 0) g *= clamp(l / a.fadeIn, 0, 1);
  if (a.fadeOut > 0) g *= clamp((d - l) / a.fadeOut, 0, 1);
  return g;
}
/** Split recognized text into short timed caption chunks over [t0,t1]. */
export function chunkCaptions(text, t0, t1, maxWords = 5) {
  const words = String(text).trim().split(/\s+/).filter(Boolean); if (!words.length) return [];
  const groups = []; for (let i = 0; i < words.length; i += maxWords) groups.push(words.slice(i, i + maxWords).join(' '));
  const total = words.length, span = t1 - t0; let acc = 0;
  return groups.map((g) => { const n = g.split(' ').length, s = t0 + span * acc / total; acc += n; return { text: g, start: r3(s), dur: r3(span * n / total) }; });
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
export function srtTime(s) { const ms = Math.round(s * 1000); return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`; }
export function toSRT(p) {
  return p.texts.filter((t) => t.kind === 'caption').sort((a, b) => a.start - b.start)
    .map((t, i) => `${i + 1}\n${srtTime(t.start)} --> ${srtTime(t.start + t.dur)}\n${t.text}\n`).join('\n');
}
export const fmtTime = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), x = s - m * 60; return `${pad(m)}:${pad(Math.floor(x))}`; };
export const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** Fit/fill rectangle of a source (sw×sh) inside W×H. */
export function coverRect(sw, sh, W, H, mode) {
  const k = mode === 'fit' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
  const w = sw * k, h = sh * k; return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
export class History {
  constructor(limit = 60) { this.u = []; this.r = []; this.limit = limit; }
  push(state) { this.u.push(JSON.stringify(state)); if (this.u.length > this.limit) this.u.shift(); this.r = []; }
  undo(cur) { if (!this.u.length) return null; this.r.push(JSON.stringify(cur)); return JSON.parse(this.u.pop()); }
  redo(cur) { if (!this.r.length) return null; this.u.push(JSON.stringify(cur)); return JSON.parse(this.r.pop()); }
  get canUndo() { return this.u.length > 0; } get canRedo() { return this.r.length > 0; }
}
/** Legal-reel templates → mutate project. */
export function applyTemplate(p, kind, t = 0, name = 'آوای عدالت') {
  if (kind === 'title') {
    p.clips.unshift({ ...newClip({ id: 'color', type: 'color' }, { dur: 3, color: 'brand' }) });
    p.texts.forEach((x) => { x.start += 3; }); p.audios.forEach((x) => { x.start += 3; });
    p.texts.push(newText(name, 0.2, { style: 'title', y: 0.44, size: 0.1, dur: 2.7, anim: 'pop', color: '#ffffff', accent: '#e6b54a' }));
    p.texts.push(newText('نکته‌ی حقوقی امروز', 0.6, { style: 'plain', y: 0.54, size: 0.045, dur: 2.3, anim: 'up', color: '#e6b54a' }));
  } else if (kind === 'lower3') {
    p.texts.push(newText('نام شما — عنوان (قابل ویرایش)', t, { style: 'lower3', x: 0.5, y: 0.8, size: 0.04, dur: 4, anim: 'up', accent: '#e6b54a' }));
  } else if (kind === 'qa') {
    p.texts.push(newText('سؤال: چک برگشتی را چطور وصول کنم؟', t, { style: 'question', y: 0.2, size: 0.048, dur: 5, anim: 'pop' }));
    p.texts.push(newText('پاسخ: از طریق اجرای ثبت یا دادگاه…', t + 1.5, { style: 'answer', y: 0.76, size: 0.045, dur: 3.5, anim: 'up' }));
  } else if (kind === 'outro') {
    const s = videoDuration(p); p.clips.push(newClip({ id: 'color', type: 'color' }, { dur: 3, color: 'brand' }));
    p.texts.push(newText('برای نکات بیشتر دنبال کنید', s + 0.2, { style: 'plain', y: 0.42, size: 0.05, dur: 2.8, anim: 'fade' }));
    p.texts.push(newText('@' + name.replace(/\s/g, '_'), s + 0.6, { style: 'neon', y: 0.52, size: 0.06, dur: 2.4, anim: 'pop', color: '#e6b54a' }));
  }
}
