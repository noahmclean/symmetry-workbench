/**
 * shapeGenerator.js
 * Procedural 2D crystal polygon generator supporting both Convex (Wulff half-plane crystal forms)
 * and Non-Convex (polar fundamental-wedge indented stars & stepped crystal profiles) shapes
 * with guaranteed point-group symmetry and zero self-intersecting edges.
 */

import {
  DEG_TO_RAD,
  clipPolygonByHalfPlane,
  polygonEdgeMidpoints,
  normalizeAngleDeg180,
  createSeededRng
} from './geometry.js';

/**
 * Convert Cartesian polar coordinates (r, thetaRad) around center {x, y}
 * into screen coordinates {x, y} (where screen +y is down, so Cartesian +y is -y).
 */
function polarToScreen(center, r, thetaRad) {
  return {
    x: center.x + r * Math.cos(thetaRad),
    y: center.y - r * Math.sin(thetaRad)
  };
}

/**
 * Compute the exact mirror plane angles in [0, 180) (Cartesian degrees)
 * for a given point group preset.
 */
export function getPresetMirrorAnglesDeg(preset) {
  if (!preset.hasMirrors || preset.mirrorCount <= 0) return [];
  const angles = [];
  const step = 180 / preset.mirrorCount;
  for (let k = 0; k < preset.mirrorCount; k++) {
    angles.push(normalizeAngleDeg180(preset.baseAngleDeg + k * step));
  }
  return angles.sort((a, b) => a - b);
}

/**
 * Generate a non-convex simple polygon by constructing a radial profile r(phi) > 0
 * inside the fundamental angular wedge and replicating via the point group operations.
 */
function generateNonConvexVertices(preset, center, baseRadius, rng) {
  const n = preset.nFold;
  const baseRad = (preset.baseAngleDeg || 0) * DEG_TO_RAD;

  // Case 1: Asymmetric shape (pg_1)
  if (n === 1 && !preset.hasMirrors) {
    const numPts = 11;
    // Irregular angular spacings and alternating deep/shallow radii so no rotation or mirror exists
    const rawOffsets = [0.0, 0.42, 0.95, 1.55, 2.08, 2.75, 3.35, 3.92, 4.65, 5.18, 5.78];
    const radialScales = [
      0.98,
      0.52 + rng() * 0.12,
      0.86 + rng() * 0.1,
      0.44 + rng() * 0.1,
      1.05,
      0.62 + rng() * 0.1,
      0.78 + rng() * 0.08,
      0.48 + rng() * 0.1,
      0.91 + rng() * 0.08,
      0.67 + rng() * 0.08,
      0.56 + rng() * 0.08
    ];
    const jitter = (rng() - 0.5) * 0.35;
    const pts = [];
    for (let i = 0; i < numPts; i++) {
      const theta = rawOffsets[i] + jitter;
      const r = baseRadius * radialScales[i];
      pts.push(polarToScreen(center, r, theta));
    }
    return pts;
  }

  // Case 2: Dihedral groups with mirrors (pg_m, pg_2mm, pg_3m, pg_4mm, pg_6mm)
  if (preset.hasMirrors) {
    const wedgeAngle = Math.PI / n; // Fundamental domain [0, pi/n]
    // Choose 4 interior/boundary stations in [0, wedgeAngle]:
    // phi_0 = 0 (on mirror axis 1), phi_1, phi_2 (interior), phi_3 = wedgeAngle (on mirror axis 2)
    const f1 = 0.28 + rng() * 0.14;
    const f2 = 0.62 + rng() * 0.14;
    const phi = [0, f1 * wedgeAngle, f2 * wedgeAngle, wedgeAngle];

    // Pick distinct radii at the two mirror endpoints (r0 != r3 prevents accidental 2n-fold symmetry)
    // and a pronounced concave indentation in the interior so the shape is unmistakably non-convex.
    const r0 = baseRadius * (0.92 + rng() * 0.14);
    const r3 = baseRadius * (0.68 + rng() * 0.12);
    const indent = baseRadius * (0.42 + rng() * 0.12);
    const shoulder = baseRadius * (0.78 + rng() * 0.15);

    const pickOrder = rng() > 0.5;
    const rProfile = pickOrder
      ? [r0, indent, shoulder, r3]
      : [r0, shoulder, indent, r3];

    const pts = [];
    for (let s = 0; s < n; s++) {
      const sectorStart = baseRad + s * (2 * wedgeAngle);
      // Forward half-wedge: phi_0, phi_1, phi_2 (exclude phi_3 to avoid duplicate vertex at seam)
      for (let k = 0; k < phi.length - 1; k++) {
        pts.push(polarToScreen(center, rProfile[k], sectorStart + phi[k]));
      }
      // Reflected half-wedge: wedgeAngle + (wedgeAngle - phi_k) for k = 3, 2, 1
      for (let k = phi.length - 1; k >= 1; k--) {
        const reflectedAngle = sectorStart + 2 * wedgeAngle - phi[k];
        pts.push(polarToScreen(center, rProfile[k], reflectedAngle));
      }
    }
    return pts;
  }

  // Case 3: Pure rotational cyclic groups (pg_2, pg_3, pg_4, pg_6) - chiral non-convex pinwheels
  const sectorAngle = (2 * Math.PI) / n;
  // Asymmetric radial profile inside [0, sectorAngle) so mirror symmetry is impossible
  const fractions = [0.0, 0.18 + rng() * 0.06, 0.46 + rng() * 0.07, 0.76 + rng() * 0.06];
  const radii = [
    baseRadius * (0.96 + rng() * 0.1),  // Sharp leading tip
    baseRadius * (0.82 + rng() * 0.08), // High asymmetric bevel shoulder
    baseRadius * (0.45 + rng() * 0.1),  // Deep chiral notch
    baseRadius * (0.58 + rng() * 0.08)  // Low trailing step
  ];

  const pts = [];
  for (let s = 0; s < n; s++) {
    const startAngle = baseRad + s * sectorAngle;
    for (let k = 0; k < fractions.length; k++) {
      const theta = startAngle + fractions[k] * sectorAngle;
      pts.push(polarToScreen(center, radii[k], theta));
    }
  }
  return pts;
}

