/**
 * wallpaperEngine.js
 * Lattice generation, motif & tessellated tiling construction, Wyckoff position snapping,
 * symmetry verification, and unit cell validation for the 9 glide-free plane groups:
 * ['p1', 'p2', 'pm', 'pmm', 'p4', 'p4m', 'p3', 'p6', 'p6m'].
 */

import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  normalizeAngleDeg180,
  angleDiffDeg180,
  lineAngleCartesianDeg,
  cartesianAngleToScreenUnitVec,
  pointToLineDistance,
  rotatePoint,
  polygonCentroid
} from './geometry.js';
import { POINT_GROUP_PRESETS } from '../data/symmetryData.js';
import { generateSymmetricShape } from './shapeGenerator.js';

const PG_MAP = Object.fromEntries(POINT_GROUP_PRESETS.map((p) => [p.id, p]));

const WALLPAPER_TO_SITE_PG = {
  p1: 'pg_1',
  p2: 'pg_2',
  pm: 'pg_m',
  pmm: 'pg_2mm',
  p4: 'pg_4',
  p4m: 'pg_4mm',
  p3: 'pg_3',
  p6: 'pg_6',
  p6m: 'pg_6mm'
};

/**
 * Harmonious laboratory mineral palettes for tessellated tilings (adjusted for dark stage contrast).
 */
const TESSELLATION_PALETTES = [
  {
    primary: { fill: 'rgba(56, 189, 248, 0.34)', stroke: '#38bdf8' },
    secondary: { fill: 'rgba(217, 119, 6, 0.34)', stroke: '#f59e0b' },
    tertiary: { fill: 'rgba(129, 140, 248, 0.32)', stroke: '#818cf8' },
    quaternary: { fill: 'rgba(45, 212, 191, 0.28)', stroke: '#2dd4bf' }
  },
  {
    primary: { fill: 'rgba(99, 102, 241, 0.34)', stroke: '#818cf8' },
    secondary: { fill: 'rgba(20, 184, 166, 0.32)', stroke: '#2dd4bf' },
    tertiary: { fill: 'rgba(234, 179, 8, 0.30)', stroke: '#facc15' },
    quaternary: { fill: 'rgba(244, 114, 182, 0.28)', stroke: '#f472b6' }
  },
  {
    primary: { fill: 'rgba(217, 119, 6, 0.34)', stroke: '#fb923c' },
    secondary: { fill: 'rgba(14, 165, 233, 0.32)', stroke: '#38bdf8' },
    tertiary: { fill: 'rgba(168, 85, 247, 0.30)', stroke: '#c084fc' },
    quaternary: { fill: 'rgba(52, 211, 153, 0.28)', stroke: '#34d399' }
  }
];

/**
 * Convert screen point {x, y} to fractional lattice coordinates {u, v}
 * relative to origin O and basis vectors vecA, vecB.
 */
export function screenToFractional(pt, origin, vecA, vecB) {
  const dx = pt.x - origin.x;
  const dy = pt.y - origin.y;
  const det = vecA.x * vecB.y - vecA.y * vecB.x;
  if (Math.abs(det) < 1e-9) return { u: 0, v: 0 };
  const u = (dx * vecB.y - dy * vecB.x) / det;
  const v = (vecA.x * dy - vecA.y * dx) / det;
  return { u, v };
}

/**
 * Convert fractional lattice coordinates {u, v} to screen point {x, y}.
 */
export function fractionalToScreen(u, v, origin, vecA, vecB) {
  return {
    x: origin.x + u * vecA.x + v * vecB.x,
    y: origin.y + u * vecA.y + v * vecB.y
  };
}

/**
 * Wrap a fractional coordinate into [0, 1) with tolerance around 0 / 1.
 */
export function wrapFractional01(val) {
  let w = val - Math.floor(val);
  if (w > 1 - 1e-6 || w < 1e-6) w = 0;
  return w;
}

function torusDiff(a, b) {
  const d = Math.abs(wrapFractional01(a) - wrapFractional01(b));
  return Math.min(d, 1 - d);
}

/**
 * Define the canonical Wyckoff rotation sites (in fractional coordinates u, v mod 1)
 * for each of the 9 glide-free plane groups.
 */
