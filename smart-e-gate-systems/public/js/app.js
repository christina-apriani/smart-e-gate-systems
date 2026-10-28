/* ============================================================================
 * Smart E-Gate Systems — Operator Console Controller
 * Author: Christina Apriani
 * ==========================================================================*/
(function () {
  "use strict";
  var API = window.EGateAPI,
    Map = window.EGateMap,
    Seed = window.EGateSeed;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var fmt = function (n) { return (n == null ? "—" : Number(n).toLocaleString("id-ID")); };

  /* ---- tabs ---- */
  document.querySelectorAll(".tab").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      document.querySelectorAll(".view").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      var v = b.dataset.v === "map" ? "map-view" : b.dataset.v;
      $(v).classList.add("active");
      if (b.dataset.v === "map") { Map.init(API.gate); Map.refresh(); }
      if (b.dataset.v === "registry") renderRegistry();
      if (b.dataset.v === "log") renderLog();
    };
  });

  /* ---- clock ---- */
  function tick() {
    var d = new Date();
    $("clock").textContent = d.toLocaleTimeString("id-ID", { hour12: false }) + " WIB";
  }
  setInterval(tick, 1000);
  tick();

  /* ---- toast ---- */
  var toastT;
  function toast(m) {
    var t = $("toast");
    t.textContent = m;
    t.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* ---- siren (WebAudio, no asset) ---- */
  function siren() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ac = new Ctx();
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = "sawtooth";
      o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ac.currentTime + 0.05);
      var t = ac.currentTime;
      for (var i = 0; i < 3; i++) {
        o.frequency.setValueAtTime(660, t + i * 0.4);
        o.frequency.linearRampToValueAtTime(880, t + i * 0.4 + 0.2);
        o.frequency.linearRampToValueAtTime(660, t + i * 0.4 + 0.4);
      }
      g.gain.setValueAtTime(0.08, ac.currentTime + 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 1.25);
      o.start();
      o.stop(ac.currentTime + 1.3);
    } catch (e) {}
  }

  /* ---- mode badge ---- */
  function setMode(mode) {
    var p = $("modePill"), t = $("modeText");
    p.className = "pill mode-" + mode;
    t.textContent = mode === "live" ? "LIVE · backend aktif" : "DEMO · engine lokal";
  }

  /* =========================================================================
   * GATE CONTROL — animated 4-stage pipeline
   * =======================================================================*/
  var running = false;

  function resetPipeline() {
    document.querySelectorAll("#pipeline .stage").forEach(function (s) {
      s.className = "stage";
      s.querySelector(".badge").className = "badge wait";
      s.querySelector(".badge").textContent = "menunggu";
      s.querySelector(".st-detail").innerHTML = "";
    });
    var ls = $("laneStage");
    ls.classList.remove("open", "closed-red");
    $("barrier").style.transform = "rotate(0deg)";
    $("verdict").className = "verdict";
    $("sirenPill").style.display = "none";
    $("truck").style.left = "-140px";
    $("laneLabel").textContent = "IDLE · menunggu kendaraan";
  }

  function setStage(id, state, badgeText, badgeClass, detailHTML) {
    var s = document.querySelector('#pipeline .stage[data-s="' + id + '"]');
    s.className = "stage " + state + (detailHTML ? " done" : "");
    var b = s.querySelector(".badge");
    b.className = "badge " + badgeClass;
    b.textContent = badgeText;
    if (detailHTML != null) s.querySelector(".st-detail").innerHTML = detailHTML;
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function moveTruck(toPx, ms) {
    return new Promise(function (resolve) {
      var el = $("truck");
      var start = parseFloat(el.style.left) || -140;
      var t0 = performance.now();
      function frame(t) {
        var k = Math.min(1, (t - t0) / ms);
        el.style.left = start + (toPx - start) * k + "px";
        if (k < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  async function runGate(reading) {
    if (running) return;
    running = true;
    $("btnRandom").disabled = true;
    $("btnPreset").disabled = true;
    resetPipeline();
    $("truckPlate").textContent = reading.plate_ocr || "—";
    $("laneLabel").textContent = "APPROACH · " + (reading.plate_ocr || "kendaraan");

    // bring truck up to the barrier
    var laneW = $("laneStage").clientWidth;
    var stopPx = laneW - 320;
    await moveTruck(Math.max(40, stopPx), 1400);

    // Stage 1: IoT capture
    setStage("s1", "run", "memindai…", "wait");
    await wait(520);
    setStage(
      "s1", "ok", "selesai", "ok",
      "WIM: <b>" + fmt(reading.wim_kg) + " kg</b> · Dimensi: " +
        fmt(reading.len_mm) + "×" + fmt(reading.wid_mm) + "×" + fmt(reading.hei_mm) + " mm<br>" +
        "OCR pelat: <b>" + esc(reading.plate_ocr) + "</b> · Kontainer: " + esc(reading.container_code || "—")
    );

    // call engine/backend now (it is instant; we reveal results per stage)
    var result = await API.evaluate(reading);
    var st = result.stages;

    // Stage 2: AI
    setStage("s2", "run", "menganalisis…", "wait");
    await wait(620);
    var odol = st.s2_ai.odol, anom = st.s2_ai.weight_anomaly, ocr = st.s2_ai.ocr;
    var s2ok = !odol.odol && anom.pass;
    var s2detail =
      line("AI Vision ODOL", odol.odol ? (odol.overload ? "Overload" : "Over-dimensi") : "Normal", !odol.odol) +
      line("OCR confidence", ocr.confidence || "n/a", ocr.confident) +
      line("AI Prediktif berat", anom.deviation || "—", anom.pass);
    setStage("s2", s2ok ? "ok" : "bad", s2ok ? "lolos fisik" : "anomali", s2ok ? "ok" : "bad", s2detail);

    // Stage 3: Gov API
    setStage("s3", "run", "sinkronisasi…", "wait");
    await wait(640);
    var kir = st.s3_api.kir, sppb = st.s3_api.sppb;
    var s3ok = kir.pass && sppb.pass;
    var s3detail =
      line("Kemenhub KIR", (kir.expiry || kir.detail || "—") + (kir.pass ? " (aktif)" : " (tidak valid)"), kir.pass) +
      line("CEISA SPPB", (sppb.status || sppb.detail || "—"), sppb.pass);
    setStage("s3", s3ok ? "ok" : "bad", s3ok ? "valid" : "ditolak", s3ok ? "ok" : "bad", s3detail);

    // Stage 4: Decision
    setStage("s4", "run", "memutuskan…", "wait");
    await wait(420);
    var green = result.lane === "GREEN";
    var s4detail = green
      ? "✅ Lolos uji fisik ODOL <b>dan</b> dokumen pabean valid.<br>Aksi: buka palang, kirim log manifes ke CEISA."
      : "⛔ Pelanggaran terdeteksi:<br>" + result.reasons.map(function (r) { return "• " + esc(r); }).join("<br>") +
        "<br>Aksi: palang terkunci, sirine, arahkan ke pemeriksaan fisik.";
    setStage("s4", green ? "ok" : "bad", green ? "JALUR HIJAU" : "JALUR MERAH", green ? "ok" : "bad", s4detail);

    // barrier + verdict
    var ls = $("laneStage");
    if (green) {
      ls.classList.add("open");
      $("verdict").className = "verdict green show";
      $("verdict").textContent = "● JALUR HIJAU";
      $("laneLabel").textContent = "CLEARED · gerbang terbuka";
      await wait(300);
      await moveTruck(laneW + 160, 1500); // truck passes through
    } else {
      ls.classList.add("closed-red");
      $("verdict").className = "verdict red show";
      $("verdict").textContent = "● JALUR MERAH";
      $("laneLabel").textContent = "LOCKED · diarahkan ke pemeriksaan";
      $("sirenPill").style.display = "inline-block";
      if (result.action.siren) siren();
      await wait(600);
      await moveTruck(Math.max(20, stopPx - 120), 700); // reverse slightly
    }

    pushTicker(result, reading);
    if (Map) Map.arrive(result.lane, (reading.plate_ocr || "") + " · " + result.lane);
    await refreshStats();
    running = false;
    $("btnRandom").disabled = false;
    $("btnPreset").disabled = false;
  }

  function line(label, val, ok) {
    return (
      '<div class="check-line"><span>' + esc(label) +
      '</span><span class="' + (ok ? "ck-ok" : "ck-bad") + '">' + (ok ? "✓ " : "✗ ") + esc(val) + "</span></div>"
    );
  }

  /* ---- ticker ---- */
  function pushTicker(result, reading) {
    var tk = $("ticker");
    if (tk.querySelector(".empty")) tk.innerHTML = "";
    var div = document.createElement("div");
    div.className = "tick";
    var reason = result.lane === "GREEN" ? "lolos — log manifes terkirim ke CEISA" : result.reasons[0] || "ditolak";
    div.innerHTML =
      '<span class="tdot ' + result.lane + '"></span>' +
      '<span class="mono">' + new Date().toLocaleTimeString("id-ID", { hour12: false }) + "</span>" +
      "<span><b>" + esc(reading.plate_ocr || "—") + "</b> · " + esc(reason) + "</span>";
    tk.insertBefore(div, tk.firstChild);
    while (tk.children.length > 30) tk.removeChild(tk.lastChild);
  }

  /* ---- buttons ---- */
  function fillPresets() {
    var sel = $("presetSelect");
    sel.innerHTML = Seed.PRESETS.map(function (p, i) {
      return '<option value="' + i + '">' + esc(p.label) + "</option>";
    }).join("");
  }
  $("btnRandom").onclick = function () {
    var p = Seed.PRESETS[Math.floor(Math.random() * Seed.PRESETS.length)];
    runGate(Object.assign({}, p));
  };
  $("btnPreset").onclick = function () {
    var p = Seed.PRESETS[parseInt($("presetSelect").value) || 0];
    runGate(Object.assign({}, p));
  };

  /* =========================================================================
   * SENSOR INPUT (manual)
   * =======================================================================*/
  function fillVehicleSelect() {
    return API.listVehicles().then(function (vs) {
      var opts = '<option value="">— pilih / isi manual —</option>';
      vs.forEach(function (v) {
        opts += '<option value="' + esc(v.plate) + '">' + esc(v.plate) + " · " + esc(v.operator) + "</option>";
      });
      $("i_vehicle").innerHTML = opts;
    });
  }
  $("i_vehicle").onchange = function () {
    var plate = this.value;
    if (!plate) return;
    API.lookup(plate).then(function (d) {
      if (d.vehicle) {
        $("i_plate").value = d.vehicle.plate;
        $("i_wim").value = d.vehicle.tare_kg + (d.manifest ? d.manifest.cargo_weight_kg : 0);
        $("i_len").value = Math.max(0, d.vehicle.max_len_mm - 100);
        $("i_wid").value = Math.max(0, d.vehicle.max_wid_mm - 10);
        $("i_hei").value = Math.max(0, d.vehicle.max_hei_mm - 50);
        $("i_conf").value = 0.97;
      }
      if (d.manifest) $("i_container").value = d.manifest.container_code;
    });
  };
  $("btnFillValid").onclick = function () {
    var p = Seed.PRESETS[0];
    $("i_plate").value = p.plate_ocr; $("i_container").value = p.container_code;
    $("i_wim").value = p.wim_kg; $("i_len").value = p.len_mm; $("i_wid").value = p.wid_mm;
    $("i_hei").value = p.hei_mm; $("i_conf").value = p.ocr_conf;
  };
  $("btnEvaluate").onclick = function () {
    var reading = {
      plate_ocr: $("i_plate").value.trim(),
      container_code: $("i_container").value.trim(),
      wim_kg: parseInt($("i_wim").value) || 0,
      len_mm: parseInt($("i_len").value) || 0,
      wid_mm: parseInt($("i_wid").value) || 0,
      hei_mm: parseInt($("i_hei").value) || 0,
      ocr_conf: $("i_conf").value === "" ? 1 : parseFloat($("i_conf").value),
    };
    if (!reading.plate_ocr) { toast("Isi pelat terlebih dahulu"); return; }
    API.evaluate(reading).then(function (result) {
      renderResult(result, reading);
      refreshStats();
      if (Map) Map.arrive(result.lane, reading.plate_ocr + " · " + result.lane);
    });
  };

  function renderResult(result, reading) {
    var lane = result.lane;
    $("resLane").innerHTML = '<span class="lane-tag ' + lane + '">' + (lane === "GREEN" ? "JALUR HIJAU" : "JALUR MERAH") + "</span>";
    var st = result.stages;
    var ctx = result.context || {};
    var html = "";
    html += '<div class="kv" style="margin-bottom:14px">';
    html += '<span class="k">Kendaraan</span><span class="v">' + (ctx.vehicle ? esc(ctx.vehicle.plate) + " · " + esc(ctx.vehicle.operator) : '<span class="ck-bad">tidak terdaftar</span>') + "</span>";
    html += '<span class="k">Manifes</span><span class="v">' + (ctx.manifest ? esc(ctx.manifest.container_code) + " · " + esc(ctx.manifest.cargo_desc) : "—") + "</span>";
    html += "</div>";

    html += stageBlock("📡 Tahap 1 — Sensor IoT", [
      ["WIM (berat)", fmt(reading.wim_kg) + " kg", true],
      ["Dimensi LiDAR", fmt(reading.len_mm) + "×" + fmt(reading.wid_mm) + "×" + fmt(reading.hei_mm) + " mm", true],
      ["Kamera HD / OCR", esc(reading.plate_ocr) + " (" + Math.round((reading.ocr_conf == null ? 1 : reading.ocr_conf) * 100) + "%)", st.s2_ai.ocr.confident],
    ]);

    var odol = st.s2_ai.odol;
    var odolRows = odol.checks.map(function (c) { return [c.label, (c.measured || "") + (c.limit ? " / " + c.limit : "") + (c.over_by ? " (lebih " + c.over_by + ")" : ""), c.pass]; });
    odolRows.push(["AI Prediktif berat", st.s2_ai.weight_anomaly.deviation || "—", st.s2_ai.weight_anomaly.pass]);
    html += stageBlock("🧠 Tahap 2 — Pemrosesan AI", odolRows);

    html += stageBlock("🛰️ Tahap 3 — Sinkronisasi API Pemerintah", [
      ["Kemenhub · Uji KIR", (st.s3_api.kir.number ? st.s3_api.kir.number + " · " : "") + (st.s3_api.kir.expiry || st.s3_api.kir.detail || "—"), st.s3_api.kir.pass],
      ["CEISA Bea Cukai · SPPB", (st.s3_api.sppb.number ? st.s3_api.sppb.number + " · " : "") + (st.s3_api.sppb.status || st.s3_api.sppb.detail || "—"), st.s3_api.sppb.pass],
    ]);

    html += '<div style="margin-top:14px;padding:14px;border-radius:10px;border:1px solid ' + (lane === "GREEN" ? "var(--go-dim)" : "var(--stop-dim)") + ';background:' + (lane === "GREEN" ? "rgba(25,227,125,.06)" : "rgba(255,59,87,.06)") + '">';
    html += '<div style="font-family:var(--mono);font-weight:800;letter-spacing:1px;color:' + (lane === "GREEN" ? "var(--go)" : "var(--stop)") + '">⚖️ KEPUTUSAN: ' + (lane === "GREEN" ? "JALUR HIJAU — GERBANG TERBUKA" : "JALUR MERAH — GERBANG TERKUNCI") + "</div>";
    html += '<div style="font-size:12px;color:var(--muted);margin-top:8px">' + esc(result.action.route) + " · " + esc(result.action.followup) + "</div>";
    if (result.reasons.length) html += '<div style="font-size:12px;color:var(--stop);margin-top:8px">' + result.reasons.map(function (r) { return "• " + esc(r); }).join("<br>") + "</div>";
    html += '<div class="faint" style="font-size:11px;margin-top:8px">Event #' + result.event_id + " · engine: " + esc(result.engine) + "</div>";
    html += "</div>";
    $("resultPane").innerHTML = html;
  }
  function stageBlock(title, rows) {
    return (
      '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px">' + title + "</div>" +
      rows.map(function (r) { return line(r[0], r[1], r[2]); }).join("") + "</div>"
    );
  }

  /* =========================================================================
   * LOOKUP
   * =======================================================================*/
  function doLookup() {
    var q = $("lk_q").value.trim();
    if (!q) { toast("Masukkan pelat atau kode kontainer"); return; }
    API.lookup(q).then(function (d) {
      if (!d.vehicle && !d.manifest) {
        $("lookupPane").innerHTML = '<div class="empty">Tidak ditemukan data untuk "' + esc(q) + '".</div>';
        return;
      }
      var v = d.vehicle, m = d.manifest, c = d.customs;
      var today = new Date().toISOString().slice(0, 10);
      var kirOk = v && v.kir_expiry && v.kir_expiry >= today;
      var html = '<div class="grid cols-3">';
      html += '<div class="card"><h2><span class="bar"></span>Kendaraan</h2>' + (v ?
        '<div class="kv"><span class="k">Pelat</span><span class="v mono">' + esc(v.plate) + "</span>" +
        '<span class="k">Operator</span><span class="v">' + esc(v.operator) + "</span>" +
        '<span class="k">Konfig. sumbu</span><span class="v mono">' + esc(v.axle_config) + "</span>" +
        '<span class="k">JBI (maks)</span><span class="v">' + fmt(v.jbi_kg) + " kg</span>" +
        '<span class="k">Tare</span><span class="v">' + fmt(v.tare_kg) + " kg</span>" +
        '<span class="k">Dimensi maks</span><span class="v">' + fmt(v.max_len_mm) + "×" + fmt(v.max_wid_mm) + "×" + fmt(v.max_hei_mm) + " mm</span>" +
        '<span class="k">KIR</span><span class="v">' + esc(v.kir_number || "—") + ' <span class="chip ' + (kirOk ? "ok" : "bad") + '">' + (v.kir_expiry || "—") + "</span></span></div>" :
        '<div class="empty">tidak terdaftar</div>') + "</div>";

      html += '<div class="card"><h2><span class="bar"></span>Manifes</h2>' + (m ?
        '<div class="kv"><span class="k">Kontainer</span><span class="v mono">' + esc(m.container_code) + "</span>" +
        '<span class="k">Pelat</span><span class="v mono">' + esc(m.plate) + "</span>" +
        '<span class="k">Kargo</span><span class="v">' + esc(m.cargo_desc) + "</span>" +
        '<span class="k">Berat kargo</span><span class="v">' + fmt(m.cargo_weight_kg) + " kg</span>" +
        '<span class="k">Berat diharapkan</span><span class="v">' + (v ? fmt(v.tare_kg + m.cargo_weight_kg) + " kg" : "—") + "</span>" +
        '<span class="k">No. SPPB</span><span class="v mono">' + esc(m.sppb_number) + "</span></div>" :
        '<div class="empty">tidak ada manifes</div>') + "</div>";

      html += '<div class="card"><h2><span class="bar"></span>Pabean (CEISA)</h2>' + (c ?
        '<div class="kv"><span class="k">No. SPPB</span><span class="v mono">' + esc(c.sppb_number) + "</span>" +
        '<span class="k">Status</span><span class="v"><span class="chip ' + (c.status === "APPROVED" ? "ok" : "bad") + '">' + esc(c.status) + "</span></span>" +
        '<span class="k">HS Code</span><span class="v mono">' + esc(c.hs_code || "—") + "</span>" +
        '<span class="k">Nilai pabean</span><span class="v">Rp ' + fmt(c.declared_value) + "</span></div>" :
        '<div class="empty">dokumen pabean tidak ditemukan</div>') + "</div>";
      html += "</div>";
      $("lookupPane").innerHTML = html;
    });
  }
  $("btnLookup").onclick = doLookup;
  $("lk_q").onkeydown = function (e) { if (e.key === "Enter") doLookup(); };

  /* =========================================================================
   * REGISTRY (CRUD)
   * =======================================================================*/
  function renderRegistry() {
    API.listVehicles().then(function (vs) {
      $("tblVehicles").innerHTML =
        "<thead><tr><th>Pelat</th><th>Operator</th><th>Sumbu</th><th>JBI (kg)</th><th>Tare (kg)</th><th>Dimensi maks (mm)</th><th>KIR</th><th></th></tr></thead><tbody>" +
        vs.map(function (v) {
          return "<tr><td class='mono'>" + esc(v.plate) + "</td><td>" + esc(v.operator) + "</td><td class='mono'>" + esc(v.axle_config) +
            "</td><td>" + fmt(v.jbi_kg) + "</td><td>" + fmt(v.tare_kg) + "</td><td class='mono'>" + v.max_len_mm + "×" + v.max_wid_mm + "×" + v.max_hei_mm +
            "</td><td class='mono'>" + esc(v.kir_expiry || "—") + "</td><td><button class='btn ghost sm' data-ev='" + esc(v.plate) + "'>edit</button> <button class='btn danger sm' data-dv='" + esc(v.plate) + "'>×</button></td></tr>";
        }).join("") + "</tbody>";
      $("tblVehicles").querySelectorAll("[data-ev]").forEach(function (b) { b.onclick = function () { editVehicle(b.dataset.ev); }; });
      $("tblVehicles").querySelectorAll("[data-dv]").forEach(function (b) { b.onclick = function () { if (confirm("Hapus " + b.dataset.dv + "?")) API.deleteVehicle(b.dataset.dv).then(function () { renderRegistry(); fillVehicleSelect(); toast("Kendaraan dihapus"); }); }; });
    });
    API.listManifests().then(function (ms) {
      $("tblManifests").innerHTML =
        "<thead><tr><th>Kontainer</th><th>Pelat</th><th>Kargo (kg)</th><th>SPPB</th><th></th></tr></thead><tbody>" +
        ms.map(function (m) {
          return "<tr><td class='mono'>" + esc(m.container_code) + "</td><td class='mono'>" + esc(m.plate) + "</td><td>" + fmt(m.cargo_weight_kg) +
            "</td><td class='mono'>" + esc(m.sppb_number || "—") + "</td><td><button class='btn ghost sm' data-em='" + esc(m.container_code) + "'>edit</button> <button class='btn danger sm' data-dm='" + esc(m.container_code) + "'>×</button></td></tr>";
        }).join("") + "</tbody>";
      $("tblManifests").querySelectorAll("[data-em]").forEach(function (b) { b.onclick = function () { editManifest(b.dataset.em); }; });
      $("tblManifests").querySelectorAll("[data-dm]").forEach(function (b) { b.onclick = function () { if (confirm("Hapus " + b.dataset.dm + "?")) API.deleteManifest(b.dataset.dm).then(function () { renderRegistry(); toast("Manifes dihapus"); }); }; });
    });
    API.listCustoms().then(function (cs) {
      $("tblCustoms").innerHTML =
        "<thead><tr><th>SPPB</th><th>Status</th><th>HS</th><th>Nilai (Rp)</th><th></th></tr></thead><tbody>" +
        cs.map(function (c) {
          return "<tr><td class='mono'>" + esc(c.sppb_number) + "</td><td><span class='lane-tag " + (c.status === "APPROVED" ? "GREEN" : "RED") + "'>" + esc(c.status) + "</span></td><td class='mono'>" + esc(c.hs_code || "—") +
            "</td><td>" + fmt(c.declared_value) + "</td><td><button class='btn ghost sm' data-ec='" + esc(c.sppb_number) + "'>edit</button></td></tr>";
        }).join("") + "</tbody>";
      $("tblCustoms").querySelectorAll("[data-ec]").forEach(function (b) { b.onclick = function () { editCustoms(b.dataset.ec); }; });
    });
  }

  /* ---- modal helpers ---- */
  function openModal(html) { $("modalBox").innerHTML = html; $("modalBackdrop").style.display = "grid"; }
  function closeModal() { $("modalBackdrop").style.display = "none"; }
  $("modalBackdrop").addEventListener("click", function (e) { if (e.target.id === "modalBackdrop") closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  function fld(id, label, val, type) {
    return '<label class="f">' + label + '</label><input class="x" id="' + id + '" type="' + (type || "text") + '" value="' + esc(val == null ? "" : val) + '"/>';
  }

  function editVehicle(plate) {
    API.listVehicles().then(function (vs) {
      var v = vs.find(function (x) { return x.plate === plate; }) || { plate: "", operator: "", axle_config: "1.2", jbi_kg: 26000, tare_kg: 9000, max_len_mm: 12000, max_wid_mm: 2500, max_hei_mm: 4200, kir_number: "", kir_expiry: "" };
      openModal(
        "<h2 style='margin-bottom:12px'><span class='bar'></span>" + (plate ? "Edit" : "Tambah") + " Kendaraan</h2>" +
        fld("v_plate", "Pelat", v.plate) + fld("v_op", "Operator", v.operator) +
        '<div class="field-row">' + fld("v_axle", "Konfig. sumbu", v.axle_config) + fld("v_jbi", "JBI (kg)", v.jbi_kg, "number") + "</div>" +
        '<div class="field-row">' + fld("v_tare", "Tare (kg)", v.tare_kg, "number") + fld("v_len", "Panjang maks (mm)", v.max_len_mm, "number") + "</div>" +
        '<div class="field-row">' + fld("v_wid", "Lebar maks (mm)", v.max_wid_mm, "number") + fld("v_hei", "Tinggi maks (mm)", v.max_hei_mm, "number") + "</div>" +
        '<div class="field-row">' + fld("v_kirn", "No. KIR", v.kir_number) + fld("v_kire", "KIR expiry (YYYY-MM-DD)", v.kir_expiry) + "</div>" +
        '<div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn ghost sm" id="mCancel">Batal</button><button class="btn sm" id="mSave">Simpan</button></div>'
      );
      $("mCancel").onclick = closeModal;
      $("mSave").onclick = function () {
        var obj = { plate: $("v_plate").value.trim(), operator: $("v_op").value.trim(), axle_config: $("v_axle").value.trim(),
          jbi_kg: +$("v_jbi").value, tare_kg: +$("v_tare").value, max_len_mm: +$("v_len").value, max_wid_mm: +$("v_wid").value,
          max_hei_mm: +$("v_hei").value, kir_number: $("v_kirn").value.trim(), kir_expiry: $("v_kire").value.trim() };
        if (!obj.plate) { toast("Pelat wajib diisi"); return; }
        API.saveVehicle(obj).then(function () { closeModal(); renderRegistry(); fillVehicleSelect(); toast("Kendaraan tersimpan"); });
      };
    });
  }
  function editManifest(code) {
    API.listManifests().then(function (ms) {
      var m = ms.find(function (x) { return x.container_code === code; }) || { container_code: "", plate: "", cargo_desc: "", cargo_weight_kg: 0, sppb_number: "" };
      openModal(
        "<h2 style='margin-bottom:12px'><span class='bar'></span>" + (code ? "Edit" : "Tambah") + " Manifes</h2>" +
        fld("m_code", "Kode kontainer", m.container_code) + fld("m_plate", "Pelat", m.plate) +
        fld("m_desc", "Deskripsi kargo", m.cargo_desc) + fld("m_wt", "Berat kargo (kg)", m.cargo_weight_kg, "number") +
        fld("m_sppb", "No. SPPB", m.sppb_number) +
        '<div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn ghost sm" id="mCancel">Batal</button><button class="btn sm" id="mSave">Simpan</button></div>'
      );
      $("mCancel").onclick = closeModal;
      $("mSave").onclick = function () {
        var obj = { container_code: $("m_code").value.trim(), plate: $("m_plate").value.trim(), cargo_desc: $("m_desc").value.trim(), cargo_weight_kg: +$("m_wt").value, sppb_number: $("m_sppb").value.trim() };
        if (!obj.container_code) { toast("Kode kontainer wajib"); return; }
        API.saveManifest(obj).then(function () { closeModal(); renderRegistry(); toast("Manifes tersimpan"); });
      };
    });
  }
  function editCustoms(sppb) {
    API.listCustoms().then(function (cs) {
      var c = cs.find(function (x) { return x.sppb_number === sppb; }) || { sppb_number: "", status: "PENDING", hs_code: "", declared_value: 0 };
      openModal(
        "<h2 style='margin-bottom:12px'><span class='bar'></span>" + (sppb ? "Edit" : "Tambah") + " SPPB</h2>" +
        fld("c_sppb", "No. SPPB", c.sppb_number) +
        '<label class="f">Status</label><select class="x" id="c_status">' +
        ["APPROVED", "PENDING", "REJECTED"].map(function (s) { return '<option ' + (c.status === s ? "selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" +
        fld("c_hs", "HS Code", c.hs_code) + fld("c_val", "Nilai pabean (Rp)", c.declared_value, "number") +
        '<div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn ghost sm" id="mCancel">Batal</button><button class="btn sm" id="mSave">Simpan</button></div>'
      );
      $("mCancel").onclick = closeModal;
      $("mSave").onclick = function () {
        var obj = { sppb_number: $("c_sppb").value.trim(), status: $("c_status").value, hs_code: $("c_hs").value.trim(), declared_value: +$("c_val").value };
        if (!obj.sppb_number) { toast("No. SPPB wajib"); return; }
        API.saveCustoms(obj).then(function () { closeModal(); renderRegistry(); toast("SPPB tersimpan"); });
      };
    });
  }
  $("btnAddVehicle").onclick = function () { editVehicle(""); };
  $("btnAddManifest").onclick = function () { editManifest(""); };
  $("btnAddCustoms").onclick = function () { editCustoms(""); };

  /* =========================================================================
   * EVENT LOG
   * =======================================================================*/
  function renderLog() {
    var filter = $("logFilter").value;
    API.events(200).then(function (evs) {
      if (filter) evs = evs.filter(function (e) { return e.lane === filter; });
      if (!evs.length) { $("tblLog").innerHTML = "<tbody><tr><td><div class='empty'>Belum ada kejadian.</div></td></tr></tbody>"; return; }
      $("tblLog").innerHTML =
        "<thead><tr><th>#</th><th>Waktu</th><th>Pelat</th><th>Kontainer</th><th>WIM</th><th>Jalur</th><th>Alasan</th></tr></thead><tbody>" +
        evs.map(function (e) {
          var reasons = Array.isArray(e.reasons) ? e.reasons : [];
          return "<tr><td class='mono faint'>" + (e.id || "") + "</td><td class='mono'>" + esc(e.ts || "") + "</td><td class='mono'>" + esc(e.plate || e.plate_ocr || "—") +
            "</td><td class='mono'>" + esc(e.container_code || "—") + "</td><td class='mono'>" + fmt(e.wim_kg) + "</td><td><span class='lane-tag " + e.lane + "'>" + e.lane + "</span></td><td class='muted' style='font-size:12px'>" + esc(reasons.join("; ") || (e.lane === "GREEN" ? "lolos" : "—")) + "</td></tr>";
        }).join("") + "</tbody>";
    });
  }
  $("btnRefreshLog").onclick = renderLog;
  $("logFilter").onchange = renderLog;

  /* ---- stats ---- */
  function refreshStats() {
    return API.stats().then(function (s) {
      $("st_total").textContent = s.total;
      $("st_green").textContent = s.green;
      $("st_red").textContent = s.red;
      $("st_rate").textContent = s.green_pct + "%";
    });
  }

  /* =========================================================================
   * BOOT
   * =======================================================================*/
  API.detect().then(function (mode) {
    setMode(mode);
    $("gateName").textContent = API.gate.name;
    $("mapGate").textContent = API.gate.name;
    fillPresets();
    fillVehicleSelect();
    refreshStats();
    renderLog();

    // live stream (backend only)
    if (mode === "live" && window.EventSource) {
      try {
        var es = new EventSource("/api/stream");
        es.addEventListener("gate", function (ev) {
          try {
            var d = JSON.parse(ev.data);
            // reflect externally-generated events into ticker + stats + map
            if (d && d.result) {
              pushTicker(d.result, { plate_ocr: d.plate });
              if (Map) Map.arrive(d.lane, (d.plate || "") + " · " + d.lane);
              refreshStats();
            }
          } catch (e) {}
        });
      } catch (e) {}
    }
  });
})();
