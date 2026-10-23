/**
 * checklist.js
 * Manages the Discovery-Based Checklist ("Found: 0 / ?") and verification feedback banner.
 * Begins blank so students discover symmetry elements through active experimentation.
 */

export class DiscoveryChecklist {
  constructor(listElementId, counterElementId, bannerElementId) {
    this.listEl = document.getElementById(listElementId);
    this.counterEl = document.getElementById(counterElementId);
    this.bannerEl = document.getElementById(bannerElementId);

    this.expectedItems = [];
    this.discoveredMap = new Map(); // id -> { id, label }
    this.asymmetricTested = false;
  }

  /**
   * Reset checklist for a new shape or wallpaper pattern, or when Hard Mode changes.
   */
  reset(expectedItems = [], preserveDiscovered = false) {
    this.expectedItems = expectedItems;
    if (!preserveDiscovered) {
      this.discoveredMap.clear();
      this.asymmetricTested = false;
    } else {
      const validIds = new Set(expectedItems.map((i) => i.id));
      for (const k of Array.from(this.discoveredMap.keys())) {
        if (!validIds.has(k)) this.discoveredMap.delete(k);
      }
    }
    this.render();
  }

  /**
   * Mark that an asymmetric shape (0 expected symmetry elements) has been tested.
   */
  markAsymmetricTested() {
    if (this.expectedItems.length === 0) {
      this.asymmetricTested = true;
      this.render();
    }
  }

  /**
   * Returns true if and only if all expected symmetry elements for the active specimen
   * have been discovered by the user.
   */
  isAllFound() {
    if (this.expectedItems.length === 0) {
      return this.asymmetricTested;
    }
    for (const item of this.expectedItems) {
      if (!this.discoveredMap.has(item.id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check whether a given checklist item ID has already been discovered.
   */
  hasDiscovered(id) {
    return Boolean(id) && this.discoveredMap.has(id);
  }

  /**
   * Record a newly verified symmetry element or unit cell.
   * Returns true if newly discovered, false if already in the checklist.
   */
  recordDiscovery(id, label) {
    if (!id) return false;
    const isNew = !this.discoveredMap.has(id);
    this.discoveredMap.set(id, { id, label });
    this.render(isNew ? id : null);
    return isNew;
  }

  /**
   * Update the verification status banner (matches "Test Symmetry" and "Test Unit Cell" color scheme).
   */
  showFeedback(type, message) {
    if (!this.bannerEl) return;
    this.bannerEl.className = `feedback-banner ${type}`;
    this.bannerEl.innerHTML = `
      <span class="feedback-indicator"></span>
      <span class="feedback-text">${message}</span>
    `;
  }

  render(newlyAddedId = null) {
    if (!this.listEl || !this.counterEl) return;

    const foundCount = this.discoveredMap.size;
    const allFound = this.isAllFound();
    const totalCount = this.expectedItems.length;

    // Always show the total number of operations in "Found: X / Total"
    if (allFound) {
      if (totalCount === 0) {
        this.counterEl.textContent = 'Found: 0 / 0 (Asymmetric)';
      } else {
        this.counterEl.textContent = `Found: ${foundCount} / ${totalCount} (Complete!)`;
      }
      this.counterEl.className = 'checklist-counter complete';
    } else {
      this.counterEl.textContent = `Found: ${foundCount} / ${totalCount}`;
      this.counterEl.className = 'checklist-counter';
    }

    if (foundCount === 0) {
      if (allFound && totalCount === 0) {
        this.listEl.innerHTML = `
          <li class="checklist-item newly-added">
            <span class="check-badge">[✓]</span>
            <span class="check-label">Asymmetric profile verified (0 symmetry elements)</span>
          </li>
        `;
      } else {
        this.listEl.innerHTML = `
          <li class="checklist-empty">
            No symmetry elements verified yet. Place a glyph (or outline a unit cell) and click <strong>Test</strong> to discover!
          </li>
        `;
      }
      return;
    }

    let html = '';
    for (const [id, item] of this.discoveredMap.entries()) {
      const flashClass = id === newlyAddedId ? 'newly-added' : '';
      html += `
        <li class="checklist-item ${flashClass}" data-check-id="${id}">
          <span class="check-badge">[✓]</span>
          <span class="check-label">${item.label}</span>
        </li>
      `;
    }
    this.listEl.innerHTML = html;
  }
}
