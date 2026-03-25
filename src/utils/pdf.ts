import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { WatermarkOptions } from "./watermark";
import { canvasToBlob, drawWatermarkOnCanvas } from "./watermark";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_CANVAS_EDGE = 4096;

export async function loadPdfDocument(url: string) {
  const task = pdfjs.getDocument({ url, withCredentials: false });
  return task.promise;
}

export async function renderPdfPageToWatermarkedPng(
  pdf: Awaited<ReturnType<typeof loadPdfDocument>>,
  pageIndex1Based: number,
  watermark: WatermarkOptions,
  baseScale = 2,
): Promise<Blob> {
  const page = await pdf.getPage(pageIndex1Based);
  const base = page.getViewport({ scale: 1 });
  let scale = baseScale;
  let vp = page.getViewport({ scale });
  if (vp.width > MAX_CANVAS_EDGE || vp.height > MAX_CANVAS_EDGE) {
    scale = Math.min(MAX_CANVAS_EDGE / base.width, MAX_CANVAS_EDGE / base.height);
    vp = page.getViewport({ scale });
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 上下文");

  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  drawWatermarkOnCanvas(ctx, canvas.width, canvas.height, watermark);
  return canvasToBlob(canvas, "image/png");
}
