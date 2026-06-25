import { FileItem, HistoryState, RenderNode } from "./types";
import { TOOLS, COLORS, fileColor, MAX_VISIBLE_ITEMS } from "./config";
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

  // Center node — label may be updated below if items truncated
  let centerLabel = selectedEditor ? selectedEditor.toUpperCase() : folderName;
  newVisible.push({
    label:     centerLabel,
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

    const itemsToDisplay = itemsList.slice(0, MAX_VISIBLE_ITEMS);
    const itemCount = itemsToDisplay.length;

    // Append (+N) to center label when items are truncated
    if (itemsList.length > MAX_VISIBLE_ITEMS) {
      newVisible[0].label = `${centerLabel} (+${itemsList.length - MAX_VISIBLE_ITEMS})`;
    }

    // Dynamic scaling for large directories
    const scale = itemCount > 12 ? Math.max(0.6, 12 / itemCount) : 1;
    const dist = (200 + Math.max(0, itemCount - 12) * 8) * expansionPos;

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
        const satRadius = item.is_dir ? Math.max(45 * scale, 28) : Math.max(35 * scale, 28);

        newVisible.push({
          label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
          path: item.path,
          worldX: isExited && justExitedX != null ? justExitedX : normalX,
          worldY: isExited && justExitedY != null ? justExitedY : normalY,
          radius: satRadius,
          baseColor: isExited ? COLORS.exited : (item.is_dir ? COLORS.dir : fileColor(item.name))
        });
      });

    } else {
      // ─── CASE 4: No parent (Root, e.g., D:/) ───
      const N = itemsToDisplay.length;

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
        const satRadius = item.is_dir ? Math.max(45 * scale, 28) : Math.max(35 * scale, 28);

        newVisible.push({
          label: item.name, isDir: item.is_dir, isAction: false, isBack: false,
          path: item.path,
          worldX: isExited && justExitedX != null ? justExitedX : normalX,
          worldY: isExited && justExitedY != null ? justExitedY : normalY,
          radius: satRadius,
          baseColor: isExited ? COLORS.exited : (item.is_dir ? COLORS.dir : fileColor(item.name))
        });
      });
    }

    // ⚙ Tools action node — always visible in browsing mode
    newVisible.push({
      label: "⚙ Tools",
      isDir: false,
      isAction: true,
      actionId: "show_tools",
      isBack: false,
      worldX: originX + Math.min(dist, 200 * expansionPos) * Math.cos(Math.PI / 2),
      worldY: originY + Math.min(dist, 200 * expansionPos) * Math.sin(Math.PI / 2),
      radius: 25,
      baseColor: COLORS.tools,
    });

    // Breadcrumb nodes for parent path segments
    if (pathParts.length > 1) {
      const crumbs = pathParts.slice(0, -1); // all but the current folder
      const crumbsDist = 120 * expansionPos;
      const startAngle = -Math.PI / 2 - ((crumbs.length - 1) * 0.2) / 2;
      crumbs.forEach((part, i) => {
        const crumbPath = pathParts.slice(0, i + 1).join("\\");
        const angle = startAngle + i * 0.2;
        newVisible.push({
          label: part,
          isDir: true,
          isAction: false,
          path: crumbPath,
          isBack: false,
          worldX: originX + crumbsDist * Math.cos(angle),
          worldY: originY + crumbsDist * Math.sin(angle),
          radius: 22,
          baseColor: COLORS.back,
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
