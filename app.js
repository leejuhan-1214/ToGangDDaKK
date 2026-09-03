"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const GRID_COLS = 28;
const GRID_ROWS = 18;
const CELL_W = 31;
const CELL_H = 30;
const GRID_X = 47;
const GRID_Y = 40;

const classInfo = [
  { label: "안정", color: "#5d9667" },
  { label: "주의", color: "#e1bb52" },
  { label: "위험", color: "#e98247" },
  { label: "심각", color: "#c9523c" }
];

const regions = {
  gobi: {
    name: "몽골 남부 · 고비 전이지대",
    coordinate: "43.2°N–46.8°N · 101.0°E–108.7°E",
    observed: "2026.08.28",
    prefix: "GB",
    factor: 0.05,
    rainAdjust: -8,
    cellArea: 64,
    placeNames: ["달란자드가드 동부", "옴노고비 북단", "차강오보 남부", "만달오보 서부", "구르반테스 동부"]
  },
  sahel: {
    name: "사헬 서부 · 세네갈 북부",
    coordinate: "14.7°N–16.3°N · 13.5°W–15.8°W",
    observed: "2026.08.26",
    prefix: "SH",
    factor: 0.11,
    rainAdjust: 15,
    cellArea: 49,
    placeNames: ["루가 북동부", "마탐 서부", "포도르 남부", "링게르 동부", "페를로 초원"]
  },
  aral: {
    name: "중앙아시아 · 아랄해 동부",
    coordinate: "43.1°N–46.2°N · 60.2°E–64.9°E",
    observed: "2026.08.24",
    prefix: "AR",
    factor: 0.17,
    rainAdjust: -15,
    cellArea: 81,
    placeNames: ["키질로르다 서부", "아랄 동부", "시르다리야 하류", "카라테렌 남부", "사크사울 북부"]
  }
};

const model = [
  { mean: [0.57, -2, 112, 25, 24, 18], sd: [0.12, 6, 25, 6, 4, 11], prior: 0.24 },
  { mean: [0.41, -8, 82, 19, 29, 36], sd: [0.11, 6, 22, 5, 4, 12], prior: 0.34 },
  { mean: [0.25, -16, 53, 12, 34, 57], sd: [0.10, 7, 18, 4, 4, 12], prior: 0.27 },
  { mean: [0.12, -27, 27, 7, 39, 78], sd: [0.08, 8, 13, 3, 4, 10], prior: 0.15 }
];

const centers = [
  { x: 196, y: 160, label: "A" },
  { x: 411, y: 126, label: "B" },
  { x: 704, y: 193, label: "C" },
  { x: 300, y: 406, label: "D" },
  { x: 627, y: 428, label: "E" }
];
const zoneColors = ["#5c9a88", "#7dac61", "#c8a257", "#9873a5", "#6489a5"];

