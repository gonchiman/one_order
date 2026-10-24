import './style.css';
import { createGame } from './game/createGame';
import type { BoardViewportSnapshot } from './game/createGame';
import { RANGE_COLORS } from './game/scenes/BoardScene';
import { DEFAULT_BOARD_SIZE, MIN_BOARD_SIZE, MAX_BOARD_SIZE, MIN_TURN_LIMIT, MAX_TURN_LIMIT, prioritySideForTurn, validateMatchSetup } from './core/board';
import type { BoardAction, Cell, UnitEvent } from './core/board';
import { createMatchScenario } from './core/scenario';
import { unitLabel } from './core/labels';
import { COMBAT_STAT_LIMITS, MAX_MOVE_DISTANCE, MIN_MOVE_DISTANCE, MAX_MOVE_PRIORITY, MIN_MOVE_PRIORITY, UNIT_SIDES, UNIT_TYPES } from './core/unitTypes';
import type { CombatStat, UnitSide, UnitType } from './core/unitTypes';
import { createAppShell } from './ui/appShell';
import { createEditorTabs } from './ui/editorTabs';
import {
  actOnSession,
  createSession,
  editExperiment,
  isInitialOrderPhase,
  resetExperiment,
  startExperiment,
  undoTurn,
} from './core/session';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) throw new Error('画面の配置先がありません。');
const shell = createAppShell(app);
for (const [name, color] of Object.entries(RANGE_COLORS)) {
  shell.content.style.setProperty(`--range-${name}`, `#${color.toString(16).padStart(6, '0')}`);
}
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
    <button type="button" id="run-mode" aria-pressed="false">対戦開始</button>
    <div class="counters"><output id="turn"></output><output id="priority-side"></output><output id="order-count"></output></div>
  </nav>
  <div class="workspace">
    <section class="board-section" aria-label="盤面とユニット一覧">
      <div class="viewport-toolbar" role="group" aria-label="盤面の表示">
        <button type="button" id="zoom-out" aria-label="縮小">−</button>
        <output id="zoom-level" aria-label="表示倍率">100%</output>
        <button type="button" id="zoom-in" aria-label="拡大">＋</button>
        <button type="button" id="fit-board">全体表示</button>
        <button type="button" id="focus-unit">選択へ</button>
        <button type="button" id="pan-board" aria-pressed="false">表示移動</button>
      </div>
      <div id="board"></div>
      <output id="visible-cells" class="visible-cells" aria-label="表示中の座標"></output>
      <div id="range-legend" class="range-legend" aria-label="範囲の表示" hidden>
        <span><i class="range-swatch range-movement" aria-hidden="true"></i>1ターンの移動範囲（目安）</span>
        <span><i class="range-swatch range-attack" aria-hidden="true"></i>現在地からの攻撃射程</span>
      </div>
      <section id="match-result" class="match-result" aria-live="polite" hidden><h2 id="result-title"></h2><output id="result-reason"></output></section>
      <div class="turn-actions">
        <button type="button" id="advance">1ターン進める</button>
        <button type="button" id="undo">1ターン戻す</button>
        <button type="button" id="clear-orders">全指示をリセット</button>
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
          <h2 id="placement-heading">配置・初期指示</h2>
          <div class="placement-tools" role="group" aria-label="配置・初期指示の操作">
            <button type="button" data-edit-tool="move" aria-pressed="true">選択・移動</button>
            <button type="button" data-edit-tool="order" aria-pressed="false">初期指示</button>
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
            <label class="editor-field"><span>移動優先度</span><input id="move-priority" type="number" min="${MIN_MOVE_PRIORITY}" max="${MAX_MOVE_PRIORITY}" step="1" required></label>
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
            <label>幅（マス） <input id="width" type="number" min="${MIN_BOARD_SIZE}" max="${MAX_BOARD_SIZE}" step="1" value="${DEFAULT_BOARD_SIZE}" required></label>
            <label>高さ（マス） <input id="height" type="number" min="${MIN_BOARD_SIZE}" max="${MAX_BOARD_SIZE}" step="1" value="${DEFAULT_BOARD_SIZE}" required></label>
          </div>
          <button type="submit" id="create-map">新しいマップを作成</button>
        </form>
        <section class="editor-section" aria-labelledby="terrain-heading">
          <h2 id="terrain-heading">地形・陣地</h2>
          <form id="map-cell-form" class="fields">
            <label class="editor-field"><span>配置するもの</span><select id="map-tool"><option value="wall">壁</option><option value="clear">平地</option><option value="ally-goal">P1陣地</option><option value="enemy-goal">P2陣地</option></select></label>
            <div class="input-pair"><label>X <input id="map-x" type="number" min="1" max="${DEFAULT_BOARD_SIZE}" value="1" required></label><label>Y <input id="map-y" type="number" min="1" max="${DEFAULT_BOARD_SIZE}" value="1" required></label></div>
            <button type="submit" id="apply-map-cell">配置</button>
            <button type="button" id="pick-map-cell" aria-pressed="false">盤面で配置</button>
          </form>
          <dl><dt>P1陣地</dt><dd id="ally-goal-position"></dd><dt>P2陣地</dt><dd id="enemy-goal-position"></dd><dt>壁</dt><dd id="wall-count"></dd></dl>
        </section>
        <section aria-labelledby="match-rules-heading">
          <h2 id="match-rules-heading">対戦ルール</h2>
          <label class="editor-field"><span>勝利条件</span><select id="match-enabled"><option value="true">相手陣地への到達／全滅</option><option value="false">勝敗なし</option></select></label>
          <label class="editor-field"><span>初回優先権</span><select id="first-priority">${sideOptions}</select></label>
          <label class="editor-field"><span>上限ターン</span><input id="turn-limit" type="number" min="${MIN_TURN_LIMIT}" max="${MAX_TURN_LIMIT}" required></label>
        </section>
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
  zoomOut: element<HTMLButtonElement>('#zoom-out'),
  zoomIn: element<HTMLButtonElement>('#zoom-in'),
  zoomLevel: element<HTMLOutputElement>('#zoom-level'),
  fitBoard: element<HTMLButtonElement>('#fit-board'),
  focusUnit: element<HTMLButtonElement>('#focus-unit'),
  panBoard: element<HTMLButtonElement>('#pan-board'),
  visibleCells: element<HTMLOutputElement>('#visible-cells'),
  rangeLegend: element<HTMLDivElement>('#range-legend'),
  edit: element<HTMLButtonElement>('#edit-mode'),
  run: element<HTMLButtonElement>('#run-mode'),
  turn: element<HTMLOutputElement>('#turn'),
  prioritySide: element<HTMLOutputElement>('#priority-side'),
  matchResult: element<HTMLElement>('#match-result'),
  resultTitle: element<HTMLHeadingElement>('#result-title'),
  resultReason: element<HTMLOutputElement>('#result-reason'),
  orderCount: element<HTMLOutputElement>('#order-count'),
  advance: element<HTMLButtonElement>('#advance'),
  undo: element<HTMLButtonElement>('#undo'),
  clearOrders: element<HTMLButtonElement>('#clear-orders'),
  reset: element<HTMLButtonElement>('#reset'),
  status: element<HTMLParagraphElement>('#status'),
  editing: element<HTMLElement>('#editing-controls'),
  sizeForm: element<HTMLFormElement>('#size-form'),
  width: element<HTMLInputElement>('#width'),
  height: element<HTMLInputElement>('#height'),
  tools: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-edit-tool]')),
  createMap: element<HTMLButtonElement>('#create-map'),
  mapSize: element<HTMLOutputElement>('#map-size'),
  mapCellForm: element<HTMLFormElement>('#map-cell-form'),
  mapTool: element<HTMLSelectElement>('#map-tool'),
  mapX: element<HTMLInputElement>('#map-x'),
  mapY: element<HTMLInputElement>('#map-y'),
  applyMapCell: element<HTMLButtonElement>('#apply-map-cell'),
  pickMapCell: element<HTMLButtonElement>('#pick-map-cell'),
  allyGoal: element<HTMLElement>('#ally-goal-position'),
  enemyGoal: element<HTMLElement>('#enemy-goal-position'),
  wallCount: element<HTMLElement>('#wall-count'),
  matchEnabled: element<HTMLSelectElement>('#match-enabled'),
  firstPriority: element<HTMLSelectElement>('#first-priority'),
  turnLimit: element<HTMLInputElement>('#turn-limit'),
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
  movePriority: element<HTMLInputElement>('#move-priority'),
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
type EditTool = 'move' | 'order' | 'add' | 'remove';
let editTool: EditTool = 'move';

