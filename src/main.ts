import './style.css';
import { createGame } from './game/createGame';

const game = createGame('app');

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    game.destroy(true);
  });
}
