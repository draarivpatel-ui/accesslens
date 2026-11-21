const ACTIONS = { r: 'analyze', e: 'editor' };

export function shortcutAction(event, enabled) {
  if (!enabled || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const target = event.target;
  if (target?.isContentEditable || target?.closest?.('input,textarea,select,button,a,summary,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="spinbutton"],[role="listbox"],[role="slider"],[role="button"],[role="searchbox"],[role="gridcell"],[role="option"],[role="menuitem"],[role="treeitem"]')) return null;
  return Object.hasOwn(ACTIONS, event.key) ? ACTIONS[event.key] : null;
}
