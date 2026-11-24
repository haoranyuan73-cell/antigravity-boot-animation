import os
import sys
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

SR = 48000
DUR = 9.5
N = int(SR * DUR)


def lowpass(sig, cutoff_hz, order=4):
    sos = butter(order, min(cutoff_hz, SR * 0.45), btype="low", fs=SR, output="sos")
    return sosfilt(sos, sig, axis=0)


def soft_pad_chord(t, freqs, phase_offset=0.0):
    out = np.zeros_like(t)
    for idx, f in enumerate(freqs):
        detunes = (-0.0045, 0.0, 0.0045)
        for d_idx, det in enumerate(detunes):
            p = phase_offset + idx * 0.73 + d_idx * 1.17
            w = 2.0 * np.pi * f * (1.0 + det) * t + p
            # Warm harmonic blend (fundamental + subtle 2nd + trace 3rd)
            out += np.sin(w) + 0.16 * np.sin(2.0 * w + 0.3) + 0.04 * np.sin(3.0 * w)
    out /= max(1.0, len(freqs) * 2.2)
    return out


def add_stereo_reverb(sig, wet=0.38):
    delays_ms_l = (37, 61, 89, 131)
    delays_ms_r = (41, 67, 97, 139)
    gains = (0.42, 0.30, 0.21, 0.14)
    rev = np.zeros_like(sig)
    for dl, dr, g in zip(delays_ms_l, delays_ms_r, gains):
        sl = int(SR * dl / 1000.0)
        sr = int(SR * dr / 1000.0)
        if sl < N:
            rev[sl:, 0] += sig[: N - sl, 0] * g + sig[: N - sl, 1] * (g * 0.35)
        if sr < N:
            rev[sr:, 1] += sig[: N - sr, 1] * g + sig[: N - sr, 0] * (g * 0.35)
    rev = lowpass(rev, 4200, order=2)
    return sig * (1.0 - wet * 0.35) + rev * wet