export function getWyckoffRotationSites(groupKey) {
  switch (groupKey) {
    case 'p1':
    case 'pm':
      return [];
    case 'p2':
    case 'pmm':
      return [
        { u: 0, v: 0, maxOrder: 2, orders: [2], siteName: 'lattice corner (0,0)' },
        { u: 0.5, v: 0, maxOrder: 2, orders: [2], siteName: 'a-edge midpoint (½,0)' },
        { u: 0, v: 0.5, maxOrder: 2, orders: [2], siteName: 'b-edge midpoint (0,½)' },
        { u: 0.5, v: 0.5, maxOrder: 2, orders: [2], siteName: 'cell center (½,½)' }
      ];
    case 'p4':
    case 'p4m':
      return [
        { u: 0, v: 0, maxOrder: 4, orders: [2, 4], siteName: 'lattice corner (0,0)' },
        { u: 0.5, v: 0.5, maxOrder: 4, orders: [2, 4], siteName: 'cell center (½,½)' },
        { u: 0.5, v: 0, maxOrder: 2, orders: [2], siteName: 'edge midpoint (½,0)' },
        { u: 0, v: 0.5, maxOrder: 2, orders: [2], siteName: 'edge midpoint (0,½)' }
      ];
    case 'p3':
      return [
        { u: 0, v: 0, maxOrder: 3, orders: [3], siteName: 'lattice corner (0,0)' },
        { u: 1 / 3, v: 2 / 3, maxOrder: 3, orders: [3], siteName: 'upper triangle center (⅓,⅔)' },
        { u: 2 / 3, v: 1 / 3, maxOrder: 3, orders: [3], siteName: 'lower triangle center (⅔,⅓)' }
      ];
    case 'p6':
    case 'p6m':
      return [
        { u: 0, v: 0, maxOrder: 6, orders: [2, 3, 6], siteName: 'lattice corner (0,0)' },
        { u: 1 / 3, v: 2 / 3, maxOrder: 3, orders: [3], siteName: 'triangle center (⅓,⅔)' },
        { u: 2 / 3, v: 1 / 3, maxOrder: 3, orders: [3], siteName: 'triangle center (⅔,⅓)' },
        { u: 0.5, v: 0, maxOrder: 2, orders: [2], siteName: 'edge midpoint (½,0)' },
        { u: 0, v: 0.5, maxOrder: 2, orders: [2], siteName: 'edge midpoint (0,½)' },
        { u: 0.5, v: 0.5, maxOrder: 2, orders: [2], siteName: 'diagonal midpoint (½,½)' }
      ];
    default:
      return [];
  }
}

/**
 * Construct edge-to-edge tessellated polygons (co-uniform tilings & paving-brick patterns)
 * for one unit cell (i, j) of a given plane group key ('p1'..'p6m').
 */
