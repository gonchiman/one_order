import Phaser from 'phaser';
import type { BoardState, Cell } from '../../core/board';
import { unitLabel } from '../../core/labels';

export interface BoardView {
  board: BoardState;
  selectedUnitId: number | null;
  targeting: boolean;
}

interface BoardGeometry {
  x: number;
  y: number;
  cellSize: number;
}

export class BoardScene extends Phaser.Scene {
  private view: BoardView;
  private readonly onCellClick: (cell: Cell) => void;
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private geometry: BoardGeometry | null = null;

  constructor(view: BoardView, onCellClick: (cell: Cell) => void) {
    super('BoardScene');
    this.view = view;
    this.onCellClick = onCellClick;
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.game.canvas.setAttribute('role', 'img');
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointer, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.draw, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointer, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.draw, this);
      this.labels = [];
      this.graphics = null;
      this.geometry = null;
    });
    this.draw();
  }

  setView(view: BoardView): void {
    this.view = view;
    if (this.graphics !== null) this.draw();
  }

  private handlePointer(pointer: Phaser.Input.Pointer): void {
    const geometry = this.geometry;
    if (geometry === null) return;
    const x = Math.floor((pointer.x - geometry.x) / geometry.cellSize);
    const y = Math.floor((pointer.y - geometry.y) / geometry.cellSize);
    if (x < 0 || y < 0 || x >= this.view.board.width || y >= this.view.board.height) return;
    this.onCellClick({ x, y });
  }

  private text(
    x: number,
    y: number,
    value: string,
    fontSize: number,
    color = '#111111',
  ): Phaser.GameObjects.Text {
    const label = this.add.text(x, y, value, {
      fontFamily: 'sans-serif',
      fontSize: `${fontSize}px`,
      color,
    }).setOrigin(0.5);
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
    const availableWidth = Math.max(1, this.scale.width - 38);
    const availableHeight = Math.max(1, this.scale.height - 38);
    const cellSize = Math.max(1, Math.min(availableWidth / board.width, availableHeight / board.height));
    const smallCell = cellSize < 44;
    const width = cellSize * board.width;
    const height = cellSize * board.height;
    const x = 30 + (availableWidth - width) / 2;
    const y = 30 + (availableHeight - height) / 2;
    this.geometry = { x, y, cellSize };

    const selected = board.units.find((unit) => unit.id === selectedUnitId);
    if (selected !== undefined) {
      graphics.fillStyle(0xe9e9e9, 1);
      graphics.fillRect(x + selected.position.x * cellSize, y + selected.position.y * cellSize, cellSize, cellSize);
    }

    graphics.lineStyle(1, 0xbbbbbb, 1);
    for (let column = 0; column <= board.width; column++) {
      const lineX = x + column * cellSize;
      graphics.lineBetween(lineX, y, lineX, y + height);
      if (column < board.width) this.text(lineX + cellSize / 2, y - 16, String(column + 1), 12, '#555555');
    }
    for (let row = 0; row <= board.height; row++) {
      const lineY = y + row * cellSize;
      graphics.lineBetween(x, lineY, x + width, lineY);
      if (row < board.height) this.text(x - 16, lineY + cellSize / 2, String(row + 1), 12, '#555555');
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
      const cellX = x + cell.x * cellSize;
      const cellY = y + cell.y * cellSize;
      const inset = Math.max(3, cellSize * 0.1);
      this.dashedRectangle(cellX + inset, cellY + inset, cellSize - inset * 2, cellSize - inset * 2);
      const names = unitIds.map(unitLabel).join('・');
      const occupied = board.units.some((unit) => unit.position.x === cell.x && unit.position.y === cell.y);
      if (occupied && smallCell) continue;
      const label = this.text(
        cellX + cellSize / 2,
        cellY + cellSize * (occupied ? 0.18 : 0.5),
        names,
        11,
        '#555555',
      );
      const availableLabelWidth = Math.max(0, cellSize - inset * 2 - 2);
      if (label.width > availableLabelWidth) label.setText(`×${unitIds.length}`);
      if (label.width > availableLabelWidth) label.setText('+');
      if (label.width > availableLabelWidth) label.setVisible(false);
    }

    for (const unit of board.units) {
      const goalHere = destinations.has(`${unit.position.x},${unit.position.y}`);
      const shiftForGoal = goalHere && !smallCell;
      const centerX = x + (unit.position.x + 0.5) * cellSize;
      const centerY = y + (unit.position.y + (shiftForGoal ? 0.65 : 0.5)) * cellSize;
      const radius = cellSize * (smallCell ? 0.43 : shiftForGoal ? 0.22 : 0.27);
      const isSelected = unit.id === selectedUnitId;
      graphics.fillStyle(isSelected ? 0x222222 : 0xffffff, 1);
      graphics.fillCircle(centerX, centerY, radius);
      graphics.lineStyle(1, 0x222222, 1);
      graphics.strokeCircle(centerX, centerY, radius);
      const fontSize = Math.max(11, Math.min(18, cellSize * 0.25));
      this.text(centerX, centerY, unitLabel(unit.id), fontSize, isSelected ? '#ffffff' : '#111111');
    }

    const selectedDescription = selected === undefined ? '選択なし' : `選択中の駒 ${unitLabel(selected.id)}`;
    this.game.canvas.setAttribute('aria-label', `${board.width}列${board.height}行の盤面、駒${board.units.length}体、ターン${board.turn}、${selectedDescription}`);
    this.game.canvas.style.cursor = this.view.targeting ? 'crosshair' : 'default';
  }
}
