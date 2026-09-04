"use strict";

const GRID_COLS = 64;
const GRID_ROWS = 48;
const CA_GENERATIONS = 3;
const MAP_FIT_PADDING = [4, 4];
const MANAGEMENT_SPACING_PIXELS = 190;

const classInfo = [
  { label: "안정", color: "#5d9667" },
  { label: "주의", color: "#e1bb52" },
  { label: "위험", color: "#e98247" },
  { label: "심각", color: "#c9523c" }
];

const regions = {
  gobi: {
    name: "몽골 남부 · 고비 전이지대",
    bounds: [[43.2, 101.0], [46.8, 108.7]],
    observed: "2026.08.28",
    placeNames: ["달란자드가드 동부", "옴노고비 북단", "차강오보 남부", "만달오보 서부", "구르반테스 동부"]
  },
  sahel: {
    name: "사헬 서부 · 세네갈 북부",
    bounds: [[14.7, -15.8], [16.3, -13.5]],
    observed: "2026.08.26",
    placeNames: ["루가 북동부", "마탐 서부", "포도르 남부", "링게르 동부", "페를로 초원"]
  },
  aral: {
    name: "중앙아시아 · 아랄해 동부",
    bounds: [[43.1, 60.2], [46.2, 64.9]],
    observed: "2026.08.24",
    placeNames: ["키질로르다 서부", "아랄 동부", "시르다리야 하류", "카라테렌 남부", "사크사울 북부"]
  }
};

const model = [
  { mean: [0.57, -2, 112, 25, 24, 18], sd: [0.12, 6, 25, 6, 4, 11], prior: 0.24 },
  { mean: [0.41, -8, 82, 19, 29, 36], sd: [0.11, 6, 22, 5, 4, 12], prior: 0.34 },
  { mean: [0.25, -16, 53, 12, 34, 57], sd: [0.10, 7, 18, 4, 4, 12], prior: 0.27 },
  { mean: [0.12, -27, 27, 7, 39, 78], sd: [0.08, 8, 13, 3, 4, 10], prior: 0.15 }
];

const zoneColors = ["#5c9a88", "#7dac61", "#c8a257", "#9873a5", "#6489a5"];

// These broad synthetic priors are blended smoothly with coordinate-anchored noise.
// They are not observations or a substitute for a trained remote-sensing model.
const drylandHotspots = [
  { lat: 25, lng: 15, latRadius: 14, lngRadius: 33, strength: 0.22 },
  { lat: 24, lng: 46, latRadius: 9, lngRadius: 16, strength: 0.18 },
  { lat: 45, lng: 105, latRadius: 6, lngRadius: 11, strength: 0.18 },
  { lat: 44.6, lng: 62.5, latRadius: 5, lngRadius: 8, strength: 0.20 },
  { lat: -25, lng: 134, latRadius: 12, lngRadius: 19, strength: 0.17 },
  { lat: 35, lng: -112, latRadius: 8, lngRadius: 12, strength: 0.11 }
];

const state = {
  cells: [],
  managementCenters: [],
  selected: null,
  selectedSites: [],
  region: "gobi",
  threshold: 65,
  budget: 30,
  focusBounds: null,
  analysisBounds: null,
  cellArea: 64,
  customArea: false,
  drawingArea: false,
  areaPoints: [],
  renderingMap: false,
  suppressViewportSync: false,
  viewportTimer: null
};

const mapLayers = {};
let satelliteMap;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (start, end, amount) => start + (end - start) * amount;
const smoothStep = value => value * value * (3 - 2 * value);
const fmt = new Intl.NumberFormat("ko-KR");

