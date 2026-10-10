# 浮光 · Particle Bloom

六种由细小光点组成的花：牡丹、玫瑰、莲花、向日葵、郁金香与百合。透明容器、花瓣、叶脉与星尘在浏览器里实时生成。打开右手，粒子聚合成花；握拳，花朵重新散入光中。无需摄像头即可选择花型、拖动旋转和演示聚散。

这是依据交互概念独立制作的原创实现，不包含参考视频的代码、人物影像或素材。

## 本地运行

要求 Node.js 22.12+（或 20.19+）。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址。正式构建与检查：

```sh
npm run check
npm run build
npm run preview
```

静态产物位于 `dist/`，可以放到支持 HTTPS 的静态服务器。所有依赖在 `package-lock.json` 中锁定。GitHub 仓库上传不等同于开启 GitHub Pages；部署需要另行配置。

## 操作

| 输入 | 效果 |
| --- | --- |
| 花型选择器 | 星尘散开后重新聚合成所选花型；连续选择以最后一次为准 |
| 鼠标 / 单指拖动 | 旋转花朵 |
| 滚轮 / 双指缩放 | 调整大小 |
| 绽放 / 星散 | 聚合 / 散开 |
| 自动流转 | 连续聚散演示 |
| 右上角“画质设置”中的“粒子质量” | 自动适配，或手动选择细腻 / 平衡 / 轻盈 |
| 空格 | 切换聚散 |
| R | 重置视角 |
| H | 隐藏 / 显示界面 |
| 右手张开 | 聚合绽放 |
| 右手握拳 | 散开并复位 |
| 右手手腕转动 | 旋转 |
| 左手开合 | 调整大小 |
| 拇指与食指靠拢 | 光带扫描 |

手势是左右手的解剖学方向，不是屏幕左右。正面摄像头预览采用镜像显示。光线明亮、手掌完整入镜时效果更稳定。摄像头不可用时仍可使用全部鼠标、触控和按钮交互。

## 摄像头与隐私

- 初始页面不会请求摄像头。
- 只有点击“开启手势交互”后才会请求浏览器授权；不请求麦克风。
- 摄像头帧通过 MediaPipe 在当前浏览器本机处理，不录制、不上传。
- 摄像头需要 HTTPS 或 localhost。
- 停止交互、离开页面、识别中断时，程序会停止媒体轨道。
- 识别模型与 WebAssembly 属于下载资源，不是云端识别接口。

## 技术与画质

Three.js + WebGL 2 + Vite，无后端、无账号、无分析跟踪。

花瓣、叶片、花心和枝茎均由固定随机种子的参数曲面采样生成。六种花拥有独立的花冠几何：牡丹多层卷瓣；玫瑰紧密螺旋与外翻瓣；莲花尖瓣、莲蓬与宽叶；向日葵辐射长瓣、深色花盘和螺旋种子；郁金香六瓣杯形、修长茎叶；百合反卷长瓣、花蕊与金色花药。它们不是同一几何的换色。

GPU 顶点着色器执行错峰聚散、呼吸和扫描；透明度保真的后处理提供柔和辉光。切换状态由单一帧循环驱动，只在完全散开时更新目标几何，复用着色器材质并释放旧几何。切换中的手势和按钮仍可更新最终聚散、旋转及缩放意图；画质变化不会重置花型或切换进度。“自动适配”根据设备尺寸和持续帧率调整质量档位与像素密度；手动档位为细腻（100,000 粒子）、平衡（60,000）和轻盈（28,000）。

页面实时响应系统“减少动态效果”设置：停止环境转动、呼吸和自动流转，直接呈现所选花型，保留手动聚散、拖动和缩放。浏览器性能、温度、摄像头与识别模型会共同影响帧率；软件渲染的测试环境不能代表真实 GPU 性能。

## 项目结构

