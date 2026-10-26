# 大肥鱼 · WorkBuddy 桌宠

把 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（v0.3.7，DeepSeek Harness 插件）的桌宠搬到了 WorkBuddy：
同一套大肥鱼素材、同一套动画链与抛掷物理、同一套右键点播，换成本地网页 + 零依赖 Node 桥，并且**跟着 WorkBuddy 的会话状态动**。

![预览](preview.png)

## 桌面版（就是你现在看到的这个）

```
双击  启动桌宠.vbs      ← 平时用这个，无窗口静默启动
双击  启动桌宠.bat      ← 调试用，能看到日志
```

> **clone 下来第一次跑，要先补一个 Electron（仓库里没有）**
>
> `runtime/` 是 325MB 的运行时，被 `.gitignore` 排除。下载 [Electron v38.8.6](https://github.com/electron/electron/releases/tag/v38.8.6)
> 的 `electron-v38.8.6-win32-x64.zip`，解压到 `runtime/electron/`（解压后该目录下应直接是 `electron.exe`），
> 再双击 `启动桌宠.vbs` 即可。想换版本，记得到 `desktop/main.cjs` 里确认没有用到新 API。

- 铺满工作区的**透明置顶窗口**，切到任何程序它都在；跳过任务栏，不抢焦点
- 整窗**鼠标穿透**，只有光标落在鱼身上才接管，桌面其余位置照常点
- 鱼可以在**整个屏幕**乱走 / 飘到半空；抓起随便扔，撞边反弹落地 Q 弹
- 托盘图标：显示/隐藏、回家、说句话、开机自启、退出
- 快捷键：`Ctrl+Alt+P` 藏起来 / 叫出来，`Ctrl+Alt+Q` 退出
- 关掉窗口不会丢：单实例，重复双击只会把已有的叫出来

### 常驻（已配好）

桌宠交给 Windows **计划任务 `WBPet`** 托管，登录后自动启动，跟当前会话/任务切换无关，关掉 WorkBuddy 也在。

```powershell
# 立即启动
Start-ScheduledTask -TaskName "WBPet"
# 看状态
Get-ScheduledTask -TaskName "WBPet"
# 彻底移除（连同托盘退出）
Unregister-ScheduledTask -TaskName "WBPet" -Confirm:$false
```

之所以必须由计划任务拉起：从编辑器/终端里直接起的子进程会随宿主会话一起被回收，鱼才会「过一会儿就没了」。计划任务由系统服务拉起，独立于任何会话。

### 自动召唤（你重开 WorkBuddy 时它会自己回来）

第二个计划任务 `WBPet-Watch` 每 5 分钟瞄一眼（单次约 1 秒，几乎不占资源），规则只有三条：

| 情况 | 行为 |
| --- | --- |
| 你重开了一次 WorkBuddy，而桌宠不在 | **自动召唤回来**（一般 5 分钟内出现） |
| 你自己点了托盘「退出」/ `Ctrl+Alt+Q` | **一概不动**，直到下次重开 WorkBuddy |
| 桌宠已经在跑（绝大多数时候） | 什么都不做，直接退出 |

「主动退出」会写一个标记到 `%LOCALAPPDATA%\wb-pet\quit.flag`，看门狗看到它就收手；检测到 WorkBuddy 是**新的一次会话**（进程启动时间变了）才把标记清掉。崩溃 / 被 taskkill 不会写这个标记，所以那种情况会被自动救回。

```powershell
# 看它在干什么（最近 300 条）
Get-Content "$env:LOCALAPPDATA\wb-pet\watchdog.log" -Tail 20
# 临时停掉自动召唤
Disable-ScheduledTask -TaskName "WBPet-Watch"
# 现在就叫一次
Start-ScheduledTask -TaskName "WBPet"
```

嫌 5 分钟太慢想改快/改慢：重新注册时把 `-RepetitionInterval` 换掉即可（别低于 2 分钟，收益很小）。

网页版仍然可用（`start.bat` 或 `node wb-pet.mjs up`），方便调试与换素材。

---

## 一、它现在会做什么

| 能力 | 说明 |
| --- | --- |
| 100+ 透明动画 | `assets/webm/` 里 106 段 VP9-alpha 动画，随时待机呼吸、玩魔方、涮火锅、打瞌睡 |
| 动画链 | 每段播完按权重抽下一个（idle 10 / 转向 5 / 移动 5 / 随机小动作 80），双缓冲交叉淡入不闪黑 |
| 屏幕漫游 | 桌面模式下可飘到屏幕任意位置（含半空），多数时候仍贴着底边晃；走到边上会自己换方向，不会走出屏幕 |
| 只吃自己那一块鼠标 | 窗口铺满全屏但默认穿透。命中的是**角色真实轮廓**（每段动画一张 64×36 的 alpha 掩码，见 `js/hitmask.js`），不是矩形：实测覆盖 98.5% 的角色像素、误吞 2.1%，比原来的矩形少了四成左右的"透明死区"，光标从鱼旁边划过不会挡住下面的窗口 |
| 拖 / 甩 | 弹簧跟手（K=200 C=30），松手按轨迹估初速，抛物线飞 + 边墙地面反弹 + 落地 Q 弹压扁 |
| 点击回应 | 5 种点击动画随机播，配 Q 弹挤压 + 对应音效 |
| 音效 | WebAudio 现场合成：点击「啵」、开心上行双音、傲娇下滑、扔出去「咻」、落地闷响、完成三连音、出错下行（菜单里可开关） |
| 右键点播 | 多级菜单：待机 / 转向 / 拖拽 / 点击回应 / 移动 / 小动作 / 玩耍 / 吃什么 / 时节 / 文字 / 工作状态 / 碎碎念，全部可单独点播；**子级一律向右级联**，右边真放不下才翻到整个级联的左侧，绝不压住父面板、也不往下方堆 |
| 表情包 | 27 张官方表情包，碎碎念随机配图，菜单里也能直接挑一张 |
| 工作状态联动 | 思考 / 忙碌 / 整理 / 等待 / 完成 / 出错 六档专属动画 + 头顶气泡，接 WorkBuddy 钩子后全自动 |
| 碎碎念 | 默认 5 分钟一句（本地文案池），也可由外部推送任意句子 |

## 二、怎么让它跟着 WorkBuddy 动

三种方式，任选：

**1. 钩子自动联动（可选，未默认开启）**

> 注意：WorkBuddy 官方文档目前没有 hooks 章节，`~/.workbuddy/settings.json` 里也还没有 `hooks` 字段。安装器按 Claude Code 的 hooks 格式写，**未在 WorkBuddy 上实测生效**，所以我没有默认装。想试就自己跑一下（会先备份 settings.json，可一条命令撤销）。

```bash
node install-hooks.mjs     # 写进 ~/.workbuddy/settings.json，自动备份
```

挂上之后一轮任务里的关键节点会自动推状态：

| WorkBuddy 事件 | 桌宠状态 | 动画 |
| --- | --- | --- |
| UserPromptSubmit | thinking | 工作状态-思考冒泡 |
| PreToolUse（每次工具调用） | working | 工作状态-忙碌点按 |
| PostToolUse | result | 工作状态-清点归档 |
| Notification（要你确认） | waiting | 工作状态-原地踱步张望 |
| Stop（本轮结束） | success | 工作状态-雀跃庆祝 |

卸载：`node install-hooks.mjs --remove`。

**2. 命令行手动推**

```bash
node wb-pet.mjs state working        # thinking|working|result|waiting|success|error|idle
node wb-pet.mjs say "这行我改好了"    # 说一句（可 --image 表情包名）
node wb-pet.mjs anim "写代码"         # 点播动画
node wb-pet.mjs move "螃蟹走路"       # 走一段
node wb-pet.mjs whisper              # 立即碎碎念
node wb-pet.mjs roam                 # 全屏随便飞一下
node wb-pet.mjs home                 # 叫回右下角
```

**3. HTTP / 控制台**

```bash
curl -X POST http://127.0.0.1:7715/api/state -H "content-type: application/json" -d "{\"state\":\"working\"}"
curl -X POST http://127.0.0.1:7715/api/say   -H "content-type: application/json" -d "{\"text\":\"喝口水吧\",\"image\":\"可爱\"}"
```

页面里也有 `window.wbPet.state('success')` / `say()` / `anim()` / `whisper()` 可直接调。

接口一览：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/info` | 版本 + 表情包清单 |
| GET | `/api/events` | SSE 事件流（页面自动连） |
| GET/POST | `/api/state` | 读 / 写工作状态 |
| POST | `/api/say` | 气泡说话（`text` / `image` / `ms`） |
| POST | `/api/anim` | 点播动画（`name`，加 `move:true` 走一段） |
| POST | `/api/whisper` | 立即碎碎念 |
| POST | `/api/roam` | 全屏随便飞一下（飘到随机位置） |
| POST | `/api/home` | 回到右下角初始位置并恢复待机 |
| POST | `/api/refresh` | 让页面刷新配置 |

服务只监听 `127.0.0.1:7715`（`--port` 可改），不对外。

## 三、配置

全在 `js/config.js`：

- `pets[]`：`size`（宽度 px，高度自动 ×9/16）、`position.corner/marginX/marginY`、`fixedEnabled`（true = 不再自己走开）、`workStatusEnabled`、`whisperEnabled`
- `physics`：重力 / 弹性 / 地面摩擦 / 顶边反弹 / 总力度
- `animations`：各动作池、行走参数（距离、首尾静止秒数）、随机分类与权重、事件档位
- `animationWeights`：随机链权重（三项 + 各分类合计 = 100）
- `workStatusTexts` / `whisperLines`：气泡文案
- `sound`：`enabled` / `volume`（0~1），音效全部是 WebAudio 合成，没有音频文件
- `animations.moves.roamChance`：桌面模式下"移动"改成全屏漫游的概率（默认 0.4，其余仍贴底边左右走）
- 想换宠物形象：把新的 16:9 绿幕动画转成 VP9-alpha `.webm`，文件名保持一致丢进 `assets/webm/` 即覆盖

`?bg=1` 打开带壁纸的独立窗口观感，默认背景透明（适合放预览面板 / 叠加层）。`?menu=1` 直接展开右键菜单，方便截图排查。

## 四、和原版的差异（说清楚，不藏）

原版是 DSH（Cordis）插件，宿主半侧 + React 客户端半侧 + Electron 透明窗。这版是独立网页 + Node 桥：

- **保留**：素材、动画链权重与抽签逻辑、移动规划（leadSec/tailSec 与距离缩放）、弹簧跟手、抛掷初速估算（峰值加权 + 加速度增益 + 软钳速）、反弹与落地 Q 弹曲线、点击回应、九级右键菜单、六档工作状态、气泡几何（全部按 `--pet-size` 等比缩放）
- **没做**：余额钱包、AI 碎碎念/对话（原版调 DSH 的模型，这边换成可外部推送 + 本地文案池）、多宠物互撞、多显示器（只铺主屏工作区）
- **新增**：Electron 透明置顶桌面壳（托盘 / 快捷键 / 单实例 / 开机自启）、鼠标穿透与悬停接管、全屏漂浮漫游、WebAudio 合成音效、SSE 事件通道、WorkBuddy 钩子安装器、CLI
- **一处与原版不同的取舍**：原版是「窗口跟着宠物走」的局部小窗（它的注释里提到全屏透明置顶窗在某些机器上会触发 DWM 视频合成黑屏）。这版直接铺满工作区，透明 + 默认穿透，实测游戏/视频正常；若哪天遇到黑屏，把 `desktop/main.cjs` 改成小窗跟随即可

## 五、排查与调试

几个容易误会的地方先说清：

- **预览面板里也有只鱼？** 那不是残影。用 `http://127.0.0.1:7715/?bg=1` 在浏览器/预览面板里打开时，是**另一个独立的页面实例**，它有自己的动画链，位置也不同。真实桌面上只有一只，位置以桌面那只为准。关掉那个标签页即可。
- **任务栏里找不到它？** 故意的：`skipTaskbar: true`，入口在右下角托盘图标。
- **CPU 占用偏高？** 这台机器 Chromium 拿不到可用 GPU，回落到 SwiftShader 软件渲染，铺满屏幕的透明合成 + VP9-alpha 解码都要 CPU，实测约 30% 单核 / 130MB 内存。有独显的机器会自动走硬件路径，会低很多。
- **关掉 WorkBuddy 它还在？** 对，计划任务托管，独立于 WorkBuddy。不想要就卸计划任务 + 托盘退出。

调试工具（`dev/`，靠 DevTools 协议，只在本机）：

```bash
# 先带调试端口重启（临时改计划任务参数即可）
#   ... electron.exe "...\desktop" --cdp-port=9222
node dev/probe.mjs                 # 读页面真实状态：宠物数量、视频位置、坐标
node dev/probe.mjs "window.wbPet.say('测试')"   # 在页面里执行任意表达式
node dev/pageshot.mjs out.png      # 只截窗口自身（不受桌面合成影响）
```

`--selftest` 会跑一遍自检并截图（`--click` 测点击与音效、`--menu` 测级联菜单坐标、`--roam` 测漫游）。

### 命中掩码（`js/hitmask.js` 是自动生成的）

换素材、加动画之后，掩码要重算，否则新动画会退回"并集"掩码（会偏胖一点，但仍比矩形准）：

```bash
# 采样全部 106 段 webm 的 alpha，重写 js/hitmask.js（约 2~3 分钟）
runtime/electron/electron.exe dev/measure.cjs --all
```

判据是"过半采样帧都有内容 + 单帧覆盖率 > 15%"，所以角色跳起来/伸懒腰时的极端姿态不会被算进去；
过于稀疏的掩码会被自动丢弃（那段动画回退到全动画并集，保证抓得住）。

### 性能采样（`dev/perf.cjs`）

开一个和正式桌宠同配置的透明置顶窗，分阶段量化帧率、longtask、换动画加载耗时，
并对气泡的 `backdrop-filter` 做 A/B：

```bash
runtime/electron/electron.exe dev/perf.cjs                     # 全流程
runtime/electron/electron.exe dev/perf.cjs --only=hit          # 只校验命中掩码
runtime/electron/electron.exe dev/perf.cjs --only=stall --win=small   # 长任务定位 / 小窗对照
```

这台机器（165Hz）实测：待机 p50 6.1ms、漫游 p50 6.1ms，气泡带 `backdrop-filter` 时
每次出现都会掉一帧到 ~90ms，去掉后 0 掉帧。

**已知且暂不改的一点**：全屏透明窗在持续快速漫游时，大约每 20~40 秒会有一次 ~200ms 的合成器停顿
（`dev/perf.cjs --only=stall` 可复现，换成 620×380 小窗则完全不出现）。这是"整屏 per-pixel alpha
分层窗"在 Windows 上的合成开销，不是 JS 逻辑问题；要根治得改成"小窗跟着宠物走"，会牺牲拖拽手感，
所以留在现状。

## 六、许可与出处

- 代码思路来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT），动画素材与提示词随仓库开放、**禁止商用**；
- 形象「大肥鱼 / 溟月」：CC BY-NC-SA 4.0（署名 · 非商业 · 相同方式共享），非 DeepSeek 官方，原型出自 B 站 @上善无形，DeepSeek 版设计出自 B 站 @ZipZipPipe。
- 个人使用、二次创作请保留上述署名；商用请自行取得授权。
