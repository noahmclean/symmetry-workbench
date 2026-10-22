/**
 * glyphManager.js
 * Manages draggable symmetry glyphs on interactiveLayer with distinct colors per glyph type:
 *   - 2-fold: Coral Orange (#f97316)
 *   - 3-fold: Gold Yellow (#eab308)
 *   - 4-fold: Violet Purple (#a855f7)
 *   - 6-fold: Cyan Blue (#06b6d4)
 *   - Mirror line: Rose Pink (#ec4899) with two end pins and a draggable center point
 * Includes 14px magnetic snapping to polygon vertices, centroids, edge midpoints, and lattice nodes,
 * and live periodic replication (p + m·a + n·b) across all other unit cells once the unit cell is identified.
 */

import {
  findNearestCandidate,
  lineAngleCartesianDeg,
  cartesianAngleToScreenUnitVec
} from '../math/geometry.js';

export const SNAP_RADIUS_PX = 14;

export const GLYPH_TYPE_COLORS = {
  rot2: {
    fill: '#f97316',
    stroke: '#ffedd5',
    glow: 'rgba(249, 115, 22, 0.45)'
  },
  rot3: {
    fill: '#eab308',
    stroke: '#fef9c3',
    glow: 'rgba(234, 179, 8, 0.45)'
  },
  rot4: {
    fill: '#a855f7',
    stroke: '#f3e8ff',
    glow: 'rgba(168, 85, 247, 0.45)'
  },
  rot6: {
    fill: '#06b6d4',
    stroke: '#cffafe',
    glow: 'rgba(6, 182, 212, 0.45)'
  },
  mirror: {
    fill: '#ec4899',
    stroke: '#fce7f3',
    glow: 'rgba(236, 72, 153, 0.45)'
  }
};

/**
 * Helper to create a Konva shape node for a given rotation toolType ('rot2' | 'rot3' | 'rot4' | 'rot6').
 */
function createRotationSymbolNode(toolType, typePalette, scale = 1.0) {
  if (toolType === 'rot2') {
    return new Konva.Path({
      data: 'M 0 -14 C 9 -8, 9 8, 0 14 C -9 8, -9 -8, 0 -14 Z',
      scaleX: scale,
      scaleY: scale,
      fill: typePalette.fill,
      stroke: typePalette.stroke,
      strokeWidth: 2
    });
  }
  if (toolType === 'rot3') {
    return new Konva.RegularPolygon({
      sides: 3,
      radius: 14 * scale,
      fill: typePalette.fill,
      stroke: typePalette.stroke,
      strokeWidth: 2
    });
  }
  if (toolType === 'rot4') {
    return new Konva.RegularPolygon({
      sides: 4,
      radius: 13 * scale,
      rotation: 45,
      fill: typePalette.fill,
      stroke: typePalette.stroke,
      strokeWidth: 2
    });
  }
  return new Konva.RegularPolygon({
    sides: 6,
    radius: 14 * scale,
    fill: typePalette.fill,
    stroke: typePalette.stroke,
    strokeWidth: 2
  });
}

export class GlyphManager {
  constructor(stageManager, onSelectionChange, onSnapStatusChange) {
    this.stageManager = stageManager;
    this.layer = stageManager.interactiveLayer;
    this.onSelectionChange = onSelectionChange || (() => {});
    this.onSnapStatusChange = onSnapStatusChange || (() => {});

    this.glyphs = [];
    this.activeGlyphId = null;
    this.candidates = [];
    this.nextId = 1;

    // Verified unit cell basis vectors for periodic replication across all other unit cells
    this.repVecA = null;
    this.repVecB = null;

    // Visual magnetic snap ring on interactiveLayer
    this.snapIndicator = new Konva.Group({ visible: false, listening: false });
    this.snapRing = new Konva.Circle({
      radius: 13,
      stroke: '#facc15',
      strokeWidth: 2,
      dash: [4, 3],
      fill: 'rgba(250, 204, 21, 0.15)'
    });
    this.snapCrossH = new Konva.Line({
      points: [-7, 0, 7, 0],
      stroke: '#facc15',
      strokeWidth: 1.4
    });
    this.snapCrossV = new Konva.Line({
      points: [0, -7, 0, 7],
      stroke: '#facc15',
      strokeWidth: 1.4
    });
    this.snapIndicator.add(this.snapRing, this.snapCrossH, this.snapCrossV);
    this.layer.add(this.snapIndicator);
  }

