import { describe, expect, it } from 'vitest';
import { applyAction, createBoard, DEFAULT_RULES } from './board';
import type { BoardAction, BoardRules, BoardState, Cell, Unit } from './board';
import { UNIT_TYPES } from './unitTypes';
import type { UnitType } from './unitTypes';

function makeUnit(id: number, x: number, y: number, destination: Cell | null = null, moveDistance = 1, type: UnitType = 'infantry'): Unit {
  return { id, type, moveDistance, position: { x, y }, destination };
}

function scenario(units: Unit[]): BoardState {
  return {
    ...createBoard(7, 7),
    units,
    nextId: Math.max(0, ...units.map((unit) => unit.id)) + 1,
  };
}

function positions(state: BoardState): Record<number, Cell> {
  return Object.fromEntries(state.units.map((unit) => [unit.id, unit.position]));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('実験盤の初期化と配置編集', () => {
  it('ユニット2体を盤面の左下と右下に配置して開始する', () => {
    expect(createBoard()).toEqual({
      width: 9,
      height: 9,
      turn: 0,
      units: [makeUnit(1, 0, 8), makeUnit(2, 8, 8)],
      nextId: 3,
      orderedUnitIds: [],
      rules: { ...DEFAULT_RULES },
    });
    expect(positions(createBoard(3, 12))).toEqual({
      1: { x: 0, y: 11 },
      2: { x: 2, y: 11 },
    });
  });

  it.each([
    [2, 7], [13, 7], [7, 2], [7, 13], [3.5, 7], [7, 4.5], [NaN, 7], [7, Infinity],
  ])('盤面の不正な寸法 %s × %s を受け付けない', (width, height) => {
    expect(() => createBoard(width, height)).toThrow();
  });

  it('ユニットを追加・移動・削除でき、削除済みのIDを再利用しない', () => {
    const initial = createBoard(7, 7);
    const added = applyAction(initial, { type: 'add', position: { x: 2, y: 3 } });
    expect(added.error).toBeNull();
    expect(added.state.units).toContainEqual(makeUnit(3, 2, 3));

    const moved = applyAction(added.state, { type: 'move', unitId: 3, position: { x: 4, y: 3 } });
    expect(moved.error).toBeNull();
    expect(positions(moved.state)[3]).toEqual({ x: 4, y: 3 });
    expect(moved.state.turn).toBe(0);
    expect(moved.state.orderedUnitIds).toEqual([]);

    const removed = applyAction(moved.state, { type: 'remove', unitId: 3 });
    expect(removed.error).toBeNull();
    expect(removed.state.units.map((unit) => unit.id)).toEqual([1, 2]);
    const readded = applyAction(removed.state, { type: 'add', position: { x: 2, y: 3 } });
    expect(readded.state.units).toContainEqual(makeUnit(4, 2, 3));
  });

  it.each<Cell>([
    { x: -1, y: 0 }, { x: 7, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 7 },
    { x: 0.5, y: 1 }, { x: 1, y: NaN }, { x: Infinity, y: 0 },
  ])('盤外または整数でない座標 %j は配置・移動・指示に使えない', (position) => {
    const initial = createBoard(7, 7);
    const actions: BoardAction[] = [
      { type: 'add', position },
      { type: 'move', unitId: 1, position },
      { type: 'order', unitId: 1, destination: position },
    ];
    for (const action of actions) {
      const result = applyAction(initial, action);
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(initial);
    }
  });

  it('占有中のマスへ別のユニットを追加・移動しない', () => {
    const initial = createBoard(7, 7);
    const added = applyAction(initial, { type: 'add', position: { x: 0, y: 6 } });
    const moved = applyAction(initial, { type: 'move', unitId: 2, position: { x: 0, y: 6 } });
    expect(added.error).not.toBeNull();
    expect(moved.error).not.toBeNull();
    expect(added.state).toBe(initial);
    expect(moved.state).toBe(initial);
  });

  it('存在しないユニットへの移動・削除・指示で状態を変更しない', () => {
    const initial = createBoard(7, 7);
    const actions: BoardAction[] = [
      { type: 'move', unitId: 99, position: { x: 3, y: 3 } },
      { type: 'remove', unitId: 99 },
      { type: 'order', unitId: 99, destination: { x: 3, y: 3 } },
    ];
    for (const action of actions) {
      const result = applyAction(initial, action);
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(initial);
    }
  });
});

describe('指示の継続とターン進行', () => {
  it('1ターンでは同じユニットの指示を編集でき、別のユニットには指示できない', () => {
    const first = applyAction(createBoard(7, 7), { type: 'order', unitId: 1, destination: { x: 2, y: 4 } });
    const revised = applyAction(first.state, { type: 'order', unitId: 1, destination: { x: 3, y: 4 } });
    expect(revised.error).toBeNull();
    expect(revised.state.units[0]?.destination).toEqual({ x: 3, y: 4 });

    const denied = applyAction(revised.state, { type: 'order', unitId: 2, destination: { x: 4, y: 4 } });
    expect(denied.error).not.toBeNull();
    expect(denied.state).toBe(revised.state);

    const advanced = applyAction(revised.state, { type: 'advance' });
    expect(advanced.state.turn).toBe(1);
    expect(advanced.state.orderedUnitIds).toEqual([]);
    const nextOrder = applyAction(advanced.state, { type: 'order', unitId: 2, destination: { x: 4, y: 4 } });
    expect(nextOrder.error).toBeNull();
    const nextTurn = applyAction(nextOrder.state, { type: 'advance' });
    expect(positions(nextTurn.state)).toEqual({ 1: { x: 2, y: 6 }, 2: { x: 5, y: 6 } });
    expect(nextTurn.state.units[0]?.destination).toEqual({ x: 3, y: 4 });
  });

  it('指示解除も1体分の指示として扱い、対象のユニットを停止させる', () => {
    const initial = scenario([makeUnit(1, 0, 0, { x: 5, y: 0 }), makeUnit(2, 6, 6)]);
    const cancelled = applyAction(initial, { type: 'order', unitId: 1, destination: null });
    expect(cancelled.error).toBeNull();
    expect(cancelled.state.orderedUnitIds).toEqual([1]);
    expect(applyAction(cancelled.state, { type: 'order', unitId: 2, destination: { x: 5, y: 6 } }).error).not.toBeNull();
    expect(positions(applyAction(cancelled.state, { type: 'advance' }).state)[1]).toEqual({ x: 0, y: 0 });
  });

  it('指示済みのユニットを削除すると、そのターンに別のユニットへ指示できる', () => {
    const ordered = applyAction(createBoard(7, 7), { type: 'order', unitId: 1, destination: { x: 3, y: 3 } });
    const removed = applyAction(ordered.state, { type: 'remove', unitId: 1 });
    expect(removed.state.orderedUnitIds).toEqual([]);
    expect(applyAction(removed.state, { type: 'order', unitId: 2, destination: { x: 3, y: 3 } }).error).toBeNull();
  });

  it('目的地へX方向を先に1マスずつ進み、到着後は止まる', () => {
    const initial = scenario([makeUnit(1, 0, 0, { x: 2, y: 1 })]);
    const first = applyAction(initial, { type: 'advance' });
    const second = applyAction(first.state, { type: 'advance' });
    const third = applyAction(second.state, { type: 'advance' });
    const fourth = applyAction(third.state, { type: 'advance' });
    expect(positions(first.state)[1]).toEqual({ x: 1, y: 0 });
    expect(positions(second.state)[1]).toEqual({ x: 2, y: 0 });
    expect(positions(third.state)[1]).toEqual({ x: 2, y: 1 });
    expect(positions(fourth.state)[1]).toEqual({ x: 2, y: 1 });
    expect(fourth.state.units[0]?.destination).toEqual({ x: 2, y: 1 });
    expect(fourth.blocked).toEqual([]);
    expect(fourth.state.turn).toBe(4);
  });

  it('ユニットがなくてもターンを進められる', () => {
    const result = applyAction(scenario([]), { type: 'advance' });
    expect(result.error).toBeNull();
    expect(result.state.units).toEqual([]);
    expect(result.state.turn).toBe(1);
    expect(result.blocked).toEqual([]);
  });
});

describe('同時移動の衝突', () => {
  it('同じ空きマスへ進もうとしたユニットを両方停止する', () => {
    const initial = scenario([
      makeUnit(1, 1, 2, { x: 2, y: 2 }),
      makeUnit(2, 3, 2, { x: 2, y: 2 }),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual(positions(initial));
    expect(result.blocked.slice().sort()).toEqual([1, 2]);
  });

  it('止まっているユニットのマスへ進まず、後続のユニットも停止する', () => {
    const initial = scenario([
      makeUnit(1, 0, 1, { x: 1, y: 1 }),
      makeUnit(2, 1, 1, { x: 2, y: 1 }),
      makeUnit(3, 2, 1),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual(positions(initial));
    expect(result.blocked.slice().sort()).toEqual([1, 2]);
  });

  it('先頭が空きマスへ進む連鎖では、後続も同時に進める', () => {
    const initial = scenario([
      makeUnit(1, 0, 1, { x: 1, y: 1 }),
      makeUnit(2, 1, 1, { x: 2, y: 1 }),
      makeUnit(3, 2, 1, { x: 3, y: 1 }),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual({
      1: { x: 1, y: 1 }, 2: { x: 2, y: 1 }, 3: { x: 3, y: 1 },
    });
    expect(result.blocked).toEqual([]);
  });

  it('互いのマスを入れ替える移動を停止する', () => {
    const initial = scenario([
      makeUnit(1, 1, 1, { x: 2, y: 1 }),
      makeUnit(2, 2, 1, { x: 1, y: 1 }),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual(positions(initial));
    expect(result.blocked.slice().sort()).toEqual([1, 2]);
  });

  it('4体が互いのマスを回る循環移動も停止する', () => {
    const initial = scenario([
      makeUnit(1, 1, 1, { x: 2, y: 1 }),
      makeUnit(2, 2, 1, { x: 2, y: 2 }),
      makeUnit(3, 2, 2, { x: 1, y: 2 }),
      makeUnit(4, 1, 2, { x: 1, y: 1 }),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual(positions(initial));
    expect(result.blocked.slice().sort()).toEqual([1, 2, 3, 4]);
  });

  it('競合で停止したユニットの後続も止まり、ユニットの配列順で結果を変えない', () => {
    const units = [
      makeUnit(1, 0, 1, { x: 1, y: 1 }),
      makeUnit(2, 1, 1, { x: 2, y: 1 }),
      makeUnit(3, 3, 1, { x: 2, y: 1 }),
    ];
    const normal = applyAction(scenario(units), { type: 'advance' });
    const reversed = applyAction(scenario(units.slice().reverse()), { type: 'advance' });
    expect(positions(normal.state)).toEqual({
      1: { x: 0, y: 1 }, 2: { x: 1, y: 1 }, 3: { x: 3, y: 1 },
    });
    expect(positions(reversed.state)).toEqual(positions(normal.state));
    expect(normal.blocked.slice().sort()).toEqual([1, 2, 3]);
    expect(reversed.blocked.slice().sort()).toEqual([1, 2, 3]);
  });
});

describe('入力状態の保護', () => {
  it('配置・指示・ターン進行で呼び出し元の状態と座標を変更しない', () => {
    const initial = deepFreeze(createBoard(7, 7));
    const snapshot = structuredClone(initial);
    const target = deepFreeze({ x: 2, y: 4 });
    const ordered = applyAction(initial, { type: 'order', unitId: 1, destination: target });
    deepFreeze(ordered.state);
    const added = applyAction(initial, { type: 'add', position: target });
    const moved = applyAction(initial, { type: 'move', unitId: 2, position: target });
    const advanced = applyAction(ordered.state, { type: 'advance' });
    expect(added.error).toBeNull();
    expect(moved.error).toBeNull();
    expect(advanced.error).toBeNull();
    expect(initial).toEqual(snapshot);
    expect(ordered.state.units[0]?.position).toEqual({ x: 0, y: 6 });
    expect(ordered.state.units[0]?.destination).toEqual({ x: 2, y: 4 });
    expect(target).toEqual({ x: 2, y: 4 });
  });
});

describe('実験用のルール設定', () => {
  it.each<BoardRules>([
    { orderLimit: 0 },
    { orderLimit: 145 },
    { orderLimit: 1.5 },
    { orderLimit: NaN },
    { orderLimit: Infinity },
  ])('不正なルール設定 %j を受け付けない', (rules) => {
    expect(() => createBoard(5, 5, rules)).toThrow(RangeError);
  });

  it('最大設定を受け付け、呼び出し元の設定を保持しない', () => {
    const rules = { orderLimit: 144 };
    const state = createBoard(12, 12, rules);
    rules.orderLimit = 2;
    expect(state.rules).toEqual({ orderLimit: 144 });
    expect(createBoard().rules).toEqual({ orderLimit: 1 });
  });

  it('設定した数のユニットに指示でき、再編集で枠を重複消費しない', () => {
    const initial = {
      ...scenario([makeUnit(1, 0, 0), makeUnit(2, 2, 0), makeUnit(3, 4, 0)]),
      rules: { orderLimit: 2 },
    };
    const first = applyAction(initial, { type: 'order', unitId: 1, destination: { x: 0, y: 2 } });
    const revised = applyAction(first.state, { type: 'order', unitId: 1, destination: null });
    expect(revised.state.orderedUnitIds).toEqual([1]);
    const second = applyAction(revised.state, { type: 'order', unitId: 2, destination: { x: 2, y: 2 } });
    expect(second.error).toBeNull();
    expect(second.state.orderedUnitIds).toEqual([1, 2]);
    const third = applyAction(second.state, { type: 'order', unitId: 3, destination: { x: 4, y: 2 } });
    expect(third.error).not.toBeNull();
    expect(third.state).toBe(second.state);
    const removed = applyAction(second.state, { type: 'remove', unitId: 1 });
    expect(removed.state.orderedUnitIds).toEqual([2]);
    const advanced = applyAction(second.state, { type: 'advance' });
    expect(advanced.state.orderedUnitIds).toEqual([]);
    expect(advanced.state.turn).toBe(1);
  });
});

describe('兵科と個別の移動力', () => {
  it.each<UnitType>(['infantry', 'cavalry', 'archer'])('追加する兵科 %s の仮初期値を適用する', (unitType) => {
    const result = applyAction(createBoard(), { type: 'add', position: { x: 2, y: 2 }, unitType });
    expect(result.error).toBeNull();
    expect(result.state.units.at(-1)).toEqual({
      id: 3, type: unitType, moveDistance: UNIT_TYPES[unitType].moveDistance,
      position: { x: 2, y: 2 }, destination: null,
    });
    expect(result.state.rules).toEqual({ orderLimit: 1 });
  });

  it('兵科変更で個別移動力を初期値へ戻し、位置・目的地・他のユニットを保持する', () => {
    const initial = deepFreeze(scenario([
      makeUnit(1, 0, 0, { x: 5, y: 0 }, 4),
      makeUnit(2, 6, 6),
    ]));
    const result = applyAction(initial, { type: 'set-type', unitId: 1, unitType: 'cavalry' });
    expect(result.error).toBeNull();
    expect(result.state.units[0]).toEqual({ ...initial.units[0], type: 'cavalry', moveDistance: 2 });
    expect(result.state.units[1]).toBe(initial.units[1]);
    expect(initial.units[0]?.moveDistance).toBe(4);
    expect(initial.units[0]?.type).toBe('infantry');
    const archer = applyAction(result.state, { type: 'set-type', unitId: 1, unitType: 'archer' });
    expect(archer.state.units[0]).toEqual({ ...initial.units[0], type: 'archer', moveDistance: 1 });
  });

  it('移動力を個別に変更・初期値へ復帰しても位置・目的地・指示枠を変えない', () => {
    const initial = deepFreeze({
      ...scenario([makeUnit(1, 0, 0, { x: 5, y: 0 }, 2, 'cavalry'), makeUnit(2, 6, 6)]),
      orderedUnitIds: [1],
    });
    const customized = applyAction(initial, { type: 'set-move-distance', unitId: 1, moveDistance: 12 });
    expect(customized.error).toBeNull();
    expect(customized.state.units[0]).toEqual({ ...initial.units[0], moveDistance: 12 });
    expect(customized.state.units[1]).toBe(initial.units[1]);
    expect(customized.state.orderedUnitIds).toEqual([1]);
    const reset = applyAction(customized.state, { type: 'reset-move-distance', unitId: 1 });
    expect(reset.error).toBeNull();
    expect(reset.state).toEqual(initial);
    expect(initial.units[0]?.moveDistance).toBe(2);
  });

  it.each([0, 13, -1, 1.5, NaN, Infinity])('不正な個別移動力 %s を拒否する', (moveDistance) => {
    const initial = deepFreeze(createBoard());
    const result = applyAction(initial, { type: 'set-move-distance', unitId: 1, moveDistance });
    expect(result.error).not.toBeNull();
    expect(result.state).toBe(initial);
  });

  it('未定義の兵科と存在しないユニットの設定変更で状態を変更しない', () => {
    const initial = deepFreeze(createBoard());
    const invalidType = 'unknown' as UnitType;
    const actions: BoardAction[] = [
      { type: 'add', position: { x: 2, y: 2 }, unitType: invalidType },
      { type: 'set-type', unitId: 1, unitType: invalidType },
      { type: 'set-type', unitId: 99, unitType: 'cavalry' },
      { type: 'set-move-distance', unitId: 99, moveDistance: 3 },
      { type: 'reset-move-distance', unitId: 99 },
    ];
    for (const action of actions) {
      const result = applyAction(initial, action);
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(initial);
    }
  });

  it('3兵科を同じターンにそれぞれの移動力だけ進める', () => {
    const initial = deepFreeze(scenario([
      makeUnit(1, 0, 0, { x: 6, y: 0 }),
      makeUnit(2, 0, 1, { x: 6, y: 1 }, 2, 'cavalry'),
      makeUnit(3, 0, 2, { x: 6, y: 2 }, 1, 'archer'),
    ]));
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual({ 1: { x: 1, y: 0 }, 2: { x: 2, y: 1 }, 3: { x: 1, y: 2 } });
    expect(result.events.map((event) => event.reason)).toEqual(['moved', 'moved', 'moved']);
    expect(result.state.turn).toBe(1);
    expect(result.blocked).toEqual([]);
    expect(positions(initial)[2]).toEqual({ x: 0, y: 1 });
  });

  it('兵科の初期値ではなく、変更後の個別移動力で移動する', () => {
    const initial = scenario([makeUnit(1, 0, 0, { x: 6, y: 0 }, 4, 'archer')]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)[1]).toEqual({ x: 4, y: 0 });
    expect(result.state.units[0]?.type).toBe('archer');
  });

  it('移動力を使い切った前方ユニットを後続の騎兵が飛び越さない', () => {
    const units = [
      makeUnit(1, 0, 0, { x: 6, y: 0 }, 2, 'cavalry'),
      makeUnit(2, 1, 0, { x: 6, y: 0 }),
    ];
    const normal = applyAction(scenario(units), { type: 'advance' });
    const reversed = applyAction(scenario(units.slice().reverse()), { type: 'advance' });
    expect(positions(normal.state)).toEqual({ 1: { x: 1, y: 0 }, 2: { x: 2, y: 0 } });
    expect(normal.events.map((event) => event.reason)).toEqual(['occupied', 'moved']);
    expect(normal.blocked).toEqual([1]);
    expect(positions(reversed.state)).toEqual(positions(normal.state));
    expect(Object.fromEntries(reversed.events.map((event) => [event.unitId, event.reason]))).toEqual({ 1: 'occupied', 2: 'moved' });
  });

  it('先に到着したユニットの停止位置と到着理由を後の移動段階でも保持する', () => {
    const initial = scenario([
      makeUnit(1, 0, 0, { x: 6, y: 0 }, 3, 'cavalry'),
      makeUnit(2, 1, 0, { x: 2, y: 0 }, 3, 'archer'),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual({ 1: { x: 1, y: 0 }, 2: { x: 2, y: 0 } });
    expect(result.events.map((event) => event.reason)).toEqual(['occupied', 'arrived']);
  });

  it('短い移動力の相手と競合して止まった騎兵は、そのターンに再試行しない', () => {
    const initial = scenario([
      makeUnit(1, 1, 0, { x: 6, y: 0 }, 2, 'cavalry'),
      makeUnit(2, 3, 0, { x: 0, y: 0 }),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual(positions(initial));
    expect(result.events.map((event) => event.reason)).toEqual(['conflict', 'conflict']);
    expect(result.blocked).toEqual([1, 2]);
  });

  it('遠方の高速ユニットが動き続けても未指示・到着・停止の理由を保持する', () => {
    const initial = scenario([
      makeUnit(1, 0, 0, { x: 6, y: 0 }, 5, 'cavalry'),
      makeUnit(2, 0, 1),
      makeUnit(3, 0, 2, { x: 1, y: 2 }),
      makeUnit(4, 0, 3, { x: 4, y: 3 }),
      makeUnit(5, 1, 3),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(result.events.map((event) => event.reason)).toEqual(['moved', 'no-order', 'arrived', 'occupied', 'no-order']);
  });
});

describe('各ユニットの直前行動と停止理由', () => {
  it('未指示、到着済み、移動中、そのターンでの到着を位置と共に返す', () => {
    const initial = scenario([
      makeUnit(1, 0, 0),
      makeUnit(2, 2, 0, { x: 2, y: 0 }),
      makeUnit(3, 0, 1, { x: 3, y: 1 }),
      makeUnit(4, 2, 2, { x: 3, y: 2 }),
    ]);
    expect(applyAction(initial, { type: 'advance' }).events).toEqual([
      { unitId: 1, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, reason: 'no-order' },
      { unitId: 2, from: { x: 2, y: 0 }, to: { x: 2, y: 0 }, reason: 'arrived' },
      { unitId: 3, from: { x: 0, y: 1 }, to: { x: 1, y: 1 }, reason: 'moved' },
      { unitId: 4, from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, reason: 'arrived' },
    ]);
  });

  it('同じマスへの競合と、競合した前方のユニットによる停止を区別する', () => {
    const initial = scenario([
      makeUnit(1, 0, 1, { x: 4, y: 1 }),
      makeUnit(2, 1, 1, { x: 4, y: 1 }),
      makeUnit(3, 3, 1, { x: 0, y: 1 }),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(result.events.map((event) => event.reason)).toEqual(['occupied', 'conflict', 'conflict']);
    expect(result.blocked).toEqual([1, 2, 3]);
  });

  it('循環の参加者はcycle、停留しているユニットに遮られたユニットはoccupiedを返す', () => {
    const initial = scenario([
      makeUnit(1, 1, 1, { x: 2, y: 1 }),
      makeUnit(2, 2, 1, { x: 1, y: 1 }),
      makeUnit(3, 0, 4, { x: 2, y: 4 }),
      makeUnit(4, 1, 4),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(result.events.map((event) => event.reason)).toEqual(['cycle', 'cycle', 'occupied', 'no-order']);
    expect(result.blocked).toEqual([1, 2, 3]);
  });

  it('配置編集やエラーではターン行動のイベントを返さない', () => {
    const initial = createBoard();
    expect(applyAction(initial, { type: 'add', position: { x: 2, y: 2 } }).events).toEqual([]);
    expect(applyAction(initial, { type: 'order', unitId: 1, destination: { x: 2, y: 2 } }).events).toEqual([]);
    expect(applyAction(initial, { type: 'remove', unitId: 99 }).events).toEqual([]);
  });
});

describe('複数マス移動の通過中判定', () => {
  it('移動距離だけX優先の1マス移動を繰り返し、ターンは1だけ増える', () => {
    const initial = {
      ...scenario([makeUnit(1, 0, 0, { x: 2, y: 2 }, 3)]),
      orderedUnitIds: [1],
    };
    const first = applyAction(deepFreeze(initial), { type: 'advance' });
    expect(positions(first.state)[1]).toEqual({ x: 2, y: 1 });
    expect(first.events).toEqual([
      { unitId: 1, from: { x: 0, y: 0 }, to: { x: 2, y: 1 }, reason: 'moved' },
    ]);
    expect(first.state.turn).toBe(1);
    expect(first.state.orderedUnitIds).toEqual([]);
    const second = applyAction(first.state, { type: 'advance' });
    expect(second.events).toEqual([
      { unitId: 1, from: { x: 2, y: 1 }, to: { x: 2, y: 2 }, reason: 'arrived' },
    ]);
  });

  it('途中の停留ユニットを飛び越さず、移動できた範囲と停止理由を返す', () => {
    const initial = {
      ...scenario([makeUnit(1, 0, 0, { x: 4, y: 0 }, 3), makeUnit(2, 2, 0)]),
    };
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual({ 1: { x: 1, y: 0 }, 2: { x: 2, y: 0 } });
    expect(result.events[0]).toEqual({
      unitId: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, reason: 'occupied',
    });
    expect(result.blocked).toEqual([1]);
  });

  it('途中の同時進入で競合したユニットを両方停止する', () => {
    const initial = {
      ...scenario([makeUnit(1, 0, 0, { x: 4, y: 0 }, 3), makeUnit(2, 4, 0, { x: 0, y: 0 }, 3)]),
    };
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual({ 1: { x: 1, y: 0 }, 2: { x: 3, y: 0 } });
    expect(result.events.map((event) => event.reason)).toEqual(['conflict', 'conflict']);
    expect(result.blocked).toEqual([1, 2]);
  });

  it('途中ですれ違ってマスを入れ替えようとしたユニットを停止する', () => {
    const initial = {
      ...scenario([makeUnit(1, 0, 0, { x: 4, y: 0 }, 3), makeUnit(2, 3, 0, { x: 0, y: 0 }, 3)]),
    };
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual({ 1: { x: 1, y: 0 }, 2: { x: 2, y: 0 } });
    expect(result.events.map((event) => event.reason)).toEqual(['cycle', 'cycle']);
  });

  it('先頭が目的地に到着する連鎖でも配列順によらず全員が進める', () => {
    const units = [makeUnit(1, 2, 1, { x: 3, y: 1 }), makeUnit(2, 1, 1, { x: 2, y: 1 })];
    const normal = applyAction(scenario(units), { type: 'advance' });
    const reversed = applyAction(scenario(units.slice().reverse()), { type: 'advance' });
    expect(positions(normal.state)).toEqual({ 1: { x: 3, y: 1 }, 2: { x: 2, y: 1 } });
    expect(positions(reversed.state)).toEqual(positions(normal.state));
    expect(normal.events.map((event) => event.reason)).toEqual(['arrived', 'arrived']);
  });
});
