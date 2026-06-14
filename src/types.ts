export interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface HistoryState {
  path: string;
  x: number;
  y: number;
  // Offset of the satellite node we entered, relative to the parent's originX/Y.
  // i.e. exitX = node.curX - originX at the moment of doNavigateDown.
  // Reconstruct absolute position on the way back as: parentOriginX + exitX.
  exitX: number;
  exitY: number;
}

export interface RenderNode {
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

export interface AnimatedNode extends RenderNode {
  curX: number;
  curY: number;
  curRadius: number;
  curAlpha: number;
  key: string;
}
