import {gaussianClassify} from './model.mjs';

// Educational comparison values: means of the model's stable class, not
// observed local targets or recommended restoration outcomes.
const features = Object.freeze([
  {key:'ndvi', label:'식생지수', reference:0.57, format:value=>value.toFixed(2)},
  {key:'ndviTrend', label:'식생 변화', reference:-2, format:value=>`${value.toFixed(1)}%`},
  {key:'rainfall', label:'월 강수량', reference:112, format:value=>`${value.toFixed(1)} mm`},
  {key:'moisture', label:'토양 수분', reference:25, format:value=>`${value.toFixed(1)}%`},
  {key:'temperature', label:'지표 온도', reference:24, format:value=>`${value.toFixed(1)}°C`},
  {key:'bareSoil', label:'나지 비율', reference:18, format:value=>`${value.toFixed(1)}%`},
]);

const note = '합성 입력을 하나씩 교육용 기준값으로 바꾼 비교입니다. 인과관계나 합이 100%인 기여율이 아닙니다. CA 보정 차이는 초기화·환경·이웃 규칙을 함께 포함합니다.';
const validProbability = value=>Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Explain sensitivity of the initial NB score, separately from the current CA
 * score. All scores/deltas use a 0–100 scale (deltas: percentage points).
 * Return null for water or incomplete/non-finite model output.
 */
export function explainCell(cell) {
  if (!cell || cell.isLand === false || !validProbability(cell.nbRiskScore) || !validProbability(cell.riskScore)) return null;
  const values = features.map(feature=>cell[feature.key]);
  if (!values.every(Number.isFinite)) return null;

  const nbScore = cell.nbRiskScore * 100;
  const caScore = cell.riskScore * 100;
  const factors = features.map((feature,index)=>{
    const comparison = [...values];
    comparison[index] = feature.reference;
    const {probabilities} = gaussianClassify(comparison);
    const comparisonScore = (probabilities[2] + probabilities[3]) * 100;
    const delta = nbScore - comparisonScore;
    return {
      key:feature.key,
      label:feature.label,
      valueText:feature.format(values[index]),
      delta,
      detail:`교육용 기준 ${feature.format(feature.reference)}으로 대체하면 NB 점수 ${delta.toFixed(1)}%p 감소 · 다른 입력은 유지`,
    };
  }).filter(factor=>Number.isFinite(factor.delta) && factor.delta > 1e-6)
    .sort((first,second)=>second.delta-first.delta)
    .slice(0,3);

  return {
    summary:factors.length
      ? `${factors.map(factor=>factor.label).join(' · ')} 입력이 기준값 비교에서 가장 큰 점수 차이를 보입니다.`
      : '각 입력을 교육용 기준값으로 바꿔도 초기 NB 점수가 낮아지지 않습니다.',
    factors,
    nbScore,
    caScore,
    neighborDelta:caScore-nbScore,
    note,
  };
}
