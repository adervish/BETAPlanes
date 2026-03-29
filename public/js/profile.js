// Fix doubled altitude values (e.g. 33753375 → 3375)
function fixAltitude(val) {
  if (!val || val <= 0) return 0;
  var s = String(val);
  if (s.length >= 4 && s.length % 2 === 0) {
    var half = s.length / 2;
    if (s.substring(0, half) === s.substring(half)) {
      return parseInt(s.substring(0, half));
    }
  }
  return val;
}

// Shared state for profile chart + playback
var profileState = null;
var playbackAnim = null;

function ensureProfileMarker() {
  if (!window._profileMarker) {
    window._profileMarker = new google.maps.Marker({
      map: map,
      icon: {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 5,
        fillColor: "#ffffff",
        fillOpacity: 1,
        strokeColor: "#000000",
        strokeWeight: 1.5,
        rotation: 0,
      },
      zIndex: 9999,
    });
  }
  return window._profileMarker;
}

function getHeading(track, idx) {
  var heading = track[idx].heading || 0;
  if (!heading && idx < track.length - 1) {
    var pt = track[idx];
    var next = track[idx + 1];
    heading = Math.atan2(next.longitude - pt.longitude, next.latitude - pt.latitude) * 180 / Math.PI;
  }
  return heading;
}

function moveMarkerToIndex(marker, track, idx) {
  var pt = track[idx];
  marker.setPosition({ lat: pt.latitude, lng: pt.longitude });
  marker.setIcon(Object.assign({}, marker.getIcon(), { rotation: getHeading(track, idx) }));
  marker.setVisible(true);
}

