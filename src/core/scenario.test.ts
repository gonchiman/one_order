import { describe, expect, it } from 'vitest';
import { validateMatchSetup } from './board';
import { createMatchScenario } from './scenario';
import { UNIT_TYPES } from './unitTypes';

describe('対戦の初期配置', () => {
  it.each([[3, 3], [9, 9], [12, 12], [3, 12], [12, 3], [7, 7]])(
    '%i × %iで両陣営の3兵科と拠点を有効なマスに配置する', (width, height) => {
      const board = createMatchScenario(width, height);
      expect(validateMatchSetup(board)).toBeNull();
      expect(board).toMatchObject({
        width, height, turn: 0, nextId: 7, orderedUnitIds: [], outcome: null,
        rules: { orderLimit: 1, matchEnabled: true, firstPrioritySide: 'ally', turnLimit: 50 },
        goals: {
          ally: { x: Math.floor(width / 2), y: height - 1 },
          enemy: { x: Math.floor(width / 2), y: 0 },
        },
      });
      expect(board.units).toHaveLength(6);
      expect(new Set(board.units.map((unit) => `${unit.position.x},${unit.position.y}`)).size).toBe(6);
      for (const side of ['ally', 'enemy'] as const) {
        const units = board.units.filter((unit) => unit.side === side);
        expect(units.map((unit) => unit.type)).toEqual(['infantry', 'cavalry', 'archer']);
        expect(units.every((unit) => unit.position.y === (side === 'ally' ? height - 2 : height >= 4 ? 1 : 0))).toBe(true);
        for (const unit of units) {
          const preset = UNIT_TYPES[unit.type];
          expect(unit).toMatchObject({
            moveDistance: preset.moveDistance, movePriority: preset.movePriority,
            hp: preset.maxHp, maxHp: preset.maxHp, attack: preset.attack,
            attackRange: preset.attackRange, destination: null,
          });
          expect(unit.position.x).toBeGreaterThanOrEqual(0);
          expect(unit.position.x).toBeLessThan(width);
        }
      }
      expect(board.walls).toHaveLength(width >= 7 && height >= 7 ? height === 7 ? 2 : 4 : 0);
      for (const wall of board.walls) {
        expect(board.units.some((unit) => unit.position.x === wall.x && unit.position.y === wall.y)).toBe(false);
        expect(Object.values(board.goals).some((goal) => goal?.x === wall.x && goal.y === wall.y)).toBe(false);
        expect(board.walls).toContainEqual({ x: width - 1 - wall.x, y: height - 1 - wall.y });
      }
    },
  );

  it('対応する全サイズで有効な配置を生成する', () => {
    for (let width = 3; width <= 12; width += 1) {
      for (let height = 3; height <= 12; height += 1) {
        expect(validateMatchSetup(createMatchScenario(width, height))).toBeNull();
      }
    }
  });

  it('新規対戦ごとに地形・拠点・能力を独立させる', () => {
    const first = createMatchScenario();
    const expected = structuredClone(first);
    first.walls[0]!.x = 0;
    first.goals.ally!.x = 0;
    first.units[0]!.hp = 1;
    first.units[0]!.movePriority = 9;
    first.rules.firstPrioritySide = 'enemy';
    expect(createMatchScenario()).toEqual(expected);
  });

  it('範囲外の盤面サイズを拒否する', () => {
    expect(() => createMatchScenario(2, 9)).toThrow(RangeError);
    expect(() => createMatchScenario(9, 13)).toThrow(RangeError);
    expect(() => createMatchScenario(3.5, 9)).toThrow(RangeError);
  });
});