- `src/flower.js`：确定性植物粒子采样
- `src/flower-transition.js`：连续选择、聚散意图与减弱动态效果的帧驱动状态
- `src/shaders.js`：GPU 运动与点精灵渲染
- `src/hands.js`：摄像头生命周期、MediaPipe 与手势状态
- `src/main.js`：场景、交互与页面整合
- `src/alpha-bloom.js`：保持镜头背景可见的透明辉光
- `tests/`：几何、手势、生命周期与渲染辅助逻辑测试

## 验证边界

自动测试覆盖数学逻辑、数据完整性、拒绝权限与取消启动等生命周期。真实双手识别的左右方向、不同摄像头、移动设备热量与 Safari 兼容性仍应在目标设备验收。任何未进行的实机验证都不会被表述为已通过。

## 许可

本项目尚未为原创源码选择开源许可；公开可见不等同于授予再分发许可。第三方库、识别模型与各自许可见 `THIRD_PARTY_NOTICES.md`。不随项目分发参考人物的影像。

### 识别资源离线部署

默认从同源路径加载 `public/vendor/mediapipe/wasm/` 与 `public/models/hand_landmarker.task`，不会在运行时访问 Google 或 jsDelivr。构建会复制这些资源到 `dist/`。首次打开仍须下载这些本机推理资源（约 30.3 MB，实际按浏览器选择所需 WASM）。缓存后，是否可以完全离线刷新取决于静态服务器的缓存策略；本项目不宣称具备离线 PWA。

如果你的部署确实需要自定义资源地址，可在构建前设置 `VITE_MEDIAPIPE_WASM_URL` 与 `VITE_MEDIAPIPE_MODEL_URL`。默认不设置。官方模型 SHA-256：`fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`。

### 浏览器验收

```sh
npx playwright install chromium
npm run build
npm run test:browser
```

该可复现验收覆盖桌面/移动视口、重复聚散、质量切换、快捷键、摄像头拒绝权限及截图。受限容器可能无法启动 Chromium；此时仅报告 Node 测试和构建已通过，并使用允许的实际浏览器完成视觉检查，不把未运行的浏览器套件计为通过。

### 离线着色器研究图

`artifacts/offline-shader-study.png` 是由实际粒子缓冲区和轻量适配后的 GLSL 经 EGL/llvmpipe 生成的研究图，展示正面、30°/60°、聚散中间态与背面结构。它不是浏览器截图；不代表浏览器 UI、摄像头叠加、Three.js 辉光后处理或真实移动 GPU 性能验证。

复现命令：

```sh
python -m venv .venv-render
. .venv-render/bin/activate
pip install -r tools/requirements-render.txt
node tools/export-study.mjs /tmp/particle-bloom-study
python tools/render-study.py /tmp/particle-bloom-study artifacts/offline-shader-study.png
```

离线渲染需要可用的 EGL 实现；应用本身不依赖 Python。

## 预构建版 / Windows 启动器

面向直接体验的发布包包含 `Start.cmd`、完整静态产物与本地手势模型。它只使用已有 Node.js 或 Python 3 启动回环地址服务，不自动安装、不向局域网开放。必须完整解压；不要双击 index.html。详细说明见 `release/QUICKSTART-ZH.md`。

源码中的 `release/` 是启动器模板，不能直接当作预构建目录运行。完成 `npm run build` 后，可执行：

```sh
python tools/package-release.py
```

这会在工程旁的 particle-bloom-release 目录生成源码 ZIP、预构建 ZIP 和 SHA-256 清单。它不上传 GitHub、不发布网站、不启用 Pages。

## 六花离线比较

`artifacts/offline-sixflower-preview.png` 与同名 `.json` 由六花实际粒子缓冲区生成，统一尺度比较正面和斜视角，记录边界、颜色与语义区域。它是**离线预览，不是浏览器运行截图**，不验证界面布局、真实 WebGL、摄像头或设备帧率。复现流程见 `tools/render-sixflowers.py` 的参数说明及 `tools/export-sixflowers.mjs`。
