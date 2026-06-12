import { invoke } from "@tauri-apps/api/core";
import { enable } from "@tauri-apps/plugin-autostart";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { FileItem, HistoryState, RenderNode, AnimatedNode } from "./types";
import { 
  START_PATH, 
  EXPAND_RATE, 
  COLLAPSE_RATE, 
  NODE_MOVE_RATE, 
  NODE_ALPHA_RATE, 
  NODE_RAD_RATE, 
  NODE_EXIT_RATE, 
  POS_SNAP, 
  ALPHA_SNAP, 
  RAD_SNAP 
} from "./config";
import { 
  lerpSnap, 
  getParentPath, 
  getNodeAtPosition, 
  clampCoordinates, 
  nodeKey 
} from "./utils";
import { drawBubble, drawConnection, drawLabel } from "./renderer";
import { calculateLayout } from "./layout";

let currentPath = START_PATH;
let itemsList: FileItem[] = [];
let selectedFile: FileItem | null = null;

let showFolderTools = false;
let selectedEditor: string | null = null;

let originX = window.innerWidth / 2;
let originY = window.innerHeight / 2;

let expansionPos    = 0;
let targetExpansion = 1; // Always expanded by default

let lastFrameTime = 0;
let isAnimating = false;

// Hold-to-navigate state
let isHolding   = false;
let draggedAway = false;
let mouseDownX  = 0;
let mouseDownY  = 0;

// Async loading lock to prevent thread lag
let isLoadingDir = false;

// Cursor tracking for holding tether line
let currentMouseX = window.innerWidth / 2;
let currentMouseY = window.innerHeight / 2;

let pathHistory: HistoryState[] = [];
let hoveredNodeIndex: number | null = null;

let visibleNodes: RenderNode[] = [];
let animatedNodes: AnimatedNode[] = [];

// New retention features
let justExitedPath: string | null = null;
let justExitedAngle: number | null = null;

function getActiveTargetPath(): string {
  return selectedFile ? selectedFile.path : currentPath;
}

