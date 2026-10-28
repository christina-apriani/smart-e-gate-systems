/* ============================================================================
 * Smart E-Gate Systems — Demo dataset + simulated gov API (browser/offline)
 * Author: Christina Apriani
 *
 * Mirrors the backend seed so the console is fully functional as a static page
 * (e.g. GitHub Pages) when no server is attached. Persisted to localStorage.
 * ==========================================================================*/
(function (root) {
  "use strict";
  function plus(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  var DEFAULT = {
    vehicles: [
      { plate: "B 9114 KDT", operator: "PT Trans Batang Logistik", axle_config: "1.2.2", jbi_kg: 34000, tare_kg: 11500, max_len_mm: 12200, max_wid_mm: 2500, max_hei_mm: 4200, kir_number: "KIR-JTG-00841", kir_expiry: plus(120) },
      { plate: "B 9276 UIX", operator: "CV Pantura Kargo", axle_config: "1.2", jbi_kg: 26000, tare_kg: 9200, max_len_mm: 9600, max_wid_mm: 2500, max_hei_mm: 4200, kir_number: "KIR-JTG-01033", kir_expiry: plus(45) },
      { plate: "H 1842 QC", operator: "PT Semarang Container Line", axle_config: "1.2.2.2", jbi_kg: 40000, tare_kg: 13000, max_len_mm: 13600, max_wid_mm: 2550, max_hei_mm: 4200, kir_number: "KIR-JTG-00990", kir_expiry: plus(8) },
      { plate: "G 9550 AL", operator: "PT Pekalongan Freight", axle_config: "1.2", jbi_kg: 26000, tare_kg: 9100, max_len_mm: 9600, max_wid_mm: 2500, max_hei_mm: 4200, kir_number: "KIR-JTG-00712", kir_expiry: plus(-14) },
      { plate: "B 9631 SCF", operator: "PT Industropolis Haulage", axle_config: "1.2.2", jbi_kg: 34000, tare_kg: 11800, max_len_mm: 12200, max_wid_mm: 2500, max_hei_mm: 4200, kir_number: "KIR-JTG-01170", kir_expiry: plus(200) },
    ],
    manifests: [
      { container_code: "TGHU 2048115", plate: "B 9114 KDT", cargo_desc: "Tekstil jadi (ekspor)", cargo_weight_kg: 21500, sppb_number: "SPPB-2026-104771" },
      { container_code: "MSKU 7781340", plate: "B 9276 UIX", cargo_desc: "Komponen elektronik", cargo_weight_kg: 15800, sppb_number: "SPPB-2026-104772" },
      { container_code: "CSNU 9004122", plate: "H 1842 QC", cargo_desc: "Mesin industri", cargo_weight_kg: 25500, sppb_number: "SPPB-2026-104773" },
      { container_code: "TLLU 3390271", plate: "G 9550 AL", cargo_desc: "Furnitur kayu", cargo_weight_kg: 15600, sppb_number: "SPPB-2026-104774" },
      { container_code: "SEGU 5512098", plate: "B 9631 SCF", cargo_desc: "Bahan kimia (deklarasi)", cargo_weight_kg: 20000, sppb_number: "SPPB-2026-104775" },
    ],
    customs: [
      { sppb_number: "SPPB-2026-104771", status: "APPROVED", hs_code: "6109.10", declared_value: 1850000000 },
      { sppb_number: "SPPB-2026-104772", status: "APPROVED", hs_code: "8542.31", declared_value: 2400000000 },
      { sppb_number: "SPPB-2026-104773", status: "APPROVED", hs_code: "8479.89", declared_value: 5600000000 },
      { sppb_number: "SPPB-2026-104774", status: "APPROVED", hs_code: "9403.60", declared_value: 780000000 },
      { sppb_number: "SPPB-2026-104775", status: "PENDING", hs_code: "2811.19", declared_value: 1200000000 },
    ],
  };

  root.EGateSeed = {
    DEFAULT: DEFAULT,
    GATE: { name: "Main Gate — KEK Industropolis Batang", lat: -6.9445, lng: 109.7308 },
    // preset sensor readings for one-click simulation (mix of pass + fail)
    PRESETS: [
      { label: "Valid — Tekstil (lolos)", plate_ocr: "B 9114 KDT", container_code: "TGHU 2048115", wim_kg: 32800, len_mm: 12100, wid_mm: 2490, hei_mm: 4150, ocr_conf: 0.98 },
      { label: "Valid — Elektronik (lolos)", plate_ocr: "B 9276 UIX", container_code: "MSKU 7781340", wim_kg: 24900, len_mm: 9550, wid_mm: 2480, hei_mm: 4120, ocr_conf: 0.96 },
      { label: "ODOL — Overload (ditolak)", plate_ocr: "H 1842 QC", container_code: "CSNU 9004122", wim_kg: 43500, len_mm: 13500, wid_mm: 2540, hei_mm: 4150, ocr_conf: 0.95 },
      { label: "ODOL — Over-dimensi tinggi (ditolak)", plate_ocr: "B 9114 KDT", container_code: "TGHU 2048115", wim_kg: 32600, len_mm: 12150, wid_mm: 2495, hei_mm: 4600, ocr_conf: 0.97 },
      { label: "KIR kedaluwarsa (ditolak)", plate_ocr: "G 9550 AL", container_code: "TLLU 3390271", wim_kg: 24600, len_mm: 9550, wid_mm: 2485, hei_mm: 4150, ocr_conf: 0.94 },
      { label: "SPPB belum disetujui (ditolak)", plate_ocr: "B 9631 SCF", container_code: "SEGU 5512098", wim_kg: 31200, len_mm: 12100, wid_mm: 2490, hei_mm: 4150, ocr_conf: 0.92 },
      { label: "Anomali berat vs manifes (ditolak)", plate_ocr: "B 9114 KDT", container_code: "TGHU 2048115", wim_kg: 27500, len_mm: 12100, wid_mm: 2490, hei_mm: 4150, ocr_conf: 0.9 },
    ],
  };
})(window);
