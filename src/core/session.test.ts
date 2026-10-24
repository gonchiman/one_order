import { describe, expect, it } from 'vitest';
import { createBoard, prioritySideForTurn } from './board';
import type { BoardAction, BoardState, UnitEvent } from './board';
import { UNIT_TYPES } from './unitTypes';
import {
  actOnSession,
  createSession,
  editExperiment,
  isInitialOrderPhase,
  resetExperiment,
  startExperiment,
  undoTurn,
} from './session';
import type { SandboxSession } from './session';
import { createMatchScenario } from './scenario';

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
  const board = createBoard(5, 5, { orderLimit: 1 });
  return {
    ...board,
    units: [
      { ...board.units[0]!, position: { x: 0, y: 4 }, destination: { x: 0, y: 0 } },
      {
        ...board.units[1]!, type: 'archer', hp: UNIT_TYPES.archer.maxHp,
        maxHp: UNIT_TYPES.archer.maxHp, attack: UNIT_TYPES.archer.attack, attackRange: UNIT_TYPES.archer.attackRange,
        position: { x: 4, y: 4 }, destination: { x: 4, y: 0 },
      },
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
    board.units[0]!.type = 'cavalry';
    board.units[0]!.moveDistance = 3;
    board.orderedUnitIds.push(2);
    expect(session.initialBoard.units[0]?.position).toEqual({ x: 0, y: 4 });
    expect(session.initialBoard.units[0]?.destination).toEqual({ x: 0, y: 0 });
    expect(session.initialBoard.units[0]?.type).toBe('infantry');
    expect(session.initialBoard.units[0]?.moveDistance).toBe(1);
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
    expect(reset.board).toEqual(first.board);
    expect(reset.mode).toBe('run');
    expect(reset.history).toEqual([]);
    expect(reset.events).toEqual([]);
    expect(reset.board.orderedUnitIds).toEqual([]);

    const alternative = act(reset, { type: 'order', unitId: 2, destination: { x: 2, y: 4 } });
    expect(alternative.board.orderedUnitIds).toEqual([]);
    const alternativeTurn = act(alternative, { type: 'advance' });
    expect(alternativeTurn.board.units[0]?.position).toEqual({ x: 1, y: 4 });
    expect(alternativeTurn.board.units[1]?.position).toEqual({ x: 3, y: 4 });

    reset.board.units[0]!.destination!.x = 3;
    reset.board.units[0]!.type = 'cavalry';
    reset.board.units[0]!.moveDistance = 4;
    reset.board.orderedUnitIds.push(2);
    expect(resetExperiment(reset).board).toEqual(first.board);
  });
});

describe('ターンを戻す', () => {
  it('位置・目的地・ターン数・指示済みのユニットをそのターンの直前へ復元する', () => {
    const started = act(startExperiment(createSession(withDestinations())), { type: 'advance' });
    const ordered = act(started, { type: 'order', unitId: 1, destination: { x: 2, y: 4 } });
    const advanced = act(ordered, { type: 'advance' });
    expect(advanced.board.turn).toBe(2);
    expect(advanced.board.orderedUnitIds).toEqual([]);
    const restored = undoTurn(advanced);
    expect(restored.board).toEqual(ordered.board);
    expect(restored.events).toEqual(ordered.events);
    expect(restored.board.orderedUnitIds).toEqual([1]);
    expect(restored.board.units[0]?.destination).toEqual({ x: 2, y: 4 });
    expect(restored.history).toHaveLength(1);
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
    restored.board.units[0]!.type = 'cavalry';
    restored.board.units[0]!.moveDistance = 3;
    restored.events[0]!.from.x = 3;
    expect(advanced.history[0]?.board.units[0]?.position).toEqual({ x: 0, y: 4 });
    expect(advanced.history[0]?.board.units[0]?.destination).toEqual({ x: 0, y: 0 });
    expect(advanced.history[0]?.board.units[0]?.type).toBe('infantry');
    expect(advanced.history[0]?.board.units[0]?.moveDistance).toBe(1);
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
      { type: 'set-type', unitId: 1, unitType: 'cavalry' },
      { type: 'set-move-distance', unitId: 1, moveDistance: 3 },
      { type: 'reset-move-distance', unitId: 1 },
      { type: 'set-side', unitId: 1, side: 'enemy' },
      { type: 'set-combat-stat', unitId: 1, stat: 'maxHp', value: 7 },
      { type: 'set-combat-stat', unitId: 1, stat: 'attack', value: 3 },
      { type: 'set-combat-stat', unitId: 1, stat: 'attackRange', value: 2 },
      { type: 'set-move-priority', unitId: 1, movePriority: 3 },
      { type: 'set-wall', position: { x: 2, y: 2 }, blocked: true },
      { type: 'set-goal', side: 'ally', position: { x: 4, y: 4 } },
      { type: 'set-match-rules', firstPrioritySide: 'enemy', turnLimit: 40 },
      { type: 'set-initial-order', unitId: 1, destination: { x: 2, y: 2 } },
      { type: 'set-initial-order', unitId: 1, destination: null },
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
    expect(ordered.board.orderedUnitIds).toEqual([]);
    expect(advanced.history[0]?.board).toEqual(ordered.board);
  });
});

