import { describe, expect, it } from 'vitest';
import { applyAction } from './board';
import type { BoardAction } from './board';
import { createMatchScenario } from './scenario';
import { actOnSession, createSession, resetExperiment, startExperiment, undoTurn } from './session';
import type { SandboxSession } from './session';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function act(session: SandboxSession, action: BoardAction): SandboxSession {
  const result = actOnSession(session, action);
  expect(result.error).toBeNull();
  return result.session;
}

function openingOrders(): SandboxSession {
  let session = startExperiment(createSession(createMatchScenario()));
  for (const unit of session.board.units) {
    session = act(session, { type: 'order', unitId: unit.id,
      destination: { x: unit.position.x, y: unit.position.y + (unit.side === 'ally' ? -1 : 1) } });
  }
  return session;
}

describe('全ユニットの指示リセット', () => {
  it('両陣営の目的地と消費済み指示枠だけを消し、盤面・HP・ターン・ルールを保持する', () => {
    const board = openingOrders().board;
    const initial = freeze({ ...board, turn: 7, orderedUnitIds: [1, 4],
      units: board.units.map((unit) => ({ ...unit, hp: unit.maxHp - 1 })) });
    const snapshot = structuredClone(initial);
    const result = applyAction(initial, { type: 'clear-orders' });
    expect(result.error).toBeNull();
    expect(result.state).toEqual({ ...snapshot, orderedUnitIds: [],
      units: snapshot.units.map((unit) => ({ ...unit, destination: null })) });
    expect(initial).toEqual(snapshot);
    expect(result.events).toEqual([]);
    expect(result.combatEvents).toEqual([]);
    expect(result.blocked).toEqual([]);
  });

  it('通常ターンで枠を使い切っていても再指示でき、その後は各陣営の通常制限が効く', () => {
    let session = act(openingOrders(), { type: 'advance' });
    for (const unitId of [1, 4]) session = act(session, { type: 'order', unitId, destination: null });
    expect(session.board.orderedUnitIds).toEqual([1, 4]);
    session = act(freeze(session), { type: 'clear-orders' });
    expect(session.board.orderedUnitIds).toEqual([]);
    for (const unitId of [2, 5]) session = act(session, { type: 'order', unitId, destination: { x: 4, y: 4 } });
    expect(session.board.orderedUnitIds).toEqual([2, 5]);
    for (const unitId of [1, 3, 4, 6]) {
      const denied = actOnSession(session, { type: 'order', unitId, destination: null });
      expect(denied.error).not.toBeNull();
      expect(denied.session).toBe(session);
    }
  });

  it('目的地が全て解除済みでも消費済み枠を解放し、空の状態で繰り返しても成功する', () => {
    let session = act(startExperiment(createSession(createMatchScenario())), { type: 'advance' });
    for (const unitId of [1, 4]) session = act(session, { type: 'order', unitId, destination: null });
    expect(session.board.units.every((unit) => unit.destination === null)).toBe(true);
    expect(session.board.orderedUnitIds).toEqual([1, 4]);
    const cleared = act(freeze(session), { type: 'clear-orders' });
    expect(cleared.board.orderedUnitIds).toEqual([]);
    expect(act(cleared, { type: 'clear-orders' })).toEqual(cleared);
    const empty = { ...cleared.board, units: [] };
    expect(applyAction(empty, { type: 'clear-orders' })).toMatchObject({ state: empty, error: null });
  });

  it('編集・初期指示・通常ターンで使え、初期配置・履歴・直前行動と戦闘ログを書き換えない', () => {
    const opening = openingOrders();
    const editing = createSession(opening.board);
    const advanced = act(opening, { type: 'advance' });
    const withCombatLog: SandboxSession = { ...advanced, combatEvents: [{ attackerId: 1, targetId: 4, damage: 2, defeated: false }] };
    for (const initial of [editing, opening, withCombatLog]) {
      const snapshot = structuredClone(initial);
      const cleared = act(freeze(initial), { type: 'clear-orders' });
      expect(cleared.board.units.every((unit) => unit.destination === null)).toBe(true);
      expect(cleared.initialBoard).toBe(initial.initialBoard);
      expect(cleared.history).toBe(initial.history);
      expect(cleared.events).toBe(initial.events);
      expect(cleared.combatEvents).toBe(initial.combatEvents);
      expect(cleared.mode).toBe(initial.mode);
      expect(initial).toEqual(snapshot);
    }
  });

  it('最初の進行前にリセットすると、解除後の初期指示が再戦に保存される', () => {
    const opening = openingOrders();
    const cleared = act(freeze(opening), { type: 'clear-orders' });
    const advanced = act(cleared, { type: 'advance' });
    expect(advanced.initialBoard.units.every((unit) => unit.destination === null)).toBe(true);
    expect(advanced.board.units.map((unit) => unit.position)).toEqual(opening.board.units.map((unit) => unit.position));
    expect(resetExperiment(advanced).board).toEqual(cleared.board);
    expect(undoTurn(advanced).board).toEqual(cleared.board);
  });

  it('試合途中のリセットは保存済み初期指示を残し、次ターンのundoと再戦で別々に復元する', () => {
    const opening = openingOrders();
    const first = act(opening, { type: 'advance' });
    const cleared = act(freeze(first), { type: 'clear-orders' });
    const second = act(cleared, { type: 'advance' });
    expect(second.initialBoard).toEqual(opening.board);
    expect(undoTurn(second)).toEqual(cleared);
    const rematch = resetExperiment(second);
    expect(rematch.board).toEqual(opening.board);
    expect(rematch.board.units.every((unit) => unit.destination !== null)).toBe(true);
    expect(first.board.units.every((unit) => unit.destination !== null)).toBe(true);
  });

  it('試合終了後はcoreとsessionの両方で拒否し、勝敗・盤面・履歴を保持する', () => {
    const scenario = createMatchScenario();
    const initial = createSession({ ...scenario, rules: { ...scenario.rules, turnLimit: 1 } });
    const ended = act(startExperiment(initial), { type: 'advance' });
    expect(ended.board.outcome).not.toBeNull();
    freeze(ended);
    const coreResult = applyAction(ended.board, { type: 'clear-orders' });
    expect(coreResult.error).toBe('試合は終了しています。');
    expect(coreResult.state).toBe(ended.board);
    const result = actOnSession(ended, { type: 'clear-orders' });
    expect(result.error).toBe('試合は終了しています。');
    expect(result.session).toBe(ended);
  });
});
