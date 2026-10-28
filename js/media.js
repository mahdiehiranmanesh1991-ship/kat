// Import media from Photos/Files, make timeline thumbnails, decode audio.
import { uid } from './core/project.js';
import * as db from './db.js';
const urls = new Map(); const els = new Map(); const audioBufs = new Map();
export const mediaCache = new Map(); // id -> record
export function urlOf(id) { const m = mediaCache.get(id); if (!m) return null; if (!urls.has(id)) urls.set(id, URL.createObjectURL(m.blob)); return urls.get(id); }
const once = (el, ev) => new Promise((res, rej) => { const ok = () => { el.removeEventListener('error', bad); res(); }; const bad = () => { el.removeEventListener(ev, ok); rej(new Error('media error')); }; el.addEventListener(ev, ok, { once: true }); el.addEventListener('error', bad, { once: true }); });
export function makeVideo(src) { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = src; return v; }
export async function seek(v, t) {
  t = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
  if (Math.abs(v.currentTime - t) < 0.002 && v.readyState >= 2) return;
  const p = once(v, 'seeked'); v.currentTime = t; await Promise.race([p, new Promise((r) => setTimeout(r, 1500))]);
}
/** One element per key (clip id) so transitions can draw two frames. */
export async function elementFor(key, mediaId) {
  const m = mediaCache.get(mediaId); if (!m) return null;
  let e = els.get(key); if (e && e.dataset.media === mediaId) return e;
  if (m.type === 'image') { e = new Image(); e.src = urlOf(mediaId); await e.decode().catch(() => {}); }
  else { e = makeVideo(urlOf(mediaId)); if (e.readyState < 1) await once(e, 'loadedmetadata').catch(() => {}); }
  e.dataset.media = mediaId; els.set(key, e); return e;
}
export function allElements() { return els; }
function thumbsOf(src, isImg, dur, n = 8) {
  return new Promise(async (resolve) => {
    const c = document.createElement('canvas'); c.width = 96; c.height = 170; const g = c.getContext('2d'); const out = [];
    const draw = (el, w, h) => { const k = Math.max(96 / w, 170 / h); g.drawImage(el, (96 - w * k) / 2, (170 - h * k) / 2, w * k, h * k); return c.toDataURL('image/jpeg', 0.6); };
    if (isImg) { const im = new Image(); im.src = src; await im.decode().catch(() => {}); resolve([draw(im, im.naturalWidth || 1, im.naturalHeight || 1)]); return; }
    const v = makeVideo(src); try { await once(v, 'loadeddata'); } catch { resolve([]); return; }
    for (let i = 0; i < n; i++) { await seek(v, (dur * (i + 0.5)) / n); out.push(draw(v, v.videoWidth || 1, v.videoHeight || 1)); }
    v.removeAttribute('src'); v.load(); resolve(out);
  });
}
export async function importFile(file) {
  const type = file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'audio' : 'video';
  const id = uid(); const blob = file; const src = URL.createObjectURL(blob); urls.set(id, src);
  let duration = 3, width = 1080, height = 1920;
  if (type === 'video' || type === 'audio') {
    const el = type === 'video' ? makeVideo(src) : Object.assign(new Audio(), { preload: 'metadata', src });
    await once(el, 'loadedmetadata'); duration = el.duration;
    if (!isFinite(duration)) { el.currentTime = 1e7; await once(el, 'durationchange').catch(() => {}); duration = isFinite(el.duration) ? el.duration : 10; }
    if (type === 'video') { width = el.videoWidth; height = el.videoHeight; }
  } else { const im = new Image(); im.src = src; await im.decode(); width = im.naturalWidth; height = im.naturalHeight; }
  const thumbs = type === 'audio' ? [] : await thumbsOf(src, type === 'image', duration);
  const rec = { id, type, name: file.name || type, mime: file.type, blob, duration: Math.round(duration * 1000) / 1000, width, height, thumbs, added: Date.now() };
  mediaCache.set(id, rec); await db.put('media', rec); return rec;
}
export async function loadMedia(ids) { for (const id of ids) if (!mediaCache.has(id)) { const m = await db.get('media', id); if (m) mediaCache.set(id, m); } }
let actx; export const audioCtx = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
export async function audioBuffer(id) {
  if (audioBufs.has(id)) return audioBufs.get(id);
  const m = mediaCache.get(id); if (!m || m.type === 'image') return null;
  const p = m.blob.arrayBuffer().then((ab) => new Promise((res) => audioCtx().decodeAudioData(ab, res, () => res(null)))).catch(() => null);
  audioBufs.set(id, p); return p;
}
