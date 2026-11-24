# 反重力开机动画 (Antigravity Boot Animation)

Antigravity 自定义开机启动动画成品与软件内嵌星门过渡页。所有路径均支持跨电脑自动识别，不依赖任何本机固定目录。

## 仓库文件说明

| 文件 | 说明 |
| --- | --- |
| `反重力开场_Gemini单人版.mp4` | 1080p 30fps 双子星单人版开场动画（约 9.5 秒，含宇宙音景与“欢迎回来”人声） |
| `反重力开场_三AI娘同框版.mp4` | 1080p 30fps 三 AI 娘同框版开场动画（约 9.5 秒） |
| `boot-overlay.html` | 软件内嵌透明星门过渡页（含浏览器演示模式，按 `Esc` 可跳过） |
| `install-boot-animation.cjs` | 一键安装 / 切换版本 / 卸载脚本（仅依赖 Node.js 内置模块，无第三方依赖） |
| `build_cosmic_audio.py` | 宇宙氛围音景与人声混音脚本（如需自行重制音轨可使用） |

---

## 方式一：仅在浏览器中预览效果

下载或克隆本仓库后，直接用浏览器打开 `boot-overlay.html`，并在地址栏末尾加上参数即可预览（无需安装）：

- **预览 Gemini 单人版**：`boot-overlay.html?demo=1`
- **预览三 AI 娘同框版**：`boot-overlay.html?variant=trio&demo=1`
- **预览自定义星门内壁纸**：`boot-overlay.html?demo=1&wp=你的图片路径`

> 提示：按键盘 `Esc` 键可提前跳过播放；部分浏览器默认拦截带声音的自动播放，若演示时静音，点击页面或放行站点自动播放权限即可。

---

## 方式二：安装到 Antigravity 客户端（推荐）

### 前置条件
1. 已安装 **Node.js**（18 及以上版本即可）。
2. **彻底退出 Antigravity 客户端**（Windows 请按 `Ctrl+Q` 完全退出，确保后台进程已关闭）。
3. 建议将本仓库放在一个长期保存的固定目录（安装后播放时会直接读取该目录下的视频和网页文件，请勿删改位置）。

### 1. 克隆仓库并一键安装（默认 Gemini 单人版）

```bash
git clone https://github.com/haoranyuan73-cell/antigravity-boot-animation.git
cd antigravity-boot-animation
node install-boot-animation.cjs
```

### 2. 常用参数示例

- **安装“三 AI 娘同框版”**：
  ```bash
  node install-boot-animation.cjs --variant trio
  ```
- **在星门内展示你自己的壁纸**（不传 `--wallpaper` 时默认展示内置星空渐层与呼吸徽标）：
  ```bash
  node install-boot-animation.cjs --wallpaper "D:\Pictures\my-wallpaper.png"
  ```
- **手动指定 `app.asar` 路径**（如果你的软件没有装在默认路径）：
  ```bash
  node install-boot-animation.cjs --asar "C:\Your\Path\Antigravity\resources\app.asar"
  ```
- **卸载并恢复原始加载界面**：
  ```bash
  node install-boot-animation.cjs --uninstall
  ```

### 3. 开启启动自动有声播放（Windows 推荐）

Electron / Chromium 默认会在无用户点击时静音自动播放。为了让开机动画一启动就自带宇宙音效与“欢迎回来”语音，右键你的 Antigravity 桌面快捷方式 -> **属性** -> 在**目标 (Target)** 末尾加一个空格和以下参数：

```text
--autoplay-policy=no-user-gesture-required
```

---

## 方式三：自行重新合成音轨（可选）

如果你想替换自己的语音或微调背景音景，可以使用 `build_cosmic_audio.py`：

```bash
pip install numpy soundfile scipy
python build_cosmic_audio.py 你的语音.wav 输出音轨.wav
```

仅导出纯宇宙背景音效（不含人声）：

```bash
python build_cosmic_audio.py --no-voice cosmic_bed.wav
```

---

## 常见问题

- **Antigravity 客户端更新后开机动画没了怎么办？**  
  客户端版本更新会覆盖 `app.asar`，在仓库目录重新执行一次 `node install-boot-animation.cjs` 即可恢复。
- **安装安全吗？会破坏原文件吗？**  
  首次安装时脚本会自动在 `app.asar` 同级目录生成 `.bak-before-boot-animation` 原始备份，且写入前会做语法校验与原子替换；随时可通过 `--uninstall` 还原。
