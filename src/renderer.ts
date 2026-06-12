import { hexToRgba } from "./utils";

export function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
  isHovered: boolean
) {
  if (radius <= 0.5 || alpha <= 0.01) return;
  ctx.save();
  ctx.shadowColor   = "rgba(0,0,0,0.4)";
  ctx.shadowBlur    = isHovered ? 14 : 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(color, 0.82 * alpha);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur  = 0;
  ctx.lineWidth   = isHovered ? 2.5 : 1.5;
  ctx.strokeStyle = isHovered
    ? `rgba(255,255,255,${0.92 * alpha})`
    : `rgba(255,255,255,${0.55 * alpha})`;
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
  isHovered: boolean
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
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
  let text = label;
  if (ctx.measureText(text).width > maxWidth) {
    while (text.length > 3 && ctx.measureText(text + "…").width > maxWidth)
      text = text.slice(0, -1);
    text += "…";
  }
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
