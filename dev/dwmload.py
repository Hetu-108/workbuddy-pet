"""对照实验：测 DWM / csrss / electron 各自吃掉多少 GPU 合成时间。

用法：
  python dev/dwmload.py sample A        # 只采样当前状态
  python dev/dwmload.py ab             # A(鱼在) -> 杀 -> B(无鱼) -> 重启 -> C

为什么要测这个：透明置顶窗口会让 Windows 放弃多平面叠加（MPO），
把所有内容改走 DWM 全屏合成。这时光标刷新、窗口动画都排在同一个
合成队列里，核显一旦跟不上，人手就感觉"鼠标发飘"。
"""
import csv
import io
import os
import subprocess
import sys
import time

COUNTER = r"\GPU Engine(*)\Utilization Percentage"


def pid_names():
    out = subprocess.run(
        ["tasklist", "/FO", "CSV", "/NH"], capture_output=True
    ).stdout.decode("gbk", errors="replace")
    m = {}
    for row in csv.reader(io.StringIO(out)):
        if len(row) >= 2:
            try:
                m[int(row[1])] = row[0].lower().replace(".exe", "")
            except ValueError:
                pass
    return m


def sample(seconds=6):
    """跑 seconds 秒采样，返回 {进程名: 平均利用率%}，以及引擎细分。"""
    tmp = os.path.join(os.environ.get("TEMP", "."), "_gpu_sample.csv")
    if os.path.exists(tmp):
        os.remove(tmp)
    subprocess.run(
        ["typeperf", COUNTER, "-sc", str(seconds), "-si", "1", "-f", "CSV", "-o", tmp],
        capture_output=True,
    )
    names = pid_names()
    with open(tmp, "r", encoding="utf-8", errors="replace") as f:
        rows = list(csv.reader(f))
    if len(rows) < 2:
        return {}, {}, 0

    header = rows[0][1:]  # 第 0 列是时间戳
    data = rows[1:]
    # 每列的 pid / engtype
    cols = []
    for h in header:
        pid = eng = None
        for tok in h.split("(")[-1].split(")"):
            pass
        seg = h.split("GPU Engine(")[-1].split(")")[0] if "GPU Engine(" in h else ""
        for part in seg.split("_"):
            if part.isdigit() and pid is None:
                pid = int(part)
        if "engtype_" in seg:
            eng = seg.split("engtype_")[-1]
        cols.append((pid, eng))

    agg = {}
    engagg = {}
    for r in data:
        if len(r) < 2:
            continue
        for i, v in enumerate(r[1:]):
            if i >= len(cols):
                break
            pid, eng = cols[i]
            try:
                val = float(v)
            except ValueError:
                continue
            if val <= 0 or pid is None:
                continue
            nm = names.get(pid, f"pid{pid}")
            agg[nm] = agg.get(nm, 0.0) + val
            if nm in ("dwm", "csrss", "electron", "wallpaperui"):
                key = f"{nm}/{eng}"
                engagg[key] = engagg.get(key, 0.0) + val
    n = max(1, len(data))
    return ({k: v / n for k, v in agg.items()},
            {k: v / n for k, v in engagg.items()},
            len(data))


def show(tag):
    agg, engagg, n = sample()
    print(f"--- {tag}  ({n} 个采样点) ---")
    top = sorted(agg.items(), key=lambda kv: -kv[1])[:6]
    for k, v in top:
        print(f"   {k:<18} {v:6.1f}%")
    if engagg:
        print("   细分:", ", ".join(f"{k}={v:.1f}%" for k, v in
                                   sorted(engagg.items(), key=lambda kv: -kv[1])[:6]))
    return agg


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sample"
    tag = sys.argv[2] if len(sys.argv) > 2 else "当前"
    if mode == "sample":
        show(tag)
    else:
        show("A 鱼在运行")
        subprocess.run(["taskkill", "/IM", "electron.exe", "/F"], capture_output=True)
        time.sleep(6)
        show("B 鱼已退出")
        subprocess.run(["schtasks", "/RUN", "/TN", "WBPet"], capture_output=True)
        time.sleep(15)
        show("C 鱼重新启动")
