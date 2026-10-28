/* ============================================================================
 * Smart E-Gate Systems — Backend Server (zero external dependencies)
 * Author: Christina Apriani
 *
 * Pure Node http server: static assets, JSON REST API, Server-Sent Events for
 * live gate telemetry, and the orchestration that wires IoT readings through
 * the shared decision engine and the simulated government APIs.
 * ==========================================================================*/
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const db = require("./src/db");
const engine = require("./src/engine");
const gov = require("./src/govApi");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const GATE = { name: "Main Gate — KEK Industropolis Batang", lat: -6.9445, lng: 109.7308 };

/* ---- SSE client registry ------------------------------------------------ */
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

/* ---- helpers ------------------------------------------------------------ */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (_) {
        resolve({});
      }
    });
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("404 Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  });
}

/* ---- core orchestration: evaluate one gate pass ------------------------- */
async function evaluateGate(reading) {
  // Stage 1 data already captured by IoT (reading). Resolve identity.
  const plate = engine.normPlate(reading.plate_ocr || reading.plate);
  const vehicle =
    db.getVehicle(reading.plate) ||
    db.listVehicles().find((v) => engine.normPlate(v.plate) === plate) ||
    null;

  const manifest = reading.container_code
    ? db.getManifest(reading.container_code)
    : vehicle
    ? db.getManifestByPlate(vehicle.plate)
    : null;

  // Stage 3: simulated government API calls (async, like real integrations)
  const kirResp = await gov.checkKIR(vehicle);
  const customs = manifest ? await gov.checkSPPB(manifest.sppb_number) : null;

  // Stage 2 + 4: deterministic engine decision
  const result = engine.decide(reading, { vehicle, manifest, customs });

  // Attach resolved context + government responses for the UI
  result.context = {
    vehicle,
    manifest,
    customs,
    gov: { kir: kirResp, sppb: customs },
    gate: GATE,
  };

  // Persist event
  const row = {
    plate: vehicle ? vehicle.plate : reading.plate_ocr || null,
    container_code: manifest ? manifest.container_code : reading.container_code || null,
    wim_kg: reading.wim_kg || null,
    len_mm: reading.len_mm || null,
    wid_mm: reading.wid_mm || null,
    hei_mm: reading.hei_mm || null,
    plate_ocr: reading.plate_ocr || null,
    ocr_conf: reading.ocr_conf == null ? null : reading.ocr_conf,
    lane: result.lane,
    reasons: JSON.stringify(result.reasons),
    result_json: JSON.stringify(result),
    lat: reading.lat || GATE.lat,
    lng: reading.lng || GATE.lng,
  };
  const info = db.insertEvent(row);
  result.event_id = Number(info.lastInsertRowid);

  // Stage 4 follow-up: GREEN => push manifest log to Bea Cukai (CEISA)
  if (result.lane === "GREEN" && manifest) {
    await gov.pushManifestLog(manifest, result.event_id);
    db.log("INFO", `GREEN ${row.plate}: manifest ${manifest.container_code} logged to CEISA.`);
  } else {
    db.log("WARN", `RED ${row.plate || "UNKNOWN"}: ${result.reasons.join("; ") || "locked"}`);
  }

  broadcast("gate", { id: result.event_id, lane: result.lane, plate: row.plate, ts: new Date().toISOString(), result });
  return result;
}

