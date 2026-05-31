# QualificationMgmt（资质管理）

基于 **Tauri 2** 与 **Vue 3** 的桌面应用，用于在本地工作目录中管理资质类 **图片与 PDF**：建立索引、按名称与标签筛选、预览、批量添加文字水印，并将结果打包为 **ZIP** 保存。

支持 **macOS** 与 **Windows**（需在对应系统上执行构建）。

## 功能概览

- **工作目录**：首次启动选择文件夹并持久化；之后每次启动在后台重新扫描，对比磁盘变化并更新索引（扫描中顶栏显示「更新中」）。
- **索引**：文件元数据与标签保存在浏览器 **IndexedDB**（Dexie）；工作目录路径保存在应用 **Store**（`plugin-store`）。
- **左侧**：目录树 + 复选框多选；支持文件名模糊搜索（Fuse.js）与按标签筛选。
- **中间**：图片与 PDF 预览（PDF 使用 pdf.js）；展示/编辑当前文件标签。
- **右侧**：已勾选文件列表（点击可定位树节点并联动预览）、水印文案及样式（透明度、字号、位置、旋转）、**开始生成** / **保存 ZIP**。
- **导出**：图片直接叠水印导出 PNG；PDF 按页渲染并叠水印，多页命名为 `文件名_1.png`、`文件名_2.png` …

## 技术栈

| 部分 | 技术 |
|------|------|
| 壳 | Tauri 2 |
| 前端 | Vue 3、Vite、TypeScript、Pinia、Naive UI |
| 索引 | Dexie（IndexedDB） |
| PDF | pdfjs-dist |
| 压缩 | JSZip |
| 扫描 | Rust（walkdir）`scan_directory` 命令 |

## 环境要求

- **Node.js**（建议 LTS）与 **npm**
- **Rust** 工具链（[rustup](https://rustup.rs/)），并安装各平台 Tauri 依赖（见 [官方前置条件](https://v2.tauri.app/start/prerequisites/)）：
  - **macOS**：Xcode Command Line Tools
  - **Windows**：Microsoft C++ Build Tools、WebView2

## 开发与调试

```bash
npm install
npm run tauri dev
```

仅调试前端（不启动 Tauri 窗口）时：

```bash
npm run dev
```

> 若终端里设置了 `CI=1`，部分环境下 Tauri CLI 可能报错；可临时取消该环境变量后再执行 `npm run tauri dev` / `build`。

## 构建发布

在当前操作系统上打正式包：

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`（例如 macOS 的 `.app` / `.dmg`，Windows 的 `.msi` / `.exe` 等，以实际 bundle 配置为准）。

在 **Windows** 上构建 Windows 安装包；在 **macOS** 上构建 macOS 应用。跨平台交叉编译需额外配置目标 triple，可参考 [Tauri 跨平台编译文档](https://v2.tauri.app/distribute/)。

## 项目结构（简要）

```
├── src/                 # Vue 前端源码（页面、Pinia、Dexie、工具函数）
├── src-tauri/           # Rust 与 Tauri 配置、图标、capabilities
├── public/
├── index.html
├── vite.config.ts
└── package.json
```

## 常见问题

- **本地图片 / PDF 预览或水印无内容**：依赖 Tauri 的 **asset 协议**（`convertFileSrc`）。请保持 `tauri.conf.json` 中已启用 `security.assetProtocol`（含 `scope`）并配置允许 `asset:` / `http://asset.localhost` 的 **CSP**；Rust 侧 `tauri` 需开启 **`protocol-asset`** 特性（见 `src-tauri/Cargo.toml`）。

## 许可证

本项目采用 [MIT License](LICENSE)。
