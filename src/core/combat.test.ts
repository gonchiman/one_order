import { describe, expect, it } from 'vitest';
import { applyAction, createBoard } from './board';
import type { BoardAction, BoardState, Unit } from './board';
import { COMBAT_STAT_LIMITS, UNIT_TYPES } from './unitTypes';
import type { CombatStat, UnitSide, UnitType } from './unitTypes';

function unit(id: number, side: UnitSide, x: number, y: number, overrides: Partial<Unit> = {}): Unit {
  const preset = UNIT_TYPES.infantry;
  return { id, side, type: 'infantry', position: { x, y }, destination: null,
    moveDistance: preset.moveDistance, hp: preset.maxHp, maxHp: preset.maxHp,
    attack: preset.attack, attackRange: preset.attackRange, ...overrides };
}

function board(units: Unit[]): BoardState {
  return { ...createBoard(9, 9), units, nextId: Math.max(0, ...units.map((item) => item.id)) + 1 };
}

function health(state: BoardState): Record<number, number> {
  return Object.fromEntries(state.units.map((item) => [item.id, item.hp]));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe('敵味方の編集と陣営別の指示', () => {
  it.each<UnitType>(['infantry', 'cavalry', 'archer'])('敵の%sを全HPと兵科の能力で追加できる', (unitType) => {
    const preset = UNIT_TYPES[unitType];
    const result = applyAction(createBoard(), { type: 'add', position: { x: 4, y: 1 }, side: 'enemy', unitType });
    expect(result.error).toBeNull();
    expect(result.state.units.at(-1)).toEqual({ id: 3, side: 'enemy', type: unitType,
      position: { x: 4, y: 1 }, destination: null, moveDistance: preset.moveDistance,
      hp: preset.maxHp, maxHp: preset.maxHp, attack: preset.attack, attackRange: preset.attackRange });
  });

  it('陣営だけを変更してHP・能力・指示・位置を維持する', () => {
    const initial = freeze(board([unit(1, 'ally', 1, 1, { hp: 2, attack: 7, destination: { x: 8, y: 8 } })]));
    const result = applyAction(initial, { type: 'set-side', unitId: 1, side: 'enemy' });
    expect(result.error).toBeNull();
    expect(result.state.units[0]).toEqual({ ...initial.units[0], side: 'enemy' });
    expect(initial.units[0]?.side).toBe('ally');
  });

  it('各陣営で1体ずつ指示でき、同じユニットの修正と解除は枠を追加消費しない', () => {
    const initial = board([unit(1, 'ally', 0, 8), unit(2, 'ally', 1, 8), unit(3, 'enemy', 0, 0), unit(4, 'enemy', 1, 0)]);
    const ally = applyAction(initial, { type: 'order', unitId: 1, destination: { x: 0, y: 7 } });
    const enemy = applyAction(ally.state, { type: 'order', unitId: 3, destination: { x: 0, y: 1 } });
    expect(enemy.error).toBeNull();
    expect(enemy.state.orderedUnitIds).toEqual([1, 3]);
    const revised = applyAction(enemy.state, { type: 'order', unitId: 3, destination: null });
    expect(revised.error).toBeNull();
    expect(revised.state.orderedUnitIds).toEqual([1, 3]);
    for (const unitId of [2, 4]) {
      const denied = applyAction(revised.state, { type: 'order', unitId, destination: null });
      expect(denied.error).not.toBeNull();
      expect(denied.state).toBe(revised.state);
    }
    const next = applyAction(revised.state, { type: 'advance' });
    expect(next.state.orderedUnitIds).toEqual([]);
    expect(applyAction(next.state, { type: 'order', unitId: 4, destination: null }).error).toBeNull();
  });

  it('未定義の陣営と存在しないユニットの編集を拒否する', () => {
    const initial = freeze(createBoard());
    const actions: BoardAction[] = [
      { type: 'add', position: { x: 4, y: 1 }, side: 'other' as UnitSide },
      { type: 'set-side', unitId: 1, side: 'other' as UnitSide },
      { type: 'set-side', unitId: 99, side: 'enemy' },
      { type: 'set-combat-stat', unitId: 99, stat: 'attack', value: 3 },
      { type: 'set-combat-stat', unitId: 1, stat: 'other' as CombatStat, value: 3 },
    ];
    for (const action of actions) {
      const result = applyAction(initial, action);
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(initial);
      expect(result.combatEvents).toEqual([]);
    }
  });
});

describe('戦闘能力の編集', () => {
  it.each<CombatStat>(['maxHp', 'attack', 'attackRange'])('%sの上下限を受け付け、不正な値を拒否する', (stat) => {
    const initial = freeze(board([unit(1, 'ally', 1, 1, { hp: 2 })]));
    const { min, max } = COMBAT_STAT_LIMITS[stat];
    for (const value of [min, max]) {
      const result = applyAction(initial, { type: 'set-combat-stat', unitId: 1, stat, value });
      expect(result.error).toBeNull();
      expect(result.state.units[0]?.[stat]).toBe(value);
      expect(result.state.units[0]?.hp).toBe(stat === 'maxHp' ? value : 2);
    }
    for (const value of [min - 1, max + 1, 1.5, NaN, Infinity]) {
      const result = applyAction(initial, { type: 'set-combat-stat', unitId: 1, stat, value });
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(initial);
    }
    expect(initial.units[0]?.hp).toBe(2);
  });

  it('兵科変更でHPを含む能力を初期化し、移動力の復帰では戦闘能力を変えない', () => {
    const initial = freeze(board([unit(1, 'enemy', 2, 2, {
      hp: 2, maxHp: 8, attack: 7, attackRange: 6, moveDistance: 5, destination: { x: 2, y: 4 },
    })]));
    const movement = applyAction(initial, { type: 'reset-move-distance', unitId: 1 });
    expect(movement.state.units[0]).toEqual({ ...initial.units[0], moveDistance: 1 });
    const changed = applyAction(initial, { type: 'set-type', unitId: 1, unitType: 'archer' });
    expect(changed.state.units[0]).toEqual({ ...initial.units[0], type: 'archer',
      moveDistance: 1, hp: 3, maxHp: 3, attack: 1, attackRange: 3 });
    expect(changed.combatEvents).toEqual([]);
  });
});

describe('移動後の同時戦闘', () => {
  it('味方同士は隣接していても攻撃しない', () => {
    const initial = freeze(board([unit(1, 'ally', 1, 1), unit(2, 'ally', 2, 1)]));
    const result = applyAction(initial, { type: 'advance' });
    expect(health(result.state)).toEqual({ 1: 5, 2: 5 });
    expect(result.combatEvents).toEqual([]);
  });

  it('歩兵は上下左右1マスの敵を攻撃し、斜め隣の敵には届かない', () => {
    const diagonal = applyAction(board([unit(1, 'ally', 1, 1), unit(2, 'enemy', 2, 2)]), { type: 'advance' });
    expect(diagonal.combatEvents).toEqual([]);
    const adjacent = applyAction(board([unit(1, 'ally', 1, 1), unit(2, 'enemy', 2, 1)]), { type: 'advance' });
    expect(health(adjacent.state)).toEqual({ 1: 3, 2: 3 });
    expect(adjacent.combatEvents).toEqual([
      { attackerId: 1, targetId: 2, damage: 2, defeated: false },
      { attackerId: 2, targetId: 1, damage: 2, defeated: false },
    ]);
  });

  it('弓兵の射程を縦横の距離の合計で判定し、境界を含む', () => {
    const archer = unit(1, 'ally', 1, 1, { type: 'archer', attackRange: 3, attack: 1 });
    const inside = applyAction(board([archer, unit(2, 'enemy', 3, 2)]), { type: 'advance' });
    const outside = applyAction(board([archer, unit(2, 'enemy', 3, 3)]), { type: 'advance' });
    expect(inside.combatEvents).toEqual([{ attackerId: 1, targetId: 2, damage: 1, defeated: false }]);
    expect(health(inside.state)[2]).toBe(4);
    expect(outside.combatEvents).toEqual([]);
  });

  it('最も近い敵1体を選び、同距離ではIDが小さい敵を選ぶ', () => {
    const units = [unit(1, 'ally', 4, 4, { attackRange: 4 }), unit(2, 'enemy', 4, 1),
      unit(3, 'enemy', 4, 2), unit(4, 'enemy', 2, 4)];
    const normal = applyAction(board(units), { type: 'advance' });
    const reversed = applyAction(board(units.slice().reverse()), { type: 'advance' });
    expect(normal.combatEvents).toEqual([{ attackerId: 1, targetId: 3, damage: 2, defeated: false }]);
    expect(reversed.combatEvents).toEqual(normal.combatEvents);
    expect(health(reversed.state)).toEqual(health(normal.state));
  });

  it('全員の移動が終わってから攻撃し、射程を通過しただけでは攻撃しない', () => {
    const approaching = applyAction(board([unit(1, 'ally', 0, 0, { destination: { x: 2, y: 0 }, moveDistance: 2 }),
      unit(2, 'enemy', 3, 0)]), { type: 'advance' });
    expect(approaching.state.units[0]?.position).toEqual({ x: 2, y: 0 });
    expect(approaching.combatEvents).toHaveLength(2);
    const passing = applyAction(board([unit(1, 'ally', 0, 0, { destination: { x: 4, y: 0 }, moveDistance: 4 }),
      unit(2, 'enemy', 2, 1)]), { type: 'advance' });
    expect(passing.state.units[0]?.position).toEqual({ x: 4, y: 0 });
    expect(passing.combatEvents).toEqual([]);
  });

  it('攻撃を受けて倒れるユニットも同時に攻撃し、相打ちを許す', () => {
    const initial = freeze(board([unit(1, 'ally', 1, 1, { hp: 2 }), unit(2, 'enemy', 2, 1, { hp: 1 })]));
    const snapshot = structuredClone(initial);
    const result = applyAction(initial, { type: 'advance' });
    expect(result.state.units).toEqual([]);
    expect(result.state.nextId).toBe(3);
    expect(result.events.map((event) => event.unitId)).toEqual([1, 2]);
    expect(result.combatEvents).toEqual([
      { attackerId: 1, targetId: 2, damage: 2, defeated: true },
      { attackerId: 2, targetId: 1, damage: 2, defeated: true },
    ]);
    expect(initial).toEqual(snapshot);
    expect(applyAction(result.state, { type: 'advance' }).combatEvents).toEqual([]);
  });

  it('複数体の攻撃を合算して撃破し、倒れた敵を次ターンの障害物にしない', () => {
    const initial = freeze(board([unit(1, 'ally', 0, 1, { destination: { x: 1, y: 1 } }),
      unit(2, 'ally', 2, 1), unit(3, 'enemy', 1, 1, { hp: 3 })]));
    const first = applyAction(initial, { type: 'advance' });
    expect(first.blocked).toEqual([1]);
    expect(health(first.state)).toEqual({ 1: 3, 2: 5 });
    expect(first.combatEvents).toEqual([
      { attackerId: 1, targetId: 3, damage: 2, defeated: true },
      { attackerId: 2, targetId: 3, damage: 2, defeated: true },
      { attackerId: 3, targetId: 1, damage: 2, defeated: false },
    ]);
    expect(first.events).toHaveLength(3);
    const second = applyAction(first.state, { type: 'advance' });
    expect(second.state.units[0]?.position).toEqual({ x: 1, y: 1 });
    expect(second.combatEvents).toEqual([]);
  });

  it('移動後の攻撃対象と被害もユニット配列順で変わらない', () => {
    const units = [unit(1, 'ally', 0, 1, { destination: { x: 2, y: 1 } }),
      unit(2, 'enemy', 3, 1, { destination: { x: 0, y: 1 } }),
      unit(3, 'ally', 2, 3, { attackRange: 3 })];
    const normal = applyAction(freeze(board(units)), { type: 'advance' });
    const reversed = applyAction(board(units.slice().reverse()), { type: 'advance' });
    expect(reversed.combatEvents).toEqual(normal.combatEvents);
    expect(health(reversed.state)).toEqual(health(normal.state));
    expect(Object.fromEntries(reversed.state.units.map((item) => [item.id, item.position])))
      .toEqual(Object.fromEntries(normal.state.units.map((item) => [item.id, item.position])));
  });
});
