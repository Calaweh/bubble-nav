import { FileItem, HistoryState, RenderNode } from "./types";
import { TOOLS, COLORS, fileColor } from "./config";
import { getParentPath } from "./utils";

export function calculateLayout(
  currentPath: string,
  selectedFile: FileItem | null,
  selectedEditor: string | null,
  showFolderTools: boolean,
  originX: number,
  originY: number,
  expansionPos: number,
  pathHistory: HistoryState[],
  itemsList: FileItem[],
  justExitedPath?: string | null,
  justExitedX?: number | null,
  justExitedY?: number | null
): RenderNode[] {
  const newVisible: RenderNode[] = [];
  const pathParts  = currentPath.split(/[\\/]/);
  const folderName = selectedFile
    ? selectedFile.name
    : (pathParts[pathParts.length - 1] || currentPath);

  // Center node
  newVisible.push({
    label:     selectedEditor ? selectedEditor.toUpperCase() : folderName,
    isDir:     !selectedFile,
    isAction:  false,
    isBack:    false,
    worldX:    originX,
    worldY:    originY,
    radius:    65,
    baseColor: selectedEditor ? COLORS.centerEditor : selectedFile ? COLORS.centerFile : COLORS.center
  });

  const isBrowsing = !selectedFile && !showFolderTools && !selectedEditor;

  if (isBrowsing) {
    const dist = 200 * expansionPos;
    const hasParent = getParentPath(currentPath) !== null;
    const parentState = pathHistory[pathHistory.length - 1];

    let resolvedParentState = parentState;
    if (!resolvedParentState && hasParent) {
      resolvedParentState = { path: "", x: originX, y: originY - 200, exitX: originX, exitY: originY - 200 };
    }

    let angleToParent = -Math.PI / 2;
    if (resolvedParentState) {
      const dx = resolvedParentState.x - originX;
      const dy = resolvedParentState.y - originY;
      angleToParent = Math.atan2(dy, dx);
    }

    const maxItems = 12;
    const itemsToDisplay = itemsList.slice(0, maxItems);

    let exitedItemIndex = -1;
    if (justExitedPath) {
      const normExited = justExitedPath.replace(/\\/g, "/").toLowerCase();
      exitedItemIndex = itemsToDisplay.findIndex(item =>
        item.path.replace(/\\/g, "/").toLowerCase() === normExited
      );
    }

    if (hasParent) {
      // ─── CASE 3: Has parent ───
      newVisible.push({
        label: "↩ cd ..", isDir: true, isAction: false, isBack: true,
        worldX: originX + dist * Math.cos(angleToParent),
        worldY: originY + dist * Math.sin(angleToParent),
        radius: 38,
        baseColor: COLORS.back
      });

      const N = itemsToDisplay.length;
      itemsToDisplay.forEach((item, i) => {
        const isExited = i === exitedItemIndex;
        const angle = angleToParent + (2 * Math.PI * (i + 1)) / (N + 1);
        const normalX = originX + dist * Math.cos(angle);
        const normalY = originY + dist * Math.sin(angle);

        newVisible.push({
          label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
          path: item.path,
          worldX: isExited && justExitedX != null ? justExitedX : normalX,
          worldY: isExited && justExitedY != null ? justExitedY : normalY,
          radius: item.is_dir ? 45 : 35,
          baseColor: isExited ? COLORS.exited : (item.is_dir ? COLORS.dir : fileColor(item.name))
        });
      });

    } else {
      // ─── CASE 4: No parent (Root, e.g., D:/) ───
      const N = itemsToDisplay.length;

      // Calculate a rotation offset so the entire wheel rotates seamlessly,
      // placing the yellow exited node at the bottom, keeping perfect spacing
      // with other nodes and preventing any overlaps.
      let rotationOffset = 0;
      if (exitedItemIndex !== -1 && justExitedX != null && justExitedY != null) {
        const targetAngle = Math.atan2(justExitedY - originY, justExitedX - originX);
        const defaultAngle = (2 * Math.PI * exitedItemIndex) / N - Math.PI / 2;
        rotationOffset = targetAngle - defaultAngle;
      }

      itemsToDisplay.forEach((item, i) => {
        const isExited = i === exitedItemIndex;
        const angle = (2 * Math.PI * i) / N - Math.PI / 2 + rotationOffset;
        const normalX = originX + dist * Math.cos(angle);
        const normalY = originY + dist * Math.sin(angle);

        newVisible.push({
          label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
          path: item.path,
          worldX: isExited && justExitedX != null ? justExitedX : normalX,
          worldY: isExited && justExitedY != null ? justExitedY : normalY,
          radius: item.is_dir ? 45 : 35,
          baseColor: isExited ? COLORS.exited : (item.is_dir ? COLORS.dir : fileColor(item.name))
        });
      });
    }

  } else {
    const angles: number[] = [];
    let satCount = 0;
    if (selectedEditor) {
      satCount = new Set(["vscode","antigravity","visualstudio"]).has(selectedEditor) ? 3 : 2;
    } else if (selectedFile || showFolderTools) {
      satCount = TOOLS.length;
    }
    for (let i = 0; i < satCount; i++) {
      angles.push((2 * Math.PI * i) / satCount - Math.PI / 2);
    }

    if (selectedEditor) {
      const dist = 180 * expansionPos;
      const envActions = [
        { label: "Windows", action: "launch_window",  color: COLORS.file },
        ...(new Set(["vscode","antigravity","visualstudio"]).has(selectedEditor)
          ? [{ label: "WSL", action: "launch_wsl", color: COLORS.wsl }]
          : []),
        { label: "↩ Back", action: "cancel_editor", color: COLORS.back }
      ];
      envActions.forEach((act, i) => {
        newVisible.push({
          label: act.label, isDir: false, isAction: true, isBack: false,
          actionId: act.action,
          worldX: originX + dist * Math.cos(angles[i]),
          worldY: originY + dist * Math.sin(angles[i]),
          radius: 40, baseColor: act.color
        });
      });
    } else if (selectedFile || showFolderTools) {
      const dist = 180 * expansionPos;
      TOOLS.forEach((tool, i) => {
        const label = (showFolderTools && tool.action === "back") ? "↩ back" : tool.label;
        newVisible.push({
          label, isDir: false, isAction: true, isBack: false,
          actionId: tool.action,
          worldX: originX + dist * Math.cos(angles[i]),
          worldY: originY + dist * Math.sin(angles[i]),
          radius: 40, baseColor: tool.color
        });
      });
    }
  }

  return newVisible;
}
