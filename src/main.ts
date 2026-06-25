import { invoke } from "@tauri-apps/api/core";

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
  RAD_SNAP,
  DRAG_THRESHOLD,
  MAX_PATH_HISTORY,
  VIGNETTE_OPACITY,
  VIGNETTE_RADIUS_SCALE,
  COLORS
} from "./config";
import {
  lerpSnap,
  getParentPath,
  getNodeAtPosition,
  clampCoordinates,
  nodeKey,
  friendlyError
} from "./utils";
import { drawBubble, drawConnection, drawLabel, drawBadge } from "./renderer";
import { calculateLayout } from "./layout";
import { getFileCategory, FILE_BADGE } from "./config";

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
let mouseDownNodeIndex: number | null = null;

let isLoadingDir = false;
let loadCancelled = false;

let currentMouseX = window.innerWidth / 2;
let currentMouseY = window.innerHeight / 2;

let pathHistory: HistoryState[] = [];
let hoveredNodeIndex: number | null = null;

let visibleNodes: RenderNode[] = [];
let animatedNodes: AnimatedNode[] = [];

let justExitedPath: string | null = null;
let justExitedX: number | null = null;
let justExitedY: number | null = null;

let errorMessage: string | null = null;
let loadPulse = 0;

let isKeyboardActive = false;
let exitNodes: AnimatedNode[] = [];
let isRetryHovered = false;
let hintTimer = 0;

