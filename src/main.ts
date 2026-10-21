import './style.css';
import { createGame } from './game/createGame';
import { applyAction, createBoard } from './core/board';
import type { BoardAction, BoardState, Cell, UnitEvent } from './core/board';
import { unitLabel } from './core/labels';
import {
  actOnSession,
  createSession,
  editExperiment,
  resetExperiment,
  startExperiment,
  undoTurn,
} from './core/session';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) throw new Error('画面の配置先がありません。');
app.innerHTML = `
  <header><h1>ONE ORDER / 実験盤</h1></header>
  <nav class="toolbar" aria-label="実験の操作">
    <button type="button" id="edit-mode" aria-pressed="true">配置編集</button>
    <button type="button" id="run-mode" aria-pressed="false">実験</button>
    <div class="counters"><output id="turn"></output><output id="order-count"></output></div>
  </nav>
  <div class="workspace">
    <section class="board-section" aria-label="盤面とターン操作">
      <div id="board"></div>
      <div class="turn-actions">
        <button type="button" id="advance">1ターン進める</button>
        <button type="button" id="undo">1ターン戻す</button>
        <button type="button" id="reset">開始配置に戻す</button>
      </div>
      <p id="status" role="status" aria-live="polite"></p>
    </section>
    <aside aria-label="配置と駒の操作">
      <div id="editing-controls">
        <form id="size-form" class="fields">
          <div class="size-fields">
            <label>幅 <input id="width" type="number" min="3" max="12" step="1" value="5" required></label>
            <label>高さ <input id="height" type="number" min="3" max="12" step="1" value="5" required></label>
          </div>
          <button type="submit">盤面を作成</button>
        </form>
        <label class="field">操作
          <select id="edit-tool"><option value="move">駒を移動</option><option value="add">駒を追加</option><option value="remove">駒を削除</option></select>
        </label>
      </div>
      <label class="field">選択中の駒 <select id="selected-unit"></select></label>
      <dl class="unit-details"><dt>現在地</dt><dd id="position"></dd><dt>目的地</dt><dd id="destination"></dd><dt>直前の行動</dt><dd id="last-action"></dd></dl>
      <div id="point-controls" class="fields" hidden>
        <button type="button" id="pick-target" aria-pressed="false">目的地を指定</button>
        <button type="button" id="clear-order">指示を解除</button>
      </div>
      <form id="coordinate-form" class="fields">
        <div class="size-fields">
          <label>X <input id="cell-x" type="number" min="1" max="5" step="1" value="2" required></label>
          <label>Y <input id="cell-y" type="number" min="1" max="5" step="1" value="4" required></label>
        </div>
        <button type="submit" id="apply-coordinate">駒を移動</button>
      </form>
      <button type="button" id="remove-selected" class="full-width">選択した駒を削除</button>
      <hr>
      <dl class="rules"><dt>指示上限</dt><dd id="order-limit"></dd><dt>移動量</dt><dd id="move-distance"></dd></dl>
      <table><thead><tr><th scope="col">駒</th><th scope="col">現在地</th><th scope="col">目的地</th></tr></thead><tbody id="unit-rows"></tbody></table>
    </aside>
  </div>
`;

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`画面の要素がありません: ${selector}`);
  return found;
}

