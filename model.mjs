// Adapted from leejuhan-1214/ToGangDDaKK. All environmental and decision values are synthetic.
export const GRID_COLS = 64, GRID_ROWS = 48;
export const classInfo = [{label:"안정",color:"#61b28e"},{label:"주의",color:"#e6cc78"},{label:"위험",color:"#ed925c"},{label:"심각",color:"#ec615b"}];
export const regions = {
 gobi:{name:"고비 전이지대",sub:"몽골 남부",english:"GOBI DESERT",bounds:{south:43.2,north:46.8,west:101,east:108.7},center:[104.85,45],zoom:6.4,desc:"초원과 사막의 경계에서, 식생 변화와 복원 우선순위를 탐색합니다."},
 sahel:{name:"사헬 서부",sub:"세네갈 북부",english:"THE SAHEL",bounds:{south:14.7,north:16.3,west:-15.8,east:-13.5},center:[-14.65,15.5],zoom:7.7,desc:"사하라 남쪽의 건조 전이지대에서, 관리거점과 복원 전략을 비교합니다."},
 aral:{name:"아랄해 동부",sub:"중앙아시아",english:"ARAL SEA",bounds:{south:43.1,north:46.2,west:60.2,east:64.9},center:[62.5,44.65],zoom:7,desc:"호수 주변의 건조화 경관 위에서, 제한된 예산의 배분을 실험합니다."}
};
export const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const lerp=(a,b,t)=>a+(b-a)*t, smoothStep=v=>v*v*(3-2*v);
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
  const latitude = Math.abs(lat).toFixed(7);
  const longitude = Math.abs(normalizedLng).toFixed(7);
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