function normalizeLongitude(longitude) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function hashCoordinate(x, y, salt = 0) {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(lat, lng, scale, salt = 0) {
  const longitudePeriod = Math.round(360 / scale);
  const x = (normalizeLongitude(lng) + 180) / scale;
  const y = (lat + 90) / scale;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothStep(x - x0);
  const ty = smoothStep(y - y0);
  const wrapX = value => ((value % longitudePeriod) + longitudePeriod) % longitudePeriod;
  const northWest = hashCoordinate(wrapX(x0), y0, salt);
  const northEast = hashCoordinate(wrapX(x0 + 1), y0, salt);
  const southWest = hashCoordinate(wrapX(x0), y0 + 1, salt);
  const southEast = hashCoordinate(wrapX(x0 + 1), y0 + 1, salt);
  return lerp(lerp(northWest, northEast, tx), lerp(southWest, southEast, tx), ty);
}

function geographicField(lat, lng, salt = 0) {
  return valueNoise(lat, lng, 12, salt) * 0.48
    + valueNoise(lat, lng, 4, salt + 11) * 0.34
    + valueNoise(lat, lng, 1, salt + 23) * 0.18;
}

function longitudeDistance(first, second) {
  return Math.abs(((first - second + 540) % 360) - 180);
}

function drylandPrior(lat, lng) {
  const prior = drylandHotspots.reduce((sum, hotspot) => {
    const latDistance = (lat - hotspot.lat) / hotspot.latRadius;
    const lngDistance = longitudeDistance(lng, hotspot.lng) / hotspot.lngRadius;
    return sum + hotspot.strength * Math.exp(-0.5 * (latDistance ** 2 + lngDistance ** 2));
  }, 0);
  return clamp(prior, 0, 0.30);
}

function geographicCellId(lat, lng) {
  const normalizedLng = normalizeLongitude(lng);
  const latitude = String(Math.round(Math.abs(lat) * 1000)).padStart(6, "0");
  const longitude = String(Math.round(Math.abs(normalizedLng) * 1000)).padStart(6, "0");
  return `GEO-${lat >= 0 ? "N" : "S"}${latitude}-${normalizedLng >= 0 ? "E" : "W"}${longitude}`;
}

function gaussianClassify(features) {
  const scores = model.map(({ mean, sd, prior }) => {
    let score = Math.log(prior);
    features.forEach((value, index) => {
      const z = (value - mean[index]) / sd[index];
      score += -Math.log(sd[index]) - 0.5 * z * z;
    });
    return score;
  });
  const maxScore = Math.max(...scores);
  const exponentials = scores.map(score => Math.exp(score - maxScore));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  const probabilities = exponentials.map(value => value / total);
  const classIndex = probabilities.indexOf(Math.max(...probabilities));
  return { classIndex, probabilities, confidence: probabilities[classIndex] };
}

function riskClassFromScore(score) {
  if (score < 0.22) return 0;
  if (score < 0.46) return 1;
  if (score < 0.70) return 2;
  return 3;
}

function applyCellularAutomata(cells) {
  const severitySeed = [0.12, 0.36, 0.64, 0.86];
  let scores = cells.map(cell => clamp(
    severitySeed[cell.classIndex] * 0.72 + cell.riskScore * 0.28,
    0.02,
    0.98
  ));

  for (let generation = 0; generation < CA_GENERATIONS; generation += 1) {
    const nextScores = [...scores];
    cells.forEach((cell, index) => {
      const neighbors = [];
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
          if (rowOffset === 0 && colOffset === 0) continue;
          const row = cell.row + rowOffset;
          const col = cell.col + colOffset;
          if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) continue;
          neighbors.push(scores[row * GRID_COLS + col]);
        }
      }

      const neighborMean = neighbors.reduce((sum, score) => sum + score, 0) / Math.max(1, neighbors.length);
      const severeNeighbors = neighbors.filter(score => score >= 0.65).length;
      const environmentalStress = clamp(
        ((cell.bareSoil - 18) / 72 + (30 - cell.moisture) / 27 + (cell.temperature - 20) / 23) / 3,
        0,
        1
      );
      const spreadEffect = severeNeighbors >= 5 ? 0.035 : severeNeighbors <= 1 ? -0.012 : 0;
      nextScores[index] = clamp(
        scores[index] * 0.60 + neighborMean * 0.32 + environmentalStress * 0.08 + spreadEffect,
        0.02,
        0.98
      );
    });
    scores = nextScores;
  }

  cells.forEach((cell, index) => {
    cell.nbClassIndex = cell.classIndex;
    cell.nbRiskScore = cell.riskScore;
    cell.riskScore = scores[index];
    cell.classIndex = riskClassFromScore(cell.riskScore);
    cell.confidence = clamp(0.56 + Math.abs(cell.riskScore - 0.5) * 0.78, 0.56, 0.96);
  });
}

