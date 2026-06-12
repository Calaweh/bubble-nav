export const START_PATH = import.meta.env.VITE_START_PATH || "";

export const EXPAND_RATE   = 0.28;
export const COLLAPSE_RATE = 0.32;

export const NODE_MOVE_RATE  = 0.55;
export const NODE_ALPHA_RATE = 0.50;
export const NODE_RAD_RATE   = 0.50;
export const NODE_EXIT_RATE  = 0.55;

export const POS_SNAP   = 0.15;
export const ALPHA_SNAP = 0.005;
export const RAD_SNAP   = 0.15;

export interface ToolDef {
  label: string;
  action: string;
  color: string;
}

export const TOOLS: ToolDef[] = [
  { label: "VS Code",       action: "select_vscode",       color: "#4a90e2" },
  { label: "Visual Studio", action: "select_visualstudio", color: "#8e44ad" },
  { label: "Antigravity",   action: "select_antigravity",  color: "#1abc9c" },
  { label: "OpenCode",      action: "opencode",            color: "#e67e22" },
  { label: "Powershell",    action: "powershell",          color: "#27ae60" },
  { label: "CMD",           action: "cmd",                 color: "#607080" },
  { label: "↩ cd ..",       action: "back",                color: "#c0392b" }
];
