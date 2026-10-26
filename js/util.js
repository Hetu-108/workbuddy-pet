// 抽签 / 权重选择：纯函数，移植自 dsh-pet 0.3.7 的 src/shared/pickers.ts

/** 等概率抽一个，exclude 避免连续重复 */
export const pick = (pool, exclude) => {
  const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)];
};

/** 事件档位取值：字符串原样，数组随机抽 1（尽量避开 exclude） */
export const pickSlot = (slot, exclude) => {
  if (typeof slot === 'string') return slot;
  const entries = exclude === undefined ? slot : slot.filter((n) => n !== exclude);
  const src = entries.length ? entries : slot;
  return src[Math.floor(Math.random() * src.length)];
};

export const slotIncludes = (slot, anim) =>
  typeof slot === 'string' ? slot === anim : slot.includes(anim);

/** 按权重在分类池中选一个；noMirror 分类在朝右时排除，剩余权重自动归一化 */
export const pickWeightedCategory = (categories, facing) => {
  const cats = categories.filter((c) => c.actions && c.actions.length);
  if (!cats.length) return null;
  const filtered = cats.filter((c) => !(c.noMirror && facing === 'right'));
  const eligible = filtered.length ? filtered : cats;
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * totalW;
  for (const c of eligible) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return eligible[eligible.length - 1];
};

/**
 * 按权重掷骰 → 下一个动画类别。
 * fixed=true 时 turn/move 权重按 0 算（份额自然落到随机小动作）。
 */
export const rollKind = (roll, w, opts) => {
  const turn = opts && opts.fixed ? 0 : w.turn;
  const move = opts && opts.fixed ? 0 : w.move;
  const topEnd = (w.idle + turn + move) / 100;
  if (roll < w.idle / 100) return 'idle';
  if (roll < (w.idle + turn) / 100) return 'turn';
  if (roll < topEnd) return 'move';
  return 'action';
};

/** 从分类池选一个动作；无可用分类时回退 idle 池 */
export const pickCategoryAction = (categories, idlePool, facing, current) => {
  const cat = pickWeightedCategory(categories, facing);
  if (!cat) return { id: 'FALLBACK', name: pick(idlePool, current) };
  return { id: cat.id, name: pick(cat.actions, current) };
};

/** [min, max) 随机整数 */
export const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));

/** 限制在区间内 */
export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