function buildTessellatedUnitCell(groupKey, i, j, origin, vecA, vecB, seed) {
  const pal = TESSELLATION_PALETTES[seed % TESSELLATION_PALETTES.length];
  const f2s = (u, v) => fractionalToScreen(i + u, j + v, origin, vecA, vecB);
  const makeTile = (uvList, style) => {
    const vertices = uvList.map(([u, v]) => f2s(u, v));
    return {
      i,
      j,
      center: polygonCentroid(vertices),
      vertices,
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: 2
    };
  };

  switch (groupKey) {
    case 'p1': {
      // Interlocking L-shaped oblique paving stones (translations only)
      return [
        makeTile(
          [
            [-0.5, -0.5],
            [0.14, -0.5],
            [0.14, 0.08],
            [-0.18, 0.08],
            [-0.18, 0.5],
            [-0.5, 0.5]
          ],
          pal.primary
        ),
        makeTile(
          [
            [0.14, -0.5],
            [0.5, -0.5],
            [0.5, 0.5],
            [-0.18, 0.5],
            [-0.18, 0.08],
            [0.14, 0.08]
          ],
          pal.secondary
        )
      ];
    }

    case 'p2': {
      // Vectorized Herringbone / Running-Bond Paving Bricks with 2-fold centers at (0,0), (½,0), (0,½), (½,½)
      return [
        // Brick 1 centered at (0, 0)
        makeTile(
          [
            [-0.36, -0.15],
            [0.36, -0.23],
            [0.36, 0.15],
            [-0.36, 0.23]
          ],
          pal.secondary
        ),
        // Brick 2 centered at (0, 0.5)
        makeTile(
          [
            [-0.36, 0.23],
            [0.36, 0.15],
            [0.36, 0.77],
            [-0.36, 0.85]
          ],
          pal.primary
        ),
        // Cross-paver 3 centered at (0.5, 0)
        makeTile(
          [
            [0.36, -0.23],
            [0.64, -0.15],
            [0.64, 0.23],
            [0.36, 0.15]
          ],
          pal.tertiary
        ),
        // Cross-paver 4 centered at (0.5, 0.5)
        makeTile(
          [
            [0.36, 0.15],
            [0.64, 0.23],
            [0.64, 0.85],
            [0.36, 0.77]
          ],
          pal.quaternary
        )
      ];
    }

    case 'pm': {
      // Interlocking Chevron Paving Courses with vertical mirrors at u = 0, 0.5
      return [
        makeTile(
          [
            [-0.5, -0.5],
            [0, -0.22],
            [0.5, -0.5],
            [0.5, 0.04],
            [0, 0.32],
            [-0.5, 0.04]
          ],
          pal.primary
        ),
        makeTile(
          [
            [-0.5, 0.04],
            [0, 0.32],
            [0.5, 0.04],
            [0.5, 0.5],
            [0, 0.78],
            [-0.5, 0.5]
          ],
          pal.secondary
        )
      ];
    }

    case 'pmm': {
      // Co-Uniform Tessellation of Hexagons, Rectangles, and Trapezoids/Rhombi
      // (modeled after Wikipedia's Co-Uniform_Wallpaper_Example_pmm.svg with dark-stage colors)
      return [
        // Central Hexagon at (0, 0)
        makeTile(
          [
            [-0.26, -0.26],
            [0.26, -0.26],
            [0.38, 0],
            [0.26, 0.26],
            [-0.26, 0.26],
            [-0.38, 0]
          ],
          pal.primary
        ),
        // Bridge Rectangle at (0, 0.5)
        makeTile(
          [
            [-0.26, 0.26],
            [0.26, 0.26],
            [0.26, 0.74],
            [-0.26, 0.74]
          ],
          pal.tertiary
        ),
        // Corner Tile at (0.5, 0.5)
        makeTile(
          [
            [0.26, 0.26],
            [0.74, 0.26],
            [0.74, 0.74],
            [0.26, 0.74]
          ],
          pal.quaternary
        ),
        // Paired Mirror Trapezoids meeting at (0.5, 0)
        makeTile(
          [
            [0.38, 0],
            [0.26, -0.26],
            [0.5, -0.26],
            [0.5, 0.26],
            [0.26, 0.26]
          ],
          pal.secondary
        ),
        makeTile(
          [
            [0.5, -0.26],
            [0.74, -0.26],
            [0.62, 0],
            [0.74, 0.26],
            [0.5, 0.26]
          ],
          pal.secondary
        )
      ];
    }

    case 'p4': {
      // Vectorized Pinwheel / Basketweave Paving Bricks (4-fold at (0,0) and (½,½), 2-fold at (½,0) and (0,½))
      // Both the Horizontal Brick at (½,0) and Vertical Brick at (0,½) share pal.secondary
      // so a 90° rotation maps bricks onto bricks of the exact same color!
      return [
        // Tilted Square Paver A at (0, 0) (4-fold invariant)
        makeTile(
          [
            [0.22, 0.08],
            [-0.08, 0.22],
            [-0.22, -0.08],
            [0.08, -0.22]
          ],
          pal.primary
        ),
        // Tilted Square Paver B at (0.5, 0.5) (4-fold invariant)
        makeTile(
          [
            [0.58, 0.28],
            [0.72, 0.58],
            [0.42, 0.72],
            [0.28, 0.42]
          ],
          pal.tertiary
        ),
        // Horizontal Paving Brick centered at (0.5, 0)
        makeTile(
          [
            [0.22, 0.08],
            [0.08, -0.22],
            [0.42, -0.28],
            [0.72, -0.42],
            [0.78, -0.08],
            [0.92, 0.22],
            [0.58, 0.28],
            [0.28, 0.42]
          ],
          pal.secondary
        ),
        // Vertical Paving Brick centered at (0, 0.5) (exact 90° rotation of Horizontal Brick -> same color!)
        makeTile(
          [
            [-0.08, 0.22],
            [0.22, 0.08],
            [0.28, 0.42],
            [0.42, 0.72],
            [0.08, 0.78],
            [-0.22, 0.92],
            [-0.28, 0.58],
            [-0.42, 0.28]
          ],
          pal.secondary
        )
      ];
    }

    case 'p4m': {
      // Archimedean Truncated Square Tessellation (Octagons at (0,0) + Squares at (0.5, 0.5))
      return [
        makeTile(
          [
            [-0.21, -0.5],
            [0.21, -0.5],
            [0.5, -0.21],
            [0.5, 0.21],
            [0.21, 0.5],
            [-0.21, 0.5],
            [-0.5, 0.21],
            [-0.5, -0.21]
          ],
          pal.primary
        ),
        makeTile(
          [
            [0.5, 0.21],
            [0.79, 0.5],
            [0.5, 0.79],
            [0.21, 0.5]
          ],
          pal.secondary
        )
      ];
    }

    case 'p6m': {
      // Archimedean Trihexagonal (Kagome) Tessellation:
      // Regular Hexagon at (0,0) (pal.primary) + Both Equilateral Triangles at (⅔,⅓) & (⅓,⅔) in pal.secondary
      // so 6-fold rotations, 2-fold rotations, and all 6 mirrors preserve tile colors!
      return [
        makeTile(
          [
            [0.5, 0],
            [0.5, 0.5],
            [0, 0.5],
            [-0.5, 0],
            [-0.5, -0.5],
            [0, -0.5]
          ],
          pal.primary
        ),
        makeTile(
          [
            [0.5, 0],
            [1.0, 0.5],
            [0.5, 0.5]
          ],
          pal.secondary
        ),
        makeTile(
          [
            [0, 0.5],
            [0.5, 0.5],
            [0.5, 1.0]
          ],
          pal.secondary
        )
      ];
    }

    case 'p6': {
      // Watertight edge-to-edge Chiral Hexagonal Tessellation:
      // - Chiral 6-gon at (0,0) in pal.primary
      // - Both Chiral Equilateral Triangles at (⅔,⅓) & (⅓,⅔) in pal.secondary (60° & 180° swap them)
      // - All 3 Chiral 2-Fold Parallelograms at (½,0), (½,½), (0,½) in pal.tertiary (60° cycles them)
      const u0 = 0.35;
      const v0 = 0.09;
      // 6-fold orbit around (0,0) in hexagonal fractional coords: R_60(u, v) = (u - v, u)
      const w = [[u0, v0]];
      for (let k = 1; k < 6; k++) {
        const [pu, pv] = w[k - 1];
        w.push([pu - pv, pu]);
      }

      const w0 = w[0];
      const w1 = w[1];
      const w2 = w[2];
      const w3 = w[3];
      const w4 = w[4];
      const w5 = w[5];

      return [
        // 1. Central 6-fold chiral hexagon at (0, 0)
        makeTile([w0, w1, w2, w3, w4, w5], pal.primary),
        // 2. Chiral equilateral triangle at B(2/3, 1/3)
        makeTile(
          [
            w0,
            [1 + w2[0], w2[1]],
            [1 + w4[0], 1 + w4[1]]
          ],
          pal.secondary
        ),
        // 3. Chiral equilateral triangle at C(1/3, 2/3) (same color as B so 6-fold & 2-fold preserve color!)
        makeTile(
          [
            w1,
            [1 + w3[0], 1 + w3[1]],
            [w5[0], 1 + w5[1]]
          ],
          pal.secondary
        ),
        // 4. Three 2-fold chiral parallelograms at (1/2, 0), (1/2, 1/2), (0, 1/2) (all pal.tertiary)
        makeTile(
          [
            w0,
            [1 + w2[0], w2[1]],
            [1 + w3[0], w3[1]],
            w5
          ],
          pal.tertiary
        ),
        makeTile(
          [
            w1,
            [1 + w3[0], 1 + w3[1]],
            [1 + w4[0], 1 + w4[1]],
            w0
          ],
          pal.tertiary
        ),
        makeTile(
          [
            w2,
            [w4[0], 1 + w4[1]],
            [w5[0], 1 + w5[1]],
            w1
          ],
          pal.tertiary
        )
      ];
    }

    case 'p3': {
      // Watertight edge-to-edge Chiral Trigonal Tessellation with exact 3-fold color & shape symmetry:
      // - Chiral 3-fold 6-gon at A(0,0) in pal.primary (invariant under 120° around A)
      // - Chiral 3-fold triangle at B(⅔,⅓) in pal.secondary (invariant under 120° around B)
      // - Chiral 3-fold triangle at C(⅓,⅔) in pal.tertiary (invariant under 120° around C)
      // Because A, B, and C are distinct Wyckoff orbits in p3, every 120° rotation maps
      // each tile onto a tile of the exact same color, while 60°, 180°, and mirrors are broken!
      const u0 = 0.54;
      const v0 = 0.13;
      // 3-fold orbit of shared vertex V0 around (0,0): R_120(u, v) = (-v, u - v)
      const v0Pt = [u0, v0];
      const v1Pt = [-v0, u0 - v0];
      const v2Pt = [v0 - u0, -u0];

      return [
        // 1. Chiral 3-fold 6-gon centered at A(0, 0)
        makeTile(
          [
            v0Pt,
            [1 + v2Pt[0], 1 + v2Pt[1]],
            v1Pt,
            [v0Pt[0] - 1, v0Pt[1]],
            v2Pt,
            [v1Pt[0], v1Pt[1] - 1]
          ],
          pal.primary
        ),
        // 2. Chiral equilateral triangle centered at B(2/3, 1/3)
        makeTile(
          [
            v0Pt,
            [1 + v1Pt[0], v1Pt[1]],
            [1 + v2Pt[0], 1 + v2Pt[1]]
          ],
          pal.secondary
        ),
        // 3. Chiral equilateral triangle centered at C(1/3, 2/3)
        makeTile(
          [
            v1Pt,
            [1 + v2Pt[0], 1 + v2Pt[1]],
            [v0Pt[0], 1 + v0Pt[1]]
          ],
          pal.tertiary
        )
      ];
    }

    default:
      return [];
  }
}

