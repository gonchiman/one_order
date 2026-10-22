import './style.css';
import { createGame } from './game/createGame';
import { applyAction, createBoard, DEFAULT_BOARD_SIZE } from './core/board';
import type { BoardAction, BoardState, Cell, UnitEvent } from './core/board';
import { unitLabel } from './core/labels';
import { COMBAT_STAT_LIMITS, MAX_MOVE_DISTANCE, MIN_MOVE_DISTANCE, UNIT_SIDES, UNIT_TYPES } from './core/unitTypes';
import type { CombatStat, UnitSide, UnitType } from './core/unitTypes';
import { createAppShell } from './ui/appShell';
import { createEditorTabs } from './ui/editorTabs';
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
const shell = createAppShell(app);
const typeOptions = Object.entries(UNIT_TYPES)
  .map(([value, definition]) => `<option value="${value}">${definition.name}</option>`).join('');
const sideOptions = Object.entries(UNIT_SIDES)
  .map(([value, definition]) => `<option value="${value}">${definition.name}</option>`).join('');
const combatFields = (Object.entries(COMBAT_STAT_LIMITS) as [CombatStat, { min: number; max: number }][])
  .map(([stat, limits]) => `<label>${{ maxHp: '最大HP', attack: '攻撃力', attackRange: '射程' }[stat]}<input id="${stat}" type="number" min="${limits.min}" max="${limits.max}" step="1" required></label>`).join('');
