/**
 * verifier.js
 * Runs animated congruence transformations on `ghostLayer` for both:
 *   1. "Test Symmetry" (rotation, mirror reflection, and Hard Mode point inversion x' = 2c - x)
 *   2. "Test Unit Cell" (clips pattern geometry inside the student's proposed parallelogram cell
 *      and translates copies by m*a + n*b to tile the entire field of view)
 * Uses identical emerald-green (congruent) and amber/red (displaced/invalid) visual styling.
 */

import {
  DEG_TO_RAD,
  dist,
  lerpPoint,
  rotatePoint,
  reflectPoint,
  invertPoint,
  pointsToFlatArray,
  polygonCongruenceError,
  lineAngleCartesianDeg,
  cartesianAngleToScreenUnitVec,
  angleDiffDeg180,
  pointToLineDistance,
  clipPolygonByHalfPlane
} from '../math/geometry.js';
import {
  verifyWallpaperRotation,
  verifyWallpaperMirror,
  verifyWallpaperInversion,
  verifyUserUnitCell
} from '../math/wallpaperEngine.js';

/**
 * Smooth cubic ease-in-out for animations on ghostLayer.
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Clip a polygon `poly` to the interior of the parallelogram defined by
 * origin O and basis vectors vecA, vecB: 0 <= u <= 1 and 0 <= v <= 1.
 */
function clipPolygonToUnitCell(poly, origin, vecA, vecB) {
  const det = vecA.x * vecB.y - vecA.y * vecB.x;
  if (Math.abs(det) < 1e-5) return [];
  const s = det > 0 ? 1 : -1;
  const absDet = Math.abs(det);

  // u = ( (x - Ox)*by - (y - Oy)*bx ) / det
  // Let nx_u = s * by, ny_u = -s * bx, d0_u = nx_u * Ox + ny_u * Oy
  const nxU = s * vecB.y;
  const nyU = -s * vecB.x;
  const d0U = nxU * origin.x + nyU * origin.y;

  // v = ( -ay*(x - Ox) + ax*(y - Oy) ) / det
  const nxV = -s * vecA.y;
  const nyV = s * vecA.x;
  const d0V = nxV * origin.x + nyV * origin.y;

  let clipped = poly;
  // u <= 1  =>  nxU*x + nyU*y <= d0U + absDet
  clipped = clipPolygonByHalfPlane(clipped, nxU, nyU, d0U + absDet);
  // u >= 0  => -nxU*x - nyU*y <= -d0U
  clipped = clipPolygonByHalfPlane(clipped, -nxU, -nyU, -d0U);
  // v <= 1  =>  nxV*x + nyV*y <= d0V + absDet
  clipped = clipPolygonByHalfPlane(clipped, nxV, nyV, d0V + absDet);
  // v >= 0  => -nxV*x - nyV*y <= -d0V
  clipped = clipPolygonByHalfPlane(clipped, -nxV, -nyV, -d0V);

  return clipped;
}

export class SymmetryVerifier {
  constructor(stageManager) {
    this.stageManager = stageManager;
    this.ghostLayer = stageManager.ghostLayer;
    this.isAnimating = false;
    this.activeAnimId = null;
    this.cleanupTimer = null;
  }

  clearGhostLayer() {
    if (this.activeAnimId) {
      cancelAnimationFrame(this.activeAnimId);
      this.activeAnimId = null;
    }
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.isAnimating = false;
    this.ghostLayer.destroyChildren();
    this.ghostLayer.batchDraw();
  }