let session = createSession(createMatchScenario());
let selectedId: number | null = session.board.units[0]?.id ?? null;
let cursor: Cell = { ...session.board.units[0]!.position };
let targeting = false;
let mapPainting = false;
let status = '';
let isError = false;
let boardGame: ReturnType<typeof createGame> | undefined;

function renderViewport(view: BoardViewportSnapshot): void {
  controls.zoomLevel.value = `${Math.round(view.zoom * 100)}%`;
  controls.zoomIn.disabled = !view.canZoomIn;
  controls.zoomOut.disabled = !view.canZoomOut;
  controls.panBoard.setAttribute('aria-pressed', String(view.isPanning));
  const bounds = view.visible;
  controls.visibleCells.value = bounds === null ? ''
    : `X ${bounds.minX + 1}–${bounds.maxX + 1} / Y ${bounds.minY + 1}–${bounds.maxY + 1}`;
}

const formatCell = (cell: Cell | null): string => cell === null ? '—' : `(${cell.x + 1}, ${cell.y + 1})`;
const eventLabels: Record<UnitEvent['reason'], string> = {
  moved: '移動',
  'no-order': '指示なし',
  arrived: '目的地に到着',
  conflict: '移動先が競合して停止',
  occupied: '他のユニットで進めず停止',
  cycle: '入れ替え・循環で停止',
  'no-path': '目的地への経路なし',
};

