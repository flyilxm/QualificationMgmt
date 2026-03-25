<script setup lang="ts">
import { drawWatermarkedImageToCanvas } from "@/utils/image";
import type { WatermarkOptions } from "@/utils/watermark";
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  src: string | null;
  watermark: WatermarkOptions;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const err = ref<string | null>(null);
const loading = ref(false);

let seq = 0;

async function redraw() {
  err.value = null;
  if (!props.src) return;
  await nextTick();
  if (!canvasRef.value) {
    await nextTick();
  }
  if (!canvasRef.value) return;

  const my = ++seq;
  loading.value = true;
  try {
    await drawWatermarkedImageToCanvas(
      canvasRef.value,
      props.src,
      props.watermark,
    );
  } catch (e) {
    if (my === seq) {
      err.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    if (my === seq) loading.value = false;
  }
}

/** 拆成标量，避免父组件每次传入新对象引用导致无意义重绘 */
watch(
  () =>
    [
      props.src,
      props.watermark.text,
      props.watermark.opacity,
      props.watermark.fontSize,
      props.watermark.position,
      props.watermark.rotationDeg,
      props.watermark.color,
    ] as const,
  () => void redraw(),
  { immediate: true },
);
</script>

<template>
  <div class="img-wrap">
    <div v-if="!src" class="placeholder">选择图片预览</div>
    <template v-else>
      <div v-if="err" class="err">{{ err }}</div>
      <canvas v-show="!err" ref="canvasRef" class="preview-canvas" />
      <span v-if="loading && !err" class="muted">加载中…</span>
    </template>
  </div>
</template>

<style scoped>
.img-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-height: 120px;
}
.preview-canvas {
  max-width: 100%;
  max-height: calc(100vh - 220px);
  height: auto;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
}
.placeholder,
.err,
.muted {
  color: #888;
  padding: 12px;
  font-size: 13px;
}
.err {
  color: #c00;
}
</style>
