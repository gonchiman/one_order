import Phaser from 'phaser';
import type { Cell } from '../core/board';
import { BoardScene } from './scenes/BoardScene';
import type { BoardView } from './scenes/BoardScene';
import type { BoardViewportSnapshot } from './boardViewport';

export type { BoardView } from './scenes/BoardScene';
export type { BoardViewportSnapshot } from './boardViewport';

export interface BoardGame {
  game: Phaser.Game;
  render: (view: BoardView) => void;
  destroy: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  focusSelected: () => void;
  setPanning: (enabled: boolean) => void;
  panByCells: (dx: number, dy: number) => void;
}

export function createGame(
  parent: string,
  initialView: BoardView,
  onCellClick: (cell: Cell) => void,
  onViewportChange?: (snapshot: BoardViewportSnapshot) => void,
): BoardGame {
  const element = document.getElementById(parent);
  if (element === null) throw new Error(`盤面の表示先がありません: ${parent}`);

  const scene = new BoardScene(initialView, onCellClick, onViewportChange);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#ffffff',
    width: Math.max(1, element.clientWidth),
    height: Math.max(1, element.clientHeight),
    scale: {
      mode: Phaser.Scale.NONE,
    },
    scene: [scene],
  });

  let destroyed = false;
  const resize = (): void => {
    if (destroyed || !game.isBooted) return;
    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
    if (width !== game.scale.width || height !== game.scale.height) {
      game.scale.resize(width, height);
    }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  game.events.once(Phaser.Core.Events.READY, resize);

  return {
    game,
    zoomIn: () => { if (!destroyed) scene.zoomIn(); },
    zoomOut: () => { if (!destroyed) scene.zoomOut(); },
    fit: () => { if (!destroyed) scene.fit(); },
    focusSelected: () => { if (!destroyed) scene.focusSelected(); },
    setPanning: (enabled) => { if (!destroyed) scene.setPanning(enabled); },
    panByCells: (dx, dy) => { if (!destroyed) scene.panByCells(dx, dy); },
    render: (view) => {
      if (destroyed) return;
      scene.setView(view);
      resize();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      game.events.off(Phaser.Core.Events.READY, resize);
      game.destroy(true);
    },
  };
}
