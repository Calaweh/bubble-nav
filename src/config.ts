export const START_PATH = import.meta.env.VITE_START_PATH || "D:\\Projects";

export const EXPAND_RATE   = 0.28;
export const COLLAPSE_RATE = 0.32;

export const NODE_MOVE_RATE  = 0.55;
export const NODE_ALPHA_RATE = 0.50;
export const NODE_RAD_RATE   = 0.50;
export const NODE_EXIT_RATE  = 0.55;

export const POS_SNAP   = 0.15;
export const ALPHA_SNAP = 0.005;
export const RAD_SNAP   = 0.15;

export const DRAG_THRESHOLD = 40;

export const MAX_PATH_HISTORY = 32;

export const MAX_VISIBLE_ITEMS = 24;
export const MIN_SATELLITE_RADIUS = 28;

export const VIGNETTE_OPACITY = 0.25;
export const VIGNETTE_RADIUS_SCALE = 0.55;

export const COLORS = {
  dir:       "#4a90e2",
  file:      "#2ecc71",
  back:      "#c0392b",
  center:    "#2c313a",
  centerFile:  "#e2a94a",
  centerEditor: "#9b59b6",
  exited:    "#f1c40f",
  error:     "#e74c3c",
  loading:   "#f39c12",
  vscode:    "#007acc",
  visualstudio: "#5c2d91",
  antigravity:  "#1abc9c",
  opencode:  "#e67e22",
  powershell: "#27ae60",
  cmd:       "#607080",
  wsl:       "#e95420",
  code:      "#5dade2",
  doc:       "#a569bd",
  image:     "#e59866",
  data:      "#48c9b0",
  binary:    "#d35400",
  other:     "#95a5a6",
  tools:     "#7f8c8d",
} as const;

const CODE_EXT = new Set([
  "ts","tsx","js","jsx","mjs","cjs","rs","py","c","cpp","h","hpp",
  "java","go","rb","php","swift","kt","scala","cs","fs","lua","r",
  "sh","bash","zsh","fish","ps1","psm1","psd1","bat","cmd","nim",
]);
const DOC_EXT = new Set([
  "md","txt","pdf","doc","docx","rtf","odt",
  "ppt","pptx","xls","xlsx","csv","tsv",
]);
const IMAGE_EXT = new Set([
  "jpg","jpeg","png","gif","bmp","svg","ico","webp","tiff","psd","ai","eps",
]);
const DATA_EXT = new Set([
  "json","yaml","yml","toml","ini","cfg","conf","lock","sqlite","db","sqlite3",
]);
const BIN_EXT = new Set([
  "exe","dll","so","dylib","bin","dat","pdb","obj","o","a","lib","msi","deb","rpm",
]);

export type FileCategory = "code" | "doc" | "image" | "data" | "binary" | "other";

export function getFileCategory(filename: string): FileCategory {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (CODE_EXT.has(ext)) return "code";
  if (DOC_EXT.has(ext)) return "doc";
  if (IMAGE_EXT.has(ext)) return "image";
  if (DATA_EXT.has(ext)) return "data";
  if (BIN_EXT.has(ext)) return "binary";
  return "other";
}

export function fileColor(filename: string): string {
  const cat = getFileCategory(filename);
  const map: Record<FileCategory, string> = {
    code: COLORS.code,
    doc: COLORS.doc,
    image: COLORS.image,
    data: COLORS.data,
    binary: COLORS.binary,
    other: COLORS.other,
  };
  return map[cat];
}

export const FILE_BADGE: Record<FileCategory, string> = {
  code:   "<>",
  doc:    "MD",
  image:  "IMG",
  data:   "{}",
  binary: "EXE",
  other:  "?",
};

export interface ToolDef {
  label: string;
  action: string;
  color: string;
}

export const TOOLS: ToolDef[] = [
  { label: "VS Code",       action: "select_vscode",       color: COLORS.vscode },
  { label: "Visual Studio", action: "select_visualstudio", color: COLORS.visualstudio },
  { label: "Antigravity",   action: "select_antigravity",  color: COLORS.antigravity },
  { label: "OpenCode",      action: "opencode",            color: COLORS.opencode },
  { label: "Powershell",    action: "powershell",          color: COLORS.powershell },
  { label: "CMD",           action: "cmd",                 color: COLORS.cmd },
  { label: "WSL",           action: "wsl",                 color: COLORS.wsl },
  { label: "↩ cd ..",       action: "back",                color: COLORS.back }
];