  setCandidates(candidates) {
    this.candidates = candidates || [];
  }

  /**
   * Configure periodic unit cell translation vectors (vecA, vecB) for replicating
   * placed glyphs across all other unit cells in Wallpaper Mode.
   * Pass (null, null) in Point Group Mode or before the unit cell is verified.
   */
  setReplicationVectors(vecA, vecB) {
    this.repVecA = vecA ? { ...vecA } : null;
    this.repVecB = vecB ? { ...vecB } : null;
    for (const g of this.glyphs) {
      this.updateGlyphReplicas(g);
    }
    this.layer.batchDraw();
  }

  clearAll() {
    for (const g of this.glyphs) {
      if (g.replicaGroup) g.replicaGroup.destroy();
      g.group.destroy();
    }
    this.glyphs = [];
    this.activeGlyphId = null;
    this.hideSnapIndicator();
    this.layer.batchDraw();
    this.onSelectionChange(null);
  }

  removeActiveGlyph() {
    if (!this.activeGlyphId) return;
    const idx = this.glyphs.findIndex(
      (g) => g.id === this.activeGlyphId && g.status !== 'verified'
    );
    if (idx !== -1) {
      if (this.glyphs[idx].replicaGroup) {
        this.glyphs[idx].replicaGroup.destroy();
      }
      this.glyphs[idx].group.destroy();
      this.glyphs.splice(idx, 1);
    }
    const remainingUnverified = this.glyphs.filter((g) => g.status !== 'verified');
    const next =
      remainingUnverified.length > 0
        ? remainingUnverified[remainingUnverified.length - 1]
        : null;
    this.setActiveGlyph(next ? next.id : null);
    this.layer.batchDraw();
  }

  getActiveGlyph() {
    return this.glyphs.find((g) => g.id === this.activeGlyphId) || null;
  }

  /**
   * Return all symmetry glyphs placed on the canvas that have not yet passed verification,
   * preserving the order in which the user added them.
   */
  getUntestedGlyphs() {
    const unverified = this.glyphs.filter((g) => g.status === 'unverified');
    if (unverified.length > 0) return unverified;
    return this.glyphs.filter((g) => g.status === 'invalid');
  }

  /**
   * Enable or disable dragging and pointer events on a glyph so that only
   * the newly added / active unverified glyph is interactive.
   */
  setGlyphInteractive(glyph, interactive) {
    const canInteract = Boolean(interactive) && glyph.status !== 'verified';
    if (glyph.kind === 'mirror') {
      glyph.pin1.draggable(canInteract);
      glyph.pin2.draggable(canInteract);
      glyph.centerPin.draggable(canInteract);
      glyph.pin1.listening(canInteract);
      glyph.pin2.listening(canInteract);
      glyph.centerPin.listening(canInteract);
      glyph.mainLine.listening(canInteract);
      glyph.group.listening(canInteract);
    } else {
      glyph.group.draggable(canInteract);
      glyph.group.listening(canInteract);
    }
  }

  setActiveGlyph(id) {
    const target = this.glyphs.find((g) => g.id === id);
    this.activeGlyphId = target && target.status !== 'verified' ? id : null;
    for (const g of this.glyphs) {
      this.updateGlyphVisualStyle(g);
    }
    this.layer.batchDraw();
    this.onSelectionChange(this.getActiveGlyph());
  }

