import { describe, expect, it } from 'vitest';
import { applyAction, createBoard } from './board';
import type { BoardState, Cell, Unit } from './board';
import { UNIT_TYPES } from './unitTypes';
import type { UnitSide } from './unitTypes';
import { actOnSession, createSession, startExperiment, undoTurn } from './session';

function unit(id: number, x: number, y: number, destination: Cell | null = null, overrides: Partial<Unit> = {}): Unit {
  const preset = UNIT_TYPES.infantry;
  return { id, side: 'ally', type: 'infantry', position: { x, y }, destination,
    moveDistance: preset.moveDistance, hp: preset.maxHp, maxHp: preset.maxHp,
    attack: preset.attack, attackRange: preset.attackRange, ...overrides };
}

function scenario(units: Unit[], width = 7, height = 7): BoardState {
  return { ...createBoard(width, height), units, nextId: Math.max(0, ...units.map((item) => item.id)) + 1 };
}

function positions(state: BoardState): Record<number, Cell> {
  return Object.fromEntries(state.units.map((item) => [item.id, item.position]));
}

function expectValidPositions(state: BoardState): void {
  const cells = state.units.map((item) => `${item.position.x},${item.position.y}`);
  expect(new Set(cells).size).toBe(state.units.length);
  for (const item of state.units) {
    expect(Number.isInteger(item.position.x)).toBe(true);
    expect(Number.isInteger(item.position.y)).toBe(true);
    expect(item.position.x).toBeGreaterThanOrEqual(0);
    expect(item.position.y).toBeGreaterThanOrEqual(0);
    expect(item.position.x).toBeLessThan(state.width);
    expect(item.position.y).toBeLessThan(state.height);
  }
}