/**
 * Build a complete wallpaper tiling state for a given preset key ('p1'..'p6m'),
 * canvas dimensions, shape convexity / tessellation mode, and random seed.
 */
export function generateWallpaperTiling({
  preset,
  isConvex = true,
  isTessellated = false,
  stageWidth = 800,
  stageHeight = 600,
  seed = 101
}) {
  const minDim = Math.min(stageWidth, stageHeight);
  const baseCellSize = Math.max(150, Math.min(205, minDim / 3.1));

  const aLen = baseCellSize * preset.aRatio;
  const bLen = baseCellSize * preset.bRatio;
  const gammaRad = preset.gammaDeg * DEG_TO_RAD;

  const vecA = { x: aLen, y: 0 };
  const vecB = {
    x: bLen * Math.cos(gammaRad),
    y: -bLen * Math.sin(gammaRad)
  };

  const centerScreen = { x: stageWidth * 0.5, y: stageHeight * 0.5 };
  const origin = {
    x: centerScreen.x - 0.5 * (vecA.x + vecB.x),
    y: centerScreen.y - 0.5 * (vecA.y + vecB.y)
  };

  const sitePgId = WALLPAPER_TO_SITE_PG[preset.key] || 'pg_1';
  const sitePreset = PG_MAP[sitePgId];
  const motifRadius = Math.min(aLen, bLen) * 0.34;

  const baseMotif = generateSymmetricShape({
    preset: sitePreset,
    isConvex,
    center: { x: 0, y: 0 },
    radius: motifRadius,
    seed
  });

  const motifs = [];
  const candidateMap = new Map();

  const addCandidate = (pt, type, label, priority = 1) => {
    if (
      pt.x < -40 ||
      pt.x > stageWidth + 40 ||
      pt.y < -40 ||
      pt.y > stageHeight + 40
    ) {
      return;
    }
    const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
    if (!candidateMap.has(key) || candidateMap.get(key).priority < priority) {
      candidateMap.set(key, { x: pt.x, y: pt.y, type, label, priority });
    }
  };

  const range = 5;

  for (let i = -range; i <= range; i++) {
    for (let j = -range; j <= range; j++) {
      const latticePt = fractionalToScreen(i, j, origin, vecA, vecB);
      if (
        latticePt.x < -baseCellSize * 1.6 ||
        latticePt.x > stageWidth + baseCellSize * 1.6 ||
        latticePt.y < -baseCellSize * 1.6 ||
        latticePt.y > stageHeight + baseCellSize * 1.6
      ) {
        continue;
      }

      if (isTessellated) {
        const cellPolys = buildTessellatedUnitCell(
          preset.key,
          i,
          j,
          origin,
          vecA,
          vecB,
          seed
        );
        motifs.push(...cellPolys);
      } else {
        const translatedVertices = baseMotif.vertices.map((v) => ({
          x: v.x + latticePt.x,
          y: v.y + latticePt.y
        }));

        motifs.push({
          i,
          j,
          center: latticePt,
          vertices: translatedVertices,
          fill: 'rgba(56, 189, 248, 0.22)',
          stroke: '#38bdf8',
          strokeWidth: 2.2
        });
      }

      // Add lattice node (0,0) as a high-priority snap candidate
      addCandidate(latticePt, 'lattice', `Lattice Node (${i}, ${j})`, 3);

      // Add half-lattice / Wyckoff positions inside cell (i, j)
      const subSites = [
        { u: 0.5, v: 0, label: 'Edge Midpoint (½, 0)' },
        { u: 0, v: 0.5, label: 'Edge Midpoint (0, ½)' },
        { u: 0.5, v: 0.5, label: 'Cell Center (½, ½)' }
      ];
      if (preset.latticeType === 'hexagonal') {
        subSites.push(
          { u: 1 / 3, v: 2 / 3, label: 'Trigonal Site (⅓, ⅔)' },
          { u: 2 / 3, v: 1 / 3, label: 'Trigonal Site (⅔, ⅓)' }
        );
      }
      for (const s of subSites) {
        const sp = fractionalToScreen(i + s.u, j + s.v, origin, vecA, vecB);
        addCandidate(sp, 'wyckoff', s.label, 2);
      }
    }
  }

  return {
    preset,
    isConvex,
    isTessellated,
    seed,
    origin,
    vecA,
    vecB,
    aLen,
    bLen,
    gammaDeg: preset.gammaDeg,
    baseMotif,
    motifs,
    wyckoffSites: getWyckoffRotationSites(preset.key),
    candidates: Array.from(candidateMap.values()),
    mirrorAnglesDeg: [...preset.mirrorAnglesDeg],
    rotations: [...preset.rotations],
    hasInversion2D: preset.hasInversion2D
  };
}

