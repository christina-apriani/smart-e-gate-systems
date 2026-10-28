/* ============================================================================
 * Smart E-Gate Systems — Database Layer (node:sqlite, zero dependencies)
 * Author: Christina Apriani
 *
 * Owns schema creation, seeding, and typed query helpers. The gate network is
 * the single source of truth for every vehicle, manifest, and customs record.
 * ==========================================================================*/
"use strict";

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "egate.db");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      plate        TEXT PRIMARY KEY,
      operator     TEXT NOT NULL,
      axle_config  TEXT NOT NULL,
      jbi_kg       INTEGER NOT NULL,
      tare_kg      INTEGER NOT NULL,
      max_len_mm   INTEGER NOT NULL,
      max_wid_mm   INTEGER NOT NULL,
      max_hei_mm   INTEGER NOT NULL,
      kir_number   TEXT,
      kir_expiry   TEXT
    );

    CREATE TABLE IF NOT EXISTS manifests (
      container_code  TEXT PRIMARY KEY,
      plate           TEXT NOT NULL,
      cargo_desc      TEXT,
      cargo_weight_kg INTEGER NOT NULL,
      sppb_number     TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customs_sppb (
      sppb_number    TEXT PRIMARY KEY,
      status         TEXT NOT NULL CHECK (status IN ('APPROVED','PENDING','REJECTED')),
      hs_code        TEXT,
      declared_value INTEGER,
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gate_events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      ts             TEXT DEFAULT (datetime('now')),
      plate          TEXT,
      container_code TEXT,
      wim_kg         INTEGER,
      len_mm         INTEGER,
      wid_mm         INTEGER,
      hei_mm         INTEGER,
      plate_ocr      TEXT,
      ocr_conf       REAL,
      lane           TEXT,
      reasons        TEXT,
      result_json    TEXT,
      lat            REAL,
      lng            REAL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      ts    TEXT DEFAULT (datetime('now')),
      level TEXT,
      msg   TEXT
    );
  `);
}

function count(table) {
  return db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
}

function seed(force) {
  if (force) {
    db.exec(
      "DELETE FROM vehicles; DELETE FROM manifests; DELETE FROM customs_sppb; DELETE FROM gate_events; DELETE FROM audit_log;"
    );
  }
  if (count("vehicles") > 0 && !force) return;

  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const plus = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return iso(d);
  };

  const vehicles = [
    // plate, operator, axles, jbi, tare, L, W, H, kir#, kir_expiry
    ["B 9114 KDT", "PT Trans Batang Logistik", "1.2.2", 34000, 11500, 12200, 2500, 4200, "KIR-JTG-00841", plus(120)],
    ["B 9276 UIX", "CV Pantura Kargo", "1.2", 26000, 9200, 9600, 2500, 4200, "KIR-JTG-01033", plus(45)],
    ["H 1842 QC", "PT Semarang Container Line", "1.2.2.2", 40000, 13000, 13600, 2550, 4200, "KIR-JTG-00990", plus(8)],
    ["G 9550 AL", "PT Pekalongan Freight", "1.2", 26000, 9100, 9600, 2500, 4200, "KIR-JTG-00712", plus(-14)], // KIR expired
    ["B 9631 SCF", "PT Industropolis Haulage", "1.2.2", 34000, 11800, 12200, 2500, 4200, "KIR-JTG-01170", plus(200)],
  ];
  const insVeh = db.prepare(
    `INSERT OR REPLACE INTO vehicles
     (plate,operator,axle_config,jbi_kg,tare_kg,max_len_mm,max_wid_mm,max_hei_mm,kir_number,kir_expiry)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  vehicles.forEach((v) => insVeh.run(...v));

  const manifests = [
    // container, plate, desc, cargo_kg, sppb
    ["TGHU 2048115", "B 9114 KDT", "Tekstil jadi (ekspor)", 21500, "SPPB-2026-104771"],
    ["MSKU 7781340", "B 9276 UIX", "Komponen elektronik", 15800, "SPPB-2026-104772"],
    ["CSNU 9004122", "H 1842 QC", "Mesin industri", 25500, "SPPB-2026-104773"],
    ["TLLU 3390271", "G 9550 AL", "Furnitur kayu", 15600, "SPPB-2026-104774"],
    ["SEGU 5512098", "B 9631 SCF", "Bahan kimia (deklarasi)", 20000, "SPPB-2026-104775"],
  ];
  const insMan = db.prepare(
    `INSERT OR REPLACE INTO manifests (container_code,plate,cargo_desc,cargo_weight_kg,sppb_number) VALUES (?,?,?,?,?)`
  );
  manifests.forEach((m) => insMan.run(...m));

  const customs = [
    ["SPPB-2026-104771", "APPROVED", "6109.10", 1850000000],
    ["SPPB-2026-104772", "APPROVED", "8542.31", 2400000000],
    ["SPPB-2026-104773", "APPROVED", "8479.89", 5600000000],
    ["SPPB-2026-104774", "APPROVED", "9403.60", 780000000],
    ["SPPB-2026-104775", "PENDING", "2811.19", 1200000000], // customs not cleared
  ];
  const insCus = db.prepare(
    `INSERT OR REPLACE INTO customs_sppb (sppb_number,status,hs_code,declared_value) VALUES (?,?,?,?)`
  );
  customs.forEach((c) => insCus.run(...c));

  log("INFO", "Database seeded with reference fleet, manifests, and customs records.");
}

