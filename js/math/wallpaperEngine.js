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
  polygonCentroid,
  clipPolygonByHalfPlane
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
        {
          u: 0,
          v: 0,
          maxOrder: 2,
          orders: [2],
          siteName: 'lattice corner (0,0)',
          checklistId: 'wp_rot_2_00',
          checklistLabel: '2-fold axis at lattice corner (0,0)'
        },
        {
          u: 0.5,
          v: 0,
          maxOrder: 2,
          orders: [2],
          siteName: 'a-edge midpoint (½,0)',
          checklistId: 'wp_rot_2_50',
          checklistLabel: '2-fold axis at a-edge midpoint (½,0)'
        },
        {
          u: 0,
          v: 0.5,
          maxOrder: 2,
          orders: [2],
          siteName: 'b-edge midpoint (0,½)',
          checklistId: 'wp_rot_2_05',
          checklistLabel: '2-fold axis at b-edge midpoint (0,½)'
        },
        {
          u: 0.5,
          v: 0.5,
          maxOrder: 2,
          orders: [2],
          siteName: 'cell center (½,½)',
          checklistId: 'wp_rot_2_55',
          checklistLabel: '2-fold axis at cell center (½,½)'
        }
      ];
    case 'p4':
    case 'p4m':
      return [
        {
          u: 0,
          v: 0,
          maxOrder: 4,
          orders: [2, 4],
          siteName: 'lattice corner (0,0)',
          checklistId: 'wp_rot_4_00',
          checklistLabel: '4-fold axis at lattice corner (0,0)'
        },
        {
          u: 0.5,
          v: 0.5,
          maxOrder: 4,
          orders: [2, 4],
          siteName: 'cell center (½,½)',
          checklistId: 'wp_rot_4_55',
          checklistLabel: '4-fold axis at cell center (½,½)'
        },
        {
          u: 0.5,
          v: 0,
          maxOrder: 2,
          orders: [2],
          siteName: 'a-edge midpoint (½,0)',
          checklistId: 'wp_rot_2_50',
          checklistLabel: '2-fold axis at a-edge midpoint (½,0)'
        },
        {
          u: 0,
          v: 0.5,
          maxOrder: 2,
          orders: [2],
          siteName: 'b-edge midpoint (0,½)',
          checklistId: 'wp_rot_2_05',
          checklistLabel: '2-fold axis at b-edge midpoint (0,½)'
        }
      ];
    case 'p3':
      return [
        {
          u: 0,
          v: 0,
          maxOrder: 3,
          orders: [3],
          siteName: 'lattice corner (0,0)',
          checklistId: 'wp_rot_3_00',
          checklistLabel: '3-fold axis at lattice corner (0,0)'
        },
        {
          u: 1 / 3,
          v: 2 / 3,
          maxOrder: 3,
          orders: [3],
          siteName: 'upper triangle center (⅓,⅔)',
          checklistId: 'wp_rot_3_13_23',
          checklistLabel: '3-fold axis at upper triangle center (⅓,⅔)'
        },
        {
          u: 2 / 3,
          v: 1 / 3,
          maxOrder: 3,
          orders: [3],
          siteName: 'lower triangle center (⅔,⅓)',
          checklistId: 'wp_rot_3_23_13',
          checklistLabel: '3-fold axis at lower triangle center (⅔,⅓)'
        }
      ];
    case 'p6':
    case 'p6m':
      return [
        {
          u: 0,
          v: 0,
          maxOrder: 6,
          orders: [2, 3, 6],
          siteName: 'lattice corner (0,0)',
          checklistId: 'wp_rot_6_00',
          checklistLabel: '6-fold axis at lattice corner (0,0)'
        },
        {
          u: 1 / 3,
          v: 2 / 3,
          maxOrder: 3,
          orders: [3],
          siteName: 'upper triangle center (⅓,⅔)',
          checklistId: 'wp_rot_3_13_23',
          checklistLabel: '3-fold axis at upper triangle center (⅓,⅔)'
        },
        {
          u: 2 / 3,
          v: 1 / 3,
          maxOrder: 3,
          orders: [3],
          siteName: 'lower triangle center (⅔,⅓)',
          checklistId: 'wp_rot_3_23_13',
          checklistLabel: '3-fold axis at lower triangle center (⅔,⅓)'
        },
        {
          u: 0.5,
          v: 0,
          maxOrder: 2,
          orders: [2],
          siteName: 'a-edge midpoint (½,0)',
          checklistId: 'wp_rot_2_50',
          checklistLabel: '2-fold axis at a-edge midpoint (½,0)'
        },
        {
          u: 0,
          v: 0.5,
          maxOrder: 2,
          orders: [2],
          siteName: 'b-edge midpoint (0,½)',
          checklistId: 'wp_rot_2_05',
          checklistLabel: '2-fold axis at b-edge midpoint (0,½)'
        },
        {
          u: 0.5,
          v: 0.5,
          maxOrder: 2,
          orders: [2],
          siteName: 'interior diagonal midpoint (½,½)',
          checklistId: 'wp_rot_2_55',
          checklistLabel: '2-fold axis at interior diagonal midpoint (½,½)'
        }
      ];
    default:
      return [];
  }
}

/**
 * Symmetry-Orbit Generators in fractional unit-cell coordinates (u, v)
 * for constructing guaranteed symmetry-preserving Periodic Voronoi Tessellations.
 */
function orbitP2(u, v) {
  return [
    [u, v],
    [-u, -v]
  ];
}

function orbitPm(u, v) {
  return [
    [u, v],
    [-u, v]
  ];
}

function orbitPmm(u, v) {
  return [
    [u, v],
    [-u, v],
    [u, -v],
    [-u, -v]
  ];
}

function orbitP4(u, v) {
  return [
    [u, v],
    [-v, u],
    [-u, -v],
    [v, -u]
  ];
}

function orbitP4Center(du, dv) {
  return [
    [0.5 + du, 0.5 + dv],
    [0.5 - dv, 0.5 + du],
    [0.5 - du, 0.5 - dv],
    [0.5 + dv, 0.5 - du]
  ];
}

function orbitP4m(u, v) {
  return [...orbitP4(u, v), ...orbitP4(v, u)];
}

function orbitP3(u, v) {
  return [
    [u, v],
    [-v, u - v],
    [v - u, -u]
  ];
}

