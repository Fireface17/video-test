"""Vocal / instrumental split -> work/vocals.wav, work/inst.wav

UVR-MDX-NET-Voc_FT (an MDX-Net vocal model, ONNX, from the UVR model repo on
GitHub) run with onnxruntime on the CPU.  The STFT matches the PyTorch code the
model was trained with (torch.stft, center=True, periodic Hann window): stereo
-> (L re, L im, R re, R im) x 3072 bins x 256 frames per segment.  Segments
overlap by the STFT padding (trim) and are averaged over two half-shifted
passes, which removes the faint seams a single pass leaves at segment edges.

Run:  uv run python separate.py [--nfft 7680]
"""
import sys
import time

import numpy as np
import onnxruntime as ort
import soundfile as sf

from common import MODELS, WORK

DIM_F, DIM_T, HOP = 3072, 256, 1024
COMPENSATE = 1.021  # the model's output gain correction (UVR model data)


def stft(x, n_fft):
    """torch.stft(center=True, reflect pad, periodic Hann), x: (C, L) -> (C, F, T) complex."""
    win = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    pad = n_fft // 2
    xp = np.pad(x, ((0, 0), (pad, pad)), mode="reflect")
    T = 1 + (xp.shape[1] - n_fft) // HOP
    idx = np.arange(n_fft)[None, :] + HOP * np.arange(T)[:, None]
    frames = xp[:, idx] * win  # (C, T, n_fft)
    return np.fft.rfft(frames, axis=-1).transpose(0, 2, 1)


def istft(S, n_fft, length):
    """Inverse of stft() (torch.istft, center=True): (C, F, T) complex -> (C, length)."""
    win = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    frames = np.fft.irfft(S.transpose(0, 2, 1), n=n_fft, axis=-1) * win  # (C, T, n_fft)
    C, T, _ = frames.shape
    out = np.zeros((C, n_fft + HOP * (T - 1)), np.float32)
    wsum = np.zeros(n_fft + HOP * (T - 1), np.float32)
    for t in range(T):
        out[:, t * HOP:t * HOP + n_fft] += frames[:, t]
        wsum[t * HOP:t * HOP + n_fft] += win ** 2
    pad = n_fft // 2
    out = out[:, pad:pad + length] / np.maximum(wsum[pad:pad + length], 1e-8)
    return out


def separate(mix, sess, n_fft, shift=0):
    """One pass over the song: (2, N) -> vocals (2, N)."""
    chunk = HOP * (DIM_T - 1)
    trim = n_fft // 2
    gen = chunk - 2 * trim
    N = mix.shape[1]
    lead = trim + shift
    tail = (gen - (N + shift) % gen) % gen + trim
    xp = np.pad(mix, ((0, 0), (lead, tail)))
    out = np.zeros_like(xp)
    n_bins = n_fft // 2 + 1
    for i in range(0, xp.shape[1] - chunk + 1, gen):
        seg = xp[:, i:i + chunk]
        S = stft(seg, n_fft)  # (2, n_bins, 256)
        spec = np.stack([S.real, S.imag], 1).reshape(4, n_bins, DIM_T)[:, :DIM_F]
        pred = sess.run(None, {"input": spec[None].astype(np.float32)})[0][0]  # (4, DIM_F, 256)
        full = np.zeros((4, n_bins, DIM_T), np.float32)
        full[:, :DIM_F] = pred
        full = full.reshape(2, 2, n_bins, DIM_T)
        wav = istft(full[:, 0] + 1j * full[:, 1], n_fft, chunk)
        out[:, i + trim:i + chunk - trim] = wav[:, trim:chunk - trim]
    return out[:, lead:lead + N] * COMPENSATE


def main():
    n_fft = int(sys.argv[sys.argv.index("--nfft") + 1]) if "--nfft" in sys.argv else 7680
    mix, sr = sf.read(WORK / "mix.wav", dtype="float32", always_2d=True)
    mix = mix.T.copy()
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 4
    sess = ort.InferenceSession(str(MODELS / "UVR-MDX-NET-Voc_FT.onnx"), opts, providers=["CPUExecutionProvider"])
    t0 = time.time()
    gen = HOP * (DIM_T - 1) - n_fft
    voc = 0.5 * (separate(mix, sess, n_fft) + separate(mix, sess, n_fft, shift=gen // 2))
    inst = mix - voc
    sf.write(WORK / "vocals.wav", voc.T, sr, subtype="FLOAT")
    sf.write(WORK / "inst.wav", inst.T, sr, subtype="FLOAT")
    rms = lambda x: float(np.sqrt(np.mean(x ** 2)))
    print(f"n_fft {n_fft}: vocals rms {rms(voc):.4f}, inst rms {rms(inst):.4f}, mix rms {rms(mix):.4f} "
          f"({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()
