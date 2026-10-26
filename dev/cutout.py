"""把白底立绘抠成透明 PNG，并从角色像素里提取一套配色。

用法：python dev/cutout.py
产物：docs/pet.png（角色，透明底）、docs/logo-cut.png（Ciallo 贴纸）、
      终端打印主色（十六进制），供设计 token 使用。
"""
import os
from collections import Counter, deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
os.makedirs(DOCS, exist_ok=True)


def cutout(src, dst, white_thresh=236):
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape

    # 近白像素：三通道都高，且通道间差异小（排除浅蓝等浅色主体）
    near_white = (
        (a[:, :, 0] >= white_thresh)
        & (a[:, :, 1] >= white_thresh)
        & (a[:, :, 2] >= white_thresh)
        & (a.max(axis=2) - a.min(axis=2) <= 12)
    )

    # 从四条边向内做泛洪，只吃掉与外界连通的白色，角色内部的白色（围裙/蕾丝）保留
    bg = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))

    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # 只把边界羽化半像素消锯齿。不要按"有多白"再压 alpha —— 那样会把白色蕾丝/围裙
    # 一起打薄，放到深色底上会露出背景（第一版就踩了这个坑）
    alpha_img = Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(0.7))

    out = im.convert('RGBA')
    out.putalpha(alpha_img)
    out = out.crop(out.getbbox())
    out.save(dst)
    return out


def palette(im, k=8):
    px = np.asarray(im)
    opaque = px[px[:, :, 3] > 200][:, :3]
    # 去掉接近白的（高光/围裙）与接近纯黑的，看真正的品牌色
    mask = (opaque.max(axis=1) < 246) & (opaque.min(axis=1) > 8)
    data = opaque[mask]
    q = (data // 16 * 16)
    cnt = Counter(map(tuple, q))
    return [('#%02x%02x%02x' % c, n) for c, n in cnt.most_common(k)]


pet = cutout(os.path.join(ROOT, 'preview.png'), os.path.join(DOCS, 'pet.png'))
print('pet.png    ', pet.size)
logo = cutout(os.path.join(ROOT, 'assets', 'logo.png'), os.path.join(DOCS, 'logo-cut.png'), white_thresh=232)
print('logo-cut.png', logo.size)
print('\n主色：')
for hexv, n in palette(pet):
    print('  ', hexv, n)
