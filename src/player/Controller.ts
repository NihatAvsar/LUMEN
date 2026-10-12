import { Vector3 } from 'three';
import { HOVER, PLAY_RADIUS } from '../config';
import { damp } from '../core/math';
import type { Heightfield } from '../world/Heightfield';
import type { Colliders, Collider } from '../world/Colliders';
import type { Input } from '../core/Input';

const RUN_SPEED = 9;
const GLIDE_SPEED = 12.5;
const GRAVITY = 30;
const JUMP_V = 13.2;
const DOUBLE_JUMP_V = 11.5;
const DASH_SPEED = 34;
const DASH_TIME = 0.22;
const DASH_COOLDOWN = 0.75;
const RADIUS = 0.45;

export interface ControllerEvents {
  onJump?: (double: boolean) => void;
  onLand?: (impact: number) => void;
  onDash?: () => void;
}

export class Controller {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  onGround = false;
  gliding = false;
  dashT = 0;
  dashCooldown = 0;
  private coyote = 0;
  private canDouble = true;
  private dashDir = new Vector3();
  private near: Collider[] = [];
  private lastGroundY = 0;
  facing = 0;
  enabled = true;
  events: ControllerEvents = {};
  /** Energy cost hook: return false to deny the dash. */
  canDash: () => boolean = () => true;

  constructor(private hf: Heightfield, private colliders: Colliders) {}

  teleport(p: Vector3) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.dashT = 0;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get dashing() {
    return this.dashT > 0;
  }

  /** Highest support surface under (x,z) that the player can stand on. */
  groundAt(x: number, z: number, footY: number) {
    let g = this.hf.ground(x, z);
    this.colliders.query(x, z, 2, this.near);
    for (const c of this.near) {
      if (!c.walkable) continue;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r && footY >= c.top - 0.7) g = Math.max(g, c.top);
    }
    return g;
  }

  update(dt: number, input: Input, camYaw: number) {
    const wasGround = this.onGround;
    // Camera-relative movement.
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;
    let mx = 0, mz = 0;
    if (this.enabled) {
      mx = fx * input.move.y + rx * input.move.x;
      mz = fz * input.move.y + rz * input.move.x;
    }
    const moving = mx * mx + mz * mz > 0.001;
    if (moving) this.facing = Math.atan2(mx, mz);

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (this.enabled && input.dashPressed && this.dashCooldown <= 0 && this.dashT <= 0 && this.canDash()) {
      this.dashT = DASH_TIME;
      this.dashCooldown = DASH_COOLDOWN;
      if (moving) this.dashDir.set(mx, 0, mz).normalize();
      else this.dashDir.set(fx, 0, fz);
      this.events.onDash?.();
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * DASH_SPEED;
      this.vel.z = this.dashDir.z * DASH_SPEED;
      this.vel.y = Math.max(this.vel.y, 0) * 0.5;
      if (this.dashT <= 0) {
        this.vel.x *= 0.4;
        this.vel.z *= 0.4;
      }
    } else {
      // Jumping.
      if (this.onGround) {
        this.coyote = 0.12;
        this.canDouble = true;
      } else this.coyote -= dt;
      if (this.enabled && input.jumpPressed) {
        if (this.coyote > 0) {
          this.vel.y = JUMP_V;
          this.coyote = 0;
          this.onGround = false;
          this.events.onJump?.(false);
        } else if (this.canDouble) {
          this.vel.y = DOUBLE_JUMP_V;
          this.canDouble = false;
          this.events.onJump?.(true);
        }
      }
      this.gliding = this.enabled && !this.onGround && input.jumpHeld && this.vel.y < 0;
      const target = this.gliding ? GLIDE_SPEED : RUN_SPEED;
      const accel = this.onGround ? 12 : this.gliding ? 4 : 5;
      const k = damp(accel, dt);
      this.vel.x += (mx * target - this.vel.x) * k;
      this.vel.z += (mz * target - this.vel.z) * k;

      this.vel.y -= GRAVITY * (this.gliding ? 0.25 : 1) * dt;
      if (this.gliding) this.vel.y = Math.max(this.vel.y, -2.4);
    }

    // Integrate.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // Side collisions.
    this.colliders.query(this.pos.x, this.pos.z, 3, this.near);
    const foot = this.pos.y - HOVER;
    for (const c of this.near) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const minD = c.r + RADIUS;
      if (d >= minD) continue;
      if (c.walkable && foot >= c.top - 0.6) continue;
      if (foot > c.top || this.pos.y < c.bottom) continue;
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
      this.pos.x = c.x + nx * minD;
      this.pos.z = c.z + nz * minD;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) {
        this.vel.x -= vn * nx;
        this.vel.z -= vn * nz;
      }
    }

    // World bounds.
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > PLAY_RADIUS) {
      this.pos.x *= PLAY_RADIUS / r;
      this.pos.z *= PLAY_RADIUS / r;
    }

    // Ground.
    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y - HOVER);
    if (this.pos.y - HOVER <= g) {
      const impact = -this.vel.y;
      // Stepping up small ledges is smooth; big drops snap.
      this.pos.y = g + HOVER;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
      if (!wasGround && impact > 6) this.events.onLand?.(impact);
    } else if (this.onGround && this.vel.y <= 0 && this.pos.y - HOVER - g < 0.6 && g > this.lastGroundY - 0.8) {
      // Stick to slopes when walking downhill.
      this.pos.y = g + HOVER;
      this.vel.y = 0;
    } else {
      this.onGround = false;
    }
    if (this.onGround) this.lastGroundY = g;
  }
}
