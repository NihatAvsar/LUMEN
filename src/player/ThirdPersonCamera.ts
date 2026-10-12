import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp } from '../core/math';
import type { Heightfield } from '../world/Heightfield';

/** Smooth orbiting third-person camera with terrain avoidance and trauma shake. */
export class ThirdPersonCamera {
  yaw = Math.PI;
  pitch = 0.32;
  distance = 7.5;
  private curDist = 7.5;
  readonly target = new Vector3();
  private trauma = 0;
  private fovPunch = 0;
  baseFov = 68;
  private tmp = new Vector3();

  constructor(readonly camera: PerspectiveCamera, private hf: Heightfield) {}

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  punch(fov: number) {
    this.fovPunch += fov;
  }

  snap(focus: Vector3) {
    this.target.copy(focus).add(this.tmp.set(0, 1.1, 0));
    this.curDist = this.distance;
  }

  update(dt: number, focus: Vector3, look: { x: number; y: number }, wheel: number, speed: number, time: number) {
    this.yaw -= look.x;
    this.pitch = clamp(this.pitch + look.y, -0.45, 1.25);
    this.distance = clamp(this.distance + wheel * 0.8, 3.5, 13);

    const goal = this.tmp.copy(focus);
    goal.y += 1.1;
    this.target.lerp(goal, damp(14, dt));

    // Shorten the boom if the terrain is in the way.
    let dist = this.distance;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = sp, dz = Math.cos(this.yaw) * cp;
    for (let i = 1; i <= 10; i++) {
      const d = (i / 10) * this.distance;
      const x = this.target.x + dx * d, y = this.target.y + dy * d, z = this.target.z + dz * d;
      if (y < this.hf.ground(x, z) + 0.45) {
        dist = Math.max(1.5, d - 0.5);
        break;
      }
    }
    this.curDist += (dist - this.curDist) * damp(dist < this.curDist ? 20 : 4, dt);

    const cam = this.camera;
    cam.position.set(
      this.target.x + dx * this.curDist,
      this.target.y + dy * this.curDist,
      this.target.z + dz * this.curDist,
    );
    const floor = this.hf.ground(cam.position.x, cam.position.z) + 0.4;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(this.target);

    // Trauma shake.
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const t2 = this.trauma * this.trauma;
    if (t2 > 0) {
      cam.rotation.z += Math.sin(time * 37.1) * 0.03 * t2;
      cam.rotateX(Math.sin(time * 43.7 + 1.3) * 0.025 * t2);
      cam.rotateY(Math.sin(time * 31.3 + 2.1) * 0.025 * t2);
    }

    this.fovPunch *= Math.exp(-dt * 3);
    const fov = this.baseFov + Math.min(speed, 34) * 0.32 + this.fovPunch;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * damp(6, dt);
      cam.updateProjectionMatrix();
    }
  }
}
