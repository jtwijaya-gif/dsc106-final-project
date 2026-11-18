// Same Planet, Different Futures - interactive warming map (D3)
// Data: CMIP6 NOAA GFDL-ESM4 annual near-surface air temperature, change vs the
// 1991-2010 baseline. Prepared by export_web_data.py -> data/meta.json + data/warming.bin

const SCENARIO_INFO = {
  ssp126: { label: "SSP1-2.6", desc: "low emissions", color: "#2a78d6" },
  ssp245: { label: "SSP2-4.5", desc: "mid-low emissions", color: "#1baf7a" },
  ssp370: { label: "SSP3-7.0", desc: "mid-high emissions", color: "#e09a00" },
  ssp585: { label: "SSP5-8.5", desc: "high emissions", color: "#e34948" },
};
const HIST_COLOR = "#555f6b";
const MAP_W = 960;
const MAP_H = 480;

// Diverging color scale: blue = cooler than 1991-2010, white = no change, red = warmer
const color = d3.scaleDiverging([-3, 0, 10], (t) => d3.interpolateRdBu(1 - t)).clamp(true);

const fmt = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}°C`;

const root = d3.select("#visualization").html("").classed("warming-viz", true);
root.append("p").attr("class", "wv-loading").text("Loading climate data…");

Promise.all([
  d3.json("data/meta.json"),
  fetch("data/warming.bin").then((r) => {
    if (!r.ok) throw new Error(`data/warming.bin: ${r.status}`);
    return r.arrayBuffer();
  }),
  d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json").catch(() => null),
])
  .then(([meta, buffer, landTopo]) => {
    root.select(".wv-loading").remove();
    build(meta, new Uint8Array(buffer), landTopo);
  })
  .catch((err) => {
    console.error(err);
    root
      .select(".wv-loading")
      .text(
        "Could not load the climate data. If you opened index.html directly, run a local " +
          "server instead (python3 -m http.server) and open http://localhost:8000."
      );
  });

function build(meta, bytes, landTopo) {
  const { nlat, nlon, lat, dlat, dlon, scenarios } = meta;
  const [h0, h1] = meta.hist_years;
  const [s0, s1] = meta.ssp_years;
  const nHist = h1 - h0 + 1;
  const nSsp = s1 - s0 + 1;
  const cellsPerFrame = nlat * nlon;
  const { offset, scale } = meta.decode;
  const latSouthToNorth = lat[0] < lat[lat.length - 1];

  const state = {
    s: scenarios.length - 1,
    year: 2100,
    hover: null,
    selected: null
  };

  // ------------------------------------------------------------------ helpers
  const frameIndex = (year, s) =>
    year <= h1 ? year - h0 : nHist + s * nSsp + (year - s0);

  const valueAt = (year, s, j, i) =>
    bytes[frameIndex(year, s) * cellsPerFrame + j * nlon + i] / scale - offset;

  const globalMean = (year, s) =>
    year <= h1 ? meta.global_mean.historical[year - h0] : meta.global_mean[scenarios[s]][year - s0];

  // 256-entry color lookup table for the byte values
  const lut = new Uint8ClampedArray(256 * 3);
  for (let b = 0; b < 256; b++) {
    const c = d3.rgb(color(b / scale - offset));
    lut[b * 3] = c.r;
    lut[b * 3 + 1] = c.g;
    lut[b * 3 + 2] = c.b;
  }

  // ------------------------------------------------------------------ controls
  const controls = root.append("div").attr("class", "wv-controls");

  const scRow = controls.append("div").attr("class", "wv-row");
  scRow.append("label").attr("for", "wv-scenario").text("Emissions scenario");
  const scInput = scRow
    .append("input")
    .attr("type", "range")
    .attr("id", "wv-scenario")
    .attr("min", 0)
    .attr("max", scenarios.length - 1)
    .attr("step", 1)
    .property("value", state.s);
  const scOut = scRow.append("output").attr("class", "wv-out");
  const ticks = controls.append("div").attr("class", "wv-ticks");
  scenarios.forEach((id) => ticks.append("span").text(SCENARIO_INFO[id].desc.replace(" emissions", "")));

  const yrRow = controls.append("div").attr("class", "wv-row");
  yrRow.append("label").attr("for", "wv-year").text("Year");
  const yrInput = yrRow
    .append("input")
    .attr("type", "range")
    .attr("id", "wv-year")
    .attr("min", h0)
    .attr("max", s1)
    .attr("step", 1)
    .property("value", state.year);
  const yrOut = yrRow.append("output").attr("class", "wv-out");

  const btnRow = controls.append("div").attr("class", "wv-buttons");
  const playBtn = btnRow.append("button").attr("type", "button").text("▶ Play 2015 → 2100");
  btnRow
    .append("span")
    .attr("class", "wv-note")
    .text(`Before 2015 all scenarios share the same historical run.`);

  // ------------------------------------------------------------------ map
  const mapWrap = root.append("div").attr("class", "wv-map");
  const canvas = mapWrap
    .append("canvas")
    .attr("width", MAP_W)
    .attr("height", MAP_H)
    .attr("role", "img")
    .attr("aria-label", "World map of projected temperature change for the selected scenario and year");
  const ctx = canvas.node().getContext("2d");
  const tooltip = mapWrap.append("div").attr("class", "wv-tooltip").style("opacity", 0);

  const off = document.createElement("canvas");
  off.width = nlon;
  off.height = nlat;
  const offCtx = off.getContext("2d");
  const img = offCtx.createImageData(nlon, nlat);

  const proj = d3.geoEquirectangular().scale(MAP_W / (2 * Math.PI)).translate([MAP_W / 2, MAP_H / 2]);
  const land = landTopo ? topojson.feature(landTopo, landTopo.objects.land) : null;
  const path = d3.geoPath(proj, ctx);

  // legend
  const legend = root.append("div").attr("class", "wv-legend");
  const legW = 300;
  const legSvg = legend.append("svg").attr("width", legW + 30).attr("height", 44);
  const grad = legSvg.append("defs").append("linearGradient").attr("id", "wv-grad");
  d3.range(0, 1.0001, 0.05).forEach((t) =>
    grad.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", color(-3 + 13 * t))
  );
  legSvg.append("rect").attr("x", 15).attr("y", 4).attr("width", legW).attr("height", 12).attr("fill", "url(#wv-grad)");
  const legScale = d3.scaleLinear([-3, 10], [15, 15 + legW]);
  legSvg
    .append("g")
    .attr("transform", "translate(0,16)")
    .call(d3.axisBottom(legScale).tickValues([-3, 0, 2, 4, 6, 8, 10]).tickFormat((d) => `${d > 0 ? "+" : ""}${d}°C`).tickSize(4))
    .call((g) => g.select(".domain").remove());
  legend
    .append("span")
    .text(`Change in annual mean temperature vs ${meta.baseline.replace("-", "–")}. Hover the map for any grid cell.`);

  const stat = root.append("p").attr("class", "wv-stat");

  // ------------------------------------------------------------------ line chart
  const LW = 900, LH = 260, M = { t: 16, r: 120, b: 32, l: 48 };
  const lineSvg = root
    .append("svg")
    .attr("class", "wv-line")
    .attr("viewBox", `0 0 ${LW} ${LH}`)
    .attr("role", "img")
    .attr("aria-label", "Global mean temperature change by scenario, 1900 to 2100");
  const allMeans = [...meta.global_mean.historical, ...scenarios.flatMap((id) => meta.global_mean[id])];
  const x = d3.scaleLinear([h0, s1], [M.l, LW - M.r]);
  const y = d3.scaleLinear([Math.min(-1.5, d3.min(allMeans)), Math.max(4, d3.max(allMeans))], [LH - M.b, M.t]).nice();

  lineSvg
    .append("g")
    .attr("class", "wv-grid")
    .attr("transform", `translate(${M.l},0)`)
    .call(d3.axisLeft(y).ticks(6).tickSize(-(LW - M.l - M.r)).tickFormat((d) => `${d > 0 ? "+" : ""}${d}°C`))
    .call((g) => g.select(".domain").remove());
  lineSvg
    .append("g")
    .attr("class", "wv-axis")
    .attr("transform", `translate(0,${LH - M.b})`)
    .call(d3.axisBottom(x).ticks(10).tickFormat(d3.format("d")));
  lineSvg
    .append("rect")
    .attr("x", x(1991)).attr("width", x(2011) - x(1991))
    .attr("y", M.t).attr("height", LH - M.b - M.t)
    .attr("class", "wv-baseband");
  lineSvg.append("text").attr("x", (x(1991) + x(2011)) / 2).attr("y", M.t + 12).attr("text-anchor", "middle").attr("class", "wv-small").text("baseline");
  lineSvg.append("line").attr("x1", x(2015)).attr("x2", x(2015)).attr("y1", M.t).attr("y2", LH - M.b).attr("class", "wv-split");

  const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));
  lineSvg
    .append("path")
    .datum(meta.global_mean.historical.map((v, k) => [h0 + k, v]))
    .attr("d", line)
    .attr("fill", "none")
    .attr("stroke", HIST_COLOR)
    .attr("stroke-width", 1.6);
  const lastHist = [h1, meta.global_mean.historical[nHist - 1]];
  const scLines = scenarios.map((id) =>
    lineSvg
      .append("path")
      .datum([lastHist, ...meta.global_mean[id].map((v, k) => [s0 + k, v])])
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", SCENARIO_INFO[id].color)
      .attr("stroke-linejoin", "round")
  );
  const endLabels = scenarios.map((id) =>
    lineSvg
      .append("text")
      .attr("x", x(s1) + 6)
      .attr("y", y(meta.global_mean[id][nSsp - 1]))
      .attr("dy", "0.35em")
      .attr("class", "wv-small")
      .style("fill", SCENARIO_INFO[id].color)
      .text(`${SCENARIO_INFO[id].label} ${fmt(meta.global_mean[id][nSsp - 1])}`)
  );
  // spread end labels so they don't overlap
  {
    const ys = scenarios.map((id) => y(meta.global_mean[id][nSsp - 1]));
    const order = d3.range(ys.length).sort((a, b) => ys[a] - ys[b]);
    for (let k = 1; k < order.length; k++) {
      if (ys[order[k]] - ys[order[k - 1]] < 13) ys[order[k]] = ys[order[k - 1]] + 13;
    }
    endLabels.forEach((t, k) => t.attr("y", ys[k]));
  }
  const rule = lineSvg.append("line").attr("y1", M.t).attr("y2", LH - M.b).attr("class", "wv-rule");
  const dot = lineSvg.append("circle").attr("r", 5).attr("class", "wv-dot");
  lineSvg
    .append("rect")
    .attr("x", M.l).attr("y", M.t)
    .attr("width", LW - M.l - M.r).attr("height", LH - M.t - M.b)
    .attr("fill", "transparent")
    .style("cursor", "pointer")
    .on("click", (event) => {
      const [mx] = d3.pointer(event);
      setYear(Math.round(x.invert(mx)));
    });



  // ------------------------------------------------------------------ selected location chart

  const localPanel = mapWrap.append("div")
    .attr("class", "wv-local-panel")
    .style("display", "none");

  const localHeader = localPanel.append("div")
    .attr("class", "wv-local-header");

  const localTitle = localHeader.append("h3");

  const resetBtn = localHeader.append("button")
    .text("✕ Close");

  localPanel.append("p")
    .text("Temperature change at the selected grid cell, compared across emissions scenarios.");

  const localSvg = localPanel.append("svg")
    .attr("class", "wv-line")
    .attr("viewBox", `0 0 ${LW} ${LH}`);

  let localRule, localDot, localY;

  function drawLocalChart() {
    if (!state.selected) {
      localPanel.style("display", "none");
      return;
    }

    localPanel.style("display", "block");
    localSvg.selectAll("*").remove();

    const { i, j } = state.selected;
    const latitude = lat[j];
    const longitude = meta.lon[i];

    localTitle.text(
      `Local warming at ${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}, ` +
      `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`
    );

    // Historical temperatures at this location
    const historical = d3.range(h0, h1 + 1)
      .map(year => [year, valueAt(year, 0, j, i)]);

    // Future temperatures under each emissions scenario
    const futures = scenarios.map((id, k) => [
      historical[historical.length - 1],
      ...d3.range(s0, s1 + 1)
        .map(year => [year, valueAt(year, k, j, i)])
    ]);

    const allValues = [
      ...historical.map(d => d[1]),
      ...futures.flatMap(series => series.map(d => d[1]))
    ];

    localY = d3.scaleLinear()
      .domain([Math.min(-1, d3.min(allValues)),
              Math.max(1, d3.max(allValues))])
      .nice()
      .range([LH - M.b, M.t]);

    // Axes
    localSvg.append("g")
      .attr("class", "wv-grid")
      .attr("transform", `translate(${M.l},0)`)
      .call(d3.axisLeft(localY)
        .ticks(6)
        .tickSize(-(LW - M.l - M.r))
        .tickFormat(d => `${d > 0 ? "+" : ""}${d}°C`));

    localSvg.append("g")
      .attr("class", "wv-axis")
      .attr("transform", `translate(0,${LH - M.b})`)
      .call(d3.axisBottom(x).ticks(10).tickFormat(d3.format("d")));

    const localLine = d3.line()
      .x(d => x(d[0]))
      .y(d => localY(d[1]));

    // Historical line
    localSvg.append("path")
      .datum(historical)
      .attr("d", localLine)
      .attr("fill", "none")
      .attr("stroke", HIST_COLOR)
      .attr("stroke-width", 1.7);

    // Four future scenario lines
    futures.forEach((series, k) => {
      localSvg.append("path")
        .datum(series)
        .attr("d", localLine)
        .attr("fill", "none")
        .attr("class", "wv-local-scenario")
        .attr("data-index", k)
        .attr("stroke", SCENARIO_INFO[scenarios[k]].color)
        .attr("stroke-width", 2);

      localSvg.append("text")
        .attr("x", x(s1) + 6)
        .attr("y", localY(series[series.length - 1][1]))
        .attr("dy", "0.35em")
        .style("fill", SCENARIO_INFO[scenarios[k]].color)
        .style("font-size", "12px")
        .text(SCENARIO_INFO[scenarios[k]].label);
    });

    // Current year marker
    localRule = localSvg.append("line")
      .attr("y1", M.t)
      .attr("y2", LH - M.b)
      .attr("class", "wv-rule");

    localDot = localSvg.append("circle")
      .attr("r", 5)
      .attr("class", "wv-dot");

    updateLocalChart();
  }

  function updateLocalChart() {
    if (!state.selected || !localRule) return;

    const { i, j } = state.selected;
    const temp = valueAt(state.year, state.s, j, i);

    localRule
      .attr("x1", x(state.year))
      .attr("x2", x(state.year));

    localDot
      .attr("cx", x(state.year))
      .attr("cy", localY(temp))
      .attr("fill", state.year <= h1
        ? HIST_COLOR
        : SCENARIO_INFO[scenarios[state.s]].color);

    localSvg.selectAll(".wv-local-scenario")
      .attr("stroke-width", function() {
        return +this.getAttribute("data-index") === state.s ? 3 : 1.3;
      })
      .attr("opacity", function() {
        return +this.getAttribute("data-index") === state.s ? 1 : 0.35;
      });
  }

  resetBtn.on("click", () => {
    state.selected = null;
    localRule = null;
    localPanel.style("display", "none");
    drawMap();
  });



  // ------------------------------------------------------------------ drawing
  function drawMap() {
    const base = frameIndex(state.year, state.s) * cellsPerFrame;
    const data = img.data;
    for (let j = 0; j < nlat; j++) {
      const row = latSouthToNorth ? nlat - 1 - j : j; // image row 0 = north
      for (let i = 0; i < nlon; i++) {
        const b = bytes[base + j * nlon + i];
        const p = (row * nlon + i) * 4;
        data[p] = lut[b * 3];
        data[p + 1] = lut[b * 3 + 1];
        data[p + 2] = lut[b * 3 + 2];
        data[p + 3] = 255;
      }
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, MAP_W, MAP_H);

    if (land) {
      ctx.beginPath();
      path(land);
      ctx.strokeStyle = "rgba(30, 41, 59, 0.75)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // highlight the selected map location
    if (state.selected) {
      const { i, row } = state.selected;

      const cw = MAP_W / nlon;
      const ch = MAP_H / nlat;

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.strokeRect(i * cw, row * ch, cw, ch);

      ctx.strokeStyle = "#173b5e";
      ctx.lineWidth = 2;
      ctx.strokeRect(i * cw, row * ch, cw, ch);
    }

    if (state.hover) {
      const { i, row } = state.hover;
      const cw = MAP_W / nlon, ch = MAP_H / nlat;
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2;
      ctx.strokeRect(i * cw, row * ch, cw, ch);
    }
  }

  function updateText() {
    const id = scenarios[state.s];
    const info = SCENARIO_INFO[id];
    const hist = state.year <= h1;
    scOut.text(hist ? "Historical" : `${info.label} (${info.desc})`);
    yrOut.text(state.year);
    const g = globalMean(state.year, state.s);
    stat.html(
      hist
        ? `<strong>${state.year}</strong> (historical run): global mean change <strong>${fmt(g)}</strong> vs ${meta.baseline}.`
        : `<strong>${state.year}</strong> under <strong style="color:${info.color}">${info.label}</strong> (${info.desc}): ` +
          `global mean change <strong>${fmt(g)}</strong> vs ${meta.baseline}.`
    );
    scLines.forEach((p, k) => p.attr("stroke-width", k === state.s ? 3 : 1.3).attr("opacity", k === state.s ? 1 : 0.35));
    rule.attr("x1", x(state.year)).attr("x2", x(state.year));
    dot.attr("cx", x(state.year)).attr("cy", y(g)).attr("fill", hist ? HIST_COLOR : info.color);
  }

  function updateTooltip() {
    if (!state.hover) {
      tooltip.style("opacity", 0);
      return;
    }
    const { i, j, px, py } = state.hover;
    const v = valueAt(state.year, state.s, j, i);
    const la = lat[j], lo = meta.lon[i];
    const where = `${Math.abs(la).toFixed(1)}°${la >= 0 ? "N" : "S"}, ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`;
    const scen = state.year <= h1 ? "Historical run" : SCENARIO_INFO[scenarios[state.s]].label;
    tooltip
      .html(
        `<div class="wv-tt-val" style="color:${v >= 0 ? "#b2182b" : "#2166ac"}">${fmt(v)}</div>` +
          `<div>${where}</div><div>${scen}, ${state.year}</div>` +
          `<div class="wv-tt-sub">vs ${meta.baseline} average · cell ≈ ${dlat}° × ${dlon}°</div>`
      )
      .style("opacity", 1);
    const wrapW = mapWrap.node().clientWidth;
    const tw = tooltip.node().offsetWidth;
    tooltip.style("left", `${Math.min(px + 14, wrapW - tw - 4)}px`).style("top", `${py + 14}px`);
  }

  function render() {
    drawMap();
    updateText();
    updateTooltip();
    updateLocalChart();
  }

  function setYear(yr) {
    state.year = Math.max(h0, Math.min(s1, yr));
    yrInput.property("value", state.year);
    render();
  }

  // ------------------------------------------------------------------ events
  scInput.on("input", (e) => { state.s = +e.target.value; render(); });
  yrInput.on("input", (e) => { state.year = +e.target.value; render(); });

  canvas.on("mousemove", (event) => {
    const rect = canvas.node().getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    const i = Math.floor((px / rect.width) * nlon);
    const row = Math.floor((py / rect.height) * nlat);
    if (i < 0 || i >= nlon || row < 0 || row >= nlat) return;
    const j = latSouthToNorth ? nlat - 1 - row : row;
    state.hover = { i, j, row, px, py };
    drawMap();
    updateTooltip();
  });
  canvas.on("mouseleave", () => { state.hover = null; drawMap(); updateTooltip(); });

  // Select a grid cell when the map is clicked
  canvas.on("click", (event) => {
    const rect = canvas.node().getBoundingClientRect();

    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    const i = Math.floor((px / rect.width) * nlon);
    const row = Math.floor((py / rect.height) * nlat);

    if (i < 0 || i >= nlon || row < 0 || row >= nlat) return;

    const j = latSouthToNorth ? nlat - 1 - row : row;

    state.selected = { i, j, row };

    const clickedRight = px > rect.width / 2;
    const clickedBottom = py > rect.height / 2;

    localPanel
      .style("left", clickedRight ? "12px" : "auto")
      .style("right", clickedRight ? "auto" : "12px")
      .style("top", clickedBottom ? "12px" : "auto")
      .style("bottom", clickedBottom ? "auto" : "12px");
    
    drawLocalChart();
    drawMap();
  });

  let timer = null;
  const stop = () => { if (timer) timer.stop(); timer = null; playBtn.text("▶ Play 2015 → 2100"); };
  playBtn.on("click", () => {
    if (timer) return stop();
    if (state.year >= s1 || state.year < s0) setYear(s0);
    playBtn.text("❚❚ Pause");
    let last = 0;
    timer = d3.timer((elapsed) => {
      if (elapsed - last < 90) return;
      last = elapsed;
      if (state.year >= s1) return stop();
      setYear(state.year + 1);
    });
  });

  render();
}
