import { describe, expect, it } from 'vitest';
import { applyAction, createBoard, DEFAULT_RULES, prioritySideForTurn, validateMatchSetup } from './board';
import type { BoardAction, BoardRules, BoardState, Cell, Unit } from './board';
import { MAX_MOVE_PRIORITY, MIN_MOVE_PRIORITY, UNIT_TYPES } from './unitTypes';
import type { UnitSide } from './unitTypes';

function unit(id: number, side: UnitSide, x: number, y: number, overrides: Partial<Unit> = {}): Unit {
  const preset = UNIT_TYPES.infantry;
  return { id, side, type: 'infantry', position: { x, y }, destination: null,
    moveDistance: preset.moveDistance, movePriority: preset.movePriority,
    hp: preset.maxHp, maxHp: preset.maxHp, attack: preset.attack, attackRange: preset.attackRange, ...overrides };
}

function board(units: Unit[], overrides: Partial<BoardState> = {}): BoardState {
  return { ...createBoard(7, 7, { matchEnabled: true }), units,
    goals: { ally: { x: 3, y: 6 }, enemy: { x: 3, y: 0 } },
    nextId: Math.max(0, ...units.map((item) => item.id)) + 1, ...overrides };
}

function positions(state: BoardState): Record<number, Cell> {
  return Object.fromEntries(state.units.map((item) => [item.id, item.position]));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe('競合時の移動優先度と交代する優先権', () => {
  it.each([0, 1, 2, 3])('同じ歩兵が空きマスを狙うとき、完了ターン%sに対応する側だけ進んで戦闘する', (turn) => {
    const initial = freeze(board([
      unit(1, 'ally', 3, 5, { destination: { x: 3, y: 3 } }),
      unit(4, 'enemy', 3, 3, { destination: { x: 3, y: 4 } }),
    ], { turn }));
    const result = applyAction(initial, { type: 'advance' });
    const allyFirst = turn % 2 === 0;
    expect(prioritySideForTurn(initial)).toBe(allyFirst ? 'ally' : 'enemy');
    expect(positions(result.state)).toEqual({ 1: { x: 3, y: allyFirst ? 4 : 5 }, 4: { x: 3, y: allyFirst ? 3 : 4 } });
    expect(result.blocked).toEqual([allyFirst ? 4 : 1]);
    expect(result.combatEvents).toHaveLength(2);
    expect(result.state.units.map((item) => item.hp)).toEqual([3, 3]);
    expect(prioritySideForTurn(result.state)).toBe(allyFirst ? 'enemy' : 'ally');
  });

  it('開始側を交換でき、兵科に関係なく個別の移動優先度がプレイヤーの優先権より先に効く', () => {
    const initial = board([
      unit(1, 'ally', 0, 2, { destination: { x: 1, y: 2 }, type: 'archer', movePriority: 9 }),
      unit(2, 'enemy', 2, 2, { destination: { x: 1, y: 2 }, type: 'cavalry', movePriority: 8 }),
    ], { rules: { ...DEFAULT_RULES, firstPrioritySide: 'enemy' } });
    expect(prioritySideForTurn(initial)).toBe('enemy');
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)[1]).toEqual({ x: 1, y: 2 });
    expect(positions(result.state)[2]).toEqual({ x: 2, y: 2 });
  });

  it('同じ側の同値ユニットはID順をターンで回し、配列の並びで結果が変わらない', () => {
    const units = [unit(10, 'ally', 1, 2, { destination: { x: 2, y: 2 } }),
      unit(20, 'ally', 3, 2, { destination: { x: 2, y: 2 } }),
      unit(30, 'ally', 2, 1, { destination: { x: 2, y: 2 } }), unit(40, 'enemy', 6, 6)];
    for (let turn = 0; turn < 6; turn += 1) {
      const normal = applyAction(board(units, { turn }), { type: 'advance' });
      const reversed = applyAction(board(units.slice().reverse(), { turn }), { type: 'advance' });
      const winnerId = [10, 20, 30][turn % 3]!;
      expect(positions(normal.state)[winnerId]).toEqual({ x: 2, y: 2 });
      expect(positions(reversed.state)).toEqual(positions(normal.state));
      expect(new Set(normal.state.units.map((item) => `${item.position.x},${item.position.y}`)).size).toBe(4);
    }
  });

  it('プレイヤーの優先権は1ターン内の全移動段階で固定する', () => {
    const initial = board([
      unit(1, 'ally', 0, 0, { destination: { x: 1, y: 0 }, moveDistance: 2 }),
      unit(2, 'enemy', 2, 0, { destination: { x: 0, y: 0 }, moveDistance: 2 }),
      unit(3, 'ally', 0, 4, { destination: { x: 4, y: 4 }, moveDistance: 2 }),
      unit(4, 'enemy', 4, 4, { destination: { x: 0, y: 4 }, moveDistance: 2 }),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(result.blocked).toEqual([2, 4]);
    expect(positions(result.state)[3]).toEqual({ x: 2, y: 4 });
    expect(positions(result.state)[4]).toEqual({ x: 3, y: 4 });
  });

  it('競合に勝っても停止中の占有者を押し出さず、負けたユニットの後続も止める', () => {
    const initial = board([
      unit(1, 'ally', 0, 2, { destination: { x: 1, y: 2 } }),
      unit(2, 'ally', 1, 2, { destination: { x: 2, y: 2 } }),
      unit(3, 'ally', 3, 2, { destination: { x: 2, y: 2 }, movePriority: 2 }),
      unit(4, 'enemy', 6, 6),
    ]);
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)).toEqual({ 1: { x: 0, y: 2 }, 2: { x: 1, y: 2 }, 3: { x: 2, y: 2 }, 4: { x: 6, y: 6 } });
    expect(result.events.map((event) => event.reason)).toEqual(['occupied', 'conflict', 'arrived', 'no-order']);
    const occupied = applyAction(board([
      unit(1, 'ally', 1, 1, { destination: { x: 2, y: 1 }, movePriority: 99 }),
      unit(2, 'ally', 3, 1, { destination: { x: 2, y: 1 } }), unit(3, 'ally', 2, 1),
    ]), { type: 'advance' });
    expect(positions(occupied.state)).toEqual({ 1: { x: 1, y: 1 }, 2: { x: 3, y: 1 }, 3: { x: 2, y: 1 } });
    expect(occupied.events.map((event) => event.reason)).toEqual(['occupied', 'conflict', 'no-order']);
  });

  it('優先度は個別に変更でき、兵科変更で初期値へ戻る', () => {
    const initial = freeze(createBoard());
    for (const movePriority of [MIN_MOVE_PRIORITY, MAX_MOVE_PRIORITY]) {
      const changed = applyAction(initial, { type: 'set-move-priority', unitId: 1, movePriority });
      expect(changed.error).toBeNull();
      expect(changed.state.units[0]?.movePriority).toBe(movePriority);
      expect(applyAction(changed.state, { type: 'set-type', unitId: 1, unitType: 'cavalry' }).state.units[0]?.movePriority).toBe(1);
    }
    for (const movePriority of [0, 100, -1, 1.2, NaN, Infinity]) {
      const result = applyAction(initial, { type: 'set-move-priority', unitId: 1, movePriority });
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(initial);
    }
    expect(applyAction(initial, { type: 'set-move-priority', unitId: 99, movePriority: 1 }).error).not.toBeNull();
  });
});

