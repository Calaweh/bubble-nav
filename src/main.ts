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
let targetExpansion = 1;

let lastFrameTime = 0;
let isAnimating = false;

let isHolding   = false;
let draggedAway = false;
let mouseDownX  = 0;
let mouseDownY  = 0;

let isLoadingDir = false;

let currentMouseX = window.innerWidth / 2;
let currentMouseY = window.innerHeight / 2;

let pathHistory: HistoryState[] = [];
let hoveredNodeIndex: number | null = null;

let visibleNodes: RenderNode[] = [];
let animatedNodes: AnimatedNode[] = [];

let justExitedPath: string | null = null;
let justExitedX: number | null = null;
let justExitedY: number | null = null;

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
    if (a.baseColor === "#f1c40f" && a.path !== justExitedPath) return false;
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
      justExitedX,
      justExitedY
    );
    const nodesMoving = syncAnimatedNodes(dt);

    const centerNode = animatedNodes.find(a => a.key === "center");
    animatedNodes.forEach((node) => {
      if (node.key === "center" || !centerNode) return;
      const isHov = hoveredNodeIndex !== null
        && animatedNodes[hoveredNodeIndex]?.key === node.key
        && expansionPos > 0.85;
      drawConnection(ctx!, centerNode.curX, centerNode.curY, node.curX, node.curY, node.curAlpha, isHov);
    });

    animatedNodes.forEach((node) => {
      const isCenter = node.key === "center";
      const isHov    = hoveredNodeIndex !== null
        && animatedNodes[hoveredNodeIndex]?.key === node.key
        && expansionPos > 0.85;
      const alpha = isCenter ? 1 : node.curAlpha;
      drawBubble(ctx!, node.curX, node.curY, node.curRadius, node.baseColor, alpha, isHov);
      drawLabel(ctx!, node.label, node.curX, node.curY, node.curRadius, alpha, isCenter);
    });

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

  // ── helpers shared by mousedown and mousemove back-navigation ──────────────

  function doNavigateDown(node: RenderNode & { path: string }, label: string) {
    const animNode = animatedNodes.find(a => a.path === node.path);
    const absX = animNode ? animNode.curX : node.worldX;
    const absY = animNode ? animNode.curY : node.worldY;
    // Store as offset relative to current origin, so on the way back we can
    // reconstruct the exact same screen position regardless of where originX/Y ends up.
    const exitX = absX - originX;
    const exitY = absY - originY;

    pathHistory.push({ path: currentPath, x: originX, y: originY, exitX, exitY });
    currentPath = node.path;
    invoke("record_navigate", { path: currentPath, name: label, isDir: true }).catch(() => {});
    const clamped = clampCoordinates(node.worldX, node.worldY);
    originX = clamped.x;
    originY = clamped.y;
    justExitedPath = null;
    justExitedX    = null;
    justExitedY    = null;
  }

  function doNavigateBack(backNodeWorldX: number, backNodeWorldY: number, poppedState?: HistoryState | null) {
    invoke("record_pass_through", { path: currentPath, name: visibleNodes[0]?.label || "" }).catch(() => {});

    // If poppedState is provided, use it instead of popping pathHistory.
    const ps = poppedState !== undefined ? poppedState : pathHistory.pop();
    const clamped = clampCoordinates(backNodeWorldX, backNodeWorldY);

    // Capture the current origin before it changes — this is the absolute screen
    // position of the folder we are leaving, which is exactly where it appeared
    // as a satellite in the parent view.
    const oldOriginX = originX;
    const oldOriginY = originY;

    originX = clamped.x;
    originY = clamped.y;

    justExitedPath = currentPath;
    justExitedX = oldOriginX;
    justExitedY = oldOriginY;

    if (ps) {
      currentPath = ps.path;
    } else {
      const parent = getParentPath(currentPath);
      currentPath = parent ?? START_PATH;
    }
  }

  // ── mousemove ─────────────────────────────────────────────────────────────

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
      if (dx * dx + dy * dy > 25 * 25) draggedAway = true;

      if (draggedAway && hoveredNodeIndex !== null && expansionPos > 0.8) {
        const hoveredAnim = animatedNodes[hoveredNodeIndex];
        const hoveredNode = visibleNodes.find((n, idx) => nodeKey(n, idx) === hoveredAnim.key);

        if (hoveredNode && hoveredAnim.key !== "center") {

          // 1) Navigate down into folder
          if (hoveredNode.isDir && hoveredNode.path && currentPath !== hoveredNode.path && !hoveredNode.isBack) {
            doNavigateDown(hoveredNode as RenderNode & { path: string }, hoveredNode.label);
            draggedAway = false; mouseDownX = originX; mouseDownY = originY;
            hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
            startAnimation();
            await loadCurrentDirectory();
            return;
          }

          // 2) cd .. back
          if (hoveredNode.isBack) {
            doNavigateBack(hoveredNode.worldX, hoveredNode.worldY);
            draggedAway = false; mouseDownX = originX; mouseDownY = originY;
            hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
            startAnimation();
            await loadCurrentDirectory();
            return;
          }

          // 3) File selected
          if (!hoveredNode.isDir && !hoveredNode.isAction && hoveredNode.path && (!selectedFile || selectedFile.path !== hoveredNode.path)) {
            pathHistory.push({ path: currentPath, x: originX, y: originY, exitX: 0, exitY: 0 });
            selectedFile = itemsList.find(i => i.path === hoveredNode.path) || null;
            invoke("record_select", { path: hoveredNode.path, name: hoveredNode.label, isDir: false }).catch(() => {});
            const clamped = clampCoordinates(hoveredNode.worldX, hoveredNode.worldY);
            originX = clamped.x; originY = clamped.y;
            draggedAway = false; mouseDownX = originX; mouseDownY = originY;
            hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
            startAnimation();
            return;
          }

          // 4) Action sub-menu
          if (hoveredNode.isAction && hoveredNode.actionId) {
            const action = hoveredNode.actionId;

            if (action.startsWith("select_") && (!selectedEditor || selectedEditor !== action.replace("select_", ""))) {
              selectedEditor = action.replace("select_", "");
              draggedAway = false; mouseDownX = originX; mouseDownY = originY;
              hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
              startAnimation(); return;
            }
            if (action === "cancel_editor" && selectedEditor) {
              selectedEditor = null;
              draggedAway = false; mouseDownX = originX; mouseDownY = originY;
              hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
              startAnimation(); return;
            }
            if (action === "back") {
              if (selectedFile) {
                const ps = pathHistory.pop();
                if (ps) { currentPath = ps.path; originX = ps.x; originY = ps.y; }
                selectedFile = null;
              }
              showFolderTools = false;
              draggedAway = false; mouseDownX = originX; mouseDownY = originY;
              hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
              startAnimation(); return;
            }
          }
        }
      }
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (hoveredNodeIndex !== null) { hoveredNodeIndex = null; startAnimation(); }
  });

  async function hideWindow() { await getCurrentWindow().hide(); }

  const appWindow = getCurrentWindow();
  appWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) { targetExpansion = 1; startAnimation(); }
  });

  // ── mousedown ─────────────────────────────────────────────────────────────

  canvas.addEventListener("mousedown", async (e) => {
    if (isLoadingDir) return;
    currentMouseX = e.clientX; currentMouseY = e.clientY;

    const clickedIndex  = getNodeAtPosition(e.clientX, e.clientY, animatedNodes);
    const clickedAnim   = clickedIndex !== null ? animatedNodes[clickedIndex] : null;
    const isCenterClick = clickedAnim?.key === "center";

    isHolding = true; draggedAway = false;
    mouseDownX = e.clientX; mouseDownY = e.clientY;

    if (expansionPos < 0.85) {
      if (isCenterClick) {
        selectedFile = null; showFolderTools = false; selectedEditor = null;
        triggerOpen();
      } else {
        isHolding = false;
        await hideWindow();
      }
      return;
    }

    if (clickedIndex === null) { isHolding = false; return; }

    if (clickedAnim && !isCenterClick) {
      const clickedNode = visibleNodes.find((n, idx) => nodeKey(n, idx) === clickedAnim.key) ?? null;
      if (clickedNode) {
        if (clickedNode.isAction) { isHolding = true; return; }
        isHolding = false;

        // Click: navigate down
        if (clickedNode.isDir && clickedNode.path && currentPath !== clickedNode.path && !clickedNode.isBack) {
          doNavigateDown(clickedNode as RenderNode & { path: string }, clickedNode.label);
          draggedAway = false; mouseDownX = originX; mouseDownY = originY;
          hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
          startAnimation();
          await loadCurrentDirectory();
          return;
        }

        // Click: navigate up
        if (clickedNode.isBack) {
          doNavigateBack(clickedNode.worldX, clickedNode.worldY);
          draggedAway = false; mouseDownX = originX; mouseDownY = originY;
          hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
          startAnimation();
          await loadCurrentDirectory();
          return;
        }

        // Click: select file
        if (!clickedNode.isDir && !clickedNode.isAction && clickedNode.path) {
          pathHistory.push({ path: currentPath, x: originX, y: originY, exitX: 0, exitY: 0 });
          selectedFile = itemsList.find(i => i.path === clickedNode.path) || null;
          invoke("record_select", { path: clickedNode.path, name: clickedNode.label, isDir: false }).catch(() => {});
          const clamped = clampCoordinates(clickedNode.worldX, clickedNode.worldY);
          originX = clamped.x; originY = clamped.y;
          draggedAway = false; mouseDownX = originX; mouseDownY = originY;
          hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
          startAnimation(); return;
        }
      }
    }
  });

  // ── mouseup ───────────────────────────────────────────────────────────────

  canvas.addEventListener("mouseup", async () => {
    if (!isHolding) return;
    isHolding = false;
    if (isLoadingDir) return;

    const releasedIndex   = getNodeAtPosition(currentMouseX, currentMouseY, animatedNodes);
    const releasedAnim    = releasedIndex !== null ? animatedNodes[releasedIndex] : null;
    const isCenterRelease = releasedAnim?.key === "center";

    // Center click: navigate up shortcut
    if (isCenterRelease && !draggedAway) {
      if (selectedEditor) {
        selectedEditor = null; expansionPos = 0; targetExpansion = 1; startAnimation(); return;
      }
      if (selectedFile) {
        const ps = pathHistory.pop();
        if (ps) { currentPath = ps.path; originX = ps.x; originY = ps.y; }
        selectedFile = null; expansionPos = 0; targetExpansion = 1; startAnimation(); return;
      }
      if (showFolderTools) {
        showFolderTools = false; expansionPos = 0; targetExpansion = 1; startAnimation(); return;
      }

      const ps = pathHistory.pop();
      if (ps) {
        const backNode = visibleNodes.find(n => n.isBack);
        const backWorldX = backNode ? backNode.worldX : ps.x;
        const backWorldY = backNode ? backNode.worldY : ps.y;
        doNavigateBack(backWorldX, backWorldY, ps);
        expansionPos = 0; targetExpansion = 1;
        startAnimation();
        await loadCurrentDirectory();
      } else {
        const parent = getParentPath(currentPath);
        if (parent) {
          const backNode = visibleNodes.find(n => n.isBack);
          const backWorldX = backNode ? backNode.worldX : window.innerWidth / 2;
          const backWorldY = backNode ? backNode.worldY : window.innerHeight / 2;
          doNavigateBack(backWorldX, backWorldY, null);
          expansionPos = 0; targetExpansion = 1;
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
        const action  = hoveredNode.actionId;
        const curName = currentPath.split(/[\\/]/).pop() || currentPath;

        if (selectedEditor) {
          if (action === "cancel_editor") {
            selectedEditor = null; expansionPos = 0; targetExpansion = 1; startAnimation();
          } else if (action === "launch_window") {
            invoke("record_tool", { toolName: selectedEditor, editorName: selectedEditor, env: "window", path: getActiveTargetPath(), name: curName }).catch(() => {});
            await invoke("launch_editor", { editor: selectedEditor, env: "window", path: getActiveTargetPath() });
            await hideWindow();
          } else if (action === "launch_wsl") {
            invoke("record_tool", { toolName: selectedEditor, editorName: selectedEditor, env: "wsl", path: getActiveTargetPath(), name: curName }).catch(() => {});
            await invoke("launch_editor", { editor: selectedEditor, env: "wsl", path: getActiveTargetPath() });
            await hideWindow();
          }
          return;
        }

        if (showFolderTools) {
          if (action.startsWith("select_")) {
            selectedEditor = action.replace("select_", ""); expansionPos = 0; targetExpansion = 1; startAnimation();
          } else if (action === "opencode") {
            invoke("record_tool", { toolName: "opencode", editorName: null, env: null, path: currentPath, name: curName }).catch(() => {});
            await invoke("open_wsl_opencode", { path: getActiveTargetPath(), prompt: "start" }); await hideWindow();
          } else if (action === "powershell") {
            invoke("record_tool", { toolName: "powershell", editorName: null, env: null, path: currentPath, name: curName }).catch(() => {});
            await invoke("open_powershell", { path: currentPath }); await hideWindow();
          } else if (action === "cmd") {
            invoke("record_tool", { toolName: "cmd", editorName: null, env: null, path: currentPath, name: curName }).catch(() => {});
            await invoke("open_cmd", { path: currentPath }); await hideWindow();
          } else if (action === "back") {
            showFolderTools = false; expansionPos = 0; targetExpansion = 1; startAnimation();
          }
          return;
        }

        if (selectedFile) {
          if (action.startsWith("select_")) {
            selectedEditor = action.replace("select_", ""); expansionPos = 0; targetExpansion = 1; startAnimation();
          } else if (action === "opencode") {
            invoke("record_tool", { toolName: "opencode", editorName: null, env: null, path: currentPath, name: curName }).catch(() => {});
            await invoke("open_wsl_opencode", { path: currentPath, prompt: "start" }); await hideWindow();
          } else if (action === "back") {
            const ps = pathHistory.pop();
            if (ps) { currentPath = ps.path; originX = ps.x; originY = ps.y; }
            selectedFile = null; expansionPos = 0; targetExpansion = 1; startAnimation();
          } else if (action === "powershell") {
            invoke("record_tool", { toolName: "powershell", editorName: null, env: null, path: currentPath, name: curName }).catch(() => {});
            await invoke("open_powershell", { path: currentPath }); await hideWindow();
          } else if (action === "cmd") {
            invoke("record_tool", { toolName: "cmd", editorName: null, env: null, path: currentPath, name: curName }).catch(() => {});
            await invoke("open_cmd", { path: currentPath }); await hideWindow();
          }
          return;
        }
      }
    }

    if (!selectedFile && !selectedEditor && !showFolderTools) {
      if (draggedAway || hoveredNodeIndex === null || animatedNodes[hoveredNodeIndex]?.key !== "center") {
        showFolderTools = true; expansionPos = 0; targetExpansion = 1; startAnimation();
      }
    }
  });

  loadCurrentDirectory().then(() => { startAnimation(); });
  enable().catch(() => {});
});
