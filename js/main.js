/**
 * main.js
 * Application controller for the 2D Crystallographic Symmetry Workbench.
 * Coordinates state across the math generators, Konva 4-layer stage,
 * interactive glyphs, unit cell tool, animated verifier, checklist, and hints.
 */

import {
  POINT_GROUP_PRESETS,
  WALLPAPER_PRESETS,
  WALLPAPER_KEYS
} from './data/symmetryData.js';
import {
  generateSymmetricShape,
  getShapeExpectedChecklist
} from './math/shapeGenerator.js';
import {
  generateWallpaperTiling,
  getWallpaperExpectedChecklist
} from './math/wallpaperEngine.js';
import {
  lineAngleCartesianDeg,
  cartesianAngleToScreenUnitVec
} from './math/geometry.js';
import { StageManager } from './canvas/stageManager.js';
import { GlyphManager } from './canvas/glyphManager.js';
import { UnitCellTool } from './canvas/unitCellTool.js';
import { SymmetryVerifier } from './canvas/verifier.js';
import { CompassWidget } from './ui/compassWidget.js';
import { DiscoveryChecklist } from './ui/checklist.js';

/**
 * Return a randomized shallow copy of `arr` using Fisher-Yates shuffle
 * so specimen and pattern dropdowns do not go from least to most symmetry.
 */
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

class SymmetryWorkbenchApp {
  constructor() {
    this.mode = 'shape'; // 'shape' | 'wallpaper'
    this.isConvex = false; // Default to non-convex crystal profile to showcase rich symmetry
    this.isTessellated = false; // Tessellated edge-to-edge tiling mode for wallpaper patterns
    this.seed = 2026;
    this.batchTestTimer = null;

    // Randomize the ordering and numbering of the 10 crystal specimens and 9 periodic patterns
    // so they do not progress monotonically from lowest to highest symmetry
    this.shuffledPointPresets = shuffleArray(POINT_GROUP_PRESETS);
    this.shuffledWallpaperKeys = shuffleArray(WALLPAPER_KEYS);

    // Track which specimens/patterns have had all symmetry elements solved in this session
    this.solvedPointGroupIds = new Set();
    this.solvedWallpaperKeys = new Set();

    // In Wallpaper Mode, glyphs remain greyed out until the unit cell is identified
    this.unitCellVerified = false;

    // Hint toggles
    this.hints = {
      compass: false,
      toolboxFilter: false,
      candidatePoints: false
    };

    // Active presets
    this.activePointPreset =
      POINT_GROUP_PRESETS.find((p) => p.id === 'pg_4mm') || POINT_GROUP_PRESETS[0];
    this.activeWallpaperKey = 'p4m';

    // Current generated mathematical models
    this.currentShapeData = null;
    this.currentTilingData = null;

    this.initComponents();
    this.populateSelectors();
    this.bindEvents();
    this.rebuildScene(false);
  }

  initComponents() {
    this.stageManager = new StageManager('canvas-container');

    this.compassWidget = new CompassWidget(
      'mirror-compass-svg',
      'mirror-compass-readout'
    );

    this.checklist = new DiscoveryChecklist(
      'checklist-items',
      'checklist-counter',
      'feedback-banner'
    );

    this.glyphManager = new GlyphManager(
      this.stageManager,
      (activeGlyph) => this.onGlyphSelectionChange(activeGlyph),
      (snapCandidate) => this.onSnapStatusChange(snapCandidate)
    );

    this.unitCellTool = new UnitCellTool(
      this.stageManager,
      (metrics) => this.onUnitCellMetricsUpdate(metrics),
      (snapCandidate) => this.onSnapStatusChange(snapCandidate)
    );

    this.verifier = new SymmetryVerifier(this.stageManager);
  }

  populateSelectors() {
    this.refreshPointGroupSelectorLabels();
    this.refreshWallpaperSelectorLabels();
  }