describe('開始前の初期指示', () => {
  function initiallyOrdered(): SandboxSession {
    let session = createSession(createMatchScenario());
    for (const unit of session.board.units) {
      session = act(freeze(session), {
        type: 'set-initial-order', unitId: unit.id,
        destination: { x: unit.position.x, y: unit.position.y + (unit.side === 'ally' ? -1 : 1) },
      });
    }
    return session;
  }

  it('両陣営の全員へ制限なく初期指示を設定・変更・解除し、指示枠を消費しない', () => {
    const editing = initiallyOrdered();
    expect(editing.board.units.every((unit) => unit.destination !== null)).toBe(true);
    expect(editing.board.orderedUnitIds).toEqual([]);
    expect(editing.board.turn).toBe(0);
    expect(editing.history).toEqual([]);
    expect(editing.initialBoard.units.every((unit) => unit.destination === null)).toBe(true);
    const changed = act(editing, { type: 'set-initial-order', unitId: 1, destination: { x: 3, y: 5 } });
    const cleared = act(changed, { type: 'set-initial-order', unitId: 1, destination: null });
    expect(cleared.board.units[0]?.destination).toBeNull();
    expect(cleared.board.units.slice(1)).toEqual(editing.board.units.slice(1));
    expect(cleared.board.orderedUnitIds).toEqual([]);
    expect(act(cleared, { type: 'set-initial-order', unitId: 1, destination: { x: 3, y: 6 } }).board).toEqual(editing.board);
  });

  it('開始時に初期指示を保存し、初回移動後は各陣営の通常指示枠に戻る', () => {
    const editing = initiallyOrdered();
    const started = startExperiment(editing);
    expect(started.board).toEqual(editing.board);
    expect(started.initialBoard).toEqual(editing.board);
    let running = act(act(started, { type: 'advance' }), { type: 'order', unitId: 1, destination: { x: 3, y: 5 } });
    running = act(running, { type: 'order', unitId: 1, destination: null });
    running = act(running, { type: 'order', unitId: 4, destination: { x: 3, y: 3 } });
    expect(running.board.orderedUnitIds).toEqual([1, 4]);
    for (const unitId of [2, 5]) {
      const denied = actOnSession(running, { type: 'order', unitId, destination: null });
      expect(denied.error).not.toBeNull();
      expect(denied.session).toBe(running);
    }
    for (const destination of [{ x: 3, y: 4 }, null]) {
      const denied = actOnSession(running, { type: 'set-initial-order', unitId: 1, destination });
      expect(denied.error).not.toBeNull();
      expect(denied.session).toBe(running);
    }
    expect(running.initialBoard).toEqual(editing.board);
    expect(running.board.units[1]?.destination).toEqual(editing.board.units[1]?.destination);
  });

  it('追加指示なしでも全員が初回から移動し、undoと再実行で同じ状態を復元する', () => {
    const started = startExperiment(initiallyOrdered());
    const advanced = act(freeze(started), { type: 'advance' });
    expect(advanced.board.units.map((unit) => unit.position)).toEqual(started.board.units.map((unit) => unit.destination));
    expect(advanced.events.every((event) => event.reason === 'arrived')).toBe(true);
    expect(advanced.board.orderedUnitIds).toEqual([]);
    expect(advanced.combatEvents).toEqual([]);
    const restored = undoTurn(advanced);
    expect(restored).toEqual(started);
    expect(act(restored, { type: 'advance' })).toEqual(advanced);
    restored.board.units[0]!.destination!.y = 0;
    expect(advanced.history[0]?.board).toEqual(started.board);
    expect(advanced.initialBoard).toEqual(started.board);
  });

  it('試合終了後の再戦で、試合中に解除した指示も初期指示へ戻す', () => {
    const editing = act(initiallyOrdered(), { type: 'set-match-rules', turnLimit: 2 });
    const started = startExperiment(editing);
    const changed = act(act(started, { type: 'advance' }), { type: 'order', unitId: 1, destination: null });
    const ended = act(changed, { type: 'advance' });
    expect(ended.board.outcome).toEqual({ winner: null, reason: 'turn-limit' });
    expect(ended.board.units[0]?.destination).toBeNull();
    const rematch = resetExperiment(freeze(ended));
    expect(rematch).toEqual(started);
    expect(rematch.board.orderedUnitIds).toEqual([]);
    expect(rematch.board.units.every((unit) => unit.destination !== null)).toBe(true);
    expect(act(rematch, { type: 'advance' }).board.units[0]?.position).toEqual(started.board.units[0]?.destination);
  });

  it('編集へ戻ると現在の指示は消し、開始配置への復帰では保存した初期指示を復元する', () => {
    const started = startExperiment(initiallyOrdered());
    const editing = editExperiment(act(started, { type: 'advance' }));
    expect(editing.board.units.every((unit) => unit.destination === null)).toBe(true);
    expect(editing.initialBoard).toEqual(started.board);
    const restored = resetExperiment(editing);
    expect(restored.mode).toBe('edit');
    expect(restored.board).toEqual(started.board);
    const changed = act(editing, { type: 'set-initial-order', unitId: 2, destination: { x: 4, y: 4 } });
    const restarted = startExperiment(changed);
    expect(restarted.initialBoard.units[1]?.destination).toEqual({ x: 4, y: 4 });
    expect(restarted.initialBoard.units.filter((unit) => unit.id !== 2).every((unit) => unit.destination === null)).toBe(true);
  });
});

