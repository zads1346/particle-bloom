import * as THREE from "three";

/** A bevelled optical case: six planes, twelve edge bevels, eight corner facets. */
export function createCrystal() {
  const group = new THREE.Group(),
    h = [2.375, 2.375, 1.6],
    bevel = 0.14,
    positions = [],
    groups = [];
  const face = (vertices, kind) => {
    const start = positions.length / 3;
    for (let i = 1; i < vertices.length - 1; i++)
      positions.push(...vertices[0], ...vertices[i], ...vertices[i + 1]);
    groups.push({ start, count: positions.length / 3 - start, kind });
  };
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const a = (axis + 1) % 3,
        b = (axis + 2) % 3;
      face(
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([sa, sb]) => {
          const p = [0, 0, 0];
          p[axis] = sign * h[axis];
          p[a] = sa * (h[a] - bevel);
          p[b] = sb * (h[b] - bevel);
          return p;
        }),
        0,
      );
    }
  for (let edge = 0; edge < 3; edge++)
    for (const sa of [-1, 1])
      for (const sb of [-1, 1]) {
        const a = (edge + 1) % 3,
          b = (edge + 2) % 3,
          vertices = [];
        for (const [s, side] of [
          [-1, 0],
          [1, 0],
          [1, 1],
          [-1, 1],
        ]) {
          const p = [0, 0, 0];
          p[edge] = s * (h[edge] - bevel);
          p[a] = sa * (h[a] - (side ? bevel : 0));
          p[b] = sb * (h[b] - (side ? 0 : bevel));
          vertices.push(p);
        }
        face(vertices, 1);
      }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const signs = [sx, sy, sz];
        face(
          [0, 1, 2].map((axis) =>
            h.map((half, i) => signs[i] * (half - (i === axis ? 0 : bevel))),
          ),
          1,
        );
      }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  for (const g of groups) geometry.addGroup(g.start, g.count, g.kind);
  const planes = new THREE.MeshBasicMaterial({
    color: 0x91b5c1,
    transparent: true,
    opacity: 0.011,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const facets = new THREE.MeshBasicMaterial({
    color: 0xadcbd1,
    transparent: true,
    opacity: 0.055,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, [planes, facets]);
  group.add(mesh);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 15),
    new THREE.LineBasicMaterial({
      color: 0x91aab5,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    }),
  );
  group.add(edges);
  group.position.y = 0.1;
  return group;
}
