"use client";

/** AudioSource for the laptop mic: getUserMedia + AudioWorklet -> PCM16 frames. */

export interface AudioDevice {
  deviceId: string;
  label: string;
}

const WORKLET = `
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() { super(); this._buf = []; this._inRate = sampleRate; this._outRate = 16000; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ratio = this._inRate / this._outRate;
    let pos = 0;
    const out = [];
    while (pos < ch.length) {
      const i = Math.floor(pos);
      out.push(Math.max(-1, Math.min(1, ch[i])));
      pos += ratio;
    }
    const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) pcm[i] = Math.round(out[i] * 32767);
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor("pcm-downsampler", PcmDownsampler);
`;

export class MicAudioSource {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frameCbs: ((pcm16: ArrayBuffer) => void)[] = [];
  private levelCbs: ((level: number) => void)[] = [];
  private lostCbs: (() => void)[] = [];
  private raf = 0;
  private silentSince: number | null = null;
  private silenceWarned = false;
  deviceId: string | null = null;
  running = false;

  onFrame(cb: (pcm16: ArrayBuffer) => void) { this.frameCbs.push(cb); }
  onLevel(cb: (level: number) => void) { this.levelCbs.push(cb); }
  onLost(cb: () => void) { this.lostCbs.push(cb); }

  static async devices(): Promise<AudioDevice[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microphone" }));
  }

  async start(deviceId?: string): Promise<void> {
    await this.stop();
    this.deviceId = deviceId ?? this.deviceId ?? null;
    const constraints: MediaStreamConstraints = {
      audio: this.deviceId
        ? { deviceId: { exact: this.deviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true },
      video: false,
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Exact device may be gone (unplugged); fall back to default input.
      if (this.deviceId) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.deviceId = null;
      } else throw err;
    }
    this.stream = stream;
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        this.running = false;
        this.lostCbs.forEach((cb) => cb());
      };
    });

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const blob = new Blob([WORKLET], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    src.connect(this.analyser);
    this.node = new AudioWorkletNode(this.ctx, "pcm-downsampler");
    this.node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      this.frameCbs.forEach((cb) => cb(ev.data));
    };
    src.connect(this.node);
    this.running = true;
    this.silenceWarned = false;
    this.silentSince = null;
    this.loopLevels();
  }

  private loopLevels() {
    const buf = new Float32Array(512);
    const tick = () => {
      if (!this.running || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      this.levelCbs.forEach((cb) => cb(Math.min(1, rms * 4)));
      // Silence warning: input alive but near-zero for > 4 s.
      if (rms < 0.004) {
        if (this.silentSince == null) this.silentSince = Date.now();
        if (!this.silenceWarned && Date.now() - this.silentSince > 4000) {
          this.silenceWarned = true;
          this.lostCbs.forEach((cb) => cb());
        }
      } else {
        this.silentSince = null;
        this.silenceWarned = false;
      }
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try { this.node?.disconnect(); } catch { /* noop */ }
    try { this.analyser?.disconnect(); } catch { /* noop */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) { try { await this.ctx.close(); } catch { /* noop */ } }
    this.ctx = null;
    this.node = null;
    this.analyser = null;
  }
}