function setStatus(message = '', error = false): void {
  status = message;
  isError = error;
}

function isOrderMode(): boolean {
  return session.mode === 'run' || editTool === 'order';
}

function selectUnit(id: number | null, preserveTool = false): void {
  const unit = session.board.units.find((item) => item.id === id);
  if (id !== null && unit === undefined) return;
  selectedId = id;
  if (session.mode === 'edit' && !preserveTool && editTool !== 'order') editTool = 'move';
  editorTabs.select('unit');
  if (unit !== undefined) {
    cursor = { ...(isOrderMode() ? unit.destination ?? unit.position : unit.position) };
  }
  targeting = false;
  mapPainting = false;
  setStatus();
  render();
}

function render(): void {
  const { board, mode } = session;
  const editing = mode === 'edit';
  const ordering = isOrderMode();
  const initialOrders = isInitialOrderPhase(session);
  const ended = board.outcome !== null;
  const adding = editing && editTool === 'add';
  const removing = editing && editTool === 'remove';
  if (selectedId !== null && !board.units.some((unit) => unit.id === selectedId)) {
    const fallback = board.units[0];
    selectedId = fallback?.id ?? null;
    cursor = { ...(fallback === undefined ? { x: 0, y: 0 }
      : ordering ? fallback.destination ?? fallback.position : fallback.position) };
  }
  const unit = board.units.find((item) => item.id === selectedId);
  controls.rangeLegend.hidden = unit === undefined;
  controls.focusUnit.disabled = unit === undefined;
  cursor = { x: Math.min(Math.max(cursor.x, 0), board.width - 1), y: Math.min(Math.max(cursor.y, 0), board.height - 1) };
  controls.edit.setAttribute('aria-pressed', String(editing));
  controls.run.setAttribute('aria-pressed', String(!editing));
  controls.turn.value = board.rules.matchEnabled ? `ターン ${board.turn} / ${board.rules.turnLimit}` : `ターン ${board.turn}`;
  controls.prioritySide.value = `${editing ? '初回' : '次ターンの'}優先権 ${UNIT_SIDES[prioritySideForTurn(board)].name}`;
  controls.prioritySide.hidden = ended;
  controls.run.textContent = editing ? '対戦開始' : ended ? '対戦終了' : '対戦中';
  controls.run.disabled = !editing;
  controls.reset.textContent = ended ? '同じ配置で再戦' : '開始配置に戻す';
  controls.matchResult.hidden = !ended;
  if (board.outcome !== null) {
    controls.resultTitle.textContent = board.outcome.winner === null ? '引き分け' : `${UNIT_SIDES[board.outcome.winner].name} の勝利`;
    controls.resultReason.value = { goal: '相手陣地へ到達', elimination: '相手ユニットが全滅', simultaneous: '両陣営が同時に勝利条件を達成', 'turn-limit': '上限ターンに到達' }[board.outcome.reason];
  }
  controls.orderCount.value = (Object.keys(UNIT_SIDES) as UnitSide[]).map((side) => {
    const units = board.units.filter((item) => item.side === side);
    const used = units.filter((item) => board.orderedUnitIds.includes(item.id)).length;
    return editing ? `${UNIT_SIDES[side].name} ${units.length}体` : `${UNIT_SIDES[side].name} ${used}/${board.rules.orderLimit}`;
  }).join('・');
  if (initialOrders) controls.orderCount.value = '初期指示（無制限）';
  else if (!editing) controls.orderCount.value = `指示 ${controls.orderCount.value}`;
  controls.editing.hidden = !editing;
  controls.tools.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.editTool === editTool)));
  controls.placementTypeField.hidden = !adding;
  controls.placementSideField.hidden = !adding;
  controls.selected.hidden = adding;
  controls.selectedProperties.hidden = adding || removing;
  controls.unitEditorTitle.textContent = adding ? 'ユニットを追加' : removing ? 'ユニットを削除' : '選択中のユニット';
  controls.details.hidden = !ordering;
  controls.point.hidden = !ordering;
  controls.width.disabled = !editing;
  controls.height.disabled = !editing;
  controls.createMap.hidden = !editing;
  controls.mapSize.value = `${board.width} × ${board.height}`;
  controls.advance.disabled = editing || ended;
  controls.undo.disabled = editing || session.history.length === 0;
  controls.clearOrders.disabled = ended || (!board.units.some((item) => item.destination !== null) && board.orderedUnitIds.length === 0);
  controls.pickTarget.disabled = unit === undefined || ended;
  controls.clearOrder.disabled = unit === undefined || ended;
  controls.clearOrder.textContent = editing || initialOrders ? '初期指示を解除' : '指示を解除';
  controls.pickTarget.textContent = targeting ? '指定を取り消す' : '目的地を指定';
  controls.pickTarget.setAttribute('aria-pressed', String(targeting));
  const unitValues = ['', ...board.units.map((item) => String(item.id))];
  if (controls.selected.options.length !== unitValues.length || unitValues.some((value, index) => controls.selected.options[index]?.value !== value)) {
    controls.selected.replaceChildren(new Option('選択なし', ''));
    for (const item of board.units) controls.selected.add(new Option(unitLabel(item.id), String(item.id)));
  }
  controls.selected.value = selectedId === null ? '' : String(selectedId);
  controls.selected.disabled = board.units.length === 0;
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
  controls.movePriority.value = unit === undefined ? '' : String(unit.movePriority);
  controls.movePriority.disabled = !editing || unit === undefined;
  controls.resetMoveDistance.hidden = !editing;
  controls.resetMoveDistance.disabled = unit === undefined;
  controls.position.textContent = unit === undefined ? '—' : formatCell(unit.position);
  controls.destination.textContent = unit === undefined ? '—' : formatCell(unit.destination);
  const event = session.events.find((item) => item.unitId === selectedId);
  controls.lastAction.textContent = event === undefined ? '—' : eventLabels[event.reason];
  controls.orderLimit.textContent = editing || initialOrders ? '無制限' : `${board.rules.orderLimit}体 / 陣営 / ターン`;
  controls.x.max = String(board.width);
  controls.y.max = String(board.height);
  controls.x.value = String(cursor.x + 1);
  controls.y.value = String(cursor.y + 1);
  controls.coordinateTitle.textContent = ordering ? editing || initialOrders ? '初期目的地' : '目的地' : removing ? '削除する位置' : '配置位置';
  controls.apply.textContent = editing ? { move: 'ユニットを移動', order: '初期指示を設定', add: 'ユニットを追加', remove: 'ユニットを削除' }[editTool] : initialOrders ? '初期指示を設定' : '目的地を指示';
  controls.apply.disabled = ended || (unit === undefined && (ordering || editTool === 'move'));
  controls.x.disabled = ended;
  controls.y.disabled = ended;
  controls.allyGoal.textContent = formatCell(board.goals.ally);
  controls.enemyGoal.textContent = formatCell(board.goals.enemy);
  controls.wallCount.textContent = `${board.walls.length}マス`;
  controls.mapX.max = String(board.width);
  controls.mapY.max = String(board.height);
  controls.matchEnabled.value = String(board.rules.matchEnabled);
  controls.firstPriority.value = board.rules.firstPrioritySide;
  controls.turnLimit.value = String(board.rules.turnLimit);
  [controls.mapTool, controls.mapX, controls.mapY, controls.applyMapCell, controls.pickMapCell, controls.matchEnabled, controls.firstPriority, controls.turnLimit].forEach((input) => { input.disabled = !editing; });
  controls.pickMapCell.setAttribute('aria-pressed', String(mapPainting));
  controls.pickMapCell.textContent = mapPainting ? '盤面での配置を終了' : '盤面で配置';
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
      select.addEventListener('click', () => selectUnit(selectedId === item.id ? null : item.id));
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
  boardGame?.render({ board, selectedUnitId: selectedId, targeting: targeting || mapPainting });
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
    const blocked = session.events.filter((event) => ['conflict', 'occupied', 'cycle', 'no-path'].includes(event.reason)).length;
    const attacks = session.combatEvents.length;
    const defeated = new Set(session.combatEvents.filter((event) => event.defeated).map((event) => event.targetId)).size;
    setStatus(`${moved}体移動${blocked > 0 ? `・${blocked}体停止` : ''}・${attacks}回攻撃${defeated > 0 ? `・${defeated}体撃破` : ''}`);
  } else if (action.type === 'clear-orders') {
    targeting = false;
    mapPainting = false;
    const unit = session.board.units.find((item) => item.id === selectedId);
    if (unit !== undefined) cursor = { ...unit.position };
    setStatus('全ユニットの指示をリセットしました。');
  } else if (action.type === 'order' || action.type === 'set-initial-order') {
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
  if (isOrderMode()) {
    if (selectedId === null) { setStatus('ユニットを選んでください。', true); render(); return; }
    perform({ type: session.mode === 'edit' ? 'set-initial-order' : 'order', unitId: selectedId, destination: position });
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

function placeMapCell(position: Cell): void {
  const tool = controls.mapTool.value;
  const action: BoardAction = tool === 'ally-goal' || tool === 'enemy-goal'
    ? { type: 'set-goal', side: tool === 'ally-goal' ? 'ally' : 'enemy', position }
    : { type: 'set-wall', position, blocked: tool === 'wall' };
  if (perform(action)) {
    controls.mapX.value = String(position.x + 1);
    controls.mapY.value = String(position.y + 1);
  }
}

function clickCell(cell: Cell): void {
  if (session.mode === 'edit' && mapPainting) { placeMapCell(cell); return; }
  const occupant = session.board.units.find((unit) => unit.position.x === cell.x && unit.position.y === cell.y);
  if (occupant !== undefined && !targeting && (isOrderMode() || editTool === 'move')) {
    selectUnit(selectedId === occupant.id ? null : occupant.id);
  } else {
    applyAt(cell);
  }
}

controls.zoomIn.addEventListener('click', () => boardGame?.zoomIn());
controls.zoomOut.addEventListener('click', () => boardGame?.zoomOut());
controls.fitBoard.addEventListener('click', () => boardGame?.fit());
controls.focusUnit.addEventListener('click', () => boardGame?.focusSelected());
controls.panBoard.addEventListener('click', () => {
  boardGame?.setPanning(controls.panBoard.getAttribute('aria-pressed') !== 'true');
});
controls.panBoard.addEventListener('keydown', (event) => {
  if (controls.panBoard.getAttribute('aria-pressed') !== 'true') return;
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  const direction = directions[event.key];
  if (direction === undefined) return;
  event.preventDefault();
  boardGame?.panByCells(...direction);
});

controls.edit.addEventListener('click', () => {
  if (session.mode === 'edit') return;
  session = editExperiment(session);
  editTool = 'move';
  const unit = session.board.units.find((item) => item.id === selectedId);
  cursor = { ...(unit?.position ?? { x: 0, y: 0 }) };
  targeting = false;
  mapPainting = false;
  setStatus(); render();
});
controls.run.addEventListener('click', () => {
  if (session.mode === 'run') return;
  const setupError = validateMatchSetup(session.board);
  if (setupError !== null) { setStatus(setupError, true); render(); return; }
  try { session = startExperiment(session); } catch (error) {
    setStatus(error instanceof Error ? error.message : '対戦の開始設定を確認してください。', true); render(); return;
  }
  const unit = session.board.units.find((item) => item.id === selectedId);
  if (unit !== undefined) cursor = { ...(unit.destination ?? unit.position) };
  editorTabs.select('unit');
  controls.width.value = String(session.board.width);
  controls.height.value = String(session.board.height);
  targeting = false;
  mapPainting = false;
  setStatus(); render();
});
controls.sizeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    session = createSession(createMatchScenario(controls.width.valueAsNumber, controls.height.valueAsNumber));
    selectedId = session.board.units[0]?.id ?? null;
    cursor = { ...session.board.units[0]!.position };
    targeting = false;
    mapPainting = false;
    controls.mapX.value = '1';
    controls.mapY.value = '1';
    setStatus(); render();
    boardGame?.setPanning(false);
    boardGame?.fit();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '盤面の寸法を確認してください。', true); render();
  }
});
controls.tools.forEach((button) => button.addEventListener('click', () => {
  mapPainting = false;
  targeting = false;
  editTool = button.dataset.editTool as EditTool;
  const unit = session.board.units.find((item) => item.id === selectedId);
  if (unit !== undefined) cursor = { ...(isOrderMode() ? unit.destination ?? unit.position : unit.position) };
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
controls.selected.addEventListener('change', () => selectUnit(controls.selected.value === '' ? null : Number(controls.selected.value), true));
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
controls.movePriority.addEventListener('change', () => {
  if (selectedId !== null) perform({ type: 'set-move-priority', unitId: selectedId, movePriority: controls.movePriority.valueAsNumber });
});
controls.mapCellForm.addEventListener('submit', (event) => {
  event.preventDefault();
  placeMapCell({ x: controls.mapX.valueAsNumber - 1, y: controls.mapY.valueAsNumber - 1 });
});
controls.pickMapCell.addEventListener('click', () => {
  mapPainting = !mapPainting;
  targeting = false;
  setStatus(); render();
});
element<HTMLButtonElement>('#editor-tab-unit').addEventListener('click', () => {
  mapPainting = false;
  render();
});
element<HTMLButtonElement>('#editor-tab-unit').addEventListener('focus', () => {
  if (mapPainting) { mapPainting = false; render(); }
});
controls.matchEnabled.addEventListener('change', () => perform({ type: 'set-match-rules', matchEnabled: controls.matchEnabled.value === 'true' }));
controls.firstPriority.addEventListener('change', () => perform({ type: 'set-match-rules', firstPrioritySide: controls.firstPriority.value as UnitSide }));
controls.turnLimit.addEventListener('change', () => perform({ type: 'set-match-rules', turnLimit: controls.turnLimit.valueAsNumber }));
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
  if (selectedId !== null) perform({ type: session.mode === 'edit' ? 'set-initial-order' : 'order', unitId: selectedId, destination: null });
});
controls.clearOrders.addEventListener('click', () => perform({ type: 'clear-orders' }));
controls.advance.addEventListener('click', () => { targeting = false; perform({ type: 'advance' }); });
controls.undo.addEventListener('click', () => {
  session = undoTurn(session); targeting = false; setStatus(); render();
});
controls.reset.addEventListener('click', () => {
  session = resetExperiment(session);
  const unit = session.board.units[0];
  selectedId = unit?.id ?? null;
  cursor = { ...(unit === undefined ? { x: 0, y: 0 } : isOrderMode() ? unit.destination ?? unit.position : unit.position) };
  controls.width.value = String(session.board.width);
  controls.height.value = String(session.board.height);
  targeting = false; mapPainting = false; setStatus(); render();
});

render();
boardGame = createGame('board', { board: session.board, selectedUnitId: selectedId, targeting }, clickCell, renderViewport);

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    boardGame?.destroy();
    editorTabs.destroy();
    shell.destroy();
  });
}
