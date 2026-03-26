<script setup lang="ts">
import ImageWatermarkedPreview from "@/components/ImageWatermarkedPreview.vue";
import PdfPagePreview from "@/components/PdfPagePreview.vue";
import type { IndexedFile } from "@/db";
import { useAppStore } from "@/stores/app";
import type { WatermarkPosition } from "@/utils/watermark";
import {
  NButton,
  NCard,
  NCheckbox,
  NConfigProvider,
  NDivider,
  NEmpty,
  NInput,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NProgress,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  NTooltip,
  createDiscreteApi,
  zhCN,
} from "naive-ui";
import { nextTick, onMounted, onUnmounted, ref } from "vue";

const { message } = createDiscreteApi(["message"], {
  configProviderProps: { locale: zhCN },
});

const store = useAppStore();

const tagInput = ref("");
const fileListEl = ref<HTMLElement | null>(null);

function dirHint(f: IndexedFile): string {
  return f.parentPath ? f.parentPath : "（根目录）";
}

const wmPositions: { label: string; value: WatermarkPosition }[] = [
  { label: "左上", value: "tl" },
  { label: "上中", value: "tc" },
  { label: "右上", value: "tr" },
  { label: "左中", value: "ml" },
  { label: "居中", value: "mc" },
  { label: "右中", value: "mr" },
  { label: "左下", value: "bl" },
  { label: "下中", value: "bc" },
  { label: "右下", value: "br" },
];

function shouldIgnoreArrowForFileNav(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    if (
      ["text", "search", "number", "password", "email", "url", "tel", "range"].includes(
        type,
      )
    ) {
      return true;
    }
  }
  if (target.closest("[data-no-arrow-file-nav]")) return true;
  return false;
}

function scrollPreviewRowIntoView(fileId: string) {
  const root = fileListEl.value;
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLElement>(".file-row[data-file-id]")) {
    if (el.dataset.fileId === fileId) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      break;
    }
  }
}

function onArrowFileNav(e: KeyboardEvent) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (shouldIgnoreArrowForFileNav(e.target)) return;
  const list = store.filteredFiles;
  if (!list.length) return;
  e.preventDefault();
  const curId = store.currentPreviewId;
  let i = curId ? list.findIndex((f) => f.id === curId) : -1;
  if (e.key === "ArrowDown") {
    i = i < 0 ? 0 : Math.min(i + 1, list.length - 1);
  } else {
    i = i < 0 ? list.length - 1 : Math.max(i - 1, 0);
  }
  const next = list[i];
  if (!next) return;
  store.previewFile(next.id);
  void nextTick(() => scrollPreviewRowIntoView(next.id));
}

onMounted(async () => {
  window.addEventListener("keydown", onArrowFileNav, true);
  await store.bootstrap();
  if (!store.workDir) {
    try {
      await store.pickWorkDir();
    } catch {
      /* user cancel */
    }
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onArrowFileNav, true);
});

function onAddTag() {
  void store.addTagToCurrent(tagInput.value).then(() => {
    tagInput.value = "";
  });
}

async function onGenerate() {
  if (!store.selectedIds.length) {
    message.warning("请先勾选文件");
    return;
  }
  try {
    await store.startGenerate();
    message.success(`已生成 ${store.generated.length} 个文件`);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "生成失败");
  }
}

function formatInvokeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  try {
    return JSON.stringify(e);
  } catch {
    return "保存失败";
  }
}

async function onSaveZip() {
  try {
    await store.saveZip();
    message.success("已保存");
  } catch (e) {
    message.error(formatInvokeError(e));
  }
}

</script>

