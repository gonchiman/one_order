export type UnitType = 'infantry' | 'cavalry' | 'archer';

export const MIN_MOVE_DISTANCE = 1;
export const MAX_MOVE_DISTANCE = 12;

// 実験用の仮初期値。ユニット生成・兵科変更時に個別の移動力へ適用する。
export const UNIT_TYPES = Object.freeze({
  infantry: Object.freeze({ name: '歩兵', mark: '歩', moveDistance: 1 }),
  cavalry: Object.freeze({ name: '騎兵', mark: '騎', moveDistance: 2 }),
  archer: Object.freeze({ name: '弓兵', mark: '弓', moveDistance: 1 }),
} satisfies Record<UnitType, { name: string; mark: string; moveDistance: number }>);

export function isUnitType(value: unknown): value is UnitType {
  return typeof value === 'string' && Object.hasOwn(UNIT_TYPES, value);
}