/**
 * Generate a strictly convex polygon with low, mineralogically realistic vertex counts
 * (3, 4, 5, 6, 8, or 12 vertices) while preserving exact point-group symmetry
 * and guaranteeing all interior angles < 180°.
 */
function generateConvexVertices(preset, center, baseRadius, rng) {
  const n = preset.nFold;
  const baseRad = (preset.baseAngleDeg || 0) * DEG_TO_RAD;

  // Case 1: Asymmetric convex crystal (pg_1) -> 3, 4, or 5 vertices
  if (n === 1 && !preset.hasMirrors) {
    const variant = Math.floor(rng() * 3); // 0: 3-gon, 1: 4-gon, 2: 5-gon
    const rotOffset = rng() * Math.PI * 2;
    let angles;
    let radiiFactors;

    if (variant === 0) {
      // Scalene triangle (3 vertices)
      angles = [0.15, 2.08, 4.32];
      radiiFactors = [0.98, 0.74 + rng() * 0.08, 0.88 + rng() * 0.08];
    } else if (variant === 1) {
      // Asymmetric quadrilateral (4 vertices)
      angles = [0.12, 1.48, 3.22, 4.92];
      radiiFactors = [
        0.96,
        0.76 + rng() * 0.08,
        0.91 + rng() * 0.06,
        0.68 + rng() * 0.08
      ];
    } else {
      // Asymmetric pentagon (5 vertices)
      angles = [0.08, 1.18, 2.42, 3.86, 5.14];
      radiiFactors = [0.95, 0.81, 0.92, 0.75, 0.86];
    }

    return angles.map((a, idx) =>
      polarToScreen(center, baseRadius * radiiFactors[idx], a + rotOffset)
    );
  }

  // Case 2: Dihedral convex crystals with mirror symmetry (pg_m, pg_2mm, pg_3m, pg_4mm, pg_6mm)
  if (preset.hasMirrors) {
    if (n === 1) {
      // Single mirror at baseRad (pg_m) -> 3, 4, or 5 vertices
      const variant = Math.floor(rng() * 3);
      if (variant === 0) {
        // Isosceles triangle (3 vertices)
        const rApex = baseRadius * (0.96 + rng() * 0.08);
        const rBase = baseRadius * (0.86 + rng() * 0.08);
        const spread = (122 + rng() * 14) * DEG_TO_RAD;
        return [
          polarToScreen(center, rApex, baseRad),
          polarToScreen(center, rBase, baseRad + spread),
          polarToScreen(center, rBase, baseRad - spread)
        ];
      }
      if (variant === 1) {
        // Kite or Isosceles Trapezoid (4 vertices)
        if (rng() > 0.5) {
          // Kite (4 vertices)
          const rTop = baseRadius * (0.98 + rng() * 0.06);
          const rSide = baseRadius * (0.76 + rng() * 0.08);
          const rBot = baseRadius * (0.64 + rng() * 0.08);
          const sideAngle = (68 + rng() * 12) * DEG_TO_RAD;
          return [
            polarToScreen(center, rTop, baseRad),
            polarToScreen(center, rSide, baseRad + sideAngle),
            polarToScreen(center, rBot, baseRad + Math.PI),
            polarToScreen(center, rSide, baseRad - sideAngle)
          ];
        }
        // Isosceles trapezoid (4 vertices)
        const aTop = (28 + rng() * 10) * DEG_TO_RAD;
        const aBot = (126 + rng() * 12) * DEG_TO_RAD;
        const rTop = baseRadius * (0.84 + rng() * 0.06);
        const rBot = baseRadius * (0.94 + rng() * 0.06);
        return [
          polarToScreen(center, rTop, baseRad - aTop),
          polarToScreen(center, rTop, baseRad + aTop),
          polarToScreen(center, rBot, baseRad + aBot),
          polarToScreen(center, rBot, baseRad - aBot)
        ];
      }
      // Symmetric 5-sided house crystal (5 vertices)
      const rApex = baseRadius * 0.98;
      const rShoulder = baseRadius * (0.85 + rng() * 0.06);
      const rBase = baseRadius * (0.88 + rng() * 0.06);
      const aShoulder = (56 + rng() * 8) * DEG_TO_RAD;
      const aBase = (138 + rng() * 8) * DEG_TO_RAD;
      return [
        polarToScreen(center, rApex, baseRad),
        polarToScreen(center, rShoulder, baseRad + aShoulder),
        polarToScreen(center, rBase, baseRad + aBase),
        polarToScreen(center, rBase, baseRad - aBase),
        polarToScreen(center, rShoulder, baseRad - aShoulder)
      ];
    }

    if (n === 2) {
      // Orthorhombic 2mm -> 4 vertices (rhombus or rectangle) or 6 vertices (hexagonal tablet)
      const variant = Math.floor(rng() * 3);
      if (variant === 0) {
        // Rhombus / Diamond (4 vertices)
        const rMajor = baseRadius * (0.96 + rng() * 0.06);
        const rMinor = baseRadius * (0.62 + rng() * 0.12);
        return [
          polarToScreen(center, rMinor, baseRad),
          polarToScreen(center, rMajor, baseRad + Math.PI * 0.5),
          polarToScreen(center, rMinor, baseRad + Math.PI),
          polarToScreen(center, rMajor, baseRad + Math.PI * 1.5)
        ];
      }
      if (variant === 1) {
        // Rectangle (4 vertices, non-square)
        const alpha = (27 + rng() * 9) * DEG_TO_RAD;
        const r = baseRadius * 0.95;
        return [
          polarToScreen(center, r, baseRad + alpha),
          polarToScreen(center, r, baseRad + Math.PI - alpha),
          polarToScreen(center, r, baseRad + Math.PI + alpha),
          polarToScreen(center, r, baseRad - alpha)
        ];
      }
      // 6-sided orthorhombic tablet (6 vertices)
      const rTip = baseRadius * 0.98;
      const rSide = baseRadius * (0.82 + rng() * 0.06);
      const alpha = (32 + rng() * 8) * DEG_TO_RAD;
      return [
        polarToScreen(center, rSide, baseRad + alpha),
        polarToScreen(center, rTip, baseRad + Math.PI * 0.5),
        polarToScreen(center, rSide, baseRad + Math.PI - alpha),
        polarToScreen(center, rSide, baseRad + Math.PI + alpha),
        polarToScreen(center, rTip, baseRad + Math.PI * 1.5),
        polarToScreen(center, rSide, baseRad - alpha)
      ];
    }

    // Higher dihedral groups: pg_3m (3 or 6 vertices), pg_4mm (4 or 8 vertices), pg_6mm (6 or 12 vertices)
    const sector = (2 * Math.PI) / n;
    const halfSector = Math.PI / n;
    const useSimpleRegularNgon = rng() < 0.6;

    if (useSimpleRegularNgon) {
      // Regular n-gon: Equilateral Triangle (3), Square (4), or Regular Hexagon (6)
      // Align vertices on mirror axes (or half-sector mirror axes) so all preset mirrors are exact
      const offset = n === 4 && rng() > 0.5 ? halfSector : 0;
      const r = baseRadius * 0.96;
      const pts = [];
      for (let s = 0; s < n; s++) {
        pts.push(polarToScreen(center, r, baseRad + offset + s * sector));
      }
      return pts;
    }

    // Semiregular 2n-gon (6 vertices for 3m, 8 vertices for 4mm, 12 vertices for 6mm)
    const r1 = baseRadius * 0.96;
    const minRatio = Math.cos(halfSector);
    const ratio = minRatio + (1 - minRatio) * (0.42 + rng() * 0.32);
    const r2 = r1 * ratio;
    const pts = [];
    for (let s = 0; s < n; s++) {
      const start = baseRad + s * sector;
      pts.push(polarToScreen(center, r1, start));
      pts.push(polarToScreen(center, r2, start + halfSector));
    }
    return pts;
  }

  // Case 3: Pure rotational convex crystal without mirrors (pg_2 -> 4 vertices, pg_3 -> 6, pg_4 -> 8, pg_6 -> 12)
  // Construct a strictly convex 2n-gon with alternating radii r1 != r2 and asymmetric angular step alpha != pi/n.
  // Because adjacent edge lengths L1 != L2 and adjacent vertex radii r1 != r2, mirror symmetry is impossible!
  const sector = (2 * Math.PI) / n;
  const halfSector = Math.PI / n;
  const alpha = (0.31 + rng() * 0.06) * sector; // Strictly < 0.5 * sector
  const r1 = baseRadius * 0.96;
  const minRatio =
    n === 2
      ? 0.58
      : Math.cos(halfSector) / Math.cos(halfSector - alpha);
  const ratio = minRatio + (1 - minRatio) * (0.42 + rng() * 0.25);
  const r2 = r1 * ratio;

  const pts = [];
  for (let s = 0; s < n; s++) {
    const start = baseRad + s * sector;
    pts.push(polarToScreen(center, r1, start));
    pts.push(polarToScreen(center, r2, start + alpha));
  }
  return pts;
}