def build_cosmic_bed():
    t = np.linspace(0.0, DUR, N, endpoint=False)

    # 1. Deep cosmic sub drone (55 Hz + 82.41 Hz + 110 Hz) with slow breathing LFO
    breath = 0.78 + 0.22 * np.sin(2.0 * np.pi * 0.16 * t - 0.6)
    sub_l = (
        0.55 * np.sin(2.0 * np.pi * 55.0 * t)
        + 0.25 * np.sin(2.0 * np.pi * 82.41 * t + 0.4)
        + 0.22 * np.sin(2.0 * np.pi * 110.0 * t)
    ) * breath
    sub_r = (
        0.55 * np.sin(2.0 * np.pi * 55.35 * t + 0.2)
        + 0.25 * np.sin(2.0 * np.pi * 82.10 * t + 0.9)
        + 0.22 * np.sin(2.0 * np.pi * 110.45 * t + 0.5)
    ) * breath
    sub = np.stack([sub_l, sub_r], axis=1) * 0.36

    # 2. Ethereal cosmic orchestral pad: Aadd9 (0-4.7s) -> Dmaj9 (4.6s-9.5s)
    pad_a_l = soft_pad_chord(t, [220.0, 277.18, 329.63, 493.88, 659.25], 0.0)
    pad_a_r = soft_pad_chord(t, [220.0, 277.18, 329.63, 493.88, 659.25], 1.4)
    pad_b_l = soft_pad_chord(t, [146.83, 220.0, 277.18, 329.63, 440.0, 659.25], 0.5)
    pad_b_r = soft_pad_chord(t, [146.83, 220.0, 277.18, 329.63, 440.0, 659.25], 2.1)

    xf_u = np.clip((t - 4.35) / 0.75, 0.0, 1.0)
    xf_u = xf_u * xf_u * (3.0 - 2.0 * xf_u)
    pad_l = pad_a_l * (1.0 - xf_u) + pad_b_l * xf_u
    pad_r = pad_a_r * (1.0 - xf_u) + pad_b_r * xf_u
    pad = np.stack([pad_l, pad_r], axis=1)

    # Dynamic brightness swell as stargate opens
    pad_warm = lowpass(pad, 950, order=3)
    pad_bright = lowpass(pad, 3600, order=3)
    bright_env = 0.25 + 0.75 * np.clip((t - 3.6) / 1.4, 0.0, 1.0) * np.clip((9.5 - t) / 1.8, 0.0, 1.0)
    pad = pad_warm * (1.0 - bright_env[:, None] * 0.55) + pad_bright * (bright_env[:, None] * 0.85)
    pad *= 0.34

    # 3. Crystalline stardust harp chimes
    rng = np.random.default_rng(2026)
    chime_events = [
        (0.45, 880.0, -0.55, 0.11),
        (1.05, 1318.5, 0.45, 0.10),
        (1.65, 1108.7, -0.30, 0.11),
        (2.25, 1479.98, 0.60, 0.10),
        (2.90, 987.77, -0.45, 0.12),
        (3.55, 1760.0, 0.35, 0.11),
        (4.10, 1318.5, -0.25, 0.12),
        (4.78, 1760.0, 0.00, 0.16),
        (4.82, 2217.46, 0.35, 0.12),
        (6.45, 1479.98, -0.40, 0.09),
        (7.20, 1318.5, 0.45, 0.08),
    ]
    chimes = np.zeros((N, 2), dtype=np.float64)
    for start_s, freq, pan, amp in chime_events:
        s0 = int(start_s * SR)
        dur_c = min(2.4, DUR - start_s)
        if dur_c <= 0.1:
            continue
        nc = int(dur_c * SR)
        tc = np.linspace(0.0, dur_c, nc, endpoint=False)
        env = (1.0 - np.exp(-tc / 0.012)) * np.exp(-tc / 0.72)
        tone = (np.sin(2.0 * np.pi * freq * tc) + 0.25 * np.sin(2.0 * np.pi * freq * 2.0 * tc)) * env * amp
        gl = np.sqrt(0.5 * (1.0 - pan))
        gr = np.sqrt(0.5 * (1.0 + pan))
        chimes[s0 : s0 + nc, 0] += tone * gl
        chimes[s0 : s0 + nc, 1] += tone * gr

    # 4. Ethereal cosmic shimmer wind & stargate swell (3.85s -> 5.4s)
    noise = rng.normal(0.0, 1.0, (N, 2))
    wind_low = lowpass(noise, 1400, order=3) - lowpass(noise, 260, order=3)
    swell_env = np.exp(-0.5 * ((t - 4.72) / 0.38) ** 2) * 0.22
    wind = wind_low * swell_env[:, None]

    # 5. Deep portal activation impact at 4.75s
    boom = np.zeros((N, 2), dtype=np.float64)
    b0 = int(4.74 * SR)
    b_dur = min(2.6, DUR - 4.74)
    nb = int(b_dur * SR)
    tb = np.linspace(0.0, b_dur, nb, endpoint=False)
    f_sweep = 40.0 + 68.0 * np.exp(-tb / 0.16)
    phase = 2.0 * np.pi * np.cumsum(f_sweep) / SR
    b_env = (1.0 - np.exp(-tb / 0.018)) * np.exp(-tb / 0.75)
    b_sig = (np.sin(phase) * 0.75 + np.sin(phase * 2.0) * 0.18) * b_env * 0.42
    boom[b0 : b0 + nb, 0] = b_sig
    boom[b0 : b0 + nb, 1] = b_sig

    bed = sub + pad + add_stereo_reverb(chimes + wind, wet=0.45) + boom
    bed = add_stereo_reverb(bed, wet=0.28)
    return bed