const controls = {
  board: element<HTMLDivElement>('#board'),
  edit: element<HTMLButtonElement>('#edit-mode'),
  run: element<HTMLButtonElement>('#run-mode'),
  turn: element<HTMLOutputElement>('#turn'),
  orderCount: element<HTMLOutputElement>('#order-count'),
  advance: element<HTMLButtonElement>('#advance'),
  undo: element<HTMLButtonElement>('#undo'),
  reset: element<HTMLButtonElement>('#reset'),
  status: element<HTMLParagraphElement>('#status'),
  editing: element<HTMLDivElement>('#editing-controls'),
  sizeForm: element<HTMLFormElement>('#size-form'),
  width: element<HTMLInputElement>('#width'),
  height: element<HTMLInputElement>('#height'),
  tool: element<HTMLSelectElement>('#edit-tool'),
  selected: element<HTMLSelectElement>('#selected-unit'),
  position: element<HTMLElement>('#position'),
  destination: element<HTMLElement>('#destination'),
  lastAction: element<HTMLElement>('#last-action'),
  point: element<HTMLDivElement>('#point-controls'),
  pickTarget: element<HTMLButtonElement>('#pick-target'),
  clearOrder: element<HTMLButtonElement>('#clear-order'),
  coordinateForm: element<HTMLFormElement>('#coordinate-form'),
  x: element<HTMLInputElement>('#cell-x'),
  y: element<HTMLInputElement>('#cell-y'),
  apply: element<HTMLButtonElement>('#apply-coordinate'),
  remove: element<HTMLButtonElement>('#remove-selected'),
  orderLimit: element<HTMLElement>('#order-limit'),
  moveDistance: element<HTMLElement>('#move-distance'),
  rows: element<HTMLTableSectionElement>('#unit-rows'),
};

function initialBoard(width = 5, height = 5): BoardState {
  let board = createBoard(width, height);
  const margin = width >= 4 ? 1 : 0;
  board = applyAction(board, { type: 'move', unitId: 1, position: { x: margin, y: height - 2 } }).state;
  return applyAction(board, { type: 'move', unitId: 2, position: { x: width - margin - 1, y: height - 2 } }).state;
}

let session = createSession(initialBoard());
let selectedId: number | null = session.board.units[0]?.id ?? null;
let cursor: Cell = { ...session.board.units[0]!.position };
let targeting = false;
let status = '';
let isError = false;
let boardGame: ReturnType<typeof createGame> | undefined;

const formatCell = (cell: Cell | null): string => cell === null ? '—' : `(${cell.x + 1}, ${cell.y + 1})`;
const eventLabels: Record<UnitEvent['reason'], string> = {
  moved: '移動',
  'no-order': '指示なし',
  arrived: '目的地に到着',
  conflict: '移動先が競合して停止',
  occupied: '他の駒で進めず停止',
  cycle: '入れ替え・循環で停止',
};

function setStatus(message = '', error = false): void {
  status = message;
  isError = error;
}

function selectUnit(id: number): void {
  const unit = session.board.units.find((item) => item.id === id);
  if (unit === undefined) return;
  selectedId = id;
  cursor = { ...(session.mode === 'run' ? unit.destination ?? unit.position : unit.position) };
  targeting = false;
  setStatus();
  render();
}

