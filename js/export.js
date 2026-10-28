// Export: (A) WebCodecs H.264 + AAC → mp4-muxer (frame-accurate, faster than real time when supported)
//         (B) fallback: canvas.captureStream + Web Audio → MediaRecorder (Safari records real MP4/H.264/AAC).
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';
import { ASPECTS, duration, locate, transitionAt, starts, clipDur, audioGain } from './core/project.js';
import { Renderer } from './render.js';
import { elementFor, seek, audioBuffer, audioCtx, mediaCache } from './media.js';

export function outSize(p, quality) { const [W, H] = ASPECTS[p.aspect] || ASPECTS['9:16']; const k = quality === '720' ? 720 / Math.min(W, H) : 1; return [Math.round(W * k / 2) * 2, Math.round(H * k / 2) * 2]; }
/** Offline mix of all clip audio + music + voiceover. */
export async function mixAudio(p, rate = 48000, { clipsOnly = false } = {}) {
  const T = Math.max(0.1, duration(p)); const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ac = new OAC(2, Math.ceil(T * rate), rate); const st = starts(p);
  for (let i = 0; i < p.clips.length; i++) { const c = p.clips[i]; if (c.type !== 'video' || c.muted || c.volume <= 0) continue;
    const buf = await audioBuffer(c.mediaId); if (!buf) continue;
    const s = ac.createBufferSource(); s.buffer = buf; s.playbackRate.value = c.speed; const g = ac.createGain(); g.gain.value = c.volume;
    s.connect(g).connect(ac.destination); s.start(st[i], Math.min(c.in, buf.duration), Math.max(0.01, c.out - c.in)); }
  if (!clipsOnly) for (const a of p.audios) { const buf = await audioBuffer(a.mediaId); if (!buf) continue;
    const s = ac.createBufferSource(); s.buffer = buf; const g = ac.createGain(); const d = a.out - a.in;
    g.gain.setValueAtTime(audioGain(a, 0), a.start);
    for (let k = 1; k <= 40; k++) { const l = (d * k) / 40; g.gain.linearRampToValueAtTime(audioGain(a, Math.min(l, d - 0.001)), a.start + l); }
    s.connect(g).connect(ac.destination); s.start(a.start, a.in, d); }
  return ac.startRendering();
}
async function pickAvc(W, H, fps) {
  if (!('VideoEncoder' in window)) return null;
  for (const codec of ['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.4d0028', 'avc1.42003e', 'avc1.42002a']) {
    const cfg = { codec, width: W, height: H, bitrate: W * H > 1e6 ? 10e6 : 5e6, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch {} }
  return null;
}
async function pickAudio(allowOpus) {
  if (!('AudioEncoder' in window)) return null;
  const list = [['mp4a.40.2', 'aac']]; if (allowOpus) list.push(['opus', 'opus']);
  for (const [codec, mux] of list) { const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch {} }
  return null;
}
export async function capabilities(p) { const [W, H] = outSize(p, '1080'); const v = await pickAvc(W, H, 30), a = await pickAudio(false);
  const rec = typeof MediaRecorder !== 'undefined' && ['video/mp4', 'video/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
  return { webcodecs: !!(v && a), recorder: rec || null }; }

async function prepareFrame(p, t) { const L = locate(p, t); if (!L) return; const tasks = [];
  if (L.clip.type !== 'color') tasks.push(elementFor('x' + L.clip.id, L.clip.mediaId).then((e) => L.clip.type === 'video' && seek(e, L.src)));
  const tr = transitionAt(p, t); if (tr && tr.prev.type !== 'color') tasks.push(elementFor('xp' + tr.prev.id, tr.prev.mediaId).then((e) => tr.prev.type === 'video' && seek(e, tr.prevSrc)));
  await Promise.all(tasks); }
const getter = (pref) => (clip, role) => { if (clip.type === 'color') return null; const m = mediaCache.get(clip.mediaId); if (!m) return null; return elsGet((role === 'prev' ? pref + 'p' : pref) + clip.id); };
import { allElements } from './media.js'; const elsGet = (k) => allElements().get(k);

export async function exportVideo(p, { quality = '1080', fps = 30, method = 'auto', allowOpus = false, onProgress = () => {}, signal } = {}) {
  await document.fonts?.ready; const [W, H] = outSize(p, quality); const T = duration(p);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d'); const R = new Renderer();
  onProgress(0, 'میکس صدا…'); const mix = await mixAudio(p, 48000);
  let vcfg = null, acfg = null;
  if (method !== 'recorder') { vcfg = await pickAvc(W, H, fps); acfg = await pickAudio(allowOpus); }
  if (vcfg && acfg) return viaWebCodecs({ p, W, H, fps, T, ctx, R, vcfg, acfg, mix, onProgress, signal });
  if (method === 'webcodecs') throw new Error('WebCodecs H.264/AAC در این مرورگر پشتیبانی نمی‌شود');
  return viaRecorder({ p, W, H, fps, T, canvas, ctx, R, mix, onProgress, signal });
}
async function viaWebCodecs({ p, W, H, fps, T, ctx, R, vcfg, acfg, mix, onProgress, signal }) {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H, frameRate: fps }, audio: { codec: acfg.mux, sampleRate: 48000, numberOfChannels: 2 }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let err = null; const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (err = e) }); ve.configure(vcfg);
  const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (err = e) }); ae.configure(acfg.cfg);
  const n = Math.max(1, Math.round(T * fps)); const get = getter('x');
  for (let i = 0; i < n; i++) { if (signal?.aborted) throw new Error('لغو شد'); if (err) throw err;
    const t = i / fps; await prepareFrame(p, t); R.frame(ctx, p, t, get);
    const vf = new VideoFrame(ctx.canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    ve.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close();
    while (ve.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
    if (i % 5 === 0) onProgress(i / n, 'ساخت فریم‌ها…'); }
  const L = mix.getChannelData(0), Rr = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L, len = Math.min(mix.length, Math.round(T * 48000));
  for (let o = 0; o < len; o += 1024) { const k = Math.min(1024, len - o); const d = new Float32Array(k * 2); d.set(L.subarray(o, o + k), 0); d.set(Rr.subarray(o, o + k), k);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round((o / 48000) * 1e6), data: d }); ae.encode(ad); ad.close(); }
  onProgress(0.98, 'نهایی‌سازی…'); await ve.flush(); await ae.flush(); if (err) throw err; muxer.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4', method: 'webcodecs-' + acfg.mux, width: W, height: H };
}
async function viaRecorder({ p, W, H, fps, T, canvas, ctx, R, mix, onProgress, signal }) {
  const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const ac = audioCtx(); await ac.resume(); const dest = ac.createMediaStreamDestination(); const src = ac.createBufferSource(); src.buffer = mix; src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: W * H > 1e6 ? 10e6 : 5e6, audioBitsPerSecond: 160000 }); const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data); const stopped = new Promise((r) => (rec.onstop = r));
  // pre-create one element per clip
  for (const c of p.clips) if (c.type !== 'color') { await elementFor('r' + c.id, c.mediaId); await elementFor('rp' + c.id, c.mediaId); }
  await prepareFrameR(p, 0); R.frame(ctx, p, 0, getter('r'));
  rec.start(500); const t0 = ac.currentTime + 0.05; src.start(t0); let playing = null;
  await new Promise((resolve, reject) => { const tick = () => { if (signal?.aborted) { rec.stop(); return reject(new Error('لغو شد')); }
      const t = Math.max(0, ac.currentTime - t0); if (t >= T) return resolve();
      const L = locate(p, t); if (L && L.clip.type === 'video') { const e = elsGet('r' + L.clip.id);
        if (playing !== e) { if (playing) playing.pause(); playing = e; e.playbackRate = L.clip.speed; e.currentTime = L.src; e.play().catch(() => {}); }
        else if (Math.abs(e.currentTime - L.src) > 0.25) e.currentTime = L.src; } else if (playing) { playing.pause(); playing = null; }
      const tr = transitionAt(p, t); if (tr && tr.prev.type === 'video') { const e = elsGet('rp' + tr.prev.id); if (e && Math.abs(e.currentTime - tr.prevSrc) > 0.1) e.currentTime = tr.prevSrc; }
      R.frame(ctx, p, t, getter('r')); onProgress(t / T, 'ضبط ویدیو (هم‌زمان با پخش)…'); requestAnimationFrame(tick); }; tick(); });
  playing?.pause(); rec.stop(); await stopped; try { src.stop(); } catch {}
  const type = (mime || chunks[0]?.type || 'video/webm').split(';')[0];
  return { blob: new Blob(chunks, { type }), mime: type, ext: type.includes('mp4') ? 'mp4' : 'webm', method: 'mediarecorder', width: W, height: H };
}
async function prepareFrameR(p, t) { const L = locate(p, t); if (L && L.clip.type === 'video') await seek(elsGet('r' + L.clip.id), L.src); }
export async function saveVideo(res, name = 'kat') {
  const file = new File([res.blob], `${name}.${res.ext}`, { type: res.mime });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.append(a); a.click(); a.remove(); return 'downloaded';
}