/**
 * Main entry point to generate a 2D shape with exact crystallographic point group symmetry.
 */
export function generateSymmetricShape({
  preset,
  isConvex = false,
  center = { x: 400, y: 300 },
  radius = 165,
  seed = 101
}) {
  const rng = createSeededRng(seed);
  const vertices = isConvex
    ? generateConvexVertices(preset, center, radius, rng)
    : generateNonConvexVertices(preset, center, radius, rng);

  const edgeMidpoints = polygonEdgeMidpoints(vertices);
  const mirrorAnglesDeg = getPresetMirrorAnglesDeg(preset);

  // Build snap candidates: centroid/origin first (highest priority), then vertices, then edge midpoints
  const candidates = [
    {
      x: center.x,
      y: center.y,
      type: 'centroid',
      label: 'Shape Center / Centroid'
    }
  ];

  vertices.forEach((v, idx) => {
    candidates.push({
      x: v.x,
      y: v.y,
      type: 'vertex',
      label: `Vertex ${idx + 1}`
    });
  });

  edgeMidpoints.forEach((m, idx) => {
    candidates.push({
      x: m.x,
      y: m.y,
      type: 'midpoint',
      label: `Edge Midpoint ${idx + 1}`
    });
  });

  return {
    preset,
    isConvex,
    seed,
    center: { x: center.x, y: center.y },
    vertices,
    edgeMidpoints,
    candidates,
    mirrorAnglesDeg,
    rotations: [...preset.rotations],
    hasInversion2D: preset.hasInversion2D
  };
}

/**
 * Build the expected discovery checklist items for a Point Group shape.
 */
export function getShapeExpectedChecklist(shapeData) {
  const items = [];
  const { preset, mirrorAnglesDeg } = shapeData;

  // Principal rotational axis at center
  if (preset.nFold > 1) {
    items.push({
      id: `rot_${preset.nFold}_center`,
      type: 'rotation',
      order: preset.nFold,
      label: `${preset.nFold}-fold rotation axis at center`
    });
  }

  // Mirror planes sorted by angle
  for (const angle of mirrorAnglesDeg) {
    const rounded = Math.round(angle);
    items.push({
      id: `mirror_${rounded}`,
      type: 'mirror',
      angleDeg: rounded,
      label: `Mirror line at ${rounded}°`
    });
  }

  return items;
}
