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
  itemsList: FileItem[]
): RenderNode[] {
  const newVisible: RenderNode[] = [];
  const pathParts  = currentPath.split(/[\\/]/);
  const folderName = selectedFile
    ? selectedFile.name
    : (pathParts[pathParts.length - 1] || currentPath);

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

  const angles: number[] = [];
  const parentState = pathHistory[pathHistory.length - 1];

  // Check if currentPath has a parent directory dynamically
  const hasParent = getParentPath(currentPath) !== null;

  // Use history parents or generate a virtual parent direction above
  let resolvedParentState = parentState;
  if (!resolvedParentState && hasParent && !selectedFile && !showFolderTools && !selectedEditor) {
    resolvedParentState = { path: "", x: originX, y: originY - 200 };
  }

  let satCount = 0;
  if (selectedEditor) {
    satCount = new Set(["vscode","antigravity","visualstudio"]).has(selectedEditor) ? 3 : 2;
  } else if (selectedFile || showFolderTools) {
    satCount = TOOLS.length;
  } else {
    satCount = Math.min(itemsList.length, 12);
  }

  // Bi-arc layout only when actively browsing folders and files
  const isBrowsing = !selectedFile && !showFolderTools && !selectedEditor;
  if (resolvedParentState && satCount > 0 && isBrowsing) {
    const dx = resolvedParentState.x - originX;
    const dy = resolvedParentState.y - originY;
    const angleToParent = Math.atan2(dy, dx);
    const halfCount = Math.ceil(satCount / 2);
    const arcSpan   = Math.PI * 0.52;
    const start1    = (angleToParent + Math.PI / 2) - arcSpan / 2;
    for (let i = 0; i < halfCount; i++) {
      angles.push(halfCount === 1 ? angleToParent + Math.PI / 2
        : start1 + (i * arcSpan) / (halfCount - 1));
    }
    const rem = satCount - halfCount;
    if (rem > 0) {
      const start2 = (angleToParent - Math.PI / 2) - arcSpan / 2;
      for (let i = 0; i < rem; i++) {
        angles.push(rem === 1 ? angleToParent - Math.PI / 2
          : start2 + (i * arcSpan) / (rem - 1));
      }
    }
  } else {
    // Standard full circle even spacing
    for (let i = 0; i < satCount; i++) {
      angles.push((2 * Math.PI * i) / satCount - Math.PI / 2);
    }
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
      // If folder tools, rename back action label to "↩ back" instead of "↩ cd .."
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
  } else {
    const dist = 200 * expansionPos;

    // 1) Position the cd .. back button precisely facing the parent direction
    if (hasParent && resolvedParentState) {
      const dx = resolvedParentState.x - originX;
      const dy = resolvedParentState.y - originY;
      const ang = Math.atan2(dy, dx);
      newVisible.push({
        label: "↩ cd ..", isDir: true, isAction: false, isBack: true,
        worldX: originX + dist * Math.cos(ang),
        worldY: originY + dist * Math.sin(ang),
        radius: 38, baseColor: "#c0392b"
      });
    }

    // 2) Position standard directory file and folder elements
    for (let i = 0; i < Math.min(itemsList.length, 12); i++) {
      const item = itemsList[i];
      const angle = angles[i];
      newVisible.push({
        label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
        path: item.path,
        worldX: originX + dist * Math.cos(angle),
        worldY: originY + dist * Math.sin(angle),
        radius: item.is_dir ? 45 : 35,
        baseColor: item.is_dir ? "#4a90e2" : "#e2a94a"
      });
    }
  }

  return newVisible;
}
