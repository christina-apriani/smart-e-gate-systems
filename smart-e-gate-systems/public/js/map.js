/* ============================================================================
 * Smart E-Gate Systems — Live Map (Leaflet + OpenStreetMap)
 * Author: Christina Apriani
 *
 * Renders the gate location and animates each processed truck approaching
 * along the access road, coloured by its gate decision. Degrades to a static
 * schematic if the tile layer cannot load.
 * ==========================================================================*/
(function (root) {
  "use strict";
  var map = null,
    gate = null,
    truckLayer = null,
    initialized = false;

  // approach path toward the gate (lng/lat waypoints, Batang KEK access road)
  function approach(g) {
    return [
      [g.lat - 0.012, g.lng - 0.016],
      [g.lat - 0.008, g.lng - 0.010],
      [g.lat - 0.004, g.lng - 0.005],
      [g.lat - 0.0015, g.lng - 0.002],
      [g.lat, g.lng],
    ];
  }

  function truckIcon(color) {
    return L.divIcon({
      className: "truck-pin",
      iconSize: [30, 20],
      iconAnchor: [15, 10],
      html:
        '<svg width="30" height="20" viewBox="0 0 30 20">' +
        '<rect x="1" y="4" width="16" height="11" rx="1.5" fill="' + color + '"/>' +
        '<rect x="17" y="7" width="8" height="8" rx="1.5" fill="#cfe"/>' +
        '<circle cx="6" cy="16" r="2.4" fill="#111"/><circle cx="13" cy="16" r="2.4" fill="#111"/>' +
        '<circle cx="22" cy="16" r="2.4" fill="#111"/>' +
        '<rect x="0" y="0" width="30" height="20" fill="none"/></svg>',
    });
  }

  var MapMod = {
    init: function (g) {
      gate = g;
      if (initialized || typeof L === "undefined") return;
      try {
        map = L.map("map", { zoomControl: true, attributionControl: true }).setView([g.lat, g.lng], 14);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
        }).addTo(map);

        truckLayer = L.layerGroup().addTo(map);

        // gate marker
        var gateIcon = L.divIcon({
          className: "truck-pin",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          html:
            '<div style="width:22px;height:22px;border-radius:6px;background:#2de2c6;border:2px solid #0a1016;' +
            'box-shadow:0 0 14px rgba(45,226,198,.7);display:grid;place-items:center;color:#042019;font-weight:900;font-size:12px">G</div>',
        });
        L.marker([g.lat, g.lng], { icon: gateIcon })
          .addTo(map)
          .bindPopup("<b>" + g.name + "</b><br>Smart E-Gate checkpoint");

        // draw access road
        L.polyline(approach(g), { color: "#2a3a4f", weight: 5, opacity: 0.8 }).addTo(map);
        L.circle([g.lat, g.lng], { radius: 140, color: "#2de2c6", weight: 1, fillOpacity: 0.05 }).addTo(map);

        initialized = true;
        setTimeout(function () {
          map.invalidateSize();
        }, 200);
      } catch (e) {
        var el = document.getElementById("map");
        if (el) el.innerHTML = '<div class="empty">Peta tidak dapat dimuat (tile offline). Fungsi gerbang tetap berjalan.</div>';
      }
    },

    refresh: function () {
      if (map) setTimeout(function () { map.invalidateSize(); }, 150);
    },

    // animate a truck arriving with a given decision
    arrive: function (lane, label) {
      if (!map || !truckLayer) return;
      var color = lane === "GREEN" ? "#19e37d" : "#ff3b57";
      var path = approach(gate);
      var marker = L.marker(path[0], { icon: truckIcon(color) }).addTo(truckLayer);
      marker.bindTooltip(label || lane, { permanent: false, direction: "top" });
      var i = 0;
      var steps = 60;
      var seg = 0;
      function step() {
        if (seg >= path.length - 1) {
          // arrived at gate: pulse ring, then fade
          var ring = L.circleMarker([gate.lat, gate.lng], {
            radius: 8, color: color, weight: 3, fillOpacity: 0.3,
          }).addTo(truckLayer);
          var r = 8;
          var grow = setInterval(function () {
            r += 3;
            ring.setRadius(r);
            ring.setStyle({ opacity: Math.max(0, 1 - r / 40) });
            if (r > 40) {
              clearInterval(grow);
              truckLayer.removeLayer(ring);
            }
          }, 40);
          setTimeout(function () {
            truckLayer.removeLayer(marker);
          }, 900);
          return;
        }
        var a = path[seg],
          b = path[seg + 1];
        var t = i / steps;
        var lat = a[0] + (b[0] - a[0]) * t;
        var lng = a[1] + (b[1] - a[1]) * t;
        marker.setLatLng([lat, lng]);
        i++;
        if (i > steps) {
          i = 0;
          seg++;
        }
        requestAnimationFrame(step);
      }
      step();
    },
  };

  root.EGateMap = MapMod;
})(window);
