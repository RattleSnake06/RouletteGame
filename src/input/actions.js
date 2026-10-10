// Keyboard → game actions. Game code listens for actions ("spin",
// "turnLeft"…), never raw keys, so gamepad and Steam Input can map onto the
// same names later (design doc 9.10). Pointer interaction on 3D objects is
// handled by view/interaction.js and also ends in named game actions.

const KEYMAP = {
  Space: 'spin',
  KeyA: 'turnLeft',
  ArrowLeft: 'turnLeft',
  KeyD: 'turnRight',
  ArrowRight: 'turnRight',
  Digit1: 'choose1',
  Numpad1: 'choose1',
  Digit2: 'choose2',
  Numpad2: 'choose2',
  Digit3: 'choose3',
  Numpad3: 'choose3',
  KeyE: 'endNight',
  KeyF: 'toggleFast',
  KeyM: 'toggleMute',
  Escape: 'menu',
  KeyB: 'ringBell',
  KeyR: 'restock',
  BracketLeft: 'moveLeft',
  BracketRight: 'moveRight',
  Delete: 'sell',
  Backspace: 'sell',
  Enter: 'activate',
  NumpadEnter: 'activate',
  Tab: 'focusNext',
};
// Later, on a pad: LB/RB focusPrev/focusNext, A activate, X sell, Y ringBell.

/** The action for a key press; a few keys change meaning with Shift. */
function actionFor(e) {
  const action = KEYMAP[e.code];
  if (action === 'focusNext' && e.shiftKey) return 'focusPrev';
  return action;
}

export function createInput(target = window) {
  const listeners = new Map();
  const held = new Set();

  function emit(action) {
    for (const fn of listeners.get(action) ?? []) fn();
  }

  target.addEventListener('keydown', (e) => {
    const action = actionFor(e);
    if (!action) return;
    if (e.target instanceof HTMLElement && e.target.closest('button, input, textarea, select')) {
      if (action !== 'menu') return;
    }
    e.preventDefault();
    if (e.repeat) return;
    held.add(action);
    emit(action);
  });
  target.addEventListener('keyup', (e) => {
    const action = KEYMAP[e.code];
    if (action) held.delete(action);
    if (action === 'focusNext') held.delete('focusPrev');
  });
  target.addEventListener('blur', () => held.clear());

  return {
    on(action, fn) {
      if (!listeners.has(action)) listeners.set(action, []);
      listeners.get(action).push(fn);
    },
    isHeld: (action) => held.has(action),
    emit,
  };
}
