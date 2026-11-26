// Downloads the offline speech model (small English streaming model, Apache-2.0) into ./models if it is not there yet.
// Used by the GitHub installer build. Usage: node scripts/get-model.js [target-folder]
const https = require("https"), fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const NAME = "sherpa-onnx-streaming-zipformer-en-20M-2023-02-17", URL0 = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${NAME}.tar.bz2`;
const target = path.resolve(process.argv[2] || path.join(__dirname, "..", "models"), "en-streaming-20M");
if (fs.existsSync(path.join(target, "tokens.txt"))) { console.log("Speech model already present:", target); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sai-model-")), archive = path.join(tmp, "m.tar.bz2");
function get(url, hops = 0) { return new Promise((ok, no) => { https.get(url, { headers: { "User-Agent": "scripture-ai" } }, (r) => {
  if ([301, 302, 303, 307, 308].includes(r.statusCode) && hops < 6) { r.resume(); return get(r.headers.location, hops + 1).then(ok, no); }
  if (r.statusCode !== 200) return no(new Error("Download failed: HTTP " + r.statusCode)); const f = fs.createWriteStream(archive); r.pipe(f); f.on("finish", () => f.close(ok)); f.on("error", no); }).on("error", no); }); }
(async () => {
  console.log("Downloading the speech model (about 128 MB)…"); await get(URL0);
  execFileSync("tar", ["-xjf", archive, "-C", tmp]); const d = path.join(tmp, NAME); fs.mkdirSync(target, { recursive: true });
  for (const [from, to] of [["encoder-epoch-99-avg-1.int8.onnx", "encoder.int8.onnx"], ["decoder-epoch-99-avg-1.int8.onnx", "decoder.int8.onnx"], ["joiner-epoch-99-avg-1.int8.onnx", "joiner.int8.onnx"], ["tokens.txt", "tokens.txt"], ["README.md", "README.md"]]) fs.copyFileSync(path.join(d, from), path.join(target, to));
  fs.rmSync(tmp, { recursive: true, force: true }); console.log("Speech model ready:", target);
})().catch((e) => { console.error(e.message); process.exit(1); });
