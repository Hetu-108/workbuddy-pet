// 合成音效：全部用 WebAudio 现场生成，不依赖任何音频素材文件。
// 原版 dsh-pet 0.3.7 其实没有音效（106 段 webm 全是静音的），这套是新加的。

let ctx = null;
let master = null;
let enabled = true;
let volume = 0.34;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  return ctx;
}

/** 浏览器/窗口需要一次用户交互才能出声，点一下鱼就解锁 */
export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

export function setEnabled(v) {
  enabled = !!v;
  try { localStorage.setItem('wbpet.sound', enabled ? '1' : '0'); } catch { /* noop */ }
}

export function isEnabled() {
  return enabled;
}

/** 调试用：音频上下文状态 */
export function state() {
  return ctx ? ctx.state : 'none';
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, Number(v) || 0));
  if (master) master.gain.value = volume;
}

export function init(cfg = {}) {
  if (cfg.enabled === false) enabled = false;
  else {
    try {
      const saved = localStorage.getItem('wbpet.sound');
      if (saved === '0') enabled = false;
      if (saved === '1') enabled = true;
    } catch { /* noop */ }
  }
  if (cfg.volume != null) volume = cfg.volume;
  if (master) master.gain.value = volume;
}

function ready() {
  if (!enabled) return null;
  return ensure();
}

/** 单音：可扫频、可加低通 */
function tone({ type = 'sine', f0 = 440, f1 = 0, dur = 0.15, gain = 0.2, delay = 0, lowpass = 0 }) {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(24, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(0.018, dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let tail = osc;
  if (lowpass) {
    const bq = c.createBiquadFilter();
    bq.type = 'lowpass';
    bq.frequency.value = lowpass;
    osc.connect(bq);
    tail = bq;
  }
  tail.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** 噪声段：用于"咻""沙"这类气声 */
function noise({ dur = 0.22, from = 1400, to = 400, gain = 0.12, delay = 0, q = 1.1 }) {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.ceil(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 1.6;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bq = c.createBiquadFilter();
  bq.type = 'bandpass';
  bq.Q.value = q;
  bq.frequency.setValueAtTime(from, t0);
  bq.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bq);
  bq.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ---------------- 对外音效 ----------------
export const sound = {
  /** 点一下：软软的"啵"，高频短促 */
  click() {
    tone({ f0: 620, f1: 1020, dur: 0.11, gain: 0.2 });
    tone({ type: 'triangle', f0: 1560, dur: 0.05, gain: 0.05, delay: 0.005 });
  },

  /** 开心：上行两音 */
  happy() {
    tone({ type: 'triangle', f0: 784, dur: 0.12, gain: 0.16 });
    tone({ type: 'triangle', f0: 1046, dur: 0.16, gain: 0.14, delay: 0.09 });
  },

  /** 惊讶：短促上滑 */
  surprise() {
    tone({ f0: 520, f1: 1500, dur: 0.16, gain: 0.16 });
    noise({ dur: 0.1, from: 2200, to: 900, gain: 0.05 });
  },

  /** 傲娇：下滑带点方波 */
  annoyed() {
    tone({ type: 'square', f0: 340, f1: 190, dur: 0.2, gain: 0.09, lowpass: 1200 });
    tone({ f0: 300, f1: 160, dur: 0.18, gain: 0.1, delay: 0.02 });
  },

  /** 被扔出去：气声"咻" */
  throw() {
    noise({ dur: 0.3, from: 2200, to: 320, gain: 0.1 });
  },

  /** 落地：闷闷一声，power 0~1 控制力度 */
  land(power = 0.6) {
    const p = Math.max(0.25, Math.min(1, power));
    tone({ f0: 170 * (0.8 + p * 0.4), f1: 62, dur: 0.16 + p * 0.08, gain: 0.16 * p, lowpass: 900 });
    noise({ dur: 0.09, from: 600, to: 120, gain: 0.05 * p, q: 0.8 });
  },

  /** 走路脚步声（很轻） */
  step() {
    noise({ dur: 0.05, from: 900, to: 300, gain: 0.028, q: 1.6 });
  },

  /** 冒个泡（碎碎念） */
  bubble() {
    tone({ f0: 300, f1: 700, dur: 0.09, gain: 0.09 });
    tone({ f0: 430, f1: 900, dur: 0.07, gain: 0.06, delay: 0.07 });
  },

  /** 任务成功：三音上行 */
  success() {
    const notes = [659.25, 880, 1174.66];
    notes.forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.22, gain: 0.14, delay: i * 0.1 }));
  },

  /** 出错：下行 */
  error() {
    tone({ type: 'sawtooth', f0: 330, f1: 210, dur: 0.28, gain: 0.07, lowpass: 1100 });
    tone({ f0: 220, f1: 130, dur: 0.34, gain: 0.1, delay: 0.04 });
  },

  /** 需要你确认：两声轻叩 */
  waiting() {
    tone({ type: 'triangle', f0: 880, dur: 0.09, gain: 0.1 });
    tone({ type: 'triangle', f0: 1046, dur: 0.09, gain: 0.09, delay: 0.13 });
  },
};
