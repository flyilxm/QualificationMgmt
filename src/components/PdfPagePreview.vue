<script setup lang="ts">
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { NButton, NSpace } from "naive-ui";
import { nextTick, onUnmounted, ref, watch } from "vue";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const props = defineProps<{ src: string | null }>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const pageNum = ref(1);
const totalPages = ref(0);
const loading = ref(false);
const err = ref<string | null>(null);

let currentDoc: { destroy: () => Promise<void> } | null = null;

async function render() {
  err.value = null;
  if (!props.src) {
    totalPages.value = 0;
    return;
  }
  await nextTick();
  if (!canvasRef.value) {
    await nextTick();
  }
  if (!canvasRef.value) {
    totalPages.value = 0;
    return;
  }
  loading.value = true;
  try {
    if (currentDoc) {
      await currentDoc.destroy();
      currentDoc = null;
    }
    const loadingTask = pdfjs.getDocument({ url: props.src, withCredentials: false });
    const pdf = await loadingTask.promise;
    currentDoc = pdf;
    totalPages.value = pdf.numPages;
    const p = Math.min(Math.max(1, pageNum.value), totalPages.value);
    pageNum.value = p;
    const page = await pdf.getPage(p);
    const scale = 1.25;
    const vp = page.getViewport({ scale });
    const canvas = canvasRef.value;
    await nextTick();
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e);
    totalPages.value = 0;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.src,
  () => {
    pageNum.value = 1;
  },
);

watch([() => props.src, pageNum], () => void render(), { immediate: true });

onUnmounted(async () => {
  if (currentDoc) {
    try {
      await currentDoc.destroy();
    } catch {
      /* ignore */
    }
  }
});
</script>

<template>
  <div class="pdf-wrap">
    <div v-if="!src" class="placeholder">选择 PDF 文件预览</div>
    <template v-else>
      <div v-if="err" class="err">{{ err }}</div>
      <canvas v-show="!err" ref="canvasRef" class="pdf-canvas" />
      <NSpace v-if="totalPages > 1" align="center" class="pager">
        <NButton size="tiny" :disabled="pageNum <= 1 || loading" @click="pageNum--">
          上一页
        </NButton>
        <span>{{ pageNum }} / {{ totalPages }}</span>
        <NButton
          size="tiny"
          :disabled="pageNum >= totalPages || loading"
          @click="pageNum++"
        >
          下一页
        </NButton>
      </NSpace>
    </template>
  </div>
</template>

<style scoped>
.pdf-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-height: 200px;
}
.pdf-canvas {
  max-width: 100%;
  height: auto;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
}
.placeholder,
.err {
  color: #888;
  padding: 24px;
}
.err {
  color: #c00;
}
.pager {
  margin-top: 4px;
}
</style>
