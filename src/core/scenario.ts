import { applyAction, createBoard, DEFAULT_BOARD_SIZE } from './board';
import type { BoardAction, BoardState } from './board';
import type { UnitSide, UnitType } from './unitTypes';

export function createMatchScenario(width = DEFAULT_BOARD_SIZE, height = DEFAULT_BOARD_SIZE): BoardState {
  let board = createBoard(width, height);
  const apply = (action: BoardAction): void => {
    const result = applyAction(board, action);
    if (result.error !== null) throw new RangeError(result.error);
    board = result.state;
  };

  const left = Math.floor((width - 3) / 2);
  const allyRow = height - 2;
  const enemyRow = height >= 4 ? 1 : 0;
  apply({ type: 'move', unitId: 1, position: { x: left, y: allyRow } });
  apply({ type: 'move', unitId: 2, position: { x: left + 1, y: allyRow } });
  apply({ type: 'set-type', unitId: 2, unitType: 'cavalry' });
  apply({ type: 'add', unitType: 'archer', position: { x: left + 2, y: allyRow } });
  const types: UnitType[] = ['infantry', 'cavalry', 'archer'];
  for (const [index, unitType] of types.entries()) {
    apply({ type: 'add', side: 'enemy', unitType, position: { x: left + index, y: enemyRow } });
  }

  const center = Math.floor(width / 2);
  const goals: Record<UnitSide, { x: number; y: number }> = {
    ally: { x: center, y: height - 1 },
    enemy: { x: center, y: 0 },
  };
  for (const side of ['ally', 'enemy'] as const) {
    apply({ type: 'set-goal', side, position: goals[side] });
  }

  if (width >= 7 && height >= 7) {
    for (const x of new Set([2, width - 3])) {
      for (const y of new Set([3, height - 4])) {
        apply({ type: 'set-wall', position: { x, y }, blocked: true });
      }
    }
  }
  apply({ type: 'set-match-rules', matchEnabled: true, firstPrioritySide: 'ally', turnLimit: 50 });
  return board;
}