function createCellData(row, col, bounds) {
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const latStep = (north - south) / GRID_ROWS;
  const lngStep = (east - west) / GRID_COLS;
  const cellNorth = north - row * latStep;
  const cellSouth = north - (row + 1) * latStep;
  const cellWest = west + col * lngStep;
  const cellEast = west + (col + 1) * lngStep;
  const cellBounds = L.latLngBounds([[cellSouth, cellWest], [cellNorth, cellEast]]);
  const cellCenter = cellBounds.getCenter();
  const normalizedLng = normalizeLongitude(cellCenter.lng);
  const normalizedPoint = { x: (col + 0.5) / GRID_COLS, y: (row + 0.5) / GRID_ROWS };
  const periodYears = Math.max(1, Number($("#end-date").value.slice(0, 4)) - Number($("#start-date").value.slice(0, 4)));
  const timePressure = clamp((periodYears - 3) * 0.012, -0.02, 0.06);
  const absoluteLatitude = Math.abs(cellCenter.lat);
  const subtropicalDryness = Math.exp(-Math.pow((absoluteLatitude - 27) / 15, 2));
  const equatorialMoisture = Math.exp(-Math.pow(absoluteLatitude / 11, 2));
  const polarRecovery = Math.exp(-Math.pow((absoluteLatitude - 78) / 12, 2));
  const geographicVariation = (geographicField(cellCenter.lat, normalizedLng) - 0.5) * 0.42;
  const regionalVariation = (geographicField(cellCenter.lat, normalizedLng, 41) - 0.5) * 0.20;
  const baseRisk = clamp(
    0.31
      + subtropicalDryness * 0.24
      + drylandPrior(cellCenter.lat, normalizedLng)
      + geographicVariation
      + regionalVariation
      + timePressure
      - equatorialMoisture * 0.20
      - polarRecovery * 0.18,
    0.02,
    0.98
  );
  const detail = salt => valueNoise(cellCenter.lat, normalizedLng, 0.25, salt);
  const latitudeCooling = clamp((absoluteLatitude - 20) * 0.18, 0, 9);
  const ndvi = clamp(0.67 - baseRisk * 0.60 + (detail(1) - 0.5) * 0.08, 0.05, 0.75);
  const ndviTrend = clamp(-1 - baseRisk * 28 + (detail(2) - 0.5) * 7, -38, 4);
  const rainfall = clamp(145 - baseRisk * 118 + (detail(3) - 0.5) * 24, 8, 165);
  const moisture = clamp(29 - baseRisk * 23 + (detail(4) - 0.5) * 5, 3, 31);
  const temperature = clamp(24 + baseRisk * 16 - latitudeCooling + (detail(5) - 0.5) * 4, 12, 43);
  const bareSoil = clamp(13 + baseRisk * 72 + (detail(6) - 0.5) * 12, 7, 92);
  const classification = gaussianClassify([ndvi, ndviTrend, rainfall, moisture, temperature, bareSoil]);
  const riskScore = classification.probabilities[2] + classification.probabilities[3];
  const ecological = clamp(0.35 + (1 - baseRisk) * 0.35 + detail(7) * 0.30, 0, 1);
  const people = 1.2 + detail(8) * 5.8;
  const cost = 3.6 + detail(9) * 5.2 + ecological * 1.2;
  const zone = state.managementCenters.reduce((best, center) => {
    const distance = Math.hypot(normalizedPoint.x - center.x, normalizedPoint.y - center.y);
    return distance < best.distance ? { colorIndex: center.colorIndex, distance } : best;
  }, { colorIndex: 0, distance: Infinity }).colorIndex;

  return {
    row, col, x: normalizedPoint.x, y: normalizedPoint.y, zone, ndvi, ndviTrend, rainfall, moisture,
    temperature, bareSoil, ecological, people, cost, riskScore, bounds: cellBounds,
    latlng: cellCenter, ...classification,
    id: geographicCellId(cellCenter.lat, normalizedLng)
  };
}

function createManagementCenters(bounds) {
  const zoomBand = Math.round(satelliteMap.getZoom());
  const northWest = satelliteMap.project(bounds.getNorthWest(), zoomBand);
  const southEast = satelliteMap.project(bounds.getSouthEast(), zoomBand);
  const firstColumn = Math.floor(northWest.x / MANAGEMENT_SPACING_PIXELS) - 1;
  const lastColumn = Math.ceil(southEast.x / MANAGEMENT_SPACING_PIXELS) + 1;
  const firstRow = Math.floor(northWest.y / MANAGEMENT_SPACING_PIXELS) - 1;
  const lastRow = Math.ceil(southEast.y / MANAGEMENT_SPACING_PIXELS) + 1;
  const width = Math.max(1, southEast.x - northWest.x);
  const height = Math.max(1, southEast.y - northWest.y);
  const generated = [];

  for (let gridRow = firstRow; gridRow <= lastRow; gridRow += 1) {
    for (let gridColumn = firstColumn; gridColumn <= lastColumn; gridColumn += 1) {
      const offsetX = 0.18 + hashCoordinate(gridColumn, gridRow, zoomBand + 101) * 0.64;
      const offsetY = 0.18 + hashCoordinate(gridColumn, gridRow, zoomBand + 211) * 0.64;
      const point = L.point(
        (gridColumn + offsetX) * MANAGEMENT_SPACING_PIXELS,
        (gridRow + offsetY) * MANAGEMENT_SPACING_PIXELS
      );
      const x = (point.x - northWest.x) / width;
      const y = (point.y - northWest.y) / height;
      generated.push({
        x,
        y,
        latlng: satelliteMap.unproject(point, zoomBand),
        visible: x >= 0 && x <= 1 && y >= 0 && y <= 1,
        colorIndex: Math.floor(hashCoordinate(gridColumn, gridRow, zoomBand + 307) * zoneColors.length),
        label: String(10 + Math.abs((gridColumn * 31 + gridRow * 17) % 90))
      });
    }
  }
  return generated;
}