describe('対戦開始直後の初期指示', () => {
  function openingOrders(session = startExperiment(createSession(createMatchScenario()))): SandboxSession {
    let opening = session;
    for (const unit of session.board.units) {
      opening = act(freeze(opening), {
        type: 'order', unitId: unit.id,
        destination: { x: unit.position.x, y: unit.position.y + (unit.side === 'ally' ? -1 : 1) },
      });
    }
    return opening;
  }

  it('開始直後は通常の指示操作で全員に設定・変更・解除でき、初回移動から実行する', () => {
    const editing = createSession(createMatchScenario());
    expect(isInitialOrderPhase(editing)).toBe(false);
    const started = startExperiment(editing);
    expect(isInitialOrderPhase(started)).toBe(true);
    const ordered = openingOrders(started);
    const cleared = act(ordered, { type: 'order', unitId: 1, destination: null });
    expect(cleared.board.units[0]?.destination).toBeNull();
    const ready = act(cleared, { type: 'order', unitId: 1, destination: { x: 3, y: 6 } });
    expect(ready.board).toEqual(ordered.board);
    expect(ready.board.orderedUnitIds).toEqual([]);
    expect(ready.history).toEqual([]);
    expect(ready.initialBoard).toEqual(started.board);
    const moved = act(freeze(ready), { type: 'advance' });
    expect(isInitialOrderPhase(moved)).toBe(false);
    expect(moved.board.units.map((unit) => unit.position)).toEqual(ready.board.units.map((unit) => unit.destination));
    expect(moved.initialBoard).toEqual(ready.board);
    expect(moved.initialBoard.units.map((unit) => unit.position)).toEqual(started.board.units.map((unit) => unit.position));
    expect(moved.initialBoard).not.toBe(ready.board);
  });

  it('通常ターンは指示上限を守り、undoで初回へ戻すと無制限に再設定して開始配置を更新できる', () => {
    const opening = openingOrders();
    const first = act(opening, { type: 'advance' });
    const later = act(first, { type: 'order', unitId: 1, destination: null });
    expect(later.board.orderedUnitIds).toEqual([1]);
    expect(actOnSession(later, { type: 'order', unitId: 2, destination: null }).error).not.toBeNull();
    expect(actOnSession(later, { type: 'set-initial-order', unitId: 2, destination: null }).error).not.toBeNull();
    const second = act(later, { type: 'advance' });
    expect(second.initialBoard).toEqual(opening.board);
    const back = undoTurn(undoTurn(second));
    expect(isInitialOrderPhase(back)).toBe(true);
    expect(back.board).toEqual(opening.board);
    let changed = back;
    for (const unitId of [1, 2, 4, 5]) changed = act(changed, { type: 'order', unitId, destination: null });
    expect(changed.board.orderedUnitIds).toEqual([]);
    const replayed = act(freeze(changed), { type: 'advance' });
    expect(replayed.initialBoard).toEqual(changed.board);
    expect(resetExperiment(replayed).board).toEqual(changed.board);
    expect(second.initialBoard).toEqual(opening.board);
    const reset = resetExperiment(replayed);
    reset.board.units[2]!.destination!.y = 0;
    expect(replayed.initialBoard).toEqual(changed.board);
    expect(replayed.history[0]?.board).toEqual(changed.board);
  });

  it('初回で終了しても開幕に選んだ全員の指示を保存し、再戦で再設定できる', () => {
    const editing = act(createSession(createMatchScenario()), { type: 'set-match-rules', turnLimit: 1 });
    const opening = openingOrders(startExperiment(editing));
    const ended = act(opening, { type: 'advance' });
    expect(ended.board.outcome).toEqual({ winner: null, reason: 'turn-limit' });
    expect(isInitialOrderPhase(ended)).toBe(false);
    const rematch = resetExperiment(freeze(ended));
    expect(rematch.board).toEqual(opening.board);
    expect(rematch.initialBoard).toEqual(opening.board);
    expect(isInitialOrderPhase(rematch)).toBe(true);
    expect(rematch.history).toEqual([]);
    const changed = act(act(rematch, { type: 'order', unitId: 1, destination: null }), { type: 'order', unitId: 2, destination: null });
    expect(changed.board.orderedUnitIds).toEqual([]);
    expect(act(changed, { type: 'advance' }).initialBoard).toEqual(changed.board);
  });

  it('開幕中も不正な目的地・存在しないユニットを拒否し、状態や保存した初期配置を変更しない', () => {
    const opening = freeze(openingOrders());
    const invalidActions: BoardAction[] = [
      { type: 'order', unitId: 1, destination: { x: -1, y: 0 } },
      { type: 'order', unitId: 1, destination: { x: 3.5, y: 0 } },
      { type: 'order', unitId: 1, destination: { x: Number.NaN, y: 0 } },
      { type: 'order', unitId: 1, destination: { ...opening.board.walls[0]! } },
      { type: 'order', unitId: 999, destination: null },
    ];
    for (const action of invalidActions) {
      const rejected = actOnSession(opening, action);
      expect(rejected.error).not.toBeNull();
      expect(rejected.session).toBe(opening);
      expect(isInitialOrderPhase(rejected.session)).toBe(true);
      expect(rejected.session.board.orderedUnitIds).toEqual([]);
      expect(rejected.session.history).toEqual([]);
    }
  });
});

