// Persian auto-captions: mix clip audio → 16 kHz → ~8 s windows → Whisper tiny-fa → timed caption chunks.
import { chunkCaptions, newText, r3 } from './core/project.js';
import { mixAudio } from './export.js';
import { downloadModel, isModelCached } from './model-cache.js';
export const MODEL_BASE = 'https://mahdiehiranmanesh1991-ship.github.io/harf/';
let w, seq = 0; const pend = new Map();
const worker = () => { if (w) return w; w = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }) => { const q = pend.get(data.id); if (!q) return; if (data.type === 'loaded') return q.onLoaded?.(); pend.delete(data.id); data.type === 'error' ? q.reject(new Error(data.error)) : q.resolve(data.text); }; return w; };
const call = (audio, onLoaded) => new Promise((resolve, reject) => { const id = ++seq; pend.set(id, { resolve, reject, onLoaded }); worker().postMessage({ id, audio, base: MODEL_BASE }, [audio.buffer]); });
export const modelReady = () => isModelCached(MODEL_BASE, 'whisper-tiny-fa').catch(() => false);
export async function autoCaptions(p, onProgress = () => {}, { transcribe = call } = {}) {
  if (!(await modelReady()) && transcribe === call) await downloadModel(MODEL_BASE, 'whisper-tiny-fa', (k) => onProgress(k * 0.4, `دانلود مدل گفتار (${Math.round(k * 108)} از ۱۰۸ مگ)…`));
  const buf = await mixAudio(p, 16000, { clipsOnly: false }); const pcm = buf.getChannelData(0); const rate = 16000, win = 8 * rate; const out = [];
  for (let o = 0, i = 0; o < pcm.length; o += win, i++) {
    const seg = pcm.slice(o, Math.min(pcm.length, o + win)); let e = 0; for (let k = 0; k < seg.length; k += 64) e += seg[k] * seg[k];
    if (e / (seg.length / 64) < 1e-6) continue; // silence
    onProgress(0.4 + 0.6 * (o / pcm.length), 'تشخیص گفتار روی همین گوشی…');
    const text = await transcribe(seg); const t0 = o / rate, t1 = Math.min(pcm.length, o + win) / rate;
    for (const c of chunkCaptions(text, t0, t1, 5)) out.push(newText(c.text, c.start, { dur: Math.max(0.6, c.dur), kind: 'caption', style: 'caption', anim: 'none', y: 0.78, size: 0.055 }));
  }
  p.texts = p.texts.filter((t) => t.kind !== 'caption').concat(out); onProgress(1, 'تمام'); return out.length;
}
export { r3 };
