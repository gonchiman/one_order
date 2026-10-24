import { describe, expect, it } from 'vitest';
import { applyAction, createBoard } from './board';
import type { BoardAction, BoardState, Cell } from './board';

function setup(): BoardState {
  const first = applyAction(createBoard(7, 7), { type: 'add', side: 'enemy', position: { x: 0, y: 0 } }).state;
  return applyAction(first, { type: 'add', side: 'enemy', position: { x: 6, y: 0 } }).state;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe('戦闘開始前の初期指示', () => {
  it('両プレイヤーの全ユニットへ指示枠を使わず設定でき、同じターンに全員が動く', () => {
    let state = setup();
    const destinations = [{ x: 0, y: 5 }, { x: 6, y: 5 }, { x: 0, y: 1 }, { x: 6, y: 1 }];
    for (const [index, destination] of destinations.entries()) {
      const result = applyAction(state, { type: 'set-initial-order', unitId: index + 1, destination });
      expect(result.error).toBeNull();
      expect(result.state.orderedUnitIds).toEqual([]);
      expect(result.state.turn).toBe(0);
      state = result.state;
    }
    expect(state.units.map((unit) => unit.destination)).toEqual(destinations);
    const advanced = applyAction(state, { type: 'advance' });
    expect(advanced.state.units.map((unit) => unit.position)).toEqual(destinations);
    expect(advanced.events.map((event) => event.reason)).toEqual(['arrived', 'arrived', 'arrived', 'arrived']);
  });

  it('初期指示の再設定・解除は何度でもでき、既存のターン指示枠を変更しない', () => {
    const ordered = applyAction(setup(), { type: 'order', unitId: 1, destination: { x: 0, y: 3 } }).state;
    const second = applyAction(ordered, { type: 'set-initial-order', unitId: 2, destination: { x: 6, y: 3 } });
    const revised = applyAction(second.state, { type: 'set-initial-order', unitId: 2, destination: { x: 6, y: 2 } });
    const cleared = applyAction(revised.state, { type: 'set-initial-order', unitId: 2, destination: null });
    for (const result of [second, revised, cleared]) {
      expect(result.error).toBeNull();
      expect(result.state.orderedUnitIds).toEqual([1]);
    }
    expect(revised.state.units[1]?.destination).toEqual({ x: 6, y: 2 });
    expect(cleared.state.units[1]?.destination).toBeNull();
    const denied = applyAction(cleared.state, { type: 'order', unitId: 2, destination: { x: 6, y: 1 } });
    expect(denied.error).not.toBeNull();
    expect(denied.state).toBe(cleared.state);
  });

  it('盤外・非整数・壁・存在しないユニットへの指示を拒否する', () => {
    const state = freeze(applyAction(setup(), { type: 'set-wall', position: { x: 3, y: 3 }, blocked: true }).state);
    const invalid: Cell[] = [{ x: -1, y: 0 }, { x: 7, y: 0 }, { x: 0, y: 7 },
      { x: 1.5, y: 2 }, { x: NaN, y: 2 }, { x: 2, y: Infinity }, { x: 3, y: 3 }];
    const actions: BoardAction[] = invalid.map((destination) => ({ type: 'set-initial-order', unitId: 1, destination }));
    actions.push({ type: 'set-initial-order', unitId: 99, destination: null });
    for (const action of actions) {
      const result = applyAction(state, action);
      expect(result.error).not.toBeNull();
      expect(result.state).toBe(state);
    }
    // 占有中の目的地は通常の指示と同じく許可し、移動・戦闘で解決する。
    expect(applyAction(state, { type: 'set-initial-order', unitId: 1, destination: { x: 0, y: 0 } }).error).toBeNull();
  });

  it('設定済み目的地への壁追加を拒否し、全指示を解除すれば配置できる', () => {
    const destination = { x: 3, y: 3 };
    let state = setup();
    for (const unitId of [1, 3]) state = applyAction(state, { type: 'set-initial-order', unitId, destination }).state;
    const blocked = applyAction(state, { type: 'set-wall', position: destination, blocked: true });
    expect(blocked.error).toBe('目的地に設定されたマスには壁を置けません。');
    expect(blocked.state).toBe(state);
    expect(blocked.state.walls).toEqual([]);
    const oneCleared = applyAction(state, { type: 'set-initial-order', unitId: 1, destination: null }).state;
    expect(applyAction(oneCleared, { type: 'set-wall', position: destination, blocked: true }).error).not.toBeNull();
    const bothCleared = applyAction(oneCleared, { type: 'set-initial-order', unitId: 3, destination: null }).state;
    expect(applyAction(bothCleared, { type: 'set-wall', position: destination, blocked: true }).state.walls).toEqual([destination]);
    expect(applyAction(state, { type: 'set-wall', position: destination, blocked: false }).error).toBeNull();
  });

  it('入力の状態を変更せず、指定した目的地の座標をコピーする', () => {
    const initial = freeze(setup());
    const snapshot = structuredClone(initial);
    const destination = { x: 2, y: 2 };
    const result = applyAction(initial, { type: 'set-initial-order', unitId: 1, destination });
    expect(result.error).toBeNull();
    expect(initial).toEqual(snapshot);
    destination.x = 4;
    expect(result.state.units[0]?.destination).toEqual({ x: 2, y: 2 });
    expect(result.state.units[1]).toBe(initial.units[1]);
    expect(result.events).toEqual([]);
    expect(result.combatEvents).toEqual([]);
  });
});
