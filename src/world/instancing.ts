import { BufferGeometry, Color, Group, InstancedMesh, Material, Matrix4 } from 'three';

export interface InstanceItem {
  matrix: Matrix4;
  color?: Color;
}

/**
 * Splits instances into spatial cells so each InstancedMesh gets a tight bounding
 * sphere and can be frustum culled (also for the shadow pass).
 */
export function buildChunks(
  geo: BufferGeometry,
  mat: Material,
  items: InstanceItem[],
  opts: { cell?: number; castShadow?: boolean; receiveShadow?: boolean; name?: string } = {},
) {
  const group = new Group();
  const cell = opts.cell ?? 110;
  const buckets = new Map<string, InstanceItem[]>();
  for (const it of items) {
    const x = it.matrix.elements[12], z = it.matrix.elements[14];
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(it);
  }
  for (const b of buckets.values()) {
    const mesh = new InstancedMesh(geo, mat, b.length);
    b.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = opts.castShadow ?? false;
    mesh.receiveShadow = opts.receiveShadow ?? false;
    if (opts.name) mesh.name = opts.name;
    group.add(mesh);
  }
  return group;
}