<template>
  <n-config-provider :locale="zhCN">
    <n-layout class="root" position="absolute">
        <n-layout-header bordered class="header">
          <div class="header-row">
            <span class="label">工作目录</span>
            <span class="path" :title="store.workDir ?? ''">{{
              store.workDir ?? "未设置"
            }}</span>
            <n-button size="small" @click="store.pickWorkDir()">选择目录</n-button>
            <n-divider vertical />
            <span>索引：{{ store.indexCount }} 个文件</span>
            <n-divider vertical />
            <span v-if="store.scanning" class="scanning">更新中…</span>
            <span v-else-if="store.lastScanAt">
              最后更新：{{ new Date(store.lastScanAt).toLocaleString("zh-CN") }}
            </span>
            <span v-else>尚未扫描</span>
          </div>
        </n-layout-header>
        <n-layout has-sider position="absolute" class="body">
          <n-layout-sider
            bordered
            :width="300"
            show-trigger
            collapse-mode="width"
            :collapsed-width="0"
            content-style="display:flex;flex-direction:column;height:100%;"
          >
            <div class="left-filters" data-no-arrow-file-nav>
              <n-input
                v-model:value="store.searchText"
                size="small"
                placeholder="文件名（模糊）"
                clearable
              />
              <n-select
                :value="store.filterTags"
                multiple
                filterable
                tag
                size="small"
                placeholder="按标签筛选"
                :options="store.tagFilterOptions"
                clearable
                class="tag-filter"
                @update:value="store.setFilterTags"
              />
            </div>
            <div ref="fileListEl" class="file-list-scroll" tabindex="-1">
              <template v-if="store.filteredFiles.length">
                <div
                  v-for="f in store.filteredFiles"
                  :key="f.id"
                  class="file-row"
                  :class="{ 'file-row--active': store.currentPreviewId === f.id }"
                  :data-file-id="f.id"
                  @click="store.previewFile(f.id)"
                >
                  <n-checkbox
                    :checked="store.selectedIds.includes(f.id)"
                    size="small"
                    @update:checked="(v: boolean) => store.setFileSelected(f.id, v)"
                    @click.stop
                  />
                  <n-tooltip placement="right-start" :show-arrow="true" :delay="200">
                    <template #trigger>
                      <span class="file-row-label">{{ f.name }}</span>
                    </template>
                    <div class="file-tip">
                      <div><span class="tip-k">所在目录</span>{{ dirHint(f) }}</div>
                      <div><span class="tip-k">相对路径</span>{{ f.relativePath }}</div>
                    </div>
                  </n-tooltip>
                </div>
              </template>
              <n-empty v-else description="无匹配文件" size="small" />
            </div>
          </n-layout-sider>
          <n-layout-content
            content-style="padding:12px;display:flex;flex-direction:column;min-height:100%;"
          >
            <n-card size="small" title="预览" class="preview-card">
              <template v-if="store.currentFile">
                <div class="tag-bar">
                  <span class="muted">标签：</span>
                  <n-space size="small">
                    <n-tag
                      v-for="t in store.currentFile.tags"
                      :key="t"
                      closable
                      size="small"
                      @close="store.removeTagFromCurrent(t)"
                    >
                      {{ t }}
                    </n-tag>
                  </n-space>
                  <n-input
                    v-model:value="tagInput"
                    size="small"
                    placeholder="新标签回车添加"
                    style="max-width: 200px"
                    @keyup.enter="onAddTag"
                  />
                </div>
                <n-divider style="margin: 8px 0" />
                <div class="preview-body">
                  <ImageWatermarkedPreview
                    v-if="store.currentFile.kind === 'image'"
                    :src="store.previewSrcFor(store.currentFile)"
                    :watermark="store.watermarkOptions"
                  />
                  <PdfPagePreview
                    v-else
                    :src="store.previewSrcFor(store.currentFile)"
                    :watermark="store.watermarkOptions"
                  />
                </div>
              </template>
              <n-empty v-else description="在左侧点击文件预览" />
            </n-card>
          </n-layout-content>
          <n-layout-sider
            bordered
            :width="320"
            content-style="padding:12px;display:flex;flex-direction:column;gap:12px;height:100%;"
            show-trigger
            collapse-mode="width"
            :collapsed-width="0"
          >
            <n-card size="small" title="已选择">
              <div class="chk-list">
                <div
                  v-for="f in store.selectedFiles"
                  :key="f.id"
                  class="chk-item"
                  @click="store.previewFile(f.id)"
                >
                  {{ f.relativePath }}
                </div>
                <n-empty
                  v-if="!store.selectedFiles.length"
                  description="在树中勾选"
                  size="small"
                />
              </div>
            </n-card>
            <n-card size="small" title="水印" data-no-arrow-file-nav>
              <n-space vertical size="small">
                <n-input
                  v-model:value="store.watermarkText"
                  type="textarea"
                  placeholder="水印文字"
                  :rows="2"
                />
                <div class="wm-row">
                  <span class="muted">透明度</span>
                  <input
                    v-model.number="store.watermarkOpacity"
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                  />
                  {{ store.watermarkOpacity.toFixed(2) }}
                </div>
                <div
                  class="wm-row"
                  title="相对画布较短边的比例，不同分辨率下图上水印视觉大小一致"
                >
                  <span class="muted">大小</span>
                  <input
                    v-model.number="store.watermarkFontRatio"
                    type="range"
                    min="0.02"
                    max="0.22"
                    step="0.0025"
                  />
                  {{ (store.watermarkFontRatio * 100).toFixed(1) }}%
                </div>
                <div class="wm-row">
                  <span class="muted">旋转°</span>
                  <input
                    v-model.number="store.watermarkRotation"
                    type="range"
                    min="-90"
                    max="90"
                    step="1"
                  />
                  {{ store.watermarkRotation }}
                </div>
                <div class="wm-row wm-row-switch">
                  <span class="muted">全屏水印</span>
                  <n-switch v-model:value="store.watermarkFullscreenTile" />
                </div>
                <template v-if="store.watermarkFullscreenTile">
                  <div
                    class="wm-row"
                    title="同一行水印之间的疏密（基于字宽推算步长）"
                  >
                    <span class="muted">横向间距</span>
                    <input
                      v-model.number="store.watermarkTileSpacingX"
                      type="range"
                      min="0.25"
                      max="3"
                      step="0.05"
                    />
                    {{ store.watermarkTileSpacingX.toFixed(2) }}×
                  </div>
                  <div
                    class="wm-row"
                    title="行与行之间的疏密（基于字高推算步长），约 1–5 倍"
                  >
                    <span class="muted">纵向间距</span>
                    <input
                      v-model.number="store.watermarkTileSpacingY"
                      type="range"
                      min="1"
                      max="5"
                      step="0.05"
                    />
                    {{ store.watermarkTileSpacingY.toFixed(2) }}×
                  </div>
                  <div
                    class="wm-row"
                    title="奇数行相对上一行向右偏移的比例，0 为对齐网格，0.5 接近砖缝交错"
                  >
                    <span class="muted">交错</span>
                    <input
                      v-model.number="store.watermarkTileStagger"
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                    />
                    {{ store.watermarkTileStagger.toFixed(2) }}
                  </div>
                </template>
                <template v-else>
                  <span class="muted">位置</span>
                  <n-select v-model:value="store.watermarkPosition" :options="wmPositions" />
                </template>
              </n-space>
            </n-card>
            <n-card size="small" title="操作" class="ops" data-no-arrow-file-nav>
              <n-space vertical style="width: 100%">
                <n-button
                  type="primary"
                  block
                  :loading="store.generating"
                  :disabled="!store.selectedIds.length"
                  @click="onGenerate"
                >
                  开始生成
                </n-button>
                <n-progress
                  v-if="store.generating"
                  type="line"
                  :percentage="
                    store.generateProgress.total
                      ? Math.round(
                          (100 * store.generateProgress.done) /
                            store.generateProgress.total,
                        )
                      : 0
                  "
                />
                <n-button block :disabled="!store.generated.length" @click="onSaveZip">
                  保存 ZIP
                </n-button>
                <span v-if="store.generated.length" class="muted tiny">
                  已生成 {{ store.generated.length }} 个文件，保存为 zip
                </span>
              </n-space>
            </n-card>
          </n-layout-sider>
        </n-layout>
    </n-layout>
  </n-config-provider>
