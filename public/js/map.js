let map;
const polylines = {};    // flightId -> google.maps.Polyline
const infoWindow = new (function() { this.ref = null; })(); // lazy init
var vfrOverlay = null;
var vfrVisible = false;
var airspaceLayer = null;
var airspaceVisible = false;

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 37.6213, lng: -122.379 }, // KSFO
    zoom: 5,
    mapTypeId: "terrain",
    styles: [
      { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
      { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#0e1626" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
      { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
    ],
  });
  infoWindow.ref = new google.maps.InfoWindow();
  initAirspaceLabelOverlay();

  // FAA VFR Sectional tile overlay
  vfrOverlay = new google.maps.ImageMapType({
    getTileUrl: function (coord, zoom) {
      return "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/" +
        zoom + "/" + coord.y + "/" + coord.x;
    },
    tileSize: new google.maps.Size(256, 256),
    maxZoom: 12,
    minZoom: 5,
    opacity: 1.0,
    name: "VFR Sectional",
  });
}

var defaultMapStyles = null;

function toggleVFR() {
  if (!defaultMapStyles) {
    defaultMapStyles = map.get("styles");
  }
  if (vfrVisible) {
    map.overlayMapTypes.clear();
    map.set("styles", defaultMapStyles);
    vfrVisible = false;
  } else {
    map.overlayMapTypes.push(vfrOverlay);
    // Hide all base map features so only VFR tiles show
    map.set("styles", [{ elementType: "geometry", stylers: [{ visibility: "off" }] },
      { elementType: "labels", stylers: [{ visibility: "off" }] }]);
    vfrVisible = true;
  }
  var btn = document.getElementById("vfr-toggle");
  if (btn) btn.classList.toggle("active", vfrVisible);
}

var AIRSPACE_STYLES = {
  A: { fill: "#78909C", stroke: "#78909C", fillOp: 0.05, strokeOp: 0.4, weight: 1 },
  B: { fill: "#2196F3", stroke: "#2196F3", fillOp: 0.10, strokeOp: 0.7, weight: 1.5 },
  C: { fill: "#9C27B0", stroke: "#9C27B0", fillOp: 0.08, strokeOp: 0.6, weight: 1 },
  D: { fill: "#2196F3", stroke: "#2196F3", fillOp: 0.06, strokeOp: 0.5, weight: 1 },
};

var AIRSPACE_FILES = [
  "/data/airspace.json",
  "/data/boundary-airspace.json",
  "/data/defense-airspace.json",
];

// Store raw GeoJSON for point-in-polygon queries
var airspaceGeoData = [];
var airspaceLabels = [];

// Airspace visibility by zoom:
//   zoom 5-7:  Class B only
//   zoom 8-9:  Class B + C
//   zoom 10-11: Class B + C + D
//   zoom 12+:  Class B + C + D (all segments)
// Boundary airspace (ARTCC, ADIZ) always visible
// Class A and E always hidden

function airspaceStyleFn(feature) {
  var cls = feature.getProperty("c") || "";
  var type = feature.getProperty("t") || "";
  var zoom = map ? map.getZoom() : 10;

  // Always hide Class E and A
  if (cls === "E" || cls === "A") {
    return { visible: false };
  }

  // Zoom-based class filtering
  if (cls === "D" && zoom < 7) return { visible: false };
  if (cls === "C" && zoom < 6) return { visible: false };

  var s = AIRSPACE_STYLES[cls];

  if (!s) {
    if (type === "ARTCC" || type === "ARTCC_L" || type === "ARTCC_H" || type === "CERAP") {
      if (zoom < 5) return { visible: false };
      s = { fill: "#607D8B", stroke: "#607D8B", fillOp: 0, strokeOp: 0.3, weight: 1 };
    } else if (type === "TRSA") {
      if (zoom < 7) return { visible: false };
      s = { fill: "#795548", stroke: "#795548", fillOp: 0.05, strokeOp: 0.5, weight: 1 };
    } else if (type === "ADIZ" || type === "NDA_TFR") {
      s = { fill: "#F44336", stroke: "#F44336", fillOp: 0.05, strokeOp: 0.5, weight: 1.5 };
    } else {
      if (zoom < 7) return { visible: false };
      s = { fill: "#9E9E9E", stroke: "#9E9E9E", fillOp: 0.03, strokeOp: 0.3, weight: 0.5 };
    }
  }

  return {
    fillColor: s.fill,
    fillOpacity: s.fillOp,
    strokeColor: s.stroke,
    strokeWeight: s.weight,
    strokeOpacity: s.strokeOp,
  };
}

