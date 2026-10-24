import { COMBAT_STAT_LIMITS, isUnitSide, isUnitType, MAX_MOVE_DISTANCE, MIN_MOVE_DISTANCE, MAX_MOVE_PRIORITY, MIN_MOVE_PRIORITY, UNIT_TYPES } from './unitTypes';
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
  movePriority: number;
  hp: number;
  maxHp: number;
  attack: number;
  attackRange: number;
  position: Cell;
  destination: Cell | null;
}

export interface BoardRules {
  orderLimit: number;
  matchEnabled: boolean;
  firstPrioritySide: UnitSide;
  turnLimit: number;
}

export const MIN_TURN_LIMIT = 1;
export const MAX_TURN_LIMIT = 999;
export const DEFAULT_RULES: BoardRules = Object.freeze({ orderLimit: 1, matchEnabled: false, firstPrioritySide: 'ally', turnLimit: 50 });
export const DEFAULT_BOARD_SIZE = 9;

export interface MatchOutcome {
  winner: UnitSide | null;
  reason: 'goal' | 'elimination' | 'simultaneous' | 'turn-limit';
}

export interface BoardState {
  width: number;
  height: number;
  turn: number;
  units: Unit[];
  nextId: number;
  orderedUnitIds: number[];
  rules: BoardRules;
  walls: Cell[];
  goals: Record<UnitSide, Cell | null>;
  outcome: MatchOutcome | null;
}

export type BoardAction =
  | { type: 'add'; position: Cell; unitType?: UnitType; side?: UnitSide }
  | { type: 'move'; unitId: number; position: Cell }
  | { type: 'remove'; unitId: number }
  | { type: 'set-type'; unitId: number; unitType: UnitType }
  | { type: 'set-side'; unitId: number; side: UnitSide }
  | { type: 'set-combat-stat'; unitId: number; stat: CombatStat; value: number }
  | { type: 'set-move-distance'; unitId: number; moveDistance: number }
  | { type: 'set-move-priority'; unitId: number; movePriority: number }
  | { type: 'reset-move-distance'; unitId: number }
  | { type: 'set-wall'; position: Cell; blocked: boolean }
  | { type: 'set-goal'; side: UnitSide; position: Cell | null }
  | { type: 'set-match-rules'; matchEnabled?: boolean; firstPrioritySide?: UnitSide; turnLimit?: number }
  | { type: 'set-initial-order'; unitId: number; destination: Cell | null }
  | { type: 'order'; unitId: number; destination: Cell | null }
  | { type: 'clear-orders' }
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
  reason: 'moved' | 'no-order' | 'arrived' | 'conflict' | 'occupied' | 'cycle' | 'no-path';
}

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 3 && value <= 12;
}

function validateRules(rules: BoardRules): string | null {
  if (!Number.isInteger(rules.orderLimit) || rules.orderLimit < 1 || rules.orderLimit > 144) {
    return '指示できるユニットの数は1〜144の整数で指定してください。';
  }
  if (typeof rules.matchEnabled !== 'boolean') return '対戦の有効・無効を選んでください。';
  if (!isUnitSide(rules.firstPrioritySide)) return '最初に優先するプレイヤーを選んでください。';
  if (!Number.isInteger(rules.turnLimit) || rules.turnLimit < MIN_TURN_LIMIT || rules.turnLimit > MAX_TURN_LIMIT) {
    return `ターン上限は${MIN_TURN_LIMIT}〜${MAX_TURN_LIMIT}の整数で指定してください。`;
  }
  return null;
}

export function createBoard(width = DEFAULT_BOARD_SIZE, height = DEFAULT_BOARD_SIZE, rules: Partial<BoardRules> = DEFAULT_RULES): BoardState {
  if (!validDimension(width) || !validDimension(height)) {
    throw new RangeError('盤面の幅と高さは3〜12の整数で指定してください。');
  }
  const mergedRules = { ...DEFAULT_RULES, ...rules };
  const rulesError = validateRules(mergedRules);
  if (rulesError !== null) throw new RangeError(rulesError);

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
    rules: mergedRules,
    walls: [],
    goals: { ally: null, enemy: null },
    outcome: null,
  };
}

