// Check if URL path specifies a specific tail number (e.g. /N521SS)
function getTargetTail() {
  var path = window.location.pathname;
  var match = path.match(/^\/(N[A-Z0-9]+)$/);
  return match ? match[1] : null;
}

async function initApp() {
  initMap();

  var targetTail = getTargetTail();
  var planeList = document.getElementById("plane-list");
  planeList.innerHTML = '<div class="loading">Loading flight data...</div>';

  // Update header if viewing a specific plane
  if (targetTail) {
    document.querySelector(".sidebar-header h1").textContent = targetTail;
    document.querySelector(".sidebar-header .subtitle").textContent = "Flight Tracker";
    document.title = targetTail + " - Flight Tracker";
  }

  try {
    // Fetch plane list and daily stats in parallel
    var [planes, daily] = await Promise.all([
      API.getPlanes(targetTail),
      API.getDailyStats(targetTail),
    ]);

    renderDailyChart(daily);
    planeList.innerHTML = "";

    // Fetch all plane data in parallel
    var planeDataPromises = planes.map(function (plane) {
      return API.getPlaneFlights(plane.tail_number);
    });
    var allPlaneData = await Promise.all(planeDataPromises);

    for (var i = 0; i < planes.length; i++) {
      var data = allPlaneData[i];
      renderPlaneCard(data.plane, data.stats, data.flights);

      for (var flight of data.flights) {
        state.loadedTracks[flight.id] = flight.track;
        if (flight.track.length > 0) {
          addFlightPolyline(flight.id, flight.track, data.plane.color, flight);
        }
      }
    }

    fitMapToPolylines();
    toggleAirspace();
    initFeatureLayers();
  } catch (err) {
    planeList.innerHTML =
      '<div class="loading">Error loading data: ' + err.message + "</div>";
    console.error(err);
  }
}
