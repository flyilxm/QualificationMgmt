import { invoke } from "@tauri-apps/api/core";
import { buildTreeFromFiles, collectTreeNodeKeys } from "@/utils/tree";
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
  const expandedTreeKeys = ref<string[]>([]);

  const watermarkText = ref("内部资料");
  const watermarkOpacity = ref(0.35);
  const watermarkFontSize = ref(44);
  const watermarkPosition = ref<WatermarkPosition>("mc");
  const watermarkRotation = ref(-28);
  /** 水印总份数；1 为单点+位置，大于 1 为整图网格均匀铺开 */
  const watermarkRepeat = ref(1);

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
      fontSize: watermarkFontSize.value,
      position: watermarkPosition.value,
      rotationDeg: watermarkRotation.value,
      color: "#444444",
      repeatCount: Math.min(50, Math.max(1, Math.round(watermarkRepeat.value))),
    }),
  );

  async function reloadFilesFromDb() {
    const rows = await db.files.orderBy("relativePath").toArray();
    files.value = rows.map((f) => ({
      ...f,
      tags: normalizeTags(f.tags),
    }));
    expandedTreeKeys.value = clampExpandedKeys(expandedTreeKeys.value);
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
    const fs = await s.get<number>("watermarkFontSize");
    if (typeof fs === "number" && Number.isFinite(fs) && fs >= 8 && fs <= 200) {
      watermarkFontSize.value = fs;
    }
    const pos = await s.get<string>("watermarkPosition");
    if (typeof pos === "string" && isWatermarkPosition(pos)) {
      watermarkPosition.value = pos;
    }
    const rot = await s.get<number>("watermarkRotation");
    if (typeof rot === "number" && Number.isFinite(rot)) {
      watermarkRotation.value = Math.min(90, Math.max(-90, rot));
    }
    const rep = await s.get<number>("watermarkRepeat");
    if (typeof rep === "number" && Number.isFinite(rep)) {
      watermarkRepeat.value = Math.min(50, Math.max(1, Math.round(rep)));
    }
  }

  async function persistWatermarkSettings() {
    try {
      const s = await load("settings.json", { defaults: {}, autoSave: false });
      await s.set("watermarkText", watermarkText.value);
      await s.set("watermarkOpacity", watermarkOpacity.value);
      await s.set("watermarkFontSize", watermarkFontSize.value);
      await s.set("watermarkPosition", watermarkPosition.value);
      await s.set("watermarkRotation", watermarkRotation.value);
      await s.set("watermarkRepeat", watermarkRepeat.value);
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
      watermarkFontSize,
      watermarkPosition,
      watermarkRotation,
      watermarkRepeat,
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

  function validTreeKeySet(): Set<string> {
    const nodes = buildTreeFromFiles(filteredFiles.value);
    return collectTreeNodeKeys(nodes);
  }

  /** 去掉不存在的节点 key（含误用的 `dir:`，树数据里根本没有这个节点） */
  function clampExpandedKeys(keys: string[]): string[] {
    const valid = validTreeKeySet();
    return keys
      .map((k) => String(k))
      .filter((k) => k.length > 0 && k !== "dir:" && valid.has(k));
  }

  /**
   * 勿直接 watch filteredFiles：每次 reloadFilesFromDb 都会换新数组引用，会误触发，
   * 与 NTree 的 expanded 受控状态打架导致卡死。只在「过滤条件」或「可见文件 id 集合」真的变时裁剪。
   */
  watch(
    () =>
      [
        filterTags.value.slice().sort().join("\0"),
        searchText.value,
        filteredFiles.value
          .map((f) => f.id)
          .slice()
          .sort()
          .join("\0"),
      ].join("\n"),
    () => {
      expandedTreeKeys.value = clampExpandedKeys(expandedTreeKeys.value);
    },
    { flush: "post" },
  );

  /** 必须用方法更新 ref；模板里 `store.xxx = arr` 对 Pinia setup 的 ref 不可靠 */
  function setExpandedTreeKeys(keys: Array<string | number>) {
    expandedTreeKeys.value = clampExpandedKeys(keys.map((k) => String(k)));
  }

  /** 树只展示 filtered 子集：勾选变更只改可见项，保留不可见仍已选中的 id */
  function setCheckedKeys(keys: Array<string | number>) {
    const visible = new Set(filteredFiles.value.map((f) => f.id));
    const fromTree = keys
      .map((k) => String(k))
      .filter((k) => visible.has(k) && fileMap.value.has(k));
    const hidden = selectedIds.value.filter((id) => !visible.has(id));
    selectedIds.value = [...new Set([...hidden, ...fromTree])];
  }

  function revealFileInTree(fileId: string) {
    currentPreviewId.value = fileId;
    const f = fileMap.value.get(fileId);
    if (!f) return;
    const parts = f.relativePath.split("/").filter(Boolean);
    /** 与 buildTreeFromFiles 一致：只有 `dir:/段/...`，没有单独的 `dir:` 节点 */
    const keys: string[] = [];
    let acc = "dir:";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = `${acc}/${parts[i]!}`;
      keys.push(acc);
    }
    expandedTreeKeys.value = clampExpandedKeys([
      ...expandedTreeKeys.value,
      ...keys,
    ]);
  }

  function previewFile(fileId: string | null) {
    currentPreviewId.value = fileId;
    if (fileId) revealFileInTree(fileId);
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
    expandedTreeKeys,
    watermarkText,
    watermarkOpacity,
    watermarkFontSize,
    watermarkPosition,
    watermarkRotation,
    watermarkRepeat,
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
    setCheckedKeys,
    setExpandedTreeKeys,
    previewFile,
    revealFileInTree,
    addTagToCurrent,
    removeTagFromCurrent,
    startGenerate,
    saveZip,
    previewSrcFor,
  };
});
