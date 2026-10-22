import { applyAction, createBoard } from './board';
import type { BoardAction, BoardState, CombatEvent, UnitEvent } from './board';

export interface TurnSnapshot {
  board: BoardState;
  events: UnitEvent[];
  combatEvents: CombatEvent[];
}

export interface SandboxSession {
  board: BoardState;
  initialBoard: BoardState;
  history: TurnSnapshot[];
  events: UnitEvent[];
  combatEvents: CombatEvent[];
  mode: 'edit' | 'run';
}

function startingBoard(board: BoardState): BoardState {
  return { ...structuredClone(board), turn: 0, orderedUnitIds: [] };
}

export function createSession(board: BoardState = createBoard()): SandboxSession {
  const initialBoard = startingBoard(board);
  return {
    board: structuredClone(initialBoard),
    initialBoard,
    history: [],
    events: [],
    combatEvents: [],
    mode: 'edit',
  };
}

export function startExperiment(session: SandboxSession): SandboxSession {
  const initialBoard = startingBoard(session.board);
  return {
    board: structuredClone(initialBoard),
    initialBoard,
    history: [],
    events: [],
    combatEvents: [],
    mode: 'run',
  };
}

export function editExperiment(session: SandboxSession): SandboxSession {
  const board = startingBoard(session.board);
  return {
    ...session,
    board: {
      ...board,
      units: board.units.map((unit) => ({ ...unit, destination: null })),
    },
    history: [],
    events: [],
    combatEvents: [],
    mode: 'edit',
  };
}

export function resetExperiment(session: SandboxSession): SandboxSession {
  return {
    ...session,
    board: startingBoard(session.initialBoard),
    history: [],
    events: [],
    combatEvents: [],
  };
}

export function undoTurn(session: SandboxSession): SandboxSession {
  const snapshot = session.history.at(-1);
  if (snapshot === undefined) return session;
  return {
    ...session,
    board: structuredClone(snapshot.board),
    events: structuredClone(snapshot.events),
    combatEvents: structuredClone(snapshot.combatEvents),
    history: session.history.slice(0, -1),
  };
}

export function actOnSession(
  session: SandboxSession,
  action: BoardAction,
): { session: SandboxSession; error: string | null } {
  const editing = action.type === 'add' || action.type === 'move' || action.type === 'remove'
    || action.type === 'set-type' || action.type === 'set-move-distance' || action.type === 'reset-move-distance'
    || action.type === 'set-side' || action.type === 'set-combat-stat';
  if (editing && session.mode !== 'edit') {
    return { session, error: '配置を変更するには「配置編集」に切り替えてください。' };
  }
  if (!editing && session.mode !== 'run') {
    return { session, error: '実験を開始してください。' };
  }

  const result = applyAction(session.board, action);
  if (result.error !== null) return { session, error: result.error };

  if (action.type === 'advance') {
    return {
      session: {
        ...session,
        board: result.state,
        events: structuredClone(result.events),
        combatEvents: structuredClone(result.combatEvents),
        history: [
          ...session.history,
          {
            board: structuredClone(session.board),
            events: structuredClone(session.events),
            combatEvents: structuredClone(session.combatEvents),
          },
        ],
      },
      error: null,
    };
  }

  return {
    session: {
      ...session,
      board: result.state,
      events: editing ? [] : session.events,
      combatEvents: editing ? [] : session.combatEvents,
    },
    error: null,
  };
}