  /**
   * Evaluate a glyph on a Point Group shape analytically & geometrically.
   */
  evaluatePointShapeSymmetry(shapeData, glyph, transformedVertices) {
    const { preset, center, mirrorAnglesDeg } = shapeData;
    const err = polygonCongruenceError(transformedVertices, shapeData.vertices);

    if (glyph.kind === 'rotation') {
      const order = glyph.order;
      const pos = glyph.getPosition();
      const offsetFromCenter = dist(pos, center);

      if (!preset.rotations.includes(order)) {
        if (preset.nFold > 1 && preset.nFold % order === 0) {
          return {
            valid: false,
            errorPx: 0,
            message: `This crystal has higher-order ${preset.nFold}-fold symmetry at its center — place the ${preset.nFold}-Fold glyph instead of a ${order}-Fold glyph.`
          };
        }
        return {
          valid: false,
          errorPx: Math.round(err.max),
          message: `Not congruent (max vertex displacement ${Math.round(err.max)} px): this shape lacks ${order}-fold rotational symmetry.`
        };
      }

      if (offsetFromCenter > 14 || err.max > 14) {
        return {
          valid: false,
          errorPx: Math.round(err.max),
          message: `Not congruent (displaced by ${Math.round(err.max)} px): the ${order}-fold axis is offset from the shape's centroid by ${Math.round(offsetFromCenter)} px.`
        };
      }

      return {
        valid: true,
        checklistId: `rot_${order}_center`,
        checklistLabel: `${order}-fold rotation axis at center`,
        rectifiedPos: { x: center.x, y: center.y },
        message: `Congruent! A ${Math.round(360 / order)}° rotation about the centroid maps the crystal profile onto itself.`
      };
    }

    if (glyph.kind === 'inversion') {
      const pos = glyph.getPosition();
      const offsetFromCenter = dist(pos, center);

      if (!preset.hasInversion2D) {
        return {
          valid: false,
          errorPx: Math.round(err.max),
          message: `Not congruent (displaced by ${Math.round(err.max)} px): this non-centrosymmetric shape is not invariant under x' = 2c - x.`
        };
      }

      if (offsetFromCenter > 14 || err.max > 14) {
        return {
          valid: false,
          errorPx: Math.round(err.max),
          message: `Not congruent (displaced by ${Math.round(err.max)} px): the inversion center is offset from the centroid by ${Math.round(offsetFromCenter)} px.`
        };
      }

      return {
        valid: true,
        checklistId: 'inv_center',
        checklistLabel: 'Inversion center at centroid',
        message: 'Congruent! Every point x inverted through the centroid c (x\' = 2c - x) lands on an equivalent boundary point.'
      };
    }

    if (glyph.kind === 'mirror') {
      const { p1, p2 } = glyph.getEndpoints();
      const userAngle = lineAngleCartesianDeg(p1, p2);
      const distFromCenter = pointToLineDistance(center, p1, p2);

      if (!preset.hasMirrors || mirrorAnglesDeg.length === 0) {
        return {
          valid: false,
          errorPx: Math.round(err.max),
          message: `Not congruent (displaced by ${Math.round(err.max)} px): this chiral profile has no mirror reflection planes.`
        };
      }

      let bestAngle = null;
      let minAngleDiff = Infinity;
      for (const a of mirrorAnglesDeg) {
        const diff = angleDiffDeg180(userAngle, a);
        if (diff < minAngleDiff) {
          minAngleDiff = diff;
          bestAngle = a;
        }
      }

      if (minAngleDiff > 6.5) {
        return {
          valid: false,
          errorPx: Math.round(err.max),
          message: `Not congruent (displaced by ${Math.round(err.max)} px): mirror line at ${Math.round(userAngle)}° does not match a valid mirror orientation.`
        };
      }

      if (distFromCenter > 14 || err.max > 16) {
        return {
          valid: false,
          errorPx: Math.round(err.max),
          message: `Not congruent (displaced by ${Math.round(err.max)} px): the ${Math.round(bestAngle)}° mirror line does not pass through the shape's center.`
        };
      }

      const { ux, uy } = cartesianAngleToScreenUnitVec(bestAngle);
      const mid = { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) };
      const halfLen = Math.max(105, 0.5 * dist(p1, p2));
      const tProj = (mid.x - center.x) * ux + (mid.y - center.y) * uy;
      const projMid = {
        x: center.x + tProj * ux,
        y: center.y + tProj * uy
      };
      const rectifiedEndpoints = {
        p1: { x: projMid.x - ux * halfLen, y: projMid.y - uy * halfLen },
        p2: { x: projMid.x + ux * halfLen, y: projMid.y + uy * halfLen }
      };

      const rounded = Math.round(bestAngle);
      return {
        valid: true,
        checklistId: `mirror_${rounded}`,
        checklistLabel: `Mirror line at ${rounded}°`,
        rectifiedEndpoints,
        message: `Congruent! Reflection across the ${rounded}° mirror plane maps both halves of the crystal onto each other.`
      };
    }

