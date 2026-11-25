// Offline speech recognition: a small streaming English model run by sherpa-onnx. No internet needed.
const path = require("path"), fs = require("fs");
class Stt {
  constructor(modelRoot) { this.root = modelRoot; this.rec = null; this.stream = null; this.on = false; this.last = ""; this.error = ""; this.listeners = new Set(); }
  dir() { return path.join(this.root, "en-streaming-20M"); }
  available() { try { return fs.existsSync(path.join(this.dir(), "tokens.txt")); } catch (e) { return false; } }
  load() {
    if (this.rec) return; if (!this.available()) throw new Error("The speech model files are missing.");
    const sherpa = require("sherpa-onnx-node"), d = this.dir();
    this.rec = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { transducer: { encoder: path.join(d, "encoder.int8.onnx"), decoder: path.join(d, "decoder.int8.onnx"), joiner: path.join(d, "joiner.int8.onnx") }, tokens: path.join(d, "tokens.txt"), numThreads: 2, provider: "cpu", debug: 0 },
      decodingMethod: "greedy_search", enableEndpoint: true, rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 0.9, rule3MinUtteranceLength: 18,
    });
  }
  start() { this.load(); this.stream = this.rec.createStream(); this.stream.acceptWaveform({ samples: new Float32Array(4800), sampleRate: 16000 }); this.on = true; this.last = ""; this.error = ""; }
  accept(buf) {
    if (!this.on || !buf.length) return;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)); // copy: network buffers are not aligned
    this.stream.acceptWaveform({ samples: new Float32Array(ab), sampleRate: 16000 }); this.pump(false);
  }
  pump(flush) {
    const r = this.rec, s = this.stream; while (r.isReady(s)) r.decode(s);
    const text = String(r.getResult(s).text || "").trim().toLowerCase();
    if (flush || r.isEndpoint(s)) { if (text) this.emit({ t: "final", text }); r.reset(s); this.last = ""; }
    else if (text && text !== this.last) { this.last = text; this.emit({ t: "partial", text }); }
  }
  stop() { if (!this.on) return; this.on = false; try { this.stream.acceptWaveform({ samples: new Float32Array(8000), sampleRate: 16000 }); this.stream.inputFinished(); this.pump(true); } catch (e) {} this.stream = null; }
  emit(o) { for (const l of this.listeners) { try { l(o); } catch (e) {} } }
}
module.exports = { Stt };
