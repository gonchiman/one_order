import { describe, expect, it } from 'vitest';
import { applyAction, createBoard, getMovementRange } from './board';
import type { BoardAction, BoardState, Cell } from './board';
import { createMatchScenario } from './scenario';
import { actOnSession, createSession, resetExperiment, startExperiment, undoTurn } from './session';

function apply(board: BoardState, action: BoardAction): BoardState {
  const result = applyAction(board, action);
  expect(result.error).toBeNull();
  return result.state;
}

function keys(cells: Cell[]): string[] {
  return cells.map(({ x, y }) => `${x},${y}`).sort();
}

describe('大きなマップでの既存操作', () => {
  it('右下付近でも配置・壁・陣地・目的地を設定し、占有マスと壁への進入を拒否する', () => {
    let board = createBoard(50, 50);
    board = apply(board, { type: 'add', position: { x: 49, y: 48 }, unitType: 'cavalry' });
    expect(board.units.find((unit) => unit.id === 3)?.position).toEqual({ x: 49, y: 48 });
    expect(applyAction(board, { type: 'move', unitId: 3, position: { x: 49, y: 49 } }).error).not.toBeNull();
    board = apply(board, { type: 'remove', unitId: 2 });
    board = apply(board, { type: 'move', unitId: 3, position: { x: 49, y: 49 } });
    board = apply(board, { type: 'set-wall', position: { x: 49, y: 47 }, blocked: true });
    board = apply(board, { type: 'set-goal', side: 'enemy', position: { x: 48, y: 49 } });
    board = apply(board, { type: 'order', unitId: 3, destination: { x: 48, y: 48 } });
    expect(board.units.find((unit) => unit.id === 3)).toMatchObject({
      position: { x: 49, y: 49 }, destination: { x: 48, y: 48 },
    });
    expect(board.walls).toEqual([{ x: 49, y: 47 }]);
    expect(board.goals.enemy).toEqual({ x: 48, y: 49 });
    expect(applyAction(board, { type: 'order', unitId: 3, destination: { x: 49, y: 47 } }).error).not.toBeNull();
  });

  it.each<Cell>([{ x: 50, y: 49 }, { x: 49, y: 50 }, { x: -1, y: 49 }, { x: 49.5, y: 49 }])(
    '最大マップでも盤外や小数の座標 %j を全編集操作で拒否する', (cell) => {
      const board = createBoard(50, 50);
      const actions: BoardAction[] = [
        { type: 'add', position: cell },
        { type: 'move', unitId: 1, position: cell },
        { type: 'set-wall', position: cell, blocked: true },
        { type: 'set-goal', side: 'enemy', position: cell },
        { type: 'order', unitId: 1, destination: cell },
      ];
      for (const action of actions) {
        const result = applyAction(board, action);
        expect(result.error).not.toBeNull();
        expect(result.state).toBe(board);
      }
    },
  );

  it('大きな座標の角でも移動範囲を盤内に収め、壁を迂回して数える', () => {
    const initial = createBoard(50, 50);
    const board: BoardState = {
      ...initial,
      units: [{ ...initial.units[0]!, position: { x: 49, y: 49 }, moveDistance: 2 }],
      walls: [{ x: 48, y: 49 }],
    };
    expect(keys(getMovementRange(board, 1))).toEqual(['48,48', '49,47', '49,48']);
  });

  it('旧上限を超える座標でユニットと壁を迂回し、移動力を守って目的地へ到着する', () => {
    const initial = createBoard(50, 50);
    const destination = { x: 49, y: 45 };
    let board: BoardState = {
      ...initial,
      units: [
        { ...initial.units[0]!, position: { x: 40, y: 45 }, destination, moveDistance: 2 },
        { ...initial.units[1]!, position: { x: 43, y: 46 } },
      ],
      walls: Array.from({ length: 48 }, (_, y) => ({ x: 44, y })),
    };
    const wallKeys = new Set(keys(board.walls));
    for (let turn = 1; turn <= 8; turn += 1) {
      const previous = board.units[0]!.position;
      board = apply(board, { type: 'advance' });
      const position = board.units[0]!.position;
      expect(Math.abs(position.x - previous.x) + Math.abs(position.y - previous.y)).toBeLessThanOrEqual(2);
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThan(50);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThan(50);
      expect(wallKeys.has(`${position.x},${position.y}`)).toBe(false);
      expect(position).not.toEqual(board.units[1]!.position);
      if (turn < 8) expect(position).not.toEqual(destination);
    }
    expect(board.units[0]!.position).toEqual(destination);
    expect(board.units[1]!.position).toEqual({ x: 43, y: 46 });
  });

  it('大マップで進行・戻す・再実行・初期状態へ戻すと寸法と配置と指示を保持する', () => {
    const started = startExperiment(createSession(createMatchScenario(50, 50)));
    const ordered = actOnSession(started, { type: 'order', unitId: 2, destination: { x: 49, y: 48 } });
    expect(ordered.error).toBeNull();
    const initial = structuredClone(ordered.session.board);
    const first = actOnSession(ordered.session, { type: 'advance' });
    const second = actOnSession(first.session, { type: 'advance' });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.session.board.units[1]!.position).not.toEqual(initial.units[1]!.position);
    expect(second.session.board).toMatchObject({ width: 50, height: 50, turn: 2 });
    const undone = undoTurn(second.session);
    expect(undone.board).toEqual(first.session.board);
    const replayed = actOnSession(undone, { type: 'advance' });
    expect(replayed.error).toBeNull();
    expect(replayed.session.board).toEqual(second.session.board);
    expect(replayed.session.events).toEqual(second.session.events);
    const reset = resetExperiment(replayed.session);
    expect(reset.board).toEqual(initial);
    expect(reset.history).toEqual([]);
  });
});
