import { invoke } from "@tauri-apps/api/core";

interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
}

const START_PATH = import.meta.env.VITE_START_PATH || "D:\\Projects";

let currentPath = START_PATH;
let itemsList: FileItem[] = [];
let selectedFile: FileItem | null = null;

let showFolderTools = false;
let selectedEditor: string | null = null;

let originX = window.innerWidth / 2;
let originY = window.innerHeight / 2;

let expansionPos = 0;
let expansionVel = 0;
const targetExpansion = 1;
const springK = 0.085;
const damping = 0.78;

let animationTime = 0;
let lastFrameTime = 0;

interface HistoryState {
  path: string;
  x: number;
  y: number;
}
let pathHistory: HistoryState[] = [];

let navigationCooldown = false;

const TOOLS = [
  { label: "VS Code", action: "select_vscode", color: "#4a90e2" },
  { label: "Visual Studio", action: "select_visualstudio", color: "#8e44ad" },
  { label: "Antigravity", action: "select_antigravity", color: "#1abc9c" },
  { label: "OpenCode", action: "opencode", color: "#e67e22" },
  { label: "Powershell", action: "powershell", color: "#27ae60" },
  { label: "CMD", action: "cmd", color: "#7f8c8d" },
  { label: "\u21a9 cd ..", action: "back", color: "#c0392b" }
];

let isDragging = false;
let mouseX = 0;
let mouseY = 0;
let hoveredNodeIndex: number | null = null;

interface RenderNode {
  label: string;
  isDir: boolean;
  isAction: boolean;
  isBack: boolean;
  actionId?: string;
  path?: string;
  worldX: number;
  worldY: number;
  radius: number;
  baseColor: string;
}

interface AnimatedNode extends RenderNode {
  curX: number;
  curY: number;
  curRadius: number;
  curAlpha: number;
  seedA: number;
  seedB: number;
  seedC: number;
  jiggleX: number;
  jiggleY: number;
  jiggleVX: number;
  jiggleVY: number;
  key: string;
}

let visibleNodes: RenderNode[] = [];
let animatedNodes: AnimatedNode[] = [];

function hexToRgba(hex: string, alpha: number): string {
  let c = hex.substring(1);
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  }
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function nodeKey(node: RenderNode, index: number): string {
  if (index === 0) return "center";
  if (node.isAction) return `action:${node.actionId}`;
  if (node.isBack) return "back";
  return `item:${node.path ?? node.label}`;
}

function approach(current: number, target: number, rate: number, dt: number): number {
  const t = 1 - Math.pow(1 - rate, dt * 60);
  return current + (target - current) * t;
}

function getActiveTargetPath(): string {
  return selectedFile ? selectedFile.path : currentPath;
}

