/**
 * symmetryData.js
 * Crystallographic symmetry definitions for 2D Point Groups (Shape Mode)
 * and Glide-Free Plane Groups (Wallpaper Mode).
 *
 * Strictly excludes glide reflections (g) and glide-bearing plane groups (p3m1, p31m, pg, cm, pmg, pgg, cmm, p4g).
 * Student-facing UI labels strictly omit Hermann-Mauguin / international notation.
 */

export const POINT_GROUP_PRESETS = [
  {
    id: 'pg_1',
    label: 'Asymmetric Crystal Profile (No Rotation or Mirrors)',
    rotations: [],
    nFold: 1,
    hasMirrors: false,
    mirrorCount: 0,
    baseAngleDeg: 0,
    hasInversion2D: false,
    mineralHint: 'Triclinic pinacoidal section — only 360° identity returns the shape to itself.'
  },
  {
    id: 'pg_m',
    label: 'Bilateral Crystal Profile (Single Mirror Plane)',
    rotations: [],
    nFold: 1,
    hasMirrors: true,
    mirrorCount: 1,
    baseAngleDeg: 90, // Vertical mirror plane at 90°
    hasInversion2D: false,
    mineralHint: 'Monoclinic domatic section — one reflection plane divides the crystal into enantiomorphic halves.'
  },
  {
    id: 'pg_2',
    label: 'Digonal Pinwheel Profile (2-fold Rotation Only)',
    rotations: [2],
    nFold: 2,
    hasMirrors: false,
    mirrorCount: 0,
    baseAngleDeg: 0,
    hasInversion2D: true,
    mineralHint: 'Monoclinic sphenoidal / centrosymmetric section — invariant under 180° rotation (and 2D point inversion).'
  },
  {
    id: 'pg_2mm',
    label: 'Orthorhombic Prism Profile (2-fold + 2 Orthogonal Mirrors)',
    rotations: [2],
    nFold: 2,
    hasMirrors: true,
    mirrorCount: 2,
    baseAngleDeg: 0, // Mirrors at 0° and 90°
    hasInversion2D: true,
    mineralHint: 'Orthorhombic basal section (e.g., olivine, barite) — one 2-fold rotor at the intersection of two perpendicular mirrors.'
  },
  {
    id: 'pg_3',
    label: 'Trigonal Chiral Profile (3-fold Rotation Only)',
    rotations: [3],
    nFold: 3,
    hasMirrors: false,
    mirrorCount: 0,
    baseAngleDeg: 90,
    hasInversion2D: false,
    mineralHint: 'Trigonal pyramid basal section — invariant under 120° rotations with no mirror planes.'
  },
  {
    id: 'pg_3m',
    label: 'Ditrigonal Tourmaline Profile (3-fold + 3 Mirror Planes)',
    rotations: [3],
    nFold: 3,
    hasMirrors: true,
    mirrorCount: 3,
    baseAngleDeg: 90, // Mirrors at 90°, 30°, 150°
    hasInversion2D: false,
    mineralHint: 'Tourmaline cross-section — a 3-fold axis intersected by three mirror planes spaced 60° apart.'
  },
  {
    id: 'pg_4',
    label: 'Tetragonal Pinwheel Profile (4-fold Rotation Only)',
    rotations: [4],
    nFold: 4,
    hasMirrors: false,
    mirrorCount: 0,
    baseAngleDeg: 0,
    hasInversion2D: true,
    mineralHint: 'Scheelite / wulfenite basal section — 90° rotational invariance without reflection planes.'
  },
  {
    id: 'pg_4mm',
    label: 'Ditetragonal Zircon Profile (4-fold + 4 Mirror Planes)',
    rotations: [4],
    nFold: 4,
    hasMirrors: true,
    mirrorCount: 4,
    baseAngleDeg: 0, // Mirrors at 0°, 45°, 90°, 135°
    hasInversion2D: true,
    mineralHint: 'Zircon / idocrase basal section — a central 4-fold rotor with four mirror planes spaced 45° apart.'
  },
  {
    id: 'pg_6',
    label: 'Hexagonal Pinwheel Profile (6-fold Rotation Only)',
    rotations: [6],
    nFold: 6,
    hasMirrors: false,
    mirrorCount: 0,
    baseAngleDeg: 0,
    hasInversion2D: true,
    mineralHint: 'Nepheline / apatite basal section — 60° rotational invariance with chiral bevel faces.'
  },
  {
    id: 'pg_6mm',
    label: 'Dihexagonal Beryl Profile (6-fold + 6 Mirror Planes)',
    rotations: [6],
    nFold: 6,
    hasMirrors: true,
    mirrorCount: 6,
    baseAngleDeg: 0, // Mirrors at 0°, 30°, 60°, 90°, 120°, 150°
    hasInversion2D: true,
    mineralHint: 'Beryl / emerald basal section — a central 6-fold rotor with six mirror planes spaced 30° apart.'
  }
];

