import type { Cell } from '../core/board';

export const STANDARD_CELL_SIZE = 48;
export const MAX_BOARD_ZOOM = 2;

export interface MapSize { width: number; height: number }
export interface ViewportRect { x: number; y: number; width: number; height: number }
export interface BoardCamera { centerX: number; centerY: number; zoom: number }
export interface VisibleCells { minX: number; maxX: number; minY: number; maxY: number }
export interface BoardGeometry { x: number; y: number; cellSize: number; viewport: ViewportRect }
export interface BoardViewportSnapshot {
  zoom: number;
  isPanning: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  visible: VisibleCells | null;
}

export function boardViewport(width: number, height: number): ViewportRect {
  return { x: 30, y: 30, width: Math.max(1, width - 38), height: Math.max(1, height - 38) };
}

export function fitBoardZoom(board: MapSize, viewport: ViewportRect): number {
  return Math.min(1, viewport.width / (board.width * STANDARD_CELL_SIZE), viewport.height / (board.height * STANDARD_CELL_SIZE));
}

export function minimumBoardZoom(board: MapSize, viewport: ViewportRect): number {
  return Math.min(0.08, fitBoardZoom(board, viewport));
}

export function clampBoardCamera(camera: BoardCamera, board: MapSize, viewport: ViewportRect): BoardCamera {
  const zoom = Math.max(minimumBoardZoom(board, viewport), Math.min(MAX_BOARD_ZOOM, camera.zoom));
  const halfWidth = viewport.width / (STANDARD_CELL_SIZE * zoom * 2);
  const halfHeight = viewport.height / (STANDARD_CELL_SIZE * zoom * 2);
  const center = (value: number, length: number, half: number): number => half * 2 >= length
    ? length / 2 : Math.max(half, Math.min(length - half, value));
  return { centerX: center(camera.centerX, board.width, halfWidth), centerY: center(camera.centerY, board.height, halfHeight), zoom };
}

export function boardGeometry(camera: BoardCamera, viewport: ViewportRect): BoardGeometry {
  const cellSize = STANDARD_CELL_SIZE * camera.zoom;
  return {
    x: viewport.x + viewport.width / 2 - camera.centerX * cellSize,
    y: viewport.y + viewport.height / 2 - camera.centerY * cellSize,
    cellSize,
    viewport,
  };
}

export function visibleBoardCells(board: MapSize, geometry: BoardGeometry): VisibleCells | null {
  const { x, y, cellSize, viewport } = geometry;
  const minX = Math.max(0, Math.floor((viewport.x - x) / cellSize));
  const minY = Math.max(0, Math.floor((viewport.y - y) / cellSize));
  const maxX = Math.min(board.width - 1, Math.ceil((viewport.x + viewport.width - x) / cellSize) - 1);
  const maxY = Math.min(board.height - 1, Math.ceil((viewport.y + viewport.height - y) / cellSize) - 1);
  return minX > maxX || minY > maxY ? null : { minX, maxX, minY, maxY };
}

export function screenToBoardCell(point: Cell, board: MapSize, geometry: BoardGeometry): Cell | null {
  const { x, y, cellSize, viewport } = geometry;
  if (point.x < viewport.x || point.y < viewport.y || point.x >= viewport.x + viewport.width || point.y >= viewport.y + viewport.height) return null;
  const cell = { x: Math.floor((point.x - x) / cellSize), y: Math.floor((point.y - y) / cellSize) };
  return cell.x < 0 || cell.y < 0 || cell.x >= board.width || cell.y >= board.height ? null : cell;
}

/** Keep the world position under the anchor stable unless a map edge requires clamping. */
export function zoomBoardCamera(camera: BoardCamera, zoom: number, anchor: Cell, board: MapSize, viewport: ViewportRect): BoardCamera {
  const nextZoom = Math.max(minimumBoardZoom(board, viewport), Math.min(MAX_BOARD_ZOOM, zoom));
  const offsetX = anchor.x - viewport.x - viewport.width / 2;
  const offsetY = anchor.y - viewport.y - viewport.height / 2;
  return clampBoardCamera({
    centerX: camera.centerX + offsetX / (STANDARD_CELL_SIZE * camera.zoom) - offsetX / (STANDARD_CELL_SIZE * nextZoom),
    centerY: camera.centerY + offsetY / (STANDARD_CELL_SIZE * camera.zoom) - offsetY / (STANDARD_CELL_SIZE * nextZoom),
    zoom: nextZoom,
  }, board, viewport);
}