function orbitP3Around(cu, cv, du, dv) {
  return orbitP3(du, dv).map(([x, y]) => [cu + x, cv + y]);
}

function orbitP6(u, v) {
  const out = [[u, v]];
  for (let k = 1; k < 6; k++) {
    const [pu, pv] = out[k - 1];
    out.push([pu - pv, pu]);
  }
  return out;
}

function orbitP6m(u, v) {
  return [...orbitP6(u, v), ...orbitP6(v, u)];
}

// Single-entry memoization cache for the base (0, 0) Voronoi cell polygons
let voronoiBaseCache = {
  key: '',
  polys: []
};

/**
 * Compute exact edge-to-edge Periodic Euclidean Voronoi (Dirichlet) polygons for unit cell (i, j)
 * from a list of symmetry-invariant seed orbits: [{ points: [[u, v], ...], style }].
 * Because Euclidean distance is invariant under all isometries, any seed set whose colored orbits
 * are invariant under wallpaper group W produces a 100% watertight tessellation with exact W
 * shape and color symmetry (kites, pentagons, hexagons, octagons, diamonds, etc.).
 */
function buildPeriodicVoronoiUnitCell(orbits, i, j, origin, vecA, vecB, cacheId = '') {
  const cacheKey = `${cacheId}|${Math.round(origin.x)},${Math.round(origin.y)}|${Math.round(vecA.x)},${Math.round(vecA.y)}|${Math.round(vecB.x)},${Math.round(vecB.y)}`;

  let basePolys;
  if (cacheId && voronoiBaseCache.key === cacheKey) {
    basePolys = voronoiBaseCache.polys;
  } else {
    // 1. Wrap all fractional seed coordinates into [-0.5, 0.5) and deduplicate on the torus
    const baseSeeds = [];
    for (const orb of orbits) {
      for (const [rawU, rawV] of orb.points) {
        const uw = rawU - Math.round(rawU);
        const vw = rawV - Math.round(rawV);
        const isDup = baseSeeds.some(
          (s) => Math.hypot(torusDiff(uw, s.u), torusDiff(vw, s.v)) < 1e-4
        );
        if (!isDup) {
          baseSeeds.push({ u: uw, v: vw, style: orb.style });
        }
      }
    }

    // 2. Build all competitor seeds across the 5x5 neighborhood of unit cells [-2..2]^2
    const allCompetitors = [];
    for (let di = -2; di <= 2; di++) {
      for (let dj = -2; dj <= 2; dj++) {
        for (let sIdx = 0; sIdx < baseSeeds.length; sIdx++) {
          const s = baseSeeds[sIdx];
          const pt = fractionalToScreen(di + s.u, dj + s.v, origin, vecA, vecB);
          allCompetitors.push({ di, dj, sIdx, x: pt.x, y: pt.y });
        }
      }
    }

    const boundR =
      2.2 * Math.max(Math.hypot(vecA.x, vecA.y), Math.hypot(vecB.x, vecB.y));

    basePolys = [];
    for (let sIdx = 0; sIdx < baseSeeds.length; sIdx++) {
      const s = baseSeeds[sIdx];
      const p0 = fractionalToScreen(s.u, s.v, origin, vecA, vecB);

      let poly = [
        { x: p0.x - boundR, y: p0.y - boundR },
        { x: p0.x + boundR, y: p0.y - boundR },
        { x: p0.x + boundR, y: p0.y + boundR },
        { x: p0.x - boundR, y: p0.y + boundR }
      ];

      // Sort competitors by distance to p0 so closest Voronoi bisectors clip first
      const sorted = allCompetitors
        .map((q) => ({
          q,
          distSq: (q.x - p0.x) * (q.x - p0.x) + (q.y - p0.y) * (q.y - p0.y)
        }))
        .filter((item) => item.distSq > 1e-4)
        .sort((a, b) => a.distSq - b.distSq);

      for (const { q, distSq } of sorted) {
        const len = Math.sqrt(distSq);
        const nx = (q.x - p0.x) / len;
        const ny = (q.y - p0.y) / len;
        const mx = 0.5 * (p0.x + q.x);
        const my = 0.5 * (p0.y + q.y);
        const d = mx * nx + my * ny;
        poly = clipPolygonByHalfPlane(poly, nx, ny, d);
        if (poly.length < 3) break;
      }

      if (poly.length >= 3) {
        basePolys.push({
          vertices0: poly,
          style: s.style
        });
      }
    }

    if (cacheId) {
      voronoiBaseCache = { key: cacheKey, polys: basePolys };
    }
  }

  // 3. Translate the base (0, 0) Voronoi cell polygons to unit cell (i, j)
  const shiftX = i * vecA.x + j * vecB.x;
  const shiftY = i * vecA.y + j * vecB.y;

  return basePolys.map((bp) => {
    const vertices = bp.vertices0.map((pt) => ({
      x: pt.x + shiftX,
      y: pt.y + shiftY
    }));
    return {
      i,
      j,
      center: polygonCentroid(vertices),
      vertices,
      fill: bp.style.fill,
      stroke: bp.style.stroke,
      strokeWidth: 2
    };
  });
}

/**
 * Construct edge-to-edge tessellated polygons for one unit cell (i, j) of a given
 * plane group key ('p1'..'p6m'), cycling through 5–6 fundamentally distinct tiling
 * topologies per group (combining classic Archimedean/Laves/Co-Uniform tilings and
 * procedural Symmetric Voronoi tessellations with kites, pentagons, octagons, triangles, etc.).
 */
