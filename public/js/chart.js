function renderDailyChart(dailyData) {
  var container = document.getElementById("daily-chart");

  // Add title
  var title = document.createElement("div");
  title.className = "chart-title";
  title.textContent = "Flight Hours by Day";
  container.insertBefore(title, container.firstChild);

  var canvas = document.getElementById("daily-canvas");
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  var w = rect.width;
  var h = rect.height;

  if (!dailyData || dailyData.length === 0) {
    ctx.fillStyle = "#667788";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No flight data", w / 2, h / 2);
    return;
  }

  var maxHours = Math.max.apply(null, dailyData.map(function (d) { return d.hours; }));
  if (maxHours === 0) maxHours = 1;

  var barCount = dailyData.length;
  var gap = 3;
  var barWidth = Math.max(4, (w - 30) / barCount - gap);
  var chartLeft = 28;
  var chartBottom = h - 18;
  var chartTop = 4;
  var chartHeight = chartBottom - chartTop;

  // Y-axis labels
  ctx.fillStyle = "#667788";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(maxHours.toFixed(1) + "h", chartLeft - 4, chartTop + 8);
  ctx.fillText("0", chartLeft - 4, chartBottom);

  // Grid line
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartTop);
  ctx.lineTo(w, chartTop);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartBottom);
  ctx.lineTo(w, chartBottom);
  ctx.stroke();

  // Bars
  for (var i = 0; i < barCount; i++) {
    var d = dailyData[i];
    var barH = (d.hours / maxHours) * chartHeight;
    var x = chartLeft + i * (barWidth + gap);
    var y = chartBottom - barH;

    // Gradient bar
    var grad = ctx.createLinearGradient(x, y, x, chartBottom);
    grad.addColorStop(0, "#e94560");
    grad.addColorStop(1, "#533483");
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barH, [2, 2, 0, 0]);
    ctx.fill();

    // Date label (show for first, last, and every ~3rd)
    if (i === 0 || i === barCount - 1 || (barCount <= 10) || (i % Math.ceil(barCount / 5) === 0)) {
      ctx.fillStyle = "#667788";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      var label = d.day.slice(5); // "MM-DD"
      ctx.fillText(label, x + barWidth / 2, h - 2);
    }
  }

  // Tooltip on hover
  canvas.addEventListener("mousemove", function (e) {
    var cRect = canvas.getBoundingClientRect();
    var mx = e.clientX - cRect.left;
    var idx = Math.floor((mx - chartLeft) / (barWidth + gap));
    if (idx >= 0 && idx < barCount) {
      var d = dailyData[idx];
      canvas.title = d.day + ": " + d.hours.toFixed(1) + " hours";
    } else {
      canvas.title = "";
    }
  });
}
