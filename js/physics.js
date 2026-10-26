// 拖拽 / 抛掷物理：纯计算，无 DOM。
// 逐条移植自 dsh-pet 0.3.7 的 src/shared/physics.ts（常量与公式保持一致），去掉多屏相关部分。

/** 拖拽弹簧刚度 */
export const SPRING_K = 200;
/** 拖拽弹簧阻尼：ζ ≈ 1.06，过阻尼不 overshoot */
export const SPRING_C = 30;

/** 拖拽轨迹保留窗口 ms */
export const TRAIL_KEEP_MS = 200;
/** 初速估算窗口 ms */
export const RELEASE_WINDOW_MS = 150;
/** 松手前停顿超过它 = 温柔放下 */
export const RELEASE_STALE_MS = 150;
/** 窗口太短视为不可估算 */
export const MIN_SPAN_MS = 20;
/** 分段速度最小 dt */
export const SEG_MIN_DT_MS = 8;
/** 低于此速度不抛（px/s） */
export const DEAD_ZONE_SPEED = 500;
/** 甩出速度软上限 */
export const MAX_THROW_SPEED = 3600;
/** 端点均值与窗口峰值的加权 */
export const PEAK_WEIGHT = 0.5;
export const ACCEL_REF = 8000;
export const ACCEL_GAIN_MAX = 0.6;

export const REST_VY = 40;
export const REST_VX = 15;
export const MAX_STEP_DT = 0.05;

/** Q 弹挤压 */
export const SQ_SQUASH = 0.55;
export const SQ_DURATION_MS = 220;
export const SQ_SOFT_SPEED = 300;
export const SQ_HARD_SPEED = 1500;
export const SQ_MAX_SQUASH = 0.55;

/** 落地冲击速度 → 下压幅度 */
export const landingSquash = (impactSpeed) => {
  const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
  return Math.min(0.8, 1 - t * (1 - SQ_MAX_SQUASH));
};

/** Q 弹曲线：u∈[0,1] → scaleY（下压 ease-in + 回弹 easeOutBack 过冲） */
export const squashScale = (u, squash = SQ_SQUASH) => {
  if (u < 0.45) {
    const p = u / 0.45;
    return 1 - (1 - squash) * p * p;
  }
  const p = (u - 0.45) / 0.55;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};

/** 过阻尼弹簧单轴速度步进 */
export const springStep = (v, x, target, dt, power = 1) =>
  v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;

const softClampSpeed = (speed) => (speed <= 0 ? 0 : MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED)));

/** 剔除超窗采样 */
export const trimTrail = (trail, now) => {
  const cutoff = now - TRAIL_KEEP_MS;
  let i = 0;
  while (i < trail.length && trail[i].t < cutoff) i++;
  return i === 0 ? trail : trail.slice(i);
};

/**
 * 由拖拽轨迹估算松手初速 (vx, vy) px/s。
 * 返回 null = 温柔放下（轨迹为空 / 停留过久 / 窗口太短 / 峰值低于死区）。
 */
export const estimateReleaseVelocity = (trail, now, physics) => {
  if (!trail.length) return null;
  const last = trail[trail.length - 1];
  if (now - last.t > RELEASE_STALE_MS) return null;
  const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
  if (win.length < 2) return null;
  const t0 = win[0].t, x0 = win[0].x, y0 = win[0].y;
  const t1 = win[win.length - 1].t, x1 = win[win.length - 1].x, y1 = win[win.length - 1].y;
  const spanMs = t1 - t0;
  if (spanMs < MIN_SPAN_MS) return null;
  const baseVx = ((x1 - x0) / spanMs) * 1000;
  const baseVy = ((y1 - y0) / spanMs) * 1000;
  const baseSpeed = Math.hypot(baseVx, baseVy);
  if (baseSpeed < 1e-6) return null;

  // 分段速度（过密采样合并，dt 下限 SEG_MIN_DT_MS）
  const segSpeeds = [];
  let px = x0, py = y0, pt = t0;
  for (const s of win.slice(1)) {
    const dt = s.t - pt;
    if (dt >= SEG_MIN_DT_MS) {
      segSpeeds.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, tEnd: s.t });
      px = s.x; py = s.y; pt = s.t;
    }
  }
  const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
  let accel = 0;
  if (segSpeeds.length >= 2) {
    const lastSeg = segSpeeds[segSpeeds.length - 1];
    const firstSeg = segSpeeds[0];
    accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1000, MIN_SPAN_MS / 1000);
  }
  const speedBeforeClamp =
    ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) *
    (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
  const speed = softClampSpeed(speedBeforeClamp) * (physics.throwPower ?? 1);
  if (speed < DEAD_ZONE_SPEED) return null;
  return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
};

/** 抛体单步积分 + 边界反弹 */
export const throwStep = (s, dtRaw, b, physics) => {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
  let { x, y, vx, vy } = s;
  vy += physics.gravity * dt;
  x += vx * dt;
  y += vy * dt;
  let bounced = false;
  if (x < b.minX) {
    x = b.minX; vx = Math.abs(vx) * physics.restitution; bounced = true;
  } else if (x > b.maxX) {
    x = b.maxX; vx = -Math.abs(vx) * physics.restitution; bounced = true;
  }
  if (y < b.minY) {
    if (physics.ceilingBounce) {
      y = b.minY; vy = Math.abs(vy) * physics.restitution; bounced = true;
    }
  } else if (y >= b.maxY) {
    y = b.maxY;
    vx *= Math.max(0, 1 - physics.groundFriction * dt);
    if (Math.abs(vy) < REST_VY) vy = 0;
    else vy = -Math.abs(vy) * physics.restitution;
    bounced = true;
  }
  const speed = Math.hypot(vx, vy);
  const atRest =
    (y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX) ||
    (bounced && speed < REST_VY && Math.abs(vy) < 1);
  return { x, y, vx, vy, bounced, atRest };
};
