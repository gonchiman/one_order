import Phaser from 'phaser';
import { getMovementRange } from '../../core/board';
import type { BoardState, Cell } from '../../core/board';
import { unitLabel } from '../../core/labels';
import { UNIT_SIDES, UNIT_TYPES } from '../../core/unitTypes';
import {
  boardGeometry, boardViewport, clampBoardCamera, fitBoardZoom, MAX_BOARD_ZOOM,
  minimumBoardZoom, screenToBoardCell, visibleBoardCells, zoomBoardCamera,
} from '../boardViewport';
import type { BoardCamera, BoardGeometry, BoardViewportSnapshot } from '../boardViewport';

const SIDE_COLORS = Object.freeze({ ally: 0x245a81, enemy: 0xa13737 });
export const RANGE_COLORS = Object.freeze({ movement: 0xe2ebf2, attack: 0x8a6840 });

export interface BoardView {
  board: BoardState;
  selectedUnitId: number | null;
  targeting: boolean;
}

export class BoardScene extends Phaser.Scene {
  private view: BoardView;
  private readonly onCellClick: (cell: Cell) => void;
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private geometry: BoardGeometry | null = null;
  private camera: BoardCamera;
  private fitted = true;
  private panning = false;
  private drag: { pointerId: number; point: Cell } | null = null;
  private viewportCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private listenersAttached = false;
  private readonly onViewportChange?: (snapshot: BoardViewportSnapshot) => void;
  private rangeBoard: BoardState | null = null;
  private rangeUnitId: number | null = null;
  private movementRange: Cell[] = [];

  constructor(view: BoardView, onCellClick: (cell: Cell) => void, onViewportChange?: (snapshot: BoardViewportSnapshot) => void) {
    super('BoardScene');
    this.view = view;
    this.onCellClick = onCellClick;
    this.onViewportChange = onViewportChange;
    this.camera = { centerX: view.board.width / 2, centerY: view.board.height / 2, zoom: 1 };
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.viewportCamera = this.cameras.add();
    this.cameras.main.ignore(this.graphics);
    this.game.canvas.setAttribute('role', 'img');
    this.game.canvas.style.touchAction = 'none';
    this.game.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.game.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.game.canvas.addEventListener('pointerup', this.handlePointerEnd);
    this.game.canvas.addEventListener('pointercancel', this.handlePointerEnd);
    this.game.canvas.addEventListener('lostpointercapture', this.handlePointerEnd);
    window.addEventListener('blur', this.cancelDrag);
    this.listenersAttached = true;
    this.scale.on(Phaser.Scale.Events.RESIZE, this.draw, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanup, this);
    this.draw();
  }

