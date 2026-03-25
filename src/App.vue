<script setup lang="ts">
import ImageWatermarkedPreview from "@/components/ImageWatermarkedPreview.vue";
import PdfPagePreview from "@/components/PdfPagePreview.vue";
import { useAppStore } from "@/stores/app";
import { buildTreeFromFiles, type TreeNode } from "@/utils/tree";
import type { WatermarkPosition } from "@/utils/watermark";
import type { TreeOption } from "naive-ui";
import {
  NButton,
  NCard,
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
  NTag,
  NTree,
  createDiscreteApi,
  zhCN,
} from "naive-ui";
import { computed, onMounted, ref } from "vue";

const { message } = createDiscreteApi(["message"], {
  configProviderProps: { locale: zhCN },
});

const store = useAppStore();

/** Pinia 中 expanded 为 ref，用 v-model 经 computed 写回，避免模板里赋值不生效 */
const treeExpandedKeys = computed({
  get: () => store.expandedTreeKeys,
  set: (keys: Array<string | number>) => store.setExpandedTreeKeys(keys),
});

/** 只传当前过滤结果里仍存在的勾选，避免 NTree cascade 与「幽灵 key」死循环卡死 */
const treeCheckedKeys = computed({
  get: () =>
    store.selectedIds.filter((id) =>
      store.filteredFiles.some((f) => f.id === id),
    ),
  set: (keys: Array<string | number>) => store.setCheckedKeys(keys),
});

/** 当前预览文件若被过滤掉，则不在树上维持 selected（否则 NTree 受控状态异常） */
const treeSelectedKeys = computed(() => {
  const id = store.currentPreviewId;
  if (!id) return [];
  if (!store.filteredFiles.some((f) => f.id === id)) return [];
  return [id];
});

const tagInput = ref("");

function toTreeOptions(nodes: TreeNode[]): TreeOption[] {
  return nodes.map((n) => ({
    key: n.key,
    label: n.label,
    disabled: false,
    isLeaf: n.isLeaf,
    children: n.children?.length ? toTreeOptions(n.children) : undefined,
  }));
}

const treeData = computed(() => toTreeOptions(buildTreeFromFiles(store.filteredFiles)));

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

onMounted(async () => {
  await store.bootstrap();
  if (!store.workDir) {
    try {
      await store.pickWorkDir();
    } catch {
      /* user cancel */
    }
  }
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

function onTreeSelectKeys(keys: Array<string | number>) {
  const raw = keys[keys.length - 1];
  const k = typeof raw === "number" ? String(raw) : raw;
  if (k && store.fileMap.has(k)) store.previewFile(k);
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
            <div class="left-filters">
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
            <div class="tree-scroll">
              <n-tree
                v-if="treeData.length"
                block-line
                checkable
                cascade
                check-strategy="child"
                selectable
                expand-on-click
                :data="treeData"
                v-model:expanded-keys="treeExpandedKeys"
                v-model:checked-keys="treeCheckedKeys"
                :selected-keys="treeSelectedKeys"
                @update:selected-keys="onTreeSelectKeys"
              />
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
            <n-card size="small" title="已勾选">
              <div class="chk-list">
                <div
                  v-for="f in store.selectedFiles"
                  :key="f.id"
                  class="chk-item"
                  @click="store.revealFileInTree(f.id)"
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
            <n-card size="small" title="水印">
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
                <div class="wm-row">
                  <span class="muted">字号</span>
                  <input
                    v-model.number="store.watermarkFontSize"
                    type="range"
                    min="12"
                    max="120"
                    step="1"
                  />
                  {{ store.watermarkFontSize }}
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
                <span class="muted">位置</span>
                <n-select v-model:value="store.watermarkPosition" :options="wmPositions" />
              </n-space>
            </n-card>
            <n-card size="small" title="操作" class="ops">
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
.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 4px 8px;
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
