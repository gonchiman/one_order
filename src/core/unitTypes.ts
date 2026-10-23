export type UnitType = 'infantry' | 'cavalry' | 'archer';
export type UnitSide = 'ally' | 'enemy';
export type CombatStat = 'maxHp' | 'attack' | 'attackRange';

export const UNIT_SIDES = Object.freeze({
  ally: Object.freeze({ name: 'P1' }),
  enemy: Object.freeze({ name: 'P2' }),
} satisfies Record<UnitSide, { name: string }>);

export const COMBAT_STAT_LIMITS = Object.freeze({
  maxHp: Object.freeze({ min: 1, max: 99 }),
  attack: Object.freeze({ min: 1, max: 99 }),
  attackRange: Object.freeze({ min: 1, max: 12 }),
} satisfies Record<CombatStat, { min: number; max: number }>);

export const MIN_MOVE_DISTANCE = 1;
export const MAX_MOVE_DISTANCE = 12;
export const MIN_MOVE_PRIORITY = 1;
export const MAX_MOVE_PRIORITY = 99;

// 実験用の仮初期値。ユニット生成・兵科変更時に適用する。
export const UNIT_TYPES = Object.freeze({
  infantry: Object.freeze({ name: '歩兵', mark: '歩', moveDistance: 1, movePriority: 1, maxHp: 5, attack: 2, attackRange: 1 }),
  cavalry: Object.freeze({ name: '騎兵', mark: '騎', moveDistance: 2, movePriority: 1, maxHp: 4, attack: 2, attackRange: 1 }),
  archer: Object.freeze({ name: '弓兵', mark: '弓', moveDistance: 1, movePriority: 1, maxHp: 3, attack: 1, attackRange: 3 }),
} satisfies Record<UnitType, { name: string; mark: string; moveDistance: number; movePriority: number; maxHp: number; attack: number; attackRange: number }>);

export function isUnitType(value: unknown): value is UnitType {
  return typeof value === 'string' && Object.hasOwn(UNIT_TYPES, value);
}

export function isUnitSide(value: unknown): value is UnitSide {
  return typeof value === 'string' && Object.hasOwn(UNIT_SIDES, value);
}
