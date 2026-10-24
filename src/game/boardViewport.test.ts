import { describe, expect, it } from 'vitest';
import {
  boardGeometry, boardViewport, clampBoardCamera, fitBoardZoom, minimumBoardZoom,
  screenToBoardCell, visibleBoardCells, zoomBoardCamera,
} from './boardViewport';

const viewport = boardViewport(520, 520);
const largeBoard = { width: 50, height: 50 };

describe('board viewport', () => {
  it.each([{ width: 50, height: 50 }, { width: 50, height: 3 }, { width: 3, height: 50 }])('fits all cells on a $width × $height map', (board) => {
    const camera = clampBoardCamera({ centerX: board.width / 2, centerY: board.height / 2, zoom: fitBoardZoom(board, viewport) }, board, viewport);
    expect(visibleBoardCells(board, boardGeometry(camera, viewport))).toEqual({ minX: 0, maxX: board.width - 1, minY: 0, maxY: board.height - 1 });
    expect(camera.zoom).toBeLessThanOrEqual(1);
  });

  it('keeps the same cell under an off-center zoom anchor', () => {
    const camera = { centerX: 25, centerY: 25, zoom: 1 };
    const point = { x: 350, y: 180 };
    const before = screenToBoardCell(point, largeBoard, boardGeometry(camera, viewport));
    const after = zoomBoardCamera(camera, 1.5, point, largeBoard, viewport);
    expect(screenToBoardCell(point, largeBoard, boardGeometry(after, viewport))).toEqual(before);
  });

  it('converts zoomed and panned coordinates to cells beyond the old size limit', () => {
    const camera = clampBoardCamera({ centerX: 42, centerY: 40, zoom: 1.5 }, largeBoard, viewport);
    const geometry = boardGeometry(camera, viewport);
    expect(screenToBoardCell({ x: geometry.x + 41.5 * geometry.cellSize, y: geometry.y + 39.5 * geometry.cellSize }, largeBoard, geometry)).toEqual({ x: 41, y: 39 });
  });

  it('rejects fixed axes, clipped board pixels, empty margins and the right boundary', () => {
    const geometry = boardGeometry({ centerX: 25, centerY: 25, zoom: 1 }, viewport);
    expect(screenToBoardCell({ x: 20, y: 100 }, largeBoard, geometry)).toBeNull();
    expect(screenToBoardCell({ x: 100, y: 20 }, largeBoard, geometry)).toBeNull();
    expect(screenToBoardCell({ x: viewport.x + viewport.width, y: 100 }, largeBoard, geometry)).toBeNull();
    const small = { width: 3, height: 3 };
    expect(screenToBoardCell({ x: 31, y: 31 }, small, boardGeometry({ centerX: 1.5, centerY: 1.5, zoom: 1 }, viewport))).toBeNull();
  });

  it('clamps pan to map edges and centers a map smaller than the viewport', () => {
    const camera = clampBoardCamera({ centerX: 100, centerY: -100, zoom: 1 }, largeBoard, viewport);
    const half = viewport.width / 96;
    expect(camera.centerX).toBeCloseTo(50 - half);
    expect(camera.centerY).toBeCloseTo(half);
    expect(clampBoardCamera(camera, { width: 3, height: 3 }, viewport)).toEqual({ centerX: 1.5, centerY: 1.5, zoom: 1 });
  });

  it('retains a valid view center and zoom when the map dimensions change', () => {
    const camera = { centerX: 40, centerY: 40, zoom: 1.25 };
    expect(clampBoardCamera(camera, largeBoard, viewport)).toEqual(camera);
    const smaller = { width: 20, height: 15 };
    const clamped = clampBoardCamera(camera, smaller, viewport);
    const visible = visibleBoardCells(smaller, boardGeometry(clamped, viewport));
    expect(clamped.zoom).toBe(1.25);
    expect(visible?.maxX).toBe(19);
    expect(visible?.maxY).toBe(14);
  });

  it('does not increase zoom when fitting a 50-column map into a narrow viewport', () => {
    const narrow = boardViewport(180, 360);
    const fit = fitBoardZoom(largeBoard, narrow);
    expect(fit).toBeLessThan(0.08);
    expect(minimumBoardZoom(largeBoard, narrow)).toBe(fit);
    expect(clampBoardCamera({ centerX: 25, centerY: 25, zoom: fit / 1.25 }, largeBoard, narrow).zoom).toBe(fit);
  });
});