describe('壁と拠点の編集・経路探索', () => {
  it('壁を飛び越さず最短の経路で迂回し、囲まれた場合は待機する', () => {
    const initial = freeze(board([unit(1, 'ally', 0, 2, { destination: { x: 4, y: 2 }, moveDistance: 6 }),
      unit(2, 'enemy', 6, 6)], { walls: [{ x: 2, y: 2 }] }));
    const result = applyAction(initial, { type: 'advance' });
    expect(positions(result.state)[1]).toEqual({ x: 4, y: 2 });
    const enclosed = board([unit(1, 'ally', 0, 0, { destination: { x: 4, y: 2 }, moveDistance: 6 }), unit(2, 'enemy', 6, 6)],
      { walls: [{ x: 1, y: 0 }, { x: 0, y: 1 }] });
    const stopped = applyAction(enclosed, { type: 'advance' });
    expect(stopped.events[0]?.reason).toBe('no-path');
    expect(positions(stopped.state)[1]).toEqual({ x: 0, y: 0 });
    expect(stopped.state.units[0]?.destination).toEqual({ x: 4, y: 2 });
  });

  it('壁の追加・消去、拠点の移設・削除で入力の座標を共有しない', () => {
    const initial = freeze(createBoard());
    const position = { x: 3, y: 3 };
    const walled = applyAction(initial, { type: 'set-wall', position, blocked: true });
    expect(walled.error).toBeNull();
    const duplicate = applyAction(walled.state, { type: 'set-wall', position, blocked: true });
    expect(duplicate.state.walls).toEqual([{ x: 3, y: 3 }]);
    position.x = 7;
    expect(walled.state.walls).toEqual([{ x: 3, y: 3 }]);
    const removed = applyAction(walled.state, { type: 'set-wall', position: { x: 3, y: 3 }, blocked: false });
    expect(removed.state.walls).toEqual([]);
    const goal = applyAction(initial, { type: 'set-goal', side: 'ally', position });
    position.y = 7;
    expect(goal.state.goals.ally).toEqual({ x: 7, y: 3 });
    const onUnit = applyAction(goal.state, { type: 'set-goal', side: 'ally', position: { x: 0, y: 8 } });
    expect(onUnit.error).toBeNull();
    expect(applyAction(onUnit.state, { type: 'set-goal', side: 'ally', position: null }).state.goals.ally).toBeNull();
  });

  it('壁・ユニット・拠点の不正な重なりを拒否し、失敗時は元の状態を返す', () => {
    const initial = freeze(board([unit(1, 'ally', 0, 1), unit(2, 'enemy', 6, 5)], { walls: [{ x: 2, y: 2 }] }));
    const actions: BoardAction[] = [
      { type: 'set-wall', position: { x: 0, y: 1 }, blocked: true },
      { type: 'set-wall', position: { x: 3, y: 0 }, blocked: true },
      { type: 'set-goal', side: 'ally', position: { x: 3, y: 0 } },
      { type: 'set-goal', side: 'ally', position: { x: 2, y: 2 } },
      { type: 'add', position: { x: 2, y: 2 } },
      { type: 'move', unitId: 1, position: { x: 2, y: 2 } },
      { type: 'order', unitId: 1, destination: { x: 2, y: 2 } },
      { type: 'set-wall', position: { x: -1, y: 2 }, blocked: true },
      { type: 'set-goal', side: 'enemy', position: { x: 2, y: NaN } },
      { type: 'set-wall', position: { x: 1, y: 1 }, blocked: 'yes' as unknown as boolean },
      { type: 'set-goal', side: 'other' as UnitSide, position: null },
    ];
    for (const action of actions) {
      const result = applyAction(initial, action);
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(initial);
    }
  });
});