</template>

<style scoped>
.root {
  inset: 0;
}
.header {
  height: auto;
  padding: 8px 12px;
}
.header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.path {
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
}
.label {
  color: #666;
}
.scanning {
  color: #2080f0;
  font-weight: 600;
}
.body {
  top: 52px;
  bottom: 0;
}
.left-filters {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.tag-filter {
  width: 100%;
}
.file-list-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 4px 8px;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.file-row:hover {
  background: rgba(32, 128, 240, 0.08);
}
.file-row--active {
  background: rgba(32, 128, 240, 0.14);
}
.file-row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-tip {
  font-size: 12px;
  line-height: 1.5;
  max-width: 360px;
}
.file-tip .tip-k {
  display: inline-block;
  min-width: 4.5em;
  margin-right: 6px;
  color: #888;
  font-weight: 500;
}
.preview-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.preview-body {
  flex: 1;
  overflow: auto;
  text-align: center;
}
.tag-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.muted {
  color: #888;
  font-size: 12px;
}
.chk-list {
  max-height: 160px;
  overflow: auto;
}
.chk-item {
  cursor: pointer;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
}
.chk-item:hover {
  background: rgba(32, 128, 240, 0.08);
}
.wm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.wm-row-switch {
  justify-content: space-between;
}
.wm-row input[type="range"] {
  flex: 1;
}
.tiny {
  font-size: 11px;
}
.ops {
  margin-top: auto;
}
</style>
