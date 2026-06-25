import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawBubble, drawConnection, drawLabel } from "../renderer";

function createMockCtx() {
  const shadowBlurHistory: number[] = [];
  let _shadowBlur = 0;
  const textMetrics: TextMetrics = { width: 50, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0, fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 0, alphabeticBaseline: 0, hangingBaseline: 0, ideographicBaseline: 0, emHeightAscent: 0, emHeightDescent: 0 };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ ...textMetrics })),
    shadowColor: "",
    shadowOffsetY: 0,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    shadowBlurHistory,
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(ctx, "shadowBlur", {
    get: () => _shadowBlur,
    set: (v: number) => { _shadowBlur = v; shadowBlurHistory.push(v); },
    configurable: true,
  });
  return ctx;
}

describe("drawBubble", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("draws an arc with correct parameters", () => {
    drawBubble(ctx, 100, 200, 50, "#ff0000", 1, false);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledWith(100, 200, 50, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("returns early when radius is too small", () => {
    drawBubble(ctx, 0, 0, 0.3, "#000", 1, false);
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("returns early when alpha is too low", () => {
    drawBubble(ctx, 0, 0, 50, "#000", 0.005, false);
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("uses larger shadow for hovered state", () => {
    drawBubble(ctx, 0, 0, 50, "#fff", 1, true);
    expect((ctx as unknown as { shadowBlurHistory: number[] }).shadowBlurHistory).toContain(14);
  });

  it("uses smaller shadow for normal state", () => {
    drawBubble(ctx, 0, 0, 50, "#fff", 1, false);
    expect((ctx as unknown as { shadowBlurHistory: number[] }).shadowBlurHistory).toContain(6);
  });
});

describe("drawConnection", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("draws a bezier curve between two points", () => {
    drawConnection(ctx, 10, 20, 100, 200, 1, false);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("uses highlight style when hovered", () => {
    drawConnection(ctx, 0, 0, 50, 50, 1, true);
    expect(ctx.strokeStyle).toContain("100,210,160");
    expect(ctx.lineWidth).toBe(2.5);
  });

  it("uses subtle style when not hovered", () => {
    drawConnection(ctx, 0, 0, 50, 50, 1, false);
    expect(ctx.strokeStyle).toContain("255,255,255");
    expect(ctx.lineWidth).toBe(1);
  });
});

describe("drawLabel", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("draws label text at correct position", () => {
    drawLabel(ctx, "hello", 200, 300, 50, 1, false);
    expect(ctx.fillText).toHaveBeenCalledWith("hello", 200, 300);
    expect(ctx.strokeText).toHaveBeenCalledWith("hello", 200, 300);
  });

  it("returns early when alpha is below threshold", () => {
    drawLabel(ctx, "hello", 0, 0, 50, 0.04, false);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("truncates text when too wide", () => {
    ctx.measureText = vi.fn(() => ({ width: 200, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0, fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 0, alphabeticBaseline: 0, hangingBaseline: 0, ideographicBaseline: 0, emHeightAscent: 0, emHeightDescent: 0 }));
    drawLabel(ctx, "a very long filename.txt", 0, 0, 50, 1, false);
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("uses larger font for center node", () => {
    drawLabel(ctx, "center", 0, 0, 50, 1, true);
    expect(ctx.font).toContain("600");
    expect(ctx.font).toContain("15px");
  });

  it("uses smaller font for satellite nodes", () => {
    drawLabel(ctx, "satellite", 0, 0, 50, 1, false);
    expect(ctx.font).toContain("500");
    expect(ctx.font).toContain("13px");
  });
});
