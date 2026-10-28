/* ============================================================================
 * Smart E-Gate Systems — Government API Integration Layer (simulated)
 * Author: Christina Apriani
 *
 * Stage 3 of the pipeline. In production these functions call the live
 * Kemenhub roadworthiness (KIR) service and the CEISA Bea Cukai customs
 * gateway over authenticated HTTPS. Here they are faithful, async stand-ins
 * that return the same shape, so the backend wiring is production-accurate
 * and the real endpoints can be dropped in without touching the orchestrator.
 * ==========================================================================*/
"use strict";

const db = require("./db");

// Simulate realistic network latency for a government API round-trip.
function latency(min, max) {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}

/* ---- Kemenhub: KIR (uji berkala) validity ------------------------------- */
async function checkKIR(vehicle) {
  await latency(40, 160);
  if (!vehicle) {
    return { service: "Kemenhub-KIR", ok: false, found: false, detail: "kendaraan tidak terdaftar", latency_ms: null };
  }
  const today = new Date().toISOString().slice(0, 10);
  const active = !!vehicle.kir_expiry && vehicle.kir_expiry >= today;
  return {
    service: "Kemenhub-KIR",
    ok: active,
    found: true,
    kir_number: vehicle.kir_number,
    expiry: vehicle.kir_expiry,
    status: active ? "ACTIVE" : "EXPIRED",
    checked_at: new Date().toISOString(),
  };
}

/* ---- CEISA Bea Cukai: SPPB document status ------------------------------ */
async function checkSPPB(sppbNumber) {
  await latency(60, 220);
  if (!sppbNumber) return { service: "CEISA-SPPB", ok: false, found: false, detail: "tidak ada nomor SPPB" };
  const rec = db.getCustoms(sppbNumber);
  if (!rec) return { service: "CEISA-SPPB", ok: false, found: false, sppb_number: sppbNumber, detail: "SPPB tidak ditemukan" };
  return {
    service: "CEISA-SPPB",
    ok: rec.status === "APPROVED",
    found: true,
    sppb_number: rec.sppb_number,
    status: rec.status,
    hs_code: rec.hs_code,
    checked_at: new Date().toISOString(),
  };
}

/* ---- CEISA Bea Cukai: push manifest log on GREEN clearance -------------- */
async function pushManifestLog(manifest, eventId) {
  await latency(50, 140);
  const ref = "CEISA-LOG-" + Date.now().toString().slice(-8);
  db.log(
    "INFO",
    `Manifest ${manifest.container_code} (SPPB ${manifest.sppb_number}) transmitted to CEISA · ref ${ref} · event #${eventId}`
  );
  return { service: "CEISA-LOG", ok: true, ref, container_code: manifest.container_code, transmitted_at: new Date().toISOString() };
}

module.exports = { checkKIR, checkSPPB, pushManifestLog };