function drawProfileScrubber(idx) {
  var ps = profileState;
  if (!ps) return;

  var canvas = document.getElementById("profile-canvas");
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;

  // Restore the saved chart image
  ctx.putImageData(ps.chartImage, 0, 0);

  // Draw vertical scrubber line
  var x = ps.leftPad + (idx / (ps.n - 1)) * ps.chartW;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, ps.topPad);
  ctx.lineTo(x, ps.topPad + ps.chartH);
  ctx.stroke();

  // Draw dot on altitude line
  var yA = ps.topPad + ps.chartH - (ps.altitudes[idx] / ps.maxAlt) * ps.chartH;
  ctx.beginPath();
  ctx.arc(x, yA, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#3498db";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw dot on speed line
  var yS = ps.topPad + ps.chartH - (ps.speeds[idx] / ps.maxSpd) * ps.chartH;
  ctx.beginPath();
  ctx.arc(x, yS, 4, 0, Math.PI * 2);
  ctx.fillStyle = ps.color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function showFlightProfile(track, flight, color) {
  stopPlayback();

  var overlay = document.getElementById("flight-profile");
  overlay.style.display = "flex";

  var origin = (flight && flight.origin_icao) || "?";
  var dest = (flight && flight.dest_icao) || "?";
  var date = flight && flight.departure_time
    ? new Date(flight.departure_time * 1000).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric"
      })
    : "";
  var dur = flight && flight.duration_seconds
    ? Math.floor(flight.duration_seconds / 3600) + "h " +
      Math.floor((flight.duration_seconds % 3600) / 60) + "m"
    : "";

  document.getElementById("profile-title").textContent =
    origin + " → " + dest + "  " + date + (dur ? "  (" + dur + ")" : "");

  var canvas = document.getElementById("profile-canvas");
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  var w = rect.width;
  var h = rect.height;

  var altitudes = [];
  var speeds = [];
  var n = track.length;
  for (var i = 0; i < n; i++) {
    altitudes.push(fixAltitude(track[i].altitude_ft));
    speeds.push(track[i].groundspeed_kts || 0);
  }

  var maxAlt = Math.max.apply(null, altitudes);
  var maxSpd = Math.max.apply(null, speeds);
  if (maxAlt === 0) maxAlt = 1;
  if (maxSpd === 0) maxSpd = 1;

  var totalMin = flight && flight.duration_seconds
    ? flight.duration_seconds / 60
    : n;

  var leftPad = 52;
  var rightPad = 52;
  var topPad = 12;
  var bottomPad = 32;
  var chartW = w - leftPad - rightPad;
  var chartH = h - topPad - bottomPad;

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (var g = 0; g <= 4; g++) {
    var gy = topPad + (chartH / 4) * g;
    ctx.beginPath();
    ctx.moveTo(leftPad, gy);
    ctx.lineTo(leftPad + chartW, gy);
    ctx.stroke();
  }

  function xPos(idx) {
    return leftPad + (idx / (n - 1)) * chartW;
  }
  function yAlt(idx) {
    return topPad + chartH - (altitudes[idx] / maxAlt) * chartH;
  }
  function ySpd(idx) {
    return topPad + chartH - (speeds[idx] / maxSpd) * chartH;
  }

  // Altitude fill
  ctx.beginPath();
  ctx.moveTo(xPos(0), topPad + chartH);
  for (var i = 0; i < n; i++) ctx.lineTo(xPos(i), yAlt(i));
  ctx.lineTo(xPos(n - 1), topPad + chartH);
  ctx.closePath();
  var altGrad = ctx.createLinearGradient(0, topPad, 0, topPad + chartH);
  altGrad.addColorStop(0, "rgba(52, 152, 219, 0.3)");
  altGrad.addColorStop(1, "rgba(52, 152, 219, 0.02)");
  ctx.fillStyle = altGrad;
  ctx.fill();

  // Altitude line
  ctx.beginPath();
  for (var i = 0; i < n; i++) {
    if (i === 0) ctx.moveTo(xPos(i), yAlt(i));
    else ctx.lineTo(xPos(i), yAlt(i));
  }
  ctx.strokeStyle = "#3498db";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Speed line
  ctx.beginPath();
  for (var i = 0; i < n; i++) {
    if (i === 0) ctx.moveTo(xPos(i), ySpd(i));
    else ctx.lineTo(xPos(i), ySpd(i));
  }
  ctx.strokeStyle = color || "#e94560";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Y-axis labels
  ctx.fillStyle = "#3498db";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(Math.round(maxAlt).toLocaleString() + " ft", leftPad - 6, topPad + 10);
  ctx.fillText("0", leftPad - 6, topPad + chartH + 4);
  ctx.fillText("Altitude", leftPad - 6, topPad + chartH / 2 + 4);

  ctx.fillStyle = color || "#e94560";
  ctx.textAlign = "left";
  ctx.fillText(Math.round(maxSpd) + " kts", leftPad + chartW + 6, topPad + 10);
  ctx.fillText("0", leftPad + chartW + 6, topPad + chartH + 4);
  ctx.fillText("Speed", leftPad + chartW + 6, topPad + chartH / 2 + 4);

  // X-axis labels
  ctx.fillStyle = "#8899aa";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  var numLabels = Math.min(6, Math.max(2, Math.floor(totalMin / 5)));
  for (var i = 0; i <= numLabels; i++) {
    var t = (totalMin / numLabels) * i;
    var lx = leftPad + (i / numLabels) * chartW;
    var mins = Math.round(t);
    var label = mins < 60 ? mins + "m" : Math.floor(mins / 60) + "h" + (mins % 60 ? String(mins % 60).padStart(2, "0") + "m" : "");
    ctx.fillText(label, lx, topPad + chartH + 20);
  }

  // Save chart image for scrubber overlay
  var chartImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Store profile state
  profileState = {
    track: track, flight: flight, color: color || "#e94560",
    altitudes: altitudes, speeds: speeds, n: n,
    maxAlt: maxAlt, maxSpd: maxSpd, totalMin: totalMin,
    leftPad: leftPad, rightPad: rightPad, topPad: topPad,
    bottomPad: bottomPad, chartW: chartW, chartH: chartH,
    chartImage: chartImage,
  };

  var marker = ensureProfileMarker();
  marker.setMap(map);
  marker.setVisible(false);

  // Hover interaction
  canvas.onmousemove = function (e) {
    if (playbackAnim) return; // don't interfere with playback
    var cRect = canvas.getBoundingClientRect();
    var mx = e.clientX - cRect.left;
    var relX = (mx - leftPad) / chartW;
    if (relX < 0 || relX > 1) {
      canvas.title = "";
      marker.setVisible(false);
      ctx.putImageData(chartImage, 0, 0);
      return;
    }
    var idx = Math.round(relX * (n - 1));
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    var estMin = Math.round(relX * totalMin);
    canvas.title = estMin + " min — " +
      Math.round(altitudes[idx]).toLocaleString() + " ft, " +
      Math.round(speeds[idx]) + " kts";

    moveMarkerToIndex(marker, track, idx);
    drawProfileScrubber(idx);
  };

  canvas.onmouseleave = function () {
    if (playbackAnim) return;
    marker.setVisible(false);
    ctx.putImageData(chartImage, 0, 0);
  };
}

