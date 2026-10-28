// Headless-Chrome E2E for «کات» at iPhone size. Usage: python3 -m http.server 8833 -d /workspace/kat & PW_DIR=/tmp/pw node tests/e2e.mjs http://127.0.0.1:8833/
import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { mkdirSync, rmSync, writeFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
const require = createRequire((process.env.PW_DIR || '/tmp/pw') + '/'); const { chromium } = require('playwright-core');
const URL_ = process.argv[2] || 'http://127.0.0.1:8833/'; const ORIGIN = new URL(URL_).origin; const MEDIA = process.env.MEDIA || '/tmp/katmedia/';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname; rmSync(SHOTS, { recursive: true, force: true }); mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('•', ...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Asia/Tehran',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.grantPermissions(['microphone'], { origin: ORIGIN });
const page = await ctx.newPage(); const external = [], errors = [];
page.on('request', (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && !/^(data|blob):/.test(u)) external.push(u); });
page.on('pageerror', (e) => { errors.push(String(e)); console.log('PAGEERR', String(e)); }); page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('CONSOLEERR', m.text()); } });
const tid = (t) => `[data-testid="${t}"]`; let n = 0;
const shot = async (name, settle = 600) => { await sleep(settle); const f = `${SHOTS}${String(++n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: f }); log('screenshot', f); };
const click = async (sel) => { const l = page.locator(sel).first(); await l.waitFor({ state: 'visible', timeout: 15000 }); await l.click(); };
const proj = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__kat.S.proj)));
const seekTo = (t) => page.evaluate((t) => { const S = window.__kat.S; const tl = document.getElementById('tl'); tl.scrollLeft = t * S.pps; tl.dispatchEvent(new Event('scroll')); }, t);
const done = async () => { await click('#sheet:not([hidden]) ' + tid('sheet-done')); await sleep(200); };
const lit = () => page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4000) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4000) / 3; });

await page.goto(URL_); await page.evaluate(() => document.fonts.ready); await page.locator(tid('home')).waitFor(); await shot('home-empty');
// import 2 videos + 1 photo
const [fc] = await Promise.all([page.waitForEvent('filechooser'), click(tid('new-project'))]);
await fc.setFiles([MEDIA + 'a.mp4', MEDIA + 'b.mp4', MEDIA + 'photo.jpg']);
await page.waitForFunction(() => window.__kat.S.proj?.clips.length === 3, null, { timeout: 30000 }); await sleep(800);
let p = await proj(); log('duration', p.clips.map((c) => c.out)); assert.ok(Math.abs(p.clips[0].out - 4) < 0.15);
assert.ok((await lit()) > 20, 'preview renders a frame'); await shot('editor-imported', 900);
// split at 2s
await seekTo(2); await sleep(400); await click(tid('tool-edit')); await click(tid('tool-split'));
p = await proj(); assert.equal(p.clips.length, 4, 'split'); log('after split', p.clips.map((c) => [c.in, c.out]));
await shot('split-selected');
// speed 2x on second piece
await click(tid('tool-speed')); await page.locator(tid('speed-range')).fill('5'); await page.locator(tid('speed-range')).dispatchEvent('input'); await shot('speed-sheet'); await done();
p = await proj(); const selId = await page.evaluate(() => window.__kat.S.sel); const sp = p.clips.find((c) => c.id === selId); assert.equal(sp.speed, 2);
// filter
await click(tid('tool-filter')); await click(tid('filter-court')); await shot('filters'); await done();
// adjust
await click(tid('tool-adjust')); await page.locator(tid('adj-w')).fill('0.3'); await page.locator(tid('adj-w')).dispatchEvent('input'); await done();
// duplicate + move + delete
await click(tid('tool-dup')); assert.equal((await proj()).clips.length, 5); await click(tid('tool-delete')); assert.equal((await proj()).clips.length, 4);
// undo/redo
await click(tid('undo')); assert.equal((await proj()).clips.length, 5); await click(tid('redo')); assert.equal((await proj()).clips.length, 4);
// transition fade on clip index 2
await page.evaluate(() => { const S = window.__kat.S; S.sel = S.proj.clips[2].id; window.__kat.refresh(); }); await click(tid('tool-transition')); await click(tid('tr-slide')); await shot('transition', 900); await done();
assert.equal((await proj()).clips[2].transition.type, 'slide');
// fit + blur bg on photo
await page.evaluate(() => { const S = window.__kat.S; S.sel = S.proj.clips[3].id; window.__kat.refresh(); }); await click(tid('tool-fit')); await click(tid('fit-fit')); await done();
await click(tid('tool-back'));
// text overlay
await seekTo(0.5); await sleep(300); await click(tid('tool-text')); await page.locator(tid('text-input')).fill('چک برگشتی؛ چه کنیم؟'); await click(tid('style-neon')); await click(tid('anim-pop'));
await shot('text-sheet'); await done(); p = await proj(); assert.equal(p.texts.at(-1).text, 'چک برگشتی؛ چه کنیم؟'); await seekTo(1.2); await shot('text-on-preview', 900);
// sticker
await click(tid('tool-back')); await click(tid('tool-sticker')); await shot('stickers'); await page.locator(tid('sticker')).first().click(); assert.equal((await proj()).texts.at(-1).kind, 'sticker'); await click(tid('tool-back'));
// templates
await click(tid('tool-templates')); await click(tid('tpl-title')); await sleep(300); p = await proj(); assert.equal(p.clips[0].type, 'color'); await seekTo(1.2); await shot('template-title', 900);
await click(tid('tool-templates')); await seekTo(6); await click(tid('tpl-lower3')); await seekTo(6.5); await shot('lower-third', 900);
// music
await page.locator(tid('file-audio')).setInputFiles(MEDIA + 'music.m4a'); await page.waitForFunction(() => window.__kat.S.proj.audios.length === 1, null, { timeout: 15000 });
await page.evaluate(() => { const S = window.__kat.S; S.sel = S.proj.audios[0].id; window.__kat.refresh(); }); await click(tid('tool-audio')); await shot('music-sheet'); await done(); await click(tid('tool-back'));
// voiceover (fake mic) 1.5s
await seekTo(1); await click(tid('tool-voice')); await click(tid('rec-btn')); await sleep(1600); await click(tid('rec-btn'));
await page.waitForFunction(() => window.__kat.S.proj.audios.some((a) => a.kind === 'voice'), null, { timeout: 15000 }); log('voiceover added'); await sleep(500);
// manual caption + captions sheet
await click(tid('tool-captions')); await shot('captions-sheet'); await click(tid('manual-caption')); await page.locator(tid('text-input')).fill('این یک زیرنویس دستی است'); await done();
// aspect
if (await page.locator(tid('tool-back')).isVisible()) await click(tid('tool-back')); await click(tid('tool-aspect')); await shot('aspect'); await done();
// zoom timeline (ctrl+wheel) and timeline shot
await page.evaluate(() => document.getElementById('zoom-fit').click()); await shot('timeline-overview');
// playback sanity
await seekTo(0); await click(tid('play')); await sleep(1500); const tPlay = await page.evaluate(() => window.__kat.S.t); await click(tid('play')); log('played to', tPlay); assert.ok(tPlay > 0.8, 'playback advances');
// export
const T = await page.evaluate(() => window.__kat.P.duration(window.__kat.S.proj)); log('project duration', T);
const doExport = async (name, opts) => {
  await page.evaluate((o) => (window.__katExportOpts = o), opts); await click(tid('export-btn')); await click(tid('export-go'));
  await page.locator(tid('export-video')).waitFor({ timeout: 240000 }); const info = await page.evaluate(async () => { const r = window.__lastExport; const b = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return { method: r.method, mime: r.mime, ext: r.ext, ms: r.ms, w: r.width, h: r.height, b64: btoa(s) }; });
  const f = `/tmp/kat-export-${name}.${info.ext}`; writeFileSync(f, Buffer.from(info.b64, 'base64'));
  const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
  const v = pr.streams.find((s) => s.codec_type === 'video'), a = pr.streams.find((s) => s.codec_type === 'audio');
  log(name, info.method, info.mime, `${(info.ms / 1000).toFixed(1)}s`, v?.codec_name, `${v?.width}x${v?.height}`, a?.codec_name, 'dur', pr.format.duration);
  assert.ok(v && a, 'video + audio streams'); assert.equal(v.width, info.w); assert.equal(v.height, info.h); assert.ok(Math.abs(+pr.format.duration - T) < 1.0, 'duration matches');
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-']); // fully decodable
  const vol = execFileSync('ffmpeg', ['-i', f, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); return { f, info, v, a };
};
const r1 = await doExport('webcodecs', { method: 'webcodecs', allowOpus: true }); await shot('export-done', 900); await click('#sheet:not([hidden]) [data-close]');
await click(tid('quality-btn'));
const r2 = await doExport('recorder720', { method: 'recorder' }); await click('#sheet:not([hidden]) [data-close]');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.2', '-i', r1.f, '-frames:v', '1', SHOTS + 'export-frame-1s.png']); execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '6.5', '-i', r1.f, '-frames:v', '1', SHOTS + 'export-frame-6s.png']);
// autosave → home
await sleep(600); await click(tid('back')); await sleep(900); assert.equal(await page.locator(tid('project-card')).count(), 1); await shot('home-projects');
// reload → project persists
await page.reload(); await page.locator(tid('project-card')).first().click(); await page.waitForFunction(() => window.__kat.S.proj?.clips.length >= 4); log('reloaded project OK');
log('external requests:', external.length, external.slice(0, 3)); assert.equal(external.length, 0, 'no external requests');
log('errors:', errors); await browser.close(); console.log('E2E PASS', r1.info.method, r2.info.method);