function trimHistory() {
  while (pathHistory.length > MAX_PATH_HISTORY) pathHistory.shift();
}

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
    loadCancelled = false;
    errorMessage = null;
    try {
      itemsList = await invoke("read_directory", { path: currentPath });
      if (loadCancelled) {
        errorMessage = "Cancelled";
        startAnimation();
        return;
      }
      selectedFile = null;
      startAnimation();
    } catch (err) {
      console.error("Failed to load path:", err);
      errorMessage = friendlyError(err);
      startAnimation();
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

    const isBrowsing = !selectedFile && !showFolderTools && !selectedEditor;

    // Dark vignette behind cluster
    const vignetteR = Math.min(window.innerWidth, window.innerHeight) * VIGNETTE_RADIUS_SCALE;
    const vignette = ctx!.createRadialGradient(originX, originY, 0, originX, originY, vignetteR);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.4, `rgba(0,0,0,${VIGNETTE_OPACITY * 0.3})`);
    vignette.addColorStop(1, `rgba(0,0,0,${VIGNETTE_OPACITY})`);
    ctx!.fillStyle = vignette;
    ctx!.fillRect(0, 0, window.innerWidth, window.innerHeight);

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

    // Tick exit nodes (crossfade from previous navigation)
    exitNodes = exitNodes.filter(n => {
      n.curX = lerpSnap(n.curX, originX, NODE_EXIT_RATE, dt, POS_SNAP);
      n.curY = lerpSnap(n.curY, originY, NODE_EXIT_RATE, dt, POS_SNAP);
      n.curRadius = lerpSnap(n.curRadius, 0, NODE_EXIT_RATE, dt, RAD_SNAP);
      n.curAlpha = lerpSnap(n.curAlpha, 0, NODE_EXIT_RATE, dt, ALPHA_SNAP);
      return n.curRadius > RAD_SNAP || n.curAlpha > ALPHA_SNAP;
    });

    const nodesMoving = syncAnimatedNodes(dt);

    // Draw crossfade exit nodes (behind current content)
    exitNodes.forEach(n => {
      drawBubble(ctx!, n.curX, n.curY, n.curRadius, n.baseColor, n.curAlpha, false);
    });
    exitNodes.forEach(n => {
      drawLabel(ctx!, n.label, n.curX, n.curY, n.curRadius, n.curAlpha, n.key === "center");
    });

    // Connections
    const centerNode = animatedNodes.find(a => a.key === "center");
    let connIndex = 0;
    animatedNodes.forEach((node) => {
      if (node.key === "center" || !centerNode) return;
      const isHov = hoveredNodeIndex !== null
        && animatedNodes[hoveredNodeIndex]?.key === node.key
        && expansionPos > 0.85;
      drawConnection(ctx!, centerNode.curX, centerNode.curY, node.curX, node.curY, node.curAlpha, isHov, connIndex);
      connIndex++;
    });

    // Bubbles, labels, and badges
    animatedNodes.forEach((node) => {
      const isCenter = node.key === "center";
      const isHov    = hoveredNodeIndex !== null
        && animatedNodes[hoveredNodeIndex]?.key === node.key
        && expansionPos > 0.85;
      const isKeyFocus = isKeyboardActive && isHov;
      const alpha = isCenter ? 1 : node.curAlpha;
      drawBubble(ctx!, node.curX, node.curY, node.curRadius, node.baseColor, alpha, isHov, isKeyFocus);
      drawLabel(ctx!, node.label, node.curX, node.curY, node.curRadius, alpha, isCenter);
      // File type badges
      if (!node.isDir && !node.isAction && node.path) {
        const cat = getFileCategory(node.label);
        drawBadge(ctx!, node.curX, node.curY, node.curRadius, FILE_BADGE[cat], alpha);
      }
    });

    // Loading pulse ring around center
    if (isLoadingDir && centerNode) {
      loadPulse += dt * 0.08;
      const pulseR = Math.sin(loadPulse) * 8;
      drawBubble(ctx!, centerNode.curX, centerNode.curY, centerNode.curRadius + 12 + pulseR, COLORS.loading, 0.3, false);
    }

    // Error + retry
    if (errorMessage && centerNode && !isLoadingDir) {
      const errorY = centerNode.curY + centerNode.curRadius + 50;
      drawBubble(ctx!, centerNode.curX, errorY, 28, COLORS.error, 0.9, false);
      drawLabel(ctx!, errorMessage, centerNode.curX, errorY, 28, 0.9, false);

      // Retry bubble
      const retryY = errorY + 55;
      drawBubble(ctx!, centerNode.curX, retryY, 24, COLORS.loading, 0.9, isRetryHovered);
      drawLabel(ctx!, "Retry", centerNode.curX, retryY, 24, 0.9, false);
    }

    // Drag tether
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
        drawConnection(ctx!, sx, sy, currentMouseX, currentMouseY, 1, true, 0);

        // Arrowhead dots along drag tether when dragged away
        if (draggedAway) {
          for (let t = 0.25; t < 1; t += 0.25) {
            const dotX = sx + (currentMouseX - sx) * t;
            const dotY = sy + (currentMouseY - sy) * t;
            ctx!.beginPath();
            ctx!.arc(dotX, dotY, 3, 0, Math.PI * 2);
            ctx!.fillStyle = `rgba(100,210,160,0.5)`;
            ctx!.fill();
          }
        }
      }
    }

    // Idle hint text
    if (isBrowsing) {
      if (!isHolding && !isLoadingDir && !errorMessage && hoveredNodeIndex === null) {
        hintTimer++;
      } else {
        hintTimer = 0;
      }
    } else {
      hintTimer = 0;
    }
    if (hintTimer > 90 && centerNode) {
      const hintAlpha = Math.min(1, (hintTimer - 90) / 30);
      ctx!.globalAlpha = hintAlpha * 0.5;
      ctx!.font = "12px -apple-system,system-ui,sans-serif";
      ctx!.textAlign = "center";
      ctx!.fillStyle = "rgba(255,255,255,0.6)";
      ctx!.fillText("Click center to go back · Drag to navigate", centerNode.curX, centerNode.curY + centerNode.curRadius + 30);
      ctx!.globalAlpha = 1;
    }

    if (expansionSettled && !nodesMoving && !isHolding && exitNodes.length === 0) {
      isAnimating = false;
      return;
    }

    requestAnimationFrame(draw);
  }

  // ── helpers shared by mousedown and mousemove back-navigation ──────────────

  function doNavigateDown(node: RenderNode & { path: string }, label: string) {
    snapshotExitNodes();
    const animNode = animatedNodes.find(a => a.path === node.path);
    const absX = animNode ? animNode.curX : node.worldX;
    const absY = animNode ? animNode.curY : node.worldY;
    const exitX = absX - originX;
    const exitY = absY - originY;

    pathHistory.push({ path: currentPath, x: originX, y: originY, exitX, exitY });
    trimHistory();
    currentPath = node.path;
    invoke("record_navigate", { path: currentPath, name: label, is_dir: true }).catch(() => {});
    const clamped = clampCoordinates(node.worldX, node.worldY);
    originX = clamped.x;
    originY = clamped.y;
    justExitedPath = null;
    justExitedX    = null;
    justExitedY    = null;
  }

  function doNavigateBack(backNodeWorldX: number, backNodeWorldY: number, poppedState?: HistoryState | null) {
    snapshotExitNodes();
    invoke("record_pass_through", { path: currentPath, name: visibleNodes[0]?.label || "" }).catch(() => {});

    const ps = poppedState !== undefined ? poppedState : pathHistory.pop();
    const clamped = clampCoordinates(backNodeWorldX, backNodeWorldY);

    const oldOriginX = originX;
    const oldOriginY = originY;

    originX = clamped.x;
    originY = clamped.y;

    justExitedPath = currentPath;
    if (ps) {
      justExitedX = ps.x + ps.exitX;
      justExitedY = ps.y + ps.exitY;
    } else {
      justExitedX = oldOriginX;
      justExitedY = oldOriginY;
    }

    if (ps) {
      currentPath = ps.path;
    } else {
      const parent = getParentPath(currentPath);
      currentPath = parent ?? START_PATH;
    }
  }

  function snapshotExitNodes() {
    exitNodes = animatedNodes.map(n => ({ ...n }));
  }

  // ── activateNode / executeAction ──────────────────────────────────────

  async function activateNode(node: RenderNode) {
    if (node.isAction && node.actionId) {
      await executeAction(node.actionId);
      return;
    }

    // Navigate down into folder
    if (node.isDir && node.path && currentPath !== node.path && !node.isBack) {
      doNavigateDown(node as RenderNode & { path: string }, node.label);
      draggedAway = false; mouseDownX = originX; mouseDownY = originY;
      hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
      startAnimation();
      await loadCurrentDirectory();
      return;
    }

    // cd .. back
    if (node.isBack) {
      doNavigateBack(node.worldX, node.worldY);
      draggedAway = false; mouseDownX = originX; mouseDownY = originY;
      hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
      startAnimation();
      await loadCurrentDirectory();
      return;
    }

    // Select file
    if (!node.isDir && !node.isAction && node.path) {
      pathHistory.push({ path: currentPath, x: originX, y: originY, exitX: 0, exitY: 0 });
      trimHistory();
      selectedFile = itemsList.find(i => i.path === node.path) || null;
      invoke("record_select", { path: node.path, name: node.label, is_dir: false }).catch(() => {});
      const clamped = clampCoordinates(node.worldX, node.worldY);
      originX = clamped.x; originY = clamped.y;
      draggedAway = false; mouseDownX = originX; mouseDownY = originY;
      hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
      startAnimation();
    }
  }

  async function executeAction(actionId: string) {
    const curName = currentPath.split(/[\\/]/).pop() || currentPath;

    if (selectedEditor) {
      if (actionId === "cancel_editor") {
        selectedEditor = null; expansionPos = 0; targetExpansion = 1; startAnimation();
      } else if (actionId === "launch_window") {
        invoke("record_tool", { tool_name: selectedEditor, editor_name: selectedEditor, env: "window", path: getActiveTargetPath(), name: curName }).catch(() => {});
        try {
          await invoke("launch_editor", { editor: selectedEditor, env: "window", path: getActiveTargetPath() });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      } else if (actionId === "launch_wsl") {
        invoke("record_tool", { tool_name: selectedEditor, editor_name: selectedEditor, env: "wsl", path: getActiveTargetPath(), name: curName }).catch(() => {});
        try {
          await invoke("launch_editor", { editor: selectedEditor, env: "wsl", path: getActiveTargetPath() });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      }
      return;
    }

    if (showFolderTools) {
      if (actionId.startsWith("select_")) {
        selectedEditor = actionId.replace("select_", ""); expansionPos = 0; targetExpansion = 1; startAnimation();
      } else if (actionId === "opencode") {
        invoke("record_tool", { tool_name: "opencode", editor_name: null, env: null, path: getActiveTargetPath(), name: curName }).catch(() => {});
        try {
          await invoke("open_wsl_opencode", { path: getActiveTargetPath(), prompt: "start" });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      } else if (actionId === "powershell") {
        invoke("record_tool", { tool_name: "powershell", editor_name: null, env: null, path: currentPath, name: curName }).catch(() => {});
        try {
          await invoke("open_powershell", { path: currentPath });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      } else if (actionId === "cmd") {
        invoke("record_tool", { tool_name: "cmd", editor_name: null, env: null, path: currentPath, name: curName }).catch(() => {});
        try {
          await invoke("open_cmd", { path: currentPath });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      } else if (actionId === "wsl") {
        invoke("record_tool", { tool_name: "wsl", editor_name: null, env: null, path: currentPath, name: curName }).catch(() => {});
        try {
          await invoke("open_wsl", { path: currentPath });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      } else if (actionId === "back") {
        showFolderTools = false; expansionPos = 0; targetExpansion = 1; startAnimation();
      }
      return;
    }

    if (selectedFile) {
      if (actionId.startsWith("select_")) {
        selectedEditor = actionId.replace("select_", ""); expansionPos = 0; targetExpansion = 1; startAnimation();
      } else if (actionId === "opencode") {
        invoke("record_tool", { tool_name: "opencode", editor_name: null, env: null, path: getActiveTargetPath(), name: curName }).catch(() => {});
        try {
          await invoke("open_wsl_opencode", { path: getActiveTargetPath(), prompt: "start" });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      } else if (actionId === "back") {
        const ps = pathHistory.pop();
        if (ps) { currentPath = ps.path; originX = ps.x; originY = ps.y; }
        selectedFile = null; expansionPos = 0; targetExpansion = 1; startAnimation();
      } else if (actionId === "powershell") {
        invoke("record_tool", { tool_name: "powershell", editor_name: null, env: null, path: currentPath, name: curName }).catch(() => {});
        try {
          await invoke("open_powershell", { path: currentPath });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      } else if (actionId === "cmd") {
        invoke("record_tool", { tool_name: "cmd", editor_name: null, env: null, path: currentPath, name: curName }).catch(() => {});
        try {
          await invoke("open_cmd", { path: currentPath });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      } else if (actionId === "wsl") {
        invoke("record_tool", { tool_name: "wsl", editor_name: null, env: null, path: currentPath, name: curName }).catch(() => {});
        try {
          await invoke("open_wsl", { path: currentPath });
          await hideWindow();
        } catch (e) {
          errorMessage = friendlyError(e);
          startAnimation();
        }
      }
      return;
    }

    // Browsing mode actions
    if (actionId === "show_tools") {
      showFolderTools = true; expansionPos = 0; targetExpansion = 1; startAnimation();
    }
  }

  // ── mousemove ─────────────────────────────────────────────────────────

  canvas.addEventListener("mousemove", async (e) => {
    currentMouseX = e.clientX;
    currentMouseY = e.clientY;

    if (isKeyboardActive) {
      isKeyboardActive = false;
      startAnimation();
    }

    const prev = hoveredNodeIndex;
    hoveredNodeIndex = getNodeAtPosition(e.clientX, e.clientY, animatedNodes);

    // Check retry bubble hover
    isRetryHovered = false;
    if (errorMessage) {
      const cn = animatedNodes.find(a => a.key === "center");
      if (cn) {
        const retryY = cn.curY + cn.curRadius + 50 + 55;
        const rdx = e.clientX - cn.curX;
        const rdy = e.clientY - retryY;
        if (rdx * rdx + rdy * rdy < 24 * 24) {
          isRetryHovered = true;
        }
      }
    }

    const cursorTarget = isRetryHovered ? "pointer" : (hoveredNodeIndex !== null ? "pointer" : "default");
    canvas.style.cursor = cursorTarget;
    if (prev !== hoveredNodeIndex || isRetryHovered) startAnimation();

    if (isLoadingDir) return;

    if (isHolding) {
      const dx = e.clientX - mouseDownX;
      const dy = e.clientY - mouseDownY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) draggedAway = true;

      if (draggedAway && hoveredNodeIndex !== null && expansionPos > 0.8) {
        const hoveredAnim = animatedNodes[hoveredNodeIndex];
        const hoveredNode = visibleNodes.find((n, idx) => nodeKey(n, idx) === hoveredAnim.key);

        if (hoveredNode && hoveredAnim.key !== "center") {
          if (hoveredNode.isDir && hoveredNode.path && currentPath !== hoveredNode.path && !hoveredNode.isBack) {
            doNavigateDown(hoveredNode as RenderNode & { path: string }, hoveredNode.label);
            draggedAway = false; mouseDownX = originX; mouseDownY = originY;
            hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
            startAnimation();
            await loadCurrentDirectory();
            return;
          }

          if (hoveredNode.isBack) {
            doNavigateBack(hoveredNode.worldX, hoveredNode.worldY);
            draggedAway = false; mouseDownX = originX; mouseDownY = originY;
            hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
            startAnimation();
            await loadCurrentDirectory();
            return;
          }

          if (!hoveredNode.isDir && !hoveredNode.isAction && hoveredNode.path && (!selectedFile || selectedFile.path !== hoveredNode.path)) {
            pathHistory.push({ path: currentPath, x: originX, y: originY, exitX: 0, exitY: 0 });
            trimHistory();
            selectedFile = itemsList.find(i => i.path === hoveredNode.path) || null;
            invoke("record_select", { path: hoveredNode.path, name: hoveredNode.label, is_dir: false }).catch(() => {});
            const clamped = clampCoordinates(hoveredNode.worldX, hoveredNode.worldY);
            originX = clamped.x; originY = clamped.y;
            draggedAway = false; mouseDownX = originX; mouseDownY = originY;
            hoveredNodeIndex = null; expansionPos = 0; targetExpansion = 1;
            startAnimation();
            return;
          }

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
    isRetryHovered = false;
  });

  async function hideWindow() { await getCurrentWindow().hide(); }

  // ── keyboard navigation ─────────────────────────────────────────────

  document.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      if (isLoadingDir) {
        loadCancelled = true;
        return;
      }
      if (errorMessage) { errorMessage = null; startAnimation(); return; }
      if (selectedEditor) { selectedEditor = null; expansionPos = 0; targetExpansion = 1; startAnimation(); return; }
      if (selectedFile || showFolderTools) {
        const ps = pathHistory.pop();
        if (ps) { currentPath = ps.path; originX = ps.x; originY = ps.y; }
        selectedFile = null; showFolderTools = false; expansionPos = 0; targetExpansion = 1; startAnimation(); return;
      }
    }

    if (animatedNodes.length < 2) return;
    const idx = animatedNodes[0]?.key === "center" ? 1 : 0;
    if (idx >= animatedNodes.length) return;
    const lastIdx = animatedNodes.length - 1;
    const cur = hoveredNodeIndex !== null ? Math.max(idx, Math.min(lastIdx, hoveredNodeIndex)) : idx;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      isKeyboardActive = true;
      hoveredNodeIndex = cur >= lastIdx ? idx : cur + 1;
      canvas.style.cursor = "pointer";
      startAnimation();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      isKeyboardActive = true;
      hoveredNodeIndex = cur <= idx ? lastIdx : cur - 1;
      canvas.style.cursor = "pointer";
      startAnimation();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hoveredNodeIndex !== null && expansionPos > 0.8) {
        const anim = animatedNodes[hoveredNodeIndex];
        const node = visibleNodes.find((n, i) => nodeKey(n, i) === anim.key);
        if (node) await activateNode(node);
      }
    }
  });

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
    mouseDownNodeIndex = clickedIndex;

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
      if (clickedNode && clickedNode.isAction) { isHolding = true; return; }
    }
  });

  // ── mouseup ───────────────────────────────────────────────────────────────

  canvas.addEventListener("mouseup", async () => {
    if (!isHolding) return;
    isHolding = false;
    if (isLoadingDir) return;

    // Determine target node: if dragged away, use hovered; otherwise use what was pressed
    const targetIndex = draggedAway ? hoveredNodeIndex : mouseDownNodeIndex;
    const targetAnim  = targetIndex !== null ? animatedNodes[targetIndex] : null;
    const isCenterRelease = targetAnim?.key === "center";

    // Retry button
    if (isRetryHovered && errorMessage) {
      errorMessage = null;
      await loadCurrentDirectory();
      return;
    }

    // Center click: dismiss error
    if (isCenterRelease && !draggedAway && errorMessage) {
      errorMessage = null; expansionPos = 0; targetExpansion = 1; startAnimation(); return;
    }

    // Center click: navigate up / back shortcut
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

    // Activate node
    if (targetAnim && !isCenterRelease && expansionPos > 0.8) {
      const targetNode = visibleNodes.find((n, idx) => nodeKey(n, idx) === targetAnim.key);
      if (targetNode) {
        await activateNode(targetNode);
        return;
      }
    }

    // Click empty space → show folder tools
    if (!selectedFile && !selectedEditor && !showFolderTools) {
      if (draggedAway || hoveredNodeIndex === null || animatedNodes[hoveredNodeIndex]?.key !== "center") {
        showFolderTools = true; expansionPos = 0; targetExpansion = 1; startAnimation();
      }
    }
  });

  loadCurrentDirectory().then(() => { startAnimation(); });
});