def prepare_voice(voice_path):
    v, vsr = sf.read(voice_path, dtype="float64")
    if v.ndim > 1:
        v = np.mean(v, axis=1)
    if vsr != SR:
        # Linear resample if needed
        new_len = int(round(len(v) * SR / vsr))
        v = np.interp(np.linspace(0, len(v) - 1, new_len), np.arange(len(v)), v)

    # Trim leading/trailing near-silence gently
    abs_v = np.abs(v)
    peak = np.max(abs_v) if len(v) else 0.0
    if peak < 1e-6:
        raise RuntimeError("Voice audio is silent")
    thr = peak * 0.025
    idx = np.where(abs_v > thr)[0]
    if len(idx) > 0:
        pad = int(0.06 * SR)
        s = max(0, idx[0] - pad)
        e = min(len(v), idx[-1] + pad)
        v = v[s:e]

    # Gentle fade in/out on trimmed voice clip
    fade = min(int(0.025 * SR), len(v) // 4)
    if fade > 0:
        v[:fade] *= np.linspace(0.0, 1.0, fade)
        v[-fade:] *= np.linspace(1.0, 0.0, fade)

    # Normalize voice RMS/peak cleanly
    v = v / (np.max(np.abs(v)) + 1e-9) * 0.72

    # Stereo voice + light cosmic spatial echo tail
    v_st = np.stack([v, v], axis=1)
    tail_len = len(v) + int(0.9 * SR)
    v_space = np.zeros((tail_len, 2), dtype=np.float64)
    v_space[: len(v)] += v_st
    for d_ms, gl, gr in ((68, 0.18, 0.09), (125, 0.07, 0.14), (210, 0.08, 0.06)):
        ds = int(SR * d_ms / 1000.0)
        if ds + len(v) <= tail_len:
            echo = lowpass(v_st, 3400, order=2)
            v_space[ds : ds + len(v), 0] += echo[:, 0] * gl
            v_space[ds : ds + len(v), 1] += echo[:, 1] * gr
    return v_space, len(v)


def print_usage():
    print(
        "Usage: python build_cosmic_audio.py <voice_wav_or_--no-voice> <output_wav>\n"
        "Example:\n"
        "  python build_cosmic_audio.py --no-voice cosmic_bed.wav\n"
        "  python build_cosmic_audio.py voice.wav mixed_boot.wav"
    )


def main():
    if any(arg in ("-h", "--help") for arg in sys.argv[1:]) or len(sys.argv) < 3:
        print_usage()
        sys.exit(0 if any(arg in ("-h", "--help") for arg in sys.argv[1:]) else 1)

    voice_path = sys.argv[1]
    out_path = sys.argv[2]

    t = np.linspace(0.0, DUR, N, endpoint=False)
    bed = build_cosmic_bed()

    if not voice_path or voice_path == "--no-voice":
        mix = bed
    else:
        voice, core_len = prepare_voice(voice_path)

        start_sec = 5.18
        v0 = int(start_sec * SR)
        v_end = min(N, v0 + len(voice))
        core_dur = core_len / SR

        # Smooth music ducking while "欢迎回来" plays
        duck = np.ones(N, dtype=np.float64)
        d_in = (t >= start_sec - 0.18) & (t < start_sec + 0.08)
        d_hold = (t >= start_sec + 0.08) & (t < start_sec + core_dur + 0.05)
        d_out = (t >= start_sec + core_dur + 0.05) & (t < start_sec + core_dur + 0.45)
        duck[d_in] = 1.0 - 0.34 * ((t[d_in] - (start_sec - 0.18)) / 0.26)
        duck[d_hold] = 0.66
        duck[d_out] = 0.66 + 0.34 * ((t[d_out] - (start_sec + core_dur + 0.05)) / 0.40)

        mix = bed * duck[:, None]
        mix[v0:v_end] += voice[: v_end - v0]

    # Master envelope: fade in 0.22s, fade out last 1.35s
    master_env = np.clip(t / 0.22, 0.0, 1.0) * np.clip((DUR - t) / 1.35, 0.0, 1.0)
    mix *= master_env[:, None]

    # Gentle soft limiter keeping peak <= -1.5 dBFS (~0.84)
    peak = np.max(np.abs(mix))
    if peak > 0.0:
        mix = mix / max(1.0, peak / 0.88)
    mix = np.tanh(mix * 1.05) / np.tanh(1.05) * 0.84

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    sf.write(out_path, mix, SR, subtype="PCM_16")
    print(f"MIX_OK duration={len(mix)/SR:.3f}s peak={np.max(np.abs(mix)):.3f}")


if __name__ == "__main__":
    main()