function validCell(state: BoardState, cell: Cell): boolean {
  return cell !== null && typeof cell === 'object' && Number.isInteger(cell.x) && Number.isInteger(cell.y)
    && cell.x >= 0 && cell.x < state.width
    && cell.y >= 0 && cell.y < state.height;
}

function sameCell(left: Cell, right: Cell): boolean {
  return left.x === right.x && left.y === right.y;
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function isWall(state: BoardState, cell: Cell): boolean {
  return state.walls.some((wall) => sameCell(wall, cell));
}

// 現在の配置を固定した移動範囲。同時移動で空くマスや競合の結果は予測しない。
export function getMovementRange(state: BoardState, unitId: number): Cell[] {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) return [];

  const blocked = new Set([
    ...state.walls.map(cellKey),
    ...state.units.filter((item) => item.id !== unitId).map((item) => cellKey(item.position)),
  ]);
  const visited = new Set([cellKey(unit.position)]);
  const queue = [{ cell: unit.position, steps: 0 }];
  const range: Cell[] = [];
  const directions = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
  for (let index = 0; index < queue.length; index += 1) {
    const { cell, steps } = queue[index]!;
    if (steps >= unit.moveDistance) continue;
    for (const direction of directions) {
      const next = { x: cell.x + direction.x, y: cell.y + direction.y };
      const key = cellKey(next);
      if (!validCell(state, next) || visited.has(key) || blocked.has(key)) continue;
      visited.add(key);
      range.push(next);
      queue.push({ cell: next, steps: steps + 1 });
    }
  }
  return range;
}

function oppositeSide(side: UnitSide): UnitSide {
  return side === 'ally' ? 'enemy' : 'ally';
}

// turnは完了済みターン数。次に解決するターンの優先権を返す。
export function prioritySideForTurn(state: BoardState): UnitSide {
  return state.turn % 2 === 0 ? state.rules.firstPrioritySide : oppositeSide(state.rules.firstPrioritySide);
}

export function validateMatchSetup(state: BoardState): string | null {
  if (!state.rules.matchEnabled) return null;
  for (const side of ['ally', 'enemy'] as const) {
    if (!state.units.some((unit) => unit.side === side && unit.hp > 0)) {
      return '両プレイヤーのユニットを1体以上配置してください。';
    }
  }
  const { ally, enemy } = state.goals;
  if (ally === null || enemy === null) return '両プレイヤーの陣地を配置してください。';
  if (!validCell(state, ally) || !validCell(state, enemy) || sameCell(ally, enemy)
    || isWall(state, ally) || isWall(state, enemy)) return '陣地は壁のない別々のマスに配置してください。';
  return null;
}

