import { describe, expect, it } from 'vitest';
import { applyAction, createBoard, getMovementRange } from './board';
import type { BoardState, Cell, Unit } from './board';
import type { UnitSide } from './unitTypes';

function scenario(moveDistance = 1, position: Cell = { x: 3, y: 3 }): BoardState {
  const board = createBoard(7, 7);
  return { ...board, units: [{ ...board.units[0]!, position, moveDistance }] };
}

function keys(cells: Cell[]): string[] {
  return cells.map((cell) => `${cell.x},${cell.y}`).sort();
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe('選択ユニットの移動範囲', () => {
  it.each([
    { distance: 1, cells: ['2,3', '3,2', '3,4', '4,3'] },
    { distance: 2, cells: ['1,3', '2,2', '2,3', '2,4', '3,1', '3,2', '3,4', '3,5', '4,2', '4,3', '4,4', '5,3'] },
  ])('開けた場所で移動力 $distance 以内のマスを返し、現在地を含めない', ({ distance, cells }) => {
    expect(keys(getMovementRange(scenario(distance), 1))).toEqual(cells.sort());
  });

  it('長方形の盤面の端でも盤外のマスを含めない', () => {
    const board = { ...scenario(2, { x: 0, y: 0 }), width: 3, height: 5 };
    expect(keys(getMovementRange(board, 1))).toEqual(['0,1', '0,2', '1,0', '1,1', '2,0']);
  });

  it('壁そのものを除き、壁の裏には迂回に必要な移動力があるときだけ届く', () => {
    const board = { ...scenario(3, { x: 1, y: 2 }), walls: [{ x: 2, y: 2 }] };
    expect(getMovementRange(board, 1)).not.toContainEqual({ x: 2, y: 2 });
    expect(getMovementRange(board, 1)).not.toContainEqual({ x: 3, y: 2 });
    const increased = applyAction(board, { type: 'set-move-distance', unitId: 1, moveDistance: 4 });
    expect(increased.error).toBeNull();
    expect(getMovementRange(increased.state, 1)).toContainEqual({ x: 3, y: 2 });
    expect(getMovementRange(increased.state, 1)).not.toContainEqual({ x: 2, y: 2 });
  });

  it.each<{ side: UnitSide; destination: Cell | null }>([
    { side: 'ally', destination: null },
    { side: 'enemy', destination: null },
    { side: 'ally', destination: { x: 2, y: 1 } },
    { side: 'enemy', destination: { x: 2, y: 1 } },
  ])('$side のユニットを、移動指示の有無に関係なく障害物として扱う ($destination)', ({ side, destination }) => {
    const board = scenario(2, { x: 1, y: 2 });
    const other: Unit = { ...board.units[0]!, id: 2, side, position: { x: 2, y: 2 }, destination };
    board.units.push(other);
    board.units[0]!.destination = { ...other.position };
    const range = getMovementRange(board, 1);
    expect(range).not.toContainEqual({ x: 2, y: 2 });
    expect(range).not.toContainEqual({ x: 3, y: 2 });
    expect(range).toContainEqual({ x: 2, y: 1 });
    const increased = applyAction(board, { type: 'set-move-distance', unitId: 1, moveDistance: 4 });
    expect(getMovementRange(increased.state, 1)).toContainEqual({ x: 3, y: 2 });
    expect(getMovementRange(increased.state, 1)).not.toContainEqual({ x: 2, y: 2 });
  });

  it('壁とユニットで囲まれている場合は空の範囲を返す', () => {
    const board = scenario(12);
    board.walls = [{ x: 2, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 2 }];
    board.units.push({ ...board.units[0]!, id: 2, position: { x: 3, y: 4 } });
    expect(getMovementRange(board, 1)).toEqual([]);
  });

  it('移動力・位置・地形の編集後は新しい状態から範囲を計算する', () => {
    const board = scenario(1, { x: 2, y: 2 });
    expect(getMovementRange(board, 1)).not.toContainEqual({ x: 2, y: 4 });
    const increased = applyAction(board, { type: 'set-move-distance', unitId: 1, moveDistance: 2 }).state;
    expect(getMovementRange(increased, 1)).toContainEqual({ x: 2, y: 4 });
    const moved = applyAction(increased, { type: 'move', unitId: 1, position: { x: 3, y: 3 } }).state;
    expect(getMovementRange(moved, 1)).toContainEqual({ x: 3, y: 5 });
    expect(getMovementRange(moved, 1)).not.toContainEqual({ x: 1, y: 2 });
    const walled = applyAction(moved, { type: 'set-wall', position: { x: 3, y: 4 }, blocked: true }).state;
    expect(getMovementRange(walled, 1)).not.toContainEqual({ x: 3, y: 5 });
    const reopened = applyAction(walled, { type: 'set-wall', position: { x: 3, y: 4 }, blocked: false }).state;
    expect(getMovementRange(reopened, 1)).toContainEqual({ x: 3, y: 5 });
  });

  it('盤面状態を変更せず、返したマスも元の状態を共有しない', () => {
    const board = scenario(3);
    board.walls = [{ x: 4, y: 3 }];
    board.goals.ally = { x: 2, y: 3 };
    board.units[0]!.destination = { x: 3, y: 1 };
    board.orderedUnitIds = [1];
    const snapshot = structuredClone(board);
    const range = getMovementRange(freeze(board), 1);
    expect(range.length).toBeGreaterThan(0);
    for (const cell of range) cell.x = 99;
    expect(board).toEqual(snapshot);
    expect(getMovementRange(board, 1).every((cell) => cell.x !== 99)).toBe(true);
  });

  it('存在しないユニット ID には空の範囲を返す', () => {
    expect(getMovementRange(scenario(), 99)).toEqual([]);
  });

  it('表示範囲外の目的地を設定でき、既存の目的地で範囲を制限しない', () => {
    const board = scenario();
    const destination = { x: 6, y: 6 };
    const range = getMovementRange(board, 1);
    expect(range).not.toContainEqual(destination);
    const ordered = applyAction(board, { type: 'order', unitId: 1, destination });
    expect(ordered.error).toBeNull();
    expect(ordered.state.units[0]!.destination).toEqual(destination);
    expect(getMovementRange(ordered.state, 1)).toEqual(range);
    expect(ordered.state.orderedUnitIds).toEqual([1]);
  });
});