/**
 * Standard primitive glide-free plane group keys:
 * ['p1', 'p2', 'pm', 'pmm', 'p4', 'p4m', 'p3', 'p6', 'p6m']
 * Student-facing UI strictly uses `label` (no Hermann-Mauguin symbols).
 */
export const WALLPAPER_PRESETS = {
  p1: {
    key: 'p1',
    label: 'Oblique Periodic Motif (Translations Only)',
    latticeType: 'oblique',
    aRatio: 1.0,
    bRatio: 0.84,
    gammaDeg: 72,
    rotations: [],
    mirrorAnglesDeg: [],
    hasInversion2D: false,
    description: 'Oblique lattice where asymmetric motifs repeat strictly by lattice translation vectors a and b.'
  },
  p2: {
    key: 'p2',
    label: 'Oblique Lattice with 2-fold Rotocenters',
    latticeType: 'oblique',
    aRatio: 1.0,
    bRatio: 0.84,
    gammaDeg: 72,
    rotations: [2],
    mirrorAnglesDeg: [],
    hasInversion2D: true,
    description: 'Oblique lattice possessing 2-fold rotocenters at lattice corners, edge midpoints, and cell centers.'
  },
  pm: {
    key: 'pm',
    label: 'Rectangular Pattern with Parallel Mirrors',
    latticeType: 'rectangular',
    aRatio: 1.0,
    bRatio: 0.78,
    gammaDeg: 90,
    rotations: [],
    mirrorAnglesDeg: [90],
    hasInversion2D: false,
    description: 'Rectangular lattice (γ = 90°) with parallel vertical mirror planes along the lattice columns and mid-columns.'
  },
  pmm: {
    key: 'pmm',
    label: 'Rectangular Grid with Orthogonal Mirrors',
    latticeType: 'rectangular',
    aRatio: 1.0,
    bRatio: 0.78,
    gammaDeg: 90,
    rotations: [2],
    mirrorAnglesDeg: [0, 90],
    hasInversion2D: true,
    description: 'Rectangular lattice (γ = 90°) with mutually perpendicular horizontal and vertical mirrors intersecting at 2-fold rotocenters.'
  },
  p4: {
    key: 'p4',
    label: 'Square Pinwheel Pattern (4-fold Rotation)',
    latticeType: 'square',
    aRatio: 1.0,
    bRatio: 1.0,
    gammaDeg: 90,
    rotations: [2, 4],
    mirrorAnglesDeg: [],
    hasInversion2D: true,
    description: 'Square lattice (|a| = |b|, γ = 90°) with 4-fold rotocenters at corners and cell centers, and 2-fold axes at edge midpoints.'
  },
  p4m: {
    key: 'p4m',
    label: 'Square Tile Pattern with 4-fold Axes and Diagonal Mirrors',
    latticeType: 'square',
    aRatio: 1.0,
    bRatio: 1.0,
    gammaDeg: 90,
    rotations: [2, 4],
    mirrorAnglesDeg: [0, 45, 90, 135],
    hasInversion2D: true,
    description: 'Square lattice (|a| = |b|, γ = 90°) featuring 4-fold rotocenters, 2-fold midpoints, and mirrors along axial and 45° diagonal directions.'
  },
  p3: {
    key: 'p3',
    label: 'Triangular / Hexagonal Pattern (3-fold Rotation)',
    latticeType: 'hexagonal',
    aRatio: 1.0,
    bRatio: 1.0,
    gammaDeg: 120,
    rotations: [3],
    mirrorAnglesDeg: [],
    hasInversion2D: false,
    description: 'Hexagonal lattice (|a| = |b|, γ = 120°) with three non-equivalent 3-fold rotocenters per unit cell and no mirror planes.'
  },
  p6: {
    key: 'p6',
    label: 'Hexagonal Snowflake Pattern (6-fold Rotation)',
    latticeType: 'hexagonal',
    aRatio: 1.0,
    bRatio: 1.0,
    gammaDeg: 120,
    rotations: [2, 3, 6],
    mirrorAnglesDeg: [],
    hasInversion2D: true,
    description: 'Hexagonal lattice (|a| = |b|, γ = 120°) with 6-fold axes at lattice nodes, 3-fold axes at triangle centers, and 2-fold axes at edge midpoints.'
  },
  p6m: {
    key: 'p6m',
    label: 'Full Hexagonal Honeycomb Pattern (6-fold and Mirror Lines)',
    latticeType: 'hexagonal',
    aRatio: 1.0,
    bRatio: 1.0,
    gammaDeg: 120,
    rotations: [2, 3, 6],
    mirrorAnglesDeg: [0, 30, 60, 90, 120, 150],
    hasInversion2D: true,
    description: 'Hexagonal lattice (|a| = |b|, γ = 120°) combining 6-fold, 3-fold, and 2-fold rotocenters with six families of mirror planes spaced every 30°.'
  }
};

export const WALLPAPER_KEYS = ['p1', 'p2', 'pm', 'pmm', 'p4', 'p4m', 'p3', 'p6', 'p6m'];