function createUnit(id: number, type: UnitType, side: UnitSide, position: Cell): Unit {
  const preset = UNIT_TYPES[type];
  return {
    id, type, side, moveDistance: preset.moveDistance, movePriority: preset.movePriority,
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

function nextPosition(unit: Unit, occupied: ReadonlyMap<string, number>, walls: ReadonlySet<string>, width: number, height: number): Cell | null {
  const destination = unit.destination;
  if (destination === null || sameCell(unit.position, destination)) {
    return unit.position;
  }

  // 各1マスの移動前に、現在の占有状況から上下左右の最短経路を探す。
  const queue: { cell: Cell; firstStep: Cell | null }[] = [{ cell: unit.position, firstStep: null }];
  const visited = new Set([cellKey(unit.position)]);
  for (let index = 0; index < queue.length; index += 1) {
    const { cell, firstStep } = queue[index]!;
    const directions: Cell[] = [
      { x: Math.sign(destination.x - cell.x), y: 0 },
      { x: 0, y: Math.sign(destination.y - cell.y) },
      { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 },
    ];
    for (const direction of directions) {
      const next = { x: cell.x + direction.x, y: cell.y + direction.y };
      if (next.x < 0 || next.x >= width || next.y < 0 || next.y >= height) continue;
      const key = cellKey(next);
      if (visited.has(key) || walls.has(key)) continue;
      // 占有された目的地にも接近できる。最後の進入可否は同時移動の判定に任せる。
      if (occupied.has(key) && !sameCell(next, destination)) continue;
      const step = firstStep ?? next;
      if (sameCell(next, destination)) return step;
      visited.add(key);
      queue.push({ cell: next, firstStep: step });
    }
  }
  return null;
}

function moveOneStep(units: Unit[], active: Set<number>, state: BoardState): { units: Unit[]; reasons: Map<number, UnitEvent['reason']> } {
  const occupied = new Map(units.map((unit) => [cellKey(unit.position), unit.id]));
  // 動こうとしているユニットのマスは後続が利用できる。実際に空くかは同時移動で判定する。
  const obstacles = new Map(units.filter((unit) => !active.has(unit.id) || unit.destination === null
    || sameCell(unit.position, unit.destination)).map((unit) => [cellKey(unit.position), unit.id]));
  const candidates = new Map<number, Cell>();
  const contenders = new Map<string, Unit[]>();
  const moving = new Set<number>();
  const outcomes = new Map<number, UnitEvent['reason']>();
  const walls = new Set(state.walls.map(cellKey));
  const prioritySide = prioritySideForTurn(state);
  const ranks = new Map<number, number>();
  for (const side of ['ally', 'enemy'] as const) {
    const sideUnits = units.filter((unit) => unit.side === side && unit.hp > 0).sort((a, b) => a.id - b.id);
    for (let rank = 0; rank < sideUnits.length; rank += 1) {
      ranks.set(sideUnits[(state.turn + rank) % sideUnits.length]!.id, rank);
    }
  }

  for (const unit of units) {
    if (!active.has(unit.id)) continue;
    const candidate = nextPosition(unit, obstacles, walls, state.width, state.height);
    if (candidate === null) {
      outcomes.set(unit.id, 'no-path');
      continue;
    }
    candidates.set(unit.id, candidate);
    if (!sameCell(candidate, unit.position)) {
      moving.add(unit.id);
      const key = cellKey(candidate);
      const group = contenders.get(key) ?? [];
      group.push(unit);
      contenders.set(key, group);
    }
  }

  // 同じマスを狙う場合、能力値・プレイヤーの優先権・自軍内の持ち回りの順で1体に絞る。
  // 勝者も進入先の占有チェックを通すため、進めないユニットを押し出すことはない。
  for (const group of contenders.values()) {
    group.sort((a, b) => b.movePriority - a.movePriority
      || Number(b.side === prioritySide) - Number(a.side === prioritySide)
      || (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0));
    for (const loser of group.slice(1)) outcomes.set(loser.id, 'conflict');
  }

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
      if (!outcomes.has(unit.id)) outcomes.set(unit.id, unit.destination === null ? 'no-order' : 'arrived');
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
    const result = moveOneStep(units, active, state);
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
    || event.reason === 'cycle' || event.reason === 'no-path').map((event) => event.unitId);

  const combat = resolveCombat(units);
  const next = { ...state, units: combat.units, turn: state.turn + 1, orderedUnitIds: [] };
  next.outcome = matchOutcome(next);
  return success(next, blocked, events, combat.events);
}

function matchOutcome(state: BoardState): MatchOutcome | null {
  if (!state.rules.matchEnabled) return null;
  const victory = (side: UnitSide): 'goal' | 'elimination' | null => {
    const opponent = oppositeSide(side);
    const goal = state.goals[opponent];
    if (goal !== null && state.units.some((unit) => unit.side === side && unit.hp > 0 && sameCell(unit.position, goal))) {
      return 'goal';
    }
    return state.units.some((unit) => unit.side === opponent && unit.hp > 0) ? null : 'elimination';
  };
  const ally = victory('ally');
  const enemy = victory('enemy');
  if (ally !== null && enemy !== null) return { winner: null, reason: 'simultaneous' };
  if (ally !== null) return { winner: 'ally', reason: ally };
  if (enemy !== null) return { winner: 'enemy', reason: enemy };
  if (state.turn >= state.rules.turnLimit) return { winner: null, reason: 'turn-limit' };
  return null;
}

export function applyAction(state: BoardState, action: BoardAction): BoardResult {
  if (state.outcome !== null && (action.type === 'advance' || action.type === 'order' || action.type === 'clear-orders')) {
    return failure(state, '試合は終了しています。');
  }
  if (action.type === 'advance') return advanceTurn(state);

  if (action.type === 'clear-orders') {
    if (state.orderedUnitIds.length === 0 && state.units.every((unit) => unit.destination === null)) return success(state);
    return success({
      ...state,
      units: state.units.map((unit) => unit.destination === null ? unit : { ...unit, destination: null }),
      orderedUnitIds: [],
    });
  }

  if (action.type === 'set-match-rules') {
    const rules = { ...state.rules };
    for (const key of ['matchEnabled', 'firstPrioritySide', 'turnLimit'] as const) {
      if (Object.hasOwn(action, key)) Object.assign(rules, { [key]: action[key] });
    }
    const error = validateRules(rules);
    return error === null ? success({ ...state, rules }) : failure(state, error);
  }

  if (action.type === 'set-wall') {
    if (!validCell(state, action.position)) return failure(state, '盤面内のマスを選んでください。');
    if (typeof action.blocked !== 'boolean') return failure(state, '壁の有無を指定してください。');
    if (action.blocked && (state.units.some((unit) => sameCell(unit.position, action.position))
      || Object.values(state.goals).some((goal) => goal !== null && sameCell(goal, action.position)))) {
      return failure(state, 'ユニットや陣地のあるマスには壁を置けません。');
    }
    if (action.blocked && state.units.some((unit) => unit.destination !== null && sameCell(unit.destination, action.position))) {
      return failure(state, '目的地に設定されたマスには壁を置けません。');
    }
    const walls = state.walls.filter((wall) => !sameCell(wall, action.position));
    if (action.blocked) walls.push({ ...action.position });
    return success({ ...state, walls });
  }

  if (action.type === 'set-goal') {
    if (!isUnitSide(action.side)) return failure(state, '陣地のプレイヤーを選んでください。');
    if (action.position !== null) {
      if (!validCell(state, action.position)) return failure(state, '盤面内のマスを選んでください。');
      if (isWall(state, action.position)) return failure(state, '壁のあるマスには陣地を置けません。');
      const otherGoal = state.goals[oppositeSide(action.side)];
      if (otherGoal !== null && sameCell(otherGoal, action.position)) return failure(state, '陣地は別々のマスに配置してください。');
    }
    return success({ ...state, goals: { ...state.goals, [action.side]: action.position === null ? null : { ...action.position } } });
  }

  if (action.type === 'add') {
    const unitType = action.unitType ?? 'infantry';
    const side = action.side ?? 'ally';
    if (!isUnitType(unitType)) return failure(state, '兵科を選んでください。');
    if (!isUnitSide(side)) return failure(state, '陣営を選んでください。');
    if (!validCell(state, action.position)) return failure(state, '盤面内のマスを選んでください。');
    if (isWall(state, action.position)) return failure(state, '壁のあるマスには配置できません。');
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
        ? { ...item, type: action.unitType, moveDistance: preset.moveDistance, movePriority: preset.movePriority,
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

  if (action.type === 'set-move-priority') {
    if (!Number.isInteger(action.movePriority) || action.movePriority < MIN_MOVE_PRIORITY || action.movePriority > MAX_MOVE_PRIORITY) {
      return failure(state, `移動優先度は${MIN_MOVE_PRIORITY}〜${MAX_MOVE_PRIORITY}の整数で指定してください。`);
    }
    return success({ ...state, units: state.units.map((item) => item.id === unit.id ? { ...item, movePriority: action.movePriority } : item) });
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
    if (isWall(state, action.position)) return failure(state, '壁のあるマスには配置できません。');
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
  if (action.destination !== null && isWall(state, action.destination)) return failure(state, '壁のあるマスは目的地にできません。');
  const alreadyOrdered = state.orderedUnitIds.includes(unit.id);
  const sideOrderCount = state.units.filter((item) => item.side === unit.side && state.orderedUnitIds.includes(item.id)).length;
  if (action.type === 'order' && !alreadyOrdered && sideOrderCount >= state.rules.orderLimit) {
    return failure(state, 'このターンの指示枠を使い切りました。');
  }
  return success({
    ...state,
    units: state.units.map((item) => item.id === unit.id
      ? { ...item, destination: action.destination === null ? null : { ...action.destination } }
      : item),
    orderedUnitIds: action.type === 'set-initial-order' || alreadyOrdered ? state.orderedUnitIds : [...state.orderedUnitIds, unit.id],
  });
}