/**
 * Evaluate whether a rotation glyph of order `order` placed at screen `pos`
 * is a valid symmetry operation of the active wallpaper tiling.
 */
export function verifyWallpaperRotation(tiling, order, pos) {
  const { preset, origin, vecA, vecB, wyckoffSites, aLen } = tiling;
  if (!preset.rotations.includes(order)) {
    return {
      valid: false,
      reason: 'This periodic pattern does not contain ' + order + '-fold rotational symmetry.'
    };
  }

  const { u, v } = screenToFractional(pos, origin, vecA, vecB);
  const tolFrac = 14 / aLen;

  let bestSite = null;
  let bestDist = Infinity;

  for (const site of wyckoffSites) {
    const du = torusDiff(u, site.u);
    const dv = torusDiff(v, site.v);
    const d = Math.hypot(du, dv);
    if (d < bestDist) {
      bestDist = d;
      bestSite = site;
    }
  }

  if (!bestSite || bestDist > tolFrac) {
    return {
      valid: false,
      reason: `The ${order}-fold axis is displaced from the lattice rotocenters. Try snapping to a lattice node, cell center, or Wyckoff point.`
    };
  }

  if (order !== bestSite.maxOrder) {
    return {
      valid: false,
      reason: `The position at ${bestSite.siteName} is a ${bestSite.maxOrder}-fold site — place a ${bestSite.maxOrder}-Fold glyph instead of a ${order}-Fold glyph.`
    };
  }

  // Compute exact rectified screen position for the matched Wyckoff site
  const uExact = Math.round(u - bestSite.u) + bestSite.u;
  const vExact = Math.round(v - bestSite.v) + bestSite.v;
  const rectifiedPos = fractionalToScreen(uExact, vExact, origin, vecA, vecB);

  let checklistId = `wp_rot_${order}_corner`;
  let checklistLabel = `${order}-fold axis at ${bestSite.siteName}`;
  if (bestSite.u === 0 && bestSite.v === 0) {
    checklistId = `wp_rot_${order}_corner`;
  } else if (bestSite.u === 0.5 && bestSite.v === 0.5 && preset.latticeType === 'square') {
    checklistId = `wp_rot_${order}_center`;
  } else if (Math.abs(bestSite.u - 1 / 3) < 0.05 || Math.abs(bestSite.u - 2 / 3) < 0.05) {
    checklistId = `wp_rot_${order}_trigonal`;
    checklistLabel = `${order}-fold axis at triangle center`;
  } else {
    checklistId = `wp_rot_${order}_midpoint`;
    checklistLabel = `${order}-fold axis at edge/cell midpoint`;
  }

  return {
    valid: true,
    checklistId,
    checklistLabel,
    site: bestSite,
    rectifiedPos,
    message: `Verified! The pattern maps onto itself under a ${Math.round(360 / order)}° rotation about ${bestSite.siteName}.`
  };
}