  /**
   * Rectify a verified glyph (snap it to its exact mathematical center or mirror axis),
   * lock it down so it cannot be moved, and decrease its opacity to prevent visual clutter.
   */
  rectifyAndLockGlyph(glyph, evalResult = {}) {
    if (!glyph) return;
    if (glyph.kind === 'rotation' && evalResult.rectifiedPos) {
      glyph.group.position({
        x: evalResult.rectifiedPos.x,
        y: evalResult.rectifiedPos.y
      });
    } else if (glyph.kind === 'mirror' && evalResult.rectifiedEndpoints) {
      glyph.pin1.position(evalResult.rectifiedEndpoints.p1);
      glyph.pin2.position(evalResult.rectifiedEndpoints.p2);
      glyph.updateMirrorGeometry(true);
    }

    glyph.status = 'verified';
    glyph.locked = true;
    this.hideSnapIndicator();

    if (this.activeGlyphId === glyph.id) {
      this.activeGlyphId = null;
    }

    this.updateGlyphVisualStyle(glyph);
    this.updateGlyphReplicas(glyph);
    this.layer.batchDraw();
    this.onSelectionChange(this.getActiveGlyph());
  }

  showSnapIndicator(pt, candidate) {
    this.snapIndicator.position({ x: pt.x, y: pt.y });
    this.snapIndicator.visible(true);
    this.snapIndicator.moveToTop();
    this.onSnapStatusChange(candidate);
  }

  hideSnapIndicator() {
    this.snapIndicator.visible(false);
    this.onSnapStatusChange(null);
  }

  /**
   * Spawn a draggable glyph of type:
   * 'rot2' | 'rot3' | 'rot4' | 'rot6' | 'mirror'
   * Default position is at the top-left of the stage window (not the center).
   */
  addGlyph(toolType, customPos = null) {
    const id = `glyph_${this.nextId++}`;

    if (toolType === 'mirror') {
      return this.createMirrorGlyph(id, customPos);
    }

    // Default position at top-left of the shape window
    const rotGlyphsCount = this.glyphs.filter((g) => g.kind === 'rotation').length;
    const defaultTopLeft = {
      x: 68 + (rotGlyphsCount % 3) * 28,
      y: 68 + Math.floor(rotGlyphsCount / 3) * 28
    };
    const targetPos = customPos || defaultTopLeft;
    const initialSnap = customPos
      ? findNearestCandidate(targetPos, this.candidates, SNAP_RADIUS_PX)
      : { point: targetPos };
    const startPos = initialSnap.point;

    const typePalette = GLYPH_TYPE_COLORS[toolType] || GLYPH_TYPE_COLORS.rot2;
    const orderMap = { rot2: 2, rot3: 3, rot4: 4, rot6: 6 };
    const order = orderMap[toolType] || 2;

    // Non-interactive container for periodic lattice copies across all other unit cells
    const replicaGroup = new Konva.Group({ listening: false });
    this.layer.add(replicaGroup);

    const group = new Konva.Group({
      x: startPos.x,
      y: startPos.y,
      draggable: true
    });

    // Outer selection / verification halo
    const halo = new Konva.Circle({
      radius: 20,
      fill: 'rgba(255, 255, 255, 0.08)',
      stroke: typePalette.fill,
      strokeWidth: 1.8,
      dash: [4, 3]
    });
    group.add(halo);

    const symbolShape = createRotationSymbolNode(toolType, typePalette, 1.0);
    const centerDot = new Konva.Circle({
      radius: 2.2,
      fill: '#ffffff'
    });

    group.add(symbolShape, centerDot);

    const glyphRecord = {
      id,
      toolType,
      kind: 'rotation',
      order,
      status: 'unverified', // 'unverified' | 'verified' | 'invalid'
      group,
      replicaGroup,
      halo,
      symbolShape,
      getPosition: () => ({ x: group.x(), y: group.y() }),
      setPosition: (pt) => {
        group.position({ x: pt.x, y: pt.y });
        this.updateGlyphReplicas(glyphRecord);
        this.layer.batchDraw();
      }
    };

    group.on('mousedown touchstart', () => {
      this.setActiveGlyph(id);
    });

    group.on('dragmove', () => {
      const rawPos = { x: group.x(), y: group.y() };
      const snap = findNearestCandidate(rawPos, this.candidates, SNAP_RADIUS_PX);
      if (snap.snapped) {
        group.position(snap.point);
        this.showSnapIndicator(snap.point, snap.candidate);
      } else {
        this.hideSnapIndicator();
      }
      if (glyphRecord.status !== 'unverified') {
        glyphRecord.status = 'unverified';
        this.updateGlyphVisualStyle(glyphRecord);
      }
      this.updateGlyphReplicas(glyphRecord);
      this.onSelectionChange(glyphRecord);
    });

    group.on('dragend', () => {
      this.hideSnapIndicator();
      this.layer.batchDraw();
    });

    group.on('mouseenter', () => {
      this.stageManager.stage.container().style.cursor = 'grab';
    });
    group.on('mouseleave', () => {
      this.stageManager.stage.container().style.cursor = 'default';
    });

    this.layer.add(group);
    this.glyphs.push(glyphRecord);
    this.updateGlyphReplicas(glyphRecord);
    this.setActiveGlyph(id);
    return glyphRecord;
  }

