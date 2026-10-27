// 对话：把「洛书」的大脑接到这只鱼身上。
//
//   输入条 ──POST api/chat──> 本地桥 ──转发──> 洛书的 pet_bridge ──> Ollama
//                                       <── {say, emotion, action}
//
// 三条必须做对的细节：
//   1. 窗口默认鼠标穿透，输入条要能点，就得临时 lockInteractive(true)，关掉再放开；
//   2. 本地小模型要 1~10 秒，等待期间必须给反馈（思考动画 + 「……」），不能一声不吭；
//   3. 脑子没接上时要说人话，而不是静默失败。

import { lockInteractive } from './desktop.js';

const pet = () => (window.__pets && window.__pets[0]) || null;

export function initChat(app) {
  const cfg = app.chat || {};
  if (cfg.enabled === false) return null;

  const EMO = cfg.emotionAnim || {};
  const ACT = cfg.actionAnim || {};
  const BUBBLE_MS = cfg.bubbleMs || 14000;

  // ---------------- DOM ----------------
  const root = document.createElement('div');
  root.className = 'pet-chat';
  root.innerHTML = `
    <form class="pet-chat-bar" autocomplete="off">
      <input class="pet-chat-input" type="text" maxlength="200" spellcheck="false" />
      <button class="pet-chat-btn" type="submit" title="发送">说</button>
    </form>
    <div class="pet-chat-tip"></div>`;
  document.body.appendChild(root);

  const form = root.querySelector('.pet-chat-bar');
  const input = root.querySelector('.pet-chat-input');
  const btn = root.querySelector('.pet-chat-btn');
  const tip = root.querySelector('.pet-chat-tip');

  input.placeholder = cfg.placeholder || '跟她说点什么…';
  const TIP_IDLE = `Enter 发送 · Esc 关闭 · ${cfg.hotkeyLabel || 'Ctrl+Alt+L'} 随时唤起`;

  let busy = false;
  let lastAct = Date.now();
  let lastSent = '';
  let actTimer = 0;

  const touch = () => { lastAct = Date.now(); };
  const setTip = (t) => { tip.textContent = t || TIP_IDLE; };

  // ---------------- 开 / 关 ----------------
  function open(prefill) {
    root.classList.add('is-on');
    lockInteractive(true);          // 否则整窗还在穿透状态，输入框点不到
    try { window.wbDesktop && window.wbDesktop.focus && window.wbDesktop.focus(); } catch { /* noop */ }
    if (prefill) input.value = prefill;
    setTip('');
    requestAnimationFrame(() => { try { input.focus(); input.select(); } catch { /* noop */ } });
  }

  function close() {
    root.classList.remove('is-on');
    try { input.blur(); } catch { /* noop */ }
    lockInteractive(false);         // 交还鼠标，继续穿透到桌面
  }

  const isOpen = () => root.classList.contains('is-on');

  // ---------------- 回复落地 ----------------
  function apply(d) {
    const p = pet();
    if (!p || !d) return;
    const say = String(d.say || '').trim();
    if (say) p.say(say, null, BUBBLE_MS);

    const emoAnim = EMO[d.emotion] || EMO.idle;
    const actAnim = ACT[d.action];
    if (emoAnim) p.switchTo(emoAnim, true);
    // 有额外交代的小动作时，稍等一拍再补一个，看起来像「说完才反应过来」
    if (actAnim && actAnim !== emoAnim) {
      clearTimeout(actTimer);
      actTimer = window.setTimeout(() => { if (pet()) pet().switchTo(actAnim, true); }, 1800);
    }
  }

  // ---------------- 发送 ----------------
  async function send(raw) {
    const text = String(raw == null ? input.value : raw).trim();
    if (!text) return;
    if (busy) return;

    busy = true;
    lastSent = text;
    touch();
    input.value = '';
    input.disabled = true;
    btn.disabled = true;
    setTip('她在想…');

    // 等待反馈：先给个「……」和思考动作，别让桌面看起来卡死了
    const p = pet();
    if (p) {
      p.say('……', null, 0);
      if (EMO.think) p.switchTo(EMO.think, false);
    }

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), cfg.timeoutMs || 120000);
    try {
      const res = await fetch(cfg.endpoint || 'api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);

      if (data && data.ok && data.say) {
        apply(data);
        close();
        setTip('');
      } else if (data && data.error) {
        throw new Error(data.error);
      } else {
        throw new Error('返回内容看不懂');
      }
    } catch (e) {
      const msg = String((e && e.message) || e);
      const timeout = e && e.name === 'AbortError';
      if (pet()) {
        pet().say(
          timeout ? '想太久了，我放弃了。等下再说？' : '我这边没接上（脑子不在）。',
          null, 9000,
        );
        if (EMO.sleepy) pet().switchTo(EMO.sleepy, true);
      }
      setTip(timeout ? '超时了：模型可能在冷启动，再试一次' : '没连上大脑：先跑 pet_bridge.py');
      console.warn('[wb-pet] chat 失败', msg);
    } finally {
      window.clearTimeout(timer);
      busy = false;
      input.disabled = false;
      btn.disabled = false;
      touch();
      if (isOpen()) {
        requestAnimationFrame(() => { try { input.focus(); } catch { /* noop */ } });
      }
    }
  }

  // ---------------- 主动说话（可选） ----------------
  // 开了这个就把本地碎碎念关掉，否则两套「自己开口」的逻辑会打架，
  // 而且本地那批文案是「主人」口吻，跟洛书的人设对不上。
  const proactiveMs = Number(cfg.proactiveMs || 0);
  if (proactiveMs > 0) {
    for (const p of window.__pets || []) {
      if (p.whisperTimer) { clearTimeout(p.whisperTimer); p.whisperTimer = 0; }
      p.cfg.whisperEnabled = false;
    }
  }

  async function nudge() {
    const p = pet();
    if (!p) return;
    const idle = Math.round((Date.now() - lastAct) / 1000);
    try {
      const res = await fetch(cfg.nudgeEndpoint || 'api/chat/nudge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idle }),
      });
      const d = await res.json();
      if (d && d.ok && d.say) {
        p.say(d.say, null, 9000);
        const a = EMO[d.emotion];
        if (a) p.switchTo(a, true);
        return;
      }
    } catch { /* 落到下面的本地兜底 */ }
    if (p.whisper) p.whisper();
  }

  if (proactiveMs > 0) {
    window.setInterval(() => {
      if (busy || isOpen()) return;
      if (Date.now() - lastAct < proactiveMs) return;
      lastAct = Date.now();
      nudge();
    }, 30000);
  }

  // ---------------- 事件 ----------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowUp' && !input.value) { e.preventDefault(); input.value = lastSent; return; }
  });

  // 点到窗外就收起来（点发送按钮不算）
  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!isOpen()) return;
      const el = document.activeElement;
      if (el && root.contains(el)) return;
      close();
    }, 150);
  });

  const api = { open, close, send, apply, get busy() { return busy; } };
  window.wbChat = api;
  return api;
}