/**
 * Evaluate whether an inversion center placed at `pos` is valid for the wallpaper tiling.
 */
export function verifyWallpaperInversion(tiling, pos) {
  const { preset } = tiling;
  if (!preset.hasInversion2D) {
    return {
      valid: false,
      reason: 'This pattern lacks centrosymmetry.'
    };
  }
  const rotCheck = verifyWallpaperRotation(tiling, 2, pos);
  if (!rotCheck.valid) {
    return {
      valid: false,
      reason: 'Center must sit on a centrosymmetric Wyckoff position.'
    };
  }
  return {
    valid: true,
    checklistId: 'wp_inv_center',
    checklistLabel: `Center at ${rotCheck.site.siteName}`,
    message: 'Verified!'
  };
}

/**
 * Evaluate whether a mirror line through p1 and p2 is a valid mirror symmetry plane
 * of the wallpaper tiling.
 */
export function verifyWallpaperMirror(tiling, p1, p2) {
  const { preset, origin, vecA, vecB, aLen } = tiling;
  if (preset.mirrorAnglesDeg.length === 0) {
    return {
      valid: false,
      reason: 'This pattern is chiral/oblique and contains no mirror planes.'
    };
  }

  const userAngle = lineAngleCartesianDeg(p1, p2);
  let matchedAngle = null;
  let minAngleDiff = Infinity;

  for (const validAngle of preset.mirrorAnglesDeg) {
    const diff = angleDiffDeg180(userAngle, validAngle);
    if (diff < minAngleDiff) {
      minAngleDiff = diff;
      matchedAngle = validAngle;
    }
  }

  if (minAngleDiff > 6.5) {
    return {
      valid: false,
      reason: `Mirror orientation (${Math.round(userAngle)}°) does not align with the pattern's mirror axes. Check the Directional Compass hint!`
    };
  }

  let minLineOffset = Infinity;
  let bestAnchorPt = origin;
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      const candidateShifts = [
        { u: i, v: j },
        { u: i + 0.5, v: j },
        { u: i, v: j + 0.5 },
        { u: i + 0.5, v: j + 0.5 }
      ];
      for (const s of candidateShifts) {
        if (preset.latticeType === 'hexagonal' && (s.u % 1 !== 0 || s.v % 1 !== 0)) continue;
        const pt = fractionalToScreen(s.u, s.v, origin, vecA, vecB);
        const d = pointToLineDistance(pt, p1, p2);
        if (d < minLineOffset) {
          minLineOffset = d;
          bestAnchorPt = pt;
        }
      }
    }
  }

  if (minLineOffset > Math.min(14, aLen * 0.08)) {
    return {
      valid: false,
      reason: `Mirror angle (${matchedAngle}°) is correct, but the line is parallel-shifted away from the lattice reflection axis by ${Math.round(minLineOffset)} px.`
    };
  }

  // Compute exact rectified mirror endpoints along the matched reflection axis
  const { ux, uy } = cartesianAngleToScreenUnitVec(matchedAngle);
  const mid = { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) };
  const halfLen = Math.max(85, 0.5 * Math.hypot(p2.x - p1.x, p2.y - p1.y));
  const tProj = (mid.x - bestAnchorPt.x) * ux + (mid.y - bestAnchorPt.y) * uy;
  const projMid = {
    x: bestAnchorPt.x + tProj * ux,
    y: bestAnchorPt.y + tProj * uy
  };
  const rectifiedEndpoints = {
    p1: { x: projMid.x - ux * halfLen, y: projMid.y - uy * halfLen },
    p2: { x: projMid.x + ux * halfLen, y: projMid.y + uy * halfLen }
  };

  const rounded = Math.round(matchedAngle);
  return {
    valid: true,
    checklistId: `wp_mirror_${rounded}`,
    checklistLabel: `Mirror plane at ${rounded}°`,
    angleDeg: rounded,
    rectifiedEndpoints,
    message: `Verified! Reflection across the ${rounded}° mirror axis maps the entire periodic tiling onto itself.`
  };
}