function initializeSatelliteMap() {
  if (!window.L) {
    $("#satellite-map").innerHTML = '<p class="map-load-error">지도를 불러오지 못했습니다. 네트워크 연결을 확인해주세요.</p>';
    return false;
  }

  satelliteMap = L.map("satellite-map", {
    zoomControl: false,
    minZoom: 2,
    maxZoom: 18,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    preferCanvas: true
  });

  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18,
    attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics'
  }).addTo(satelliteMap);

  L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18,
    attribution: "Labels &copy; Esri",
    pane: "shadowPane"
  }).addTo(satelliteMap);

  ["risk", "zones", "network", "route", "sites", "centers", "boundary", "temporary"].forEach(name => {
    mapLayers[name] = L.layerGroup();
  });
  ["risk", "sites", "centers", "boundary", "temporary"].forEach(name => mapLayers[name].addTo(satelliteMap));
  L.control.scale({ imperial: false, position: "bottomright", maxWidth: 90 }).addTo(satelliteMap);
  satelliteMap.on("click", handleMapClick);
  satelliteMap.on("moveend", scheduleViewportAnalysis);
  satelliteMap.on("resize", scheduleViewportAnalysis);
  return true;
}

function copyBounds(bounds) {
  return L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
}

function scheduleViewportAnalysis() {
  if (!satelliteMap || state.drawingArea || state.renderingMap || state.suppressViewportSync) return;
  window.clearTimeout(state.viewportTimer);
  state.viewportTimer = window.setTimeout(() => {
    if (state.drawingArea || state.renderingMap || state.suppressViewportSync) return;
    state.analysisBounds = copyBounds(satelliteMap.getBounds());
    renderMap();
  }, 120);
}

function areaKm2(bounds) {
  const meanLat = (bounds.getNorth() + bounds.getSouth()) / 2 * Math.PI / 180;
  const height = Math.abs(bounds.getNorth() - bounds.getSouth()) * 111.32;
  const width = Math.abs(bounds.getEast() - bounds.getWest()) * 111.32 * Math.cos(meanLat);
  return height * width;
}

function centerToLatLng(center) {
  return center.latlng;
}

function renderMap({ fit = false } = {}) {
  if (!satelliteMap || !state.analysisBounds) return;
  state.renderingMap = true;
  if (fit) {
    state.suppressViewportSync = true;
    satelliteMap.fitBounds(state.focusBounds || state.analysisBounds, { padding: MAP_FIT_PADDING, animate: false });
    state.analysisBounds = copyBounds(satelliteMap.getBounds());
  }

  try {
    Object.values(mapLayers).forEach(layer => layer.clearLayers());
    state.cells = [];
    state.selected = null;
    state.cellArea = areaKm2(state.analysisBounds) / (GRID_ROWS * GRID_COLS);
    state.managementCenters = createManagementCenters(state.analysisBounds);

    const boundary = L.rectangle(state.focusBounds || state.analysisBounds, {
      color: "#d5ef6c",
      weight: 1.5,
      opacity: 0.95,
      fill: false,
      dashArray: "7 6",
      interactive: false
    });
    mapLayers.boundary.addLayer(boundary);

    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        state.cells.push(createCellData(row, col, state.analysisBounds));
      }
    }

    applyCellularAutomata(state.cells);
    state.cells.forEach(cell => {
      const rectangle = L.rectangle(cell.bounds, {
        color: "rgba(255,255,255,.24)",
        weight: 0.22,
        opacity: 0.46,
        fillColor: classInfo[cell.classIndex].color,
        fillOpacity: 0.54,
        bubblingMouseEvents: true
      });
      rectangle.bindTooltip(`<strong>${cell.id} · ${classInfo[cell.classIndex].label}</strong><br>CA 보정 위험도 ${Math.round(cell.riskScore * 100)}% · NDVI ${cell.ndvi.toFixed(2)}<br>${cell.latlng.lat.toFixed(3)}°, ${normalizeLongitude(cell.latlng.lng).toFixed(3)}°`, { sticky: true });
      rectangle.on("click", () => {
        if (!state.drawingArea) selectCell(cell);
      });
      cell.layer = rectangle;
      mapLayers.risk.addLayer(rectangle);

      mapLayers.zones.addLayer(L.rectangle(cell.bounds, {
        stroke: false,
        fillColor: zoneColors[cell.zone],
        fillOpacity: 0.28,
        interactive: false
      }));
    });

    renderCenters();
    renderPrimNetwork();
    updateSummary();
    updateGreedyPlan();
    const suggested = [...state.cells].sort((a, b) => b.riskScore - a.riskScore)[Math.floor(state.cells.length * 0.12)];
    selectCell(suggested || state.cells[0]);
    updateAreaLabels();
    updateLayerVisibility();
  } finally {
    state.renderingMap = false;
    state.suppressViewportSync = false;
  }
}