/* ---- router ------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    // ---- API ----
    if (pathname.startsWith("/api/")) {
      // live stream
      if (pathname === "/api/stream") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write(`event: hello\ndata: ${JSON.stringify({ gate: GATE })}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (pathname === "/api/health")
        return sendJSON(res, 200, { ok: true, gate: GATE, engine: "E-Gate Core v1", author: "Christina Apriani" });

      if (pathname === "/api/config") return sendJSON(res, 200, { gate: GATE, policy: engine.POLICY });

      // vehicles
      if (pathname === "/api/vehicles" && method === "GET") return sendJSON(res, 200, db.listVehicles());
      if (pathname === "/api/vehicles" && method === "POST") {
        const b = await readBody(req);
        if (!b.plate) return sendJSON(res, 400, { error: "plate required" });
        db.upsertVehicle(normalizeVehicle(b));
        return sendJSON(res, 200, db.getVehicle(b.plate));
      }
      let m;
      if ((m = pathname.match(/^\/api\/vehicles\/(.+)$/))) {
        const plate = decodeURIComponent(m[1]);
        if (method === "GET") return sendJSON(res, 200, db.getVehicle(plate) || {});
        if (method === "DELETE") {
          db.deleteVehicle(plate);
          return sendJSON(res, 200, { deleted: plate });
        }
      }

      // manifests
      if (pathname === "/api/manifests" && method === "GET") return sendJSON(res, 200, db.listManifests());
      if (pathname === "/api/manifests" && method === "POST") {
        const b = await readBody(req);
        if (!b.container_code) return sendJSON(res, 400, { error: "container_code required" });
        db.upsertManifest(normalizeManifest(b));
        return sendJSON(res, 200, db.getManifest(b.container_code));
      }
      if ((m = pathname.match(/^\/api\/manifests\/(.+)$/))) {
        const code = decodeURIComponent(m[1]);
        if (method === "GET") return sendJSON(res, 200, db.getManifest(code) || {});
        if (method === "DELETE") {
          db.deleteManifest(code);
          return sendJSON(res, 200, { deleted: code });
        }
      }

      // customs
      if (pathname === "/api/customs" && method === "GET") return sendJSON(res, 200, db.listCustoms());
      if (pathname === "/api/customs" && method === "POST") {
        const b = await readBody(req);
        if (!b.sppb_number) return sendJSON(res, 400, { error: "sppb_number required" });
        db.upsertCustoms(normalizeCustoms(b));
        return sendJSON(res, 200, db.getCustoms(b.sppb_number));
      }

      // lookup (cek data) — join vehicle + manifest + customs
      if ((m = pathname.match(/^\/api\/lookup\/(.+)$/))) {
        const q = decodeURIComponent(m[1]);
        const vehicle =
          db.getVehicle(q) || db.listVehicles().find((v) => engine.normPlate(v.plate) === engine.normPlate(q));
        const manifest = vehicle ? db.getManifestByPlate(vehicle.plate) : db.getManifest(q);
        const customs = manifest ? db.getCustoms(manifest.sppb_number) : null;
        return sendJSON(res, 200, { query: q, vehicle: vehicle || null, manifest: manifest || null, customs: customs || null });
      }

      // evaluate gate (the core)
      if (pathname === "/api/gate/evaluate" && method === "POST") {
        const reading = await readBody(req);
        const result = await evaluateGate(reading);
        return sendJSON(res, 200, result);
      }

      // events + stats
      if (pathname === "/api/events" && method === "GET") {
        const limit = parseInt(parsed.query.limit) || 100;
        return sendJSON(res, 200, db.listEvents(limit).map(parseEventRow));
      }
      if (pathname === "/api/stats" && method === "GET") {
        const s = db.stats();
        const recent = db.listEvents(8).map(parseEventRow);
        return sendJSON(res, 200, { ...s, recent, clients: sseClients.size });
      }

      return sendJSON(res, 404, { error: "unknown endpoint", path: pathname });
    }

    // ---- static ----
    return serveStatic(req, res, pathname);
  } catch (err) {
    db.log("ERROR", String(err && err.stack ? err.stack : err));
    return sendJSON(res, 500, { error: "internal", detail: String(err) });
  }
});

/* ---- input normalizers (defensive typing) ------------------------------ */
function int(v, d) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : d;
}
function normalizeVehicle(b) {
  return {
    plate: String(b.plate).trim(),
    operator: b.operator || "—",
    axle_config: b.axle_config || "1.2",
    jbi_kg: int(b.jbi_kg, 0),
    tare_kg: int(b.tare_kg, 0),
    max_len_mm: int(b.max_len_mm, 12000),
    max_wid_mm: int(b.max_wid_mm, 2500),
    max_hei_mm: int(b.max_hei_mm, 4200),
    kir_number: b.kir_number || null,
    kir_expiry: b.kir_expiry || null,
  };
}
function normalizeManifest(b) {
  return {
    container_code: String(b.container_code).trim(),
    plate: b.plate || "",
    cargo_desc: b.cargo_desc || "",
    cargo_weight_kg: int(b.cargo_weight_kg, 0),
    sppb_number: b.sppb_number || null,
  };
}
function normalizeCustoms(b) {
  return {
    sppb_number: String(b.sppb_number).trim(),
    status: ["APPROVED", "PENDING", "REJECTED"].includes(b.status) ? b.status : "PENDING",
    hs_code: b.hs_code || null,
    declared_value: int(b.declared_value, 0),
  };
}
function parseEventRow(r) {
  let reasons = [];
  try {
    reasons = JSON.parse(r.reasons || "[]");
  } catch (_) {}
  return { ...r, reasons };
}

server.listen(PORT, () => {
  console.log("────────────────────────────────────────────────────────");
  console.log("  Smart E-Gate Systems  ·  by Christina Apriani");
  console.log("  Server  : http://localhost:" + PORT);
  console.log("  Gate    : " + GATE.name);
  console.log("  Engine  : E-Gate Core v1  (IoT → AI → Gov API → Decision)");
  console.log("────────────────────────────────────────────────────────");
});

module.exports = { server, evaluateGate };
