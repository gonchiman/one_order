import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    this.add.rectangle(centerX, centerY - 62, 12, 12, 0x66cee9);

    this.add.text(centerX, centerY - 12, 'ONE ORDER', {
      fontFamily: 'Consolas, monospace',
      fontSize: '36px',
      color: '#eeeee6',
    }).setOrigin(0.5);

    this.add.text(centerX, centerY + 42, '開発環境が起動しました', {
      fontFamily: '"Yu Gothic UI", sans-serif',
      fontSize: '16px',
      color: '#929c9f',
    }).setOrigin(0.5);

    this.game.canvas.setAttribute('role', 'img');
    this.game.canvas.setAttribute('aria-label', 'ONE ORDER 開発環境が起動しました');
  }
}
