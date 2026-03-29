let map;
const polylines = {};    // flightId -> google.maps.Polyline
const infoWindow = new (function() { this.ref = null; })(); // lazy init

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 28.4, lng: -81.5 }, // Central Florida
    zoom: 8,
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
    polyline.setOptions({ strokeOpacity: 0.8, strokeWeight: 3 });
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

function zoomToFlight(flightId) {
  const poly = polylines[flightId];
  if (!poly) return;
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