describe('対戦の終了・復元・再戦', () => {
  function beforeGoal(): SandboxSession {
    let session = createSession(createMatchScenario());
    for (const unitId of [2, 3, 5, 6]) session = act(session, { type: 'remove', unitId });
    session = act(session, { type: 'move', unitId: 1, position: { x: 4, y: 1 } });
    session = act(session, { type: 'move', unitId: 4, position: { x: 0, y: 0 } });
    session = act(session, { type: 'set-move-priority', unitId: 1, movePriority: 3 });
    session = act(session, { type: 'set-match-rules', firstPrioritySide: 'enemy' });
    return startExperiment(session);
  }

  it('不完全な対戦配置の開始を拒否し、実験モードは引き続き開始できる', () => {
    const board = createMatchScenario();
    board.goals.enemy = null;
    const invalid = freeze(createSession(board));
    expect(() => startExperiment(invalid)).toThrow(RangeError);
    expect(invalid.mode).toBe('edit');
    expect(invalid.board.turn).toBe(0);
    const disabled = act(invalid, { type: 'set-match-rules', matchEnabled: false });
    expect(startExperiment(disabled).mode).toBe('run');
    expect(() => startExperiment(createSession())).not.toThrow();
  });

  it('拠点到達で終了した対戦をundoすると指示・優先側・地形まで復元し、同じ結果を再現する', () => {
    const started = beforeGoal();
    const ordered = act(started, { type: 'order', unitId: 1, destination: { x: 4, y: 0 } });
    expect(prioritySideForTurn(ordered.board)).toBe('enemy');
    const ended = act(freeze(ordered), { type: 'advance' });
    expect(ended.board.outcome).toEqual({ winner: 'ally', reason: 'goal' });
    expect(ended.history).toHaveLength(1);
    for (const action of [{ type: 'advance' }, { type: 'order', unitId: 4, destination: { x: 1, y: 0 } }] as BoardAction[]) {
      const denied = actOnSession(ended, action);
      expect(denied.error).not.toBeNull();
      expect(denied.session).toBe(ended);
      expect(denied.session.history).toHaveLength(1);
    }
    const restored = undoTurn(freeze(ended));
    expect(restored.board).toEqual(ordered.board);
    expect(restored.board.outcome).toBeNull();
    expect(restored.board.orderedUnitIds).toEqual([]);
    expect(prioritySideForTurn(restored.board)).toBe('enemy');
    expect(act(restored, { type: 'advance' })).toEqual(ended);

    restored.board.walls[0]!.x = 0;
    restored.board.goals.enemy!.x = 0;
    restored.board.units[0]!.movePriority = 9;
    expect(ended.history[0]?.board).toEqual(ordered.board);
    expect(ended.initialBoard).toEqual(ordered.board);
  });

  it('終了後の再戦で開始配置のHP・拠点・地形・先行側を復元する', () => {
    const started = beforeGoal();
    const ordered = act(started, { type: 'order', unitId: 1, destination: { x: 4, y: 0 } });
    const ended = act(ordered, { type: 'advance' });
    const reset = resetExperiment(freeze(ended));
    expect(reset).toEqual({ ...ordered, initialBoard: ordered.board });
    expect(reset.board.outcome).toBeNull();
    expect(reset.board.units.every((unit) => unit.hp === unit.maxHp)).toBe(true);
    expect(prioritySideForTurn(reset.board)).toBe('enemy');
    expect(act(reset, { type: 'advance' }).board.outcome).toEqual({ winner: 'ally', reason: 'goal' });
    reset.board.walls[0]!.y = 0;
    reset.board.goals.ally!.x = 0;
    expect(resetExperiment(reset)).toEqual({ ...ordered, initialBoard: ordered.board });
  });

  it('編集・新規セッション・再開は終了判定とターンを初期化する', () => {
    const ordered = act(beforeGoal(), { type: 'order', unitId: 1, destination: { x: 4, y: 0 } });
    const ended = act(ordered, { type: 'advance' });
    const editing = editExperiment(freeze(ended));
    expect(editing.mode).toBe('edit');
    expect(editing.board).toMatchObject({ turn: 0, outcome: null, orderedUnitIds: [] });
    expect(editing.board.units.every((unit) => unit.destination === null)).toBe(true);
    expect(editing.board.walls).toEqual(ended.board.walls);
    expect(editing.board.goals).toEqual(ended.board.goals);
    expect(editing.initialBoard).toEqual(ended.initialBoard);
    expect(createSession(ended.board).board.outcome).toBeNull();
    // 勝者が相手拠点にいる配置を修正してから、再び対戦を始める。
    const repositioned = act(editing, { type: 'move', unitId: 1, position: { x: 4, y: 1 } });
    const restarted = startExperiment(repositioned);
    expect(restarted.board).toMatchObject({ turn: 0, outcome: null, orderedUnitIds: [] });
    expect(restarted.history).toEqual([]);
    expect(restarted.events).toEqual([]);
    expect(restarted.combatEvents).toEqual([]);
  });

  it('上限ターンの引き分けを戻すと優先側と残りターンを復元する', () => {
    const editing = act(createSession(createMatchScenario()), { type: 'set-match-rules', turnLimit: 2 });
    const started = startExperiment(editing);
    const first = act(started, { type: 'advance' });
    expect(first.board.outcome).toBeNull();
    expect(prioritySideForTurn(first.board)).toBe('enemy');
    const ended = act(first, { type: 'advance' });
    expect(ended.board.outcome).toEqual({ winner: null, reason: 'turn-limit' });
    expect(undoTurn(ended)).toEqual(first);
    expect(resetExperiment(ended)).toEqual(started);
  });
});

