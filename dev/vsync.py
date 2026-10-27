"""测 DWM 的合成节奏。DwmFlush 会阻塞到下一次合成完成，
连续调用之间的间隔就是屏幕真实的"帧到帧"时间。

165Hz 理论间隔 6.06ms。如果出现大量 12/18ms，说明合成掉了帧
（合成队列排不上），人手就会觉得"光标发飘、画面卡"。

用法：python dev/vsync.py [次数] [标签]
"""
import ctypes
import statistics
import sys
import time

dwmapi = ctypes.windll.dwmapi


def run(n, label):
    gaps = []
    prev = None
    bad = 0
    t_end = time.perf_counter() + 0.3
    while time.perf_counter() < t_end:      # 预热
        dwmapi.DwmFlush()
    for _ in range(n):
        hr = dwmapi.DwmFlush()
        now = time.perf_counter()
        if hr != 0:
            print(f"DwmFlush 失败 hr=0x{hr & 0xffffffff:08x}")
            return None
        if prev is not None:
            g = (now - prev) * 1000
            gaps.append(g)
            if g > 9.0:                     # 明显错过一个 vsync 周期
                bad += 1
        prev = now
    gaps.sort()
    p50 = statistics.median(gaps)
    p95 = gaps[int(len(gaps) * 0.95)]
    p99 = gaps[int(len(gaps) * 0.99)]
    fps = 1000 / p50 if p50 else 0
    print(f"{label:<24} n={len(gaps):<4} 中位 {p50:5.2f}ms({fps:5.1f}fps)  "
          f"p95 {p95:6.2f}  p99 {p99:6.2f}  max {gaps[-1]:6.2f}  "
          f"掉帧率 {bad * 100 / len(gaps):4.1f}%")
    return p50, p95, bad * 100 / len(gaps)


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    label = sys.argv[2] if len(sys.argv) > 2 else "当前状态"
    run(n, label)
