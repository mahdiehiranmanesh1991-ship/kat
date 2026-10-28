// On-device Whisper (transformers.js + onnxruntime-web WASM). Models come from the «حرف» site on the
// same GitHub Pages origin (shared Cache Storage 'harf-models-v1' → download once for both apps).
import { pipeline, env } from '../vendor/transformers.min.js';
import { customCache } from './model-cache.js';
const VENDOR = new URL('../vendor/', import.meta.url).href;
let asr = null, base = null;
self.onmessage = async ({ data }) => {
  const { id } = data;
  try {
    if (!asr) { base = data.base;
      env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = base + 'models/';
      env.useBrowserCache = false; env.useCustomCache = true; env.customCache = customCache(base);
      env.backends.onnx.wasm.wasmPaths = VENDOR; env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
      asr = await pipeline('automatic-speech-recognition', 'whisper-tiny-fa', { dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, device: 'wasm' });
      self.postMessage({ id, type: 'loaded' }); }
    let text = '';
    try { const out = await asr(data.audio, { language: 'persian', task: 'transcribe', no_repeat_ngram_size: 3, max_new_tokens: 120 }); text = (out?.text || '').trim(); }
    catch (e) { if (!/token_ids must be a non-empty/.test(String(e))) throw e; }
    self.postMessage({ id, type: 'done', text });
  } catch (e) { self.postMessage({ id, type: 'error', error: String(e?.message || e) }); }
};
