import { invoke } from "@tauri-apps/api/core";
import { filePathToAssetUrl } from "@/utils/fileSrc";
import { open, save } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import { db, type FileKind, type IndexedFile } from "@/db";
import { imageUrlToWatermarkedPng } from "@/utils/image";
import { loadPdfDocument, renderPdfPageToWatermarkedPng } from "@/utils/pdf";
import type { WatermarkOptions, WatermarkPosition } from "@/utils/watermark";
import Fuse from "fuse.js";
import { defineStore } from "pinia";
import { computed, nextTick, ref, watch } from "vue";

export interface FileMeta {
  absolutePath: string;
  relativePath: string;
  name: string;
  modifiedMs: number;
  size: number;
  kind: string;
}

function parentPathOf(relativePath: string): string {
  const i = relativePath.lastIndexOf("/");
  return i < 0 ? "" : relativePath.slice(0, i);
}

function stem(name: string): string {
  const d = name.lastIndexOf(".");
  return d < 0 ? name : name.slice(0, d);
}

/** Dexie/旧数据里 tags 可能缺失或非数组，不规范化会在 .includes 时抛错 */
function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x)).filter(Boolean);
}

export const useAppStore = defineStore("app", () => {
  const workDir = ref<string | null>(null);
  const scanning = ref(false);
  const lastScanAt = ref<number | null>(null);
  const files = ref<IndexedFile[]>([]);

  const searchText = ref("");
  const filterTags = ref<string[]>([]);

  const selectedIds = ref<string[]>([]);
  const currentPreviewId = ref<string | null>(null);

  const watermarkText = ref("内部资料");
  const watermarkOpacity = ref(0.35);
  /** 字号相对画布较短边的比例（约 0.02–0.22） */
  const watermarkFontRatio = ref(0.055);
  const watermarkPosition = ref<WatermarkPosition>("mc");
  const watermarkRotation = ref(-28);
  /** 全屏平铺；关则单点+位置 */
  const watermarkFullscreenTile = ref(false);
  /** 全屏平铺横向步长倍数（越大同一行越稀） */
  const watermarkTileSpacingX = ref(1);
  /** 全屏平铺纵向步长倍数，范围 1–5，默认 2 */
  const watermarkTileSpacingY = ref(2);
  /** 交错 0–1，奇数行右移比例 */
  const watermarkTileStagger = ref(0);

  const WM_POSITIONS: readonly WatermarkPosition[] = [
    "tl",
    "tc",
    "tr",
    "ml",
    "mc",
    "mr",
    "bl",
    "bc",
    "br",
  ];

  function isWatermarkPosition(s: string): s is WatermarkPosition {
    return (WM_POSITIONS as readonly string[]).includes(s);
  }

  const generated = ref<{ name: string; blob: Blob }[]>([]);
  const generating = ref(false);
  const generateProgress = ref({ done: 0, total: 0 });

  const fileMap = computed(() => new Map(files.value.map((f) => [f.id, f])));

  const allTags = computed(() => {
    const s = new Set<string>();
    for (const f of files.value) {
      for (const t of f.tags) s.add(t);
    }
    return [...s].sort();
  });

  const indexCount = computed(() => files.value.length);

  const watermarkOptions = computed(
    (): WatermarkOptions => ({
      text: watermarkText.value,
      opacity: watermarkOpacity.value,
      fontSizeRatio: Math.min(0.28, Math.max(0.01, watermarkFontRatio.value)),
      position: watermarkPosition.value,
      rotationDeg: watermarkRotation.value,
      color: "#444444",
      fullscreenTile: watermarkFullscreenTile.value,
      tileSpacingX: Math.min(3.5, Math.max(0.25, watermarkTileSpacingX.value)),
      tileSpacingY: Math.min(5, Math.max(1, watermarkTileSpacingY.value)),
      tileStagger: Math.min(1, Math.max(0, watermarkTileStagger.value)),
    }),
  );

  async function reloadFilesFromDb() {
    const rows = await db.files.orderBy("relativePath").toArray();
    files.value = rows.map((f) => ({
      ...f,
      tags: normalizeTags(f.tags),
    }));
  }

  async function persistWorkDir(path: string | null) {
    const s = await load("settings.json", { defaults: {}, autoSave: false });
    if (path) await s.set("workDir", path);
    else await s.delete("workDir");
    await s.save();
  }

  async function hydrateWatermarkFromStore(
    s: Awaited<ReturnType<typeof load>>,
  ) {
    const t = await s.get<string>("watermarkText");
    if (typeof t === "string") watermarkText.value = t;
    const o = await s.get<number>("watermarkOpacity");
    if (typeof o === "number" && Number.isFinite(o)) {
      watermarkOpacity.value = Math.min(1, Math.max(0.05, o));
    }
    const fr = await s.get<number>("watermarkFontRatio");
    if (typeof fr === "number" && Number.isFinite(fr) && fr >= 0.01 && fr <= 0.3) {
      watermarkFontRatio.value = Math.min(0.28, Math.max(0.01, fr));
    } else {
      const legacy = await s.get<number>("watermarkFontSize");
      if (
        typeof legacy === "number" &&
        Number.isFinite(legacy) &&
        legacy >= 8 &&
        legacy <= 200
      ) {
        watermarkFontRatio.value = Math.min(
          0.25,
          Math.max(0.02, legacy / 1200),
        );
      }
    }
    const pos = await s.get<string>("watermarkPosition");
    if (typeof pos === "string" && isWatermarkPosition(pos)) {
      watermarkPosition.value = pos;
    }
    const rot = await s.get<number>("watermarkRotation");
    if (typeof rot === "number" && Number.isFinite(rot)) {
      watermarkRotation.value = Math.min(90, Math.max(-90, rot));
    }
    const fs = await s.get<boolean>("watermarkFullscreenTile");
    if (typeof fs === "boolean") {
      watermarkFullscreenTile.value = fs;
    } else {
      const rep = await s.get<number>("watermarkRepeat");
      if (typeof rep === "number" && Number.isFinite(rep) && rep > 1) {
        watermarkFullscreenTile.value = true;
      }
    }
    const tsx = await s.get<number>("watermarkTileSpacingX");
    if (typeof tsx === "number" && Number.isFinite(tsx)) {
      watermarkTileSpacingX.value = Math.min(3.5, Math.max(0.25, tsx));
    } else {
      const legacy = await s.get<number>("watermarkTileSpacing");
      if (typeof legacy === "number" && Number.isFinite(legacy)) {
        const vx = Math.min(3.5, Math.max(0.25, legacy));
        watermarkTileSpacingX.value = vx;
        watermarkTileSpacingY.value = Math.min(5, Math.max(1, legacy));
      }
    }
    const tsy = await s.get<number>("watermarkTileSpacingY");
    if (typeof tsy === "number" && Number.isFinite(tsy)) {
      watermarkTileSpacingY.value = Math.min(5, Math.max(1, tsy));
    }
    const tg = await s.get<number>("watermarkTileStagger");
    if (typeof tg === "number" && Number.isFinite(tg)) {
      watermarkTileStagger.value = Math.min(1, Math.max(0, tg));
    }
  }

  async function persistWatermarkSettings() {
    try {
      const s = await load("settings.json", { defaults: {}, autoSave: false });
      await s.set("watermarkText", watermarkText.value);
      await s.set("watermarkOpacity", watermarkOpacity.value);
      await s.set("watermarkFontRatio", watermarkFontRatio.value);
      await s.set("watermarkPosition", watermarkPosition.value);
      await s.set("watermarkRotation", watermarkRotation.value);
      await s.set("watermarkFullscreenTile", watermarkFullscreenTile.value);
      await s.set("watermarkTileSpacingX", watermarkTileSpacingX.value);
      await s.set("watermarkTileSpacingY", watermarkTileSpacingY.value);
      await s.set("watermarkTileStagger", watermarkTileStagger.value);
      await s.save();
    } catch (e) {
      console.error("persistWatermarkSettings", e);
    }
  }

  let watermarkSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let hydratingWatermark = false;

  function schedulePersistWatermark() {
    if (hydratingWatermark) return;
    if (watermarkSaveTimer) clearTimeout(watermarkSaveTimer);
    watermarkSaveTimer = setTimeout(() => {
      watermarkSaveTimer = null;
      void persistWatermarkSettings();
    }, 350);
  }

  watch(
    [
      watermarkText,
      watermarkOpacity,
      watermarkFontRatio,
      watermarkPosition,
      watermarkRotation,
      watermarkFullscreenTile,
      watermarkTileSpacingX,
      watermarkTileSpacingY,
      watermarkTileStagger,
    ],
    schedulePersistWatermark,
  );

  async function mergeMetas(metas: FileMeta[]) {
    const seen = new Set<string>();
    for (const m of metas) {
      const id = m.relativePath.replace(/\\/g, "/");
      seen.add(id);
      const prev = await db.files.get(id);
      const parentPath = parentPathOf(id);
      await db.files.put({
        id,
        relativePath: id,
        absolutePath: m.absolutePath,
        name: m.name,
        parentPath,
        mtimeMs: m.modifiedMs,
        size: m.size,
        kind: m.kind as FileKind,
        tags: normalizeTags(prev?.tags),
      });
    }
    const all = await db.files.toArray();
    for (const f of all) {
      if (!seen.has(f.id)) await db.files.delete(f.id);
    }
    lastScanAt.value = Date.now();
    await reloadFilesFromDb();
  }

  async function runScan() {
    if (!workDir.value) return;
    scanning.value = true;
    try {
      const metas = await invoke<FileMeta[]>("scan_directory", {
        root: workDir.value,
      });
      await mergeMetas(metas);
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      scanning.value = false;
    }
  }

  async function pickWorkDir() {
    const dir = await open({ directory: true, multiple: false });
    const path = Array.isArray(dir) ? dir[0] : dir;
    if (typeof path !== "string") return;
    workDir.value = path;
    await persistWorkDir(path);
    selectedIds.value = [];
    currentPreviewId.value = null;
    await runScan();
  }

  async function bootstrap() {
    const s = await load("settings.json", { defaults: {}, autoSave: false });
    workDir.value = (await s.get<string>("workDir")) ?? null;
    hydratingWatermark = true;
    await hydrateWatermarkFromStore(s);
    await nextTick();
    hydratingWatermark = false;
    await reloadFilesFromDb();
    if (workDir.value) {
      void runScan();
    }
  }

  watch(workDir, (w) => {
    if (!w) {
      generated.value = [];
      selectedIds.value = [];
      currentPreviewId.value = null;
    }
  });

  const tagFilterOptions = computed(() =>
    allTags.value.map((t) => ({ label: t, value: t })),
  );

  /** n-select 不要直接 v-model 到 Pinia 的 ref，否则更新可能写不进 ref.value */
  function setFilterTags(v: string[] | (string | number)[] | null | undefined) {
    if (v == null || !Array.isArray(v)) {
      filterTags.value = [];
      return;
    }
    filterTags.value = v.map((x) => String(x)).filter(Boolean);
  }

  const filteredFiles = computed(() => {
    let list = files.value;
    if (filterTags.value.length) {
      const selected = filterTags.value;
      list = list.filter((f) => {
        const tags = normalizeTags(f.tags);
        return selected.some((t) => tags.includes(t));
      });
    }
    const q = searchText.value.trim();
    if (q) {
      const fuse = new Fuse(list, {
        keys: ["name", "relativePath"],
        threshold: 0.42,
        ignoreLocation: true,
      });
      list = fuse.search(q).map((r) => r.item);
    }
    return list;
  });

  function selectAll() {
    const visibleIds = filteredFiles.value.map((f) => f.id);
    const hidden = selectedIds.value.filter(
      (x) => !new Set(visibleIds).has(x),
    );
    selectedIds.value = [...hidden, ...visibleIds];
  }

  function clearSelection() {
    const visible = new Set(filteredFiles.value.map((f) => f.id));
    selectedIds.value = selectedIds.value.filter((x) => !visible.has(x));
  }

  function setFileSelected(id: string, selected: boolean) {
    const visible = new Set(filteredFiles.value.map((f) => f.id));
    if (!visible.has(id) || !fileMap.value.has(id)) return;
    const hidden = selectedIds.value.filter((x) => !visible.has(x));
    const visSel = new Set(
      selectedIds.value.filter((x) => visible.has(x)),
    );
    if (selected) visSel.add(id);
    else visSel.delete(id);
    selectedIds.value = [...hidden, ...visSel];
  }

  function previewFile(fileId: string | null) {
    currentPreviewId.value = fileId;
  }

  async function addTagToCurrent(tag: string) {
    const id = currentPreviewId.value;
    if (!id) return;
    const t = tag.trim();
    if (!t) return;
    const f = await db.files.get(id);
    if (!f) return;
    const tags = normalizeTags(f.tags);
    if (tags.includes(t)) return;
    await db.files.update(id, { tags: [...tags, t] });
    await reloadFilesFromDb();
  }

  async function removeTagFromCurrent(tag: string) {
    const id = currentPreviewId.value;
    if (!id) return;
    const f = await db.files.get(id);
    if (!f) return;
    const tags = normalizeTags(f.tags);
    await db.files.update(id, { tags: tags.filter((x) => x !== tag) });
    await reloadFilesFromDb();
  }

  const selectedFiles = computed(() =>
    selectedIds.value
      .map((id) => fileMap.value.get(id))
      .filter((x): x is IndexedFile => !!x),
  );

  const currentFile = computed(() =>
    currentPreviewId.value
      ? fileMap.value.get(currentPreviewId.value) ?? null
      : null,
  );

  async function startGenerate() {
    const list = selectedFiles.value;
    if (!list.length) return;
    const wm = watermarkOptions.value;
    generating.value = true;
    generated.value = [];
    generateProgress.value = { done: 0, total: list.length };
    try {
      const out: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < list.length; i++) {
        const file = list[i]!;
        const url = filePathToAssetUrl(file.absolutePath);
        try {
          if (file.kind === "image") {
            const blob = await imageUrlToWatermarkedPng(url, wm);
            out.push({ name: `${stem(file.name)}_wm.png`, blob });
          } else {
            const pdf = await loadPdfDocument(url);
            try {
              const n = pdf.numPages;
              const base = stem(file.name);
              for (let p = 1; p <= n; p++) {
                const blob = await renderPdfPageToWatermarkedPng(pdf, p, wm);
                out.push({ name: `${base}_${p}.png`, blob });
              }
            } finally {
              void pdf.destroy();
            }
          }
        } catch (e) {
          console.error(file.relativePath, e);
        }
        generateProgress.value = { done: i + 1, total: list.length };
      }
      generated.value = out;
    } finally {
      generating.value = false;
    }
  }

  /** 避免单次 IPC 传超大 JSON；按块 Base64 追加写入 */
  function uint8ToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
      binary += String.fromCharCode(...sub);
    }
    return btoa(binary);
  }

  async function saveZip() {
    if (!generated.value.length) return;
    const path = await save({
      defaultPath: "watermarked.zip",
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (typeof path !== "string") return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const g of generated.value) {
      zip.file(g.name, g.blob);
    }
    const u8 = await zip.generateAsync({ type: "uint8array" });
    const rawChunk = 192 * 1024;
    for (let offset = 0, isFirst = true; offset < u8.length; ) {
      const end = Math.min(offset + rawChunk, u8.length);
      const slice = u8.subarray(offset, end);
      const chunkB64 = uint8ToBase64(slice);
      await invoke("save_binary_append", {
        payload: {
          path,
          chunkBase64: chunkB64,
          isFirst,
        },
      });
      offset = end;
      isFirst = false;
    }
  }

  function previewSrcFor(file: IndexedFile | null) {
    if (!file) return null;
    return filePathToAssetUrl(file.absolutePath);
  }

  return {
    workDir,
    scanning,
    lastScanAt,
    files,
    indexCount,
    searchText,
    filterTags,
    selectedIds,
    currentPreviewId,
    watermarkText,
    watermarkOpacity,
    watermarkFontRatio,
    watermarkPosition,
    watermarkRotation,
    watermarkFullscreenTile,
    watermarkTileSpacingX,
    watermarkTileSpacingY,
    watermarkTileStagger,
    generated,
    generating,
    generateProgress,
    fileMap,
    allTags,
    tagFilterOptions,
    setFilterTags,
    filteredFiles,
    watermarkOptions,
    selectedFiles,
    currentFile,
    bootstrap,
    pickWorkDir,
    runScan,
    setFileSelected,
    selectAll,
    clearSelection,
    previewFile,
    addTagToCurrent,
    removeTagFromCurrent,
    startGenerate,
    saveZip,
    previewSrcFor,
  };
});
