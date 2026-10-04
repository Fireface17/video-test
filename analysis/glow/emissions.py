"""CTC log-probs of the vocal stem -> work/emission_<model>_<src>.npy

NeMo Conformer-CTC (stt_en_conformer_ctc_large: 128 BPE pieces + blank, 40 ms
frames), ONNX from the sherpa-onnx releases on GitHub.  Features as in the
model's reference script: 80-bin Kaldi fbank at 16 kHz, no dither, normalized
per feature over each window.  The song is cut into 30 s windows every 20 s
(attention over the whole song would need GBs) and each frame is taken from the
window where it sits most centrally.

Run:  uv run python emissions.py [large|medium] [mono|L|R]
"""
import sys

import kaldi_native_fbank as knf
import librosa
import numpy as np
import onnxruntime as ort
import soundfile as sf

from common import MODELS, WORK

SR = 16000
FRAME = 0.04
WIN, STEP = 30.0, 20.0


def fbank(x):
    opts = knf.FbankOptions()
    opts.frame_opts.dither = 0
    opts.frame_opts.snip_edges = False
    opts.frame_opts.samp_freq = SR
    opts.mel_opts.num_bins = 80
    fb = knf.OnlineFbank(opts)
    fb.accept_waveform(SR, (x * 32768).tolist())
    fb.input_finished()
    f = np.stack([fb.get_frame(i) for i in range(fb.num_frames_ready)])
    return (f - f.mean(0, keepdims=True)) / (f.std(0, keepdims=True) + 1e-5)


def main():
    model = sys.argv[1] if len(sys.argv) > 1 else "large"
    src = sys.argv[2] if len(sys.argv) > 2 else "mono"
    v, sr = sf.read(WORK / "vocals.wav", dtype="float32", always_2d=True)
    x = {"mono": v.mean(1), "L": v[:, 0], "R": v[:, 1]}[src]
    x = librosa.resample(x, orig_sr=sr, target_sr=SR)
    sess = ort.InferenceSession(str(MODELS / f"sherpa-onnx-nemo-ctc-en-conformer-{model}" / "model.onnx"),
                                providers=["CPUExecutionProvider"])
    dur = len(x) / SR
    T = int(np.ceil(dur / FRAME))
    out, best = None, np.full(T, np.inf)  # best: distance of each frame to its window's centre
    for a in np.arange(0.0, max(dur - WIN, 0) + STEP, STEP):
        seg = x[int(a * SR):int((a + WIN) * SR)]
        f = fbank(seg)[None].transpose(0, 2, 1).astype(np.float32)
        lp = sess.run(None, {"audio_signal": f, "length": np.array([f.shape[2]], np.int64)})[0][0]
        if out is None:
            out = np.full((T, lp.shape[1]), -1e4, np.float32)
        i0 = int(round(a / FRAME))
        n = min(len(lp), T - i0)
        centre = i0 + len(lp) / 2
        d = np.abs(np.arange(i0, i0 + n) - centre)
        take = d < best[i0:i0 + n]
        out[i0:i0 + n][take] = lp[:n][take]
        best[i0:i0 + n][take] = d[take]
        print(f"window {a:6.1f}s: {len(lp)} frames")
    np.save(WORK / f"emission_{model}_{src}.npy", out)
    print("saved", out.shape)


if __name__ == "__main__":
    main()
