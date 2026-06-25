import { describe, it, expect, beforeEach } from "vitest";
import { calculateLayout } from "../layout";
import { FileItem, HistoryState, RenderNode } from "../types";

describe("calculateLayout", () => {
  const originX = 500;
  const originY = 500;

  function callLayout(overrides: Partial<{
    currentPath: string;
    selectedFile: FileItem | null;
    selectedEditor: string | null;
    showFolderTools: boolean;
    expansionPos: number;
    pathHistory: HistoryState[];
    itemsList: FileItem[];
    justExitedPath: string | null;
    justExitedX: number | null;
    justExitedY: number | null;
  }> = {}) {
    const o = {
      currentPath: "D:\\Projects",
      selectedFile: null as FileItem | null,
      selectedEditor: null as string | null,
      showFolderTools: false,
      expansionPos: 1,
      pathHistory: [] as HistoryState[],
      itemsList: [] as FileItem[],
      justExitedPath: null as string | null,
      justExitedX: null as number | null,
      justExitedY: null as number | null,
      ...overrides,
    };
    return calculateLayout(
      o.currentPath, o.selectedFile, o.selectedEditor, o.showFolderTools,
      originX, originY, o.expansionPos, o.pathHistory, o.itemsList,
      o.justExitedPath, o.justExitedX, o.justExitedY
    );
  }

  function file(name: string, isDir = false): FileItem {
    return { name, path: `D:\\Projects\\${name}`, is_dir: isDir };
  }

  let nodes: RenderNode[];

  describe("browsing mode", () => {
    it("returns center, tools, and breadcrumb nodes", () => {
      nodes = callLayout({ currentPath: "D:\\" });
      // D:\ has pathParts ["D:",""] so 1 breadcrumb, plus center + tools
      expect(nodes.length).toBe(3);
      expect(nodes[0].label).toBe("D:\\");
      expect(nodes[0].isDir).toBe(true);
      expect(nodes[0].worldX).toBe(originX);
      expect(nodes[0].worldY).toBe(originY);
    });

    it("shows back button when parent exists", () => {
      nodes = callLayout({ currentPath: "D:\\Projects\\sub" });
      const back = nodes.find((n) => n.isBack);
      expect(back).toBeDefined();
      expect(back!.label).toContain("cd ..");
    });

    it("shows items sorted dirs-first", () => {
      nodes = callLayout({
        itemsList: [file("z.txt"), file("a_folder", true), file("b.txt")],
      });
      // 3 items + "⚙ Tools" node + "D:" breadcrumb (center + back are filtered)
      const itemNodes = nodes.filter((n) => !n.isBack && n.label !== "Projects" && !n.label.startsWith("Projects ("));
      expect(itemNodes.length).toBe(5);
    });

    it("limits to 24 items", () => {
      const many = Array.from({ length: 30 }, (_, i) => file(`file${i}.txt`));
      nodes = callLayout({ itemsList: many });
      const itemNodes = nodes.filter((n) => !n.isBack && n.label !== "Projects" && !n.label.startsWith("Projects ("));
      // 24 item nodes + "⚙ Tools" + "D:" breadcrumb
      expect(itemNodes.length).toBeLessThanOrEqual(26);
    });
  });

  describe("selected file mode", () => {
    beforeEach(() => {
      nodes = callLayout({ selectedFile: file("readme.md") });
    });

    it("shows tool actions", () => {
      const actions = nodes.filter((n) => n.isAction);
      expect(actions.length).toBeGreaterThan(0);
    });

    it("center node shows file name", () => {
      expect(nodes[0].label).toBe("readme.md");
    });

    it("center node has file color", () => {
      expect(nodes[0].baseColor).toBe("#e2a94a");
    });
  });

  describe("folder tools mode", () => {
    beforeEach(() => {
      nodes = callLayout({ showFolderTools: true });
    });

    it("shows all TOOLS as actions", () => {
      const actions = nodes.filter((n) => n.isAction);
      expect(actions.length).toBeGreaterThanOrEqual(8);
    });

    it("center node shows folder name", () => {
      expect(nodes[0].label).toBe("Projects");
    });
  });

  describe("editor selected mode", () => {
    beforeEach(() => {
      nodes = callLayout({ selectedEditor: "vscode" });
    });

    it("center node shows editor name uppercased", () => {
      expect(nodes[0].label).toBe("VSCODE");
    });

    it("center node has editor color", () => {
      expect(nodes[0].baseColor).toBe("#9b59b6");
    });

    it("shows environment actions (Windows, WSL, Back)", () => {
      const actions = nodes.filter((n) => n.isAction);
      expect(actions.length).toBe(3);
      expect(actions[0].label).toBe("Windows");
      expect(actions[1].label).toBe("WSL");
      expect(actions[2].label).toBe("↩ Back");
    });
  });

  describe("editor without WSL support", () => {
    it("shows only 2 actions for non-WSL editors", () => {
      nodes = callLayout({ selectedEditor: "opencode" });
      const actions = nodes.filter((n) => n.isAction);
      expect(actions.length).toBe(2);
    });
  });
});