function syncAnimatedNodes(dt: number) {
  const usedKeys = new Set<string>();

  visibleNodes.forEach((node, index) => {
    const key = nodeKey(node, index);
    usedKeys.add(key);

    let anim = animatedNodes.find((a) => a.key === key);

    if (!anim) {
      const isCenter = index === 0;
      anim = {
        ...node,
        key,
        curX: isCenter ? node.worldX : originX,
        curY: isCenter ? node.worldY : originY,
        curRadius: isCenter ? node.radius : 0,
        curAlpha: isCenter ? 1 : 0,
        seedA: Math.random() * Math.PI * 2,
        seedB: Math.random() * Math.PI * 2,
        seedC: 0.7 + Math.random() * 0.6,
        jiggleX: 0,
        jiggleY: 0,
        jiggleVX: 0,
        jiggleVY: 0,
      };
      animatedNodes.push(anim);
    }

    anim.label = node.label;
    anim.isDir = node.isDir;
    anim.isAction = node.isAction;
    anim.isBack = node.isBack;
    anim.actionId = node.actionId;
    anim.path = node.path;
    anim.worldX = node.worldX;
    anim.worldY = node.worldY;
    anim.radius = node.radius;
    anim.baseColor = node.baseColor;

    const targetAlpha = expansionPos;

    anim.curX = approach(anim.curX, anim.worldX, 0.18, dt);
    anim.curY = approach(anim.curY, anim.worldY, 0.18, dt);
    anim.curRadius = approach(anim.curRadius, anim.radius, 0.16, dt);
    anim.curAlpha = approach(anim.curAlpha, index === 0 ? 1 : targetAlpha, 0.12, dt);

    const jiggleSpringK = 0.02;
    const jiggleDamping = 0.92;
    const dx = anim.curX - anim.worldX;
    const dy = anim.curY - anim.worldY;
    anim.jiggleVX += (-dx) * jiggleSpringK;
    anim.jiggleVY += (-dy) * jiggleSpringK;
    anim.jiggleVX *= jiggleDamping;
    anim.jiggleVY *= jiggleDamping;
  });

  animatedNodes = animatedNodes.filter((a) => {
    if (usedKeys.has(a.key)) return true;
    a.curX = approach(a.curX, originX, 0.22, dt);
    a.curY = approach(a.curY, originY, 0.22, dt);
    a.curRadius = approach(a.curRadius, 0, 0.22, dt);
    a.curAlpha = approach(a.curAlpha, 0, 0.22, dt);
    return a.curRadius > 0.5 && a.curAlpha > 0.01;
  });

  animatedNodes.sort((a, b) => {
    if (a.key === "center") return -1;
    if (b.key === "center") return 1;
    return 0;
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("bubble-canvas") as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!isDragging && !showFolderTools && !selectedFile) {
      originX = window.innerWidth / 2;
      originY = window.innerHeight / 2;
    }
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  async function loadCurrentDirectory() {
    try {
      itemsList = await invoke("read_directory", { path: currentPath });
      selectedFile = null;
    } catch (err) {
      console.error("Failed to load path:", err);
    }
  }

  function calculateLayout() {
    const newVisible: RenderNode[] = [];

    const pathParts = currentPath.split(/[\\/]/);
    const folderName = selectedFile ? selectedFile.name : (pathParts[pathParts.length - 1] || currentPath);

    newVisible.push({
      label: selectedEditor ? selectedEditor.toUpperCase() : folderName,
      isDir: !selectedFile,
      isAction: false,
      isBack: false,
      worldX: originX,
      worldY: originY,
      radius: 65,
      baseColor: selectedEditor ? '#8e44ad' : (selectedFile ? '#e2a94a' : '#282c34')
    });

    const angles: number[] = [];
    const parentState = pathHistory[pathHistory.length - 1];

    let satCount = 0;
    if (selectedEditor) {
      const editorsWithWsl = new Set(["vscode", "antigravity", "visualstudio"]);
      satCount = editorsWithWsl.has(selectedEditor) ? 3 : 2;
    } else if (selectedFile || showFolderTools) {
      satCount = TOOLS.length;
    } else {
      satCount = Math.min(itemsList.length, 8);
    }

    if (parentState && satCount > 0) {
      const dx = parentState.x - originX;
      const dy = parentState.y - originY;
      const angleToParent = Math.atan2(dy, dx);

      const halfCount = Math.ceil(satCount / 2);
      const arcSpan = Math.PI * 0.52;

      const start1 = (angleToParent + Math.PI / 2) - arcSpan / 2;
      for (let i = 0; i < halfCount; i++) {
        const angle = halfCount === 1
          ? angleToParent + Math.PI / 2
          : start1 + (i * arcSpan) / (halfCount - 1);
        angles.push(angle);
      }

      const remainingCount = satCount - halfCount;
      if (remainingCount > 0) {
        const start2 = (angleToParent - Math.PI / 2) - arcSpan / 2;
        for (let i = 0; i < remainingCount; i++) {
          const angle = remainingCount === 1
            ? angleToParent - Math.PI / 2
            : start2 + (i * arcSpan) / (remainingCount - 1);
          angles.push(angle);
        }
      }
    } else {
      for (let i = 0; i < satCount; i++) {
        angles.push((2 * Math.PI * i) / satCount - Math.PI / 2);
      }
    }

    if (selectedEditor) {
      const radiusDistance = 180 * expansionPos;
      const editorsWithWsl = new Set(["vscode", "antigravity", "visualstudio"]);
      const envActions = [
        { label: "Windows", action: "launch_window", color: "#2ecc71" },
        ...(editorsWithWsl.has(selectedEditor)
          ? [{ label: "WSL", action: "launch_wsl", color: "#8e44ad" }]
          : []),
        { label: "\u21a9 Back", action: "cancel_editor", color: "#c0392b" }
      ];

      envActions.forEach((act, index) => {
        const angle = angles[index];
        const x = originX + radiusDistance * Math.cos(angle);
        const y = originY + radiusDistance * Math.sin(angle);

        newVisible.push({
          label: act.label,
          isDir: false,
          isAction: true,
          isBack: false,
          actionId: act.action,
          worldX: x,
          worldY: y,
          radius: 40,
          baseColor: act.color
        });
      });
    } else if (selectedFile || showFolderTools) {
      const radiusDistance = 180 * expansionPos;
      TOOLS.forEach((tool, index) => {
        const angle = angles[index];
        const x = originX + radiusDistance * Math.cos(angle);
        const y = originY + radiusDistance * Math.sin(angle);

        newVisible.push({
          label: tool.label,
          isDir: false,
          isAction: true,
          isBack: false,
          actionId: tool.action,
          worldX: x,
          worldY: y,
          radius: 40,
          baseColor: tool.color
        });
      });
    } else {
      const maxNodes = Math.min(itemsList.length, 8);
      const radiusDistance = 200 * expansionPos;

      for (let i = 0; i < maxNodes; i++) {
        const item = itemsList[i];
        const angle = angles[i];
        const x = originX + radiusDistance * Math.cos(angle);
        const y = originY + radiusDistance * Math.sin(angle);

        newVisible.push({
          label: item.name,
          isDir: item.is_dir,
          isAction: false,
          isBack: false,
          path: item.path,
          worldX: x,
          worldY: y,
          radius: item.is_dir ? 45 : 35,
          baseColor: item.is_dir ? '#4a90e2' : '#e2a94a'
        });
      }
    }

    if (currentPath !== START_PATH && !selectedFile && !showFolderTools && !selectedEditor) {
      if (parentState) {
        const dx = parentState.x - originX;
        const dy = parentState.y - originY;
        const angleToParent = Math.atan2(dy, dx);
        const backDistance = 200 * expansionPos;

        const backX = originX + backDistance * Math.cos(angleToParent);
        const backY = originY + backDistance * Math.sin(angleToParent);

        newVisible.push({
          label: "\u21a9 cd ..",
          isDir: true,
          isAction: false,
          isBack: true,
          worldX: backX,
          worldY: backY,
          radius: 35,
          baseColor: '#c0392b'
        });
      }
    }

    visibleNodes = newVisible;
  }

  function getNodeAtPosition(screenX: number, screenY: number): number | null {
    for (let i = 0; i < animatedNodes.length; i++) {
      const node = animatedNodes[i];
      const dx = screenX - (node.curX + node.jiggleX);
      const dy = screenY - (node.curY + node.jiggleY);
      if (Math.sqrt(dx * dx + dy * dy) < node.curRadius) {
        return i;
      }
    }
    return null;
  }

  function clampCoordinates(x: number, y: number) {
    const margin = 245;
    let clampedX = x;
    let clampedY = y;

    if (clampedX < margin) clampedX = margin;
    if (clampedX > window.innerWidth - margin) clampedX = window.innerWidth - margin;
    if (clampedY < margin) clampedY = margin;
    if (clampedY > window.innerHeight - margin) clampedY = window.innerHeight - margin;

    return { x: clampedX, y: clampedY };
  }

  function triggerSpringReset() {
    expansionPos = 0;
    expansionVel = 0;
  }

  canvas.addEventListener('mousemove', async (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (isDragging) {
      const hoverIndex = getNodeAtPosition(mouseX, mouseY);

      if (hoverIndex !== null && animatedNodes[hoverIndex].key !== "center") {
        hoveredNodeIndex = hoverIndex;
        const anim = animatedNodes[hoverIndex];
        const node = visibleNodes.find((n, idx) => nodeKey(n, idx) === anim.key);
        if (!node) return;

        if (!navigationCooldown && expansionPos > 0.85) {
          if (selectedEditor) {
            if (node.isAction) {
              if (node.actionId === 'cancel_editor') {
                navigationCooldown = true;
                setTimeout(() => { navigationCooldown = false; }, 400);
                selectedEditor = null;
                triggerSpringReset();
              } else if (node.actionId === 'launch_window') {
                navigationCooldown = true;
                setTimeout(() => { navigationCooldown = false; }, 400);
                await invoke("launch_editor", { editor: selectedEditor, env: "window", path: getActiveTargetPath() });
                await resetToCenter();
              } else if (node.actionId === 'launch_wsl') {
                navigationCooldown = true;
                setTimeout(() => { navigationCooldown = false; }, 400);
                await invoke("launch_editor", { editor: selectedEditor, env: "wsl", path: getActiveTargetPath() });
                await resetToCenter();
              }
            }
          }
          else if (node.isBack) {
            navigationCooldown = true;
            setTimeout(() => { navigationCooldown = false; }, 400);

            const parentState = pathHistory.pop();
            if (parentState) {
              currentPath = parentState.path;
              originX = parentState.x;
              originY = parentState.y;
              triggerSpringReset();
              await loadCurrentDirectory();
            }
          }
          else if (node.isAction) {
            if (node.actionId?.startsWith('select_')) {
              navigationCooldown = true;
              setTimeout(() => { navigationCooldown = false; }, 400);
              selectedEditor = node.actionId.replace('select_', '');
              triggerSpringReset();
            } else if (node.actionId === 'opencode') {
              navigationCooldown = true;
              setTimeout(() => { navigationCooldown = false; }, 400);
              await invoke("open_wsl_opencode", { path: getActiveTargetPath(), prompt: "start" });
              await resetToCenter();
            } else if (node.actionId === 'back') {
              navigationCooldown = true;
              setTimeout(() => { navigationCooldown = false; }, 400);
              selectedFile = null;
            }
          }
          else if (node.isDir) {
            if (node.path) {
              navigationCooldown = true;
              setTimeout(() => { navigationCooldown = false; }, 400);

              pathHistory.push({ path: currentPath, x: originX, y: originY });

              currentPath = node.path;

              const clamped = clampCoordinates(node.worldX, node.worldY);
              originX = clamped.x;
              originY = clamped.y;
              triggerSpringReset();

              await loadCurrentDirectory();
            }
          }
          else if (!node.isDir) {
            navigationCooldown = true;
            setTimeout(() => { navigationCooldown = false; }, 400);

            pathHistory.push({ path: currentPath, x: originX, y: originY });

            selectedFile = itemsList.find(i => i.path === node.path) || null;

            const clamped = clampCoordinates(node.worldX, node.worldY);
            originX = clamped.x;
            originY = clamped.y;
            triggerSpringReset();
          }
        }
      } else {
        hoveredNodeIndex = null;
      }
    }
  });

  async function resetToCenter() {
    currentPath = START_PATH;
    originX = window.innerWidth / 2;
    originY = window.innerHeight / 2;
    pathHistory = [];
    selectedFile = null;
    showFolderTools = false;
    selectedEditor = null;
    triggerSpringReset();
    await loadCurrentDirectory();
  }

  async function hideWindow() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }

  canvas.addEventListener('mousedown', async (e) => {
    const clickedIndex = getNodeAtPosition(e.clientX, e.clientY);
    const clickedAnim = clickedIndex !== null ? animatedNodes[clickedIndex] : null;
    const isCenterClick = clickedAnim?.key === "center";
    const clickedNode = clickedAnim
      ? visibleNodes.find((n, idx) => nodeKey(n, idx) === clickedAnim.key) ?? null
      : null;

    if (selectedEditor) {
      if (clickedNode && !isCenterClick) {
        if (clickedNode.isAction) {
          if (clickedNode.actionId === 'cancel_editor') {
            selectedEditor = null;
            triggerSpringReset();
          } else if (clickedNode.actionId === 'launch_window') {
            await invoke("launch_editor", { editor: selectedEditor, env: "window", path: getActiveTargetPath() });
            await resetToCenter();
          } else if (clickedNode.actionId === 'launch_wsl') {
            await invoke("launch_editor", { editor: selectedEditor, env: "wsl", path: getActiveTargetPath() });
            await resetToCenter();
          }
        }
      } else {
        selectedEditor = null;
        triggerSpringReset();
      }
    }
    else if (showFolderTools) {
      if (clickedNode && !isCenterClick) {
        if (clickedNode.isAction) {
          if (clickedNode.actionId?.startsWith('select_')) {
            selectedEditor = clickedNode.actionId.replace('select_', '');
            triggerSpringReset();
          } else if (clickedNode.actionId === 'opencode') {
            await invoke("open_wsl_opencode", { path: getActiveTargetPath(), prompt: "start" });
            await resetToCenter();
          } else if (clickedNode.actionId === 'powershell') {
            await invoke("open_powershell", { path: currentPath });
            await resetToCenter();
          } else if (clickedNode.actionId === 'cmd') {
            await invoke("open_cmd", { path: currentPath });
            await resetToCenter();
          }
        }
      } else {
        showFolderTools = false;
        triggerSpringReset();
      }
    }
    else if (selectedFile) {
      if (clickedNode && !isCenterClick) {
        if (clickedNode.isAction) {
          if (clickedNode.actionId?.startsWith('select_')) {
            selectedEditor = clickedNode.actionId.replace('select_', '');
            triggerSpringReset();
          } else if (clickedNode.actionId === 'opencode') {
            await invoke("open_wsl_opencode", { path: getActiveTargetPath(), prompt: "start" });
            await resetToCenter();
          } else if (clickedNode.actionId === 'back') {
            const parentState = pathHistory.pop();
            if (parentState) {
              originX = parentState.x;
              originY = parentState.y;
              triggerSpringReset();
            }
            selectedFile = null;
          } else if (clickedNode.actionId === 'powershell') {
            await invoke("open_powershell", { path: selectedFile.path });
            await resetToCenter();
          } else if (clickedNode.actionId === 'cmd') {
            await invoke("open_cmd", { path: selectedFile.path });
            await resetToCenter();
          }
        }
      } else {
        selectedFile = null;
        showFolderTools = false;
        triggerSpringReset();
      }
    }
    else {
      if (isCenterClick) {
        isDragging = true;
        mouseX = e.clientX;
        mouseY = e.clientY;
      } else {
        await hideWindow();
      }
    }
  });

  canvas.addEventListener('mouseup', async () => {
    if (isDragging) {
      isDragging = false;

      if (hoveredNodeIndex !== null) {
        const anim = animatedNodes[hoveredNodeIndex];
        const node = visibleNodes.find((n, idx) => nodeKey(n, idx) === anim.key);

        if (node) {
          if (node.isAction && node.actionId?.startsWith('select_')) {
          } else if (node.isDir && !node.isAction) {
            showFolderTools = true;
            triggerSpringReset();
          }
        }
      } else {
        showFolderTools = true;
        triggerSpringReset();
      }
      hoveredNodeIndex = null;
    }
  });

  function drawBubble(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
    alpha: number,
    isHovered: boolean,
    wobbleX: number,
    wobbleY: number,
    time: number,
    seedA: number,
    seedB: number
  ) {
    if (radius <= 0.5 || alpha <= 0.01) return;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(wobbleX, wobbleY);

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
    ctx.shadowBlur = isHovered ? 22 : 12;
    ctx.shadowOffsetY = radius * 0.1;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.001)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.clip();

    const bodyGrad = ctx.createRadialGradient(
      -radius * 0.15, -radius * 0.2, radius * 0.1,
      radius * 0.1, radius * 0.15, radius * 1.1
    );
    bodyGrad.addColorStop(0, `rgba(255, 255, 255, ${0.06 * alpha})`);
    bodyGrad.addColorStop(0.6, `rgba(128, 128, 128, ${0.03 * alpha})`);
    bodyGrad.addColorStop(1, `rgba(80, 80, 90, ${0.10 * alpha})`);
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

    const filmHues: { offset: number; rgb: string }[] = [
      { offset: 0.55, rgb: "255, 90, 150" },
      { offset: 0.66, rgb: "255, 175, 80" },
      { offset: 0.78, rgb: "120, 230, 160" },
      { offset: 0.90, rgb: "90, 180, 255" },
      { offset: 1.00, rgb: "180, 130, 255" },
    ];

    const driftX = Math.sin(time * 0.25 + seedA) * radius * 0.08;
    const driftY = Math.cos(time * 0.2 + seedB) * radius * 0.08;

    filmHues.forEach((band, i) => {
      const wobble = 0.015 * Math.sin(time * 0.4 + seedA + i);
      const r0 = radius * (band.offset - 0.10 + wobble);
      const r1 = radius * (band.offset + wobble);
      const ringGrad = ctx.createRadialGradient(driftX, driftY, Math.max(0, r0), driftX, driftY, r1);
      ringGrad.addColorStop(0, `rgba(${band.rgb}, 0)`);
      ringGrad.addColorStop(0.5, `rgba(${band.rgb}, ${0.22 * alpha})`);
      ringGrad.addColorStop(1, `rgba(${band.rgb}, 0)`);
      ctx.fillStyle = ringGrad;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    });

    const accentGrad = ctx.createRadialGradient(0, 0, radius * 0.6, 0, 0, radius);
    accentGrad.addColorStop(0, hexToRgba(color, 0.0));
    accentGrad.addColorStop(1, hexToRgba(color, isHovered ? 0.40 * alpha : 0.26 * alpha));
    ctx.fillStyle = accentGrad;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

    ctx.restore();

    ctx.lineWidth = Math.max(1, radius * 0.04);
    ctx.strokeStyle = `rgba(40, 40, 50, ${0.12 * alpha})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.965, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = isHovered ? 2.2 : 1.4;
    ctx.strokeStyle = isHovered
      ? "rgba(255, 255, 255, 0.95)"
      : `rgba(255, 255, 255, ${0.65 * alpha})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    const hl1X = -radius * (0.32 + 0.04 * Math.sin(time * 0.6 + seedA));
    const hl1Y = -radius * (0.34 + 0.04 * Math.cos(time * 0.5 + seedB));
    const hl1 = ctx.createRadialGradient(hl1X, hl1Y, 0, hl1X, hl1Y, radius * 0.55);
    hl1.addColorStop(0, `rgba(255, 255, 255, ${0.45 * alpha})`);
    hl1.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = hl1;
    ctx.fill();

    const hl2X = -radius * 0.45 + Math.sin(time * 1.3 + seedA) * radius * 0.04;
    const hl2Y = -radius * 0.5 + Math.cos(time * 1.1 + seedB) * radius * 0.04;
    ctx.beginPath();
    ctx.ellipse(hl2X, hl2Y, radius * 0.13, radius * 0.07, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * alpha})`;
    ctx.fill();

    const hl3X = radius * 0.5;
    const hl3Y = radius * 0.45;
    ctx.beginPath();
    ctx.arc(hl3X, hl3Y, radius * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * alpha})`;
    ctx.fill();

    ctx.restore();
  }

  function drawConnection(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    alpha: number,
    isHovered: boolean
  ) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);

    if (isHovered) {
      ctx.strokeStyle = `rgba(120, 230, 180, ${0.85 * alpha})`;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = "rgba(120, 230, 180, 0.6)";
      ctx.shadowBlur = 10;
    } else {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.18 * alpha})`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function draw(timestamp: number) {
    if (!ctx || !canvas) return;

    const dt = lastFrameTime ? Math.min((timestamp - lastFrameTime) / (1000 / 60), 3) : 1;
    lastFrameTime = timestamp;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    animationTime += 0.012 * dt;

    const springForce = (targetExpansion - expansionPos) * springK;
    expansionVel += springForce * dt;
    expansionVel *= Math.pow(damping, dt);
    expansionPos += expansionVel * dt;
    if (Math.abs(expansionPos - targetExpansion) < 0.0005 && Math.abs(expansionVel) < 0.0005) {
      expansionPos = targetExpansion;
      expansionVel = 0;
    }

    calculateLayout();
    syncAnimatedNodes(dt);

    animatedNodes.forEach((node, i) => {
      if (node.key === "center") return;
      const center = animatedNodes.find((a) => a.key === "center");
      if (!center) return;

      const isHovered = hoveredNodeIndex !== null
        && animatedNodes[hoveredNodeIndex]?.key === node.key
        && expansionPos > 0.85;

      drawConnection(
        ctx,
        center.curX,
        center.curY,
        node.curX + node.jiggleX,
        node.curY + node.jiggleY,
        node.curAlpha,
        isHovered
      );

      void i;
    });

    if (isDragging) {
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(mouseX, mouseY);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * expansionPos})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -animationTime * 30;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    animatedNodes.forEach((node, i) => {
      const isCenter = node.key === "center";
      const isHovered = hoveredNodeIndex !== null
        && animatedNodes[hoveredNodeIndex]?.key === node.key
        && expansionPos > 0.85;

      const wobbleAmp = (isCenter ? 0.012 : 0.025) * (isCenter ? 1 : node.curAlpha);
      const wx = 1 + Math.sin(animationTime * node.seedC + node.seedA) * wobbleAmp;
      const wy = 1 - Math.sin(animationTime * node.seedC + node.seedA) * wobbleAmp
                   + Math.cos(animationTime * node.seedC * 0.8 + node.seedB) * wobbleAmp * 0.5;

      let driftX = 0;
      let driftY = 0;
      if (!isCenter) {
        driftX = Math.sin(animationTime * 0.9 + node.seedA) * 3 * node.curAlpha
               + Math.sin(animationTime * 0.4 + node.seedB) * 1.5 * node.curAlpha;
        driftY = Math.cos(animationTime * 0.7 + node.seedB) * 3 * node.curAlpha
               + Math.cos(animationTime * 0.35 + node.seedA) * 1.5 * node.curAlpha;
      }
      node.jiggleX = driftX;
      node.jiggleY = driftY;

      const drawX = node.curX + driftX;
      const drawY = node.curY + driftY;

      drawBubble(
        ctx,
        drawX,
        drawY,
        node.curRadius,
        node.baseColor,
        isCenter ? 1 : node.curAlpha,
        isHovered,
        wx,
        wy,
        animationTime,
        node.seedA,
        node.seedB
      );

      const alpha = isCenter ? 1 : node.curAlpha;
      if (alpha > 0.05) {
        ctx.font = isCenter ? "bold 13px sans-serif" : "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const maxTextWidth = node.curRadius * 1.6;
        let label = node.label;
        if (ctx.measureText(label).width > maxTextWidth && maxTextWidth > 0) {
          label = label.substring(0, 10) + "...";
        }

        ctx.lineJoin = "round";

        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(0, 0, 0, ${0.45 * alpha})`;
        ctx.strokeText(label, drawX, drawY);

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * alpha})`;
        ctx.strokeText(label, drawX, drawY);

        ctx.fillStyle = isCenter ? "#ffffff" : `rgba(255, 255, 255, ${0.97 * alpha})`;
        ctx.fillText(label, drawX, drawY);
      }

      void i;
    });

    requestAnimationFrame(draw);
  }

  loadCurrentDirectory().then(() => {
    requestAnimationFrame(draw);
  });
});
