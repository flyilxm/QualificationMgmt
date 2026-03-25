export type WatermarkPosition =
  | "tl"
  | "tc"
  | "tr"
  | "ml"
  | "mc"
  | "mr"
  | "bl"
  | "bc"
  | "br";

export interface WatermarkOptions {
  text: string;
  opacity: number;
  fontSize: number;
  position: WatermarkPosition;
  rotationDeg: number;
  color: string;
}

function positionCoords(
  pos: WatermarkPosition,
  w: number,
  h: number,
  pad: number,
): { x: number; y: number } {
  switch (pos) {
    case "tl":
      return { x: pad, y: pad };
    case "tc":
      return { x: w / 2, y: pad };
    case "tr":
      return { x: w - pad, y: pad };
    case "ml":
      return { x: pad, y: h / 2 };
    case "mc":
      return { x: w / 2, y: h / 2 };
    case "mr":
      return { x: w - pad, y: h / 2 };
    case "bl":
      return { x: pad, y: h - pad };
    case "bc":
      return { x: w / 2, y: h - pad };
    case "br":
      return { x: w - pad, y: h - pad };
  }
}

/** Draw watermark on existing canvas context (full canvas size). */
export function drawWatermarkOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opt: WatermarkOptions,
): void {
  const text = opt.text.trim();
  if (!text) return;

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, opt.opacity));
  ctx.fillStyle = opt.color;
  ctx.font = `bold ${opt.fontSize}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const pad = opt.fontSize * 0.5;
  const { x, y } = positionCoords(opt.position, width, height, pad);

  ctx.translate(x, y);
  ctx.rotate((opt.rotationDeg * Math.PI) / 180);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob 失败"))),
      type,
      quality,
    );
  });
}
