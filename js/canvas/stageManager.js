/**
 * stageManager.js
 * Initializes the Konva.Stage and manages the 4 required layers:
 *   1. backgroundLayer: Procedural shapes, wallpaper pattern tilings, and candidate-point guides.
 *   2. cellLayer: Student-drawn unit cell basis vectors (a, b) and shaded parallelogram.
 *   3. interactiveLayer: Draggable symmetry glyphs, mirror plane anchor pins, and selection handles.
 *   4. ghostLayer: Semi-transparent geometry for animated congruence verification ("Test Symmetry" & "Test Unit Cell").
 */

import { pointsToFlatArray } from '../math/geometry.js';

export class StageManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(640, Math.floor(rect.width || 820));
    this.height = Math.max(480, Math.floor(rect.height || 600));

    this.stage = new Konva.Stage({
      container: containerId,
      width: this.width,
      height: this.height
    });

    // 1. backgroundLayer
    this.backgroundLayer = new Konva.Layer({ listening: false });
    // 2. cellLayer
    this.cellLayer = new Konva.Layer();
    // 3. interactiveLayer
    this.interactiveLayer = new Konva.Layer();
    // 4. ghostLayer
    this.ghostLayer = new Konva.Layer({ listening: false });

    this.stage.add(this.backgroundLayer);
    this.stage.add(this.cellLayer);
    this.stage.add(this.interactiveLayer);
    this.stage.add(this.ghostLayer);

    // Sub-groups inside backgroundLayer for clean updates
    this.bgGridGroup = new Konva.Group();
    this.bgGeometryGroup = new Konva.Group();
    this.bgCandidatesGroup = new Konva.Group();

    this.backgroundLayer.add(this.bgGridGroup);
    this.backgroundLayer.add(this.bgGeometryGroup);
    this.backgroundLayer.add(this.bgCandidatesGroup);

    this.showCandidates = false;
    this.currentCandidates = [];
  }

  getCenter() {
    return {
      x: Math.round(this.width * 0.5),
      y: Math.round(this.height * 0.5)
    };
  }

  resize() {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return;
    this.width = Math.floor(rect.width);
    this.height = Math.floor(rect.height);
    this.stage.width(this.width);
    this.stage.height(this.height);
    this.stage.batchDraw();
  }

  /**
   * Render subtle laboratory backdrop.
   */
  renderBackdrop(mode) {
    this.bgGridGroup.destroyChildren();
    const center = this.getCenter();

    if (mode === 'shape') {
      // Subtle outer reference ring only (no radial lines or interior clutter)
      const outerR = 235;
      this.bgGridGroup.add(
        new Konva.Circle({
          x: center.x,
          y: center.y,
          radius: outerR,
          stroke: 'rgba(148, 163, 184, 0.14)',
          strokeWidth: 1,
          dash: [4, 6]
        })
      );

      for (let deg = 0; deg < 360; deg += 15) {
        const rad = (deg * Math.PI) / 180;
        const isMajor = deg % 45 === 0 || deg % 30 === 0;
        const innerTick = isMajor ? outerR - 8 : outerR - 4;
        this.bgGridGroup.add(
          new Konva.Line({
            points: [
              center.x + innerTick * Math.cos(rad),
              center.y - innerTick * Math.sin(rad),
              center.x + (outerR + 4) * Math.cos(rad),
              center.y - (outerR + 4) * Math.sin(rad)
            ],
            stroke: isMajor ? 'rgba(148, 163, 184, 0.26)' : 'rgba(148, 163, 184, 0.12)',
            strokeWidth: 1
          })
        );
      }
    } else {
      const step = 40;
      for (let x = step; x < this.width; x += step) {
        this.bgGridGroup.add(
          new Konva.Line({
            points: [x, 0, x, this.height],
            stroke: 'rgba(148, 163, 184, 0.05)',
            strokeWidth: 1
          })
        );
      }
      for (let y = step; y < this.height; y += step) {
        this.bgGridGroup.add(
          new Konva.Line({
            points: [0, y, this.width, y],
            stroke: 'rgba(148, 163, 184, 0.05)',
            strokeWidth: 1
          })
        );
      }
    }
  }

  /**
   * Render a procedural 2D crystal polygon in Point Group Mode on backgroundLayer.
   * Clean solid-outlined shape without radial center-to-vertex lines or inner dashed duplicate.
   */
  renderPointShape(shapeData) {
    this.renderBackdrop('shape');
    this.bgGeometryGroup.destroyChildren();

    const { vertices } = shapeData;
    const flatPts = pointsToFlatArray(vertices);

    // Single solid-outlined crystal polygon
    const mainPoly = new Konva.Line({
      points: flatPts,
      closed: true,
      fill: 'rgba(56, 189, 248, 0.24)',
      stroke: '#38bdf8',
      strokeWidth: 2.8,
      lineJoin: 'round'
    });
    this.bgGeometryGroup.add(mainPoly);

    // Subtle vertex facet dots
    for (const v of vertices) {
      this.bgGeometryGroup.add(
        new Konva.Circle({
          x: v.x,
          y: v.y,
          radius: 3.2,
          fill: '#bae6fd',
          stroke: '#0284c7',
          strokeWidth: 1
        })
      );
    }

    this.currentCandidates = shapeData.candidates || [];
    this.renderCandidatePoints();
    this.backgroundLayer.batchDraw();
  }

  /**
   * Render a periodic wallpaper pattern tiling (either tessellated tiles or displaced crystal motifs)
   * on backgroundLayer.
   */
  renderWallpaperTiling(tilingData) {
    this.renderBackdrop('wallpaper');
    this.bgGeometryGroup.destroyChildren();

    const { motifs } = tilingData;

    for (const motif of motifs) {
      const flatPts = pointsToFlatArray(motif.vertices);
      this.bgGeometryGroup.add(
        new Konva.Line({
          points: flatPts,
          closed: true,
          fill: motif.fill || 'rgba(56, 189, 248, 0.24)',
          stroke: motif.stroke || '#38bdf8',
          strokeWidth: motif.strokeWidth || 2,
          lineJoin: 'round'
        })
      );
    }

    this.currentCandidates = tilingData.candidates || [];
    this.renderCandidatePoints();
    this.backgroundLayer.batchDraw();
  }

  /**
   * Toggle or update subtle ghost dots at high-symmetry candidate locations on backgroundLayer.
   */
  setShowCandidates(show) {
    this.showCandidates = Boolean(show);
    this.renderCandidatePoints();
    this.backgroundLayer.batchDraw();
  }

  renderCandidatePoints() {
    this.bgCandidatesGroup.destroyChildren();
    if (!this.showCandidates || !this.currentCandidates.length) return;

    for (const c of this.currentCandidates) {
      const isPrimary = c.type === 'centroid' || c.type === 'lattice';
      this.bgCandidatesGroup.add(
        new Konva.Circle({
          x: c.x,
          y: c.y,
          radius: isPrimary ? 5.5 : 4,
          fill: isPrimary ? 'rgba(250, 204, 21, 0.38)' : 'rgba(148, 163, 184, 0.35)',
          stroke: isPrimary ? 'rgba(250, 204, 21, 0.8)' : 'rgba(226, 232, 240, 0.6)',
          strokeWidth: 1.2
        })
      );
    }
  }
}