function formatAlt(val) {
  if (val === null || val === undefined || val === "") return "SFC";
  var n = parseInt(val);
  if (isNaN(n)) return String(val);
  if (n <= 0) return "SFC";
  if (n === -9998) return "Class A";
  if (n >= 18000) return "FL" + Math.round(n / 100);
  return n.toLocaleString() + "'";
}

function computeCentroid(geom) {
  var coords;
  if (geom.type === "Polygon") {
    coords = geom.coordinates[0];
  } else if (geom.type === "MultiPolygon") {
    coords = geom.coordinates[0][0];
  } else {
    return null;
  }
  var latSum = 0, lngSum = 0, n = coords.length;
  for (var i = 0; i < n; i++) {
    lngSum += coords[i][0];
    latSum += coords[i][1];
  }
  return { lat: latSum / n, lng: lngSum / n };
}

// Custom overlay for rotated airspace border labels
// Initialized lazily after Google Maps loads
var AirspaceLabelOverlay = null;

function initAirspaceLabelOverlay() {
  if (AirspaceLabelOverlay) return;

  AirspaceLabelOverlay = function (position, text, angle, color) {
    this.position = position;
    this.text = text;
    this.angle = angle;
    this.color = color;
    this.div = null;
    google.maps.OverlayView.call(this);
  };

  AirspaceLabelOverlay.prototype = Object.create(google.maps.OverlayView.prototype);

  AirspaceLabelOverlay.prototype.onAdd = function () {
    var div = document.createElement("div");
    div.style.position = "absolute";
    div.style.transform = "rotate(" + this.angle + "deg) translateY(-100%)";
    div.style.transformOrigin = "center bottom";
    div.style.background = "rgba(0,0,0,0.85)";
    div.style.color = "#fff";
    div.style.fontSize = "9px";
    div.style.fontWeight = "600";
    div.style.fontFamily = "Roboto, Arial, sans-serif";
    div.style.padding = "1px 4px";
    div.style.borderRadius = "2px";
    div.style.whiteSpace = "nowrap";
    div.style.border = "1px solid " + (this.color || "rgba(255,255,255,0.3)");
    div.style.pointerEvents = "none";
    div.style.zIndex = "51";
    div.textContent = this.text;
    this.div = div;
    this.getPanes().overlayMouseTarget.appendChild(div);
  };

  AirspaceLabelOverlay.prototype.draw = function () {
    var proj = this.getProjection();
    if (!proj) return;
    var px = proj.fromLatLngToDivPixel(this.position);
    if (!px) return;
    this.div.style.left = px.x + "px";
    this.div.style.top = px.y + "px";
  };

  AirspaceLabelOverlay.prototype.onRemove = function () {
    if (this.div && this.div.parentNode) {
      this.div.parentNode.removeChild(this.div);
      this.div = null;
    }
  };
}

// Get outer rings from a geometry
function getOuterRings(geom) {
  if (geom.type === "Polygon") return [geom.coordinates[0]];
  if (geom.type === "MultiPolygon") return geom.coordinates.map(function (p) { return p[0]; });
  return [];
}

// Compute label position ON the border with rotation so text rises into the polygon interior.
// Returns { lat, lng, angle } where angle rotates the label so its bottom edge
// sits on the border tangent and the text grows upward into the interior.
function borderLabelPosition(p1, p2, centroid) {
  var midLat = (p1[1] + p2[1]) / 2;
  var midLng = (p1[0] + p2[0]) / 2;

  // Edge tangent angle in screen space (note: lat=Y increases upward, lng=X increases right)
  var dx = p2[0] - p1[0]; // lng delta
  var dy = p2[1] - p1[1]; // lat delta
  var len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;

  // Tangent angle in degrees (screen coords: positive X right, positive Y down in CSS)
  // atan2(-dy, dx) because lat increases up but CSS Y increases down
  var tangentDeg = Math.atan2(-dy, dx) * 180 / Math.PI;

  // The inward normal is perpendicular to the tangent, pointing toward centroid.
  // Two candidate normals: tangent+90 and tangent-90
  // Check which side the centroid is on
  var nx1 = -dy / len; // normal candidate 1 (lat component)
  var ny1 = dx / len;  // normal candidate 1 (lng component)
  // Dot product of normal with (centroid - midpoint)
  var dot = nx1 * (centroid.lat - midLat) + ny1 * (centroid.lng - midLng);

  // We want the text to rise "upward" from the border into the interior.
  // In CSS, rotating by tangentDeg makes the text flow along the tangent.
  // The text's "up" (top of letters) points at tangentDeg - 90 in screen space.
  // We need that "up" direction to point inward.
  // If dot > 0, normal1 points inward, and we need text-up = normal1 direction.
  // text-up direction = tangentDeg - 90. If that matches inward normal, we're good.
  // Otherwise rotate by 180.

  var angle = tangentDeg;
  if (dot < 0) {
    angle += 180;
  }

  return { lat: midLat, lng: midLng, angle: angle };
}