const state = {
  cells: [],
  selected: null,
  selectedSites: [],
  region: "gobi",
  threshold: 65,
  budget: 30,
  zoom: 1
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const fmt = new Intl.NumberFormat("ko-KR");

function seeded(row, col, salt = 0) {
  const regionSeed = { gobi: 11.7, sahel: 29.3, aral: 47.1 }[state.region];
  const value = Math.sin((row + 1) * 91.733 + (col + 1) * 37.719 + salt * 19.19 + regionSeed) * 43758.5453;
  return value - Math.floor(value);
}

function isInsideRegion(row, col) {
  const dx = (col - 13.5) / 13.4;
  const dy = (row - 8.6) / 8.15;
  const main = dx * dx + dy * dy < 1;
  const carved = (col < 3 && row < 5) || (col > 24 && row > 13) || (col < 2 && row > 12);
  return main && !carved;
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

function createCellData(row, col) {
  const x = col / (GRID_COLS - 1);
  const y = row / (GRID_ROWS - 1);
  const pocket = Math.sin(x * 8.7 + y * 3.2) * 0.08 + Math.cos(y * 10.1 - x * 2.7) * 0.06;
  const noise = (seeded(row, col) - 0.5) * 0.16;
  const region = regions[state.region];
  const periodYears = Math.max(1, Number($("#end-date").value.slice(0, 4)) - Number($("#start-date").value.slice(0, 4)));
  const timePressure = clamp((periodYears - 3) * 0.012, -0.02, 0.06);
  const baseRisk = clamp(0.08 + x * 0.36 + y * 0.29 + pocket + noise + region.factor + timePressure, 0.02, 0.98);

  const ndvi = clamp(0.67 - baseRisk * 0.60 + (seeded(row, col, 1) - 0.5) * 0.08, 0.05, 0.75);
  const ndviTrend = clamp(-1 - baseRisk * 28 + (seeded(row, col, 2) - 0.5) * 7, -38, 4);
  const rainfall = clamp(132 - baseRisk * 105 + region.rainAdjust + (seeded(row, col, 3) - 0.5) * 24, 8, 165);
  const moisture = clamp(29 - baseRisk * 23 + (seeded(row, col, 4) - 0.5) * 5, 3, 31);
  const temperature = clamp(22 + baseRisk * 18 + (seeded(row, col, 5) - 0.5) * 4, 19, 43);
  const bareSoil = clamp(13 + baseRisk * 72 + (seeded(row, col, 6) - 0.5) * 12, 7, 92);
  const classification = gaussianClassify([ndvi, ndviTrend, rainfall, moisture, temperature, bareSoil]);
  const riskScore = classification.probabilities[2] + classification.probabilities[3];
  const ecological = clamp(0.45 + seeded(row, col, 7) * 0.55, 0, 1);
  const people = 1.2 + seeded(row, col, 8) * 5.8;
  const cost = 3.6 + seeded(row, col, 9) * 5.2 + ecological * 1.2;
  const px = GRID_X + col * CELL_W + CELL_W / 2;
  const py = GRID_Y + row * CELL_H + CELL_H / 2;
  const zone = centers.reduce((best, center, index) => {
    const distance = Math.hypot(px - center.x, py - center.y);
    return distance < best.distance ? { index, distance } : best;
  }, { index: 0, distance: Infinity }).index;

  return {
    row, col, px, py, zone, ndvi, ndviTrend, rainfall, moisture, temperature, bareSoil,
    ecological, people, cost, riskScore, ...classification,
    id: `${region.prefix}-${String.fromCharCode(65 + row)}${String(col + 1).padStart(2, "0")}`
  };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function renderMap() {
  const riskGroup = $("#risk-cells");
  const zoneGroup = $("#zone-cells");
  riskGroup.replaceChildren();
  zoneGroup.replaceChildren();
  state.cells = [];

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (!isInsideRegion(row, col)) continue;
      const cell = createCellData(row, col);
      state.cells.push(cell);

      const rect = svgElement("rect", {
        x: GRID_X + col * CELL_W + 1,
        y: GRID_Y + row * CELL_H + 1,
        width: CELL_W - 2,
        height: CELL_H - 2,
        rx: 2.4,
        fill: classInfo[cell.classIndex].color,
        class: "risk-cell",
        tabindex: "0",
        role: "button",
        "aria-label": `${cell.id} 격자, ${classInfo[cell.classIndex].label}, 확신도 ${Math.round(cell.confidence * 100)}퍼센트`
      });
      rect.dataset.id = cell.id;
      rect.addEventListener("mouseenter", event => showTooltip(event, cell));
      rect.addEventListener("mousemove", moveTooltip);
      rect.addEventListener("mouseleave", hideTooltip);
      rect.addEventListener("click", () => selectCell(cell));
      rect.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectCell(cell);
        }
      });
      riskGroup.append(rect);

      const zoneRect = svgElement("rect", {
        x: GRID_X + col * CELL_W + 1,
        y: GRID_Y + row * CELL_H + 1,
        width: CELL_W - 2,
        height: CELL_H - 2,
        rx: 2.4,
        fill: zoneColors[cell.zone],
        class: "zone-cell"
      });
      zoneGroup.append(zoneRect);
    }
  }

  renderCenters();
  renderPrimNetwork();
  updateSummary();
  updateGreedyPlan();
  const suggested = [...state.cells].sort((a, b) => b.riskScore - a.riskScore)[Math.floor(state.cells.length * 0.12)];
  selectCell(suggested || state.cells[0]);
}

