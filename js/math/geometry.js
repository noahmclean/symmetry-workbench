/**
 * geometry.js
 * Core 2D geometric transformations, polygon congruence metrics,
 * Sutherland-Hodgman half-plane clipping, and 14px magnetic snapping utilities.
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Euclidean distance between two 2D points {x, y}.
 */
export function dist(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Linearly interpolate between two 2D points p1 and p2 by parameter t in [0, 1].
 */
export function lerpPoint(p1, p2, t) {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t
  };
}

/**
 * Rotate point p = {x, y} around center c = {x, y} by angleRad (radians).
 */
export function rotatePoint(p, c, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return {
    x: c.x + dx * cos - dy * sin,
    y: c.y + dx * sin + dy * cos
  };
}

/**
 * Reflect point p = {x, y} across the line passing through p1 and p2.
 */
export function reflectPoint(p, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return { x: p.x, y: p.y };

  const vx = p.x - p1.x;
  const vy = p.y - p1.y;
  const proj = (vx * dx + vy * dy) / lenSq;
  const footX = p1.x + proj * dx;
  const footY = p1.y + proj * dy;

  return {
    x: 2 * footX - p.x,
    y: 2 * footY - p.y
  };
}

/**
 * Invert point p = {x, y} through center c = {x, y}: x' = 2c - x.
 */
export function invertPoint(p, c) {
  return {
    x: 2 * c.x - p.x,
    y: 2 * c.y - p.y
  };
}

/**
 * Normalize an angle in degrees into [0, 180) for undirected lines (such as mirror axes).
 * Note: In canvas coordinates (y down), we measure geometric angle in standard screen degrees
 * or standard Cartesian degrees consistently. Here 0° = horizontal (+x), 90° = vertical.
 */
export function normalizeAngleDeg180(deg) {
  let a = deg % 180;
  if (a < 0) a += 180;
  if (a >= 179.999) a = 0;
  return a;
}

/**
 * Smallest angular difference in degrees between two undirected line angles in [0, 180).
 */
export function angleDiffDeg180(a1, a2) {
  const n1 = normalizeAngleDeg180(a1);
  const n2 = normalizeAngleDeg180(a2);
  const diff = Math.abs(n1 - n2);
  return Math.min(diff, 180 - diff);
}

/**
 * Compute undirected orientation angle in [0, 180) of the line through p1 and p2.
 * Uses standard mathematical angle where 0° is horizontal, 45° rises to top-right (or screen -y),
 *Wait: to ensure complete consistency between canvas geometry and UI compass,
 * let's define angle in standard Cartesian orientation: atan2(-dy, dx) in degrees.
 * Thus:
 *   0°   = horizontal (dx > 0, dy = 0)
 *   45°  = diagonal Bottom-Left to Top-Right (dx > 0, dy < 0 in screen coords)
 *   90°  = vertical (dx = 0, dy < 0)
 *   135° = diagonal Bottom-Right to Top-Left (dx < 0, dy < 0 in screen coords)
 */
export function lineAngleCartesianDeg(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = -(p2.y - p1.y); // flip screen Y so +Y is up
  const deg = Math.atan2(dy, dx) * RAD_TO_DEG;
  return normalizeAngleDeg180(deg);
}

/**
 * Convert a Cartesian orientation angle (0°=horizontal, 45°=NE-SW, 90°=vertical)
 * into a screen unit vector {ux, uy}.
 */
export function cartesianAngleToScreenUnitVec(deg) {
  const rad = deg * DEG_TO_RAD;
  return {
    ux: Math.cos(rad),
    uy: -Math.sin(rad)
  };
}

/**
 * Orthogonal distance from point p to the infinite line passing through p1 and p2.
 */
export function pointToLineDistance(p, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return dist(p, p1);
  return Math.abs((p.x - p1.x) * dy - (p.y - p1.y) * dx) / len;
}

/**
 * Distance from point p to finite line segment [a, b].
 */
export function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Convert array of {x, y} points to Konva flat array [x0, y0, x1, y1, ...].
 */