// Find the best border segments for labels: visible, long enough, well-spaced
function pickBorderLabelPositions(geom, bounds, zoom) {
  var rings = getOuterRings(geom);
  if (rings.length === 0) return [];

  var centroid = computeCentroid(geom);
  if (!centroid) return [];

  var candidates = [];

  for (var r = 0; r < rings.length; r++) {
    var ring = rings[r];
    if (ring.length < 3) continue;

    for (var i = 0; i < ring.length - 1; i++) {
      var p1 = ring[i];
      var p2 = ring[i + 1];

      // Segment midpoint must be in viewport
      var midLat = (p1[1] + p2[1]) / 2;
      var midLng = (p1[0] + p2[0]) / 2;
      if (bounds && !bounds.contains(new google.maps.LatLng(midLat, midLng))) continue;

      // Segment length in degrees (proxy for screen length)
      var segLen = Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));

      var pos = borderLabelPosition(p1, p2, centroid);
      if (!pos) continue;

      candidates.push({ pos: pos, segLen: segLen });
    }
  }

  if (candidates.length === 0) return [];

  // Sort by segment length descending — prefer labels on longer edges
  candidates.sort(function (a, b) { return b.segLen - a.segLen; });

  // Pick up to 2 well-spaced labels
  var picked = [candidates[0]];
  if (candidates.length > 4) {
    // Pick one from the opposite side of the polygon
    var best = candidates[0];
    var furthest = null;
    var maxDist = 0;
    for (var i = 1; i < candidates.length; i++) {
      var d = Math.pow(candidates[i].pos.lat - best.pos.lat, 2) + Math.pow(candidates[i].pos.lng - best.pos.lng, 2);
      if (d > maxDist) { maxDist = d; furthest = candidates[i]; }
    }
    if (furthest) picked.push(furthest);
  }

  return picked.map(function (c) { return c.pos; });
}

function clearAirspaceLabels() {
  for (var i = 0; i < airspaceLabels.length; i++) {
    airspaceLabels[i].setMap(null);
  }
  airspaceLabels = [];
}

function addAirspaceLabels() {
  clearAirspaceLabels();

  var zoom = map ? map.getZoom() : 10;
  if (zoom < 6) return;

  var bounds = map.getBounds();
  var showBorderLabels = zoom >= 8;

  for (var i = 0; i < airspaceGeoData.length; i++) {
    var f = airspaceGeoData[i];
    var cls = f.properties.c || "";
    if (cls === "E" || cls === "A") continue;
    if (cls === "D" && zoom < 7) continue;
    if (cls === "C" && zoom < 6) continue;

    var lower = formatAlt(f.properties.l);
    var upper = formatAlt(f.properties.u);
    var color = AIRSPACE_STYLES[cls]?.stroke || "#aaa";

    // 1. Center label (blue text, class + name)
    var lowerNum = parseInt(f.properties.l) || 0;
    if (lowerNum === 0) {
      // Only label the surface ring at center to avoid clutter
      var center = computeCentroid(f.geometry);
      if (center && (!bounds || bounds.contains(new google.maps.LatLng(center.lat, center.lng)))) {
        var name = (f.properties.n || "").replace(/\s*CLASS\s+[A-E]\s*/i, "").trim();
        if (name.length > 20) name = name.substring(0, 18) + "…";
        var centerLabel = "Class " + cls + (name ? "\n" + name : "");
        var centerMarker = new google.maps.Marker({
          position: center,
          map: map,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0, labelOrigin: new google.maps.Point(0, 0) },
          label: { text: centerLabel, color: color, fontSize: "10px", fontWeight: "600" },
          zIndex: 49,
          clickable: false,
        });
        airspaceLabels.push(centerMarker);
      }
    }

    // 2. Border labels (black boxes with floor-ceiling, rotated along border)
    if (showBorderLabels) {
      var positions = pickBorderLabelPositions(f.geometry, bounds, zoom);
      var borderText = cls + ": " + lower + " - " + upper;

      for (var p = 0; p < positions.length; p++) {
        var pos = positions[p];
        var overlay = new AirspaceLabelOverlay(
          new google.maps.LatLng(pos.lat, pos.lng),
          borderText,
          pos.angle,
          color
        );
        overlay.setMap(map);
        airspaceLabels.push(overlay);
      }
    }
  }
}

