/* ============================================================================
 * Smart E-Gate Systems — Data layer
 * Author: Christina Apriani
 *
 * Single interface the UI talks to. Detects a live backend; if none is
 * reachable (static hosting), transparently falls back to an in-browser store
 * backed by localStorage and the shared decision engine. Same method surface
 * either way, so the UI never branches on mode.
 * ==========================================================================*/
(function (root) {
  "use strict";
  var engine = root.EGateEngine;
  var seed = root.EGateSeed;

  var LS = "egate_demo_store_v1";
  var mode = "demo"; // or "live"
  var base = "";

  /* ---- demo store ---- */
  function loadStore() {
    try {
      var s = localStorage.getItem(LS);
      if (s) return JSON.parse(s);
    } catch (e) {}
    var fresh = {
      vehicles: JSON.parse(JSON.stringify(seed.DEFAULT.vehicles)),
      manifests: JSON.parse(JSON.stringify(seed.DEFAULT.manifests)),
      customs: JSON.parse(JSON.stringify(seed.DEFAULT.customs)),
      events: [],
    };
    saveStore(fresh);
    return fresh;
  }
  function saveStore(s) {
    try {
      localStorage.setItem(LS, JSON.stringify(s));
    } catch (e) {}
  }
  var store = loadStore();

  function norm(p) {
    return engine.normPlate(p);
  }
  function findVehicle(q) {
    return store.vehicles.find(function (v) {
      return v.plate === q || norm(v.plate) === norm(q);
    });
  }
  function findManifest(code, plate) {
    if (code) {
      var m = store.manifests.find(function (x) {
        return x.container_code === code;
      });
      if (m) return m;
    }
    if (plate)
      return store.manifests.find(function (x) {
        return norm(x.plate) === norm(plate);
      });
    return null;
  }
  function findCustoms(sppb) {
    return store.customs.find(function (c) {
      return c.sppb_number === sppb;
    });
  }

  function demoEvaluate(reading) {
    var vehicle = findVehicle(reading.plate_ocr || reading.plate) || null;
    var manifest = findManifest(reading.container_code, vehicle && vehicle.plate) || null;
    var customs = manifest ? findCustoms(manifest.sppb_number) : null;
    var result = engine.decide(reading, { vehicle: vehicle, manifest: manifest, customs: customs });
    result.context = {
      vehicle: vehicle,
      manifest: manifest,
      customs: customs,
      gov: {
        kir: vehicle
          ? { service: "Kemenhub-KIR", ok: result.stages.s3_api.kir.pass, status: result.stages.s3_api.kir.pass ? "ACTIVE" : "EXPIRED", expiry: vehicle.kir_expiry }
          : { service: "Kemenhub-KIR", ok: false, found: false },
        sppb: customs
          ? { service: "CEISA-SPPB", ok: customs.status === "APPROVED", status: customs.status, sppb_number: customs.sppb_number }
          : { service: "CEISA-SPPB", ok: false, found: false },
      },
      gate: seed.GATE,
    };
    var ev = {
      id: store.events.length + 1,
      ts: new Date().toISOString().slice(0, 19).replace("T", " "),
      plate: vehicle ? vehicle.plate : reading.plate_ocr || null,
      container_code: manifest ? manifest.container_code : reading.container_code || null,
      wim_kg: reading.wim_kg, len_mm: reading.len_mm, wid_mm: reading.wid_mm, hei_mm: reading.hei_mm,
      plate_ocr: reading.plate_ocr, ocr_conf: reading.ocr_conf,
      lane: result.lane, reasons: result.reasons,
      lat: reading.lat || seed.GATE.lat, lng: reading.lng || seed.GATE.lng,
    };
    store.events.unshift(ev);
    if (store.events.length > 300) store.events.pop();
    saveStore(store);
    result.event_id = ev.id;
    return result;
  }

  /* ---- fetch helpers for live mode ---- */
  function j(method, path, body) {
    var opt = { method: method, headers: { "Content-Type": "application/json" } };
    if (body) opt.body = JSON.stringify(body);
    return fetch(base + path, opt).then(function (r) {
      return r.json();
    });
  }

  var API = {
    mode: function () {
      return mode;
    },
    gate: seed.GATE,

    detect: function () {
      // try live backend; 900ms budget
      var ctrl = new AbortController();
      var to = setTimeout(function () {
        ctrl.abort();
      }, 900);
      return fetch("/api/health", { signal: ctrl.signal })
        .then(function (r) {
          clearTimeout(to);
          if (!r.ok) throw 0;
          return r.json();
        })
        .then(function (h) {
          mode = "live";
          if (h && h.gate) API.gate = h.gate;
          return "live";
        })
        .catch(function () {
          mode = "demo";
          return "demo";
        });
    },

    listVehicles: function () {
      return mode === "live" ? j("GET", "/api/vehicles") : Promise.resolve(store.vehicles.slice());
    },
    saveVehicle: function (v) {
      if (mode === "live") return j("POST", "/api/vehicles", v);
      var i = store.vehicles.findIndex(function (x) {
        return x.plate === v.plate;
      });
      if (i >= 0) store.vehicles[i] = v;
      else store.vehicles.push(v);
      saveStore(store);
      return Promise.resolve(v);
    },
    deleteVehicle: function (plate) {
      if (mode === "live") return j("DELETE", "/api/vehicles/" + encodeURIComponent(plate));
      store.vehicles = store.vehicles.filter(function (x) {
        return x.plate !== plate;
      });
      saveStore(store);
      return Promise.resolve({ deleted: plate });
    },

    listManifests: function () {
      return mode === "live" ? j("GET", "/api/manifests") : Promise.resolve(store.manifests.slice());
    },
    saveManifest: function (m) {
      if (mode === "live") return j("POST", "/api/manifests", m);
      var i = store.manifests.findIndex(function (x) {
        return x.container_code === m.container_code;
      });
      if (i >= 0) store.manifests[i] = m;
      else store.manifests.push(m);
      saveStore(store);
      return Promise.resolve(m);
    },
    deleteManifest: function (code) {
      if (mode === "live") return j("DELETE", "/api/manifests/" + encodeURIComponent(code));
      store.manifests = store.manifests.filter(function (x) {
        return x.container_code !== code;
      });
      saveStore(store);
      return Promise.resolve({ deleted: code });
    },

    listCustoms: function () {
      return mode === "live" ? j("GET", "/api/customs") : Promise.resolve(store.customs.slice());
    },
    saveCustoms: function (c) {
      if (mode === "live") return j("POST", "/api/customs", c);
      var i = store.customs.findIndex(function (x) {
        return x.sppb_number === c.sppb_number;
      });
      if (i >= 0) store.customs[i] = c;
      else store.customs.push(c);
      saveStore(store);
      return Promise.resolve(c);
    },

    lookup: function (q) {
      if (mode === "live") return j("GET", "/api/lookup/" + encodeURIComponent(q));
      var vehicle = findVehicle(q) || null;
      var manifest = findManifest(q, vehicle && vehicle.plate) || null;
      var customs = manifest ? findCustoms(manifest.sppb_number) : null;
      return Promise.resolve({ query: q, vehicle: vehicle, manifest: manifest, customs: customs });
    },

    evaluate: function (reading) {
      return mode === "live" ? j("POST", "/api/gate/evaluate", reading) : Promise.resolve(demoEvaluate(reading));
    },

    events: function (limit) {
      return mode === "live"
        ? j("GET", "/api/events?limit=" + (limit || 100))
        : Promise.resolve(store.events.slice(0, limit || 100));
    },
    stats: function () {
      if (mode === "live") return j("GET", "/api/stats");
      var total = store.events.length;
      var green = store.events.filter(function (e) {
        return e.lane === "GREEN";
      }).length;
      return Promise.resolve({ total: total, green: green, red: total - green, green_pct: total ? Math.round((green / total) * 100) : 0 });
    },

    resetDemo: function () {
      try {
        localStorage.removeItem(LS);
      } catch (e) {}
      store = loadStore();
    },
  };

  root.EGateAPI = API;
})(window);
