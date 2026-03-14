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
    var [planes, stats, daily] = await Promise.all([
      API.getPlanes(targetTail),
      API.getStats(targetTail),
      API.getDailyStats(targetTail),
    ]);

    renderDailyChart(daily);
    planeList.innerHTML = "";

    for (var plane of planes) {
      var planeStat = stats.find(function (s) {
        return s.tail_number === plane.tail_number;
      });
      var flights = await API.getFlights(plane.tail_number);

      renderPlaneCard(plane, planeStat, flights);

      for (var flight of flights) {
        var track = await API.getTrack(flight.id);
        state.loadedTracks[flight.id] = track;
        if (track.length > 0) {
          addFlightPolyline(flight.id, track, plane.color, flight);
        }
      }
    }

    fitMapToPolylines();
  } catch (err) {
    planeList.innerHTML =
      '<div class="loading">Error loading data: ' + err.message + "</div>";
    console.error(err);
  }
}
