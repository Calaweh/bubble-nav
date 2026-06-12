import { FileItem, HistoryState, RenderNode } from "./types";
import { TOOLS } from "./config";
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
  justExitedAngle?: number | null
): RenderNode[] {
  const newVisible: RenderNode[] = [];
  const pathParts  = currentPath.split(/[\\/]/);
  const folderName = selectedFile
    ? selectedFile.name
    : (pathParts[pathParts.length - 1] || currentPath);

  // 1. Center main node
  newVisible.push({
    label:     selectedEditor ? selectedEditor.toUpperCase() : folderName,
    isDir:     !selectedFile,
    isAction:  false,
    isBack:    false,
    worldX:    originX,
    worldY:    originY,
    radius:    65,
    baseColor: selectedEditor ? "#8e44ad" : selectedFile ? "#e2a94a" : "#2c313a"
  });

  const isBrowsing = !selectedFile && !showFolderTools && !selectedEditor;

  if (isBrowsing) {
    const dist = 200 * expansionPos;
    const hasParent = getParentPath(currentPath) !== null;
    const parentState = pathHistory[pathHistory.length - 1];

    let resolvedParentState = parentState;
    if (!resolvedParentState && hasParent) {
      resolvedParentState = { path: "", x: originX, y: originY - 200 };
    }

    let angleToParent = -Math.PI / 2;
    if (resolvedParentState) {
      const dx = resolvedParentState.x - originX;
      const dy = resolvedParentState.y - originY;
      angleToParent = Math.atan2(dy, dx);
    }

    // Limit items to display (maximum 11 if we need space for a "cd .." node)
    const maxItems = hasParent ? 11 : 12;
    const itemsToDisplay = itemsList.slice(0, maxItems);

    let exitedItemIndex = -1;
    if (justExitedPath) {
      exitedItemIndex = itemsToDisplay.findIndex(item => item.path === justExitedPath);
    }

    if (exitedItemIndex !== -1) {
      const exitedItem = itemsToDisplay[exitedItemIndex];
      const finalExitedAngle = justExitedAngle !== undefined && justExitedAngle !== null
        ? justExitedAngle
        : angleToParent + Math.PI;

      if (hasParent) {
        // ─── Case 1: Has parent AND contains the folder we just exited ───
        // 1) Position the cd .. back button
        newVisible.push({
          label: "↩ cd ..", isDir: true, isAction: false, isBack: true,
          worldX: originX + dist * Math.cos(angleToParent),
          worldY: originY + dist * Math.sin(angleToParent),
          radius: 38,
          baseColor: "#c0392b"
        });

        // 2) Position the "just exited" folder in yellow
        newVisible.push({
          label: exitedItem.name, isDir: exitedItem.is_dir, isAction: false, isBack: false,
          path: exitedItem.path,
          worldX: originX + dist * Math.cos(finalExitedAngle),
          worldY: originY + dist * Math.sin(finalExitedAngle),
          radius: exitedItem.is_dir ? 45 : 35,
          baseColor: "#f1c40f" // Special bright yellow color highlight
        });

        // 3) Split and balance the remaining items on left & right sides
        const otherItems = itemsToDisplay.filter((_, idx) => idx !== exitedItemIndex);
        const M = otherItems.length;
        const k1 = Math.ceil(M / 2);
        const k2 = M - k1;

        otherItems.forEach((item, i) => {
          let angle = 0;
          if (i < k1) {
            angle = angleToParent + (Math.PI * (i + 1)) / (k1 + 1);
          } else {
            const j = i - k1;
            angle = angleToParent - (Math.PI * (j + 1)) / (k2 + 1);
          }
          newVisible.push({
            label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
            path: item.path,
            worldX: originX + dist * Math.cos(angle),
            worldY: originY + dist * Math.sin(angle),
            radius: item.is_dir ? 45 : 35,
            baseColor: item.is_dir ? "#4a90e2" : "#e2a94a"
          });
        });
      } else {
        // ─── Case 2: No parent BUT contains the folder we just exited ───
        // We space all N items evenly around the entire 360-degree circle to balance distance
        const N = itemsToDisplay.length;

        itemsToDisplay.forEach((item, i) => {
          if (i === exitedItemIndex) {
            newVisible.push({
              label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
              path: item.path,
              worldX: originX + dist * Math.cos(finalExitedAngle),
              worldY: originY + dist * Math.sin(finalExitedAngle),
              radius: item.is_dir ? 45 : 35,
              baseColor: "#f1c40f" // Special bright yellow color highlight
            });
          } else {
            // Shift coordinates so that other items fill the remaining 11 slices perfectly
            const shift = i > exitedItemIndex ? i : i + 1;
            const angle = finalExitedAngle + (2 * Math.PI * shift) / N;
            newVisible.push({
              label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
              path: item.path,
              worldX: originX + dist * Math.cos(angle),
              worldY: originY + dist * Math.sin(angle),
              radius: item.is_dir ? 45 : 35,
              baseColor: item.is_dir ? "#4a90e2" : "#e2a94a"
            });
          }
        });
      }
    } else if (hasParent) {
      // ─── Case 3: Has parent but NO "just exited" folder ───
      const N = itemsToDisplay.length;
      newVisible.push({
        label: "↩ cd ..", isDir: true, isAction: false, isBack: true,
        worldX: originX + dist * Math.cos(angleToParent),
        worldY: originY + dist * Math.sin(angleToParent),
        radius: 38,
        baseColor: "#c0392b"
      });

      itemsToDisplay.forEach((item, i) => {
        const angle = angleToParent + (2 * Math.PI * (i + 1)) / (N + 1);
        newVisible.push({
          label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
          path: item.path,
          worldX: originX + dist * Math.cos(angle),
          worldY: originY + dist * Math.sin(angle),
          radius: item.is_dir ? 45 : 35,
          baseColor: item.is_dir ? "#4a90e2" : "#e2a94a"
        });
      });
    } else {
      // ─── Case 4: No parent and NO "just exited" folder (at computer root) ───
      const N = itemsToDisplay.length;
      itemsToDisplay.forEach((item, i) => {
        const angle = (2 * Math.PI * i) / N - Math.PI / 2;
        newVisible.push({
          label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
          path: item.path,
          worldX: originX + dist * Math.cos(angle),
          worldY: originY + dist * Math.sin(angle),
          radius: item.is_dir ? 45 : 35,
          baseColor: item.is_dir ? "#4a90e2" : "#e2a94a"
        });
      });
    }
  } else {
    // Actions / Tools layout (remains unchanged)
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
        { label: "Windows", action: "launch_window",  color: "#2ecc71" },
        ...(new Set(["vscode","antigravity","visualstudio"]).has(selectedEditor)
          ? [{ label: "WSL", action: "launch_wsl",    color: "#8e44ad" }]
          : []),
        { label: "↩ Back",  action: "cancel_editor",  color: "#c0392b" }
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
        let label = tool.label;
        if (showFolderTools && tool.action === "back") {
          label = "↩ back";
        }
        newVisible.push({
          label: label, isDir: false, isAction: true, isBack: false,
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