function buildTessellatedUnitCell(groupKey, i, j, origin, vecA, vecB, seed) {
  const passIndex = Math.floor(seed / 6);
  const basePal =
    TESSELLATION_PALETTES[(seed + passIndex) % TESSELLATION_PALETTES.length];
  const shift = (seed * 3 + passIndex) % 4;
  const styleKeys = ['primary', 'secondary', 'tertiary', 'quaternary'];
  const pal = {
    primary: basePal[styleKeys[shift % 4]],
    secondary: basePal[styleKeys[(shift + 1) % 4]],
    tertiary: basePal[styleKeys[(shift + 2) % 4]],
    quaternary: basePal[styleKeys[(shift + 3) % 4]]
  };

  // Deterministic geometric variation parameters in [0, 1) from seed
  const r1 = (((seed * 2654435761) >>> 0) % 1000) / 1000;
  const r2 = (((seed * 1597334677 + 12345) >>> 0) % 1000) / 1000;

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
  const makeVoronoi = (orbits, tag) =>
    buildPeriodicVoronoiUnitCell(
      orbits,
      i,
      j,
      origin,
      vecA,
      vecB,
      `${groupKey}_${seed}_${tag}`
    );

  switch (groupKey) {
    case 'p1': {
      const arch = seed % 5;
      if (arch === 0) {
        // Archetype 0: Interlocking L-shaped oblique paving stones
        const uSplit = 0.08 + 0.20 * r1;
        const uStep = -0.28 + 0.16 * r2;
        const vStep = -0.08 + 0.26 * r1;
        return [
          makeTile(
            [
              [-0.5, -0.5],
              [uSplit, -0.5],
              [uSplit, vStep],
              [uStep, vStep],
              [uStep, 0.5],
              [-0.5, 0.5]
            ],
            pal.primary
          ),
          makeTile(
            [
              [uSplit, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [uStep, 0.5],
              [uStep, vStep],
              [uSplit, vStep]
            ],
            pal.secondary
          )
        ];
      }
      if (arch === 1) {
        // Archetype 1: 3-Seed Asymmetric Voronoi Cobblestones (Pentagons & Hexagons)
        return makeVoronoi(
          [
            { points: [[-0.28 + 0.06 * r1, -0.24 + 0.06 * r2]], style: pal.primary },
            { points: [[0.24 + 0.06 * r2, -0.14 + 0.06 * r1]], style: pal.secondary },
            { points: [[-0.04 + 0.08 * r1, 0.28 + 0.06 * r2]], style: pal.tertiary }
          ],
          'p1_vor3'
        );
      }
      if (arch === 2) {
        // Archetype 2: 4-Seed Polygonal Mosaic (Pentagons, Quads & Heptagons)
        return makeVoronoi(
          [
            { points: [[-0.32, -0.30]], style: pal.primary },
            { points: [[0.18 + 0.07 * r1, -0.26]], style: pal.secondary },
            { points: [[-0.14, 0.16 + 0.07 * r2]], style: pal.tertiary },
            { points: [[0.30, 0.27]], style: pal.quaternary }
          ],
          'p1_vor4'
        );
      }
      if (arch === 3) {
        // Archetype 3: Slanted Asymmetric Z-Blocks & Trapezoids
        return [
          makeTile(
            [
              [-0.5, -0.5],
              [0.5, -0.5],
              [0.5, -0.12],
              [-0.14, 0.08],
              [-0.5, -0.12]
            ],
            pal.primary
          ),
          makeTile(
            [
              [-0.5, -0.12],
              [-0.14, 0.08],
              [0.18, 0.5],
              [-0.5, 0.5]
            ],
            pal.secondary
          ),
          makeTile(
            [
              [-0.14, 0.08],
              [0.5, -0.12],
              [0.5, 0.5],
              [0.18, 0.5]
            ],
            pal.tertiary
          )
        ];
      }
      // Archetype 4: 5-Seed Asymmetric Flagstone Voronoi
      return makeVoronoi(
        [
          { points: [[-0.35, -0.32]], style: pal.primary },
          { points: [[0.08, -0.34]], style: pal.secondary },
          { points: [[0.34, -0.05]], style: pal.tertiary },
          { points: [[-0.18, 0.12]], style: pal.quaternary },
          { points: [[0.16, 0.33]], style: pal.primary }
        ],
        'p1_vor5'
      );
    }

    case 'p2': {
      const arch = seed % 5;
      if (arch === 0) {
        // Archetype 0: Herringbone / Running-Bond Paving Bricks
        const w = 0.28 + 0.11 * r1;
        const v1 = 0.11 + 0.07 * r2;
        const v2 = v1 + 0.05 + 0.07 * r1;
        return [
          makeTile(
            [
              [-w, -v1],
              [w, -v2],
              [w, v1],
              [-w, v2]
            ],
            pal.secondary
          ),
          makeTile(
            [
              [-w, v2],
              [w, v1],
              [w, 1 - v2],
              [-w, 1 - v1]
            ],
            pal.primary
          ),
          makeTile(
            [
              [w, -v2],
              [1 - w, -v1],
              [1 - w, v2],
              [w, v1]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [w, v1],
              [1 - w, v2],
              [1 - w, 1 - v1],
              [w, 1 - v2]
            ],
            pal.quaternary
          )
        ];
      }
      if (arch === 1) {
        // Archetype 1: Cairo-Style 2-Fold Pentagonal Voronoi Tiling
        const u1 = 0.19 + 0.06 * r1;
        const v1 = 0.14 + 0.06 * r2;
        return makeVoronoi(
          [
            { points: orbitP2(u1, v1), style: pal.primary },
            { points: [[0.5, 0], [0, 0.5]], style: pal.secondary }
          ],
          'p2_pent'
        );
      }
      if (arch === 2) {
        // Archetype 2: Chiral Hexagons & Pentagons around Wyckoff Centers (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: [[0.5, 0.5]], style: pal.secondary },
            { points: orbitP2(0.27 + 0.05 * r1, 0.16 + 0.05 * r2), style: pal.tertiary }
          ],
          'p2_hexpent'
        );
      }
      if (arch === 3) {
        // Archetype 3: Dual-Pair Interlocking Pentagons (4 Pentagons per cell, Voronoi)
        return makeVoronoi(
          [
            { points: orbitP2(0.22, 0.12), style: pal.primary },
            {
              points: [
                [0.5 + 0.14, 0.24],
                [0.5 - 0.14, -0.24]
              ],
              style: pal.secondary
            },
            { points: [[0, 0.5]], style: pal.tertiary }
          ],
          'p2_dualpent'
        );
      }
      // Archetype 4: 4-Wyckoff + Chiral Orbit Bowtie & Diamond Tessellation (Voronoi)
      return makeVoronoi(
        [
          { points: [[0, 0]], style: pal.primary },
          { points: [[0.5, 0]], style: pal.secondary },
          { points: [[0, 0.5]], style: pal.tertiary },
          { points: orbitP2(0.24, 0.31), style: pal.quaternary }
        ],
        'p2_bowtie'
      );
    }

    case 'pm': {
      const arch = seed % 5;
      if (arch === 0) {
        // Archetype 0: Interlocking Stepped Chevron Paving Courses
        const peak = 0.18 + 0.16 * r1;
        const courseSplit = -0.04 + 0.14 * r2;
        const peakMid = peak * (0.38 + 0.38 * r2);
        return [
          makeTile(
            [
              [-0.5, -0.5],
              [-0.25, -0.5 + peakMid],
              [0, -0.5 + peak],
              [0.25, -0.5 + peakMid],
              [0.5, -0.5],
              [0.5, courseSplit],
              [0.25, courseSplit + peakMid],
              [0, courseSplit + peak],
              [-0.25, courseSplit + peakMid],
              [-0.5, courseSplit]
            ],
            pal.primary
          ),
          makeTile(
            [
              [-0.5, courseSplit],
              [-0.25, courseSplit + peakMid],
              [0, courseSplit + peak],
              [0.25, courseSplit + peakMid],
              [0.5, courseSplit],
              [0.5, 0.5],
              [0.25, 0.5 + peakMid],
              [0, 0.5 + peak],
              [-0.25, 0.5 + peakMid],
              [-0.5, 0.5]
            ],
            pal.secondary
          )
        ];
      }
      if (arch === 1) {
        // Archetype 1: Upward House-Pentagons & Kites (Voronoi with vertical mirror only)
        return makeVoronoi(
          [
            { points: [[0, -0.26]], style: pal.primary },
            { points: [[0.5, 0.18]], style: pal.secondary },
            { points: orbitPm(0.26, -0.02), style: pal.tertiary }
          ],
          'pm_houses'
        );
      }
      if (arch === 2) {
        // Archetype 2: Tapered Keystone & Arrowhead Columns
        const w0 = 0.18 + 0.06 * r1;
        const w1 = 0.34 + 0.06 * r2;
        return [
          // Central Arrowhead Keystone on u = 0 mirror
          makeTile(
            [
              [-w0, -0.5],
              [w0, -0.5],
              [w1, 0.05],
              [0, 0.32],
              [-w1, 0.05]
            ],
            pal.primary
          ),
          // Upper Cap on u = 0 mirror
          makeTile(
            [
              [-w1, 0.05],
              [0, 0.32],
              [w1, 0.05],
              [w0, 0.5],
              [-w0, 0.5]
            ],
            pal.secondary
          ),
          // Left & Right Mirror Flanking Pentagons meeting at u = ±0.5
          makeTile(
            [
              [w0, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [w0, 0.5],
              [w1, 0.05]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [-0.5, -0.5],
              [-w0, -0.5],
              [-w1, 0.05],
              [-w0, 0.5],
              [-0.5, 0.5]
            ],
            pal.tertiary
          )
        ];
      }
      if (arch === 3) {
        // Archetype 3: Scalloped Shield & Pentagon Courses (5-Seed Mirror Voronoi)
        return makeVoronoi(
          [
            { points: [[0, -0.28]], style: pal.primary },
            { points: [[0, 0.24]], style: pal.secondary },
            { points: [[0.5, -0.18]], style: pal.tertiary },
            { points: orbitPm(0.27, 0.14), style: pal.quaternary }
          ],
          'pm_shields'
        );
      }
      // Archetype 4: Dual Mirror Pair Pentagons & Diamonds (Voronoi)
      return makeVoronoi(
        [
          { points: orbitPm(0.22, -0.22), style: pal.primary },
          { points: orbitPm(0.30, 0.20), style: pal.secondary },
          { points: [[0, 0.05]], style: pal.tertiary },
          { points: [[0.5, -0.32]], style: pal.quaternary }
        ],
        'pm_dualmirror'
      );
    }

    case 'pmm': {
      const arch = seed % 5;
      if (arch === 0) {
        // Archetype 0: Co-Uniform Hexagons, Rectangles, and Trapezoids (Wikipedia pmm SVG)
        const a = 0.22 + 0.06 * r1;
        const b = 0.22 + 0.06 * r2;
        const tip = a + 0.10;
        return [
          makeTile(
            [
              [-a, -b],
              [a, -b],
              [tip, 0],
              [a, b],
              [-a, b],
              [-tip, 0]
            ],
            pal.primary
          ),
          makeTile(
            [
              [-a, b],
              [a, b],
              [a, 1 - b],
              [-a, 1 - b]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [a, b],
              [1 - a, b],
              [1 - a, 1 - b],
              [a, 1 - b]
            ],
            pal.quaternary
          ),
          makeTile(
            [
              [tip, 0],
              [a, -b],
              [0.5, -b],
              [0.5, b],
              [a, b]
            ],
            pal.secondary
          ),
          makeTile(
            [
              [0.5, -b],
              [1 - a, -b],
              [1 - tip, 0],
              [1 - a, b],
              [0.5, b]
            ],
            pal.secondary
          )
        ];
      }
      if (arch === 1) {
        // Archetype 1: Octagons, Kites & Corner Diamonds (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: [[0.5, 0.5]], style: pal.secondary },
            { points: orbitPmm(0.28, 0.24), style: pal.tertiary }
          ],
          'pmm_octkites'
        );
      }
      if (arch === 2) {
        // Archetype 2: House Pentagons & Central Cross-Hexagon (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: orbitPmm(0, 0.30), style: pal.secondary },
            { points: orbitPmm(0.32, 0.5), style: pal.tertiary },
            { points: [[0.5, 0]], style: pal.quaternary }
          ],
          'pmm_pentcross'
        );
      }
      if (arch === 3) {
        // Archetype 3: Rhombic Argyle & Right-Pentagon Grid
        const d = 0.28 + 0.08 * r1;
        const c = 0.20 + 0.06 * r2;
        return [
          // Central Rhombus at (0, 0)
          makeTile(
            [
              [0, -d],
              [d, 0],
              [0, d],
              [-d, 0]
            ],
            pal.primary
          ),
          // Corner Rectangle at (0.5, 0.5)
          makeTile(
            [
              [0.5 - c, 0.5 - c],
              [0.5 + c, 0.5 - c],
              [0.5 + c, 0.5 + c],
              [0.5 - c, 0.5 + c]
            ],
            pal.secondary
          ),
          // 4 Mirror-Symmetric Pentagons/Hexagons in the 4 quadrants
          makeTile(
            [
              [d, 0],
              [0.5, 0],
              [0.5, 0.5 - c],
              [0.5 - c, 0.5 - c],
              [0.5 - c, 0.5],
              [0, 0.5],
              [0, d]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [0, d],
              [0, 0.5],
              [-0.5 + c, 0.5],
              [-0.5 + c, 0.5 - c],
              [-0.5, 0.5 - c],
              [-0.5, 0],
              [-d, 0]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [-d, 0],
              [-0.5, 0],
              [-0.5, -0.5 + c],
              [-0.5 + c, -0.5 + c],
              [-0.5 + c, -0.5],
              [0, -0.5],
              [0, -d]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [0, -d],
              [0, -0.5],
              [0.5 - c, -0.5],
              [0.5 - c, -0.5 + c],
              [0.5, -0.5 + c],
              [0.5, 0],
              [d, 0]
            ],
            pal.tertiary
          )
        ];
      }
      // Archetype 4: 4-Wyckoff + Quadrant Seeds (Octagons, Diamonds & Pentagons Voronoi)
      return makeVoronoi(
        [
          { points: [[0, 0]], style: pal.primary },
          { points: [[0.5, 0]], style: pal.secondary },
          { points: [[0, 0.5]], style: pal.tertiary },
          { points: [[0.5, 0.5]], style: pal.primary },
          { points: orbitPmm(0.25, 0.25), style: pal.quaternary }
        ],
        'pmm_wyckoffvor'
      );
    }

    case 'p4': {
      const arch = seed % 5;
      if (arch === 0) {
        // Archetype 0: Pinwheel / Basketweave Paving Bricks
        const a = 0.19 + 0.06 * r1;
        const b = 0.06 + 0.05 * r2;
        return [
          makeTile(
            [
              [a, b],
              [-b, a],
              [-a, -b],
              [b, -a]
            ],
            pal.primary
          ),
          makeTile(
            [
              [0.5 + b, 0.5 - a],
              [0.5 + a, 0.5 + b],
              [0.5 - b, 0.5 + a],
              [0.5 - a, 0.5 - b]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [a, b],
              [b, -a],
              [0.5 - b, -0.5 + a],
              [1 - a, -0.5 + b],
              [1 - a, -b],
              [1 - b, a],
              [0.5 + b, 0.5 - a],
              [0.5 - a, 0.5 - b]
            ],
            pal.secondary
          ),
          makeTile(
            [
              [-b, a],
              [a, b],
              [0.5 - a, 0.5 - b],
              [0.5 - b, 1 - a],
              [b, 1 - a],
              [-a, 1 - b],
              [-0.5 + a, 0.5 + b],
              [-0.5 + b, 0.5 - a]
            ],
            pal.secondary
          )
        ];
      }
      if (arch === 1) {
        // Archetype 1: Cairo-Family Chiral Pentagonal Tiling + Center Square (Voronoi)
        return makeVoronoi(
          [
            { points: orbitP4(0.25, 0.11), style: pal.primary },
            { points: [[0.5, 0.5]], style: pal.secondary }
          ],
          'p4_cairo'
        );
      }
      if (arch === 2) {
        // Archetype 2: Chiral Octagon, Swirling Pentagons & Tilted Square (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: [[0.5, 0.5]], style: pal.secondary },
            { points: orbitP4(0.30, 0.13), style: pal.tertiary }
          ],
          'p4_swirl'
        );
      }
      if (arch === 3) {
        // Archetype 3: Dual-Pinwheel Chiral Pentagons & Edge Diamonds (Voronoi)
        return makeVoronoi(
          [
            { points: orbitP4(0.21, 0.08), style: pal.primary },
            { points: orbitP4Center(0.09, 0.21), style: pal.secondary },
            { points: [[0.5, 0], [0, 0.5]], style: pal.tertiary }
          ],
          'p4_dualpinwheel'
        );
      }
      // Archetype 4: Chiral Windmill Triangles & Tilted Squares
      const a = 0.22;
      const b = 0.09;
      const p0 = [a, b];
      const p1 = [-b, a];
      const p2 = [-a, -b];
      const p3 = [b, -a];
      const c = [0.5, 0.5];
      return [
        // Central Tilted Square at (0, 0)
        makeTile([p0, p1, p2, p3], pal.primary),
        // 4 Chiral Quadrilaterals radiating from the 4 edges of the central square to (0.5, 0.5)
        makeTile([p0, [1 + p3[0], p3[1]], c, p1], pal.secondary),
        makeTile([p1, c, [p2[0], 1 + p2[1]], [p0[0], 1 + p0[1]]], pal.secondary),
        makeTile([[p1[0] - 1, p1[1]], p0, [p3[0], p3[1] - 1], [c[0] - 1, c[1] - 1]], pal.secondary),
        makeTile([p3, [1 + p2[0], p2[1]], [1 + p1[0], p1[1]], c], pal.secondary)
      ];
    }

    case 'p4m': {
      const arch = seed % 6;
      if (arch === 0) {
        // Archetype 0: Classic Truncated Square (Tile_488.svg: Regular Octagons + Tilted Squares)
        const c = 0.207;
        return [
          makeTile(
            [
              [-c, -0.5],
              [c, -0.5],
              [0.5, -c],
              [0.5, c],
              [c, 0.5],
              [-c, 0.5],
              [-0.5, c],
              [-0.5, -c]
            ],
            pal.primary
          ),
          makeTile(
            [
              [0.5, c],
              [1 - c, 0.5],
              [0.5, 1 - c],
              [c, 0.5]
            ],
            pal.secondary
          )
        ];
      }
      if (arch === 1) {
        // Archetype 1: Tetrakis Square (Tile_V488.svg: 8 Right Triangles around (0,0) & (½,½))
        // Subdivided by a concentric star-octagon ring so all 4 mirror axes (0°, 45°, 90°, 135°)
        // and 4-fold centers map every triangle/trapezoid onto a tile of the exact same color!
        const rAx = 0.27;
        const rDiag = 0.24;
        const ring = [
          [rAx, 0],
          [rDiag, rDiag],
          [0, rAx],
          [-rDiag, rDiag],
          [-rAx, 0],
          [-rDiag, -rDiag],
          [0, -rAx],
          [rDiag, -rDiag]
        ];
        const outer = [
          [0.5, 0],
          [0.5, 0.5],
          [0, 0.5],
          [-0.5, 0.5],
          [-0.5, 0],
          [-0.5, -0.5],
          [0, -0.5],
          [0.5, -0.5]
        ];
        const tiles = [];
        for (let k = 0; k < 8; k++) {
          const kn = (k + 1) % 8;
          // Inner star triangle meeting at (0, 0)
          tiles.push(makeTile([[0, 0], ring[k], ring[kn]], pal.primary));
          // Outer Tetrakis trapezoid/triangle meeting at (0.5, 0.5) and (0.5, 0)
          tiles.push(makeTile([ring[k], outer[k], outer[kn], ring[kn]], pal.secondary));
        }
        return tiles;
      }
      if (arch === 2) {
        // Archetype 2: Kites, Squares & Pentagons (4 Pointed Kites at (0,0) + 4 Convex Pentagons + Edge & Center Squares)
        return [
          // 4 Kites meeting at (0, 0) along the axial mirrors
          makeTile([[0, 0], [0.11, -0.11], [0.36, 0], [0.11, 0.11]], pal.primary),
          makeTile([[0, 0], [0.11, 0.11], [0, 0.36], [-0.11, 0.11]], pal.primary),
          makeTile([[0, 0], [-0.11, 0.11], [-0.36, 0], [-0.11, -0.11]], pal.primary),
          makeTile([[0, 0], [-0.11, -0.11], [0, -0.36], [0.11, -0.11]], pal.primary),
          // 4 Convex Pentagons on the diagonal mirrors
          makeTile([[0.11, 0.11], [0.36, 0], [0.5, 0.14], [0.14, 0.5], [0, 0.36]], pal.secondary),
          makeTile([[-0.11, 0.11], [0, 0.36], [-0.14, 0.5], [-0.5, 0.14], [-0.36, 0]], pal.secondary),
          makeTile([[-0.11, -0.11], [-0.36, 0], [-0.5, -0.14], [-0.14, -0.5], [0, -0.36]], pal.secondary),
          makeTile([[0.11, -0.11], [0, -0.36], [0.14, -0.5], [0.5, -0.14], [0.36, 0]], pal.secondary),
          // 2 Tilted Squares at edge midpoints (0.5, 0) and (0, 0.5)
          makeTile([[0.36, 0], [0.5, -0.14], [0.64, 0], [0.5, 0.14]], pal.tertiary),
          makeTile([[0, 0.36], [0.14, 0.5], [0, 0.64], [-0.14, 0.5]], pal.tertiary),
          // Tilted Square at cell center (0.5, 0.5)
          makeTile([[0.5, 0.14], [0.86, 0.5], [0.5, 0.86], [0.14, 0.5]], pal.quaternary)
        ];
      }
      if (arch === 3) {
        // Archetype 3: Co-Uniform Octagons, Hexagons, Squares & Trapezoids (Wikipedia Co-Uniform_Wallpaper_Example_p4m.svg)
        return [
          // Central Octagon at (0, 0)
          makeTile(
            [
              [-0.14, -0.34],
              [0.14, -0.34],
              [0.34, -0.14],
              [0.34, 0.14],
              [0.14, 0.34],
              [-0.14, 0.34],
              [-0.34, 0.14],
              [-0.34, -0.14]
            ],
            pal.primary
          ),
          // Tilted Square at cell center (0.5, 0.5)
          makeTile(
            [
              [0.5, 0.28],
              [0.72, 0.5],
              [0.5, 0.72],
              [0.28, 0.5]
            ],
            pal.secondary
          ),
          // 2 Edge Hexagons at (0.5, 0) and (0, 0.5)
          makeTile(
            [
              [0.34, -0.14],
              [0.5, -0.28],
              [0.66, -0.14],
              [0.66, 0.14],
              [0.5, 0.28],
              [0.34, 0.14]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [-0.14, 0.34],
              [0.14, 0.34],
              [0.28, 0.5],
              [0.14, 0.66],
              [-0.14, 0.66],
              [-0.28, 0.5]
            ],
            pal.tertiary
          ),
          // 4 Diagonal Trapezoids bridging Octagon, Hexagons, and Center Square
          makeTile([[0.14, 0.34], [0.34, 0.14], [0.5, 0.28], [0.28, 0.5]], pal.quaternary),
          makeTile([[-0.34, 0.14], [-0.14, 0.34], [-0.28, 0.5], [-0.5, 0.28]], pal.quaternary),
          makeTile([[-0.14, -0.34], [-0.34, -0.14], [-0.5, -0.28], [-0.28, -0.5]], pal.quaternary),
          makeTile([[0.34, -0.14], [0.14, -0.34], [0.28, -0.5], [0.5, -0.28]], pal.quaternary)
        ];
      }
      if (arch === 4) {
        // Archetype 4: Cantellated Square (Octagons at (0,0) & (½,½) + Orthogonal Edge Squares)
        const c = 0.16;
        const e = 0.38;
        return [
          makeTile(
            [
              [-c, -e],
              [c, -e],
              [e, -c],
              [e, c],
              [c, e],
              [-c, e],
              [-e, c],
              [-e, -c]
            ],
            pal.primary
          ),
          makeTile(
            [
              [e, c],
              [1 - e, c],
              [1 - c, e],
              [1 - c, 1 - e],
              [1 - e, 1 - c],
              [e, 1 - c],
              [c, 1 - e],
              [c, e]
            ],
            pal.secondary
          ),
          makeTile(
            [
              [e, -c],
              [1 - e, -c],
              [1 - e, c],
              [e, c]
            ],
            pal.tertiary
          ),
          makeTile(
            [
              [-c, e],
              [c, e],
              [c, 1 - e],
              [-c, 1 - e]
            ],
            pal.tertiary
          )
        ];
      }
      // Archetype 5: Star-Octagon, Kites & Pentagons Rosette (Voronoi)
      return makeVoronoi(
        [
          { points: [[0, 0]], style: pal.primary },
          { points: orbitP4m(0.28, 0), style: pal.secondary },
          { points: orbitP4m(0.24, 0.24), style: pal.tertiary },
          { points: [[0.5, 0.5]], style: pal.quaternary }
        ],
        'p4m_rosette'
      );
    }

    case 'p6m': {
      const arch = seed % 5;
      if (arch === 0) {
        // Archetype 0: Classic Archimedean Trihexagonal (Kagome 3.6.3.6: Hexagons + Triangles)
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
      if (arch === 1) {
        // Archetype 1: Archimedean Rhombitrihexagonal (3.4.6.4: Hexagons + Squares + Triangles)
        const u0 = 0.36;
        const v0 = 0.18;
        const w = orbitP6(u0, v0);
        const [w0, w1, w2, w3, w4, w5] = w;
        return [
          makeTile([w0, w1, w2, w3, w4, w5], pal.primary),
          makeTile([w0, [1 + w2[0], w2[1]], [1 + w4[0], 1 + w4[1]]], pal.secondary),
          makeTile([w1, [1 + w3[0], 1 + w3[1]], [w5[0], 1 + w5[1]]], pal.secondary),
          makeTile([w0, [1 + w2[0], w2[1]], [1 + w3[0], w3[1]], w5], pal.tertiary),
          makeTile([w1, [1 + w3[0], 1 + w3[1]], [1 + w4[0], 1 + w4[1]], w0], pal.tertiary),
          makeTile([w2, [w4[0], 1 + w4[1]], [w5[0], 1 + w5[1]], w1], pal.tertiary)
        ];
      }
      if (arch === 2) {
        // Archetype 2: Deltoidal Trihexagonal (Laves Kites meeting at (0,0) + Hexagons at (⅔,⅓)&(⅓,⅔))
        return makeVoronoi(
          [
            { points: orbitP6m(0.25, 0), style: pal.primary },
            {
              points: [
                [2 / 3, 1 / 3],
                [1 / 3, 2 / 3]
              ],
              style: pal.secondary
            }
          ],
          'p6m_kites'
        );
      }
      if (arch === 3) {
        // Archetype 3: Symmetric Pentagons, Central Hexagon & Edge Diamonds (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: orbitP6m(0.32, 0.16), style: pal.secondary },
            {
              points: [
                [0.5, 0],
                [0, 0.5],
                [0.5, 0.5]
              ],
              style: pal.tertiary
            }
          ],
          'p6m_pentdiamonds'
        );
      }
      // Archetype 4: 12-Fold Star Rosette, Kites & Trigonal Hexagons (Voronoi)
      return makeVoronoi(
        [
          { points: [[0, 0]], style: pal.primary },
          { points: orbitP6m(0.28, 0), style: pal.secondary },
          {
            points: [
              [2 / 3, 1 / 3],
              [1 / 3, 2 / 3]
            ],
            style: pal.tertiary
          },
          {
            points: [
              [0.5, 0],
              [0, 0.5],
              [0.5, 0.5]
            ],
            style: pal.quaternary
          }
        ],
        'p6m_rosette'
      );
    }

    case 'p6': {
      const arch = seed % 5;
      if (arch === 0) {
        // Archetype 0: Chiral Rhombi-Trihexagonal Tessellation (Hexagon + 2 Triangles + 3 Chiral Parallelograms)
        const u0 = 0.35;
        const v0 = 0.09;
        const [w0, w1, w2, w3, w4, w5] = orbitP6(u0, v0);
        return [
          makeTile([w0, w1, w2, w3, w4, w5], pal.primary),
          makeTile([w0, [1 + w2[0], w2[1]], [1 + w4[0], 1 + w4[1]]], pal.secondary),
          makeTile([w1, [1 + w3[0], 1 + w3[1]], [w5[0], 1 + w5[1]]], pal.secondary),
          makeTile([w0, [1 + w2[0], w2[1]], [1 + w3[0], w3[1]], w5], pal.tertiary),
          makeTile([w1, [1 + w3[0], 1 + w3[1]], [1 + w4[0], 1 + w4[1]], w0], pal.tertiary),
          makeTile([w2, [w4[0], 1 + w4[1]], [w5[0], 1 + w5[1]], w1], pal.tertiary)
        ];
      }
      if (arch === 1) {
        // Archetype 1: Floret Chiral Pentagonal Tiling (6 Swirling Pentagons around (0,0) + Trigonal Hexagons)
        return makeVoronoi(
          [
            { points: orbitP6(0.25, 0.08), style: pal.primary },
            {
              points: [
                [2 / 3, 1 / 3],
                [1 / 3, 2 / 3]
              ],
              style: pal.secondary
            }
          ],
          'p6_floret'
        );
      }
      if (arch === 2) {
        // Archetype 2: Chiral Hexagon + 6 Pentagons + 3 Edge Rhombi (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: orbitP6(0.31, 0.09), style: pal.secondary },
            {
              points: [
                [0.5, 0],
                [0, 0.5],
                [0.5, 0.5]
              ],
              style: pal.tertiary
            }
          ],
          'p6_sunburst'
        );
      }
      if (arch === 3) {
        // Archetype 3: Chiral Pinwheel Kites & Trigonal Rosettes (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: orbitP6(0.36, 0.11), style: pal.secondary },
            {
              points: [
                [2 / 3, 1 / 3],
                [1 / 3, 2 / 3]
              ],
              style: pal.tertiary
            }
          ],
          'p6_pinwheel'
        );
      }
      // Archetype 4: 6-Fold Chiral Pentagons + Edge Diamonds (Voronoi)
      return makeVoronoi(
        [
          { points: orbitP6(0.22, 0.07), style: pal.primary },
          {
            points: [
              [0.5, 0],
              [0, 0.5],
              [0.5, 0.5]
            ],
            style: pal.secondary
          },
          {
            points: [
              [2 / 3, 1 / 3],
              [1 / 3, 2 / 3]
            ],
            style: pal.tertiary
          }
        ],
        'p6_pentdiamond'
      );
    }

    case 'p3': {
      const arch = seed % 5;
      if (arch === 0) {
        // Archetype 0: Chiral 3-Fold 6-Gon + 2 Distinctly Colored Equilateral Triangles
        const u0 = 0.52;
        const v0 = 0.13;
        const [v0Pt, v1Pt, v2Pt] = orbitP3(u0, v0);
        return [
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
          makeTile(
            [
              v0Pt,
              [1 + v1Pt[0], v1Pt[1]],
              [1 + v2Pt[0], 1 + v2Pt[1]]
            ],
            pal.secondary
          ),
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
      if (arch === 1) {
        // Archetype 1: Trigonal Pentagonal Pinwheel (3 Pentagons meeting at (0,0) + 2 Chiral Hexagons)
        return makeVoronoi(
          [
            { points: orbitP3(0.26, 0.08), style: pal.primary },
            { points: [[2 / 3, 1 / 3]], style: pal.secondary },
            { points: [[1 / 3, 2 / 3]], style: pal.tertiary }
          ],
          'p3_pentpinwheel'
        );
      }
      if (arch === 2) {
        // Archetype 2: Chiral Hexagon at (0,0) + 3 Pentagons around (⅔,⅓) + Hexagon at (⅓,⅔) (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: orbitP3Around(2 / 3, 1 / 3, 0.23, 0.07), style: pal.secondary },
            { points: [[1 / 3, 2 / 3]], style: pal.tertiary }
          ],
          'p3_bpinwheel'
        );
      }
      if (arch === 3) {
        // Archetype 3: Triple-Wyckoff Chiral Kites, Pentagons & Hexagons (Voronoi)
        return makeVoronoi(
          [
            { points: [[0, 0]], style: pal.primary },
            { points: orbitP3(0.32, 0.11), style: pal.secondary },
            { points: [[2 / 3, 1 / 3]], style: pal.tertiary },
            { points: [[1 / 3, 2 / 3]], style: pal.quaternary }
          ],
          'p3_triple'
        );
      }
      // Archetype 4: Dual 3-Fold Pinwheels (6 Pentagons/Hexagons per cell + C-center, Voronoi)
      return makeVoronoi(
        [
          { points: orbitP3(0.22, 0.06), style: pal.primary },
          { points: orbitP3Around(2 / 3, 1 / 3, 0.21, 0.08), style: pal.secondary },
          { points: [[1 / 3, 2 / 3]], style: pal.tertiary }
        ],
        'p3_dualpin'
      );
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

  const checklistId = bestSite.checklistId || `wp_rot_${order}_00`;
  const checklistLabel =
    bestSite.checklistLabel || `${order}-fold axis at ${bestSite.siteName}`;

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

  const rounded = Math.round(matchedAngle);
  const isRectOrSquare =
    preset.latticeType === 'rectangular' || preset.latticeType === 'square';
  const splitsEdgeAndMid =
    isRectOrSquare && (rounded === 0 || rounded === 90);

  let minLineOffset = Infinity;
  let bestAnchorPt = origin;
  let bestFamily = 'single'; // 'edge' | 'mid' | 'single'

  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      let candidateShifts;
      if (preset.latticeType === 'hexagonal') {
        candidateShifts = [{ u: i, v: j, family: 'single' }];
      } else if (splitsEdgeAndMid && rounded === 90) {
        candidateShifts = [
          { u: i, v: j, family: 'edge' },
          { u: i + 0.5, v: j, family: 'mid' }
        ];
      } else if (splitsEdgeAndMid && rounded === 0) {
        candidateShifts = [
          { u: i, v: j, family: 'edge' },
          { u: i, v: j + 0.5, family: 'mid' }
        ];
      } else {
        // 45° and 135° diagonal mirrors in p4m pass through (i, j) and (i + 0.5, j + 0.5)
        candidateShifts = [
          { u: i, v: j, family: 'single' },
          { u: i + 0.5, v: j + 0.5, family: 'single' }
        ];
      }

      for (const s of candidateShifts) {
        const pt = fractionalToScreen(s.u, s.v, origin, vecA, vecB);
        const d = pointToLineDistance(pt, p1, p2);
        if (d < minLineOffset) {
          minLineOffset = d;
          bestAnchorPt = pt;
          bestFamily = s.family;
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

  let checklistId = `wp_mirror_${rounded}`;
  let checklistLabel = `Mirror plane at ${rounded}°`;
  let familyDesc = `${rounded}° mirror axis`;

  if (splitsEdgeAndMid) {
    if (bestFamily === 'edge') {
      checklistId = `wp_mirror_${rounded}_edge`;
      checklistLabel = `Mirror plane at ${rounded}° (cell edge)`;
      familyDesc = `${rounded}° cell-edge mirror axis`;
    } else {
      checklistId = `wp_mirror_${rounded}_mid`;
      checklistLabel = `Mirror plane at ${rounded}° (cell center)`;
      familyDesc = `${rounded}° mid-cell mirror axis`;
    }
  }

  return {
    valid: true,
    checklistId,
    checklistLabel,
    angleDeg: rounded,
    rectifiedEndpoints,
    message: `Verified! Reflection across the ${familyDesc} maps the entire periodic tiling onto itself.`
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

  if (preset.key === 'p1') {
    items.push({
      id: 'wp_no_symmetry',
      type: 'asymmetric',
      label: 'Asymmetric unit cell verified (0 rotational or mirror elements)'
    });
  } else {
    const wyckoffSites = getWyckoffRotationSites(preset.key);
    for (const site of wyckoffSites) {
      items.push({
        id: site.checklistId,
        type: 'rotation',
        order: site.maxOrder,
        label: site.checklistLabel
      });
    }
  }

  const isRectOrSquare =
    preset.latticeType === 'rectangular' || preset.latticeType === 'square';

  for (const angle of preset.mirrorAnglesDeg) {
    const rounded = Math.round(angle);
    if (isRectOrSquare && (rounded === 0 || rounded === 90)) {
      items.push(
        {
          id: `wp_mirror_${rounded}_edge`,
          type: 'mirror',
          angleDeg: rounded,
          label: `Mirror plane at ${rounded}° (cell edge)`
        },
        {
          id: `wp_mirror_${rounded}_mid`,
          type: 'mirror',
          angleDeg: rounded,
          label: `Mirror plane at ${rounded}° (cell center)`
        }
      );
    } else {
      items.push({
        id: `wp_mirror_${rounded}`,
        type: 'mirror',
        angleDeg: rounded,
        label: `Mirror plane at ${rounded}°`
      });
    }
  }

  return items;
}