/**
 * Validate a student-drawn unit cell defined by userOrigin, userVecA, userVecB
 * against the true lattice basis (vecA, vecB).
 */
export function verifyUserUnitCell(tiling, userOrigin, userVecA, userVecB) {
  const { preset, vecA, vecB, aLen } = tiling;

  const det0 = vecA.x * vecB.y - vecA.y * vecB.x;
  const ua = (userVecA.x * vecB.y - userVecA.y * vecB.x) / det0;
  const va = (vecA.x * userVecA.y - vecA.y * userVecA.x) / det0;

  const ub = (userVecB.x * vecB.y - userVecB.y * vecB.x) / det0;
  const vb = (vecA.x * userVecB.y - vecA.y * userVecB.x) / det0;

  const uaRound = Math.round(ua);
  const vaRound = Math.round(va);
  const ubRound = Math.round(ub);
  const vbRound = Math.round(vb);

  const errA = Math.hypot(ua - uaRound, va - vaRound);
  const errB = Math.hypot(ub - ubRound, vb - vbRound);

  const lenUserA = Math.hypot(userVecA.x, userVecA.y);
  const lenUserB = Math.hypot(userVecB.x, userVecB.y);

  if (lenUserA < 25 || lenUserB < 25) {
    return {
      valid: false,
      isLatticeTranslation: false,
      reason: 'Unit cell basis vectors a and b must have non-zero lengths spanning a full repeat period.'
    };
  }

  if (errA > 0.12 || errB > 0.12) {
    const badVec = errA > errB ? 'vector a' : 'vector b';
    return {
      valid: false,
      isLatticeTranslation: false,
      reason: `Translational mismatch: ${badVec} does not connect equivalent lattice points. Watch how the translated tiles land out-of-register with the background pattern!`
    };
  }

  const detInt = Math.abs(uaRound * vbRound - vaRound * ubRound);
  if (detInt === 0) {
    return {
      valid: false,
      isLatticeTranslation: true,
      reason: 'Basis vectors a and b are collinear (enclosed cell area is zero). Choose two independent translation directions.'
    };
  }

  const dot = userVecA.x * userVecB.x + userVecA.y * userVecB.y;
  const cosGamma = Math.max(-1, Math.min(1, dot / (lenUserA * lenUserB)));
  const userGammaDeg = Math.acos(cosGamma) * RAD_TO_DEG;

  if (detInt > 1) {
    return {
      valid: false,
      isLatticeTranslation: true,
      isSupercell: true,
      detInt,
      reason: `Your vectors form a supercell with ${detInt}× the area of a primitive unit cell. While it tiles the plane without mismatch, shorten the vectors to outline a single primitive cell!`
    };
  }

  if (preset.latticeType === 'rectangular' || preset.latticeType === 'square') {
    if (Math.abs(userGammaDeg - 90) > 5) {
      return {
        valid: false,
        isLatticeTranslation: true,
        reason: `Your oblique cell has primitive area, but for this ${preset.latticeType} pattern you should choose orthogonal basis vectors (γ = 90°, currently ${Math.round(userGammaDeg)}°).`
      };
    }
  } else if (preset.latticeType === 'hexagonal') {
    const validHexAngle = Math.abs(userGammaDeg - 120) <= 5 || Math.abs(userGammaDeg - 60) <= 5;
    const equalSides = Math.abs(lenUserA - lenUserB) / aLen < 0.12;
    if (!validHexAngle || !equalSides) {
      return {
        valid: false,
        isLatticeTranslation: true,
        reason: `For a hexagonal pattern, choose equal-length basis vectors (|a| = |b|) with γ = 120° (or 60°); currently γ = ${Math.round(userGammaDeg)}°.`
      };
    }
  }

  return {
    valid: true,
    isLatticeTranslation: true,
    checklistId: 'wp_unit_cell',
    checklistLabel: `Primitive unit cell (γ = ${Math.round(userGammaDeg)}°)`,
    userGammaDeg: Math.round(userGammaDeg),
    message: `Verified! Your primitive unit cell (|a| = ${Math.round(lenUserA)} px, |b| = ${Math.round(lenUserB)} px, γ = ${Math.round(userGammaDeg)}°) tiles the contiguous grid cells with exact translational congruence.`
  };
}