function refreshAirspaceForZoom() {
  if (!airspaceVisible) return;
  map.data.setStyle(airspaceStyleFn);
  addAirspaceLabels();
}

// Point-in-polygon test for a simple polygon ring
function pointInRing(lat, lng, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][1], yi = ring[i][0];
    var xj = ring[j][1], yj = ring[j][0];
    if (((yi > lng) !== (yj > lng)) &&
        (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(lat, lng, geom) {
  if (!geom || !geom.coordinates) return false;
  if (geom.type === "Polygon") {
    // First ring is outer boundary, subsequent rings are holes
    if (!pointInRing(lat, lng, geom.coordinates[0])) return false;
    for (var h = 1; h < geom.coordinates.length; h++) {
      if (pointInRing(lat, lng, geom.coordinates[h])) return false; // in a hole
    }
    return true;
  } else if (geom.type === "MultiPolygon") {
    for (var i = 0; i < geom.coordinates.length; i++) {
      var poly = geom.coordinates[i];
      if (pointInRing(lat, lng, poly[0])) {
        var inHole = false;
        for (var h = 1; h < poly.length; h++) {
          if (pointInRing(lat, lng, poly[h])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
    }
  }
  return false;
}

function findAirspacesAtPoint(lat, lng) {
  var results = [];
  for (var i = 0; i < airspaceGeoData.length; i++) {
    var f = airspaceGeoData[i];
    if (pointInGeometry(lat, lng, f.geometry)) {
      results.push(f.properties);
    }
  }
  return results;
}

function buildCrossSectionHTML(airspaces, lat, lng) {
  // Filter to ones with altitude data and not Class E
  var layers = [];
  for (var i = 0; i < airspaces.length; i++) {
    var a = airspaces[i];
    var cls = a.c || "";
    if (cls === "E") continue;
    var lower = parseInt(a.l) || 0;
    var upper = parseInt(a.u) || 0;
    if (lower < 0) lower = 0;
    if (upper <= 0 || upper === -9998) upper = 18000;
    if (upper > 18000) upper = 18000;
    layers.push({ name: a.n || a.t || "?", cls: cls, type: a.t || "", lower: lower, upper: upper });
  }

  if (layers.length === 0) {
    return '<div style="color:#333;font-size:13px;padding:4px;">No controlled airspace at this point</div>';
  }

  // Sort by lower altitude
  layers.sort(function (a, b) { return a.lower - b.lower; });

  // Find max altitude for scale
  var maxAlt = 0;
  for (var i = 0; i < layers.length; i++) {
    if (layers[i].upper > maxAlt) maxAlt = layers[i].upper;
  }
  maxAlt = Math.max(maxAlt, 5000);

  var chartH = 180;
  var chartW = 160;
  var leftPad = 45;

  var html = '<div style="color:#333;font-size:12px;min-width:220px;">' +
    '<strong>Airspace Cross Section</strong>' +
    '<div style="color:#999;font-size:10px;margin-bottom:6px;">' +
    lat.toFixed(4) + ', ' + lng.toFixed(4) + '</div>' +
    '<div style="position:relative;height:' + chartH + 'px;width:' + (leftPad + chartW) + 'px;margin-bottom:8px;">';

  // Y-axis labels
  var altSteps = [0];
  for (var a = 1000; a <= maxAlt; a += 1000) altSteps.push(a);
  if (altSteps[altSteps.length - 1] < maxAlt) altSteps.push(maxAlt);

  for (var i = 0; i < altSteps.length; i++) {
    var y = chartH - (altSteps[i] / maxAlt) * chartH;
    html += '<div style="position:absolute;left:0;top:' + y + 'px;font-size:9px;color:#999;transform:translateY(-50%);">' +
      formatAlt(altSteps[i]) + '</div>';
    html += '<div style="position:absolute;left:' + leftPad + 'px;right:0;top:' + y + 'px;border-top:1px solid #eee;width:' + chartW + 'px;"></div>';
  }

  // Draw airspace blocks
  var colors = { A: "#78909C", B: "#2196F3", C: "#9C27B0", D: "#42A5F5" };
  var blockWidth = Math.max(30, Math.floor(chartW / Math.max(layers.length, 1)) - 4);
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    var yTop = chartH - (l.upper / maxAlt) * chartH;
    var yBot = chartH - (l.lower / maxAlt) * chartH;
    var h = yBot - yTop;
    if (h < 2) h = 2;
    var x = leftPad + 4 + i * (blockWidth + 4);
    var color = colors[l.cls] || "#9E9E9E";

    html += '<div style="position:absolute;left:' + x + 'px;top:' + yTop + 'px;width:' + blockWidth + 'px;height:' + h + 'px;' +
      'background:' + color + ';opacity:0.6;border:1px solid ' + color + ';border-radius:2px;' +
      'display:flex;align-items:center;justify-content:center;overflow:hidden;">' +
      '<span style="font-size:8px;color:#fff;font-weight:600;white-space:nowrap;">' + l.cls + '</span></div>';
  }

  html += '</div>';

  // Legend
  html += '<table style="font-size:11px;border-collapse:collapse;width:100%;">';
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    var color = colors[l.cls] || "#9E9E9E";
    html += '<tr>' +
      '<td style="padding:1px 4px;"><span style="display:inline-block;width:8px;height:8px;background:' + color + ';border-radius:1px;"></span></td>' +
      '<td style="padding:1px 4px;font-weight:600;">Class ' + l.cls + '</td>' +
      '<td style="padding:1px 4px;color:#666;">' + formatAlt(l.lower) + ' – ' + formatAlt(l.upper) + '</td>' +
      '</tr>';
  }
  html += '</table>';

  // Name
  var names = [];
  var seenNames = {};
  for (var i = 0; i < layers.length; i++) {
    if (!seenNames[layers[i].name]) {
      names.push(layers[i].name);
      seenNames[layers[i].name] = true;
    }
  }
  html += '<div style="color:#999;font-size:10px;margin-top:4px;">' + names.join(", ") + '</div>';
  html += '</div>';
  return html;
}

function toggleAirspace() {
  if (airspaceVisible) {
    if (airspaceLayer) {
      airspaceLayer.forEach(function (f) { map.data.remove(f); });
      airspaceLayer = null;
    }
    clearAirspaceLabels();
    airspaceGeoData = [];
    // Remove listeners
    if (window._airspaceClickListener) {
      google.maps.event.removeListener(window._airspaceClickListener);
      window._airspaceClickListener = null;
    }
    if (window._airspaceZoomListener) {
      google.maps.event.removeListener(window._airspaceZoomListener);
      window._airspaceZoomListener = null;
    }
    airspaceVisible = false;
  } else {
    if (!airspaceLayer) {
      airspaceLayer = [];
      airspaceGeoData = [];
      var loaded = 0;
      AIRSPACE_FILES.forEach(function (file) {
        fetch(file)
          .then(function (r) { return r.json(); })
          .then(function (geojson) {
            // Filter out Class E before adding to map
            var filtered = {
              type: "FeatureCollection",
              features: geojson.features.filter(function (f) {
                return f.properties.c !== "E";
              }),
            };
            var features = map.data.addGeoJson(filtered);
            airspaceLayer = airspaceLayer.concat(features);
            // Store all features (including E) for cross-section queries
            airspaceGeoData = airspaceGeoData.concat(geojson.features);
            loaded++;
            if (loaded === AIRSPACE_FILES.length) {
              map.data.setStyle(airspaceStyleFn);
              addAirspaceLabels();
            }
          })
          .catch(function (e) {
            console.warn("Failed to load " + file + ":", e);
            loaded++;
          });
      });

      // Refresh on zoom/pan changes
      window._airspaceZoomListener = map.addListener("idle", refreshAirspaceForZoom);

      // Add click listener for cross-section popup
      if (!window._airspaceInfoWindow) {
        window._airspaceInfoWindow = new google.maps.InfoWindow();
      }
      window._airspaceClickListener = map.addListener("rightclick", function (e) {
        if (!airspaceVisible) return;
        var lat = e.latLng.lat();
        var lng = e.latLng.lng();
        var airspaces = findAirspacesAtPoint(lat, lng);
        var html = buildCrossSectionHTML(airspaces, lat, lng);
        window._airspaceInfoWindow.setContent(html);
        window._airspaceInfoWindow.setPosition(e.latLng);
        window._airspaceInfoWindow.open(map);
      });

      airspaceVisible = true;
      document.getElementById("airspace-toggle").classList.add("active");
      return;
    }
    airspaceLayer.forEach(function (f) { map.data.add(f); });
    map.data.setStyle(airspaceStyleFn);
    addAirspaceLabels();
    airspaceVisible = true;
  }
  var btn = document.getElementById("airspace-toggle");
  if (btn) btn.classList.toggle("active", airspaceVisible);
}

function addFlightPolyline(flightId, trackPoints, color, flightInfo) {
  if (polylines[flightId]) return; // already added

  const path = trackPoints.map((pt) => ({
    lat: pt.latitude,
    lng: pt.longitude,
  }));

  if (path.length === 0) return;

  const polyline = new google.maps.Polyline({
    path: path,
    strokeColor: color,
    strokeOpacity: 0.8,
    strokeWeight: 3,
    map: map,
  });

  polyline.addListener("click", (e) => {
    const origin = flightInfo.origin_icao || "?";
    const dest = flightInfo.dest_icao || "?";
    const date = flightInfo.departure_time
      ? new Date(flightInfo.departure_time * 1000).toLocaleDateString()
      : "Unknown";
    const dur = flightInfo.duration_seconds
      ? (flightInfo.duration_seconds / 3600).toFixed(1) + " hrs"
      : "?";

    infoWindow.ref.setContent(
      '<div style="color:#333;font-size:13px;">' +
        "<strong>" + origin + " → " + dest + "</strong><br>" +
        date + " | " + dur +
        "</div>"
    );
    infoWindow.ref.setPosition(e.latLng);
    infoWindow.ref.open(map);
  });

  polyline.addListener("mouseover", () => {
    polyline.setOptions({ strokeOpacity: 1, strokeWeight: 5 });
  });

  polyline.addListener("mouseout", () => {
    if (_highlightedFlight && _highlightedFlight !== flightId) {
      polyline.setOptions({ strokeOpacity: 0.3, strokeWeight: 3 });
    } else if (_highlightedFlight === flightId) {
      polyline.setOptions({ strokeOpacity: 1, strokeWeight: 3 });
    } else {
      polyline.setOptions({ strokeOpacity: 0.8, strokeWeight: 3 });
    }
  });

  polylines[flightId] = polyline;
}

function removeFlightPolyline(flightId) {
  if (polylines[flightId]) {
    polylines[flightId].setMap(null);
    delete polylines[flightId];
  }
}

function setFlightVisible(flightId, visible) {
  if (polylines[flightId]) {
    polylines[flightId].setMap(visible ? map : null);
  }
}

function setPlaneFlightsVisible(flightIds, visible) {
  for (const id of flightIds) {
    setFlightVisible(id, visible);
  }
}

var _highlightedFlight = null;

function highlightFlight(flightId) {
  unhighlightFlight();
  _highlightedFlight = flightId;

  for (var id in polylines) {
    if (id !== flightId) {
      polylines[id].setOptions({ strokeOpacity: 0.3 });
    }
  }
  if (polylines[flightId]) {
    polylines[flightId].setOptions({ strokeOpacity: 1 });
  }
}

function unhighlightFlight() {
  if (!_highlightedFlight) return;
  for (var id in polylines) {
    polylines[id].setOptions({ strokeOpacity: 0.8 });
  }
  _highlightedFlight = null;
}

function zoomToFlight(flightId) {
  const poly = polylines[flightId];
  if (!poly) return;
  highlightFlight(flightId);
  const bounds = new google.maps.LatLngBounds();
  poly.getPath().forEach((pt) => bounds.extend(pt));
  map.fitBounds(bounds, { padding: 80 });
}

function fitMapToPolylines() {
  const bounds = new google.maps.LatLngBounds();
  let hasPoints = false;

  for (const id of Object.keys(polylines)) {
    const poly = polylines[id];
    if (poly.getMap()) {
      poly.getPath().forEach((pt) => {
        bounds.extend(pt);
        hasPoints = true;
      });
    }
  }

  if (hasPoints) {
    map.fitBounds(bounds, { padding: 50 });
  }
}
