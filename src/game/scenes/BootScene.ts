import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.add.text(16, 16, '開発環境が起動しました', {
      fontFamily: 'sans-serif',
      fontSize: '16px',
      color: '#000000',
    });

    this.game.canvas.setAttribute('role', 'img');
    this.game.canvas.setAttribute('aria-label', '開発環境が起動しました');
  }
}