// Playback animation
function playFlight(flightId, tail) {
  var track = state.loadedTracks[flightId];
  if (!track || track.length < 2) return;

  var planeState = state.planes[tail];
  var flight = planeState.flights.find(function (f) { return f.id === flightId; });
  var color = planeState.color;

  // Open profile and zoom to flight
  zoomToFlight(flightId);
  showFlightProfile(track, flight, color);

  var marker = ensureProfileMarker();
  marker.setMap(map);

  var n = track.length;
  // Total real duration in ms; play at 10x speed
  var realDurationMs = (flight && flight.duration_seconds)
    ? flight.duration_seconds * 1000
    : n * 1000; // fallback: 1 sec per point
  var playDurationMs = realDurationMs / 50;
  // Clamp to reasonable range: min 2s, max 60s
  if (playDurationMs < 2000) playDurationMs = 2000;
  if (playDurationMs > 60000) playDurationMs = 60000;

  var startTime = performance.now();

  // Update play button to show stop
  var btn = document.querySelector('.play-btn[data-flight="' + flightId + '"]');
  if (btn) {
    btn.textContent = "■";
    btn.classList.add("playing");
  }

  function animate(now) {
    var elapsed = now - startTime;
    var progress = elapsed / playDurationMs;
    if (progress >= 1) {
      progress = 1;
    }

    var idx = Math.round(progress * (n - 1));
    if (idx >= n) idx = n - 1;

    moveMarkerToIndex(marker, track, idx);
    drawProfileScrubber(idx);

    if (progress < 1) {
      playbackAnim = requestAnimationFrame(animate);
    } else {
      // Done
      playbackAnim = null;
      marker.setVisible(false);
      if (profileState) {
        var canvas = document.getElementById("profile-canvas");
        canvas.getContext("2d").putImageData(profileState.chartImage, 0, 0);
      }
      if (btn) {
        btn.textContent = "▶";
        btn.classList.remove("playing");
      }
    }
  }

  playbackAnim = requestAnimationFrame(animate);
}

function stopPlayback() {
  if (playbackAnim) {
    cancelAnimationFrame(playbackAnim);
    playbackAnim = null;
  }
  var marker = window._profileMarker;
  if (marker) marker.setVisible(false);
  // Reset any playing buttons
  var playing = document.querySelector(".play-btn.playing");
  if (playing) {
    playing.textContent = "▶";
    playing.classList.remove("playing");
  }
  if (profileState) {
    var canvas = document.getElementById("profile-canvas");
    var ctx = canvas.getContext("2d");
    ctx.putImageData(profileState.chartImage, 0, 0);
  }
}

function togglePlayback(flightId, tail) {
  if (playbackAnim) {
    stopPlayback();
  } else {
    playFlight(flightId, tail);
  }
}

function hideFlightProfile() {
  stopPlayback();
  unhighlightFlight();
  document.getElementById("flight-profile").style.display = "none";
  if (window._profileMarker) window._profileMarker.setVisible(false);
  profileState = null;
}