function log(level, msg) {
  db.prepare("INSERT INTO audit_log (level,msg) VALUES (?,?)").run(level, msg);
}

/* ---- Typed accessors ---------------------------------------------------- */
const api = {
  db,
  log,
  listVehicles: () => db.prepare("SELECT * FROM vehicles ORDER BY plate").all(),
  getVehicle: (plate) => (plate == null ? undefined : db.prepare("SELECT * FROM vehicles WHERE plate = ?").get(plate)),
  upsertVehicle: (v) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO vehicles
         (plate,operator,axle_config,jbi_kg,tare_kg,max_len_mm,max_wid_mm,max_hei_mm,kir_number,kir_expiry)
         VALUES (@plate,@operator,@axle_config,@jbi_kg,@tare_kg,@max_len_mm,@max_wid_mm,@max_hei_mm,@kir_number,@kir_expiry)`
      )
      .run(v),
  deleteVehicle: (plate) => db.prepare("DELETE FROM vehicles WHERE plate = ?").run(plate),

  listManifests: () => db.prepare("SELECT * FROM manifests ORDER BY created_at DESC").all(),
  getManifest: (code) => (code == null ? undefined : db.prepare("SELECT * FROM manifests WHERE container_code = ?").get(code)),
  getManifestByPlate: (plate) =>
    plate == null
      ? undefined
      : db.prepare("SELECT * FROM manifests WHERE plate = ? ORDER BY created_at DESC LIMIT 1").get(plate),
  upsertManifest: (m) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO manifests (container_code,plate,cargo_desc,cargo_weight_kg,sppb_number)
         VALUES (@container_code,@plate,@cargo_desc,@cargo_weight_kg,@sppb_number)`
      )
      .run(m),
  deleteManifest: (code) => db.prepare("DELETE FROM manifests WHERE container_code = ?").run(code),

  listCustoms: () => db.prepare("SELECT * FROM customs_sppb ORDER BY sppb_number").all(),
  getCustoms: (sppb) => (sppb == null ? undefined : db.prepare("SELECT * FROM customs_sppb WHERE sppb_number = ?").get(sppb)),
  upsertCustoms: (c) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO customs_sppb (sppb_number,status,hs_code,declared_value)
         VALUES (@sppb_number,@status,@hs_code,@declared_value)`
      )
      .run(c),

  insertEvent: (e) =>
    db
      .prepare(
        `INSERT INTO gate_events
         (plate,container_code,wim_kg,len_mm,wid_mm,hei_mm,plate_ocr,ocr_conf,lane,reasons,result_json,lat,lng)
         VALUES (@plate,@container_code,@wim_kg,@len_mm,@wid_mm,@hei_mm,@plate_ocr,@ocr_conf,@lane,@reasons,@result_json,@lat,@lng)`
      )
      .run(e),
  listEvents: (limit) =>
    db.prepare("SELECT * FROM gate_events ORDER BY id DESC LIMIT ?").all(limit || 100),
  stats: () => {
    const total = db.prepare("SELECT COUNT(*) c FROM gate_events").get().c;
    const green = db.prepare("SELECT COUNT(*) c FROM gate_events WHERE lane='GREEN'").get().c;
    const red = db.prepare("SELECT COUNT(*) c FROM gate_events WHERE lane='RED'").get().c;
    return { total, green, red, green_pct: total ? Math.round((green / total) * 100) : 0 };
  },
};

initSchema();
seed(process.argv.includes("--reseed"));

if (require.main === module) {
  console.log("[db] schema ready at", DB_PATH);
  console.log("[db] vehicles:", count("vehicles"), "manifests:", count("manifests"), "customs:", count("customs_sppb"));
}

module.exports = api;
