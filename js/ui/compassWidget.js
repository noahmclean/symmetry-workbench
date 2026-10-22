/**
 * compassWidget.js
 * Circular Directional Compass Hint widget for mirror plane orientations.
 * Lights up with radial rays indicating valid mirror angles in [0°, 180°)
 * without disclosing their physical translation positions on the canvas.
 */

import { DEG_TO_RAD } from '../math/geometry.js';

export class CompassWidget {
  constructor(svgElementId, readoutElementId) {
    this.svg = document.getElementById(svgElementId);
    this.readout = document.getElementById(readoutElementId);
    this.enabled = false;
    this.mirrorAnglesDeg = [];
    this.render();
  }

  setState({ enabled, mirrorAnglesDeg }) {
    if (typeof enabled === 'boolean') this.enabled = enabled;
    if (Array.isArray(mirrorAnglesDeg)) this.mirrorAnglesDeg = mirrorAnglesDeg;
    this.render();
  }

  render() {
    if (!this.svg) return;
    const cx = 75;
    const cy = 75;
    const rOuter = 58;
    const rRay = 52;

    let html = `
      <defs>
        <radialGradient id="compassGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(56, 189, 248, 0.25)" />
          <stop offset="100%" stop-color="rgba(15, 23, 42, 0.9)" />
        </radialGradient>
      </defs>
      <!-- Outer dial ring -->
      <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="url(#compassGlow)" stroke="rgba(148, 163, 184, 0.35)" stroke-width="1.5" />
      <circle cx="${cx}" cy="${cy}" r="${rOuter * 0.55}" fill="none" stroke="rgba(148, 163, 184, 0.16)" stroke-width="1" stroke-dasharray="3 3" />
    `;

    // Degree tick marks every 15°
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = deg * DEG_TO_RAD;
      const isMajor = deg % 45 === 0 || deg % 30 === 0;
      const r1 = isMajor ? rOuter - 6 : rOuter - 3;
      const x1 = cx + r1 * Math.cos(rad);
      const y1 = cy - r1 * Math.sin(rad);
      const x2 = cx + rOuter * Math.cos(rad);
      const y2 = cy - rOuter * Math.sin(rad);
      html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${
        isMajor ? 'rgba(203, 213, 225, 0.55)' : 'rgba(148, 163, 184, 0.22)'
      }" stroke-width="${isMajor ? '1.4' : '1'}" />`;
    }

    // Cardinal degree labels
    html += `
      <text x="${cx + rOuter + 9}" y="${cy + 3}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="monospace">0°</text>
      <text x="${cx}" y="${cy - rOuter - 5}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="monospace">90°</text>
      <text x="${cx - rOuter - 10}" y="${cy + 3}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="monospace">180°</text>
    `;

    if (this.enabled) {
      if (this.mirrorAnglesDeg.length > 0) {
        // Render glowing diametral rays for each valid mirror orientation angle
        for (const deg of this.mirrorAnglesDeg) {
          const rad = deg * DEG_TO_RAD;
          const dx = rRay * Math.cos(rad);
          const dy = -rRay * Math.sin(rad); // screen Y flip matches canvas Cartesian angle
          const x1 = cx - dx;
          const y1 = cy - dy;
          const x2 = cx + dx;
          const y2 = cy + dy;

          // Outer glow ray
          html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(56, 189, 248, 0.35)" stroke-width="6" stroke-linecap="round" />`;
          // Core ray
          html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" />`;
          // Tip dots at both ends of diameter
          html += `<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="3.2" fill="#facc15" />`;
          html += `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3.2" fill="#facc15" />`;
        }
        html += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#38bdf8" stroke="#f8fafc" stroke-width="1.5" />`;

        if (this.readout) {
          const listStr = this.mirrorAnglesDeg.map((a) => `${Math.round(a)}°`).join(', ');
          this.readout.textContent = `Valid Mirror Angles: ${listStr}`;
          this.readout.className = 'compass-readout active';
        }
      } else {
        // Active hint, but shape/pattern has 0 mirrors
        html += `<circle cx="${cx}" cy="${cy}" r="18" fill="rgba(239, 68, 68, 0.16)" stroke="rgba(248, 113, 113, 0.55)" stroke-width="1.5" />`;
        html += `<line x1="${cx - 8}" y1="${cy - 8}" x2="${cx + 8}" y2="${cy + 8}" stroke="#f87171" stroke-width="2" />`;
        html += `<line x1="${cx + 8}" y1="${cy - 8}" x2="${cx - 8}" y2="${cy + 8}" stroke="#f87171" stroke-width="2" />`;
        if (this.readout) {
          this.readout.textContent = '0 Mirror Planes (Chiral / Rotational Only)';
          this.readout.className = 'compass-readout none';
        }
      }
    } else {
      // Compass hint disabled / standby
      html += `<circle cx="${cx}" cy="${cy}" r="4" fill="#64748b" />`;
      if (this.readout) {
        this.readout.textContent = 'Toggle hint above to reveal mirror angles';
        this.readout.className = 'compass-readout standby';
      }
    }

    this.svg.innerHTML = html;
  }
}
