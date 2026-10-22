export type EditorTab = 'unit' | 'map';

export function createEditorTabs(
  elements: Record<EditorTab, { tab: HTMLButtonElement; panel: HTMLElement }>,
): { select: (tab: EditorTab) => void; destroy: () => void } {
  const keys: EditorTab[] = ['unit', 'map'];
  const cleanup: (() => void)[] = [];

  function select(selected: EditorTab): void {
    for (const key of keys) {
      const active = key === selected;
      elements[key].tab.setAttribute('aria-selected', String(active));
      elements[key].tab.tabIndex = active ? 0 : -1;
      elements[key].panel.hidden = !active;
    }
  }

  for (const key of keys) {
    const { tab } = elements[key];
    const click = (): void => select(key);
    const keydown = (event: KeyboardEvent): void => {
      let next: EditorTab;
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
          next = key === 'unit' ? 'map' : 'unit';
          break;
        case 'Home':
          next = 'unit';
          break;
        case 'End':
          next = 'map';
          break;
        default:
          return;
      }
      event.preventDefault();
      select(next);
      elements[next].tab.focus();
    };
    tab.addEventListener('click', click);
    tab.addEventListener('keydown', keydown);
    cleanup.push(() => {
      tab.removeEventListener('click', click);
      tab.removeEventListener('keydown', keydown);
    });
  }

  select('unit');
  return { select, destroy: () => cleanup.forEach((remove) => remove()) };
}