export function pointsToFlatArray(pts) {
  const arr = new Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    arr[2 * i] = pts[i].x;
    arr[2 * i + 1] = pts[i].y;
  }
  return arr;
}

/**
 * Compute area-weighted centroid of a closed 2D polygon.
 */
export function polygonCentroid(pts) {
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const cross = p0.x * p1.y - p1.x * p0.y;
    area2 += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  if (Math.abs(area2) < 1e-7) {
    const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / n, y: sum.y / n };
  }
  return {
    x: cx / (3 * area2),
    y: cy / (3 * area2)
  };
}

/**
 * Compute edge midpoints of a closed polygon.
 */
export function polygonEdgeMidpoints(pts) {
  const mids = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    mids.push({
      x: 0.5 * (p0.x + p1.x),
      y: 0.5 * (p0.y + p1.y)
    });
  }
  return mids;
}

/**
 * Compute bidirectional boundary discrepancy (RMS and Max distance in pixels)
 * between two closed polygons polyA and polyB.
 */
export function polygonCongruenceError(polyA, polyB) {
  if (!polyA.length || !polyB.length) return { rms: Infinity, max: Infinity };

  const samplePolygon = (poly, samplesPerEdge = 3) => {
    const out = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      for (let s = 0; s < samplesPerEdge; s++) {
        out.push(lerpPoint(a, b, s / samplesPerEdge));
      }
    }
    return out;
  };

  const minDistanceToPoly = (pt, poly) => {
    let best = Infinity;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const d = pointToSegmentDistance(pt, poly[i], poly[(i + 1) % n]);
      if (d < best) best = d;
    }
    return best;
  };

  const samplesA = samplePolygon(polyA, 3);
  const samplesB = samplePolygon(polyB, 3);

  let sumSq = 0;
  let maxErr = 0;
  let count = 0;

  for (const p of samplesA) {
    const d = minDistanceToPoly(p, polyB);
    sumSq += d * d;
    if (d > maxErr) maxErr = d;
    count++;
  }
  for (const p of samplesB) {
    const d = minDistanceToPoly(p, polyA);
    sumSq += d * d;
    if (d > maxErr) maxErr = d;
    count++;
  }

  return {
    rms: Math.sqrt(sumSq / Math.max(1, count)),
    max: maxErr
  };
}

/**
 * Sutherland-Hodgman polygon clipping against a single half-plane:
 * Keeps points x satisfying (x.x * nx + x.y * ny) <= d.
 */
export function clipPolygonByHalfPlane(poly, nx, ny, d) {
  if (!poly || poly.length === 0) return [];
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i];
    const prev = poly[(i + n - 1) % n];
    const curVal = cur.x * nx + cur.y * ny - d;
    const prevVal = prev.x * nx + prev.y * ny - d;
    const curIn = curVal <= 1e-7;
    const prevIn = prevVal <= 1e-7;

    if (curIn !== prevIn) {
      const t = prevVal / (prevVal - curVal);
      out.push(lerpPoint(prev, cur, t));
    }
    if (curIn) {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Find the nearest snap candidate within snapRadius (default 14px).
 * Returns { point: {x, y}, snapped: boolean, candidate: object|null, distance: number }
 */
export function findNearestCandidate(pos, candidates, snapRadius = 14) {
  let bestDist = snapRadius;
  let bestCandidate = null;

  for (const c of candidates) {
    const d = Math.hypot(pos.x - c.x, pos.y - c.y);
    if (d <= bestDist) {
      bestDist = d;
      bestCandidate = c;
    }
  }

  if (bestCandidate) {
    return {
      point: { x: bestCandidate.x, y: bestCandidate.y },
      snapped: true,
      candidate: bestCandidate,
      distance: bestDist
    };
  }
  return {
    point: { x: pos.x, y: pos.y },
    snapped: false,
    candidate: null,
    distance: Infinity
  };
}

/**
 * Seeded PRNG (Mulberry32) for deterministic, repeatable procedural shapes.
 */
export function createSeededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
