import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';

export function createGame(parent: string): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#ffffff',
    scale: {
      mode: Phaser.Scale.RESIZE,
    },
    scene: [BootScene],
  });
}