function renderCenters() {
  state.managementCenters.filter(center => center.visible).forEach(center => {
    const icon = L.divIcon({
      className: "hub-marker-wrap",
      html: `<span class="hub-marker">${center.label}</span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
    mapLayers.centers.addLayer(L.marker(centerToLatLng(center), { icon, interactive: false }));
  });
}

function primEdges(points) {
  if (!points.length) return [];
  const connected = new Set([0]);
  const edges = [];
  while (connected.size < points.length) {
    let best = null;
    connected.forEach(from => {
      points.forEach((point, to) => {
        if (connected.has(to)) return;
        const distance = Math.hypot(points[from].x - point.x, points[from].y - point.y);
        if (!best || distance < best.distance) best = { from, to, distance };
      });
    });
    if (!best) break;
    connected.add(best.to);
    edges.push(best);
  }
  return edges;
}

function renderPrimNetwork() {
  const visibleCenters = state.managementCenters.filter(center => center.visible);
  primEdges(visibleCenters).forEach(edge => {
    mapLayers.network.addLayer(L.polyline([
      centerToLatLng(visibleCenters[edge.from]),
      centerToLatLng(visibleCenters[edge.to])
    ], { color: "#d5ef6c", weight: 3, opacity: 0.95, dashArray: "7 7", interactive: false }));
  });
}

function updateSummary() {
  if (!state.cells.length) return;
  const counts = [0, 0, 0, 0];
  state.cells.forEach(cell => { counts[cell.classIndex] += 1; });
  const total = state.cells.length;
  const highRiskCells = state.cells.filter(cell => cell.riskScore * 100 >= state.threshold);
  const highPercent = Math.round(highRiskCells.length / total * 100);
  const circumference = 2 * Math.PI * 41;
  $("#risk-percent").textContent = `${highPercent}%`;
  $("#donut-value").style.strokeDasharray = `${circumference * highPercent / 100} ${circumference}`;
  $("#risk-area").innerHTML = `${fmt.format(Math.round(highRiskCells.length * state.cellArea))} <small>km²</small>`;
  $("#risk-change").textContent = `이전 기간 대비 +${(2.8 + state.threshold / 38).toFixed(1)}%`;

  ["normal", "attention", "high", "critical"].forEach((name, index) => {
    const percentage = Math.round(counts[index] / total * 100);
    $(`#${name}-label`).textContent = `${percentage}%`;
    $(`#${name}-bar`).style.width = `${percentage}%`;
  });
}

function factorValues(cell) {
  return [
    { label: "식생 감소", value: clamp(Math.abs(Math.min(cell.ndviTrend, 0)) / 32, 0, 1) },
    { label: "강수 부족", value: clamp((125 - cell.rainfall) / 110, 0, 1) },
    { label: "토양 건조", value: clamp((28 - cell.moisture) / 25, 0, 1) },
    { label: "나지 증가", value: clamp((cell.bareSoil - 10) / 82, 0, 1) },
    { label: "고온 노출", value: clamp((cell.temperature - 22) / 20, 0, 1) }
  ].sort((a, b) => b.value - a.value);
}

function selectCell(cell) {
  if (!cell) return;
  if (state.selected?.layer) {
    state.selected.layer.setStyle({ color: "rgba(255,255,255,.24)", weight: 0.22, opacity: 0.46 });
  }
  state.selected = cell;
  if (cell.layer) {
    cell.layer.setStyle({ color: "#ffffff", weight: 2, opacity: 1 });
    cell.layer.bringToFront();
  }

  $("#cell-id").textContent = cell.id;
  $("#cell-class").textContent = classInfo[cell.classIndex].label;
  $("#cell-class").style.color = classInfo[cell.classIndex].color;
  $("#cell-confidence").textContent = `${Math.round(cell.confidence * 100)}%`;
  $("#ndvi-value").textContent = cell.ndvi.toFixed(2);
  $("#ndvi-trend").textContent = `${cell.ndviTrend > 0 ? "+" : "−"}${Math.abs(Math.round(cell.ndviTrend))}%`;
  $("#rainfall-value").textContent = `${Math.round(cell.rainfall)} mm`;
  $("#rainfall-trend").textContent = `−${Math.round(clamp((115 - cell.rainfall) / 7, 2, 19))}%`;
  $("#moisture-value").textContent = `${Math.round(cell.moisture)}%`;
  $("#moisture-trend").textContent = `−${Math.round(clamp((24 - cell.moisture) / 2, 1, 11))}%`;
  $("#temperature-value").textContent = `${cell.temperature.toFixed(1)}°C`;
  $("#temperature-trend").textContent = `+${clamp((cell.temperature - 25) / 5, .4, 3.1).toFixed(1)}°C`;

  const factorList = $("#factor-list");
  factorList.replaceChildren();
  factorValues(cell).slice(0, 4).forEach(factor => {
    const row = document.createElement("div");
    row.className = "factor-row";
    row.innerHTML = `<span>${factor.label}</span><div class="factor-bar"><i style="width:${Math.round(factor.value * 100)}%"></i></div><strong>${Math.round(factor.value * 100)}%</strong>`;
    factorList.append(row);
  });
}

function updateGreedyPlan() {
  if (!state.cells.length) return;
  const candidates = state.cells
    .filter(cell => cell.riskScore * 100 >= state.threshold)
    .map(cell => ({
      ...cell,
      benefit: cell.riskScore * (0.62 + cell.ecological * 0.5) * (1 + cell.people / 16)
    }))
    .map(cell => ({ ...cell, greedyScore: cell.benefit / cell.cost }))
    .sort((a, b) => b.greedyScore - a.greedyScore);

  const selected = [];
  let spent = 0;
  candidates.forEach(candidate => {
    if (selected.length >= 7) return;
    if (spent + candidate.cost <= state.budget) {
      selected.push(candidate);
      spent += candidate.cost;
    }
  });
  state.selectedSites = selected;

  const list = $("#priority-list");
  list.replaceChildren();
  selected.slice(0, 5).forEach((site, index) => {
    const item = document.createElement("div");
    item.className = "priority-item";
    const place = state.customArea || !viewingPresetCenter()
      ? `현재 지도 후보 ${index + 1}`
      : regions[state.region].placeNames[index % regions[state.region].placeNames.length];
    item.innerHTML = `
      <span class="priority-rank">${index + 1}</span>
      <div><strong>${place}</strong><small>${site.id} · 위험확률 ${Math.round(site.riskScore * 100)}%</small></div>
      <span class="priority-score">${(site.greedyScore * 100).toFixed(0)}점</span>
      <span class="priority-cost">${site.cost.toFixed(1)}억</span>`;
    item.addEventListener("click", () => {
      selectCell(site);
      satelliteMap.panTo(site.latlng);
    });
    list.append(item);
  });

  if (!selected.length) {
    list.innerHTML = `<p class="decision-note">현재 기준을 만족하는 후보가 없습니다. 고위험 판정 기준을 낮춰보세요.</p>`;
  }

  const restored = Math.round(selected.reduce((sum, site) => sum + 520 + site.benefit * 390, 0) / 10) * 10;
  const people = selected.reduce((sum, site) => sum + site.people, 0);
  const usage = Math.round(spent / state.budget * 100);
  $("#board-budget").textContent = `${state.budget}억 원`;
  $("#restored-area").innerHTML = `${fmt.format(restored)} <small>ha</small>`;
  $("#selected-count").textContent = `${selected.length}곳`;
  $("#people-impact").textContent = `${people.toFixed(1)}천 명`;
  $("#budget-use").textContent = `${usage}%`;
  $("#impact-track").style.width = `${usage}%`;
  renderSites();
  renderRoute();
}

function renderSites() {
  mapLayers.sites.clearLayers();
  state.selectedSites.slice(0, 7).forEach((site, index) => {
    const marker = L.circleMarker(site.latlng, {
      radius: 9,
      color: "#c9523c",
      weight: 3,
      fillColor: "#fff",
      fillOpacity: 1
    });
    marker.bindTooltip(`${index + 1}순위 · ${site.id}`, { direction: "top" });
    marker.on("click", () => selectCell(site));
    mapLayers.sites.addLayer(marker);
  });
}

function closestCellTo(point) {
  return state.cells.reduce((best, cell) => {
    const distance = Math.hypot(cell.x - point.x, cell.y - point.y);
    return distance < best.distance ? { cell, distance } : best;
  }, { cell: state.cells[0], distance: Infinity }).cell;
}

function aStar(start, goal) {
  const byKey = new Map(state.cells.map(cell => [`${cell.row},${cell.col}`, cell]));
  const key = cell => `${cell.row},${cell.col}`;
  const open = [start];
  const cameFrom = new Map();
  const g = new Map([[key(start), 0]]);
  const f = new Map([[key(start), Math.abs(start.row - goal.row) + Math.abs(start.col - goal.col)]]);
  const closed = new Set();

  while (open.length) {
    open.sort((a, b) => (f.get(key(a)) ?? Infinity) - (f.get(key(b)) ?? Infinity));
    const current = open.shift();
    const currentKey = key(current);
    if (currentKey === key(goal)) {
      const path = [current];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        const previous = cameFrom.get(cursor);
        path.unshift(previous);
        cursor = key(previous);
      }
      return path;
    }
    closed.add(currentKey);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => {
      const neighbor = byKey.get(`${current.row + dr},${current.col + dc}`);
      if (!neighbor || closed.has(key(neighbor))) return;
      const tentative = (g.get(currentKey) ?? Infinity) + 1 + neighbor.riskScore * 1.4 + neighbor.bareSoil / 130;
      if (tentative < (g.get(key(neighbor)) ?? Infinity)) {
        cameFrom.set(key(neighbor), current);
        g.set(key(neighbor), tentative);
        f.set(key(neighbor), tentative + Math.abs(neighbor.row - goal.row) + Math.abs(neighbor.col - goal.col));
        if (!open.includes(neighbor)) open.push(neighbor);
      }
    });
  }
  return [];
}