    return { valid: false, message: 'Unknown symmetry element.' };
  }

  /**
   * Run the animated "Test Symmetry" verification on `ghostLayer`
   * for either Point Group Mode ('shape') or Wallpaper Mode ('wallpaper').
   */
  runSymmetryTest({ mode, shapeData, tilingData, glyph, onComplete }) {
    if (!glyph) {
      if (onComplete) {
        onComplete({
          valid: false,
          noGlyph: true,
          message: 'Select or place a symmetry glyph on the canvas first, then click "Test Symmetry".'
        });
      }
      return;
    }

    this.clearGhostLayer();
    this.isAnimating = true;

    const sourcePolygons =
      mode === 'shape'
        ? [shapeData.vertices]
        : tilingData.motifs.map((m) => m.vertices);

    // Precompute target transformed polygons for t = 1
    let targetPolygons = [];
    let rotCenter = null;
    let rotAngleRad = 0;
    let mirrorEnds = null;
    let invCenter = null;

    if (glyph.kind === 'rotation') {
      rotCenter = glyph.getPosition();
      // In screen coordinates (+y down), positive CCW Cartesian rotation by 2pi/n is -2pi/n
      rotAngleRad = -(2 * Math.PI) / glyph.order;
      targetPolygons = sourcePolygons.map((poly) =>
        poly.map((pt) => rotatePoint(pt, rotCenter, rotAngleRad))
      );
    } else if (glyph.kind === 'mirror') {
      mirrorEnds = glyph.getEndpoints();
      targetPolygons = sourcePolygons.map((poly) =>
        poly.map((pt) => reflectPoint(pt, mirrorEnds.p1, mirrorEnds.p2))
      );
    } else if (glyph.kind === 'inversion') {
      invCenter = glyph.getPosition();
      targetPolygons = sourcePolygons.map((poly) =>
        poly.map((pt) => invertPoint(pt, invCenter))
      );
    }

    // Create Konva ghost nodes on ghostLayer (retaining tile colors in Wallpaper Mode so color symmetry is visible)
    const ghostShapes = sourcePolygons.map((poly, idx) => {
      const motifFill =
        mode === 'wallpaper' && tilingData.motifs[idx]?.fill
          ? tilingData.motifs[idx].fill
          : 'rgba(250, 204, 21, 0.28)';
      const line = new Konva.Line({
        points: pointsToFlatArray(poly),
        closed: true,
        fill: motifFill,
        stroke: '#facc15',
        strokeWidth: 2.6,
        lineJoin: 'round'
      });
      this.ghostLayer.add(line);
      return line;
    });

    // Optional visual trace lines for Inversion Mode (Hard Mode): x' = 2c - x rays through c
    const rayLines = [];
    if (glyph.kind === 'inversion' && invCenter) {
      const sampleVerts =
        mode === 'shape'
          ? shapeData.vertices
          : tilingData.motifs.slice(0, 6).flatMap((m) => m.vertices.filter((_, idx) => idx % 2 === 0));

      for (const v of sampleVerts) {
        const ray = new Konva.Line({
          points: [v.x, v.y, v.x, v.y],
          stroke: 'rgba(56, 189, 248, 0.65)',
          strokeWidth: 1.3,
          dash: [4, 4]
        });
        this.ghostLayer.add(ray);
        rayLines.push({ node: ray, start: v, end: invertPoint(v, invCenter) });
      }
    }

    const durationMs = 720;
    const startTime = performance.now();

    const stepFrame = (now) => {
      const rawT = Math.min(1, (now - startTime) / durationMs);
      const t = easeInOutCubic(rawT);

      for (let i = 0; i < sourcePolygons.length; i++) {
        const src = sourcePolygons[i];
        const dst = targetPolygons[i];
        let currentPoly;

        if (glyph.kind === 'rotation') {
          currentPoly = src.map((pt) => rotatePoint(pt, rotCenter, rotAngleRad * t));
        } else {
          // Both Mirror reflection and Point Inversion interpolate linearly: x(t) = (1-t)x + t*x'
          currentPoly = src.map((pt, j) => lerpPoint(pt, dst[j], t));
        }
        ghostShapes[i].points(pointsToFlatArray(currentPoly));
      }

      for (const r of rayLines) {
        const curEnd = lerpPoint(r.start, r.end, t);
        r.node.points([r.start.x, r.start.y, curEnd.x, curEnd.y]);
      }

      this.ghostLayer.batchDraw();

      if (rawT < 1) {
        this.activeAnimId = requestAnimationFrame(stepFrame);
      } else {
        this.activeAnimId = null;
        this.finalizeSymmetryEvaluation({
          mode,
          shapeData,
          tilingData,
          glyph,
          sourcePolygons,
          targetPolygons,
          ghostShapes,
          onComplete
        });
      }
    };

    this.activeAnimId = requestAnimationFrame(stepFrame);
  }

  finalizeSymmetryEvaluation({
    mode,
    shapeData,
    tilingData,
    glyph,
    sourcePolygons,
    targetPolygons,
    ghostShapes,
    onComplete
  }) {
    let result;
    if (mode === 'shape') {
      result = this.evaluatePointShapeSymmetry(shapeData, glyph, targetPolygons[0]);
    } else {
      if (glyph.kind === 'rotation') {
        result = verifyWallpaperRotation(tilingData, glyph.order, glyph.getPosition());
      } else if (glyph.kind === 'mirror') {
        const { p1, p2 } = glyph.getEndpoints();
        result = verifyWallpaperMirror(tilingData, p1, p2);
      } else if (glyph.kind === 'inversion') {
        result = verifyWallpaperInversion(tilingData, glyph.getPosition());
      }
      if (!result.valid && result.reason) {
        result.message = result.reason;
      }
    }

    // Apply confirmation flash color scheme (Emerald Green for valid, Amber/Red for mismatch)
    const fillColor = result.valid
      ? 'rgba(16, 185, 129, 0.34)'
      : 'rgba(239, 68, 68, 0.30)';
    const strokeColor = result.valid ? '#10b981' : '#ef4444';

    for (let i = 0; i < ghostShapes.length; i++) {
      const gs = ghostShapes[i];
      if (result.valid && sourcePolygons[i]) {
        gs.points(pointsToFlatArray(sourcePolygons[i]));
      }
      gs.fill(fillColor);
      gs.stroke(strokeColor);
      gs.strokeWidth(result.valid ? 3.2 : 2.5);
    }
    this.ghostLayer.batchDraw();

    if (onComplete) {
      onComplete(result);
    }

    // Fade out ghost layer after student sees the congruence or displacement
    const holdTime = result.valid ? 950 : 1850;
    this.cleanupTimer = setTimeout(() => {
      this.clearGhostLayer();
    }, holdTime);
  }

  /**
   * Run the animated "Test Unit Cell" verification on `ghostLayer`:
   * Clips the pattern geometry inside the student's outlined unit cell (origin, vecA, vecB)
   * and sequentially translates the proposed unit cell 8 times (N, NE, E, SE, S, SW, W, NW
   * parallelogram equivalents) to complete a 3x3 grid, then pauses on the completed
   * proposed 3x3 grid before accepting/rejecting the unit cell.
   */
  runUnitCellTest({ tilingData, unitCellVectors, onComplete }) {
    this.clearGhostLayer();
    this.isAnimating = true;

    const { origin, vecA, vecB } = unitCellVectors;
    const evalResult = verifyUserUnitCell(tilingData, origin, vecA, vecB);
    if (!evalResult.valid && evalResult.reason) {
      evalResult.message = evalResult.reason;
    }

    // 1. Clip all background motifs to the student's unit cell parallelogram P_{0,0}
    const clippedFragments = [];
    for (const motif of tilingData.motifs) {
      const clipped = clipPolygonToUnitCell(motif.vertices, origin, vecA, vecB);
      if (clipped.length >= 3) {
        clippedFragments.push({
          points: clipped,
          fill: motif.fill || 'rgba(250, 204, 21, 0.14)'
        });
      }
    }

    // Outline of the student's unit cell parallelogram at (0, 0)
    const cellOutlinePts = [
      origin,
      { x: origin.x + vecA.x, y: origin.y + vecA.y },
      { x: origin.x + vecA.x + vecB.x, y: origin.y + vecA.y + vecB.y },
      { x: origin.x + vecB.x, y: origin.y + vecB.y }
    ];
    const flatCellOutline = pointsToFlatArray(cellOutlinePts);

    // 2. Define the 8 surrounding parallelogram translations (N, NE, E, SE, S, SW, W, NW) completing a 3x3 grid
    const compassOffsets = [
      { m: 0, n: 1, dir: 'N' },
      { m: 1, n: 1, dir: 'NE' },
      { m: 1, n: 0, dir: 'E' },
      { m: 1, n: -1, dir: 'SE' },
      { m: 0, n: -1, dir: 'S' },
      { m: -1, n: -1, dir: 'SW' },
      { m: -1, n: 0, dir: 'W' },
      { m: -1, n: 1, dir: 'NW' }
    ];

    const buildTileEntry = (m, n, visibleInitially = false) => {
      const shiftX = m * vecA.x + n * vecB.x;
      const shiftY = m * vecA.y + n * vecB.y;
      const tileGroup = new Konva.Group({
        x: 0,
        y: 0,
        visible: visibleInitially,
        opacity: 0.55
      });

      // Subtle low-opacity cell parallelogram frame
      const cellFrame = new Konva.Line({
        points: flatCellOutline,
        closed: true,
        fill: 'rgba(250, 204, 21, 0.05)',
        stroke: 'rgba(250, 204, 21, 0.48)',
        strokeWidth: 1.5,
        dash: [5, 4]
      });
      tileGroup.add(cellFrame);

      // Low-opacity clipped motif fragments inside this unit cell (preserving tile colors)
      const fragNodes = [];
      for (const frag of clippedFragments) {
        const fragLine = new Konva.Line({
          points: pointsToFlatArray(frag.points),
          closed: true,
          fill: frag.fill,
          stroke: 'rgba(250, 204, 21, 0.60)',
          strokeWidth: 1.8,
          lineJoin: 'round'
        });
        tileGroup.add(fragLine);
        fragNodes.push(fragLine);
      }

      this.ghostLayer.add(tileGroup);
      return {
        m,
        n,
        shiftX,
        shiftY,
        tileGroup,
        cellFrame,
        fragNodes
      };
    };

    // Central (0, 0) proposed cell plus the 8 translated neighbors completing the 3x3 grid
    const centerTile = buildTileEntry(0, 0, true);
    const tileEntries = compassOffsets.map((c) => buildTileEntry(c.m, c.n, false));
    const allNineTiles = [centerTile, ...tileEntries];

    // Translate the 8 surrounding unit cells twice as slowly (600ms per cell across 8 steps = 4.8s)
    // followed by the 1500ms pause on the completed proposed 3x3 grid before accepting/rejecting
    const stepDurationMs = 600;
    const totalDurationMs = tileEntries.length * stepDurationMs;
    const pauseBeforeVerdictMs = 1500;
    const startTime = performance.now();

    const stepFrame = (now) => {
      const elapsed = now - startTime;

      for (let idx = 0; idx < tileEntries.length; idx++) {
        const tile = tileEntries[idx];
        const stepStart = idx * stepDurationMs;
        if (elapsed < stepStart) {
          tile.tileGroup.visible(false);
        } else {
          tile.tileGroup.visible(true);
          const localRawT = Math.min(1, (elapsed - stepStart) / stepDurationMs);
          const t = easeInOutCubic(localRawT);
          tile.tileGroup.position({
            x: tile.shiftX * t,
            y: tile.shiftY * t
          });
        }
      }

      this.ghostLayer.batchDraw();

      if (elapsed < totalDurationMs) {
        this.activeAnimId = requestAnimationFrame(stepFrame);
      } else {
        this.activeAnimId = null;

        // Ensure all 8 translated cells are locked into their exact 3x3 grid positions during the pause
        for (const tile of tileEntries) {
          tile.tileGroup.visible(true);
          tile.tileGroup.position({ x: tile.shiftX, y: tile.shiftY });
        }
        this.ghostLayer.batchDraw();

        // Pause 3x longer on the completed proposed 3x3 grid before accepting/rejecting
        this.cleanupTimer = setTimeout(() => {
          const isMatch = evalResult.valid;
          const fragFill = isMatch
            ? 'rgba(16, 185, 129, 0.16)'
            : 'rgba(239, 68, 68, 0.15)';
          const fragStroke = isMatch
            ? 'rgba(16, 185, 129, 0.65)'
            : 'rgba(239, 68, 68, 0.65)';
          const frameFill = isMatch
            ? 'rgba(16, 185, 129, 0.06)'
            : 'rgba(239, 68, 68, 0.06)';
          const frameStroke = isMatch
            ? 'rgba(16, 185, 129, 0.55)'
            : 'rgba(239, 68, 68, 0.55)';

          for (const tile of allNineTiles) {
            tile.cellFrame.fill(frameFill);
            tile.cellFrame.stroke(frameStroke);
            for (const fn of tile.fragNodes) {
              fn.fill(fragFill);
              fn.stroke(fragStroke);
            }
          }
          this.ghostLayer.batchDraw();

          if (onComplete) {
            onComplete(evalResult);
          }

          const holdTime = isMatch ? 2400 : 3000;
          this.cleanupTimer = setTimeout(() => {
            this.clearGhostLayer();
          }, holdTime);
        }, pauseBeforeVerdictMs);
      }
    };

    this.activeAnimId = requestAnimationFrame(stepFrame);
  }
}