  /**
   * Keep crystal point symmetry class names hidden in the selector until all symmetry
   * elements for that specimen are found by the student.
   */
  refreshPointGroupSelectorLabels() {
    const pgSelect = document.getElementById('select-point-group');
    if (!pgSelect) return;

    const currentVal = this.activePointPreset.id;
    pgSelect.innerHTML = '';

    this.shuffledPointPresets.forEach((preset, idx) => {
      const opt = document.createElement('option');
      opt.value = preset.id;
      const isSolved =
        this.solvedPointGroupIds.has(preset.id) ||
        (this.mode === 'shape' &&
          preset.id === this.activePointPreset.id &&
          this.checklist?.isAllFound());

      opt.textContent = isSolved
        ? `Specimen #${idx + 1}: ${preset.label}`
        : `Crystal Specimen #${idx + 1} (Unidentified)`;
      if (preset.id === currentVal) opt.selected = true;
      pgSelect.appendChild(opt);
    });
  }

  /**
   * Keep periodic pattern descriptive names hidden in the selector until all symmetry
   * elements for that pattern are found by the student, while retaining internal keys p1..p6m.
   */
  refreshWallpaperSelectorLabels() {
    const wpSelect = document.getElementById('select-wallpaper-group');
    if (!wpSelect) return;

    const currentKey = this.activeWallpaperKey;
    wpSelect.innerHTML = '';

    this.shuffledWallpaperKeys.forEach((key, idx) => {
      const preset = WALLPAPER_PRESETS[key];
      const opt = document.createElement('option');
      opt.value = preset.key; // Strictly retain ['p1', 'p2', 'pm', 'pmm', 'p4', 'p4m', 'p3', 'p6', 'p6m']
      const isSolved =
        this.solvedWallpaperKeys.has(preset.key) ||
        (this.mode === 'wallpaper' &&
          preset.key === this.activeWallpaperKey &&
          this.checklist?.isAllFound());

      opt.textContent = isSolved
        ? `Pattern #${idx + 1}: ${preset.label}`
        : `Periodic Pattern #${idx + 1} (Unidentified)`;
      if (preset.key === currentKey) opt.selected = true;
      wpSelect.appendChild(opt);
    });
  }

