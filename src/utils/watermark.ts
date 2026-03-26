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
  /**
   * 字号相对画布较短边的比例（如 0.06 ≈ 短边的 6% 转为像素字号），
   * 大图小图视觉占比一致。
   */
  fontSizeRatio: number;
  position: WatermarkPosition;
  rotationDeg: number;
  color: string;
  /** 水印总份数；1 时用「位置」锚点，大于 1 时在整幅画布上网格均匀铺开 */
  repeatCount: number;
}

/** 由短边 × 比例得到实际像素字号，并做上下限防止极端画布 */
export function resolveWatermarkFontSizePx(
  width: number,
  height: number,
  ratio: number,
): number {
  const minEdge = Math.min(width, height);
  if (minEdge < 1) return 8;
  const r = Math.min(0.28, Math.max(0.01, Number(ratio) || 0.05));
  const px = Math.round(minEdge * r);
  return Math.max(6, Math.min(Math.floor(minEdge * 0.48), px));
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
  const fontSize = resolveWatermarkFontSizePx(width, height, opt.fontSizeRatio);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const n = Math.min(50, Math.max(1, Math.round(Number(opt.repeatCount)) || 1));
  const rot = (opt.rotationDeg * Math.PI) / 180;

  if (n === 1) {
    const pad = fontSize * 0.5;
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