function render(): void {
  const { board, mode } = session;
  const editing = mode === 'edit';
  if (!board.units.some((unit) => unit.id === selectedId)) selectedId = board.units[0]?.id ?? null;
  const unit = board.units.find((item) => item.id === selectedId);
  cursor = { x: Math.min(Math.max(cursor.x, 0), board.width - 1), y: Math.min(Math.max(cursor.y, 0), board.height - 1) };
  controls.edit.setAttribute('aria-pressed', String(editing));
  controls.run.setAttribute('aria-pressed', String(!editing));
  controls.turn.value = `ターン ${board.turn}`;
  controls.orderCount.value = editing ? `駒 ${board.units.length}体` : `指示 ${board.orderedUnitIds.length} / ${board.rules.orderLimit}体`;
  controls.editing.hidden = !editing;
  controls.point.hidden = editing;
  controls.remove.hidden = !editing;
  controls.advance.disabled = editing;
  controls.undo.disabled = editing || session.history.length === 0;
  controls.remove.disabled = unit === undefined;
  controls.pickTarget.disabled = unit === undefined;
  controls.clearOrder.disabled = unit === undefined;
  controls.pickTarget.textContent = targeting ? '指定を取り消す' : '目的地を指定';
  controls.pickTarget.setAttribute('aria-pressed', String(targeting));
  const unitValues = board.units.length === 0 ? [''] : board.units.map((item) => String(item.id));
  if (controls.selected.options.length !== unitValues.length || unitValues.some((value, index) => controls.selected.options[index]?.value !== value)) {
    controls.selected.replaceChildren();
    for (const item of board.units) controls.selected.add(new Option(unitLabel(item.id), String(item.id)));
    if (selectedId === null) controls.selected.add(new Option('駒なし', ''));
  }
  controls.selected.value = selectedId === null ? '' : String(selectedId);
  controls.selected.disabled = unit === undefined;
  controls.position.textContent = unit === undefined ? '—' : formatCell(unit.position);
  controls.destination.textContent = unit === undefined ? '—' : formatCell(unit.destination);
  const event = session.events.find((item) => item.unitId === selectedId);
  controls.lastAction.textContent = event === undefined ? '—' : eventLabels[event.reason];
  controls.orderLimit.textContent = `${board.rules.orderLimit}体 / ターン`;
  controls.moveDistance.textContent = `${board.rules.moveDistance}マス / ターン`;
  controls.x.max = String(board.width);
  controls.y.max = String(board.height);
  controls.x.value = String(cursor.x + 1);
  controls.y.value = String(cursor.y + 1);
  controls.apply.textContent = editing ? { move: '駒を移動', add: '駒を追加', remove: 'そのマスの駒を削除' }[controls.tool.value] ?? '駒を移動' : '目的地を指示';
  controls.apply.disabled = unit === undefined && (!editing || controls.tool.value === 'move');
  controls.status.textContent = status;
  controls.status.setAttribute('role', isError ? 'alert' : 'status');
  controls.status.classList.toggle('error', isError);
  const rows = new Map(Array.from(controls.rows.rows, (row) => [Number(row.dataset.unitId), row]));
  board.units.forEach((item, index) => {
    let row = rows.get(item.id);
    if (row === undefined) {
      row = document.createElement('tr');
      row.dataset.unitId = String(item.id);
      const select = document.createElement('button');
      select.type = 'button';
      select.textContent = unitLabel(item.id);
      select.setAttribute('aria-label', `駒 ${unitLabel(item.id)} を選択`);
      select.addEventListener('click', () => selectUnit(item.id));
      row.insertCell().append(select);
      row.insertCell(); row.insertCell();
    }
    row.querySelector('button')?.setAttribute('aria-pressed', String(item.id === selectedId));
    row.cells[1]!.textContent = formatCell(item.position);
    row.cells[2]!.textContent = formatCell(item.destination);
    if (controls.rows.rows[index] !== row) controls.rows.insertBefore(row, controls.rows.rows[index] ?? null);
    rows.delete(item.id);
  });
  rows.forEach((row) => row.remove());
  controls.board.style.width = `min(100%, ${Math.round(520 * (board.width + 1) / (board.height + 1))}px)`;
  controls.board.style.aspectRatio = `${board.width + 1} / ${board.height + 1}`;
  boardGame?.render({ board, selectedUnitId: selectedId, targeting });
}

function perform(action: BoardAction): boolean {
  const previous = session.board;
  const result = actOnSession(session, action);
  if (result.error !== null) {
    setStatus(result.error, true);
    render();
    return false;
  }
  session = result.session;
  if (action.type === 'add') selectedId = previous.nextId;
  if (action.type === 'advance') {
    const moved = session.events.filter((event) => event.from.x !== event.to.x || event.from.y !== event.to.y).length;
    const blocked = session.events.filter((event) => ['conflict', 'occupied', 'cycle'].includes(event.reason)).length;
    setStatus(`${moved}体移動${blocked > 0 ? `・${blocked}体停止` : ''}`);
  } else if (action.type === 'order') {
    targeting = false;
    setStatus(`駒 ${unitLabel(action.unitId)}：${action.destination === null ? '指示を解除' : `目的地 ${formatCell(action.destination)}`}`);
  } else {
    setStatus();
  }
  render();
  return true;
}