  /**
   * Create a Mirror Line glyph with two draggable circular end pins (P1, P2)
   * AND a draggable center point (centerPin) to translate the mirror plane,
   * without any angle badge on the line.
   * Default position is always vertical along the left-hand side of the shape window.
   */
  createMirrorGlyph(id, customCoords = null) {
    // Always default to vertical along the left-hand side of the stage window
    const p1Init = customCoords?.p1 || { x: 82, y: 120 };
    const p2Init = customCoords?.p2 || { x: 82, y: 320 };

    const snap1 = customCoords?.p1
      ? findNearestCandidate(p1Init, this.candidates, SNAP_RADIUS_PX)
      : { point: p1Init };
    const snap2 = customCoords?.p2
      ? findNearestCandidate(p2Init, this.candidates, SNAP_RADIUS_PX)
      : { point: p2Init };

    const mirrorPalette = GLYPH_TYPE_COLORS.mirror;

    const replicaGroup = new Konva.Group({ listening: false });
    this.layer.add(replicaGroup);

    const group = new Konva.Group();

    const extendedLine = new Konva.Line({
      points: [0, 0, 0, 0],
      stroke: mirrorPalette.glow,
      strokeWidth: 2,
      dash: [8, 6],
      listening: false
    });

    const mainLine = new Konva.Line({
      points: [snap1.point.x, snap1.point.y, snap2.point.x, snap2.point.y],
      stroke: mirrorPalette.fill,
      strokeWidth: 3.5,
      hitStrokeWidth: 18
    });

    const pin1 = new Konva.Circle({
      x: snap1.point.x,
      y: snap1.point.y,
      radius: 9,
      fill: mirrorPalette.fill,
      stroke: '#ffffff',
      strokeWidth: 2.2,
      draggable: true
    });

    const pin2 = new Konva.Circle({
      x: snap2.point.x,
      y: snap2.point.y,
      radius: 9,
      fill: mirrorPalette.fill,
      stroke: '#ffffff',
      strokeWidth: 2.2,
      draggable: true
    });

    // Draggable center point handle allowing translation of the entire mirror line
    const centerPin = new Konva.Circle({
      x: 0.5 * (snap1.point.x + snap2.point.x),
      y: 0.5 * (snap1.point.y + snap2.point.y),
      radius: 8,
      fill: '#fdf2f8',
      stroke: mirrorPalette.fill,
      strokeWidth: 2.6,
      draggable: true
    });

    group.add(extendedLine, mainLine, pin1, pin2, centerPin);

    const updateMirrorGeometry = (syncCenterPin = true) => {
      const a = { x: pin1.x(), y: pin1.y() };
      const b = { x: pin2.x(), y: pin2.y() };
      mainLine.points([a.x, a.y, b.x, b.y]);

      const angleDeg = lineAngleCartesianDeg(a, b);
      const { ux, uy } = cartesianAngleToScreenUnitVec(angleDeg);
      const mid = { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y) };
      const span = 1200;
      extendedLine.points([
        mid.x - ux * span,
        mid.y - uy * span,
        mid.x + ux * span,
        mid.y + uy * span
      ]);

      if (syncCenterPin) {
        centerPin.position(mid);
      }
    };