describe('兵科と個別移動力の保存', () => {
  function configuredSession(): SandboxSession {
    let session = createSession(withDestinations());
    session = act(session, { type: 'set-type', unitId: 1, unitType: 'cavalry' });
    session = act(session, { type: 'set-move-distance', unitId: 1, moveDistance: 3 });
    return act(session, { type: 'set-move-distance', unitId: 2, moveDistance: 2 });
  }

  it('兵科の初期値を変更した個別移動力で実験を開始し、undoでも同じ設定を復元する', () => {
    const editing = configuredSession();
    const started = startExperiment(editing);
    expect(started.initialBoard.units.map(({ type, moveDistance }) => ({ type, moveDistance }))).toEqual([
      { type: 'cavalry', moveDistance: 3 },
      { type: 'archer', moveDistance: 2 },
    ]);

    const advanced = act(started, { type: 'advance' });
    expect(advanced.board.units.map(({ position }) => position)).toEqual([{ x: 0, y: 1 }, { x: 4, y: 2 }]);
    const restored = undoTurn(advanced);
    expect(restored.board).toEqual(started.board);
    expect(act(restored, { type: 'advance' }).board).toEqual(advanced.board);

    editing.board.units[0]!.moveDistance = 6;
    expect(started.initialBoard.units[0]?.moveDistance).toBe(3);
    expect(advanced.history[0]?.board.units[0]?.moveDistance).toBe(3);
  });

  it('編集へ戻ると現在の兵科と個別移動力を保持し、開始配置に戻すと元の設定を復元する', () => {
    const started = startExperiment(configuredSession());
    const advanced = act(started, { type: 'advance' });
    const editing = editExperiment(advanced);
    expect(editing.board.units.map(({ type, moveDistance, destination }) => ({ type, moveDistance, destination }))).toEqual([
      { type: 'cavalry', moveDistance: 3, destination: null },
      { type: 'archer', moveDistance: 2, destination: null },
    ]);
    const changed = act(editing, { type: 'set-type', unitId: 1, unitType: 'infantry' });
    expect(changed.board.units[0]?.moveDistance).toBe(1);
    const reset = resetExperiment(changed);
    expect(reset.mode).toBe('edit');
    expect(reset.board).toEqual(started.board);
    expect(reset.initialBoard).toEqual(started.initialBoard);
    expect(reset.events).toEqual([]);
    expect(reset.history).toEqual([]);
  });

  it('移動力だけの初期値復帰では、選択したユニットの位置・目的地と他のユニットを保持する', () => {
    const editing = configuredSession();
    const before = structuredClone(editing);
    const reset = act(freeze(editing), { type: 'reset-move-distance', unitId: 1 });
    expect(reset.board.units[0]).toEqual({ ...before.board.units[0], moveDistance: 2 });
    expect(reset.board.units[1]).toEqual(before.board.units[1]);
    expect(editing).toEqual(before);
    expect(reset.initialBoard).toEqual(before.initialBoard);
    expect(reset.history).toEqual([]);
  });

  it('無効な個別移動力の変更ではセッションと開始配置を変更しない', () => {
    const editing = freeze(configuredSession());
    const result = actOnSession(editing, { type: 'set-move-distance', unitId: 1, moveDistance: 1.5 });
    expect(result.error).not.toBeNull();
    expect(result.session).toBe(editing);
    expect(result.session.history).toEqual([]);
    expect(result.session.board.units[0]?.moveDistance).toBe(3);
    expect(result.session.initialBoard.units[0]?.moveDistance).toBe(1);
  });
});

