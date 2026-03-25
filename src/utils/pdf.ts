import * as pdfjs from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { WatermarkOptions } from "./watermark";
import { canvasToBlob, drawWatermarkOnCanvas } from "./watermark";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** 与导出一致：预览与打包必须用同一缩放与边上限，否则水印相对版面会偏 */
export const PDF_RENDER_BASE_SCALE = 2;
export const PDF_RENDER_MAX_CANVAS_EDGE = 4096;

export async function loadPdfDocument(url: string) {
  const task = pdfjs.getDocument({ url, withCredentials: false });
  return task.promise;
}

export function viewportForPdfPage(
  page: PDFPageProxy,
  baseScale = PDF_RENDER_BASE_SCALE,
  maxEdge = PDF_RENDER_MAX_CANVAS_EDGE,
) {
  const base = page.getViewport({ scale: 1 });
  let scale = baseScale;
  let vp = page.getViewport({ scale });
  if (vp.width > maxEdge || vp.height > maxEdge) {
    scale = Math.min(maxEdge / base.width, maxEdge / base.height);
    vp = page.getViewport({ scale });
  }
  return vp;
}

export async function renderPdfPageToWatermarkedPng(
  pdf: Awaited<ReturnType<typeof loadPdfDocument>>,
  pageIndex1Based: number,
  watermark: WatermarkOptions,
  baseScale = PDF_RENDER_BASE_SCALE,
): Promise<Blob> {
  const page = await pdf.getPage(pageIndex1Based);
  const vp = viewportForPdfPage(page, baseScale);

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 上下文");

  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  drawWatermarkOnCanvas(ctx, canvas.width, canvas.height, watermark);
  return canvasToBlob(canvas, "image/png");
}
