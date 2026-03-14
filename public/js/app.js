async function initApp() {
  initMap();

  const planeList = document.getElementById("plane-list");
  planeList.innerHTML = '<div class="loading">Loading flight data...</div>';

  try {
    const [planes, stats] = await Promise.all([
      API.getPlanes(),
      API.getStats(),
    ]);

    planeList.innerHTML = "";

    for (const plane of planes) {
      const planeStat = stats.find(function (s) {
        return s.tail_number === plane.tail_number;
      });
      const flights = await API.getFlights(plane.tail_number);

      renderPlaneCard(plane, planeStat, flights);

      // Load tracks for all flights and add polylines
      for (const flight of flights) {
        const track = await API.getTrack(flight.id);
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
