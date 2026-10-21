export interface AppShell {
  content: HTMLElement;
  destroy: () => void;
}

export function createAppShell(root: HTMLElement): AppShell {
  root.innerHTML = `
    <a class="skip-link" href="#experiment-board">本文へ移動</a>
    <header class="app-header">
      <button type="button" id="menu-toggle" aria-controls="app-sidebar" aria-expanded="true">メニュー</button>
      <a class="app-name" href="#experiment-board">ONE ORDER</a>
    </header>
    <div class="app-body">
      <aside class="app-sidebar" id="app-sidebar">
        <nav aria-label="ページ">
          <a href="#experiment-board" aria-current="page">実験盤</a>
        </nav>
      </aside>
      <main class="page-content" id="experiment-board" aria-label="実験盤"></main>
    </div>
  `;

  const content = root.querySelector<HTMLElement>('.page-content');
  const sidebar = root.querySelector<HTMLElement>('#app-sidebar');
  const toggle = root.querySelector<HTMLButtonElement>('#menu-toggle');
  if (content === null || sidebar === null || toggle === null) throw new Error('画面の構成要素がありません。');

  const narrow = window.matchMedia('(max-width: 760px)');
  let expanded = !narrow.matches;
  function renderMenu(): void {
    sidebar!.hidden = !expanded;
    toggle!.setAttribute('aria-expanded', String(expanded));
    root.classList.toggle('sidebar-collapsed', !expanded);
  }
  const toggleMenu = (): void => { expanded = !expanded; renderMenu(); };
  const resizeMenu = (): void => { expanded = !narrow.matches; renderMenu(); };
  toggle.addEventListener('click', toggleMenu);
  narrow.addEventListener('change', resizeMenu);
  renderMenu();

  return {
    content,
    destroy: () => {
      toggle.removeEventListener('click', toggleMenu);
      narrow.removeEventListener('change', resizeMenu);
      root.classList.remove('sidebar-collapsed');
      root.replaceChildren();
    },
  };
}
