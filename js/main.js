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
    this.seed = Math.floor(Math.random() * 900000) + 100000;
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

    // Start with a random crystal specimen and random periodic pattern on app open
    this.activePointPreset = this.shuffledPointPresets[0];
    this.activeWallpaperKey = this.shuffledWallpaperKeys[0];

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

    // Top button: "Redraw Current Specimen" / "Redraw Current Pattern"
    // Generates a new random instance of the SAME crystal specimen or periodic pattern
    // while keeping any already-verified unit cell, locked symmetry glyphs, and checklist progress in place.
    document.getElementById('btn-random-shape')?.addEventListener('click', () => {
      this.seed = (this.seed + 1) >>> 0;

      if (this.mode === 'shape') {
        this.rebuildScene(true);
        this.checklist.showFeedback(
          'info',
          'Redrew a new crystal geometry for this specimen (existing symmetry elements preserved).'
        );
      } else {
        this.rebuildScene(true);
        this.checklist.showFeedback(
          'info',
          this.isTessellated
            ? 'Generated a new tessellated tiling for this periodic pattern (unit cell & symmetry elements preserved).'
            : 'Redrew a new motif geometry for this periodic pattern (unit cell & symmetry elements preserved).'
        );
      }
    });

    // Bottom button: "New Random Crystal Specimen" / "New Random Periodic Pattern"
    // Picks a specimen/pattern at random from those not yet identified (falling back to all other
    // specimens/patterns once all have been identified) and resets the discovery checklist.
    document.getElementById('btn-random-specimen')?.addEventListener('click', () => {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;

      if (this.mode === 'shape') {
        const unsolvedOthers = this.shuffledPointPresets.filter(
          (p) =>
            p.id !== this.activePointPreset.id && !this.solvedPointGroupIds.has(p.id)
        );
        const pool =
          unsolvedOthers.length > 0
            ? unsolvedOthers
            : this.shuffledPointPresets.filter((p) => p.id !== this.activePointPreset.id);
        const picked = pool[Math.floor(Math.random() * pool.length)];
        this.activePointPreset = picked;
        if (unsolvedOthers.length === 0) {
          this.solvedPointGroupIds.delete(picked.id);
        }
        this.rebuildScene(false);
        this.checklist.showFeedback(
          'info',
          'Selected a new random crystal specimen and reset the discovery checklist.'
        );
      } else {
        const unsolvedOthers = this.shuffledWallpaperKeys.filter(
          (k) =>
            k !== this.activeWallpaperKey && !this.solvedWallpaperKeys.has(k)
        );
        const pool =
          unsolvedOthers.length > 0
            ? unsolvedOthers
            : this.shuffledWallpaperKeys.filter((k) => k !== this.activeWallpaperKey);
        const pickedKey = pool[Math.floor(Math.random() * pool.length)];
        this.activeWallpaperKey = pickedKey;
        if (unsolvedOthers.length === 0) {
          this.solvedWallpaperKeys.delete(pickedKey);
        }
        this.rebuildScene(false);
        this.checklist.showFeedback(
          'info',
          'Selected a new random periodic pattern and reset the discovery checklist.'
        );
      }
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

    if (mode === 'shape' && this.isTessellated) {
      this.isTessellated = false;
    }
    this.syncMorphologyButtons();

    // Update section step numbering for Symmetry Glyphs
    const glyphsTitle = document.getElementById('symmetry-glyphs-title');
    if (glyphsTitle) {
      glyphsTitle.textContent = mode === 'wallpaper' ? '3. Symmetry Glyphs' : '2. Symmetry Glyphs';
    }

    // Update "Redraw Current Specimen" vs "Redraw Current Pattern" button label
    const randomBtn = document.getElementById('btn-random-shape');
    if (randomBtn) {
      randomBtn.innerHTML =
        mode === 'wallpaper'
          ? '<span aria-hidden="true">↻</span> Redraw Current Pattern'
          : '<span aria-hidden="true">↻</span> Redraw Current Specimen';
    }

    // Update "New Random Crystal Specimen" vs "New Random Periodic Pattern" button label
    const specimenBtn = document.getElementById('btn-random-specimen');
    if (specimenBtn) {
      specimenBtn.innerHTML =
        mode === 'wallpaper'
          ? '<span aria-hidden="true">🎲</span> New Random Periodic Pattern'
          : '<span aria-hidden="true">🎲</span> New Random Crystal Specimen';
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
      this.resetHints();
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

  /**
   * Reset all 3 checkboxes in the Hints panel to unchecked and update stage/compass/toolbox states.
   */
  resetHints() {
    this.hints.compass = false;
    this.hints.toolboxFilter = false;
    this.hints.candidatePoints = false;

    const compassToggle = document.getElementById('toggle-compass-hint');
    const filterToggle = document.getElementById('toggle-toolbox-filter');
    const candidateToggle = document.getElementById('toggle-candidate-points');
    if (compassToggle) compassToggle.checked = false;
    if (filterToggle) filterToggle.checked = false;
    if (candidateToggle) candidateToggle.checked = false;

    this.stageManager.setShowCandidates(false);
    this.updateCompassState();
    this.updateToolboxState();
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

    const hasNoSymmetry = validRotations.length === 0 && !validMirrors;

    configureToolBtn('tool-rot2', validRotations.includes(2));
    configureToolBtn('tool-rot3', validRotations.includes(3));
    configureToolBtn('tool-rot4', validRotations.includes(4));
    configureToolBtn('tool-rot6', validRotations.includes(6));
    configureToolBtn('tool-mirror', validMirrors);
    configureToolBtn('tool-nosym', hasNoSymmetry);

    const testSymBtn = document.getElementById('btn-test-symmetry');
    const removeBtn = document.getElementById('btn-remove-glyph');
    const clearBtn = document.getElementById('btn-clear-glyphs');
    if (testSymBtn) testSymBtn.disabled = lockedByUnitCell;
    if (removeBtn) removeBtn.disabled = lockedByUnitCell;
    if (clearBtn) clearBtn.disabled = lockedByUnitCell;
  }

  /**
   * Spawn a glyph onto interactiveLayer when the student clicks a toolbox button,
   * or immediately evaluate "No Symmetry" when the student clicks the No Symmetry button.
   */
  spawnGlyphFromToolbox(toolType) {
    if (this.mode === 'wallpaper' && !this.unitCellVerified) return;
    if (toolType === 'nosym') {
      this.handleNoSymmetry();
      return;
    }
    this.glyphManager.addGlyph(toolType);
  }

  /**
   * Evaluate the "No Symmetry" button click immediately:
   * - If the active crystal specimen or periodic pattern truly has 0 rotational/mirror elements,
   *   complete the checklist, reveal the specimen/pattern name, and launch celebratory fireworks.
   * - Otherwise, flash the shape or pattern red on `ghostLayer` and display error feedback.
   */
  handleNoSymmetry() {
    if (this.mode === 'wallpaper' && !this.unitCellVerified) return;

    if (this.mode === 'shape') {
      const isAsymmetric =
        (this.currentShapeData?.rotations?.length || 0) === 0 &&
        (this.currentShapeData?.mirrorAnglesDeg?.length || 0) === 0;

      if (isAsymmetric) {
        const wasAllFound = this.checklist.isAllFound();
        this.checklist.markAsymmetricTested();
        this.updateSpecimenRevealState();
        const unlockedLabel = this.activePointPreset.label;
        this.checklist.showFeedback(
          'success',
          `Asymmetric profile verified (0 symmetry elements) — unlocked: ${unlockedLabel}!`
        );
        if (!wasAllFound && this.checklist.isAllFound()) {
          this.resetHints();
          this.verifier.runCelebrationFireworks();
        }
      } else {
        this.verifier.runInvalidNoSymmetryFlash({
          mode: 'shape',
          shapeData: this.currentShapeData,
          tilingData: this.currentTilingData
        });
        this.checklist.showFeedback(
          'error',
          'Not asymmetric! This crystal specimen possesses rotational or mirror symmetry elements — place glyphs to find them.'
        );
      }
    } else {
      const isAsymmetric =
        (this.currentTilingData?.rotations?.length || 0) === 0 &&
        (this.currentTilingData?.mirrorAnglesDeg?.length || 0) === 0;

      if (isAsymmetric) {
        const wasAllFound = this.checklist.isAllFound();
        this.checklist.recordDiscovery(
          'wp_no_symmetry',
          'Asymmetric unit cell verified (0 rotational or mirror elements)'
        );
        this.updateSpecimenRevealState();
        const wpLabel = WALLPAPER_PRESETS[this.activeWallpaperKey].label;
        this.checklist.showFeedback(
          'success',
          `Asymmetric unit cell verified (translations only) — unlocked pattern: ${wpLabel}!`
        );
        if (!wasAllFound && this.checklist.isAllFound()) {
          this.resetHints();
          this.verifier.runCelebrationFireworks();
        }
      } else {
        this.verifier.runInvalidNoSymmetryFlash({
          mode: 'wallpaper',
          shapeData: this.currentShapeData,
          tilingData: this.currentTilingData
        });
        this.checklist.showFeedback(
          'error',
          'Not asymmetric! This periodic pattern contains rotational axes or mirror lines inside the unit cell.'
        );
      }
    }
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
          const wasAllFound = this.checklist.isAllFound();
          if (result.valid) {
            if (this.checklist.hasDiscovered(result.checklistId)) {
              lastFailedGlyph = glyph;
              this.glyphManager.setGlyphStatus(glyph, 'unverified');
              this.checklist.showFeedback(
                'warning',
                `${stepPrefix}Already verified (${result.checklistLabel})! Drag this glyph to another symmetry site or mirror line that hasn't been found yet.`
              );
            } else {
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
              if (!wasAllFound && allFoundNow) {
                this.resetHints();
                this.verifier.runCelebrationFireworks();
              }
            }
          } else {
            lastFailedGlyph = glyph;
            this.glyphManager.setGlyphStatus(glyph, 'invalid');
            if (this.mode === 'shape' && this.activePointPreset.id === 'pg_1') {
              this.checklist.markAsymmetricTested();
              this.updateSpecimenRevealState();
              if (!wasAllFound && this.checklist.isAllFound()) {
                this.resetHints();
                this.verifier.runCelebrationFireworks();
              }
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
          const wasAllFound = this.checklist.isAllFound();
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
          if (!wasAllFound && allFoundNow) {
            this.resetHints();
            this.verifier.runCelebrationFireworks();
          }
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
