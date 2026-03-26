<script setup lang="ts">
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { viewportForPdfPage } from "@/utils/pdf";
import type { WatermarkOptions } from "@/utils/watermark";
import { drawWatermarkOnCanvas } from "@/utils/watermark";
import { NButton, NSpace } from "naive-ui";
import { nextTick, onUnmounted, ref, watch } from "vue";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const props = defineProps<{
  src: string | null;
  watermark: WatermarkOptions;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const pageNum = ref(1);
const totalPages = ref(0);
const loading = ref(false);
const err = ref<string | null>(null);

let currentDoc: PDFDocumentProxy | null = null;
let docSrc: string | null = null;
let activeRenderTask: RenderTask | null = null;
/** 并发 render 时只应用最后一次结果 */
let renderGeneration = 0;

function cancelActiveRender() {
  if (activeRenderTask) {
    try {
      activeRenderTask.cancel();
    } catch {
      /* ignore */
    }
    activeRenderTask = null;
  }
}

function isCancelledError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = "name" in e ? String((e as { name: string }).name) : "";
  const msg = "message" in e ? String((e as { message: string }).message) : "";
  return (
    name === "RenderingCancelledException" ||
    msg.includes("RenderingCancelled") ||
    msg.includes("cancelled")
  );
}

async function render() {
  err.value = null;
  if (!props.src) {
    cancelActiveRender();
    if (currentDoc) {
      try {
        await currentDoc.destroy();
      } catch {
        /* ignore */
      }
      currentDoc = null;
    }
    docSrc = null;
    totalPages.value = 0;
    return;
  }

  await nextTick();
  if (!canvasRef.value) await nextTick();
  if (!canvasRef.value) return;

  const gen = ++renderGeneration;
  cancelActiveRender();
  loading.value = true;

  try {
    if (docSrc !== props.src) {
      if (currentDoc) {
        try {
          await currentDoc.destroy();
        } catch {
          /* ignore */
        }
        currentDoc = null;
      }
      docSrc = props.src;
      const loadingTask = pdfjs.getDocument({
        url: props.src,
        withCredentials: false,
      });
      const pdf = await loadingTask.promise;
      if (gen !== renderGeneration) return;
      currentDoc = pdf;
    }

    if (!currentDoc) return;
    totalPages.value = currentDoc.numPages;
    const p = Math.min(Math.max(1, pageNum.value), totalPages.value);
    pageNum.value = p;

    const page: PDFPageProxy = await currentDoc.getPage(p);
    if (gen !== renderGeneration) return;

    const vp = viewportForPdfPage(page);
    const canvas = canvasRef.value;
    await nextTick();
    if (gen !== renderGeneration) return;

    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");

    const task = page.render({ canvasContext: ctx, viewport: vp });
    activeRenderTask = task;
    try {
      await task.promise;
    } catch (e) {
      if (isCancelledError(e)) return;
      throw e;
    } finally {
      if (activeRenderTask === task) activeRenderTask = null;
    }

    if (gen !== renderGeneration) return;
    drawWatermarkOnCanvas(ctx, canvas.width, canvas.height, props.watermark);
  } catch (e) {
    if (isCancelledError(e) || gen !== renderGeneration) return;
    err.value = e instanceof Error ? e.message : String(e);
    totalPages.value = 0;
  } finally {
    if (gen === renderGeneration) loading.value = false;
  }
}

watch(
  () => props.src,
  (s, prev) => {
    if (s !== prev) pageNum.value = 1;
  },
);

watch(
  () =>
    [
      props.src,
      pageNum.value,
      props.watermark.text,
      props.watermark.opacity,
      props.watermark.fontSizeRatio,
      props.watermark.position,
      props.watermark.rotationDeg,
      props.watermark.color,
      props.watermark.fullscreenTile,
      props.watermark.tileSpacingX,
      props.watermark.tileSpacingY,
      props.watermark.tileStagger,
    ] as const,
  () => void render(),
  { immediate: true },
);

onUnmounted(async () => {
  cancelActiveRender();
  if (currentDoc) {
    try {
      await currentDoc.destroy();
    } catch {
      /* ignore */
    }
    currentDoc = null;
  }
  docSrc = null;
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
  max-height: calc(100vh - 220px);
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
