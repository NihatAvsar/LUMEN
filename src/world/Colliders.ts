export interface Collider {
  x: number;
  z: number;
  r: number;
  bottom: number;
  top: number;
  /** Can the player stand on top of it? */
  walkable: boolean;
}

const CELL = 16;

export class Colliders {
  private cells = new Map<number, Collider[]>();
  readonly all: Collider[] = [];

  private key(cx: number, cz: number) {
    return (cx + 512) * 4096 + (cz + 512);
  }

  add(c: Collider) {
    this.all.push(c);
    const x0 = Math.floor((c.x - c.r) / CELL), x1 = Math.floor((c.x + c.r) / CELL);
    const z0 = Math.floor((c.z - c.r) / CELL), z1 = Math.floor((c.z + c.r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(c);
      }
    }
  }

  /** Colliders whose cells overlap a circle. May contain duplicates. */
  query(x: number, z: number, r: number, out: Collider[]) {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (arr) for (const c of arr) if (!out.includes(c)) out.push(c);
      }
    }
    return out;
  }

  /** Is the point clear of all colliders (with margin)? */
  isFree(x: number, z: number, margin: number) {
    const tmp: Collider[] = [];
    this.query(x, z, margin + 4, tmp);
    for (const c of tmp) if (Math.hypot(x - c.x, z - c.z) < c.r + margin) return false;
    return true;
  }
}