describe('対戦の勝敗と終了', () => {
  it.each<UnitSide>(['ally', 'enemy'])('%sが相手の拠点に生存して到着すると勝利し、自分の拠点では勝利しない', (side) => {
    const ally = side === 'ally';
    const initial = board([unit(1, side, 3, ally ? 1 : 5, { destination: { x: 3, y: ally ? 0 : 6 } }),
      unit(2, ally ? 'enemy' : 'ally', 6, 3)]);
    const result = applyAction(initial, { type: 'advance' });
    expect(result.state.outcome).toEqual({ winner: side, reason: 'goal' });
    const ownGoal = board([unit(1, side, 3, ally ? 6 : 0), unit(2, ally ? 'enemy' : 'ally', 6, 3)]);
    expect(applyAction(ownGoal, { type: 'advance' }).state.outcome).toBeNull();
  });

  it('移動途中で相手拠点を通過しただけでは勝利しない', () => {
    const initial = board([unit(1, 'ally', 2, 0, { destination: { x: 4, y: 0 }, moveDistance: 2 }), unit(2, 'enemy', 6, 6)]);
    expect(applyAction(initial, { type: 'advance' }).state.outcome).toBeNull();
  });

  it('拠点に到着しても同時戦闘で倒れた場合は占領せず、残った側が全滅勝利する', () => {
    const initial = board([unit(1, 'ally', 2, 0, { hp: 1, destination: { x: 3, y: 0 } }), unit(2, 'enemy', 4, 0)]);
    const result = applyAction(initial, { type: 'advance' });
    expect(result.state.units.map((item) => item.id)).toEqual([2]);
    expect(result.state.outcome).toEqual({ winner: 'enemy', reason: 'elimination' });
  });

  it('双方の拠点到着、および双方全滅は同時達成の引き分けになる', () => {
    const arrivals = board([unit(1, 'ally', 3, 1, { destination: { x: 3, y: 0 } }),
      unit(2, 'enemy', 3, 5, { destination: { x: 3, y: 6 } })]);
    expect(applyAction(arrivals, { type: 'advance' }).state.outcome).toEqual({ winner: null, reason: 'simultaneous' });
    const mutualKill = board([unit(1, 'ally', 1, 1, { hp: 2 }), unit(2, 'enemy', 2, 1, { hp: 2 })]);
    const result = applyAction(mutualKill, { type: 'advance' });
    expect(result.state.units).toEqual([]);
    expect(result.state.outcome).toEqual({ winner: null, reason: 'simultaneous' });
  });

  it('上限のターンを解決してから引き分けにし、同じターンの勝利を優先する', () => {
    const initial = board([unit(1, 'ally', 0, 6), unit(2, 'enemy', 6, 0)],
      { rules: { ...DEFAULT_RULES, matchEnabled: true, turnLimit: 2 } });
    const first = applyAction(initial, { type: 'advance' });
    expect(first.state.outcome).toBeNull();
    const second = applyAction(first.state, { type: 'advance' });
    expect(second.state.turn).toBe(2);
    expect(second.state.outcome).toEqual({ winner: null, reason: 'turn-limit' });
    const arriving = board([unit(1, 'ally', 3, 1, { destination: { x: 3, y: 0 } }), unit(2, 'enemy', 6, 0)],
      { turn: 1, rules: initial.rules });
    expect(applyAction(arriving, { type: 'advance' }).state.outcome).toEqual({ winner: 'ally', reason: 'goal' });
  });

  it('終了後の指示とターン進行を拒否して、勝敗と盤面を固定する', () => {
    const ended = freeze(applyAction(board([unit(1, 'ally', 0, 0)]), { type: 'advance' }).state);
    expect(ended.outcome).toEqual({ winner: 'ally', reason: 'elimination' });
    const actions: BoardAction[] = [{ type: 'advance' }, { type: 'order', unitId: 1, destination: { x: 1, y: 0 } }];
    for (const action of actions) {
      const result = applyAction(ended, action);
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(ended);
      expect(result.combatEvents).toEqual([]);
    }
  });

  it('対戦を無効にした実験盤は全滅・拠点・上限で終了しない', () => {
    const initial = board([unit(1, 'ally', 3, 0)], { rules: { ...DEFAULT_RULES, turnLimit: 1 } });
    const first = applyAction(initial, { type: 'advance' });
    expect(first.state.outcome).toBeNull();
    expect(applyAction(first.state, { type: 'advance' }).error).toBeNull();
  });
});

