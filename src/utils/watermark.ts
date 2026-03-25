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
  /** 水印总份数；1 时用「位置」锚点，大于 1 时在整幅画布上网格均匀铺开 */
  repeatCount: number;
}

/** 按画布宽高比取列行数，使 cols×rows≥n，格心均匀铺满画面 */
function gridDimensions(
  n: number,
  width: number,
  height: number,
): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  const ratio = width / Math.max(1e-9, height);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * ratio)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
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

  const n = Math.min(50, Math.max(1, Math.round(Number(opt.repeatCount)) || 1));
  const rot = (opt.rotationDeg * Math.PI) / 180;

  if (n === 1) {
    const pad = opt.fontSize * 0.5;
    const { x, y } = positionCoords(opt.position, width, height, pad);
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillText(text, 0, 0);
  } else {
    const { cols, rows } = gridDimensions(n, width, height);
    const cellW = width / cols;
    const cellH = height / rows;
    let placed = 0;
    for (let r = 0; r < rows && placed < n; r++) {
      for (let c = 0; c < cols && placed < n; c++) {
        const cx = (c + 0.5) * cellW;
        const cy = (r + 0.5) * cellH;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.fillText(text, 0, 0);
        ctx.restore();
        placed++;
      }
    }
  }
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