function renderRoute() {
  mapLayers.route.clearLayers();
  if (!state.selectedSites.length) return;
  const visibleCenters = state.managementCenters.filter(center => center.visible);
  const startPoint = visibleCenters[Math.min(3, visibleCenters.length - 1)] || { x: 0.12, y: 0.82 };
  const start = closestCellTo(startPoint);
  const goal = state.selectedSites[0];
  const path = aStar(start, goal);
  if (!path.length) return;
  const coordinates = path.map(cell => cell.latlng);
  mapLayers.route.addLayer(L.polyline(coordinates, { color: "#fff", weight: 7, opacity: 0.88, interactive: false }));
  mapLayers.route.addLayer(L.polyline(coordinates, { color: "#214c41", weight: 3, opacity: 1, dashArray: "6 7", interactive: false }));
}

function setLayerVisible(name, visible) {
  const layer = mapLayers[name];
  if (!layer || !satelliteMap) return;
  if (visible && !satelliteMap.hasLayer(layer)) layer.addTo(satelliteMap);
  if (!visible && satelliteMap.hasLayer(layer)) satelliteMap.removeLayer(layer);
}

function updateLayerVisibility() {
  if (!satelliteMap) return;
  $$("[data-layer]").forEach(input => setLayerVisible(input.dataset.layer, input.checked));
  $("#map-legend").style.display = $("[data-layer=risk]").checked ? "flex" : "none";
}

