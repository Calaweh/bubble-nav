import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  hexToRgba,
  lerpSnap,
  getParentPath,
  getNodeAtPosition,
  clampCoordinates,
  nodeKey,
} from "../utils";
import { RenderNode, AnimatedNode } from "../types";

describe("hexToRgba", () => {
  it("converts 6-digit hex with alpha", () => {
    expect(hexToRgba("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
  });

  it("converts 3-digit hex with alpha", () => {
    expect(hexToRgba("#f00", 0.8)).toBe("rgba(255,0,0,0.8)");
  });

  it("handles #fff", () => {
    expect(hexToRgba("#fff", 1)).toBe("rgba(255,255,255,1)");
  });

  it("handles alpha 0", () => {
    expect(hexToRgba("#00ff00", 0)).toBe("rgba(0,255,0,0)");
  });
});

describe("lerpSnap", () => {
  it("snaps when close enough", () => {
    expect(lerpSnap(10, 10.05, 0.5, 1, 0.1)).toBe(10.05);
  });

  it("interpolates toward target", () => {
    const result = lerpSnap(0, 100, 0.5, 1, 0.01);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it("returns target if already at target", () => {
    expect(lerpSnap(50, 50, 0.5, 1, 0.01)).toBe(50);
  });

  it("handles large dt", () => {
    const result = lerpSnap(0, 100, 0.5, 10, 0.01);
    expect(result).toBe(100);
  });
});

describe("getParentPath", () => {
  it("returns parent of nested path", () => {
    expect(getParentPath("C:\\Users\\test")).toBe("C:\\Users");
  });

  it("returns parent with forward slashes", () => {
    expect(getParentPath("/home/user/docs")).toBe("/home/user");
  });

  it("returns null for root-like paths", () => {
    expect(getParentPath("C:\\")).toBeNull();
    expect(getParentPath("/")).toBeNull();
    expect(getParentPath("")).toBeNull();
  });

  it("handles mixed separators", () => {
    expect(getParentPath("D:/Projects/foo")).toBe("D:/Projects");
  });

  it("appends backslash for drive root", () => {
    expect(getParentPath("D:\\Projects")).toBe("D:\\");
  });

  it("returns null for single-part path", () => {
    expect(getParentPath("/home")).toBeNull();
  });
});

describe("getNodeAtPosition", () => {
  function makeAnim(overrides: Partial<AnimatedNode> = {}): AnimatedNode {
    return {
      key: "test",
      curX: 100,
      curY: 100,
      curRadius: 50,
      curAlpha: 1,
      label: "test",
      isDir: false,
      isAction: false,
      isBack: false,
      worldX: 100,
      worldY: 100,
      radius: 50,
      baseColor: "#fff",
      ...overrides,
    };
  }

  it("returns index when point is inside circle", () => {
    const nodes = [makeAnim()];
    expect(getNodeAtPosition(120, 120, nodes)).toBe(0);
  });

  it("returns null when point is outside all circles", () => {
    const nodes = [makeAnim()];
    expect(getNodeAtPosition(200, 200, nodes)).toBeNull();
  });

  it("finds the first matching node when overlapping", () => {
    const nodes = [
      makeAnim({ curX: 50, curY: 50, curRadius: 100 }),
      makeAnim({ curX: 100, curY: 100, curRadius: 100 }),
    ];
    expect(getNodeAtPosition(60, 60, nodes)).toBe(0);
  });
});

  describe("clampCoordinates", () => {
    beforeAll(() => {
      vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080 });
    });

    const MARGIN = Math.min(245, 1080 * 0.15); // 162

  it("clamps x to minimum margin", () => {
    const result = clampCoordinates(0, 500);
    expect(result.x).toBe(MARGIN);
  });

  it("clamps y to minimum margin", () => {
    const result = clampCoordinates(500, 0);
    expect(result.y).toBe(MARGIN);
  });

  it("clamps x to maximum margin", () => {
    const result = clampCoordinates(2000, 500);
    expect(result.x).toBe(1920 - MARGIN);
  });

  it("clamps y to maximum margin", () => {
    const result = clampCoordinates(500, 2000);
    expect(result.y).toBe(1080 - MARGIN);
  });

  it("does not change values within bounds", () => {
    const result = clampCoordinates(500, 500);
    expect(result.x).toBe(500);
    expect(result.y).toBe(500);
  });
});

describe("nodeKey", () => {
  function makeNode(overrides: Partial<RenderNode> = {}): RenderNode {
    return {
      label: "test",
      isDir: false,
      isAction: false,
      isBack: false,
      worldX: 0,
      worldY: 0,
      radius: 30,
      baseColor: "#fff",
      ...overrides,
    };
  }

  it("returns 'center' for index 0", () => {
    expect(nodeKey(makeNode(), 0)).toBe("center");
  });

  it("returns action key for action nodes", () => {
    expect(nodeKey(makeNode({ isAction: true, actionId: "open" }), 1)).toBe("action:open");
  });

  it("returns 'back' for back nodes", () => {
    expect(nodeKey(makeNode({ isBack: true }), 1)).toBe("back");
  });

  it("returns item key for file/dir nodes", () => {
    expect(nodeKey(makeNode({ path: "/foo/bar" }), 2)).toBe("item:/foo/bar");
  });

  it("falls back to label when path is missing", () => {
    expect(nodeKey(makeNode({ label: "name-only" }), 2)).toBe("item:name-only");
  });
});