/**
 * Build the expected discovery checklist items for a Wallpaper Pattern.
 */
export function getWallpaperExpectedChecklist(tiling) {
  const items = [];
  const { preset } = tiling;

  items.push({
    id: 'wp_unit_cell',
    type: 'unit_cell',
    label: `Primitive unit cell (γ = ${preset.gammaDeg}°)`
  });

  if (preset.key === 'p2' || preset.key === 'pmm') {
    items.push(
      { id: 'wp_rot_2_corner', type: 'rotation', order: 2, label: '2-fold axis at lattice corner (0,0)' },
      { id: 'wp_rot_2_midpoint', type: 'rotation', order: 2, label: '2-fold axis at edge/cell midpoint' }
    );
  } else if (preset.key === 'p4' || preset.key === 'p4m') {
    items.push(
      { id: 'wp_rot_4_corner', type: 'rotation', order: 4, label: '4-fold axis at lattice corner (0,0)' },
      { id: 'wp_rot_4_center', type: 'rotation', order: 4, label: '4-fold axis at cell center (½,½)' },
      { id: 'wp_rot_2_midpoint', type: 'rotation', order: 2, label: '2-fold axis at edge midpoint' }
    );
  } else if (preset.key === 'p3') {
    items.push(
      { id: 'wp_rot_3_corner', type: 'rotation', order: 3, label: '3-fold axis at lattice corner (0,0)' },
      { id: 'wp_rot_3_trigonal', type: 'rotation', order: 3, label: '3-fold axis at triangle center (⅓,⅔)' }
    );
  } else if (preset.key === 'p6' || preset.key === 'p6m') {
    items.push(
      { id: 'wp_rot_6_corner', type: 'rotation', order: 6, label: '6-fold axis at lattice corner (0,0)' },
      { id: 'wp_rot_3_trigonal', type: 'rotation', order: 3, label: '3-fold axis at triangle center (⅓,⅔)' },
      { id: 'wp_rot_2_midpoint', type: 'rotation', order: 2, label: '2-fold axis at edge midpoint (½,0)' }
    );
  }

  for (const angle of preset.mirrorAnglesDeg) {
    const rounded = Math.round(angle);
    items.push({
      id: `wp_mirror_${rounded}`,
      type: 'mirror',
      angleDeg: rounded,
      label: `Mirror plane at ${rounded}°`
    });
  }

  return items;
}
