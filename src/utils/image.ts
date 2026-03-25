import type { WatermarkOptions } from "./watermark";
import { canvasToBlob, drawWatermarkOnCanvas } from "./watermark";

/** 预览与导出须一致，否则同一 fontSize 在不同画布像素密度下相对大小不同 */
export const IMAGE_RASTER_MAX_EDGE = 8192;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("图片解码失败，可能格式不受支持或数据损坏"));
    img.src = src;
  });
}

/**
 * 通过 fetch → Blob URL 再绘制，避免直接用 asset 协议 URL 挂到 Image 上导致 canvas 被污染，
 * 从而 toBlob 失败或导出无水印/空白（PDF 用 pdf.js fetch 故无此问题）。
 */
function scaleToMaxEdge(
  naturalW: number,
  naturalH: number,
  maxEdge: number,
): { w: number; h: number } {
  if (naturalW === 0 || naturalH === 0) {
    throw new Error("图片尺寸无效");
  }
  let w = naturalW;
  let h = naturalH;
  if (w > maxEdge || h > maxEdge) {
    const r = Math.min(maxEdge / w, maxEdge / h);
    w = Math.floor(w * r);
    h = Math.floor(h * r);
  }
  return { w, h };
}

/** 在已有 canvas 上绘制带水印的预览（fetch + blob URL，避免 canvas 污染） */
export async function drawWatermarkedImageToCanvas(
  canvas: HTMLCanvasElement,
  assetUrl: string,
  watermark: WatermarkOptions,
  maxEdge = IMAGE_RASTER_MAX_EDGE,
): Promise<void> {
  const res = await fetch(assetUrl);
  if (!res.ok) {
    throw new Error(`无法读取图片 (${res.status})`);
  }
  const blobIn = await res.blob();
  const objUrl = URL.createObjectURL(blobIn);
  try {
    const img = await loadImageElement(objUrl);
    const { w, h } = scaleToMaxEdge(img.naturalWidth, img.naturalHeight, maxEdge);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    ctx.drawImage(img, 0, 0, w, h);
    drawWatermarkOnCanvas(ctx, w, h, watermark);
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export async function imageUrlToWatermarkedPng(
  assetUrl: string,
  watermark: WatermarkOptions,
): Promise<Blob> {
  const res = await fetch(assetUrl);
  if (!res.ok) {
    throw new Error(`无法读取图片 (${res.status})`);
  }
  const blobIn = await res.blob();
  const objUrl = URL.createObjectURL(blobIn);
  try {
    const img = await loadImageElement(objUrl);
    const { w, h } = scaleToMaxEdge(
      img.naturalWidth,
      img.naturalHeight,
      IMAGE_RASTER_MAX_EDGE,
    );

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    ctx.drawImage(img, 0, 0, w, h);
    drawWatermarkOnCanvas(ctx, w, h, watermark);
    return canvasToBlob(canvas, "image/png");
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}
