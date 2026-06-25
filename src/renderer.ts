import { hexToRgba } from "./utils";

export function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
  isHovered: boolean,
  isKeyboardFocus: boolean = false
) {
  if (radius <= 0.5 || alpha <= 0.01) return;
  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.4)";
  ctx.shadowBlur    = isKeyboardFocus ? 20 : (isHovered ? 14 : 6);
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(color, 0.82 * alpha);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur  = 0;
  ctx.lineWidth   = isKeyboardFocus ? 3.5 : (isHovered ? 2.5 : 1.5);
  ctx.strokeStyle = isKeyboardFocus
    ? `rgba(241,196,15,${0.95 * alpha})`
    : (isHovered
      ? `rgba(255,255,255,${0.92 * alpha})`
      : `rgba(255,255,255,${0.55 * alpha})`);
  ctx.stroke();
  ctx.restore();
}

export function drawConnection(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  alpha: number,
  isHovered: boolean,
  index: number = 0
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;
  const offsetAmt = Math.min(dist * 0.15, 40);
  const perpX = -dy / dist;
  const perpY =  dx / dist;
  const cpx = (x1 + x2) / 2 + perpX * offsetAmt * (index % 2 === 0 ? 1 : -1);
  const cpy = (y1 + y2) / 2 + perpY * offsetAmt * (index % 2 === 0 ? 1 : -1);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cpx, cpy, x2, y2);
  if (isHovered) {
    ctx.strokeStyle = `rgba(100,210,160,${0.9 * alpha})`;
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = "rgba(100,210,160,0.5)";
    ctx.shadowBlur  = 8;
  } else {
    ctx.strokeStyle = `rgba(255,255,255,${0.20 * alpha})`;
    ctx.lineWidth   = 1;
    ctx.shadowBlur  = 0;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

const truncationCache = new Map<string, string>();
const TRUNCATION_CACHE_MAX = 200;

function getTruncatedText(ctx: CanvasRenderingContext2D, label: string, maxWidth: number): string {
  const key = `${label}|${maxWidth}`;
  const cached = truncationCache.get(key);
  if (cached) return cached;

  let text = label;
  if (ctx.measureText(text).width > maxWidth) {
    while (text.length > 3 && ctx.measureText(text + "…").width > maxWidth)
      text = text.slice(0, -1);
    text += "…";
  }

  if (truncationCache.size >= TRUNCATION_CACHE_MAX) {
    const firstKey = truncationCache.keys().next().value;
    if (firstKey !== undefined) truncationCache.delete(firstKey);
  }
  truncationCache.set(key, text);
  return text;
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  isCenter: boolean
) {
  if (alpha < 0.05) return;
  const fontSize = isCenter ? 15 : 13;
  ctx.font         = `${isCenter ? "600" : "500"} ${fontSize}px -apple-system,system-ui,sans-serif`;
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  const maxWidth = radius * 1.75;
  const text = getTruncatedText(ctx, label, maxWidth);
  ctx.globalAlpha  = alpha;
  ctx.lineWidth    = 4.5;
  ctx.strokeStyle  = "rgba(0,0,0,0.85)";
  ctx.lineJoin     = "round";
  ctx.strokeText(text, x, y);
  ctx.lineWidth    = 1.5;
  ctx.strokeStyle  = "rgba(255,255,255,0.30)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle    = "rgba(255,255,255,1)";
  ctx.fillText(text, x, y);
  ctx.globalAlpha  = 1;
}

export function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  badge: string,
  alpha: number
) {
  if (alpha < 0.05) return;
  const bx = x + radius * 0.4;
  const by = y + radius * 0.4;
  const bw = 18;
  const bh = 16;
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 3);
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "600 9px -apple-system,system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badge, bx + bw / 2, by + bh / 2);
  ctx.restore();
}
