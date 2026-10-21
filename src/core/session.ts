import { applyAction, createBoard } from './board';
import type { BoardAction, BoardState, UnitEvent } from './board';

export interface TurnSnapshot {
  board: BoardState;
  events: UnitEvent[];
}

export interface SandboxSession {
  board: BoardState;
  initialBoard: BoardState;
  history: TurnSnapshot[];
  events: UnitEvent[];
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
    mode: 'edit',
  };
}

export function resetExperiment(session: SandboxSession): SandboxSession {
  return {
    ...session,
    board: startingBoard(session.initialBoard),
    history: [],
    events: [],
  };
}

export function undoTurn(session: SandboxSession): SandboxSession {
  const snapshot = session.history.at(-1);
  if (snapshot === undefined) return session;
  return {
    ...session,
    board: structuredClone(snapshot.board),
    events: structuredClone(snapshot.events),
    history: session.history.slice(0, -1),
  };
}

export function actOnSession(
  session: SandboxSession,
  action: BoardAction,
): { session: SandboxSession; error: string | null } {
  const editing = action.type === 'add' || action.type === 'move' || action.type === 'remove';
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
        history: [
          ...session.history,
          { board: structuredClone(session.board), events: structuredClone(session.events) },
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
    },
    error: null,
  };
}
