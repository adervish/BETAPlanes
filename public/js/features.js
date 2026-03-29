// FAA feature layer system — loads point data from /api/features based on zoom/bounds
var featureLayers = {};   // layerName -> { enabled, markers: [] }
var featureConfig = null;  // from /api/features/config
var featureDebounceTimer = null;
var lastFeatureBounds = null;

// Marker style definitions
var FEATURE_STYLES = {
  airport: {
    icon: function (f) {
      var tier = f.tier || 3;
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: tier === 1 ? 6 : tier === 2 ? 4 : 3,
        fillColor: tier === 1 ? "#ff6b6b" : "#ff9f43",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: tier === 1 ? 1.5 : 0.5,
      };
    },
    title: function (f) { return (f.icao_id || f.ident) + " — " + (f.name || ""); },
  },
  navaid: {
    icon: function (f) {
      return {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 4,
        fillColor: "#00d2d3",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: 0.5,
        rotation: 0,
      };
    },
    title: function (f) { return f.ident + " (" + (f["class"] || "NAVAID") + ") — " + (f.name || ""); },
  },
  waypoint: {
    icon: function () {
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 2,
        fillColor: "#a29bfe",
        fillOpacity: 0.7,
        strokeWeight: 0,
      };
    },
    title: function (f) { return f.ident; },
  },
  obstacle: {
    icon: function (f) {
      var agl = f.agl || 0;
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: agl >= 500 ? 5 : agl >= 200 ? 3 : 2,
        fillColor: agl >= 500 ? "#ff4757" : "#ffa502",
        fillOpacity: 0.8,
        strokeColor: "#fff",
        strokeWeight: agl >= 500 ? 1 : 0.5,
      };
    },
    title: function (f) {
      return (f.type_code || "OBS") + " — " + (f.agl || "?") + "ft AGL / " + (f.amsl || "?") + "ft AMSL";
    },
  },
  ils: {
    icon: function () {
      return {
        path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
        scale: 4,
        fillColor: "#2ed573",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: 0.5,
        rotation: 0,
      };
    },
    title: function (f) {
      return "ILS " + (f.ident || "") + " — " + (f.airport_id || "") + " RWY " + (f.runway || "");
    },
  },
};

async function initFeatureLayers() {
  var res = await fetch("/api/features/config");
  featureConfig = await res.json();

  for (var name in featureConfig) {
    featureLayers[name] = { enabled: false, markers: [] };
  }

  // Listen to map events
  map.addListener("idle", onMapIdle);
}

function onMapIdle() {
  clearTimeout(featureDebounceTimer);
  featureDebounceTimer = setTimeout(loadVisibleFeatures, 200);
}

function loadVisibleFeatures() {
  var enabledLayers = [];
  for (var name in featureLayers) {
    if (featureLayers[name].enabled) enabledLayers.push(name);
  }
  if (enabledLayers.length === 0) return;

  var bounds = map.getBounds();
  if (!bounds) return;
  var ne = bounds.getNorthEast();
  var sw = bounds.getSouthWest();
  var zoom = map.getZoom();

  var boundsStr = sw.lat() + "," + sw.lng() + "," + ne.lat() + "," + ne.lng();

  // Skip if bounds haven't changed much
  if (lastFeatureBounds === boundsStr) return;
  lastFeatureBounds = boundsStr;

  var url = "/api/features?layers=" + enabledLayers.join(",") +
    "&zoom=" + zoom + "&bounds=" + boundsStr;

  fetch(url)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      for (var name in data) {
        renderFeatureLayer(name, data[name]);
      }
    })
    .catch(function (e) { console.error("Feature load error:", e); });
}

function renderFeatureLayer(name, features) {
  var layer = featureLayers[name];
  if (!layer) return;

  // Clear existing markers
  for (var i = 0; i < layer.markers.length; i++) {
    layer.markers[i].setMap(null);
  }
  layer.markers = [];

  if (!layer.enabled || !features || features.length === 0) return;

  var styleDef = FEATURE_STYLES[featureConfig[name]?.style] || FEATURE_STYLES.waypoint;

  for (var i = 0; i < features.length; i++) {
    var f = features[i];
    if (f.latitude == null || f.longitude == null) continue;

    var marker = new google.maps.Marker({
      position: { lat: f.latitude, lng: f.longitude },
      map: map,
      icon: styleDef.icon(f),
      title: styleDef.title(f),
      zIndex: 100,
    });
    layer.markers.push(marker);
  }
}

function toggleFeatureLayer(name) {
  var layer = featureLayers[name];
  if (!layer) return;

  layer.enabled = !layer.enabled;
  var btn = document.getElementById("feat-" + name);
  if (btn) btn.classList.toggle("active", layer.enabled);

  if (!layer.enabled) {
    // Clear markers
    for (var i = 0; i < layer.markers.length; i++) {
      layer.markers[i].setMap(null);
    }
    layer.markers = [];
    return;
  }

  // Force reload
  lastFeatureBounds = null;
  loadVisibleFeatures();
}
