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
   * 文字大小相对画布较短边的比例（如 0.06 ≈ 短边的 6% 转为像素字号），
   * 大图小图视觉占比一致。
   */
  fontSizeRatio: number;
  position: WatermarkPosition;
  rotationDeg: number;
  color: string;
  /** true：整幅平铺；false：单点，使用 position */
  fullscreenTile: boolean;
  /**
   * 横向步长倍数（基于字宽推算的基础步长），越大同一行越稀。
   */
  tileSpacingX: number;
  /**
   * 纵向步长倍数（基于字高推算的基础步长），越大行距越大；有效范围约 1–5。
   */
  tileSpacingY: number;
  /**
   * 交错强度 0–1：奇数行相对偶数行向右偏移 `tileStagger * stepX`（砖缝效果）。
   */
  tileStagger: number;
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

const MAX_TILE_DRAWS = 2500;

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

  const rot = (opt.rotationDeg * Math.PI) / 180;

  if (!opt.fullscreenTile) {
    const pad = fontSize * 0.5;
    const { x, y } = positionCoords(opt.position, width, height, pad);
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return;
  }

  const metrics = ctx.measureText(text);
  const tw = metrics.width;
  const baseStepX = Math.max(tw + fontSize * 0.35, fontSize * 1.15);
  const baseStepY = fontSize * 1.28;
  const mulX = Math.min(3.5, Math.max(0.25, Number(opt.tileSpacingX) || 1));
  const mulY = Math.min(5, Math.max(1, Number(opt.tileSpacingY) || 2));
  const minStep = Math.max(4, fontSize * 0.25);
  const stepX = Math.max(minStep, baseStepX * mulX);
  const stepY = Math.max(minStep, baseStepY * mulY);
  const stagger01 = Math.min(1, Math.max(0, Number(opt.tileStagger) || 0));
  const staggerPx = stagger01 * stepX;

  let drawn = 0;
  let row = 0;
  for (let y = -stepY * 2; y < height + stepY * 2; y += stepY) {
    const ox = row % 2 === 1 ? staggerPx : 0;
    for (let x = -stepX * 2 + ox; x < width + stepX * 2; x += stepX) {
      if (drawn >= MAX_TILE_DRAWS) break;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillText(text, 0, 0);
      ctx.restore();
      drawn++;
    }
    if (drawn >= MAX_TILE_DRAWS) break;
    row++;
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