function applyAt(position: Cell): void {
  cursor = position;
  if (session.mode === 'run') {
    if (selectedId === null) { setStatus('駒を選んでください。', true); render(); return; }
    perform({ type: 'order', unitId: selectedId, destination: position });
    return;
  }
  if (controls.tool.value === 'add') {
    perform({ type: 'add', position });
  } else if (controls.tool.value === 'remove') {
    const occupant = session.board.units.find((unit) => unit.position.x === position.x && unit.position.y === position.y);
    if (occupant === undefined) { setStatus('そのマスに駒がありません。', true); render(); return; }
    perform({ type: 'remove', unitId: occupant.id });
  } else if (selectedId !== null) {
    perform({ type: 'move', unitId: selectedId, position });
  } else {
    setStatus('駒を選んでください。', true); render();
  }
}

function clickCell(cell: Cell): void {
  const occupant = session.board.units.find((unit) => unit.position.x === cell.x && unit.position.y === cell.y);
  if (occupant !== undefined && !targeting && (session.mode === 'run' || controls.tool.value === 'move')) {
    selectUnit(occupant.id);
  } else {
    applyAt(cell);
  }
}

controls.edit.addEventListener('click', () => {
  if (session.mode === 'edit') return;
  session = editExperiment(session);
  targeting = false;
  setStatus(); render();
});
controls.run.addEventListener('click', () => {
  if (session.mode === 'run') return;
  session = startExperiment(session);
  targeting = false;
  setStatus(); render();
});
controls.sizeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    session = createSession(initialBoard(controls.width.valueAsNumber, controls.height.valueAsNumber));
    selectedId = session.board.units[0]?.id ?? null;
    cursor = { ...session.board.units[0]!.position };
    targeting = false;
    setStatus(); render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '盤面の寸法を確認してください。', true); render();
  }
});
controls.tool.addEventListener('change', () => { setStatus(); render(); });
function rememberCoordinates(): void {
  const x = controls.x.valueAsNumber - 1;
  const y = controls.y.valueAsNumber - 1;
  if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < session.board.width && y < session.board.height) {
    cursor = { x, y };
  }
}
controls.x.addEventListener('input', rememberCoordinates);
controls.y.addEventListener('input', rememberCoordinates);
controls.selected.addEventListener('change', () => selectUnit(Number(controls.selected.value)));
controls.coordinateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applyAt({ x: controls.x.valueAsNumber - 1, y: controls.y.valueAsNumber - 1 });
});
controls.pickTarget.addEventListener('click', () => {
  targeting = !targeting;
  setStatus(targeting && selectedId !== null ? `駒 ${unitLabel(selectedId)} の目的地を選択` : '');
  render();
});
controls.clearOrder.addEventListener('click', () => {
  if (selectedId !== null) perform({ type: 'order', unitId: selectedId, destination: null });
});
controls.remove.addEventListener('click', () => {
  if (selectedId !== null) perform({ type: 'remove', unitId: selectedId });
});
controls.advance.addEventListener('click', () => { targeting = false; perform({ type: 'advance' }); });
controls.undo.addEventListener('click', () => {
  session = undoTurn(session); targeting = false; setStatus(); render();
});
controls.reset.addEventListener('click', () => {
  session = resetExperiment(session);
  selectedId = session.board.units[0]?.id ?? null;
  cursor = { ...(session.board.units[0]?.position ?? { x: 0, y: 0 }) };
  controls.width.value = String(session.board.width);
  controls.height.value = String(session.board.height);
  targeting = false; setStatus(); render();
});

render();
boardGame = createGame('board', { board: session.board, selectedUnitId: selectedId, targeting }, clickCell);

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    boardGame?.destroy();
    app.replaceChildren();
  });
}
