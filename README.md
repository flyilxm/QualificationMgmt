# QualificationMgmt

**English** | [简体中文](README.zh-CN.md)

A desktop app built with **Tauri 2** and **Vue 3** for managing qualification-related **images and PDFs** in a local working directory: index files, filter by name and tags, preview, batch text watermarks, and save results as a **ZIP**.

Supports **macOS** and **Windows** (build on each target platform).

## Features

- **Working directory**: Choose a folder on first launch and persist it; on later launches, rescan in the background and update the index when files change (top bar shows “Updating” while scanning).
- **Index**: File metadata and tags in browser **IndexedDB** (Dexie); working directory path in app **Store** (`plugin-store`).
- **Left panel**: Directory tree with multi-select checkboxes; fuzzy filename search (Fuse.js) and tag filtering.
- **Center**: Image and PDF preview (PDF via pdf.js); view and edit tags for the current file.
- **Right panel**: Selected file list (click to focus tree node and preview), watermark text and style (opacity, font size, position, rotation), **Generate** / **Save ZIP**.
- **Export**: Images export as watermarked PNG; PDFs render per page with watermark, multi-page output named `filename_1.png`, `filename_2.png`, …

## Tech stack

| Layer | Technology |
|-------|------------|
| Shell | Tauri 2 |
| Frontend | Vue 3, Vite, TypeScript, Pinia, Naive UI |
| Index | Dexie (IndexedDB) |
| PDF | pdfjs-dist |
| Archive | JSZip |
| Scan | Rust (walkdir) `scan_directory` command |

## Requirements

- **Node.js** (LTS recommended) and **npm**
- **Rust** toolchain ([rustup](https://rustup.rs/)) and platform Tauri prerequisites ([official guide](https://v2.tauri.app/start/prerequisites/)):
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Microsoft C++ Build Tools, WebView2

## Development

```bash
npm install
npm run tauri dev
```

Frontend-only (no Tauri window):

```bash
npm run dev
```

> If `CI=1` is set in your shell, the Tauri CLI may fail in some environments. Unset it before running `npm run tauri dev` or `build`.

## Build

Build a release on the current OS:

```bash
npm run tauri build
```

Artifacts are under `src-tauri/target/release/bundle/` (e.g. macOS `.app` / `.dmg`, Windows `.msi` / `.exe`, depending on bundle config).

Build Windows installers on **Windows**; build macOS apps on **macOS**. Cross-compilation needs extra target triple setup—see [Tauri cross-platform distribution](https://v2.tauri.app/distribute/).

## Project layout

```
├── src/                 # Vue frontend (views, Pinia, Dexie, utilities)
├── src-tauri/           # Rust, Tauri config, icons, capabilities
├── public/
├── index.html
├── vite.config.ts
└── package.json
```

## FAQ

- **Local images / PDFs do not preview or watermark**: Relies on Tauri **asset protocol** (`convertFileSrc`). Keep `security.assetProtocol` (with `scope`) enabled in `tauri.conf.json` and CSP allowing `asset:` / `http://asset.localhost`; enable the **`protocol-asset`** feature on the Rust `tauri` crate (see `src-tauri/Cargo.toml`).

## License

This project is licensed under the [MIT License](LICENSE).