    const glyphRecord = {
      id,
      toolType: 'mirror',
      kind: 'mirror',
      order: null,
      status: 'unverified',
      lastDragged: null, // 'center' | 'pin1' | 'pin2'
      group,
      replicaGroup,
      mainLine,
      extendedLine,
      pin1,
      pin2,
      centerPin,
      updateMirrorGeometry,
      getEndpoints: () => ({
        p1: { x: pin1.x(), y: pin1.y() },
        p2: { x: pin2.x(), y: pin2.y() }
      }),
      setEndpoints: (p1, p2) => {
        pin1.position(p1);
        pin2.position(p2);
        updateMirrorGeometry(true);
        this.updateGlyphReplicas(glyphRecord);
        this.layer.batchDraw();
      },
      setCenterPosition: (centerPt) => {
        const hx = 0.5 * (pin2.x() - pin1.x());
        const hy = 0.5 * (pin2.y() - pin1.y());
        pin1.position({ x: centerPt.x - hx, y: centerPt.y - hy });
        pin2.position({ x: centerPt.x + hx, y: centerPt.y + hy });
        updateMirrorGeometry(true);
        this.updateGlyphReplicas(glyphRecord);
        this.layer.batchDraw();
      }
    };

    // Dragging the centerPin translates both endpoints P1 and P2 while preserving line angle & length
    let halfVecAtCenterDragStart = { x: 0, y: 100 };
    centerPin.on('mousedown touchstart', () => {
      this.setActiveGlyph(id);
      halfVecAtCenterDragStart = {
        x: 0.5 * (pin2.x() - pin1.x()),
        y: 0.5 * (pin2.y() - pin1.y())
      };
    });

    centerPin.on('dragmove', () => {
      const rawCenter = { x: centerPin.x(), y: centerPin.y() };
      const snap = findNearestCandidate(rawCenter, this.candidates, SNAP_RADIUS_PX);
      const targetCenter = snap.snapped ? snap.point : rawCenter;

      if (snap.snapped) {
        centerPin.position(targetCenter);
        this.showSnapIndicator(targetCenter, snap.candidate);
      } else {
        this.hideSnapIndicator();
      }

      pin1.position({
        x: targetCenter.x - halfVecAtCenterDragStart.x,
        y: targetCenter.y - halfVecAtCenterDragStart.y
      });
      pin2.position({
        x: targetCenter.x + halfVecAtCenterDragStart.x,
        y: targetCenter.y + halfVecAtCenterDragStart.y
      });

      glyphRecord.lastDragged = 'center';
      if (glyphRecord.status !== 'unverified') {
        glyphRecord.status = 'unverified';
        this.updateGlyphVisualStyle(glyphRecord);
      }
      updateMirrorGeometry(false);
      this.updateGlyphReplicas(glyphRecord);
      this.onSelectionChange(glyphRecord);
    });

    centerPin.on('dragend', () => {
      this.hideSnapIndicator();
      this.layer.batchDraw();
    });

    const bindPinEvents = (pin, otherPin, pinName) => {
      pin.on('mousedown touchstart', () => {
        this.setActiveGlyph(id);
      });

      pin.on('dragmove', () => {
        const rawPos = { x: pin.x(), y: pin.y() };
        const pivotAroundCenter = glyphRecord.lastDragged === 'center';
        const pivotPt = pivotAroundCenter
          ? { x: centerPin.x(), y: centerPin.y() }
          : { x: otherPin.x(), y: otherPin.y() };

        const snap = findNearestCandidate(rawPos, this.candidates, SNAP_RADIUS_PX);
        if (snap.snapped) {
          pin.position(snap.point);
          this.showSnapIndicator(snap.point, snap.candidate);
        } else {
          const curAngle = lineAngleCartesianDeg(pivotPt, rawPos);
          const nearest15 = Math.round(curAngle / 15) * 15;
          if (Math.abs(curAngle - nearest15) < 2.2) {
            const d = Math.hypot(rawPos.x - pivotPt.x, rawPos.y - pivotPt.y);
            const { ux, uy } = cartesianAngleToScreenUnitVec(nearest15);
            const dot = (rawPos.x - pivotPt.x) * ux + (rawPos.y - pivotPt.y) * uy;
            const sgn = dot >= 0 ? 1 : -1;
            pin.position({
              x: pivotPt.x + sgn * d * ux,
              y: pivotPt.y + sgn * d * uy
            });
          }
          this.hideSnapIndicator();
        }

        // If the student just positioned centerPin and now drags an end pin to rotate the line,
        // pivot the opposite pin symmetrically across centerPin so the line stays centered on centerPin!
        if (pivotAroundCenter) {
          otherPin.position({
            x: 2 * pivotPt.x - pin.x(),
            y: 2 * pivotPt.y - pin.y()
          });
        }

        if (glyphRecord.status !== 'unverified') {
          glyphRecord.status = 'unverified';
          this.updateGlyphVisualStyle(glyphRecord);
        }
        updateMirrorGeometry(!pivotAroundCenter);
        this.updateGlyphReplicas(glyphRecord);
        this.onSelectionChange(glyphRecord);
      });

      pin.on('dragend', () => {
        glyphRecord.lastDragged = pinName;
        this.hideSnapIndicator();
        this.layer.batchDraw();
      });
    };