  bindEvents() {
    // Mode switcher ('shape' vs 'wallpaper')
    document.getElementById('btn-mode-shape')?.addEventListener('click', () => {
      this.setMode('shape');
    });
    document.getElementById('btn-mode-wallpaper')?.addEventListener('click', () => {
      this.setMode('wallpaper');
    });

    // Point group & Wallpaper selectors
    document.getElementById('select-point-group')?.addEventListener('change', (e) => {
      const found = POINT_GROUP_PRESETS.find((p) => p.id === e.target.value);
      if (found) {
        this.activePointPreset = found;
        this.solvedPointGroupIds.delete(found.id);
        this.rebuildScene(false);
      }
    });

    document.getElementById('select-wallpaper-group')?.addEventListener('change', (e) => {
      const key = e.target.value;
      if (WALLPAPER_PRESETS[key]) {
        this.activeWallpaperKey = key;
        this.solvedWallpaperKeys.delete(key);
        this.rebuildScene(false);
      }
    });

    // Convex vs Non-Convex vs Tessellated toggles
    document.getElementById('btn-shape-convex')?.addEventListener('click', () => {
      this.setMorphology('convex');
    });
    document.getElementById('btn-shape-nonconvex')?.addEventListener('click', () => {
      this.setMorphology('nonconvex');
    });
    document.getElementById('btn-shape-tessellated')?.addEventListener('click', () => {
      this.setMorphology('tessellated');
    });

    // "New Random Shape" / "New Random Pattern" button
    document.getElementById('btn-random-shape')?.addEventListener('click', () => {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;

      if (this.mode === 'shape') {
        this.solvedPointGroupIds.delete(this.activePointPreset.id);
        this.rebuildScene(false);
        this.checklist.showFeedback(
          'info',
          'Generated new random crystal geometry and reset the discovery checklist.'
        );
      } else {
        // Pick a new periodic pattern from the randomized dropdown list
        const otherKeys = this.shuffledWallpaperKeys.filter(
          (k) => k !== this.activeWallpaperKey
        );
        const nextIdx = (this.seed >>> 3) % otherKeys.length;
        this.activeWallpaperKey = otherKeys[nextIdx];
        this.solvedWallpaperKeys.delete(this.activeWallpaperKey);

        // If on Tessellated Tiling, keep Tessellated Tiling active; otherwise use Convex Crystal
        if (!this.isTessellated) {
          this.isConvex = true;
        }
        this.syncMorphologyButtons();

        this.rebuildScene(false);
        this.checklist.showFeedback(
          'info',
          this.isTessellated
            ? 'Selected a new periodic pattern (tessellated tiling) and reset the discovery checklist.'
            : 'Selected a new periodic pattern (convex crystal) and reset the discovery checklist.'
        );
      }
    });

    // "New Random Crystal Specimen" button (Point Group Shapes mode)
    document.getElementById('btn-random-specimen')?.addEventListener('click', () => {
      if (this.mode !== 'shape') return;
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      const otherPresets = this.shuffledPointPresets.filter(
        (p) => p.id !== this.activePointPreset.id
      );
      const nextIdx = (this.seed >>> 3) % otherPresets.length;
      this.activePointPreset = otherPresets[nextIdx];
      this.solvedPointGroupIds.delete(this.activePointPreset.id);
      this.rebuildScene(false);
      this.checklist.showFeedback(
        'info',
        'Selected a new random crystal specimen and reset the discovery checklist.'
      );
    });

    // Glyph placement buttons
    const toolButtons = document.querySelectorAll('[data-tool]');
    toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled || btn.classList.contains('filtered-out')) return;
        const toolType = btn.getAttribute('data-tool');
        this.spawnGlyphFromToolbox(toolType);
      });
    });

    // Remove / Clear glyphs
    document.getElementById('btn-remove-glyph')?.addEventListener('click', () => {
      this.glyphManager.removeActiveGlyph();
    });
    document.getElementById('btn-clear-glyphs')?.addEventListener('click', () => {
      if (this.batchTestTimer) {
        clearTimeout(this.batchTestTimer);
        this.batchTestTimer = null;
      }
      this.glyphManager.clearAll();
      this.verifier.clearGhostLayer();
    });

    // "Test Symmetry" button
    document.getElementById('btn-test-symmetry')?.addEventListener('click', () => {
      this.handleTestSymmetry();
    });

    // "Test Unit Cell" button (Wallpaper Mode)
    document.getElementById('btn-test-unit-cell')?.addEventListener('click', () => {
      this.handleTestUnitCell();
    });

    // Unlock / Reset Unit Cell handles
    document.getElementById('btn-reset-cell')?.addEventListener('click', () => {
      if (this.currentTilingData) {
        this.unitCellTool.setLocked(false);
        this.unitCellTool.setStatus('unverified');
        const pill = document.getElementById('unit-cell-status-pill');
        if (pill) pill.textContent = 'Step 1: Basis (a, b)';
        this.checklist.showFeedback(
          'info',
          'Unit cell handles unlocked. Drag origin O and vector tips a and b, then click "Test Unit Cell".'
        );
      }
    });

    // Hint Toggles
    document.getElementById('toggle-compass-hint')?.addEventListener('change', (e) => {
      this.hints.compass = e.target.checked;
      this.updateCompassState();
    });

    document.getElementById('toggle-toolbox-filter')?.addEventListener('change', (e) => {
      this.hints.toolboxFilter = e.target.checked;
      this.updateToolboxState();
    });

    document.getElementById('toggle-candidate-points')?.addEventListener('change', (e) => {
      this.hints.candidatePoints = e.target.checked;
      this.stageManager.setShowCandidates(this.hints.candidatePoints);
    });

    // Window resize handler
    window.addEventListener('resize', () => {
      this.stageManager.resize();
      this.rebuildScene(true);
    });
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;

    document.getElementById('btn-mode-shape')?.classList.toggle('active', mode === 'shape');
    document.getElementById('btn-mode-wallpaper')?.classList.toggle('active', mode === 'wallpaper');

    document.getElementById('point-group-controls')?.classList.toggle('hidden', mode !== 'shape');
    document.getElementById('wallpaper-group-controls')?.classList.toggle('hidden', mode !== 'wallpaper');
    document.getElementById('unit-cell-panel')?.classList.toggle('hidden', mode !== 'wallpaper');
    document.getElementById('btn-shape-tessellated')?.classList.toggle('hidden', mode !== 'wallpaper');
    document.getElementById('btn-random-specimen')?.classList.toggle('hidden', mode !== 'shape');

    if (mode === 'shape' && this.isTessellated) {
      this.isTessellated = false;
    }
    this.syncMorphologyButtons();

    // Update section step numbering for Symmetry Glyphs
    const glyphsTitle = document.getElementById('symmetry-glyphs-title');
    if (glyphsTitle) {
      glyphsTitle.textContent = mode === 'wallpaper' ? '3. Symmetry Glyphs' : '2. Symmetry Glyphs';
    }

    // Update "New Random Shape" vs "New Random Pattern" button label
    const randomBtn = document.getElementById('btn-random-shape');
    if (randomBtn) {
      randomBtn.innerHTML =
        mode === 'wallpaper'
          ? '<span aria-hidden="true">↻</span> New Random Pattern'
          : '<span aria-hidden="true">↻</span> New Random Shape';
    }

    this.rebuildScene(false);
  }

  syncMorphologyButtons() {
    const isTess = this.mode === 'wallpaper' && this.isTessellated;
    document.getElementById('btn-shape-convex')?.classList.toggle('active', !isTess && this.isConvex);
    document.getElementById('btn-shape-nonconvex')?.classList.toggle('active', !isTess && !this.isConvex);
    document.getElementById('btn-shape-tessellated')?.classList.toggle('active', isTess);
  }

  setMorphology(morphology) {
    if (morphology === 'tessellated') {
      this.isConvex = true;
      this.isTessellated = true;
    } else if (morphology === 'convex') {
      this.isConvex = true;
      this.isTessellated = false;
    } else {
      this.isConvex = false;
      this.isTessellated = false;
    }
    this.syncMorphologyButtons();
    this.rebuildScene(false);
  }

  setConvexity(isConvex) {
    this.setMorphology(isConvex ? 'convex' : 'nonconvex');
  }

  /**
   * Rebuild the active mathematical geometry and Konva backgroundLayer.
   * If preserveProgress is true (e.g., when clicking "New Random Shape/Pattern"), keeps discovered checklist items.
   */
  rebuildScene(preserveProgress = false) {
    if (this.batchTestTimer) {
      clearTimeout(this.batchTestTimer);
      this.batchTestTimer = null;
    }
    this.verifier.clearGhostLayer();
    if (!preserveProgress) {
      this.glyphManager.clearAll();
      this.unitCellVerified = false;
    }

    const center = this.stageManager.getCenter();

    if (this.mode === 'shape') {
      const radius = Math.min(this.stageManager.width, this.stageManager.height) * 0.30;
      this.currentShapeData = generateSymmetricShape({
        preset: this.activePointPreset,
        isConvex: this.isConvex,
        center,
        radius,
        seed: this.seed
      });

      this.stageManager.renderPointShape(this.currentShapeData);
      this.glyphManager.setCandidates(this.currentShapeData.candidates);
      this.glyphManager.setReplicationVectors(null, null);
      this.unitCellTool.setVisible(false);
    } else {
      const wpPreset = WALLPAPER_PRESETS[this.activeWallpaperKey];
      this.currentTilingData = generateWallpaperTiling({
        preset: wpPreset,
        isConvex: this.isConvex,
        isTessellated: this.isTessellated,
        stageWidth: this.stageManager.width,
        stageHeight: this.stageManager.height,
        seed: this.seed
      });

      this.stageManager.renderWallpaperTiling(this.currentTilingData);
      this.glyphManager.setCandidates(this.currentTilingData.candidates);

      this.unitCellTool.setCandidates(this.currentTilingData.candidates);
      this.unitCellTool.setVisible(true);

      if (!preserveProgress) {
        // Start unit cell vectors at generic default length/angle so student must actively outline the cell
        this.unitCellTool.initForTiling(this.currentTilingData, false);
        this.glyphManager.setReplicationVectors(null, null);
        const pill = document.getElementById('unit-cell-status-pill');
        if (pill) pill.textContent = 'Step 1: Basis (a, b)';
      } else if (this.unitCellVerified) {
        const vecs = this.unitCellTool.getVectors();
        this.glyphManager.setReplicationVectors(vecs.vecA, vecs.vecB);
      }
    }

    this.updateExpectedChecklist(preserveProgress);
    this.updateSpecimenRevealState();
    this.updateCompassState();
    this.updateToolboxState();

    if (!preserveProgress) {
      this.checklist.showFeedback(
        'info',
        this.mode === 'shape'
          ? 'Find all symmetry elements to reveal the crystal point symmetry class and mineralogical explanation!'
          : 'Step 1: Drag basis vectors a and b to outline a primitive unit cell and click "Test Unit Cell" to unlock the symmetry glyphs.'
      );
    }
  }

  updateExpectedChecklist(preserveProgress = false) {
    const expected =
      this.mode === 'shape'
        ? getShapeExpectedChecklist(this.currentShapeData)
        : getWallpaperExpectedChecklist(this.currentTilingData, false);
    this.checklist.reset(expected, preserveProgress);
  }

  /**
   * Show or hide the Point Symmetry Class / Periodic Pattern name, mineralogical explanation,
   * and "Active Specimen" header based on whether all symmetry elements have been found.
   */
  updateSpecimenRevealState() {
    const allFound = this.checklist.isAllFound();

    const pointClassRevealBox = document.getElementById('point-class-reveal');
    const revealedClassName = document.getElementById('revealed-class-name');
    const wpClassRevealBox = document.getElementById('wallpaper-class-reveal');
    const revealedWpName = document.getElementById('revealed-wallpaper-name');
    const hintEl = document.getElementById('mineral-context-note');
    const specimenBadge = document.getElementById('active-specimen-badge');
    const headerTitle = document.getElementById('active-specimen-title');

    if (this.mode === 'shape') {
      if (allFound) {
        this.solvedPointGroupIds.add(this.activePointPreset.id);
      }
      this.refreshPointGroupSelectorLabels();

      if (wpClassRevealBox) wpClassRevealBox.classList.add('hidden');

      if (pointClassRevealBox && revealedClassName) {
        revealedClassName.textContent = allFound ? this.activePointPreset.label : '';
        pointClassRevealBox.classList.toggle('hidden', !allFound);
      }

      if (hintEl) {
        hintEl.textContent = allFound ? this.activePointPreset.mineralHint : '';
        hintEl.classList.toggle('hidden', !allFound);
      }

      if (specimenBadge && headerTitle) {
        headerTitle.textContent = allFound ? this.activePointPreset.label : '';
        specimenBadge.classList.toggle('hidden', !allFound);
      }
    } else {
      const wpPreset = WALLPAPER_PRESETS[this.activeWallpaperKey];
      if (allFound) {
        this.solvedWallpaperKeys.add(this.activeWallpaperKey);
      }
      this.refreshWallpaperSelectorLabels();

      if (pointClassRevealBox) pointClassRevealBox.classList.add('hidden');

      if (wpClassRevealBox && revealedWpName) {
        revealedWpName.textContent = allFound ? wpPreset.label : '';
        wpClassRevealBox.classList.toggle('hidden', !allFound);
      }

      if (hintEl) {
        hintEl.textContent = allFound ? wpPreset.description : '';
        hintEl.classList.toggle('hidden', !allFound);
      }

      if (specimenBadge && headerTitle) {
        headerTitle.textContent = allFound ? wpPreset.label : '';
        specimenBadge.classList.toggle('hidden', !allFound);
      }
    }
  }

  updateCompassState() {
    const mirrorAnglesDeg =
      this.mode === 'shape'
        ? this.currentShapeData?.mirrorAnglesDeg || []
        : this.currentTilingData?.mirrorAnglesDeg || [];

    this.compassWidget.setState({
      enabled: this.hints.compass,
      mirrorAnglesDeg
    });
  }

  /**
   * Update glyph toolbox buttons based on mode, Unit Cell verification prerequisite (in Wallpaper Mode),
   * and the Toolbox Filter Hint.
   */
  updateToolboxState() {
    const validRotations =
      this.mode === 'shape'
        ? this.currentShapeData?.rotations || []
        : this.currentTilingData?.rotations || [];
    const validMirrors =
      this.mode === 'shape'
        ? (this.currentShapeData?.mirrorAnglesDeg?.length || 0) > 0
        : (this.currentTilingData?.mirrorAnglesDeg?.length || 0) > 0;

    // In Wallpaper Mode, symmetry glyphs are greyed out until the unit cell has been identified
    const lockedByUnitCell = this.mode === 'wallpaper' && !this.unitCellVerified;

    const lockNotice = document.getElementById('glyph-lock-notice');
    if (lockNotice) {
      lockNotice.classList.toggle('hidden', !lockedByUnitCell);
    }

    const filterOn = this.hints.toolboxFilter;

    const configureToolBtn = (id, isPresent) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = lockedByUnitCell;
      const shouldGreyOut = !lockedByUnitCell && filterOn && !isPresent;
      el.classList.toggle('filtered-out', shouldGreyOut);
    };

    configureToolBtn('tool-rot2', validRotations.includes(2));
    configureToolBtn('tool-rot3', validRotations.includes(3));
    configureToolBtn('tool-rot4', validRotations.includes(4));
    configureToolBtn('tool-rot6', validRotations.includes(6));
    configureToolBtn('tool-mirror', validMirrors);

    const testSymBtn = document.getElementById('btn-test-symmetry');
    const removeBtn = document.getElementById('btn-remove-glyph');
    const clearBtn = document.getElementById('btn-clear-glyphs');
    if (testSymBtn) testSymBtn.disabled = lockedByUnitCell;
    if (removeBtn) removeBtn.disabled = lockedByUnitCell;
    if (clearBtn) clearBtn.disabled = lockedByUnitCell;
  }

  /**
   * Spawn a glyph onto interactiveLayer when the student clicks a toolbox button.
   * Rotation glyphs default to the top-left of the shape window; mirror lines
   * default to vertical along the left-hand side of the shape window in the exact same position.
   */
  spawnGlyphFromToolbox(toolType) {
    if (this.mode === 'wallpaper' && !this.unitCellVerified) return;
    this.glyphManager.addGlyph(toolType);
  }

  /**
   * Execute animated "Test Symmetry" on `ghostLayer`.
   * Tests all untested symmetry elements placed by the student, one at a time sequentially.
   * Each verified element is rectified (snapped to exact coordinates), locked down, and dimmed.
   */
  handleTestSymmetry() {
    if (this.mode === 'wallpaper' && !this.unitCellVerified) return;

    if (this.batchTestTimer) {
      clearTimeout(this.batchTestTimer);
      this.batchTestTimer = null;
    }

    const untestedQueue = [...this.glyphManager.getUntestedGlyphs()];
    if (untestedQueue.length === 0) {
      this.checklist.showFeedback(
        'warning',
        'Please place a new symmetry glyph from the toolbox first, then click "Test Symmetry".'
      );
      return;
    }

    let lastFailedGlyph = null;
    const totalToTest = untestedQueue.length;

    const runSingleGlyphTest = (idx) => {
      const glyph = untestedQueue[idx];
      if (!glyph) return;

      const stepPrefix =
        totalToTest > 1 ? `[Testing ${idx + 1}/${totalToTest}] ` : '';
      this.checklist.showFeedback(
        'testing',
        `${stepPrefix}Testing symmetry congruence...`
      );

      this.verifier.runSymmetryTest({
        mode: this.mode,
        shapeData: this.currentShapeData,
        tilingData: this.currentTilingData,
        glyph,
        onComplete: (result) => {
          if (result.valid) {
            this.glyphManager.rectifyAndLockGlyph(glyph, result);
            this.checklist.recordDiscovery(result.checklistId, result.checklistLabel);
            this.updateSpecimenRevealState();
            const allFoundNow = this.checklist.isAllFound();
            const unlockedLabel =
              this.mode === 'shape'
                ? this.activePointPreset.label
                : WALLPAPER_PRESETS[this.activeWallpaperKey].label;
            const suffix = allFoundNow
              ? ` All symmetry elements found — unlocked: ${unlockedLabel}!`
              : '';
            this.checklist.showFeedback(
              'success',
              `${stepPrefix}${result.message}${suffix}`
            );
          } else {
            lastFailedGlyph = glyph;
            this.glyphManager.setGlyphStatus(glyph, 'invalid');
            if (this.mode === 'shape' && this.activePointPreset.id === 'pg_1') {
              this.checklist.markAsymmetricTested();
              this.updateSpecimenRevealState();
            }
            this.checklist.showFeedback('error', `${stepPrefix}${result.message}`);
          }

          if (idx + 1 < totalToTest) {
            this.batchTestTimer = setTimeout(() => {
              this.batchTestTimer = null;
              runSingleGlyphTest(idx + 1);
            }, 650);
          } else {
            // When batch finishes, keep any failed glyph active so the user can fix or remove it
            if (lastFailedGlyph && lastFailedGlyph.status !== 'verified') {
              this.glyphManager.setActiveGlyph(lastFailedGlyph.id);
            } else {
              this.glyphManager.setActiveGlyph(null);
            }
          }
        }
      });
    };

    runSingleGlyphTest(0);
  }

  /**
   * Execute animated "Test Unit Cell" on `ghostLayer` (Wallpaper Mode).
   * Translates the outlined unit cell across the field of view and verifies congruence.
   * When verified, locks unit cell handles, unlocks symmetry glyphs, and enables periodic glyph replication!
   */
  handleTestUnitCell() {
    if (this.mode !== 'wallpaper' || !this.currentTilingData) return;

    const unitCellVectors = this.unitCellTool.getVectors();
    this.checklist.showFeedback(
      'testing',
      'Tiling the field of view with your outlined unit cell (m·a + n·b)...'
    );

    this.verifier.runUnitCellTest({
      tilingData: this.currentTilingData,
      unitCellVectors,
      onComplete: (result) => {
        if (result.valid) {
          this.unitCellVerified = true;
          this.unitCellTool.setStatus('verified');
          this.unitCellTool.setLocked(true);

          const pill = document.getElementById('unit-cell-status-pill');
          if (pill) pill.textContent = '✓ Unit Cell Verified (Locked)';

          // Enable periodic copying of drag-and-dropped glyphs across all other unit cells
          this.glyphManager.setReplicationVectors(
            unitCellVectors.vecA,
            unitCellVectors.vecB
          );

          this.checklist.recordDiscovery(result.checklistId, result.checklistLabel);
          this.updateToolboxState();
          this.updateSpecimenRevealState();

          const allFoundNow = this.checklist.isAllFound();
          const wpLabel = WALLPAPER_PRESETS[this.activeWallpaperKey].label;
          const suffix = allFoundNow
            ? ` All symmetry elements found — unlocked pattern: ${wpLabel}!`
            : ' Symmetry glyphs are now unlocked — drag glyphs onto the unit cell to copy them across the lattice!';
          this.checklist.showFeedback('success', `${result.message}${suffix}`);
        } else {
          this.unitCellTool.setStatus('invalid');
          this.checklist.showFeedback('error', result.message);
        }
      }
    });
  }

  onGlyphSelectionChange(glyph) {
    const readout = document.getElementById('hud-active-glyph');
    if (!readout) return;
    if (!glyph) {
      readout.textContent = 'Selected Glyph: None';
      return;
    }
    if (glyph.kind === 'mirror') {
      const { p1, p2 } = glyph.getEndpoints();
      const angle = Math.round(lineAngleCartesianDeg(p1, p2));
      readout.textContent = `Selected: Mirror Line (${angle}°)`;
    } else {
      const pos = glyph.getPosition();
      readout.textContent = `Selected: ${glyph.order}-Fold Axis (${Math.round(pos.x)}, ${Math.round(pos.y)})`;
    }
  }

  onSnapStatusChange(candidate) {
    const snapEl = document.getElementById('hud-snap-status');
    if (!snapEl) return;
    if (candidate) {
      snapEl.textContent = `Magnetically Snapped (≤14px): ${candidate.label}`;
      snapEl.classList.add('snapped');
    } else {
      snapEl.textContent = '14px Magnetic Snap: Ready';
      snapEl.classList.remove('snapped');
    }
  }

  onUnitCellMetricsUpdate(metrics) {
    const aEl = document.getElementById('cell-metric-a');
    const bEl = document.getElementById('cell-metric-b');
    const gEl = document.getElementById('cell-metric-gamma');
    if (aEl) aEl.textContent = `${metrics.aLen} px`;
    if (bEl) bEl.textContent = `${metrics.bLen} px`;
    if (gEl) gEl.textContent = `${metrics.gammaDeg}°`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.symmetryApp = new SymmetryWorkbenchApp();
});