describe('対戦設定の検証', () => {
  it('両側の生存ユニットと異なる拠点を必要とし、通常の実験盤には要求しない', () => {
    expect(validateMatchSetup(createBoard())).toBeNull();
    const valid = board([unit(1, 'ally', 3, 6), unit(2, 'enemy', 3, 0)]);
    expect(validateMatchSetup(valid)).toBeNull();
    expect(validateMatchSetup({ ...valid, units: [unit(1, 'ally', 0, 0)] })).not.toBeNull();
    expect(validateMatchSetup({ ...valid, units: [unit(1, 'ally', 0, 0), unit(2, 'enemy', 5, 5, { hp: 0 })] })).not.toBeNull();
    expect(validateMatchSetup({ ...valid, goals: { ally: null, enemy: { x: 3, y: 0 } } })).not.toBeNull();
    expect(validateMatchSetup({ ...valid, goals: { ally: { x: 1, y: 1 }, enemy: { x: 1, y: 1 } } })).not.toBeNull();
    expect(validateMatchSetup({ ...valid, walls: [{ x: 3, y: 0 }] })).not.toBeNull();
  });

  it('設定を部分更新でき、無効な設定は生成時と更新時の両方で拒否する', () => {
    const initial = freeze(createBoard());
    const changed = applyAction(initial, { type: 'set-match-rules', matchEnabled: true, firstPrioritySide: 'enemy', turnLimit: 999 });
    expect(changed.state.rules).toEqual({ orderLimit: 1, matchEnabled: true, firstPrioritySide: 'enemy', turnLimit: 999 });
    expect(applyAction(changed.state, { type: 'set-match-rules', turnLimit: 1 }).state.rules)
      .toEqual({ ...changed.state.rules, turnLimit: 1 });
    const invalid: Partial<BoardRules>[] = [
      { turnLimit: 0 }, { turnLimit: 1000 }, { turnLimit: 1.5 }, { turnLimit: NaN }, { turnLimit: Infinity },
      { firstPrioritySide: 'other' as UnitSide }, { matchEnabled: 'yes' as unknown as boolean },
    ];
    for (const values of invalid) {
      expect(() => createBoard(7, 7, values)).toThrow(RangeError);
      const result = applyAction(initial, { type: 'set-match-rules', ...values });
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(initial);
    }
  });
});
