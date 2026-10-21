import { describe, expect, it } from 'vitest';
import { createBoard } from './board';
import type { BoardAction, BoardState, UnitEvent } from './board';
import {
  actOnSession,
  createSession,
  editExperiment,
  resetExperiment,
  startExperiment,
  undoTurn,
} from './session';
import type { SandboxSession } from './session';

function act(session: SandboxSession, action: BoardAction): SandboxSession {
  const result = actOnSession(session, action);
  expect(result.error).toBeNull();
  return result.session;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function withDestinations(): BoardState {
  const board = createBoard(5, 5, { orderLimit: 1, moveDistance: 1 });
  return {
    ...board,
    units: [
      { id: 1, position: { x: 0, y: 4 }, destination: { x: 0, y: 0 } },
      { id: 2, position: { x: 4, y: 4 }, destination: { x: 4, y: 0 } },
    ],
  };
}

describe('実験の開始配置', () => {
  it('渡された状態を独立した開始配置として保持し、ターンと指示枠を初期化する', () => {
    const board = { ...withDestinations(), turn: 8, orderedUnitIds: [1] };
    const session = createSession(board);
    expect(session.mode).toBe('edit');
    expect(session.board.turn).toBe(0);
    expect(session.board.orderedUnitIds).toEqual([]);
    expect(session.board).toEqual(session.initialBoard);

    board.units[0]!.position.x = 3;
    board.units[0]!.destination!.y = 2;
    board.rules.moveDistance = 3;
    board.orderedUnitIds.push(2);
    expect(session.initialBoard.units[0]?.position).toEqual({ x: 0, y: 4 });
    expect(session.initialBoard.units[0]?.destination).toEqual({ x: 0, y: 0 });
    expect(session.initialBoard.rules.moveDistance).toBe(1);
    expect(session.initialBoard.orderedUnitIds).toEqual([]);

    session.board.units[0]!.position.x = 2;
    session.board.rules.orderLimit = 2;
    expect(session.initialBoard.units[0]?.position.x).toBe(0);
    expect(session.initialBoard.rules.orderLimit).toBe(1);
  });

  it('編集した配置を実験の開始位置として保存し、前の履歴と行動を消す', () => {
    const edited = act(createSession(), { type: 'move', unitId: 1, position: { x: 1, y: 2 } });
    const session = startExperiment(edited);
    expect(session.mode).toBe('run');
    expect(session.board.units[0]?.position).toEqual({ x: 1, y: 2 });
    expect(session.initialBoard).toEqual(session.board);
    expect(session.history).toEqual([]);
    expect(session.events).toEqual([]);

    const advanced = act(session, { type: 'advance' });
    const startedAgain = startExperiment(advanced);
    expect(startedAgain.board.turn).toBe(0);
    expect(startedAgain.board.orderedUnitIds).toEqual([]);
    expect(startedAgain.history).toEqual([]);
    expect(startedAgain.events).toEqual([]);
  });

  it('実験中の位置を編集に移し、最後の開始配置は保持する', () => {
    const initial = startExperiment(createSession(withDestinations()));
    const moved = act(initial, { type: 'advance' });
    const edited = editExperiment(moved);
    expect(edited.mode).toBe('edit');
    expect(edited.board.units[0]?.position).toEqual({ x: 0, y: 3 });
    expect(edited.board.turn).toBe(0);
    expect(edited.board.orderedUnitIds).toEqual([]);
    expect(edited.board.units.every((unit) => unit.destination === null)).toBe(true);
    expect(edited.history).toEqual([]);
    expect(edited.events).toEqual([]);
    expect(edited.initialBoard).toEqual(initial.initialBoard);
    expect(edited.initialBoard.units[0]?.position).toEqual({ x: 0, y: 4 });
    expect(edited.initialBoard.units[0]?.destination).toEqual({ x: 0, y: 0 });
    expect(resetExperiment(edited).mode).toBe('edit');
  });

  it('開始配置へ戻して別の指示で同じ実験を繰り返せる', () => {
    const initial = startExperiment(createSession(withDestinations()));
    const first = act(initial, { type: 'order', unitId: 1, destination: { x: 2, y: 4 } });
    const moved = act(first, { type: 'advance' });
    const reset = resetExperiment(moved);
    expect(reset.board).toEqual(initial.board);
    expect(reset.mode).toBe('run');
    expect(reset.history).toEqual([]);
    expect(reset.events).toEqual([]);
    expect(reset.board.orderedUnitIds).toEqual([]);

    const alternative = act(reset, { type: 'order', unitId: 2, destination: { x: 2, y: 4 } });
    expect(alternative.board.orderedUnitIds).toEqual([2]);
    const alternativeTurn = act(alternative, { type: 'advance' });
    expect(alternativeTurn.board.units[0]?.position).toEqual({ x: 0, y: 3 });
    expect(alternativeTurn.board.units[1]?.position).toEqual({ x: 3, y: 4 });

    reset.board.units[0]!.destination!.x = 3;
    reset.board.rules.moveDistance = 4;
    reset.board.orderedUnitIds.push(2);
    expect(resetExperiment(reset).board).toEqual(initial.board);
  });
});

describe('ターンを戻す', () => {
  it('位置・目的地・ターン数・指示済みの駒をそのターンの直前へ復元する', () => {
    const started = startExperiment(createSession(withDestinations()));
    const ordered = act(started, { type: 'order', unitId: 1, destination: { x: 2, y: 4 } });
    const advanced = act(ordered, { type: 'advance' });
    expect(advanced.board.turn).toBe(1);
    expect(advanced.board.orderedUnitIds).toEqual([]);
    const restored = undoTurn(advanced);
    expect(restored.board).toEqual(ordered.board);
    expect(restored.events).toEqual(ordered.events);
    expect(restored.board.orderedUnitIds).toEqual([1]);
    expect(restored.board.units[0]?.destination).toEqual({ x: 2, y: 4 });
    expect(restored.history).toEqual([]);
    expect(restored.initialBoard).toEqual(started.initialBoard);
    expect(actOnSession(restored, { type: 'order', unitId: 2, destination: { x: 3, y: 4 } }).error).not.toBeNull();
    expect(act(restored, { type: 'advance' }).board).toEqual(advanced.board);
  });

  it('複数ターンの履歴を1つずつ戻し、直前の行動表示も復元する', () => {
    const started = startExperiment(createSession(withDestinations()));
    const first = act(started, { type: 'advance' });
    const ordered = act(first, { type: 'order', unitId: 2, destination: null });
    expect(ordered.events).toEqual(first.events);
    const second = act(ordered, { type: 'advance' });
    expect(second.history).toHaveLength(2);
    expect(second.events.find((event) => event.unitId === 2)?.reason).toBe('no-order');
    const restored = undoTurn(second);
    expect(restored.board).toEqual(ordered.board);
    expect(restored.events).toEqual(first.events);
    expect(restored.history).toHaveLength(1);
    const beginning = undoTurn(restored);
    expect(beginning.board).toEqual(started.board);
    expect(beginning.events).toEqual([]);
    expect(beginning.history).toEqual([]);
    expect(undoTurn(beginning)).toBe(beginning);
  });

  it('戻した状態の編集によって、保存した履歴の座標や行動を壊さない', () => {
    const event: UnitEvent = {
      unitId: 1, from: { x: 0, y: 4 }, to: { x: 0, y: 3 }, reason: 'moved',
    };
    const started = { ...startExperiment(createSession(withDestinations())), events: [event] };
    const advanced = act(started, { type: 'advance' });
    const restored = undoTurn(advanced);
    restored.board.units[0]!.position.x = 3;
    restored.board.units[0]!.destination!.y = 2;
    restored.board.rules.moveDistance = 3;
    restored.events[0]!.from.x = 3;
    expect(advanced.history[0]?.board.units[0]?.position).toEqual({ x: 0, y: 4 });
    expect(advanced.history[0]?.board.units[0]?.destination).toEqual({ x: 0, y: 0 });
    expect(advanced.history[0]?.board.rules.moveDistance).toBe(1);
    expect(advanced.history[0]?.events[0]?.from).toEqual({ x: 0, y: 4 });
  });
});

describe('編集と実験の操作範囲', () => {
  it('配置操作は編集時のみ、指示と進行は実験中のみ許可する', () => {
    const editing = createSession();
    const running = startExperiment(editing);
    const editActions: BoardAction[] = [
      { type: 'add', position: { x: 2, y: 2 } },
      { type: 'move', unitId: 1, position: { x: 2, y: 2 } },
      { type: 'remove', unitId: 1 },
    ];
    for (const action of editActions) {
      const denied = actOnSession(running, action);
      expect(denied.error).not.toBeNull();
      expect(denied.session).toBe(running);
      expect(actOnSession(editing, action).error).toBeNull();
    }
    const runActions: BoardAction[] = [
      { type: 'order', unitId: 1, destination: { x: 2, y: 2 } },
      { type: 'advance' },
    ];
    for (const action of runActions) {
      const denied = actOnSession(editing, action);
      expect(denied.error).not.toBeNull();
      expect(denied.session).toBe(editing);
      expect(actOnSession(running, action).error).toBeNull();
    }
  });

  it('不正な操作では履歴を増やさず元のセッションを返す', () => {
    const editing = createSession();
    const result = actOnSession(editing, { type: 'move', unitId: 1, position: { x: -1, y: 0 } });
    expect(result.error).not.toBeNull();
    expect(result.session).toBe(editing);
    expect(result.session.history).toEqual([]);
  });

  it('操作や開始・復元で呼び出し元の状態を変更しない', () => {
    const editing = freeze(createSession(withDestinations()));
    const before = structuredClone(editing);
    expect(() => act(editing, { type: 'move', unitId: 1, position: { x: 1, y: 4 } })).not.toThrow();
    const running = freeze(startExperiment(editing));
    const ordered = freeze(act(running, { type: 'order', unitId: 1, destination: { x: 2, y: 4 } }));
    const advanced = freeze(act(ordered, { type: 'advance' }));
    expect(() => undoTurn(advanced)).not.toThrow();
    expect(() => resetExperiment(advanced)).not.toThrow();
    expect(() => editExperiment(advanced)).not.toThrow();
    expect(editing).toEqual(before);
    expect(ordered.board.orderedUnitIds).toEqual([1]);
    expect(advanced.history[0]?.board).toEqual(ordered.board);
  });
});