  private cleanup(): void {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;
    this.cancelDrag();
    this.game.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.game.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.game.canvas.removeEventListener('pointerup', this.handlePointerEnd);
    this.game.canvas.removeEventListener('pointercancel', this.handlePointerEnd);
    this.game.canvas.removeEventListener('lostpointercapture', this.handlePointerEnd);
    window.removeEventListener('blur', this.cancelDrag);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.draw, this);
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanup, this);
    this.labels = [];
    this.graphics = null;
    this.geometry = null;
    this.viewportCamera = null;
  }

  setView(view: BoardView): void {
    if (view.board.width !== this.view.board.width || view.board.height !== this.view.board.height) this.fitted = false;
    this.view = view;
    if (this.graphics !== null) this.draw();
  }

  zoomIn(): void { this.changeZoom(this.camera.zoom * 1.25); }
  zoomOut(): void { this.changeZoom(this.camera.zoom / 1.25); }

  fit(): void {
    this.cancelDrag();
    this.fitted = true;
    this.draw();
  }

  focusSelected(): void {
    const selected = this.view.board.units.find((unit) => unit.id === this.view.selectedUnitId);
    if (selected === undefined) return;
    this.cancelDrag();
    this.fitted = false;
    this.camera = { centerX: selected.position.x + 0.5, centerY: selected.position.y + 0.5, zoom: 1 };
    this.draw();
  }

  setPanning(enabled: boolean): void {
    this.cancelDrag();
    this.panning = enabled;
    this.draw();
  }

  panByCells(dx: number, dy: number): void {
    if (!this.panning) return;
    this.fitted = false;
    this.camera = { ...this.camera, centerX: this.camera.centerX + dx, centerY: this.camera.centerY + dy };
    this.draw();
  }

  private changeZoom(zoom: number): void {
    if (this.geometry === null) return;
    this.cancelDrag();
    this.fitted = false;
    const viewport = this.geometry.viewport;
    this.camera = zoomBoardCamera(this.camera, zoom, { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 }, this.view.board, viewport);
    this.draw();
  }

  private pointerPoint(event: PointerEvent): Cell {
    const rect = this.game.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * this.scale.width / rect.width, y: (event.clientY - rect.top) * this.scale.height / rect.height };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag !== null || this.geometry === null) return;
    const point = this.pointerPoint(event);
    const cell = screenToBoardCell(point, this.view.board, this.geometry);
    if (cell === null) return;
    if (this.panning) {
      event.preventDefault();
      this.drag = { pointerId: event.pointerId, point };
      this.game.canvas.setPointerCapture(event.pointerId);
      this.game.canvas.style.cursor = 'grabbing';
    } else this.onCellClick(cell);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.drag === null || this.drag.pointerId !== event.pointerId || this.geometry === null) return;
    event.preventDefault();
    const point = this.pointerPoint(event);
    this.fitted = false;
    this.camera = { ...this.camera,
      centerX: this.camera.centerX - (point.x - this.drag.point.x) / this.geometry.cellSize,
      centerY: this.camera.centerY - (point.y - this.drag.point.y) / this.geometry.cellSize,
    };
    this.drag.point = point;
    this.draw();
  };

  private handlePointerEnd = (event: PointerEvent): void => {
    if (this.drag?.pointerId === event.pointerId) this.cancelDrag();
  };

  private cancelDrag = (): void => {
    const pointerId = this.drag?.pointerId;
    this.drag = null;
    if (pointerId !== undefined && this.game.canvas.hasPointerCapture(pointerId)) this.game.canvas.releasePointerCapture(pointerId);
    this.game.canvas.style.cursor = this.panning ? 'grab' : this.view.targeting ? 'crosshair' : 'default';
  };

  private text(
    x: number,
    y: number,
    value: string,
    fontSize: number,
    color = '#111111',
    boardContent = true,
  ): Phaser.GameObjects.Text {
    const label = this.add.text(x, y, value, {
      fontFamily: 'sans-serif',
      fontSize: `${fontSize}px`,
      color,
    }).setOrigin(0.5);
    if (boardContent) this.cameras.main.ignore(label);
    else this.viewportCamera?.ignore(label);
    this.labels.push(label);
    return label;
  }

  private dashedRectangle(x: number, y: number, width: number, height: number): void {
    const graphics = this.graphics;
    if (graphics === null) return;
    const dash = 4;
    const gap = 3;
    graphics.lineStyle(1, 0x777777, 1);
    for (let offset = 0; offset < width; offset += dash + gap) {
      const end = Math.min(width, offset + dash);
      graphics.lineBetween(x + offset, y, x + end, y);
      graphics.lineBetween(x + offset, y + height, x + end, y + height);
    }
    for (let offset = 0; offset < height; offset += dash + gap) {
      const end = Math.min(height, offset + dash);
      graphics.lineBetween(x, y + offset, x, y + end);
      graphics.lineBetween(x + width, y + offset, x + width, y + end);
    }
  }

  private draw(): void {
    const graphics = this.graphics;
    if (graphics === null) return;
    graphics.clear();
    this.labels.forEach((label) => label.destroy());
    this.labels = [];

    const { board, selectedUnitId } = this.view;
    const viewport = boardViewport(this.scale.width, this.scale.height);
    if (this.fitted) this.camera = { centerX: board.width / 2, centerY: board.height / 2, zoom: fitBoardZoom(board, viewport) };
    this.camera = clampBoardCamera(this.camera, board, viewport);
    this.geometry = boardGeometry(this.camera, viewport);
    const { x, y, cellSize } = this.geometry;
    const visible = visibleBoardCells(board, this.geometry);
    const isVisible = (cell: Cell): boolean => visible !== null && cell.x >= visible.minX && cell.x <= visible.maxX && cell.y >= visible.minY && cell.y <= visible.maxY;
    // A camera viewport clips both Graphics and Text in Canvas and WebGL renderers.
    this.viewportCamera?.setViewport(viewport.x, viewport.y, viewport.width, viewport.height).setScroll(viewport.x, viewport.y);
    const smallCell = cellSize < 44;
    const width = cellSize * board.width;
    const height = cellSize * board.height;

    const wallKeys = new Set(board.walls.map((cell) => `${cell.x},${cell.y}`));
    const occupiedKeys = new Set(board.units.map((unit) => `${unit.position.x},${unit.position.y}`));
    for (const wall of board.walls) {
      if (!isVisible(wall)) continue;
      const wallX = x + wall.x * cellSize + 1;
      const wallY = y + wall.y * cellSize + 1;
      const size = Math.max(0, cellSize - 2);
      graphics.fillStyle(0xe5e5e5, 1);
      graphics.fillRect(wallX, wallY, size, size);
      graphics.lineStyle(1, 0xc5c5c5, 1);
      for (let offset = -size; offset < size; offset += 8) {
        const startX = Math.max(0, offset);
        const startY = Math.max(0, -offset);
        const endX = Math.min(size, size + offset);
        const endY = Math.min(size, size - offset);
        graphics.lineBetween(wallX + startX, wallY + startY, wallX + endX, wallY + endY);
        graphics.lineBetween(wallX + startX, wallY + size - startY, wallX + endX, wallY + size - endY);
      }
    }

    const selected = board.units.find((unit) => unit.id === selectedUnitId);
    if (this.rangeBoard !== board || this.rangeUnitId !== selectedUnitId) {
      this.movementRange = selected === undefined ? [] : getMovementRange(board, selected.id);
      this.rangeBoard = board;
      this.rangeUnitId = selectedUnitId;
    }
    const movementRange = this.movementRange;
    if (selected !== undefined) {
      for (const cell of movementRange) {
        if (!isVisible(cell)) continue;
        graphics.fillStyle(RANGE_COLORS.movement, 1);
        graphics.fillRect(x + cell.x * cellSize, y + cell.y * cellSize, cellSize, cellSize);
      }
      graphics.lineStyle(1, RANGE_COLORS.attack, 1);
      for (let row = visible?.minY ?? 0; row <= (visible?.maxY ?? -1); row += 1) {
        for (let column = visible?.minX ?? 0; column <= (visible?.maxX ?? -1); column += 1) {
          const distance = Math.abs(column - selected.position.x) + Math.abs(row - selected.position.y);
          if (distance > 0 && distance <= selected.attackRange && !wallKeys.has(`${column},${row}`)) {
            const occupied = occupiedKeys.has(`${column},${row}`);
            // 小さいマスのユニットにも射程枠が隠れないよう外側へ寄せる。
            const inset = smallCell && occupied ? Math.max(1, cellSize * 0.035) : Math.max(3, cellSize * 0.16);
            graphics.strokeRect(x + column * cellSize + inset, y + row * cellSize + inset, Math.max(0, cellSize - inset * 2), Math.max(0, cellSize - inset * 2));
          }
        }
      }
      if (isVisible(selected.position)) {
        graphics.fillStyle(0xe9e9e9, 1);
        graphics.fillRect(x + selected.position.x * cellSize, y + selected.position.y * cellSize, cellSize, cellSize);
      }
    }

    graphics.lineStyle(1, 0xbbbbbb, 1);
    const axisStep = Math.max(1, Math.ceil(26 / cellSize));
    for (let column = visible?.minX ?? 0; column <= (visible?.maxX ?? -1) + 1; column++) {
      const lineX = x + column * cellSize;
      graphics.lineBetween(lineX, y, lineX, y + height);
      const centerX = lineX + cellSize / 2;
      if (column < board.width && column % axisStep === 0 && centerX >= viewport.x + 7 && centerX <= viewport.x + viewport.width - 7) {
        this.text(centerX, viewport.y - 16, String(column + 1), 12, '#555555', false);
      }
    }
    for (let row = visible?.minY ?? 0; row <= (visible?.maxY ?? -1) + 1; row++) {
      const lineY = y + row * cellSize;
      graphics.lineBetween(x, lineY, x + width, lineY);
      const centerY = lineY + cellSize / 2;
      if (row < board.height && row % axisStep === 0 && centerY >= viewport.y + 7 && centerY <= viewport.y + viewport.height - 7) {
        this.text(viewport.x - 16, centerY, String(row + 1), 12, '#555555', false);
      }
    }

    const goalKeys = new Set<string>();
    const goalLabelBottoms = new Map<string, number>();
    for (const side of ['ally', 'enemy'] as const) {
      const goal = board.goals[side];
      if (goal === null) continue;
      goalKeys.add(`${goal.x},${goal.y}`);
      if (!isVisible(goal)) continue;
      const goalX = x + goal.x * cellSize;
      const goalY = y + goal.y * cellSize;
      const name = side === 'ally' ? 'P1' : 'P2';
      graphics.lineStyle(2, SIDE_COLORS[side], 1);
      graphics.strokeRect(goalX + 2, goalY + 2, Math.max(0, cellSize - 4), Math.max(0, cellSize - 4));
      if (cellSize < 23) continue;
      const label = this.text(
        goalX + 4,
        goalY + Math.max(3, cellSize * 0.04),
        smallCell ? name : `${name}陣地`,
        smallCell ? 9 : 10,
        `#${SIDE_COLORS[side].toString(16).padStart(6, '0')}`,
      ).setOrigin(0, 0);
      if (label.width > cellSize - 8) label.setText(name);
      if (label.width > cellSize - 8) label.setVisible(false);
      if (label.visible) goalLabelBottoms.set(`${goal.x},${goal.y}`, label.y - goalY + label.height + 2);
    }

    const destinations = new Map<string, { cell: Cell; unitIds: number[] }>();
    for (const unit of board.units) {
      if (unit.destination === null) continue;
      const key = `${unit.destination.x},${unit.destination.y}`;
      const existing = destinations.get(key);
      if (existing === undefined) destinations.set(key, { cell: unit.destination, unitIds: [unit.id] });
      else existing.unitIds.push(unit.id);
    }
    for (const { cell, unitIds } of destinations.values()) {
      if (!isVisible(cell)) continue;
      const cellX = x + cell.x * cellSize;
      const cellY = y + cell.y * cellSize;
      const inset = Math.max(3, cellSize * 0.1);
      this.dashedRectangle(cellX + inset, cellY + inset, cellSize - inset * 2, cellSize - inset * 2);
      const names = unitIds.map(unitLabel).join('・');
      const occupied = occupiedKeys.has(`${cell.x},${cell.y}`);
      // 陣地名とユニットが同居するマスでは、目的地は破線だけで示す。
      const baseHere = goalKeys.has(`${cell.x},${cell.y}`);
      if (cellSize < 23 || (occupied && (smallCell || baseHere)) || (baseHere && smallCell)) continue;
      const label = this.text(
        cellX + cellSize / 2,
        cellY + cellSize * (occupied ? 0.14 : 0.5),
        names,
        occupied ? 10 : 11,
        '#555555',
      );
      const availableLabelWidth = Math.max(0, cellSize - inset * 2 - 2);
      if (label.width > availableLabelWidth) label.setText(`×${unitIds.length}`);
      if (label.width > availableLabelWidth) label.setText('+');
      if (label.width > availableLabelWidth) label.setVisible(false);
    }

    for (const unit of board.units) {
      if (!isVisible(unit.position)) continue;
      const key = `${unit.position.x},${unit.position.y}`;
      const baseHere = goalKeys.has(key);
      const shiftForGoal = (destinations.has(key) || baseHere) && !smallCell;
      const centerX = x + (unit.position.x + 0.5) * cellSize;
      const headerHeight = smallCell && baseHere ? goalLabelBottoms.get(key) ?? 0 : 0;
      const markerHeight = Math.max(1, cellSize - headerHeight - 3);
      const centerOffsetY = smallCell && baseHere ? headerHeight + markerHeight / 2
        : cellSize * (smallCell ? 0.5 : shiftForGoal ? 0.51 : 0.44);
      const centerY = y + unit.position.y * cellSize + centerOffsetY;
      const radius = smallCell && baseHere ? Math.min(cellSize * 0.3, markerHeight / 2)
        : cellSize * (smallCell ? 0.43 : shiftForGoal ? 0.2 : 0.27);
      const isSelected = unit.id === selectedUnitId;
      const sideColor = SIDE_COLORS[unit.side];
      graphics.fillStyle(isSelected ? sideColor : 0xffffff, 1);
      graphics.lineStyle(1, sideColor, 1);
      if (unit.side === 'ally') {
        graphics.fillCircle(centerX, centerY, radius);
        graphics.strokeCircle(centerX, centerY, radius);
      } else {
        graphics.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
        graphics.strokeRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
      }
      if (cellSize < 23) continue;
      const label = `${unitLabel(unit.id)}${UNIT_TYPES[unit.type].mark}`;
      const fontSize = Math.max(11, Math.min(16, cellSize * 0.22));
      const text = this.text(centerX, centerY, label, fontSize, isSelected ? '#ffffff' : '#111111');
      // 読めない大きさへ縮めず、収まらない識別名は記号だけで示す。
      const availableLabelWidth = Math.max(1, Math.min(cellSize - 4, radius * 2 - 4));
      if (text.width > availableLabelWidth || fontSize > radius * 2 - 2) text.setVisible(false);
      if (!smallCell) {
        this.text(centerX, y + (unit.position.y + 0.85) * cellSize, `${unit.hp}/${unit.maxHp}`, 10, '#555555');
      }
    }

    const selectedDescription = selected === undefined ? '選択なし'
      : `選択中のユニット ${unitLabel(selected.id)} ${UNIT_SIDES[selected.side].name} ${UNIT_TYPES[selected.type].name}、HP${selected.hp}/${selected.maxHp}、攻撃力${selected.attack}、射程${selected.attackRange}マス、移動力${selected.moveDistance}マス、移動優先度${selected.movePriority}`;
    const coordinates = (cell: Cell): string => `(${cell.x + 1},${cell.y + 1})`;
    const movementDescription = selected === undefined ? ''
      : `1ターンの移動範囲（目安）${movementRange.length === 0 ? 'なし' : movementRange.map(coordinates).join('・')}`;
    const goalsDescription = (['ally', 'enemy'] as const).map((side) => {
      const goal = board.goals[side];
      return `${side === 'ally' ? 'P1' : 'P2'}陣地${goal === null ? 'なし' : coordinates(goal)}`;
    }).join('、');
    const wallsDescription = board.walls.length === 0 ? '壁なし' : `壁${board.walls.map(coordinates).join('・')}`;
    const destinationsDescription = board.units.filter((unit) => unit.destination !== null)
      .map((unit) => `${unitLabel(unit.id)}の目的地${coordinates(unit.destination!)}`).join('、');
    const outcomeReasons = { goal: '陣地占領', elimination: '全滅', simultaneous: '同時決着', 'turn-limit': 'ターン上限' };
    const winnerDescription = board.outcome?.winner === 'ally' ? 'P1の勝利'
      : board.outcome?.winner === 'enemy' ? 'P2の勝利' : '引き分け';
    const outcomeDescription = board.outcome === null ? ''
      : `${winnerDescription}、${outcomeReasons[board.outcome.reason]}`;
    this.game.canvas.setAttribute('aria-label', [
      `${board.width}列${board.height}行の盤面、ユニット${board.units.length}体、ターン${board.turn}`,
      selectedDescription, movementDescription, goalsDescription, wallsDescription, destinationsDescription, outcomeDescription,
    ].filter(Boolean).join('、'));
    this.game.canvas.style.cursor = this.panning ? (this.drag === null ? 'grab' : 'grabbing') : this.view.targeting ? 'crosshair' : 'default';
    this.onViewportChange?.({
      zoom: this.camera.zoom,
      isPanning: this.panning,
      canZoomIn: this.camera.zoom < MAX_BOARD_ZOOM - 0.000001,
      canZoomOut: this.camera.zoom > minimumBoardZoom(board, viewport) + 0.000001,
      visible,
    });
  }
}
