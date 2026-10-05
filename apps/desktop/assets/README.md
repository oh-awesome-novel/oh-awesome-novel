# OAN Application Icon

## Design

“展开的故事”：墨蓝底上的暖白书页，中央负形构成钢笔笔尖，金色书签连接书脊。主体只使用书与笔，表示作者主导的小说创作；不将AI或工具本身作为图标主体。大块纸面和明确的留白适合Dock、任务栏与小尺寸窗口图标。

- `icon-source.png`：内置 imagegen 生成的原始1254×1254 RGBA母版，保留透明度。
- `icons/icon.png`：1024×1024 PNG，macOS开发Dock和通用runtime图标。
- `icons/icon-512.png`：512×512 PNG，Linux DEB/RPM图标。
- `icons/icon.icns`：macOS应用包图标，16–1024px普通/Retina尺寸。
- `icons/icon.ico`：Windows EXE、窗口和Squirrel Setup图标；真实ICO容器，含16/24/32/48/64/128/256px PNG帧。
- `../../desktop-ui/src/assets/oan-app-icon.png`：256px启动页资源，由Vite打包。
- `../../desktop-ui/public/favicon-32.png`：32px浏览器图标。

启动页的彩色图标不做深色主题反相。外圈为真实alpha透明，没有烘焙白底或棋盘格。

## Regenerate

在macOS、Node.js 24下，从仓库根目录执行：

```sh
npm run icons:build
```

脚本通过系统 `sips` 缩放、`iconutil` 生成ICNS，并以PNG帧写入标准ICO容器。它只进行尺寸/格式转换，不重新生成或修改设计。母版及所有产物一并管理；Windows/Linux CI直接使用已提交资源，无需运行macOS转换工具或调用模型。

Forge应用图标使用无扩展名基路径，自动选择ICNS/ICO。Linux maker另选512px PNG；runtime图标目录通过extraResource进入安装包，开发与打包分别解析其路径。参见[Forge官方图标说明](https://www.electronforge.io/guides/create-and-add-icons)。

Squirrel `setupIcon` 使用本地ICO；需要已发布HTTP资源的 `iconUrl` 未设置，不伪造下载地址。

## Generation

2026-10-05 使用内置 imagegen 工具生成；没有使用CLI/API fallback。以下为完整最终提示词。

```text
Use case: logo-brand.
Asset type: final production desktop application icon for “oh-awesome-novel”, a calm, filesystem-first long-form novel writing IDE where the human author controls AI-assisted edits. Generate ONE icon only, not a presentation, not variants, not a mockup.
Design concept: “The unfolding story”. An elegant open book made of two bold warm-white folded paper forms; its center fold creates the clean negative-space silhouette of a fountain-pen nib pointing upward. A very small warm brass bookmark at the bottom of the spine is the only accent. The book and pen should read as one ingenious, unified symbol, not as separate overlaid clip art. No letters, words, stars, AI sparkle glyphs, robots, circuits, pencils, borders, badges, or extra ornaments.
Composition: straight-on orthographic view, centered, balanced and optically clear at 32 pixels. A deep ink-blue rounded-square app tile occupies roughly 84% of the square 1024 by 1024 canvas, with equal transparent margins on all sides. Generous clean negative space around the large book symbol; strong silhouette and thick forms. The tile has beautifully controlled continuous rounded corners.
Style: premium native desktop icon, restrained tactile paper craftsmanship. Subtle sculptural depth in the ivory pages, faint recessed center fold, matte ink-blue tile, gentle controlled shading, extremely crisp clean edges. No glossy plastic, photographic scenery, noisy grain, dramatic gradients, thick extrusions, lighting flares, or excessive shadow. Palette rooted in dark writing ink, warm white paper, and a restrained brass bookmark.
Output: square 1024x1024 RGBA PNG, genuinely transparent outside the rounded-square tile, including transparent corners. No checkerboard painted into the image, no white background, no explanatory text.
```