export function applyCellularAutomata(cells, generations = 3) {
  const severitySeed = [0.12, 0.36, 0.64, 0.86];
  let scores = cells.map(cell => clamp(
    severitySeed[cell.classIndex] * 0.72 + cell.riskScore * 0.28,
    0.02,
    0.98
  ));

  for (let generation = 0; generation < generations; generation += 1) {
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

function createCellData(row, col, bounds, years, centers) {
  const south = bounds.south;
  const north = bounds.north;
  const west = bounds.west;
  const east = bounds.east;
  const latStep = (north - south) / GRID_ROWS;
  const lngStep = (east - west) / GRID_COLS;
  const cellNorth = north - row * latStep;
  const cellSouth = north - (row + 1) * latStep;
  const cellWest = west + col * lngStep;
  const cellEast = west + (col + 1) * lngStep;
  const cellBounds = {south:cellSouth, north:cellNorth, west:cellWest, east:cellEast};
  const cellCenter = {lat:(cellNorth+cellSouth)/2, lng:(cellWest+cellEast)/2};
  const normalizedLng = normalizeLongitude(cellCenter.lng);
  const normalizedPoint = { x: (col + 0.5) / GRID_COLS, y: (row + 0.5) / GRID_ROWS };
  const periodYears = years;
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
  const zone = centers.reduce((best, center) => {
    const distance = distanceKm([cellCenter.lng, cellCenter.lat], center.coords);
    return distance < best.distance ? { colorIndex: center.index, distance } : best;
  }, { colorIndex: 0, distance: Infinity }).colorIndex;

  return {
    row, col, x: normalizedPoint.x, y: normalizedPoint.y, zone, ndvi, ndviTrend, rainfall, moisture,
    temperature, bareSoil, ecological, people, cost, riskScore, bounds: cellBounds,
    latlng: cellCenter, ...classification,
    id: geographicCellId(cellCenter.lat, normalizedLng)
  };
}

export function primEdges(points) {
  if (!points.length) return [];
  const connected = new Set([0]);
  const edges = [];
  while (connected.size < points.length) {
    let best = null;
    connected.forEach(from => {
      points.forEach((point, to) => {
        if (connected.has(to)) return;
        const distance = distanceKm(points[from].coords, point.coords);
        if (!best || distance < best.distance) best = { from, to, distance };
      });
    });
    if (!best) break;
    connected.add(best.to);
    edges.push(best);
  }
  return edges;
}

export function aStar(cells, start, goal) {
  const byKey = new Map(cells.map(cell => [`${cell.row},${cell.col}`, cell]));
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


export function distanceKm(a,b) {
 const rad=Math.PI/180, dlat=(b[1]-a[1])*rad, dlng=(b[0]-a[0])*rad;
 const h=Math.sin(dlat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlng/2)**2;
 return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function areaKm2(b) {
 return 6371**2*Math.abs(Math.sin(b.north*Math.PI/180)-Math.sin(b.south*Math.PI/180))*Math.abs(b.east-b.west)*Math.PI/180;
}
export function createManagementCenters(b) {
 // Quantized, globe-anchored spacing: bounded work from street zoom to world zoom.
 const levelX=clamp(Math.floor(Math.log2(360/((b.east-b.west)/8))),0,24);
 const levelY=clamp(Math.floor(Math.log2(180/((b.north-b.south)/6))),0,24);
 const columns=2**levelX, rows=2**levelY, stepX=360/columns, stepY=180/rows, centers=[];
 for(let row=Math.max(0,Math.floor((b.south+90)/stepY)-1);row<=Math.min(rows-1,Math.floor((b.north+90)/stepY)+1);row++){
  for(let col=Math.floor((b.west+180)/stepX)-1;col<=Math.floor((b.east+180)/stepX)+1;col++){
   const wrapped=((col%columns)+columns)%columns;
   const coords=[-180+(col+0.2+hashCoordinate(wrapped,row,101)*0.6)*stepX,-90+(row+0.2+hashCoordinate(wrapped,row,211)*0.6)*stepY];
   if(Math.abs(coords[1])>85.0511287798066)continue;
   centers.push({coords,index:centers.length,label:`H${levelX}-${levelY}-${wrapped}-${row}`,colorIndex:Math.floor(hashCoordinate(wrapped,row,307)*6),visible:coords[0]>=b.west&&coords[0]<=b.east&&coords[1]>=b.south&&coords[1]<=b.north});
  }
 }
 return centers;
}
export function analyze(bounds, {years=3,generations=3}={}) {
 if (![bounds.south,bounds.north,bounds.west,bounds.east,years,generations].every(Number.isFinite)) throw Error("Invalid analysis inputs");
 if(bounds.north<=bounds.south||bounds.east<=bounds.west||bounds.north>85.0511287798066||bounds.south< -85.0511287798066||bounds.east-bounds.west>360) throw Error("지도 표시에 맞는 위·경도 범위가 필요합니다.");
 const centers=createManagementCenters(bounds), cells=[];
 for(let row=0;row<GRID_ROWS;row++)for(let col=0;col<GRID_COLS;col++)cells.push(createCellData(row,col,bounds,years,centers));
 applyCellularAutomata(cells,clamp(Math.round(generations),0,8));
 cells.forEach((c,i)=>{c.index=i;c.area=areaKm2(c.bounds);c.coords=[c.latlng.lng,c.latlng.lat];});
 return {bounds:{...bounds},cells,centers,area:areaKm2(bounds)};
}
export function greedyPlan(cells,budget,threshold) {
 const candidates=cells.filter(c=>c.riskScore*100>=threshold).map(c=>{
 const benefit=c.riskScore*(0.62+c.ecological*0.5)*(1+c.people/16);
 return {...c,benefit,greedyScore:benefit/c.cost};
 }).sort((a,b)=>b.greedyScore-a.greedyScore||a.index-b.index);
 let spent=0; const selected=[];
 for(const c of candidates){if(selected.length>=7)break;if(spent+c.cost<=budget+1e-10){selected.push(c);spent+=c.cost;}}
 return {selected,spent,candidateCount:candidates.length};
}
export function restorationScores(cells,selected,effect) {
 const chosen=new Set(selected.map(c=>c.index)), amount=clamp(effect,0,100)/100;
 // A teaching assumption only: selected cells reduce 0–50% of their baseline risk.
 return cells.map(c=>c.riskScore*(chosen.has(c.index)?1-0.5*amount:1));
}
export function routeToTarget(analysis,target) {
 if(!target)return [];
 const visible=analysis.centers.filter(c=>c.visible);
 const hub=visible.reduce((best,c)=>!best||distanceKm(c.coords,target.coords)<distanceKm(best.coords,target.coords)?c:best,null);
 if(!hub)return [];
 const start=analysis.cells.reduce((best,c)=>distanceKm(c.coords,hub.coords)<distanceKm(best.coords,hub.coords)?c:best,analysis.cells[0]);
 return aStar(analysis.cells,start,target);
}
export function featureCollection(features=[]) {return {type:"FeatureCollection",features};}
export function polygon(cell,properties={}) {
 const b=cell.bounds;
 return {type:"Feature",id:cell.index,properties:{index:cell.index,...properties},geometry:{type:"Polygon",coordinates:[[[b.west,b.south],[b.east,b.south],[b.east,b.north],[b.west,b.north],[b.west,b.south]]]}};
}
export {gaussianClassify,riskClassFromScore,geographicField,geographicCellId};