function syncAnimatedNodes(dt: number): boolean {
  let moving = false;
  const usedKeys = new Set<string>();

  visibleNodes.forEach((node, index) => {
    const key = nodeKey(node, index);
    usedKeys.add(key);

    let anim = animatedNodes.find((a) => a.key === "center");
    if (index !== 0 || !anim) {
      anim = animatedNodes.find((a) => a.key === key);
    }
    
    if (!anim) {
      const isCenter = index === 0;
      const centerAnim = animatedNodes.find(a => a.key === "center");
      anim = {
        ...node, key,
        curX:      isCenter ? node.worldX : (centerAnim ? centerAnim.curX : originX),
        curY:      isCenter ? node.worldY : (centerAnim ? centerAnim.curY : originY),
        curRadius: isCenter ? node.radius : 0,
        curAlpha:  isCenter ? 1 : 0,
      };
      animatedNodes.push(anim);
    }

    anim.label     = node.label;
    anim.isDir     = node.isDir;
    anim.isAction  = node.isAction;
    anim.isBack    = node.isBack;
    anim.actionId  = node.actionId;
    anim.path      = node.path;
    anim.worldX    = node.worldX;
    anim.worldY    = node.worldY;
    anim.radius    = node.radius;
    anim.baseColor = node.baseColor;

    const tgtAlpha = index === 0 ? 1 : expansionPos;

    const newX = lerpSnap(anim.curX,      anim.worldX, NODE_MOVE_RATE,  dt, POS_SNAP);
    const newY = lerpSnap(anim.curY,      anim.worldY, NODE_MOVE_RATE,  dt, POS_SNAP);
    const newR = lerpSnap(anim.curRadius, anim.radius, NODE_RAD_RATE,   dt, RAD_SNAP);
    const newA = lerpSnap(anim.curAlpha,  tgtAlpha,    NODE_ALPHA_RATE, dt, ALPHA_SNAP);

    if (newX !== anim.curX || newY !== anim.curY || newR !== anim.curRadius || newA !== anim.curAlpha)
      moving = true;

    anim.curX = newX; anim.curY = newY; anim.curRadius = newR; anim.curAlpha = newA;
  });

  animatedNodes = animatedNodes.filter((a) => {
    if (usedKeys.has(a.key)) return true;
    const newX = lerpSnap(a.curX,      originX, NODE_EXIT_RATE, dt, POS_SNAP);
    const newY = lerpSnap(a.curY,      originY, NODE_EXIT_RATE, dt, POS_SNAP);
    const newR = lerpSnap(a.curRadius, 0,       NODE_EXIT_RATE, dt, RAD_SNAP);
    const newA = lerpSnap(a.curAlpha,  0,       NODE_EXIT_RATE, dt, ALPHA_SNAP);
    if (newX !== a.curX || newY !== a.curY || newR !== a.curRadius || newA !== a.curAlpha) moving = true;
    a.curX = newX; a.curY = newY; a.curRadius = newR; a.curAlpha = newA;
    return a.curRadius > RAD_SNAP || a.curAlpha > ALPHA_SNAP;
  });

  animatedNodes.sort((a, b) => {
    if (a.key === "center") return -1;
    if (b.key === "center") return 1;
    return 0;
  });

  return moving;
}

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("bubble-canvas") as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!showFolderTools && !selectedFile) {
      originX = window.innerWidth  / 2;
      originY = window.innerHeight / 2;
    }
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  async function loadCurrentDirectory() {
    if (isLoadingDir) return;
    isLoadingDir = true;
    try {
      itemsList = await invoke("read_directory", { path: currentPath });
      selectedFile = null;
      startAnimation();
    } catch (err) {
      console.error("Failed to load path:", err);
    } finally {
      isLoadingDir = false;
    }
  }

  function startAnimation() {
    if (isAnimating) return;
    isAnimating   = true;
    lastFrameTime = 0;
    requestAnimationFrame(draw);
  }

  function triggerOpen() {
    expansionPos    = 0;
    targetExpansion = 1;
    startAnimation();
  }

  function draw(timestamp: number) {
    const dt = lastFrameTime
      ? Math.min((timestamp - lastFrameTime) / (1000 / 60), 3)
      : 1;
    lastFrameTime = timestamp;

    ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const rate = targetExpansion > expansionPos ? EXPAND_RATE : COLLAPSE_RATE;
    expansionPos = lerpSnap(expansionPos, targetExpansion, rate, dt, 0.002);
    const expansionSettled = expansionPos === targetExpansion;

    visibleNodes = calculateLayout(
      currentPath,
      selectedFile,
      selectedEditor,
      showFolderTools,
      originX,
      originY,
      expansionPos,
      pathHistory,
      itemsList,
      justExitedPath,
      justExitedAngle
    );
    const nodesMoving = syncAnimatedNodes(dt);

    // Draw active connections
    const centerNode = animatedNodes.find(a => a.key === "center");
    animatedNodes.forEach((node) => {
      if (node.key === "center" || !centerNode) return;
      const isHov = hoveredNodeIndex !== null
        && animatedNodes[hoveredNodeIndex]?.key === node.key
        && expansionPos > 0.85;
      drawConnection(ctx!, centerNode.curX, centerNode.curY, node.curX, node.curY, node.curAlpha, isHov);
    });

    // Draw bubbles + labels
    animatedNodes.forEach((node) => {
      const isCenter = node.key === "center";
      const isHov    = hoveredNodeIndex !== null
        && animatedNodes[hoveredNodeIndex]?.key === node.key
        && expansionPos > 0.85;
      const alpha = isCenter ? 1 : node.curAlpha;
      drawBubble(ctx!, node.curX, node.curY, node.curRadius, node.baseColor, alpha, isHov);
      drawLabel(ctx!, node.label, node.curX, node.curY, node.curRadius, alpha, isCenter);
    });

    // Draw active tether on top — from bubble edge toward mouse cursor
    if (isHolding) {
      const cn = animatedNodes.find(a => a.key === "center");
      if (cn) {
        const hov = hoveredNodeIndex !== null ? animatedNodes[hoveredNodeIndex] : null;
        const ax = hov && hov.key !== "center" ? hov.curX : cn.curX;
        const ay = hov && hov.key !== "center" ? hov.curY : cn.curY;
        const ar = hov && hov.key !== "center" ? hov.curRadius : cn.curRadius;
        const dx = currentMouseX - ax;
        const dy = currentMouseY - ay;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pad = ar + 4;
        const sx = dist > pad ? ax + (dx / dist) * pad : ax;
        const sy = dist > pad ? ay + (dy / dist) * pad : ay;
        drawConnection(ctx!, sx, sy, currentMouseX, currentMouseY, 1, true);
      }
    }

    if (expansionSettled && !nodesMoving && !isHolding) {
      isAnimating = false;
      return;
    }

    requestAnimationFrame(draw);
  }

  canvas.addEventListener("mousemove", async (e) => {
    currentMouseX = e.clientX;
    currentMouseY = e.clientY;

    const prev = hoveredNodeIndex;
    hoveredNodeIndex = getNodeAtPosition(e.clientX, e.clientY, animatedNodes);
    canvas.style.cursor = hoveredNodeIndex !== null ? "pointer" : "default";
    if (prev !== hoveredNodeIndex) startAnimation();

    if (isLoadingDir) return;

    if (isHolding) {
      const dx = e.clientX - mouseDownX;
      const dy = e.clientY - mouseDownY;
      if (dx * dx + dy * dy > 25 * 25) {
        draggedAway = true;
      }

      if (draggedAway && hoveredNodeIndex !== null && expansionPos > 0.8) {
        const hoveredAnim = animatedNodes[hoveredNodeIndex];
        const hoveredNode = visibleNodes.find((n, idx) => nodeKey(n, idx) === hoveredAnim.key);

        if (hoveredNode && hoveredAnim.key !== "center") {
          // 1) Folder Hovered -> Continue deep into the folder
          if (hoveredNode.isDir && hoveredNode.path && currentPath !== hoveredNode.path && !hoveredNode.isBack) {
            pathHistory.push({ path: currentPath, x: originX, y: originY });
            currentPath = hoveredNode.path;
            const clamped = clampCoordinates(hoveredNode.worldX, hoveredNode.worldY);
            originX = clamped.x;
            originY = clamped.y;

            // Clear exited path indicators since we navigated down
            justExitedPath = null;
            justExitedAngle = null;
            
            draggedAway = false;
            mouseDownX  = originX;
            mouseDownY  = originY;

            hoveredNodeIndex = null;
            expansionPos = 0;
            targetExpansion = 1;
            startAnimation();
            await loadCurrentDirectory();
            return;
          }

          // 2) cd .. Back Button Hovered -> Move up a folder level
          if (hoveredNode.isBack) {
            // Pre-calculate retention metrics relative to the current center
            const bdx = hoveredNode.worldX - originX;
            const bdy = hoveredNode.worldY - originY;
            const ang = Math.atan2(bdy, bdx);

            justExitedPath = currentPath;
            justExitedAngle = ang + Math.PI;

            const ps = pathHistory.pop();
            if (ps) {
              currentPath = ps.path;
              const clamped = clampCoordinates(hoveredNode.worldX, hoveredNode.worldY);
              originX = clamped.x;
              originY = clamped.y;
            } else {
              const parent = getParentPath(currentPath);
              if (parent) {
                currentPath = parent;
              } else {
                currentPath = START_PATH;
              }
              const clamped = clampCoordinates(hoveredNode.worldX, hoveredNode.worldY);
              originX = clamped.x;
              originY = clamped.y;
            }

            draggedAway = false;
            mouseDownX  = originX;
            mouseDownY  = originY;

            hoveredNodeIndex = null;
            expansionPos = 0;
            targetExpansion = 1;
            startAnimation();
            await loadCurrentDirectory();
            return;
          }

          // 3) File Hovered
          if (!hoveredNode.isDir && !hoveredNode.isAction && hoveredNode.path && (!selectedFile || selectedFile.path !== hoveredNode.path)) {
            pathHistory.push({ path: currentPath, x: originX, y: originY });
            selectedFile = itemsList.find(i => i.path === hoveredNode.path) || null;
            const clamped = clampCoordinates(hoveredNode.worldX, hoveredNode.worldY);
            originX = clamped.x;
            originY = clamped.y;
            
            draggedAway = false;
            mouseDownX  = originX;
            mouseDownY  = originY;

            hoveredNodeIndex = null;
            expansionPos = 0;
            targetExpansion = 1;
            startAnimation();
            return;
          }

          // 4) Sub-menu Action Hovered
          if (hoveredNode.isAction && hoveredNode.actionId) {
            const action = hoveredNode.actionId;

            if (action.startsWith("select_") && (!selectedEditor || selectedEditor !== action.replace("select_", ""))) {
              selectedEditor = action.replace("select_", "");
              
              draggedAway = false;
              mouseDownX  = originX;
              mouseDownY  = originY;

              hoveredNodeIndex = null;
              expansionPos = 0;
              targetExpansion = 1;
              startAnimation();
              return;
            }

            if (action === "cancel_editor" && selectedEditor) {
              selectedEditor = null;
              
              draggedAway = false;
              mouseDownX  = originX;
              mouseDownY  = originY;

              hoveredNodeIndex = null;
              expansionPos = 0;
              targetExpansion = 1;
              startAnimation();
              return;
            }

            if (action === "back") {
              if (selectedFile) {
                const ps = pathHistory.pop();
                if (ps) { currentPath = ps.path; originX = ps.x; originY = ps.y; }
                selectedFile = null;
              }
              showFolderTools = false;
              
              draggedAway = false;
              mouseDownX  = originX;
              mouseDownY  = originY;

              hoveredNodeIndex = null;
              expansionPos = 0;
              targetExpansion = 1;
              startAnimation();
              return;
            }
          }
        }
      }
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (hoveredNodeIndex !== null) {
      hoveredNodeIndex = null;
      startAnimation();
    }
  });

  async function resetToCenter() {
    currentPath     = START_PATH;
    originX         = window.innerWidth  / 2;
    originY         = window.innerHeight / 2;
    pathHistory     = [];
    selectedFile    = null;
    showFolderTools = false;
    selectedEditor  = null;
    justExitedPath  = null;
    justExitedAngle = null;
    targetExpansion = 1;
    expansionPos    = 0;
    await loadCurrentDirectory();
  }

  async function hideWindow() {
    await getCurrentWindow().hide();
  }

  const appWindow = getCurrentWindow();
  appWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      targetExpansion = 1;
      startAnimation();
    }
  });

  canvas.addEventListener("mousedown", async (e) => {
    if (isLoadingDir) return;

    currentMouseX = e.clientX;
    currentMouseY = e.clientY;

    const clickedIndex  = getNodeAtPosition(e.clientX, e.clientY, animatedNodes);
    const clickedAnim   = clickedIndex !== null ? animatedNodes[clickedIndex] : null;
    const isCenterClick = clickedAnim?.key === "center";

    isHolding   = true;
    draggedAway = false;
    mouseDownX  = e.clientX;
    mouseDownY  = e.clientY;

    if (expansionPos < 0.85) {
      if (isCenterClick) {
        selectedFile    = null;
        showFolderTools = false;
        selectedEditor  = null;
        triggerOpen();
      } else {
        isHolding = false;
        await hideWindow();
      }
      return;
    }

    if (clickedIndex === null) {
      isHolding = false;
      return;
    }

    if (clickedAnim && !isCenterClick) {
      const clickedNode = visibleNodes.find((n, idx) => nodeKey(n, idx) === clickedAnim.key) ?? null;
      if (clickedNode) {
        if (clickedNode.isAction) {
          isHolding = true;
          return;
        }

        isHolding = false;

        // Navigate Down on Direct Click
        if (clickedNode.isDir && clickedNode.path && currentPath !== clickedNode.path && !clickedNode.isBack) {
          pathHistory.push({ path: currentPath, x: originX, y: originY });
          currentPath = clickedNode.path;
          const clamped = clampCoordinates(clickedNode.worldX, clickedNode.worldY);
          originX = clamped.x;
          originY = clamped.y;

          justExitedPath = null;
          justExitedAngle = null;
          
          draggedAway = false;
          mouseDownX  = originX;
          mouseDownY  = originY;

          hoveredNodeIndex = null;
          expansionPos = 0;
          targetExpansion = 1;
          startAnimation();
          await loadCurrentDirectory();
          return;
        }

        // Navigate Up on Direct Click
        if (clickedNode.isBack) {
          const bdx = clickedNode.worldX - originX;
          const bdy = clickedNode.worldY - originY;
          const ang = Math.atan2(bdy, bdx);

          justExitedPath = currentPath;
          justExitedAngle = ang + Math.PI;

          const ps = pathHistory.pop();
          if (ps) {
            currentPath = ps.path;
            const clamped = clampCoordinates(clickedNode.worldX, clickedNode.worldY);
            originX = clamped.x;
            originY = clamped.y;
          } else {
            const parent = getParentPath(currentPath);
            if (parent) {
              currentPath = parent;
            } else {
              currentPath = START_PATH;
            }
            const clamped = clampCoordinates(clickedNode.worldX, clickedNode.worldY);
            originX = clamped.x;
            originY = clamped.y;
          }

          draggedAway = false;
          mouseDownX  = originX;
          mouseDownY  = originY;

          hoveredNodeIndex = null;
          expansionPos = 0;
          targetExpansion = 1;
          startAnimation();
          await loadCurrentDirectory();
          return;
        }

        if (!clickedNode.isDir && !clickedNode.isAction && clickedNode.path) {
          pathHistory.push({ path: currentPath, x: originX, y: originY });
          selectedFile = itemsList.find(i => i.path === clickedNode.path) || null;
          const clamped = clampCoordinates(clickedNode.worldX, clickedNode.worldY);
          originX = clamped.x;
          originY = clamped.y;
          
          draggedAway = false;
          mouseDownX  = originX;
          mouseDownY  = originY;

          hoveredNodeIndex = null;
          expansionPos = 0;
          targetExpansion = 1;
          startAnimation();
          return;
        }
      }
    }
  });

  canvas.addEventListener("mouseup", async () => {
    if (!isHolding) return;
    isHolding = false;

    if (isLoadingDir) return;

    const releasedIndex = getNodeAtPosition(currentMouseX, currentMouseY, animatedNodes);
    const releasedAnim  = releasedIndex !== null ? animatedNodes[releasedIndex] : null;
    const isCenterRelease = releasedAnim?.key === "center";

    // Center Click Release (Navigate Upwards Shortcut)
    if (isCenterRelease && !draggedAway) {
      if (selectedEditor) {
        selectedEditor = null;
        expansionPos = 0;
        targetExpansion = 1;
        startAnimation();
        return;
      }
      if (selectedFile) {
        const ps = pathHistory.pop();
        if (ps) { currentPath = ps.path; originX = ps.x; originY = ps.y; }
        selectedFile = null;
        expansionPos = 0;
        targetExpansion = 1;
        startAnimation();
        return;
      }
      if (showFolderTools) {
        showFolderTools = false;
        expansionPos = 0;
        targetExpansion = 1;
        startAnimation();
        return;
      }

      const ps = pathHistory.pop();
      if (ps) {
        const backNode = animatedNodes.find(n => n.isBack);
        if (backNode) {
          const dx = backNode.curX - originX;
          const dy = backNode.curY - originY;
          const ang = Math.atan2(dy, dx);

          justExitedPath = currentPath;
          justExitedAngle = ang + Math.PI;

          const clamped = clampCoordinates(backNode.curX, backNode.curY);
          originX = clamped.x;
          originY = clamped.y;
        } else {
          justExitedPath = currentPath;
          justExitedAngle = Math.PI / 2;
          originX = ps.x;
          originY = ps.y;
        }
        currentPath = ps.path;
        expansionPos = 0;
        targetExpansion = 1;
        startAnimation();
        await loadCurrentDirectory();
      } else {
        const parent = getParentPath(currentPath);
        if (parent) {
          const backNode = animatedNodes.find(n => n.isBack);
          if (backNode) {
            const dx = backNode.curX - originX;
            const dy = backNode.curY - originY;
            const ang = Math.atan2(dy, dx);

            justExitedPath = currentPath;
            justExitedAngle = ang + Math.PI;

            const clamped = clampCoordinates(backNode.curX, backNode.curY);
            originX = clamped.x;
            originY = clamped.y;
          } else {
            justExitedPath = currentPath;
            justExitedAngle = Math.PI / 2;
            originX = window.innerWidth / 2;
            originY = window.innerHeight / 2;
          }
          currentPath = parent;
          expansionPos = 0;
          targetExpansion = 1;
          startAnimation();
          await loadCurrentDirectory();
        } else {
          startAnimation();
        }
      }
      return;
    }

    if (hoveredNodeIndex !== null && expansionPos > 0.8) {
      const hoveredAnim = animatedNodes[hoveredNodeIndex];
      const hoveredNode = visibleNodes.find((n, idx) => nodeKey(n, idx) === hoveredAnim.key);

      if (hoveredNode && hoveredNode.isAction && hoveredNode.actionId) {
        const action = hoveredNode.actionId;

        if (selectedEditor) {
          if (action === "cancel_editor") {
            selectedEditor = null;
            expansionPos = 0; targetExpansion = 1; startAnimation();
          } else if (action === "launch_window") {
            await invoke("launch_editor", { editor: selectedEditor, env: "window", path: getActiveTargetPath() });
            await resetToCenter();
          } else if (action === "launch_wsl") {
            await invoke("launch_editor", { editor: selectedEditor, env: "wsl",    path: getActiveTargetPath() });
            await resetToCenter();
          }
          return;
        }

        if (showFolderTools) {
          if (action.startsWith("select_")) {
            selectedEditor = action.replace("select_", "");
            expansionPos = 0; targetExpansion = 1; startAnimation();
          } else if (action === "opencode") {
            await invoke("open_wsl_opencode", { path: getActiveTargetPath(), prompt: "start" });
            await resetToCenter();
          } else if (action === "powershell") {
            await invoke("open_powershell", { path: currentPath });
            await resetToCenter();
          } else if (action === "cmd") {
            await invoke("open_cmd", { path: currentPath });
            await resetToCenter();
          } else if (action === "back") {
            showFolderTools = false;
            expansionPos = 0; targetExpansion = 1; startAnimation();
          }
          return;
        }

        if (selectedFile) {
          if (action.startsWith("select_")) {
            selectedEditor = action.replace("select_", "");
            expansionPos = 0; targetExpansion = 1; startAnimation();
          } else if (action === "opencode") {
            await invoke("open_wsl_opencode", { path: getActiveTargetPath(), prompt: "start" });
            await resetToCenter();
          } else if (action === "back") {
            const ps = pathHistory.pop();
            if (ps) { currentPath = ps.path; originX = ps.x; originY = ps.y; }
            selectedFile = null;
            expansionPos = 0; targetExpansion = 1; startAnimation();
          } else if (action === "powershell") {
            await invoke("open_powershell", { path: selectedFile.path });
            await resetToCenter();
          } else if (action === "cmd") {
            await invoke("open_cmd", { path: selectedFile.path });
            await resetToCenter();
          }
          return;
        }
      }
    }

    if (!selectedFile && !selectedEditor && !showFolderTools) {
      if (draggedAway || hoveredNodeIndex === null || animatedNodes[hoveredNodeIndex]?.key !== "center") {
        showFolderTools = true;
        expansionPos = 0;
        targetExpansion = 1;
        startAnimation();
      }
    }
  });

  loadCurrentDirectory().then(() => {
    startAnimation();
  });

  enable().catch(() => {});
});
