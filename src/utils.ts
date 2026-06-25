import { AnimatedNode, RenderNode } from "./types";

export function hexToRgba(hex: string, alpha: number): string {
  let c = hex.substring(1);
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function lerpSnap(cur: number, tgt: number, rate: number, dt: number, snap: number): number {
  const t    = 1 - Math.pow(1 - rate, dt * 60);
  const next = cur + (tgt - cur) * t;
  return Math.abs(tgt - next) < snap ? tgt : next;
}

export function getParentPath(p: string): string | null {
  const clean = p.replace(/\\/g, "/").trim();
  if (clean.length <= 3 && clean.indexOf(":") > 0) return null;
  if (clean === "/" || clean === "") return null;

  const lastSlash = clean.lastIndexOf("/");
  if (lastSlash <= 0) return null;

  let parent = p.substring(0, lastSlash);
  if (parent.endsWith(":")) {
    parent += "\\";
  }
  return parent;
}

export function getNodeAtPosition(sx: number, sy: number, animatedNodes: AnimatedNode[]): number | null {
  for (let i = 0; i < animatedNodes.length; i++) {
    const n = animatedNodes[i];
    const dx = sx - n.curX, dy = sy - n.curY;
    if (dx * dx + dy * dy < n.curRadius * n.curRadius) return i;
  }
  return null;
}

export function clampCoordinates(x: number, y: number): { x: number; y: number } {
  const m = Math.min(245, Math.min(window.innerWidth, window.innerHeight) * 0.15);
  return {
    x: Math.max(m, Math.min(window.innerWidth  - m, x)),
    y: Math.max(m, Math.min(window.innerHeight - m, y))
  };
}

export function nodeKey(node: RenderNode, index: number): string {
  if (index === 0) return "center";
  if (node.isAction) return `action:${node.actionId}`;
  if (node.isBack) return "back";
  return `item:${node.path ?? node.label}`;
}

export function friendlyError(err: unknown): string {
  const msg = String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("no such file") || lower.includes("does not exist") || lower.includes("not found"))
    return "Folder not found";
  if (lower.includes("access denied") || lower.includes("permission denied") || lower.includes("eacces"))
    return "Access denied by Windows";
  if (lower.includes("network") || lower.includes("unreachable") || lower.includes("timeout") || lower.includes("etimedout"))
    return "Network drive unreachable";
  if (lower.includes("not a directory"))
    return "Not a valid folder";
  if (msg.length > 80)
    return msg.substring(0, 77) + "...";
  return msg;
}
