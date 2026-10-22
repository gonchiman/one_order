import { COMBAT_STAT_LIMITS, isUnitSide, isUnitType, MAX_MOVE_DISTANCE, MIN_MOVE_DISTANCE, UNIT_TYPES } from './unitTypes';
import type { CombatStat, UnitSide, UnitType } from './unitTypes';

export interface Cell {
  x: number;
  y: number;
}

export interface Unit {
  id: number;
  type: UnitType;
  side: UnitSide;
  moveDistance: number;
  hp: number;
  maxHp: number;
  attack: number;
  attackRange: number;
  position: Cell;
  destination: Cell | null;
}

export interface BoardRules {
  orderLimit: number;
}

export const DEFAULT_RULES: BoardRules = Object.freeze({ orderLimit: 1 });
export const DEFAULT_BOARD_SIZE = 9;

export interface BoardState {
  width: number;
  height: number;
  turn: number;
  units: Unit[];
  nextId: number;
  orderedUnitIds: number[];
  rules: BoardRules;
}

export type BoardAction =
  | { type: 'add'; position: Cell; unitType?: UnitType; side?: UnitSide }
  | { type: 'move'; unitId: number; position: Cell }
  | { type: 'remove'; unitId: number }
  | { type: 'set-type'; unitId: number; unitType: UnitType }
  | { type: 'set-side'; unitId: number; side: UnitSide }
  | { type: 'set-combat-stat'; unitId: number; stat: CombatStat; value: number }
  | { type: 'set-move-distance'; unitId: number; moveDistance: number }
  | { type: 'reset-move-distance'; unitId: number }
  | { type: 'order'; unitId: number; destination: Cell | null }
  | { type: 'advance' };

export interface BoardResult {
  state: BoardState;
  error: string | null;
  blocked: number[];
  events: UnitEvent[];
  combatEvents: CombatEvent[];
}

export interface CombatEvent {
  attackerId: number;
  targetId: number;
  damage: number;
  defeated: boolean;
}

export interface UnitEvent {
  unitId: number;
  from: Cell;
  to: Cell;
  reason: 'moved' | 'no-order' | 'arrived' | 'conflict' | 'occupied' | 'cycle';
}

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 3 && value <= 12;
}

export function createBoard(width = DEFAULT_BOARD_SIZE, height = DEFAULT_BOARD_SIZE, rules: BoardRules = DEFAULT_RULES): BoardState {
  if (!validDimension(width) || !validDimension(height)) {
    throw new RangeError('盤面の幅と高さは3〜12の整数で指定してください。');
  }
  if (!Number.isInteger(rules.orderLimit) || rules.orderLimit < 1 || rules.orderLimit > 144) {
    throw new RangeError('指示できるユニットの数は1〜144の整数で指定してください。');
  }

  return {
    width,
    height,
    turn: 0,
    units: [
      createUnit(1, 'infantry', 'ally', { x: 0, y: height - 1 }),
      createUnit(2, 'infantry', 'ally', { x: width - 1, y: height - 1 }),
    ],
    nextId: 3,
    orderedUnitIds: [],
    rules: { ...rules },
  };
}

function validCell(state: BoardState, cell: Cell): boolean {
  return Number.isInteger(cell.x) && Number.isInteger(cell.y)
    && cell.x >= 0 && cell.x < state.width
    && cell.y >= 0 && cell.y < state.height;
}

