/**
 * unitCellTool.js
 * Interactive Unit Cell Outlining Tool rendered on `cellLayer` (Wallpaper Mode).
 * Allows students to drag the cell origin O and basis vector tips a and b
 * with 14px magnetic snapping to lattice nodes and Wyckoff sites.
 * Once verified, locks handles in place so they are not bumped while dragging symmetry glyphs.
 */

import { RAD_TO_DEG, findNearestCandidate } from '../math/geometry.js';
import { SNAP_RADIUS_PX } from './glyphManager.js';

export class UnitCellTool {
  constructor(stageManager, onCellUpdate, onSnapStatusChange) {
    this.stageManager = stageManager;
    this.layer = stageManager.cellLayer;
    this.onCellUpdate = onCellUpdate || (() => {});
    this.onSnapStatusChange = onSnapStatusChange || (() => {});

    this.visible = false;
    this.locked = false;
    this.candidates = [];
    this.status = 'unverified'; // 'unverified' | 'verified' | 'invalid'

    this.origin = { x: 300, y: 350 };
    this.vecA = { x: 132, y: -22 };
    this.vecB = { x: 24, y: -118 };

    this.rootGroup = new Konva.Group({ visible: false });
    this.layer.add(this.rootGroup);

    this.buildNodes();
  }

  buildNodes() {
    // Shaded parallelogram spanned by a and b (low opacity to avoid obscuring pattern)
    this.parallelogram = new Konva.Line({
      points: [0, 0, 0, 0, 0, 0, 0, 0],
      closed: true,
      fill: 'rgba(168, 85, 247, 0.08)',
      stroke: 'rgba(192, 132, 252, 0.55)',
      strokeWidth: 1.8,
      dash: [6, 4],
      listening: false
    });

    // Basis vector a (Arrow)
    this.arrowA = new Konva.Arrow({
      points: [0, 0, 100, 0],
      pointerLength: 10,
      pointerWidth: 9,
      fill: '#fb7185',
      stroke: '#fb7185',
      strokeWidth: 3.2,
      listening: false
    });

    // Basis vector b (Arrow)
    this.arrowB = new Konva.Arrow({
      points: [0, 0, 0, -100],
      pointerLength: 10,
      pointerWidth: 9,
      fill: '#2dd4bf',
      stroke: '#2dd4bf',
      strokeWidth: 3.2,
      listening: false
    });

    // Inter-axial angle label (gamma)
    this.angleLabel = new Konva.Text({
      text: 'γ = 90°',
      fontSize: 12,
      fontFamily: 'monospace',
      fontStyle: 'bold',
      fill: '#e2e8f0',
      listening: false
    });

    this.labelA = new Konva.Text({
      text: 'a',
      fontSize: 15,
      fontFamily: 'serif',
      fontStyle: 'bold italic',
      fill: '#fda4af',
      listening: false
    });

    this.labelB = new Konva.Text({
      text: 'b',
      fontSize: 15,
      fontFamily: 'serif',
      fontStyle: 'bold italic',
      fill: '#5eead4',
      listening: false
    });

    // Draggable handles: Origin O, Tip A, Tip B
    this.handleO = new Konva.Circle({
      radius: 9,
      fill: '#f8fafc',
      stroke: '#0f172a',
      strokeWidth: 2.5,
      draggable: true
    });

    this.handleA = new Konva.Circle({
      radius: 9,
      fill: '#fb7185',
      stroke: '#ffffff',
      strokeWidth: 2.2,
      draggable: true
    });

    this.handleB = new Konva.Circle({
      radius: 9,
      fill: '#2dd4bf',
      stroke: '#ffffff',
      strokeWidth: 2.2,
      draggable: true
    });

    this.rootGroup.add(
      this.parallelogram,
      this.arrowA,
      this.arrowB,
      this.angleLabel,
      this.labelA,
      this.labelB,
      this.handleO,
      this.handleA,
      this.handleB
    );

    // Drag events with 14px magnetic snapping
    this.handleO.on('dragmove', () => {
      if (this.locked) return;
      const raw = { x: this.handleO.x(), y: this.handleO.y() };
      const snap = findNearestCandidate(raw, this.candidates, SNAP_RADIUS_PX);
      const newO = snap.snapped ? snap.point : raw;
      this.handleO.position(newO);
      this.origin = { ...newO };

      this.handleA.position({
        x: this.origin.x + this.vecA.x,
        y: this.origin.y + this.vecA.y
      });
      this.handleB.position({
        x: this.origin.x + this.vecB.x,
        y: this.origin.y + this.vecB.y
      });

      this.onSnapStatusChange(snap.snapped ? snap.candidate : null);
      this.setStatus('unverified');
      this.syncGeometry();
    });

    this.handleA.on('dragmove', () => {
      if (this.locked) return;
      const raw = { x: this.handleA.x(), y: this.handleA.y() };
      const snap = findNearestCandidate(raw, this.candidates, SNAP_RADIUS_PX);
      const ptA = snap.snapped ? snap.point : raw;
      this.handleA.position(ptA);
      this.vecA = {
        x: ptA.x - this.origin.x,
        y: ptA.y - this.origin.y
      };
      this.onSnapStatusChange(snap.snapped ? snap.candidate : null);
      this.setStatus('unverified');
      this.syncGeometry();
    });

    this.handleB.on('dragmove', () => {
      if (this.locked) return;
      const raw = { x: this.handleB.x(), y: this.handleB.y() };
      const snap = findNearestCandidate(raw, this.candidates, SNAP_RADIUS_PX);
      const ptB = snap.snapped ? snap.point : raw;
      this.handleB.position(ptB);
      this.vecB = {
        x: ptB.x - this.origin.x,
        y: ptB.y - this.origin.y
      };
      this.onSnapStatusChange(snap.snapped ? snap.candidate : null);
      this.setStatus('unverified');
      this.syncGeometry();
    });

    const onDragEnd = () => {
      this.onSnapStatusChange(null);
      this.layer.batchDraw();
    };

    this.handleO.on('dragend', onDragEnd);
    this.handleA.on('dragend', onDragEnd);
    this.handleB.on('dragend', onDragEnd);

    for (const h of [this.handleO, this.handleA, this.handleB]) {
      h.on('mouseenter', () => {
        if (!this.locked) {
          this.stageManager.stage.container().style.cursor = 'grab';
        }
      });
      h.on('mouseleave', () => {
        this.stageManager.stage.container().style.cursor = 'default';
      });
    }
  }

