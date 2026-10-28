// Frame compositor: clips (fit/fill + blurred bg), WebGL color grading, transitions, texts/stickers.
import { locate, transitionAt, textAnim, coverRect, FILTERS, clamp } from './core/project.js';
const VS = 'attribute vec2 p;varying vec2 u;void main(){u=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0,1);}';
const FS = `precision mediump float;varying vec2 u;uniform sampler2D t;uniform float b,c,s,w,v;
void main(){vec4 x=texture2D(t,u);vec3 o=x.rgb+b;o=(o-.5)*(1.+c)+.5;float l=dot(o,vec3(.299,.587,.114));o=mix(vec3(l),o,1.+s);
o.r+=w*.12;o.b-=w*.12;o.g+=w*.03;float d=distance(u,vec2(.5));o*=1.-v*smoothstep(.35,.85,d);gl_FragColor=vec4(clamp(o,0.,1.),x.a);}`;
class Grader {
  constructor() { this.c = document.createElement('canvas'); const gl = this.gl = this.c.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true }); if (!gl) return;
    const sh = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr); this.pr = pr;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.u = Object.fromEntries('bcswv'.split('').map((k) => [k, gl.getUniformLocation(pr, k)])); }
  apply(src, a) { const gl = this.gl; if (!gl) return src; if (this.c.width !== src.width || this.c.height !== src.height) { this.c.width = src.width; this.c.height = src.height; }
    gl.viewport(0, 0, src.width, src.height); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    for (const k of 'bcswv') gl.uniform1f(this.u[k], a[k] || 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.c; }
}
const mk = (W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
export class Renderer {
  constructor() { this.grader = new Grader(); this.layers = []; this.small = mk(36, 64); }
  layer(i, W, H) { let c = this.layers[i]; if (!c || c.width !== W || c.height !== H) c = this.layers[i] = mk(W, H); return c; }
  /** Render one clip into a full-frame layer. el = HTMLVideoElement|HTMLImageElement */
  drawClip(L, clip, el, p, W, H, t) {
    const g = L.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    if (clip.type === 'color' || !el) return brandCard(g, W, H, t);
    const sw = el.videoWidth || el.naturalWidth || W, sh = el.videoHeight || el.naturalHeight || H;
    const bg = p.bg || { mode: 'blur' };
    if (clip.fit === 'fit') {
      if (bg.mode === 'blur') { // cheap, Safari-safe blur: downscale then upscale with smoothing
        const s = this.small, sg = s.getContext('2d'); const r = coverRect(sw, sh, s.width, s.height, 'fill'); sg.drawImage(el, r.x, r.y, r.w, r.h);
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(s, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, W, H);
      } else { g.fillStyle = bg.color || '#000'; g.fillRect(0, 0, W, H); }
    } else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    const r = coverRect(sw, sh, W, H, clip.fit === 'fit' ? 'fit' : 'fill');
    if (clip.type === 'image') { const k = 1 + 0.06 * clamp(t / 3, 0, 1); g.drawImage(el, r.x - (r.w * (k - 1)) / 2, r.y - (r.h * (k - 1)) / 2, r.w * k, r.h * k); } // Ken Burns
    else g.drawImage(el, r.x, r.y, r.w, r.h);
    const f = FILTERS[clip.filter] || FILTERS.none, a = clip.adj || {};
    const adj = { b: (f.b || 0) + (a.b || 0), c: (f.c || 0) + (a.c || 0), s: (f.s || 0) + (a.s || 0), w: (f.w || 0) + (a.w || 0), v: (f.v || 0) + (a.v || 0) };
    if (Object.values(adj).some((x) => Math.abs(x) > 1e-3)) { const out = this.grader.apply(L, adj); if (out !== L) { g.drawImage(out, 0, 0); } }
  }
  /** get(clip, role) → drawable already positioned at the right time ('cur' | 'prev'). */
  frame(ctx, p, t, get, opts = {}) {
    const W = ctx.canvas.width, H = ctx.canvas.height; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const Lc = locate(p, t);
    if (Lc) {
      const A = this.layer(0, W, H); this.drawClip(A, Lc.clip, get(Lc.clip, 'cur'), p, W, H, Lc.local);
      const tr = transitionAt(p, t);
      if (tr) { const B = this.layer(1, W, H); this.drawClip(B, tr.prev, get(tr.prev, 'prev'), p, W, H, 99); composite(ctx, B, A, tr.type, tr.k, W, H); }
      else ctx.drawImage(A, 0, 0);
    }
    this.boxes = {}; for (const tx of p.texts) { const an = textAnim(tx, t); if (an && !(opts.hide === tx.id)) { const b = drawText(ctx, tx, an, W, H, opts.selected === tx.id); this.boxes[tx.id] = { x: tx.x, y: tx.y - an.dy, w: b.w * an.scale, h: b.h * an.scale }; } }
  }
}
function composite(ctx, prev, cur, type, k, W, H) {
  const e = k * k * (3 - 2 * k);
  if (type === 'fade') { ctx.drawImage(prev, 0, 0); ctx.globalAlpha = e; ctx.drawImage(cur, 0, 0); ctx.globalAlpha = 1; }
  else if (type === 'black') { if (e < 0.5) { ctx.drawImage(prev, 0, 0); ctx.fillStyle = `rgba(0,0,0,${e * 2})`; } else { ctx.drawImage(cur, 0, 0); ctx.fillStyle = `rgba(0,0,0,${2 - e * 2})`; } ctx.fillRect(0, 0, W, H); }
  else if (type === 'slide') { ctx.drawImage(prev, -W * e, 0); ctx.drawImage(cur, W * (1 - e), 0); }
  else if (type === 'zoom') { ctx.drawImage(prev, 0, 0); const s = 1.4 - 0.4 * e; ctx.globalAlpha = e; ctx.drawImage(cur, (W - W * s) / 2, (H - H * s) / 2, W * s, H * s); ctx.globalAlpha = 1; }
  else if (type === 'wipe') { ctx.drawImage(prev, 0, 0); ctx.save(); ctx.beginPath(); ctx.rect(W * (1 - e), 0, W * e, H); ctx.clip(); ctx.drawImage(cur, 0, 0); ctx.restore(); }
  else ctx.drawImage(cur, 0, 0);
}
export function brandCard(g, W, H, t = 0) {
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#0d1330'); gr.addColorStop(0.55, '#231446'); gr.addColorStop(1, '#3a1238'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W / 2, H * 0.44); g.rotate(t * 0.15); g.strokeStyle = 'rgba(230,181,74,.18)'; g.lineWidth = W * 0.004;
  for (let i = 0; i < 24; i++) { g.rotate(Math.PI / 12); g.beginPath(); g.moveTo(W * 0.18, 0); g.lineTo(W * 0.9, 0); g.stroke(); } g.restore();
  g.strokeStyle = 'rgba(230,181,74,.9)'; g.lineWidth = W * 0.006; g.beginPath(); g.arc(W / 2, H * 0.44, W * 0.3, 0, Math.PI * 2); g.stroke();
  g.font = `${W * 0.12}px sans-serif`; g.textAlign = 'center'; g.globalAlpha = 0.85; g.fillText('⚖️', W / 2, H * 0.32); g.globalAlpha = 1;
}
function wrap(ctx, text, maxW) {
  const out = []; for (const para of String(text).split('\n')) { let line = '';
    for (const w of para.split(' ')) { const tryL = line ? line + ' ' + w : w; if (ctx.measureText(tryL).width > maxW && line) { out.push(line); line = w; } else line = tryL; } out.push(line); }
  return out;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
export function drawText(ctx, tx, an, W, H, selected) {
  const isEmoji = tx.kind === 'sticker'; const fs = tx.size * W * (isEmoji ? 2.2 : 1);
  let text = tx.text; if (isFinite(an.chars)) text = [...text].slice(0, an.chars).join('');
  ctx.save(); ctx.globalAlpha = an.alpha; ctx.translate(tx.x * W, (tx.y - an.dy) * H); ctx.scale(an.scale, an.scale); if (tx.rot) ctx.rotate(tx.rot);
  const weight = tx.style === 'title' ? 900 : tx.style === 'plain' || tx.style === 'caption' ? 700 : 800;
  ctx.font = `${weight} ${fs}px Vazirmatn, sans-serif`; ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrap(ctx, text, W * 0.84), lh = fs * 1.45, h = lines.length * lh, wMax = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const y0 = -h / 2 + lh / 2, padX = fs * 0.6, padY = fs * 0.35, s = tx.style;
  if (s === 'box' || s === 'question' || s === 'answer') {
    ctx.fillStyle = s === 'box' ? 'rgba(10,10,16,.72)' : s === 'question' ? tx.accent : 'rgba(255,255,255,.95)';
    rr(ctx, -wMax / 2 - padX, -h / 2 - padY, wMax + padX * 2, h + padY * 2, fs * 0.5); ctx.fill();
    if (s === 'question') { ctx.beginPath(); ctx.moveTo(fs * 0.4, h / 2 + padY - 1); ctx.lineTo(fs * 1.2, h / 2 + padY + fs * 0.6); ctx.lineTo(fs * 1.4, h / 2 + padY - 1); ctx.fill(); }
  }
  if (s === 'lower3') { const bw = wMax + padX * 2.5; ctx.fillStyle = 'rgba(12,14,34,.86)'; rr(ctx, -bw / 2, -h / 2 - padY, bw, h + padY * 2, fs * 0.25); ctx.fill(); ctx.fillStyle = tx.accent; ctx.fillRect(bw / 2 - fs * 0.25, -h / 2 - padY, fs * 0.25, h + padY * 2); }
  const color = s === 'question' ? '#14101f' : s === 'answer' ? '#14101f' : tx.color;
  lines.forEach((l, i) => { const y = y0 + i * lh;
    if (s === 'outline' || s === 'caption' || s === 'title') { ctx.lineJoin = 'round'; ctx.lineWidth = fs * (s === 'title' ? 0.1 : 0.16); ctx.strokeStyle = s === 'title' ? tx.accent : '#000'; ctx.strokeText(l, 0, y); }
    if (s === 'neon') { ctx.shadowColor = tx.color; ctx.shadowBlur = fs * 0.6; }
    if (s === 'plain' || s === 'title') { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = fs * 0.25; }
    ctx.fillStyle = color; ctx.fillText(l, 0, y); ctx.shadowBlur = 0; });
  if (selected) { ctx.globalAlpha = 1; ctx.setLineDash([fs * 0.25, fs * 0.2]); ctx.lineWidth = Math.max(3, W * 0.003); ctx.strokeStyle = '#fff'; ctx.strokeRect(-wMax / 2 - padX * 1.2, -h / 2 - padY * 1.6, wMax + padX * 2.4, h + padY * 3.2); }
  ctx.restore();
  return { w: (wMax + padX * 2) / W, h: (h + padY * 2) / H };
}