function sameCell(left: Cell, right: Cell): boolean {
  return left.x === right.x && left.y === right.y;
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function createUnit(id: number, type: UnitType, side: UnitSide, position: Cell): Unit {
  const preset = UNIT_TYPES[type];
  return {
    id, type, side, moveDistance: preset.moveDistance,
    hp: preset.maxHp, maxHp: preset.maxHp, attack: preset.attack, attackRange: preset.attackRange,
    position: { ...position }, destination: null,
  };
}

function success(state: BoardState, blocked: number[] = [], events: UnitEvent[] = [], combatEvents: CombatEvent[] = []): BoardResult {
  return { state, error: null, blocked, events, combatEvents };
}

function failure(state: BoardState, error: string): BoardResult {
  return { state, error, blocked: [], events: [], combatEvents: [] };
}

function distance(left: Cell, right: Cell): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function resolveCombat(units: Unit[]): { units: Unit[]; events: CombatEvent[] } {
  const attacks: Omit<CombatEvent, 'defeated'>[] = [];
  const damageByTarget = new Map<number, number>();
  // 移動終了時点の全員から攻撃を決め、被害を同時に適用する仮ルール。
  const living = units.filter((unit) => unit.hp > 0);
  for (const attacker of living.slice().sort((left, right) => left.id - right.id)) {
    const target = living.filter((unit) => unit.side !== attacker.side
      && distance(attacker.position, unit.position) <= attacker.attackRange)
      .sort((left, right) => distance(attacker.position, left.position) - distance(attacker.position, right.position)
        || left.id - right.id)[0];
    if (target === undefined) continue;
    attacks.push({ attackerId: attacker.id, targetId: target.id, damage: attacker.attack });
    damageByTarget.set(target.id, (damageByTarget.get(target.id) ?? 0) + attacker.attack);
  }
  const defeated = new Set(living.filter((unit) => unit.hp <= (damageByTarget.get(unit.id) ?? 0)).map((unit) => unit.id));
  return {
    units: living.filter((unit) => !defeated.has(unit.id)).map((unit) => {
      const damage = damageByTarget.get(unit.id) ?? 0;
      return damage === 0 ? unit : { ...unit, hp: Math.max(0, unit.hp - damage) };
    }),
    events: attacks.map((attack) => ({ ...attack, defeated: defeated.has(attack.targetId) })),
  };
}

function nextPosition(unit: Unit): Cell {
  const destination = unit.destination;
  if (destination === null || sameCell(unit.position, destination)) {
    return unit.position;
  }

  // 試作用の仮ルール: 横方向を先に進み、揃ってから縦方向へ進む。
  if (unit.position.x !== destination.x) {
    return { x: unit.position.x + Math.sign(destination.x - unit.position.x), y: unit.position.y };
  }
  return { x: unit.position.x, y: unit.position.y + Math.sign(destination.y - unit.position.y) };
}

function moveOneStep(units: Unit[], active: Set<number>): { units: Unit[]; reasons: Map<number, UnitEvent['reason']> } {
  const occupied = new Map(units.map((unit) => [cellKey(unit.position), unit.id]));
  const candidates = new Map<number, Cell>();
  const targetCounts = new Map<string, number>();
  const moving = new Set<number>();

  for (const unit of units) {
    if (!active.has(unit.id)) continue;
    const candidate = nextPosition(unit);
    candidates.set(unit.id, candidate);
    if (!sameCell(candidate, unit.position)) {
      moving.add(unit.id);
      const key = cellKey(candidate);
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }
  }

  const outcomes = new Map<number, UnitEvent['reason']>();

  function resolveMove(unitId: number, path: number[]): UnitEvent['reason'] {
    const known = outcomes.get(unitId);
    if (known !== undefined) return known;

    const cycleStart = path.indexOf(unitId);
    if (cycleStart >= 0) {
      for (const cycleId of path.slice(cycleStart)) outcomes.set(cycleId, 'cycle');
      return 'cycle';
    }

    const candidate = candidates.get(unitId);
    if (candidate === undefined) return 'occupied';
    const targetKey = cellKey(candidate);
    if ((targetCounts.get(targetKey) ?? 0) > 1) {
      outcomes.set(unitId, 'conflict');
      return 'conflict';
    }

    const occupantId = occupied.get(targetKey);
    const nextReason = occupantId === undefined ? 'moved'
      : !moving.has(occupantId) ? 'occupied'
        : resolveMove(occupantId, [...path, unitId]) === 'moved' ? 'moved' : 'occupied';
    // 循環の探索中に、このユニット自身の理由が確定する場合がある。
    const reason = outcomes.get(unitId) ?? nextReason;
    outcomes.set(unitId, reason);
    return reason;
  }

  const movedUnits = units.map((unit): Unit => {
    if (!active.has(unit.id)) return unit;
    if (!moving.has(unit.id)) {
      outcomes.set(unit.id, unit.destination === null ? 'no-order' : 'arrived');
      return unit;
    }
    if (resolveMove(unit.id, []) !== 'moved') return unit;
    const position = candidates.get(unit.id);
    return position === undefined ? unit : { ...unit, position };
  });

  for (const unit of movedUnits) {
    if (outcomes.get(unit.id) === 'moved' && unit.destination !== null && sameCell(unit.position, unit.destination)) {
      outcomes.set(unit.id, 'arrived');
    }
  }

  return { units: movedUnits, reasons: outcomes };
}

function advanceTurn(state: BoardState): BoardResult {
  let units = state.units;
  const reasons = new Map<number, UnitEvent['reason']>();
  const stopped = new Set<number>();
  const steps = Math.max(0, ...units.map((unit) => unit.moveDistance));
  for (let step = 0; step < steps; step += 1) {
    const active = new Set(units.filter((unit) => step < unit.moveDistance && !stopped.has(unit.id)).map((unit) => unit.id));
    if (active.size === 0) break;
    const result = moveOneStep(units, active);
    units = result.units;
    for (const [unitId, reason] of result.reasons) {
      reasons.set(unitId, reason);
      if (reason !== 'moved') stopped.add(unitId);
    }
  }

  const events = units.map((unit, index): UnitEvent => ({
    unitId: unit.id,
    from: { ...(state.units[index]?.position ?? unit.position) },
    to: { ...unit.position },
    reason: reasons.get(unit.id) ?? 'no-order',
  }));
  const blocked = events.filter((event) => event.reason === 'conflict' || event.reason === 'occupied'
    || event.reason === 'cycle').map((event) => event.unitId);

  const combat = resolveCombat(units);
  return success({ ...state, units: combat.units, turn: state.turn + 1, orderedUnitIds: [] }, blocked, events, combat.events);
}

export function applyAction(state: BoardState, action: BoardAction): BoardResult {
  if (action.type === 'advance') return advanceTurn(state);

  if (action.type === 'add') {
    const unitType = action.unitType ?? 'infantry';
    const side = action.side ?? 'ally';
    if (!isUnitType(unitType)) return failure(state, '兵科を選んでください。');
    if (!isUnitSide(side)) return failure(state, '陣営を選んでください。');
    if (!validCell(state, action.position)) return failure(state, '盤面内のマスを選んでください。');
    if (state.units.some((unit) => sameCell(unit.position, action.position))) {
      return failure(state, 'そのマスにはユニットがあります。');
    }
    return success({
      ...state,
      units: [...state.units, createUnit(state.nextId, unitType, side, action.position)],
      nextId: state.nextId + 1,
    });
  }

  const unit = state.units.find((item) => item.id === action.unitId);
  if (unit === undefined) return failure(state, 'ユニットを選んでください。');

  if (action.type === 'set-type') {
    if (!isUnitType(action.unitType)) return failure(state, '兵科を選んでください。');
    const preset = UNIT_TYPES[action.unitType];
    return success({
      ...state,
      units: state.units.map((item) => item.id === unit.id
        ? { ...item, type: action.unitType, moveDistance: preset.moveDistance,
          hp: preset.maxHp, maxHp: preset.maxHp, attack: preset.attack, attackRange: preset.attackRange }
        : item),
    });
  }

  if (action.type === 'set-side') {
    if (!isUnitSide(action.side)) return failure(state, '陣営を選んでください。');
    return success({ ...state, units: state.units.map((item) => item.id === unit.id ? { ...item, side: action.side } : item) });
  }

  if (action.type === 'set-combat-stat') {
    if (!Object.hasOwn(COMBAT_STAT_LIMITS, action.stat)) return failure(state, '戦闘能力の項目を選んでください。');
    const { min, max } = COMBAT_STAT_LIMITS[action.stat];
    const names: Record<CombatStat, string> = { maxHp: '最大HP', attack: '攻撃力', attackRange: '射程' };
    if (!Number.isInteger(action.value) || action.value < min || action.value > max) {
      return failure(state, `${names[action.stat]}は${min}〜${max}の整数で指定してください。`);
    }
    return success({
      ...state,
      units: state.units.map((item) => item.id !== unit.id ? item
        : { ...item, [action.stat]: action.value, ...(action.stat === 'maxHp' ? { hp: action.value } : {}) }),
    });
  }

  if (action.type === 'set-move-distance' || action.type === 'reset-move-distance') {
    const moveDistance = action.type === 'reset-move-distance' ? UNIT_TYPES[unit.type].moveDistance : action.moveDistance;
    if (!Number.isInteger(moveDistance) || moveDistance < MIN_MOVE_DISTANCE || moveDistance > MAX_MOVE_DISTANCE) {
      return failure(state, `移動力は${MIN_MOVE_DISTANCE}〜${MAX_MOVE_DISTANCE}の整数で指定してください。`);
    }
    return success({
      ...state,
      units: state.units.map((item) => item.id === unit.id ? { ...item, moveDistance } : item),
    });
  }

  if (action.type === 'remove') {
    return success({
      ...state,
      units: state.units.filter((item) => item.id !== unit.id),
      orderedUnitIds: state.orderedUnitIds.filter((id) => id !== unit.id),
    });
  }

  if (action.type === 'move') {
    if (!validCell(state, action.position)) return failure(state, '盤面内のマスを選んでください。');
    if (state.units.some((item) => item.id !== unit.id && sameCell(item.position, action.position))) {
      return failure(state, 'そのマスにはユニットがあります。');
    }
    return success({
      ...state,
      units: state.units.map((item) => item.id === unit.id ? { ...item, position: { ...action.position } } : item),
    });
  }

  if (action.destination !== null && !validCell(state, action.destination)) {
    return failure(state, '目的地は盤面内のマスを選んでください。');
  }
  const alreadyOrdered = state.orderedUnitIds.includes(unit.id);
  const sideOrderCount = state.units.filter((item) => item.side === unit.side && state.orderedUnitIds.includes(item.id)).length;
  if (!alreadyOrdered && sideOrderCount >= state.rules.orderLimit) {
    return failure(state, 'このターンの指示枠を使い切りました。');
  }
  return success({
    ...state,
    units: state.units.map((item) => item.id === unit.id
      ? { ...item, destination: action.destination === null ? null : { ...action.destination } }
      : item),
    orderedUnitIds: alreadyOrdered ? state.orderedUnitIds : [...state.orderedUnitIds, unit.id],
  });
}
