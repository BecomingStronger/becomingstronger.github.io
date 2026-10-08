// Orbit math and the map scale. Bodies move on Keplerian ellipses (circles when there is one
// radius), timed by each body's period in days. Distances in the data are true miles; the views
// draw them on a compressed "schematic" scale so the inner planets and the outer ones fit on one
// screen. The same mapping runs on every point, so an eccentric orbit keeps its true perihelion
// and aphelion.
import * as THREE from "three";

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

export function elements(orbit) {
  const o = orbit || {};
  let a = o.radius_mi, e = o.ecc ?? 0;
  if (o.peri_mi > 0 && o.apo_mi > 0) { a = (o.peri_mi + o.apo_mi) / 2; e = (o.apo_mi - o.peri_mi) / (o.apo_mi + o.peri_mi); }
  return {
    a: a || 0, e: Math.min(Math.max(e, 0), 0.97),
    i: (o.incl_deg || 0) * D2R, node: (o.node_deg || 0) * D2R, argp: (o.argp_deg || 0) * D2R,
    P: o.period_days || 0, M0: (o.phase_deg || 0) * D2R,
  };
}

export const meanAnomaly = (el, day) => el.M0 + (el.P ? TAU * day / el.P : 0);

function eccentricAnomaly(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 12; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

// Point on the orbit (true miles, parent frame) for a given eccentric anomaly.
function pointAtE(el, E, out = new THREE.Vector3()) {
  const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
  const r = el.a * (1 - el.e * Math.cos(E));
  const u = nu + el.argp;
  out.set(r * Math.cos(u), 0, -r * Math.sin(u));
  out.applyAxisAngle(X_AXIS, el.i);
  out.applyAxisAngle(Y_AXIS, el.node);
  return out;
}
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);

export function positionAt(el, day, out) {
  const M = meanAnomaly(el, day);
  return pointAtE(el, eccentricAnomaly(((M % TAU) + TAU) % TAU, el.e), out);
}

// n points around the whole orbit, each with the fraction of a period it sits at (0..1),
// which the orbit lines use to fade the trail behind the body.
export function samplePath(el, n = 360) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const E = k / n * TAU;
    const M = E - el.e * Math.sin(E);
    pts.push({ p: pointAtE(el, E), f: M / TAU });
  }
  return pts;
}

export function fixedPosition(fixed) {
  const r = fixed.r_mi || 0, lon = (fixed.lon_deg || 0) * D2R, lat = (fixed.lat_deg || 0) * D2R;
  return new THREE.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
}

// ---------- scale ----------
// Bodies that circle the primary: miles -> view units.
export function primaryRadius(rMi, mode) {
  const m = rMi / 1e6;
  return mode === "true" ? m / 80 : 0.345 * Math.pow(Math.max(m, 0), 0.55);
}
export function mapPrimary(v, mode, out = new THREE.Vector3()) {
  const r = v.length();
  return r === 0 ? out.set(0, 0, 0) : out.copy(v).multiplyScalar(primaryRadius(r, mode) / r);
}
// Bodies that circle a planet or moon: distance in miles -> a multiple of the parent's drawn radius.
export function satelliteRadius(rMi, parentR) {
  const k = 1.7 + 1.1 * Math.log10(Math.max(rMi, 5000) / 20000);
  return parentR * Math.max(k, 1.35);
}
export function mapSatellite(v, parentR, out = new THREE.Vector3()) {
  const r = v.length();
  return r === 0 ? out.set(0, 0, 0) : out.copy(v).multiplyScalar(satelliteRadius(r, parentR) / r);
}

const SIZE_R = { A: 0.07, B: 0.1, C: 0.14, D: 0.19, E: 0.26, F: 0.33, G: 0.45, H: 0.62, I: 0.8, J: 1.0 };
const KIND_R = { asteroid: 0.06, structure: 0.08, ship: 0.06, comet: 0.06, portal: 0.08, sargasso: 0.1, island: 0.1, "dead-god": 0.2, other: 0.14 };

// Drawn radius of a body in view units.
export function drawRadius(b, isSatellite) {
  let r = SIZE_R[b.size_class] ?? KIND_R[b.kind] ?? 0.3;
  if (b.kind === "star" && !b.size_class) r = 0.62;
  if (isSatellite) r *= 0.6;
  return r * (b.look?.scale || 1);
}