shell.content.innerHTML = `
  <h1>実験盤</h1>
  <nav class="toolbar" aria-label="実験の操作">
    <button type="button" id="edit-mode" aria-pressed="true">配置編集</button>
    <button type="button" id="run-mode" aria-pressed="false">実験</button>
    <div class="counters"><output id="turn"></output><output id="order-count"></output></div>
  </nav>
  <div class="workspace">
    <section class="board-section" aria-label="盤面とユニット一覧">
      <div id="board"></div>
      <div class="turn-actions">
        <button type="button" id="advance">1ターン進める</button>
        <button type="button" id="undo">1ターン戻す</button>
        <button type="button" id="reset">開始配置に戻す</button>
      </div>
      <p id="status" role="status" aria-live="polite"></p>
      <table class="unit-list"><thead><tr><th scope="col">ユニット</th><th scope="col">陣営</th><th scope="col">兵科</th><th scope="col">HP</th><th scope="col">移動力</th></tr></thead><tbody id="unit-rows"></tbody></table>
      <section id="combat-log" class="combat-log" aria-labelledby="combat-heading" hidden><h2 id="combat-heading">戦闘</h2><ul id="combat-events"></ul></section>
    </section>
    <aside class="editor" aria-label="マップとユニットの編集">
      <div class="editor-tabs" role="tablist" aria-label="編集対象">
        <button type="button" id="editor-tab-unit" role="tab" aria-controls="editor-panel-unit" aria-selected="true">ユニット</button>
        <button type="button" id="editor-tab-map" role="tab" aria-controls="editor-panel-map" aria-selected="false" tabindex="-1">マップ</button>
      </div>
      <section id="editor-panel-unit" role="tabpanel" aria-labelledby="editor-tab-unit">
        <section id="editing-controls" class="editor-section" aria-labelledby="placement-heading">
          <h2 id="placement-heading">配置</h2>
          <div class="placement-tools" role="group" aria-label="配置操作">
            <button type="button" data-edit-tool="move" aria-pressed="true">選択・移動</button>
            <button type="button" data-edit-tool="add" aria-pressed="false">追加</button>
            <button type="button" data-edit-tool="remove" aria-pressed="false">削除</button>
          </div>
        </section>
        <section class="editor-section" aria-labelledby="unit-editor-title">
          <header class="section-heading">
            <h2 id="unit-editor-title">選択中のユニット</h2>
            <select id="selected-unit" aria-label="選択中のユニット"></select>
          </header>
          <label class="editor-field" id="placement-side-field" hidden><span>追加する陣営</span><select id="placement-side">${sideOptions}</select></label>
          <label class="editor-field" id="placement-type-field" hidden><span>追加する兵科</span><select id="placement-type">${typeOptions}</select></label>
          <div id="selected-properties">
            <label class="editor-field"><span>陣営</span><select id="selected-side">${sideOptions}</select></label>
            <label class="editor-field"><span>兵科</span><select id="selected-type">${typeOptions}</select></label>
            <div class="editor-field"><span>現在HP</span><output id="current-hp"></output></div>
            <div class="combat-fields">${combatFields}</div>
            <label class="editor-field"><span>移動力</span><span class="move-field"><input id="move-distance" type="number" min="${MIN_MOVE_DISTANCE}" max="${MAX_MOVE_DISTANCE}" step="1" required><span>マス</span></span></label>
            <button type="button" id="reset-move-distance" class="reset-move">移動力を初期値に戻す</button>
          </div>
          <dl class="unit-details" id="unit-details" hidden><dt>現在地</dt><dd id="position"></dd><dt>目的地</dt><dd id="destination"></dd><dt>直前の行動</dt><dd id="last-action"></dd></dl>
          <div id="point-controls" class="fields" hidden>
            <button type="button" id="pick-target" aria-pressed="false">目的地を指定</button>
            <button type="button" id="clear-order">指示を解除</button>
          </div>
          <form id="coordinate-form" class="coordinate-fields">
            <h3 id="coordinate-title">配置位置</h3>
            <div class="input-pair">
              <label>X <input id="cell-x" type="number" min="1" max="${DEFAULT_BOARD_SIZE}" step="1" required></label>
              <label>Y <input id="cell-y" type="number" min="1" max="${DEFAULT_BOARD_SIZE}" step="1" required></label>
            </div>
            <button type="submit" id="apply-coordinate" class="full-width">ユニットを移動</button>
          </form>
        </section>
        <dl class="rules"><dt>指示上限</dt><dd id="order-limit"></dd></dl>
      </section>
      <section id="editor-panel-map" role="tabpanel" aria-labelledby="editor-tab-map" hidden>
        <header class="section-heading"><h2>マップ</h2><output id="map-size"></output></header>
        <form id="size-form" class="fields">
          <div class="input-pair">
            <label>幅（マス） <input id="width" type="number" min="3" max="12" step="1" value="${DEFAULT_BOARD_SIZE}" required></label>
            <label>高さ（マス） <input id="height" type="number" min="3" max="12" step="1" value="${DEFAULT_BOARD_SIZE}" required></label>
          </div>
          <button type="submit" id="create-map">新しいマップを作成</button>
        </form>
      </section>
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
  editing: element<HTMLElement>('#editing-controls'),
  sizeForm: element<HTMLFormElement>('#size-form'),
  width: element<HTMLInputElement>('#width'),
  height: element<HTMLInputElement>('#height'),
  tools: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-edit-tool]')),
  createMap: element<HTMLButtonElement>('#create-map'),
  mapSize: element<HTMLOutputElement>('#map-size'),
  placementSideField: element<HTMLLabelElement>('#placement-side-field'),
  placementSide: element<HTMLSelectElement>('#placement-side'),
  placementTypeField: element<HTMLLabelElement>('#placement-type-field'),
  placementType: element<HTMLSelectElement>('#placement-type'),
  selected: element<HTMLSelectElement>('#selected-unit'),
  selectedProperties: element<HTMLDivElement>('#selected-properties'),
  unitEditorTitle: element<HTMLHeadingElement>('#unit-editor-title'),
  details: element<HTMLElement>('#unit-details'),
  selectedType: element<HTMLSelectElement>('#selected-type'),
  selectedSide: element<HTMLSelectElement>('#selected-side'),
  currentHp: element<HTMLOutputElement>('#current-hp'),
  moveDistance: element<HTMLInputElement>('#move-distance'),
  resetMoveDistance: element<HTMLButtonElement>('#reset-move-distance'),
  position: element<HTMLElement>('#position'),
  destination: element<HTMLElement>('#destination'),
  lastAction: element<HTMLElement>('#last-action'),
  point: element<HTMLDivElement>('#point-controls'),
  pickTarget: element<HTMLButtonElement>('#pick-target'),
  clearOrder: element<HTMLButtonElement>('#clear-order'),
  coordinateForm: element<HTMLFormElement>('#coordinate-form'),
  coordinateTitle: element<HTMLHeadingElement>('#coordinate-title'),
  x: element<HTMLInputElement>('#cell-x'),
  y: element<HTMLInputElement>('#cell-y'),
  apply: element<HTMLButtonElement>('#apply-coordinate'),
  orderLimit: element<HTMLElement>('#order-limit'),
  rows: element<HTMLTableSectionElement>('#unit-rows'),
  combatLog: element<HTMLElement>('#combat-log'),
  combatEvents: element<HTMLUListElement>('#combat-events'),
};
const combatInputs: Record<CombatStat, HTMLInputElement> = {
  maxHp: element<HTMLInputElement>('#maxHp'),
  attack: element<HTMLInputElement>('#attack'),
  attackRange: element<HTMLInputElement>('#attackRange'),
};

const editorTabs = createEditorTabs({
  unit: { tab: element<HTMLButtonElement>('#editor-tab-unit'), panel: element<HTMLElement>('#editor-panel-unit') },
  map: { tab: element<HTMLButtonElement>('#editor-tab-map'), panel: element<HTMLElement>('#editor-panel-map') },
});
type EditTool = 'move' | 'add' | 'remove';
let editTool: EditTool = 'move';

function initialBoard(width = DEFAULT_BOARD_SIZE, height = DEFAULT_BOARD_SIZE): BoardState {
  let board = createBoard(width, height);
  const left = Math.floor((width - 3) / 2);
  board = applyAction(board, { type: 'move', unitId: 1, position: { x: left, y: height - 2 } }).state;
  board = applyAction(board, { type: 'move', unitId: 2, position: { x: left + 1, y: height - 2 } }).state;
  board = applyAction(board, { type: 'set-type', unitId: 2, unitType: 'cavalry' }).state;
  board = applyAction(board, { type: 'add', unitType: 'archer', position: { x: left + 2, y: height - 2 } }).state;
  const enemyRow = height >= 4 ? 1 : 0;
  (Object.keys(UNIT_TYPES) as UnitType[]).forEach((unitType, index) => {
    board = applyAction(board, { type: 'add', side: 'enemy', unitType, position: { x: left + index, y: enemyRow } }).state;
  });
  return board;
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
  occupied: '他のユニットで進めず停止',
  cycle: '入れ替え・循環で停止',
};

function setStatus(message = '', error = false): void {
  status = message;
  isError = error;
}

function selectUnit(id: number, preserveTool = false): void {
  const unit = session.board.units.find((item) => item.id === id);
  if (unit === undefined) return;
  selectedId = id;
  if (session.mode === 'edit' && !preserveTool) editTool = 'move';
  editorTabs.select('unit');
  cursor = { ...(session.mode === 'run' ? unit.destination ?? unit.position : unit.position) };
  targeting = false;
  setStatus();
  render();
}

function render(): void {
  const { board, mode } = session;
  const editing = mode === 'edit';
  const adding = editing && editTool === 'add';
  const removing = editing && editTool === 'remove';
  if (!board.units.some((unit) => unit.id === selectedId)) {
    const fallback = board.units[0];
    selectedId = fallback?.id ?? null;
    cursor = { ...(fallback === undefined ? { x: 0, y: 0 }
      : editing ? fallback.position : fallback.destination ?? fallback.position) };
  }
  const unit = board.units.find((item) => item.id === selectedId);
  cursor = { x: Math.min(Math.max(cursor.x, 0), board.width - 1), y: Math.min(Math.max(cursor.y, 0), board.height - 1) };
  controls.edit.setAttribute('aria-pressed', String(editing));
  controls.run.setAttribute('aria-pressed', String(!editing));
  controls.turn.value = `ターン ${board.turn}`;
  controls.orderCount.value = (Object.keys(UNIT_SIDES) as UnitSide[]).map((side) => {
    const units = board.units.filter((item) => item.side === side);
    const used = units.filter((item) => board.orderedUnitIds.includes(item.id)).length;
    return editing ? `${UNIT_SIDES[side].name} ${units.length}体` : `${UNIT_SIDES[side].name} ${used}/${board.rules.orderLimit}`;
  }).join('・');
  if (!editing) controls.orderCount.value = `指示 ${controls.orderCount.value}`;
  controls.editing.hidden = !editing;
  controls.tools.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.editTool === editTool)));
  controls.placementTypeField.hidden = !adding;
  controls.placementSideField.hidden = !adding;
  controls.selected.hidden = adding;
  controls.selectedProperties.hidden = adding || removing;
  controls.unitEditorTitle.textContent = adding ? 'ユニットを追加' : removing ? 'ユニットを削除' : '選択中のユニット';
  controls.details.hidden = editing;
  controls.point.hidden = editing;
  controls.width.disabled = !editing;
  controls.height.disabled = !editing;
  controls.createMap.hidden = !editing;
  controls.mapSize.value = `${board.width} × ${board.height}`;
  controls.advance.disabled = editing;
  controls.undo.disabled = editing || session.history.length === 0;
  controls.pickTarget.disabled = unit === undefined;
  controls.clearOrder.disabled = unit === undefined;
  controls.pickTarget.textContent = targeting ? '指定を取り消す' : '目的地を指定';
  controls.pickTarget.setAttribute('aria-pressed', String(targeting));
  const unitValues = board.units.length === 0 ? [''] : board.units.map((item) => String(item.id));
  if (controls.selected.options.length !== unitValues.length || unitValues.some((value, index) => controls.selected.options[index]?.value !== value)) {
    controls.selected.replaceChildren();
    for (const item of board.units) controls.selected.add(new Option(unitLabel(item.id), String(item.id)));
    if (selectedId === null) controls.selected.add(new Option('ユニットなし', ''));
  }
  controls.selected.value = selectedId === null ? '' : String(selectedId);
  controls.selected.disabled = unit === undefined;
  controls.selectedType.value = unit?.type ?? '';
  controls.selectedType.disabled = !editing || unit === undefined;
  controls.selectedSide.value = unit?.side ?? '';
  controls.selectedSide.disabled = !editing || unit === undefined;
  controls.currentHp.value = unit === undefined ? '—' : `${unit.hp} / ${unit.maxHp}`;
  for (const stat of Object.keys(combatInputs) as CombatStat[]) {
    combatInputs[stat].value = unit === undefined ? '' : String(unit[stat]);
    combatInputs[stat].disabled = !editing || unit === undefined;
  }
  controls.moveDistance.value = unit === undefined ? '' : String(unit.moveDistance);
  controls.moveDistance.disabled = !editing || unit === undefined;
  controls.resetMoveDistance.hidden = !editing;
  controls.resetMoveDistance.disabled = unit === undefined;
  controls.position.textContent = unit === undefined ? '—' : formatCell(unit.position);
  controls.destination.textContent = unit === undefined ? '—' : formatCell(unit.destination);
  const event = session.events.find((item) => item.unitId === selectedId);
  controls.lastAction.textContent = event === undefined ? '—' : eventLabels[event.reason];
  controls.orderLimit.textContent = `${board.rules.orderLimit}体 / 陣営 / ターン`;
  controls.x.max = String(board.width);
  controls.y.max = String(board.height);
  controls.x.value = String(cursor.x + 1);
  controls.y.value = String(cursor.y + 1);
  controls.coordinateTitle.textContent = editing ? removing ? '削除する位置' : '配置位置' : '目的地';
  controls.apply.textContent = editing ? { move: 'ユニットを移動', add: 'ユニットを追加', remove: 'ユニットを削除' }[editTool] : '目的地を指示';
  controls.apply.disabled = unit === undefined && (!editing || editTool === 'move');
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
      select.setAttribute('aria-label', `ユニット ${unitLabel(item.id)} を選択`);
      select.addEventListener('click', () => selectUnit(item.id));
      row.insertCell().append(select);
      row.insertCell(); row.insertCell(); row.insertCell(); row.insertCell();
    }
    row.querySelector('button')?.setAttribute('aria-pressed', String(item.id === selectedId));
    row.cells[1]!.textContent = UNIT_SIDES[item.side].name;
    row.cells[2]!.textContent = UNIT_TYPES[item.type].name;
    row.cells[3]!.textContent = `${item.hp}/${item.maxHp}`;
    row.cells[4]!.textContent = `${item.moveDistance}マス`;
    if (controls.rows.rows[index] !== row) controls.rows.insertBefore(row, controls.rows.rows[index] ?? null);
    rows.delete(item.id);
  });
  rows.forEach((row) => row.remove());
  controls.combatLog.hidden = session.combatEvents.length === 0;
  const entries = session.combatEvents.map((event) => {
    const entry = document.createElement('li');
    entry.textContent = `${unitLabel(event.attackerId)} → ${unitLabel(event.targetId)}：${event.damage}ダメージ`;
    return entry;
  });
  const defeated = [...new Set(session.combatEvents.filter((event) => event.defeated).map((event) => event.targetId))];
  if (defeated.length > 0) {
    const entry = document.createElement('li');
    entry.textContent = `撃破：${defeated.map(unitLabel).join('・')}`;
    entries.push(entry);
  }
  controls.combatEvents.replaceChildren(...entries);
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
    const attacks = session.combatEvents.length;
    const defeated = new Set(session.combatEvents.filter((event) => event.defeated).map((event) => event.targetId)).size;
    setStatus(`${moved}体移動${blocked > 0 ? `・${blocked}体停止` : ''}・${attacks}回攻撃${defeated > 0 ? `・${defeated}体撃破` : ''}`);
  } else if (action.type === 'order') {
    targeting = false;
    setStatus(`ユニット ${unitLabel(action.unitId)}：${action.destination === null ? '指示を解除' : `目的地 ${formatCell(action.destination)}`}`);
  } else {
    setStatus();
  }
  render();
  return true;
}

function applyAt(position: Cell): void {
  cursor = position;
  if (session.mode === 'run') {
    if (selectedId === null) { setStatus('ユニットを選んでください。', true); render(); return; }
    perform({ type: 'order', unitId: selectedId, destination: position });
    return;
  }
  if (editTool === 'add') {
    perform({ type: 'add', position, unitType: controls.placementType.value as UnitType, side: controls.placementSide.value as UnitSide });
  } else if (editTool === 'remove') {
    const occupant = session.board.units.find((unit) => unit.position.x === position.x && unit.position.y === position.y);
    if (occupant === undefined) { setStatus('そのマスにユニットがありません。', true); render(); return; }
    perform({ type: 'remove', unitId: occupant.id });
  } else if (selectedId !== null) {
    perform({ type: 'move', unitId: selectedId, position });
  } else {
    setStatus('ユニットを選んでください。', true); render();
  }
}

function clickCell(cell: Cell): void {
  const occupant = session.board.units.find((unit) => unit.position.x === cell.x && unit.position.y === cell.y);
  if (occupant !== undefined && !targeting && (session.mode === 'run' || editTool === 'move')) {
    selectUnit(occupant.id);
  } else {
    applyAt(cell);
  }
}

controls.edit.addEventListener('click', () => {
  if (session.mode === 'edit') return;
  session = editExperiment(session);
  editTool = 'move';
  const unit = session.board.units.find((item) => item.id === selectedId);
  cursor = { ...(unit?.position ?? { x: 0, y: 0 }) };
  targeting = false;
  setStatus(); render();
});
controls.run.addEventListener('click', () => {
  if (session.mode === 'run') return;
  session = startExperiment(session);
  editorTabs.select('unit');
  controls.width.value = String(session.board.width);
  controls.height.value = String(session.board.height);
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
controls.tools.forEach((button) => button.addEventListener('click', () => {
  editTool = button.dataset.editTool as EditTool;
  const unit = session.board.units.find((item) => item.id === selectedId);
  if (unit !== undefined) cursor = { ...unit.position };
  setStatus(); render();
}));
function rememberCoordinates(): void {
  const x = controls.x.valueAsNumber - 1;
  const y = controls.y.valueAsNumber - 1;
  if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < session.board.width && y < session.board.height) {
    cursor = { x, y };
  }
}
controls.x.addEventListener('input', rememberCoordinates);
controls.y.addEventListener('input', rememberCoordinates);
controls.selected.addEventListener('change', () => selectUnit(Number(controls.selected.value), true));
controls.selectedType.addEventListener('change', () => {
  if (selectedId !== null) perform({ type: 'set-type', unitId: selectedId, unitType: controls.selectedType.value as UnitType });
});
controls.selectedSide.addEventListener('change', () => {
  if (selectedId !== null) perform({ type: 'set-side', unitId: selectedId, side: controls.selectedSide.value as UnitSide });
});
for (const stat of Object.keys(combatInputs) as CombatStat[]) {
  combatInputs[stat].addEventListener('change', () => {
    if (selectedId !== null) perform({ type: 'set-combat-stat', unitId: selectedId, stat, value: combatInputs[stat].valueAsNumber });
  });
}
controls.moveDistance.addEventListener('change', () => {
  if (selectedId !== null) perform({ type: 'set-move-distance', unitId: selectedId, moveDistance: controls.moveDistance.valueAsNumber });
});
controls.resetMoveDistance.addEventListener('click', () => {
  if (selectedId !== null) perform({ type: 'reset-move-distance', unitId: selectedId });
});
controls.coordinateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applyAt({ x: controls.x.valueAsNumber - 1, y: controls.y.valueAsNumber - 1 });
});
controls.pickTarget.addEventListener('click', () => {
  targeting = !targeting;
  setStatus(targeting && selectedId !== null ? `ユニット ${unitLabel(selectedId)} の目的地を選択` : '');
  render();
});
controls.clearOrder.addEventListener('click', () => {
  if (selectedId !== null) perform({ type: 'order', unitId: selectedId, destination: null });
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
    editorTabs.destroy();
    shell.destroy();
  });
}
