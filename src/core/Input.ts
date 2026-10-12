import { Vector2 } from 'three';

/** Keyboard / mouse / gamepad input with per-frame edge detection. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  wheel = 0;
  locked = false;
  readonly move = new Vector2();
  readonly look = new Vector2();
  jumpPressed = false;
  jumpHeld = false;
  dashPressed = false;
  pausePressed = false;
  private padJump = false;
  private padDash = false;
  private padPause = false;
  usingPad = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.usingPad = false;
      if (['Space', 'ShiftLeft', 'ShiftRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousemove', (e) => {
      // Without pointer lock (e.g. embedded views), dragging with the left button still looks around.
      if (!this.locked && !(e.buttons & 1 && e.target === this.canvas)) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.pressed.add('Mouse0');
      if (e.button === 2) this.pressed.add('Mouse2');
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
  }

  requestLock() {
    const c = this.canvas as HTMLCanvasElement & { requestPointerLock(o?: object): Promise<void> | void };
    const quiet = (r: Promise<void> | void, fallback?: () => void) => {
      if (r && typeof r.catch === 'function') r.catch(() => fallback?.());
    };
    try {
      quiet(c.requestPointerLock({ unadjustedMovement: true }), () => {
        try {
          quiet(c.requestPointerLock());
        } catch {
          /* pointer lock unavailable */
        }
      });
    } catch {
      try {
        quiet(c.requestPointerLock());
      } catch {
        /* pointer lock unavailable */
      }
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string) {
    return this.down.has(code);
  }
  wasPressed(code: string) {
    return this.pressed.has(code);
  }

  /** Gather all sources into the action state. Call once per frame before game logic. */
  poll(dt: number, sensitivity: number, invertY: boolean) {
    let mx = 0, my = 0;
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) my += 1;
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) my -= 1;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) mx -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) mx += 1;

    const s = 0.0022 * sensitivity;
    let lx = this.mouseDX * s;
    let ly = this.mouseDY * s;
    this.mouseDX = this.mouseDY = 0;

    let jumpHeld = this.down.has('Space');
    let jumpPressed = this.pressed.has('Space');
    let dashPressed = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight') || this.pressed.has('Mouse2');
    let pausePressed = this.pressed.has('Escape') || this.pressed.has('KeyP');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const ax = dz(p.axes[0] ?? 0), ay = dz(p.axes[1] ?? 0);
      const rx = dz(p.axes[2] ?? 0), ry = dz(p.axes[3] ?? 0);
      if (ax || ay || rx || ry) this.usingPad = true;
      mx += ax;
      my -= ay;
      lx += rx * dt * 3.2 * sensitivity;
      ly += ry * dt * 2.4 * sensitivity;
      const j = !!p.buttons[0]?.pressed;
      const d = !!(p.buttons[1]?.pressed || p.buttons[7]?.pressed || p.buttons[5]?.pressed);
      const pa = !!p.buttons[9]?.pressed;
      if (j) jumpHeld = true;
      if (j && !this.padJump) jumpPressed = true;
      if (d && !this.padDash) dashPressed = true;
      if (pa && !this.padPause) pausePressed = true;
      this.padJump = j;
      this.padDash = d;
      this.padPause = pa;
      if (j || d) this.usingPad = true;
      break;
    }

    this.move.set(mx, my);
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.look.set(lx, invertY ? -ly : ly);
    this.jumpHeld = jumpHeld;
    this.jumpPressed = jumpPressed;
    this.dashPressed = dashPressed;
    this.pausePressed = pausePressed;
  }

  endFrame() {
    this.pressed.clear();
    this.wheel = 0;
  }
}
