/** Keyboard + mouse state, pointer lock, and edge-triggered action helpers. */

export const KEYMAP = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  // Used as mouse-look while pointer lock is engaged, and as keyboard look
  // when it is not (frames that refuse to grant pointer lock).
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  reload: ['KeyR'],
  lethal: ['KeyG'],
  tactical: ['KeyQ'],
  primary: ['Digit1'],
  secondary: ['Digit2'],
  streak1: ['Digit4'],
  streak2: ['Digit5'],
  streak3: ['Digit6'],
  action: ['KeyE', 'KeyF'],
  scoreboard: ['Tab'],
  chat: ['Enter']
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered, cleared each frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false };
    this.locked = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.wheel = 0;
    this.onLockChange = null;
    this.onChatKey = null;
    this.onFallback = null;
    this.chatOpen = false;
    // Set when pointer lock cannot be used (denied, blocked by the embedding
    // frame, or simply never granted). The game must stay fully playable then.
    this.fallbackLook = false;
    this._lockTimer = null;

    window.addEventListener('keydown', (e) => this._down(e));
    window.addEventListener('keyup', (e) => this._up(e));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = false; this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => this._mouseDown(e));
    window.addEventListener('mouseup', (e) => this._mouseUp(e));
    window.addEventListener('mousemove', (e) => this._move(e));
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) {
        clearTimeout(this._lockTimer);
        this._lockTimer = null;
      }
      this.onLockChange?.(this.locked);
    });
    // Browsers fire this when lock is refused (most often: the document is in a
    // frame that was not given the pointer-lock permission).
    document.addEventListener('pointerlockerror', () => this.enableFallback());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _down(e) {
    if (this.chatOpen) {
      if (e.code === 'Escape') { this.chatOpen = false; this.onChatKey?.(null); }
      return;
    }
    if (e.code === 'Tab') e.preventDefault();
    if (e.code === 'Enter') { this.chatOpen = true; this.onChatKey?.(''); e.preventDefault(); return; }
    if (this.keys.has(e.code)) return;
    this.keys.add(e.code);
    this.pressed.add(e.code);
  }

  _up(e) { this.keys.delete(e.code); }

  _mouseDown(e) {
    if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
    if (e.button === 2) this.mouse.right = true;
  }

  _mouseUp(e) {
    if (e.button === 0) this.mouse.left = false;
    if (e.button === 2) this.mouse.right = false;
  }

  _move(e) {
    if (!this.locked) return;
    this.mouse.dx += e.movementX || 0;
    this.mouse.dy += e.movementY || 0;
  }

  requestLock() {
    if (this.fallbackLook) return;
    try {
      const r = this.canvas.requestPointerLock?.();
      // Returns a promise in browsers that support the options form.
      if (r && typeof r.catch === 'function') r.catch(() => this.enableFallback());
    } catch {
      this.enableFallback();
      return;
    }
    // No error event and no lock within a beat means the request was ignored.
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => {
      this._lockTimer = null;
      if (!this.locked) this.enableFallback();
    }, 600);
  }

  /** Give up on pointer lock and switch to keyboard look. */
  enableFallback() {
    if (this.fallbackLook) return;
    this.fallbackLook = true;
    this.locked = false;
    this.onFallback?.(true);
  }

  /** True while the player is in control, with or without pointer lock. */
  get controlling() { return this.locked || this.fallbackLook; }

  releaseLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  down(action) {
    const codes = KEYMAP[action] || [];
    return codes.some((c) => this.keys.has(c));
  }

  hit(action) {
    const codes = KEYMAP[action] || [];
    return codes.some((c) => this.pressed.has(c));
  }

  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.leftPressed = false;
  }
}
