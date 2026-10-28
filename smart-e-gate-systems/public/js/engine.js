/* ============================================================================
 * Smart E-Gate Systems — Core Decision Engine
 * Author: Christina Apriani
 *
 * Deterministic 4-stage evaluation pipeline for KEK (Special Economic Zone)
 * truck gate control. This single module is the authority for every gate
 * decision and is shared, byte-for-byte, by the Node backend and the browser
 * console (UMD export) so the logic can never drift between them.
 *
 * Stage 1  IoT capture ....... WIM weight, LiDAR 3D dimensions, HD camera OCR
 * Stage 2  AI processing ..... Vision ODOL detection + plate OCR, predictive
 *                              weight-anomaly vs manifest
 * Stage 3  Gov. API sync ..... Kemenhub KIR validity, CEISA Bea Cukai SPPB
 * Stage 4  Decision .......... GREEN (open + log manifest) or RED (lock + alarm)
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EGateEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Tunable policy thresholds. In production these live in a config service;
  // here they are explicit and auditable.
  var POLICY = {
    overloadTolerancePct: 5, // WIM may exceed JBI by this % before "overload"
    weightAnomalyPct: 8, // |measured - expected| beyond this % => anomaly
    weightAnomalyFloorKg: 300, // ignore anomalies smaller than this (sensor noise)
    dimToleranceMm: 50, // measured dimension slack vs registered legal maximum
    minOcrConfidence: 0.75, // below this, OCR is not trusted (manual review)
  };

  function pct(part, whole) {
    if (!whole) return 0;
    return (part / whole) * 100;
  }

  function round(n, d) {
    var f = Math.pow(10, d || 0);
    return Math.round(n * f) / f;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  /* --- Stage 2a: AI Vision — ODOL (Over Dimension Over Load) --------------- */
  function evaluateODOL(reading, vehicle) {
    var checks = [];
    var overload = false;
    var overdim = false;

    // Overload: WIM weight vs registered permissible gross weight (JBI)
    var jbi = vehicle ? vehicle.jbi_kg : null;
    if (jbi) {
      var limit = jbi * (1 + POLICY.overloadTolerancePct / 100);
      overload = reading.wim_kg > limit;
      checks.push({
        key: "overload",
        label: "Berat vs JBI (Over Load)",
        measured: reading.wim_kg + " kg",
        limit: jbi + " kg (+" + POLICY.overloadTolerancePct + "%)",
        over_by: overload ? round(reading.wim_kg - jbi) + " kg" : null,
        pass: !overload,
      });
    } else {
      checks.push({
        key: "overload",
        label: "Berat vs JBI (Over Load)",
        measured: reading.wim_kg + " kg",
        limit: "kendaraan tidak terdaftar",
        pass: false,
      });
      overload = true;
    }

    // Over dimension: LiDAR dims vs registered legal maximums
    if (vehicle) {
      var dims = [
        ["panjang", reading.len_mm, vehicle.max_len_mm],
        ["lebar", reading.wid_mm, vehicle.max_wid_mm],
        ["tinggi", reading.hei_mm, vehicle.max_hei_mm],
      ];
      dims.forEach(function (d) {
        var measured = d[1],
          max = d[2];
        if (max == null) return;
        var ok = measured <= max + POLICY.dimToleranceMm;
        if (!ok) overdim = true;
        checks.push({
          key: "dim_" + d[0],
          label: "Dimensi " + d[0] + " (Over Dimension)",
          measured: measured + " mm",
          limit: max + " mm",
          over_by: ok ? null : measured - max + " mm",
          pass: ok,
        });
      });
    }

    return { overload: overload, overdim: overdim, odol: overload || overdim, checks: checks };
  }

  /* --- Stage 2b: AI Vision — plate OCR confidence -------------------------- */
  function evaluateOCR(reading, vehicle) {
    var confident = (reading.ocr_conf == null ? 1 : reading.ocr_conf) >= POLICY.minOcrConfidence;
    var matches = vehicle ? normPlate(reading.plate_ocr) === normPlate(vehicle.plate) : false;
    return {
      key: "ocr",
      label: "AI Vision OCR Pelat",
      read: reading.plate_ocr || "—",
      confidence: reading.ocr_conf == null ? null : round(reading.ocr_conf * 100) + "%",
      matches_registry: matches,
      pass: confident, // low confidence alone does not fail the gate, it flags review
      confident: confident,
    };
  }

  function normPlate(p) {
    return (p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /* --- Stage 2c: AI Predictive — weight anomaly vs manifest ---------------- */
  function evaluateWeightAnomaly(reading, vehicle, manifest) {
    if (!vehicle || !manifest) {
      return {
        key: "weight_anomaly",
        label: "AI Prediktif: Berat vs Manifes",
        pass: false,
        anomaly: true,
        detail: "data kendaraan/manifes tidak lengkap",
      };
    }
    var expected = vehicle.tare_kg + manifest.cargo_weight_kg; // tare + declared cargo
    var diff = reading.wim_kg - expected;
    var deviation = Math.abs(diff);
    var anomaly =
      deviation > POLICY.weightAnomalyFloorKg && pct(deviation, expected) > POLICY.weightAnomalyPct;
    return {
      key: "weight_anomaly",
      label: "AI Prediktif: Berat vs Manifes",
      measured: reading.wim_kg + " kg",
      expected: round(expected) + " kg (tare " + vehicle.tare_kg + " + kargo " + manifest.cargo_weight_kg + ")",
      deviation: round(diff) + " kg (" + round(pct(deviation, expected), 1) + "%)",
      threshold: POLICY.weightAnomalyPct + "%",
      anomaly: anomaly,
      pass: !anomaly,
    };
  }

  /* --- Stage 3a: Kemenhub — KIR roadworthiness validity -------------------- */
  function evaluateKIR(vehicle, asOf) {
    var now = asOf || todayISO();
    if (!vehicle || !vehicle.kir_expiry) {
      return { key: "kir", label: "Kemenhub: Uji KIR", pass: false, detail: "KIR tidak ditemukan" };
    }
    var valid = vehicle.kir_expiry >= now;
    return {
      key: "kir",
      label: "Kemenhub: Uji KIR",
      number: vehicle.kir_number,
      expiry: vehicle.kir_expiry,
      pass: valid,
      detail: valid ? "aktif" : "kedaluwarsa",
    };
  }

  /* --- Stage 3b: CEISA Bea Cukai — SPPB customs clearance ------------------ */
  function evaluateSPPB(manifest, customs) {
    if (!manifest || !customs) {
      return {
        key: "sppb",
        label: "CEISA Bea Cukai: SPPB",
        pass: false,
        detail: "dokumen pabean tidak ditemukan",
      };
    }
    var valid = customs.status === "APPROVED";
    return {
      key: "sppb",
      label: "CEISA Bea Cukai: SPPB",
      number: customs.sppb_number,
      status: customs.status,
      pass: valid,
      detail: valid ? "SPPB disetujui & valid" : "status: " + customs.status,
    };
  }

  /* --- Stage 4: Final decision -------------------------------------------- */
  // ctx = { vehicle, manifest, customs, asOf }
  function decide(reading, ctx) {
    ctx = ctx || {};
    var vehicle = ctx.vehicle || null;
    var manifest = ctx.manifest || null;
    var customs = ctx.customs || null;

    var odol = evaluateODOL(reading, vehicle);
    var ocr = evaluateOCR(reading, vehicle);
    var anomaly = evaluateWeightAnomaly(reading, vehicle, manifest);
    var kir = evaluateKIR(vehicle, ctx.asOf);
    var sppb = evaluateSPPB(manifest, customs);

    // Physical (ODOL) gate must pass, and no weight anomaly.
    var physicalPass = !odol.odol && anomaly.pass;
    // Documents (KIR + SPPB) must be valid.
    var documentsPass = kir.pass && sppb.pass;

    var pass = physicalPass && documentsPass;

    var reasons = [];
    if (odol.overload) reasons.push("ODOL: kelebihan muatan (overload)");
    if (odol.overdim) reasons.push("ODOL: kelebihan dimensi (overdimension)");
    if (anomaly.anomaly) reasons.push("Anomali berat: deviasi di luar ambang manifes");
    if (!kir.pass) reasons.push("KIR tidak valid / kedaluwarsa");
    if (!sppb.pass) reasons.push("SPPB belum disetujui / tidak valid");
    if (!ocr.confident) reasons.push("Confidence OCR rendah — perlu verifikasi manual");

    var lane = pass ? "GREEN" : "RED";
    var action = pass
      ? {
          gate: "OPEN",
          siren: false,
          route: "Jalur Hijau — gerbang terbuka",
          followup: "Kirim log manifes ke Bea Cukai (CEISA)",
        }
      : {
          gate: "LOCKED",
          siren: true,
          route: "Jalur Merah — gerbang terkunci",
          followup: "Arahkan ke pos pemeriksaan fisik / jalur putar balik",
        };

    return {
      lane: lane,
      pass: pass,
      action: action,
      reasons: reasons,
      stages: {
        s1_iot: {
          wim_kg: reading.wim_kg,
          dims_mm: { l: reading.len_mm, w: reading.wid_mm, h: reading.hei_mm },
          plate_ocr: reading.plate_ocr,
          container_code: reading.container_code,
        },
        s2_ai: { odol: odol, ocr: ocr, weight_anomaly: anomaly },
        s3_api: { kir: kir, sppb: sppb },
        s4_decision: { physicalPass: physicalPass, documentsPass: documentsPass, lane: lane },
      },
      evaluated_at: new Date().toISOString(),
      engine: "Christina Apriani / E-Gate Core v1",
    };
  }

  return {
    POLICY: POLICY,
    decide: decide,
    evaluateODOL: evaluateODOL,
    evaluateWeightAnomaly: evaluateWeightAnomaly,
    evaluateKIR: evaluateKIR,
    evaluateSPPB: evaluateSPPB,
    normPlate: normPlate,
  };
});
