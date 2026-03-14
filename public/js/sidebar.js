const state = {
  planes: {},        // tail -> { visible: bool, flights: [...], color: string }
  flightVisible: {}, // flightId -> bool
  loadedTracks: {},  // flightId -> trackPoints[]
};

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return h + "h " + m + "m";
  return m + "m";
}

function formatDate(timestamp) {
  if (!timestamp) return "--";
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateTime(timestamp) {
  if (!timestamp) return "--";
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderPlaneCard(plane, planeStat, flights) {
  const container = document.getElementById("plane-list");

  state.planes[plane.tail_number] = {
    visible: true,
    flights: flights,
    color: plane.color,
  };

  const card = document.createElement("div");
  card.className = "plane-card expanded";
  card.style.borderLeftColor = plane.color;
  card.dataset.tail = plane.tail_number;

  const totalFlights = planeStat ? planeStat.total_flights : 0;
  const totalHours = planeStat ? planeStat.total_hours : 0;
  const uniqueAirports = planeStat ? planeStat.unique_airports : 0;

  card.innerHTML =
    '<div class="plane-header">' +
      '<span class="expand-arrow">&#9654;</span>' +
      '<span class="color-dot" style="background:' + plane.color + '"></span>' +
      '<span class="tail-number">' + plane.tail_number + "</span>" +
      '<span class="flight-count">' + totalFlights + " flights</span>" +
      '<label class="toggle" onclick="event.stopPropagation()">' +
        '<input type="checkbox" checked onchange="togglePlane(\'' + plane.tail_number + '\', this.checked)">' +
        '<span class="slider"></span>' +
      "</label>" +
    "</div>" +
    '<div class="plane-stats">' +
      '<span class="stat">Hours: <span class="stat-value">' + totalHours + "</span></span>" +
      '<span class="stat">Airports: <span class="stat-value">' + uniqueAirports + "</span></span>" +
      '<span class="stat">Last: <span class="stat-value">' + formatDate(planeStat?.last_flight) + "</span></span>" +
    "</div>" +
    '<div class="flight-list">' +
      flights
        .map(function (f) {
          const origin = f.origin_icao || "?";
          const dest = f.dest_icao || "?";
          state.flightVisible[f.id] = true;

          return (
            '<div class="flight-item" data-flight-id="' + f.id + '">' +
              '<div class="flight-info">' +
                '<div class="flight-route">' + origin + " → " + dest + "</div>" +
                '<div class="flight-meta">' +
                  formatDateTime(f.departure_time) +
                  " | " +
                  formatDuration(f.duration_seconds) +
                "</div>" +
              "</div>" +
              '<div class="flight-toggle">' +
                '<label class="toggle">' +
                  '<input type="checkbox" checked onchange="toggleFlight(\'' +
                  f.id + "', '" + plane.tail_number +
                  "', this.checked)\">" +
                  '<span class="slider"></span>' +
                "</label>" +
              "</div>" +
            "</div>"
          );
        })
        .join("") +
    "</div>";

  // Toggle expand/collapse on header click
  card.querySelector(".plane-header").addEventListener("click", function () {
    card.classList.toggle("expanded");
  });

  container.appendChild(card);
}

function togglePlane(tail, visible) {
  const planeState = state.planes[tail];
  if (!planeState) return;
  planeState.visible = visible;

  const flightIds = planeState.flights.map(function (f) { return f.id; });
  setPlaneFlightsVisible(flightIds, visible);

  // Update flight toggles UI
  const card = document.querySelector('.plane-card[data-tail="' + tail + '"]');
  if (card) {
    var checkboxes = card.querySelectorAll(".flight-toggle input");
    checkboxes.forEach(function (cb) {
      cb.checked = visible;
    });
  }

  for (const id of flightIds) {
    state.flightVisible[id] = visible;
  }
}

async function toggleFlight(flightId, tail, visible) {
  state.flightVisible[flightId] = visible;

  if (visible && !state.loadedTracks[flightId]) {
    // Need to load track data first
    const track = await API.getTrack(flightId);
    state.loadedTracks[flightId] = track;
    const planeState = state.planes[tail];
    const flight = planeState.flights.find(function (f) { return f.id === flightId; });
    if (track.length > 0 && flight) {
      addFlightPolyline(flightId, track, planeState.color, flight);
    }
  }

  setFlightVisible(flightId, visible);
}