describe('戦闘結果と履歴の保存', () => {
  function combatSession(): SandboxSession {
    const board = createBoard(5, 5);
    return startExperiment(createSession({
      ...board,
      units: board.units.map((unit, index) => ({
        ...unit,
        side: index === 0 ? 'ally' : 'enemy',
        position: { x: 2, y: index + 2 },
      })),
    }));
  }

  it('編集した陣営と戦闘能力を開始設定として独立して保存する', () => {
    let editing = createSession();
    editing = act(editing, { type: 'set-side', unitId: 2, side: 'enemy' });
    editing = act(editing, { type: 'set-combat-stat', unitId: 2, stat: 'maxHp', value: 7 });
    editing = act(editing, { type: 'set-combat-stat', unitId: 2, stat: 'attack', value: 3 });
    editing = act(editing, { type: 'set-combat-stat', unitId: 2, stat: 'attackRange', value: 2 });
    const started = startExperiment(editing);
    expect(started.initialBoard.units[1]).toMatchObject({ side: 'enemy', hp: 7, maxHp: 7, attack: 3, attackRange: 2 });
    expect(started.combatEvents).toEqual([]);

    editing.board.units[1]!.side = 'ally';
    editing.board.units[1]!.hp = 1;
    editing.board.units[1]!.attack = 9;
    expect(started.initialBoard.units[1]).toMatchObject({ side: 'enemy', hp: 7, maxHp: 7, attack: 3, attackRange: 2 });
    expect(started.board.units[1]).toEqual(started.initialBoard.units[1]);
  });

  it('指示後も直前の戦闘表示を保持し、undoでHPと前の戦闘表示を復元する', () => {
    const started = freeze(combatSession());
    const first = act(started, { type: 'advance' });
    expect(first.board.units.map((unit) => unit.hp)).toEqual([3, 3]);
    expect(first.combatEvents).toEqual([
      { attackerId: 1, targetId: 2, damage: 2, defeated: false },
      { attackerId: 2, targetId: 1, damage: 2, defeated: false },
    ]);
    const ordered = act(first, { type: 'order', unitId: 1, destination: null });
    expect(ordered.combatEvents).toEqual(first.combatEvents);
    const second = act(freeze(ordered), { type: 'advance' });
    expect(second.board.units.map((unit) => unit.hp)).toEqual([1, 1]);
    const restored = undoTurn(second);
    expect(restored.board).toEqual(ordered.board);
    expect(restored.combatEvents).toEqual(first.combatEvents);
    expect(restored.history).toHaveLength(1);
    expect(act(restored, { type: 'advance' }).board).toEqual(second.board);
    expect(undoTurn(restored).combatEvents).toEqual([]);
  });

  it('撃破された双方のユニットをundoで復活させ、開始配置へ戻すとHPと履歴を初期化する', () => {
    const started = combatSession();
    const first = act(started, { type: 'advance' });
    const second = act(first, { type: 'advance' });
    const allyOrdered = act(second, { type: 'order', unitId: 1, destination: null });
    const ordered = act(allyOrdered, { type: 'order', unitId: 2, destination: null });
    const defeated = act(freeze(ordered), { type: 'advance' });
    expect(defeated.board.units).toEqual([]);
    expect(defeated.combatEvents.every((event) => event.defeated)).toBe(true);
    expect(defeated.events).toHaveLength(2);

    const restored = undoTurn(defeated);
    expect(restored.board).toEqual(ordered.board);
    expect(restored.board.units.map((unit) => unit.hp)).toEqual([1, 1]);
    expect(restored.board.orderedUnitIds).toEqual([1, 2]);
    expect(restored.combatEvents).toEqual(second.combatEvents);

    const reset = resetExperiment(freeze(defeated));
    expect(reset.mode).toBe('run');
    expect(reset.board).toEqual(started.board);
    expect(reset.board.units.map((unit) => unit.hp)).toEqual([5, 5]);
    expect(reset.combatEvents).toEqual([]);
    expect(reset.events).toEqual([]);
    expect(reset.history).toEqual([]);
  });

  it('履歴・復元結果・開始配置のHPや戦闘表示を独立して保持する', () => {
    const first = act(combatSession(), { type: 'advance' });
    const second = act(first, { type: 'advance' });
    first.combatEvents[0]!.damage = 90;
    expect(second.history[1]?.combatEvents[0]?.damage).toBe(2);
    expect(second.combatEvents[0]?.damage).toBe(2);

    const restored = undoTurn(second);
    restored.board.units[0]!.hp = 1;
    restored.board.units[0]!.side = 'enemy';
    restored.board.units[0]!.attackRange = 9;
    restored.combatEvents[0]!.damage = 80;
    expect(second.history[1]?.board.units[0]).toMatchObject({ hp: 3, side: 'ally', attackRange: 1 });
    expect(second.history[1]?.combatEvents[0]?.damage).toBe(2);
    expect(second.initialBoard.units[0]).toMatchObject({ hp: 5, side: 'ally', attackRange: 1 });

    const reset = resetExperiment(second);
    reset.board.units[0]!.hp = 1;
    expect(second.initialBoard.units[0]?.hp).toBe(5);
    expect(resetExperiment(reset).board.units[0]?.hp).toBe(5);
  });

  it('編集へ戻ると生存中のHPと能力を保持して戦闘表示を消し、再開も空の履歴から始める', () => {
    const first = act(combatSession(), { type: 'advance' });
    const editing = editExperiment(freeze(first));
    expect(editing.board.units.map((unit) => unit.hp)).toEqual([3, 3]);
    expect(editing.board.units[1]).toMatchObject({ side: 'enemy', maxHp: 5, attack: 2, attackRange: 1 });
    expect(editing.combatEvents).toEqual([]);
    expect(editing.events).toEqual([]);
    expect(editing.history).toEqual([]);
    const restarted = startExperiment(first);
    expect(restarted.board.units.map((unit) => unit.hp)).toEqual([3, 3]);
    expect(restarted.combatEvents).toEqual([]);
    expect(restarted.history).toEqual([]);
    expect(restarted.board.turn).toBe(0);

    const withOldLog = { ...editing, combatEvents: structuredClone(first.combatEvents) };
    const changed = act(withOldLog, { type: 'set-combat-stat', unitId: 1, stat: 'maxHp', value: 8 });
    expect(changed.board.units[0]?.hp).toBe(8);
    expect(changed.combatEvents).toEqual([]);
    expect(changed.initialBoard.units[0]?.hp).toBe(5);
  });
});