function advanceToDestination(initial: BoardState, unitId: number, limit: number): { state: BoardState; turns: number } {
  let state = initial;
  let turns = 0;
  for (; turns < limit; turns += 1) {
    const moving = state.units.find((item) => item.id === unitId);
    if (moving !== undefined && moving.destination !== null && moving.position.x === moving.destination.x
      && moving.position.y === moving.destination.y) break;
    const result = applyAction(state, { type: 'advance' });
    expect(result.error).toBeNull();
    state = result.state;
    expectValidPositions(state);
  }
  return { state, turns };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe('他のユニットを避ける経路探索', () => {
  it('初期配置の中央の騎兵が両隣の味方を避け、別の列の目的地へ到着する', () => {
    const destination = { x: 2, y: 3 };
    const initial = scenario([
      unit(1, 3, 7),
      unit(2, 4, 7, destination, { type: 'cavalry', moveDistance: 2 }),
      unit(3, 5, 7),
    ], 9, 9);
    const result = advanceToDestination(initial, 2, 4);
    expect(result.state.units.find((item) => item.id === 2)?.position).toEqual(destination);
    expect(result.turns).toBe(3);
    expect(positions(result.state)[1]).toEqual({ x: 3, y: 7 });
    expect(positions(result.state)[3]).toEqual({ x: 5, y: 7 });
  });

  it.each<UnitSide>(['ally', 'enemy'])('停止している%sのユニットを通らず、最短の迂回路で到着する', (side) => {
    const destination = { x: 4, y: 2 };
    const initial = scenario([
      unit(1, 0, 2, destination, { hp: 99, maxHp: 99, attack: 1 }),
      unit(2, 2, 2, null, { side, hp: 99, maxHp: 99, attack: 1 }),
    ]);
    const result = advanceToDestination(initial, 1, 6);
    expect(result.state.units.find((item) => item.id === 1)?.position).toEqual(destination);
    expect(result.turns).toBe(6);
    expect(positions(result.state)[2]).toEqual({ x: 2, y: 2 });
  });

  it('目的地から一時的に遠ざかる必要がある配置でも迂回できる', () => {
    const destination = { x: 3, y: 1 };
    const initial = scenario([
      unit(1, 3, 3, destination),
      unit(2, 3, 2), unit(3, 2, 3), unit(4, 4, 3),
    ]);
    const first = applyAction(initial, { type: 'advance' });
    expect(positions(first.state)[1]).toEqual({ x: 3, y: 4 });
    expect(first.events.find((event) => event.unitId === 1)?.reason).toBe('moved');
    const result = advanceToDestination(first.state, 1, 15);
    expect(result.state.units.find((item) => item.id === 1)?.position).toEqual(destination);
  });

  it('囲まれたユニットは目的地を保持して待機し、通路が開くと再び進む', () => {
    const destination = { x: 4, y: 2 };
    const initial = scenario([
      unit(1, 2, 2, destination),
      unit(2, 2, 1), unit(3, 2, 3), unit(4, 1, 2), unit(5, 3, 2),
    ]);
    const waiting = applyAction(initial, { type: 'advance' });
    expect(positions(waiting.state)[1]).toEqual({ x: 2, y: 2 });
    expect(waiting.state.units[0]?.destination).toEqual(destination);
    expect(waiting.events.find((event) => event.unitId === 1)?.reason).toBe('no-path');
    const stillWaiting = applyAction(waiting.state, { type: 'advance' });
    expect(stillWaiting.events.find((event) => event.unitId === 1)?.reason).toBe('no-path');
    const opened = applyAction(stillWaiting.state, { type: 'remove', unitId: 5 });
    const result = advanceToDestination(opened.state, 1, 2);
    expect(result.state.units[0]?.position).toEqual(destination);
    expect(result.turns).toBe(2);
  });

  it('占有中の目的地には近づいて隣で待ち、空くと到着する', () => {
    const destination = { x: 3, y: 2 };
    const initial = scenario([unit(1, 0, 2, destination), unit(2, 3, 2)]);
    let state = initial;
    for (let turn = 0; turn < 2; turn += 1) state = applyAction(state, { type: 'advance' }).state;
    const waiting = applyAction(state, { type: 'advance' });
    expect(positions(waiting.state)[1]).toEqual({ x: 2, y: 2 });
    expect(waiting.state.units[0]?.destination).toEqual(destination);
    expect(waiting.events.find((event) => event.unitId === 1)?.reason).toBe('occupied');
    expectValidPositions(waiting.state);
    const vacated = applyAction(waiting.state, { type: 'move', unitId: 2, position: { x: 3, y: 3 } });
    const arrived = applyAction(vacated.state, { type: 'advance' });
    expect(positions(arrived.state)[1]).toEqual(destination);
    expect(arrived.events.find((event) => event.unitId === 1)?.reason).toBe('arrived');
    expectValidPositions(arrived.state);
  });

  it('長い迂回でも盤外へ出ず、移動力を超えて1ターンで到着しない', () => {
    const destination = { x: 6, y: 0 };
    const wall = Array.from({ length: 6 }, (_, y) => unit(y + 2, 3, y));
    const initial = scenario([unit(1, 0, 0, destination, { moveDistance: 12 }), ...wall]);
    const first = applyAction(initial, { type: 'advance' });
    expect(first.state.units[0]?.position).not.toEqual(destination);
    expect(first.state.units[0]?.position).not.toEqual({ x: 0, y: 0 });
    expect(first.events.find((event) => event.unitId === 1)?.reason).toBe('moved');
    expectValidPositions(first.state);
    const second = applyAction(first.state, { type: 'advance' });
    expect(second.state.units[0]?.position).toEqual(destination);
    expect(second.events.find((event) => event.unitId === 1)?.reason).toBe('arrived');
    expectValidPositions(second.state);
  });

  it('ユニットの配列順で経路や到着を変えず、呼び出し元の状態を変更しない', () => {
    const units = [unit(1, 0, 1, { x: 6, y: 1 }), unit(2, 2, 1),
      unit(3, 6, 5, { x: 0, y: 5 }), unit(4, 4, 5)];
    const initial = freeze(scenario(units));
    const snapshot = structuredClone(initial);
    let normal = initial;
    let reversed = freeze(scenario(units.slice().reverse()));
    for (let turn = 0; turn < 8; turn += 1) {
      normal = applyAction(normal, { type: 'advance' }).state;
      reversed = applyAction(reversed, { type: 'advance' }).state;
      expect(positions(reversed)).toEqual(positions(normal));
      expectValidPositions(normal);
      expectValidPositions(reversed);
    }
    expect(positions(normal)[1]).toEqual({ x: 6, y: 1 });
    expect(positions(normal)[3]).toEqual({ x: 0, y: 5 });
    expect(initial).toEqual(snapshot);
  });

  it('迂回中のターンを戻して進め直すと、同じ経路と行動結果を再現する', () => {
    const initial = scenario([unit(1, 0, 2, { x: 4, y: 2 }), unit(2, 2, 2)]);
    const started = startExperiment(createSession(initial));
    const first = actOnSession(started, { type: 'advance' });
    const second = actOnSession(first.session, { type: 'advance' });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const undone = undoTurn(second.session);
    expect(undone.board).toEqual(first.session.board);
    expect(undone.events).toEqual(first.session.events);
    const replayed = actOnSession(undone, { type: 'advance' });
    expect(replayed.error).toBeNull();
    expect(replayed.session.board).toEqual(second.session.board);
    expect(replayed.session.events).toEqual(second.session.events);
    expect(replayed.session.combatEvents).toEqual(second.session.combatEvents);
  });
});