function renderCenters() {
  const group = $("#center-layer");
  group.replaceChildren();
  centers.forEach(center => {
    const node = svgElement("g", { class: "center-node" });
    node.append(svgElement("circle", { cx: center.x, cy: center.y, r: 12 }));
    const text = svgElement("text", { x: center.x, y: center.y + 0.5 });
    text.textContent = center.label;
    node.append(text);
    group.append(node);
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
  const group = $("#network-layer");
  group.replaceChildren();
  primEdges(centers).forEach(edge => {
    const start = centers[edge.from];
    const end = centers[edge.to];
    group.append(svgElement("path", {
      d: `M${start.x} ${start.y} L${end.x} ${end.y}`,
      class: "network-edge"
    }));
  });
}

function updateSummary() {
  const counts = [0, 0, 0, 0];
  state.cells.forEach(cell => { counts[cell.classIndex] += 1; });
  const total = state.cells.length;
  const highRiskCells = state.cells.filter(cell => cell.riskScore * 100 >= state.threshold);
  const highPercent = Math.round(highRiskCells.length / total * 100);
  const circumference = 2 * Math.PI * 41;
  $("#risk-percent").textContent = `${highPercent}%`;
  $("#donut-value").style.strokeDasharray = `${circumference * highPercent / 100} ${circumference}`;
  $("#risk-area").innerHTML = `${fmt.format(highRiskCells.length * regions[state.region].cellArea)} <small>km²</small>`;
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
  state.selected = cell;
  $$(".risk-cell.selected").forEach(element => element.classList.remove("selected"));
  const element = $(`.risk-cell[data-id="${cell.id}"]`);
  if (element) element.classList.add("selected");

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

function showTooltip(event, cell) {
  const tooltip = $("#map-tooltip");
  tooltip.innerHTML = `<strong>${cell.id} · ${classInfo[cell.classIndex].label}</strong>위험확률 ${Math.round(cell.riskScore * 100)}% · NDVI ${cell.ndvi.toFixed(2)}`;
  tooltip.classList.add("show");
  moveTooltip(event);
}

function moveTooltip(event) {
  const tooltip = $("#map-tooltip");
  const stage = $("#map-stage").getBoundingClientRect();
  const left = clamp(event.clientX - stage.left + 12, 8, stage.width - 158);
  const top = clamp(event.clientY - stage.top + 12, 8, stage.height - 58);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  $("#map-tooltip").classList.remove("show");
}

function updateGreedyPlan() {
  const candidates = state.cells
    .filter(cell => cell.riskScore * 100 >= state.threshold)
    .map(cell => ({
      ...cell,
      benefit: cell.riskScore * (0.62 + cell.ecological * 0.5) * (1 + cell.people / 16),
      greedyScore: 0
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
    const place = regions[state.region].placeNames[index % regions[state.region].placeNames.length];
    item.innerHTML = `
      <span class="priority-rank">${index + 1}</span>
      <div><strong>${place}</strong><small>${site.id} · 위험확률 ${Math.round(site.riskScore * 100)}%</small></div>
      <span class="priority-score">${(site.greedyScore * 100).toFixed(0)}점</span>
      <span class="priority-cost">${site.cost.toFixed(1)}억</span>`;
    item.addEventListener("click", () => selectCell(site));
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
  const group = $("#site-layer");
  group.replaceChildren();
  state.selectedSites.slice(0, 7).forEach((site, index) => {
    const marker = svgElement("g", { class: "site-marker" });
    marker.append(svgElement("circle", { cx: site.px, cy: site.py, r: 12, class: "site-pulse" }));
    marker.append(svgElement("circle", { cx: site.px, cy: site.py, r: 11 }));
    const text = svgElement("text", { x: site.px, y: site.py + .5 });
    text.textContent = index + 1;
    marker.append(text);
    marker.addEventListener("click", () => selectCell(site));
    group.append(marker);
  });
}

function closestCellTo(point) {
  return state.cells.reduce((best, cell) => {
    const distance = Math.hypot(cell.px - point.x, cell.py - point.y);
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
  const group = $("#route-layer");
  group.replaceChildren();
  if (!state.selectedSites.length) return;
  const start = closestCellTo(centers[3]);
  const goal = state.selectedSites[0];
  const path = aStar(start, goal);
  if (!path.length) return;
  const points = path.map(cell => `${cell.px},${cell.py}`).join(" ");
  group.append(svgElement("polyline", { points, class: "route-path" }));
  group.append(svgElement("polyline", { points, class: "route-path-accent" }));
}

function updateLayerVisibility() {
  const stage = $("#map-stage");
  const checked = Object.fromEntries($$("[data-layer]").map(input => [input.dataset.layer, input.checked]));
  stage.classList.toggle("no-risk", !checked.risk);
  stage.classList.toggle("show-zones", checked.zones);
  stage.classList.toggle("show-network", checked.network);
  stage.classList.toggle("show-route", checked.route);
  $("#map-legend").style.display = checked.risk ? "flex" : "none";
}

function runAnalysis(showToast = true) {
  state.region = $("#region-select").value;
  state.threshold = Number($("#threshold-range").value);
  state.budget = Number($("#budget-range").value);
  const region = regions[state.region];
  $("#map-region-title").textContent = region.name;
  $("#map-coordinate").textContent = region.coordinate;
  $("#observed-date").textContent = region.observed;
  renderMap();
  updateLayerVisibility();
  if (showToast) {
    const toast = $("#toast");
    $("#toast small").textContent = `새 조건으로 ${state.cells.length}개 격자를 다시 분류했습니다.`;
    toast.classList.add("show");
    window.clearTimeout(runAnalysis.toastTimer);
    runAnalysis.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
  }
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
      runAnalysis(true);
      button.disabled = false;
      button.style.opacity = "1";
    }, 320);
  });
  $("#region-select").addEventListener("change", () => runAnalysis(true));
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
    updateRanges();
    runAnalysis(true);
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
        const input = $(`[data-layer="${focus}"]`);
        input.checked = true;
      }
      if (focus === "network") $("[data-layer=route]").checked = true;
      updateLayerVisibility();
      $("#analysis-map").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  $("#zoom-in").addEventListener("click", () => setZoom(state.zoom + .12));
  $("#zoom-out").addEventListener("click", () => setZoom(state.zoom - .12));
  $("#zoom-reset").addEventListener("click", () => setZoom(1));

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

function setZoom(value) {
  state.zoom = clamp(value, 1, 1.48);
  $("#risk-map").style.transform = `scale(${state.zoom})`;
}

initializeEvents();
updateRanges();
runAnalysis(false);