  setCandidates(candidates) {
    this.candidates = candidates || [];
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.rootGroup.visible(this.visible);
    this.layer.batchDraw();
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    this.handleO.draggable(!this.locked);
    this.handleA.draggable(!this.locked);
    this.handleB.draggable(!this.locked);
    this.handleO.listening(!this.locked);
    this.handleA.listening(!this.locked);
    this.handleB.listening(!this.locked);

    const opacity = this.locked ? 0.45 : 1.0;
    this.handleO.opacity(opacity);
    this.handleA.opacity(opacity);
    this.handleB.opacity(opacity);
    this.arrowA.opacity(this.locked ? 0.55 : 1.0);
    this.arrowB.opacity(this.locked ? 0.55 : 1.0);
    this.layer.batchDraw();
  }

  /**
   * Initialize the unit cell handles for a wallpaper pattern.
   * By default (snapDirectly = false), places Origin O at the central lattice node
   * and starts vectors a and b at a generic unaligned default length/angle so the student
   * actively drags and snaps them to identify the unit cell.
   */
  initForTiling(tilingData, snapDirectly = false) {
    this.origin = { ...tilingData.origin };
    if (snapDirectly) {
      this.vecA = { ...tilingData.vecA };
      this.vecB = { ...tilingData.vecB };
    } else {
      // Generic unaligned default vectors so student must actively outline the unit cell
      this.vecA = { x: 132, y: -24 };
      this.vecB = { x: 26, y: -116 };
    }
    this.setLocked(false);
    this.setStatus('unverified');
    this.handleO.position(this.origin);
    this.handleA.position({
      x: this.origin.x + this.vecA.x,
      y: this.origin.y + this.vecA.y
    });
    this.handleB.position({
      x: this.origin.x + this.vecB.x,
      y: this.origin.y + this.vecB.y
    });
    this.syncGeometry();
  }

  setVectors(origin, vecA, vecB) {
    this.origin = { ...origin };
    this.vecA = { ...vecA };
    this.vecB = { ...vecB };
    this.handleO.position(this.origin);
    this.handleA.position({
      x: this.origin.x + this.vecA.x,
      y: this.origin.y + this.vecA.y
    });
    this.handleB.position({
      x: this.origin.x + this.vecB.x,
      y: this.origin.y + this.vecB.y
    });
    this.syncGeometry();
  }

  getVectors() {
    return {
      origin: { ...this.origin },
      vecA: { ...this.vecA },
      vecB: { ...this.vecB }
    };
  }

  setStatus(status) {
    this.status = status;
    if (status === 'verified') {
      this.parallelogram.fill('rgba(16, 185, 129, 0.06)');
      this.parallelogram.stroke('rgba(16, 185, 129, 0.52)');
    } else if (status === 'invalid') {
      this.parallelogram.fill('rgba(239, 68, 68, 0.11)');
      this.parallelogram.stroke('rgba(239, 68, 68, 0.65)');
    } else {
      this.parallelogram.fill('rgba(168, 85, 247, 0.08)');
      this.parallelogram.stroke('rgba(192, 132, 252, 0.55)');
    }
    this.layer.batchDraw();
  }

  syncGeometry() {
    const O = this.origin;
    const A = { x: O.x + this.vecA.x, y: O.y + this.vecA.y };
    const B = { x: O.x + this.vecB.x, y: O.y + this.vecB.y };
    const AB = { x: A.x + this.vecB.x, y: A.y + this.vecB.y };

    this.parallelogram.points([O.x, O.y, A.x, A.y, AB.x, AB.y, B.x, B.y]);
    this.arrowA.points([O.x, O.y, A.x, A.y]);
    this.arrowB.points([O.x, O.y, B.x, B.y]);

    this.labelA.position({
      x: O.x + this.vecA.x * 0.5 - 6,
      y: O.y + this.vecA.y * 0.5 + 8
    });
    this.labelB.position({
      x: O.x + this.vecB.x * 0.5 - 18,
      y: O.y + this.vecB.y * 0.5 - 8
    });

    const lenA = Math.hypot(this.vecA.x, this.vecA.y);
    const lenB = Math.hypot(this.vecB.x, this.vecB.y);
    let gammaDeg = 0;
    if (lenA > 1e-5 && lenB > 1e-5) {
      const dot = this.vecA.x * this.vecB.x + this.vecA.y * this.vecB.y;
      const cos = Math.max(-1, Math.min(1, dot / (lenA * lenB)));
      gammaDeg = Math.acos(cos) * RAD_TO_DEG;
    }

    this.angleLabel.text(`γ = ${Math.round(gammaDeg)}°`);
    this.angleLabel.position({
      x: O.x + 14,
      y: O.y - 22
    });

    this.onCellUpdate({
      aLen: Math.round(lenA),
      bLen: Math.round(lenB),
      gammaDeg: Math.round(gammaDeg)
    });

    this.layer.batchDraw();
  }
}