    bindPinEvents(pin1, pin2, 'pin1');
    bindPinEvents(pin2, pin1, 'pin2');

    for (const handle of [pin1, pin2, centerPin]) {
      handle.on('mouseenter', () => {
        this.stageManager.stage.container().style.cursor = 'grab';
      });
      handle.on('mouseleave', () => {
        this.stageManager.stage.container().style.cursor = 'default';
      });
    }

    mainLine.on('mousedown touchstart', () => {
      this.setActiveGlyph(id);
    });

    updateMirrorGeometry(true);
    this.layer.add(group);
    this.glyphs.push(glyphRecord);
    this.updateGlyphReplicas(glyphRecord);
    this.setActiveGlyph(id);
    return glyphRecord;
  }

  /**
   * Replicate a placed glyph across all other unit cells (p + m·a + n·b) when
   * unit cell replication vectors are active in Wallpaper Mode.
   */
  updateGlyphReplicas(glyph) {
    if (!glyph || !glyph.replicaGroup) return;
    glyph.replicaGroup.destroyChildren();

    if (!this.repVecA || !this.repVecB) return;

    const vecA = this.repVecA;
    const vecB = this.repVecB;
    const W = this.stageManager.width;
    const H = this.stageManager.height;
    const typePalette = GLYPH_TYPE_COLORS[glyph.toolType] || GLYPH_TYPE_COLORS.rot2;

    const isVerified = glyph.status === 'verified';
    const isInvalid = glyph.status === 'invalid';
    const replicaOpacity = isVerified ? 0.36 : isInvalid ? 0.42 : 0.50;

    const span = 4;
    if (glyph.kind === 'rotation') {
      const basePos = glyph.getPosition();
      for (let m = -span; m <= span; m++) {
        for (let n = -span; n <= span; n++) {
          if (m === 0 && n === 0) continue;
          const rx = basePos.x + m * vecA.x + n * vecB.x;
          const ry = basePos.y + m * vecA.y + n * vecB.y;
          if (rx < -30 || rx > W + 30 || ry < -30 || ry > H + 30) continue;

          const itemGroup = new Konva.Group({
            x: rx,
            y: ry,
            opacity: replicaOpacity
          });

          const sym = createRotationSymbolNode(glyph.toolType, typePalette, 0.82);
          const dot = new Konva.Circle({ radius: 1.8, fill: '#ffffff' });
          itemGroup.add(sym, dot);
          glyph.replicaGroup.add(itemGroup);
        }
      }
    } else if (glyph.kind === 'mirror') {
      const { p1, p2 } = glyph.getEndpoints();
      const angleDeg = lineAngleCartesianDeg(p1, p2);
      const { ux, uy } = cartesianAngleToScreenUnitVec(angleDeg);

      const seenOffsets = [];
      const nx = -uy;
      const ny = ux;

      const baseMid = { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) };
      const basePerp = baseMid.x * nx + baseMid.y * ny;
      seenOffsets.push(basePerp);

      for (let m = -span; m <= span; m++) {
        for (let n = -span; n <= span; n++) {
          if (m === 0 && n === 0) continue;
          const shiftX = m * vecA.x + n * vecB.x;
          const shiftY = m * vecA.y + n * vecB.y;

          const q1 = { x: p1.x + shiftX, y: p1.y + shiftY };
          const q2 = { x: p2.x + shiftX, y: p2.y + shiftY };
          const mid = { x: 0.5 * (q1.x + q2.x), y: 0.5 * (q1.y + q2.y) };
          if (mid.x < -120 || mid.x > W + 120 || mid.y < -120 || mid.y > H + 120) {
            continue;
          }

          const perp = mid.x * nx + mid.y * ny;
          const isDuplicateLine = seenOffsets.some((o) => Math.abs(o - perp) < 8);

          const itemGroup = new Konva.Group({ opacity: replicaOpacity });

          if (!isDuplicateLine) {
            seenOffsets.push(perp);
            itemGroup.add(
              new Konva.Line({
                points: [
                  mid.x - ux * 1000,
                  mid.y - uy * 1000,
                  mid.x + ux * 1000,
                  mid.y + uy * 1000
                ],
                stroke: isVerified ? 'rgba(16, 185, 129, 0.35)' : typePalette.glow,
                strokeWidth: 1.4,
                dash: [6, 5]
              })
            );
          }

          itemGroup.add(
            new Konva.Line({
              points: [q1.x, q1.y, q2.x, q2.y],
              stroke: typePalette.fill,
              strokeWidth: 2.0
            })
          );

          glyph.replicaGroup.add(itemGroup);
        }
      }
    }
  }

  /**
   * Mark a glyph's verification status ('unverified' | 'verified' | 'invalid')
   * while preserving each glyph's unique type color.
   */
  setGlyphStatus(glyph, status, evalResult = null) {
    if (!glyph) return;
    if (status === 'verified') {
      this.rectifyAndLockGlyph(glyph, evalResult || {});
      return;
    }
    glyph.status = status;
    this.updateGlyphVisualStyle(glyph);
    this.updateGlyphReplicas(glyph);
    this.layer.batchDraw();
  }

  updateGlyphVisualStyle(glyph) {
    const isVerified = glyph.status === 'verified';
    const isSelected = !isVerified && glyph.id === this.activeGlyphId;
    const basePalette = GLYPH_TYPE_COLORS[glyph.toolType] || GLYPH_TYPE_COLORS.rot2;

    // Verified glyphs are permanently locked down and dimmed; unverified glyphs remain draggable until verified
    const canInteract = !isVerified;
    this.setGlyphInteractive(glyph, canInteract);
    glyph.group.opacity(isVerified ? 0.42 : isSelected ? 1.0 : 0.75);

    if (glyph.kind === 'mirror') {
      glyph.mainLine.stroke(basePalette.fill);
      glyph.mainLine.strokeWidth(isVerified ? 2.2 : isSelected ? 4.0 : 2.8);
      glyph.extendedLine.stroke(basePalette.glow);
      glyph.pin1.fill(basePalette.fill);
      glyph.pin2.fill(basePalette.fill);

      glyph.pin1.radius(isVerified ? 4.5 : 9);
      glyph.pin2.radius(isVerified ? 4.5 : 9);
      glyph.centerPin.radius(isVerified ? 4.0 : 8);

      const statusStroke =
        isVerified
          ? '#10b981'
          : glyph.status === 'invalid'
          ? '#ef4444'
          : '#ffffff';
      glyph.pin1.stroke(statusStroke);
      glyph.pin2.stroke(statusStroke);
      glyph.centerPin.stroke(
        isVerified
          ? '#10b981'
          : glyph.status === 'invalid'
          ? '#ef4444'
          : basePalette.fill
      );
    } else {
      glyph.halo.visible(!isVerified && (isSelected || glyph.status === 'invalid'));
      if (glyph.status === 'invalid') {
        glyph.halo.stroke('#ef4444');
        glyph.halo.fill('rgba(239, 68, 68, 0.22)');
        glyph.halo.dash([4, 3]);
      } else {
        glyph.halo.stroke(basePalette.fill);
        glyph.halo.fill('rgba(255, 255, 255, 0.08)');
        glyph.halo.dash([4, 3]);
      }

      glyph.symbolShape.fill(basePalette.fill);
      glyph.symbolShape.stroke(basePalette.stroke);
    }
  }
}