function coordinateRange(first, second, positiveSuffix, negativeSuffix) {
  const values = [Math.abs(first), Math.abs(second)].sort((a, b) => a - b);
  const suffix = (first + second) / 2 >= 0 ? positiveSuffix : negativeSuffix;
  return `${values[0].toFixed(2)}–${values[1].toFixed(2)}°${suffix}`;
}

function formatBounds(bounds) {
  return `${coordinateRange(bounds.getSouth(), bounds.getNorth(), "N", "S")} · ${coordinateRange(bounds.getWest(), bounds.getEast(), "E", "W")}`;
}

function viewingPresetCenter() {
  return Boolean(state.focusBounds?.contains(state.analysisBounds.getCenter()));
}

function updateAreaLabels() {
  const region = regions[state.region];
  const title = viewingPresetCenter()
    ? `${region.name}${state.customArea ? " · 사용자 지정" : ""}`
    : "이동한 지도 위치";
  $("#map-region-title").textContent = `${title} · 위·경도 연동`;
  $("#map-coordinate").textContent = formatBounds(state.analysisBounds);
  $("#area-coordinates").textContent = `현재 화면 ${formatBounds(state.analysisBounds)}`;
  $("#observed-date").textContent = region.observed;
  const resolution = Math.max(1, Math.round(Math.sqrt(state.cellArea)));
  $(".map-caption p").textContent = `위치기반 모의 분석 · 현재 화면 ${fmt.format(state.cells.length)}셀 · CA ${CA_GENERATIONS}세대 · 약 ${resolution} × ${resolution} km`;
}

function beginAreaSelection() {
  state.drawingArea = !state.drawingArea;
  state.areaPoints = [];
  mapLayers.temporary.clearLayers();
  const button = $("#area-select-button");
  const instruction = $("#selection-instruction");
  button.classList.toggle("active", state.drawingArea);
  button.innerHTML = state.drawingArea
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>구역 지정 취소'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/></svg>지도에서 분석 구역 지정';
  instruction.classList.toggle("show", state.drawingArea);
  $("#selection-instruction span").textContent = "첫 번째 모서리를 지도에서 클릭하세요";
  $("#satellite-map").classList.toggle("area-selecting", state.drawingArea);
}

function finishAreaSelection() {
  state.drawingArea = false;
  state.areaPoints = [];
  mapLayers.temporary.clearLayers();
  $("#area-select-button").classList.remove("active");
  $("#area-select-button").innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/></svg>지도에서 분석 구역 지정';
  $("#selection-instruction").classList.remove("show");
  $("#satellite-map").classList.remove("area-selecting");
}

function handleMapClick(event) {
  if (!state.drawingArea) return;
  if (!state.areaPoints.length) {
    state.areaPoints.push(event.latlng);
    mapLayers.temporary.addLayer(L.circleMarker(event.latlng, {
      radius: 7, color: "#d5ef6c", weight: 3, fillColor: "#123a30", fillOpacity: 1
    }));
    $("#selection-instruction span").textContent = "반대편 모서리를 한 번 더 클릭하세요";
    return;
  }

  const bounds = L.latLngBounds(state.areaPoints[0], event.latlng);
  if (Math.abs(bounds.getNorth() - bounds.getSouth()) < 0.03 || Math.abs(bounds.getEast() - bounds.getWest()) < 0.03) {
    $("#selection-instruction span").textContent = "조금 더 넓은 범위로 두 번째 모서리를 선택하세요";
    return;
  }
  state.focusBounds = copyBounds(bounds);
  state.analysisBounds = copyBounds(bounds);
  state.customArea = true;
  finishAreaSelection();
  renderMap({ fit: true });
  showToast("사용자 지정 구역 분석 완료", `${state.cells.length}개 격자를 새 좌표 범위로 계산했습니다.`);
}

function showToast(title, message) {
  const toast = $("#toast");
  $("#toast strong").textContent = title;
  $("#toast small").textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function setDefaultRegionBounds() {
  state.focusBounds = L.latLngBounds(regions[state.region].bounds);
  state.analysisBounds = copyBounds(state.focusBounds);
  state.customArea = false;
}

function runAnalysis(showMessage = true, fit = false) {
  state.region = $("#region-select").value;
  state.threshold = Number($("#threshold-range").value);
  state.budget = Number($("#budget-range").value);
  if (!state.analysisBounds) setDefaultRegionBounds();
  renderMap({ fit });
  if (showMessage) showToast("분석이 갱신되었습니다", `새 조건으로 ${state.cells.length}개 격자를 다시 분류했습니다.`);
}

function updateRanges() {
  state.threshold = Number($("#threshold-range").value);
  state.budget = Number($("#budget-range").value);
  $("#threshold-output").textContent = `${state.threshold}%`;
  $("#budget-output").textContent = `${state.budget}억 원`;
  updateSummary();
  updateGreedyPlan();
}

function initializeEvents() {
  $("#run-analysis").addEventListener("click", () => {
    const button = $("#run-analysis");
    button.disabled = true;
    button.style.opacity = ".7";
    window.setTimeout(() => {
      runAnalysis(true, false);
      button.disabled = false;
      button.style.opacity = "1";
    }, 260);
  });
  $("#region-select").addEventListener("change", () => {
    state.region = $("#region-select").value;
    setDefaultRegionBounds();
    finishAreaSelection();
    runAnalysis(true, true);
  });
  $("#area-select-button").addEventListener("click", beginAreaSelection);
  $("#threshold-range").addEventListener("input", updateRanges);
  $("#budget-range").addEventListener("input", updateRanges);
  $$("[data-layer]").forEach(input => input.addEventListener("change", updateLayerVisibility));
  $("#reset-button").addEventListener("click", () => {
    $("#region-select").value = "gobi";
    $("#start-date").value = "2021-08";
    $("#end-date").value = "2026-08";
    $("#threshold-range").value = "65";
    $("#budget-range").value = "30";
    $$("[data-layer]").forEach((input, index) => { input.checked = index === 0; });
    state.region = "gobi";
    setDefaultRegionBounds();
    finishAreaSelection();
    updateRanges();
    runAnalysis(true, true);
  });

  const dialog = $("#info-dialog");
  $("#info-button").addEventListener("click", () => dialog.showModal());
  $(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });

  $$(".algorithm-card").forEach(card => {
    card.addEventListener("click", () => {
      $$(".algorithm-card").forEach(item => item.classList.remove("active"));
      card.classList.add("active");
      const focus = card.dataset.focusLayer;
      if (["risk", "zones", "network"].includes(focus)) {
        $(`[data-layer="${focus}"]`).checked = true;
      }
      if (focus === "network") $("[data-layer=route]").checked = true;
      updateLayerVisibility();
      $("#analysis-map").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  $("#zoom-in").addEventListener("click", () => satelliteMap?.zoomIn());
  $("#zoom-out").addEventListener("click", () => satelliteMap?.zoomOut());
  $("#zoom-reset").addEventListener("click", () => {
    if (!satelliteMap || !state.focusBounds) return;
    state.analysisBounds = copyBounds(state.focusBounds);
    renderMap({ fit: true });
  });

  const sections = ["analysis-map", "restoration", "methodology"];
  const links = $$(".main-nav a");
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      links.forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
    });
  }, { rootMargin: "-30% 0px -60%" });
  sections.forEach(id => observer.observe(document.getElementById(id)));
}

initializeEvents();
if (initializeSatelliteMap()) {
  setDefaultRegionBounds();
  runAnalysis(false, true);
}
