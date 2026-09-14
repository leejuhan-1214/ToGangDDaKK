import test from 'node:test';
import assert from 'node:assert/strict';
import {gaussianClassify} from './model.mjs';
import {explainCell} from './explanation.mjs';

const keys=['ndvi','ndviTrend','rainfall','moisture','temperature','bareSoil'];
const stable=[0.57,-2,112,25,24,18];
const parameters=[
  {mean:stable,sd:[0.12,6,25,6,4,11],prior:0.24},
  {mean:[0.41,-8,82,19,29,36],sd:[0.11,6,22,5,4,12],prior:0.34},
  {mean:[0.25,-16,53,12,34,57],sd:[0.10,7,18,4,4,12],prior:0.27},
  {mean:[0.12,-27,27,7,39,78],sd:[0.08,8,13,3,4,10],prior:0.15},
];

// Independent density-product oracle, without the implementation's log-sum-exp
// path. Values in these fixtures are ordinary finite model inputs.
function directRisk(values) {
  const likelihoods=parameters.map(({mean,sd,prior})=>values.reduce((density,value,index)=>{
    const z=(value-mean[index])/sd[index];
    return density*Math.exp(-0.5*z*z)/(sd[index]*Math.sqrt(2*Math.PI));
  },prior));
  return (likelihoods[2]+likelihoods[3])/likelihoods.reduce((sum,value)=>sum+value,0);
}

function fixture(values,currentScore=0.48) {
  const {probabilities}=gaussianClassify(values);
  return {
    isLand:true,
    ...Object.fromEntries(keys.map((key,index)=>[key,values[index]])),
    nbRiskScore:probabilities[2]+probabilities[3],
    riskScore:currentScore,
  };
}
const close=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} ≠ ${expected}`);

test('risk explanations rank independent one-input comparisons in percentage points',()=>{
  const values=[0.31,-13,73,15,32,48];
  const cell=fixture(values);
  const original=structuredClone(cell);
  const result=explainCell(cell);
  const expected=keys.map((key,index)=>{
    const comparison=[...values];
    comparison[index]=stable[index];
    return {key,delta:100*(directRisk(values)-directRisk(comparison))};
  }).filter(factor=>factor.delta>1e-6).sort((a,b)=>b.delta-a.delta).slice(0,3);
  assert.deepEqual(result.factors.map(factor=>factor.key),expected.map(factor=>factor.key));
  result.factors.forEach((factor,index)=>{
    close(factor.delta,expected[index].delta);
    assert.ok(factor.valueText && factor.detail.includes('교육용 기준'));
  });
  close(result.nbScore,100*directRisk(values));
  assert.equal(result.caScore,48);
  close(result.neighborDelta,result.caScore-result.nbScore);
  assert.deepEqual(cell,original,'explaining must not mutate the analyzed cell');
});

test('comparison deltas are not renormalized into a contribution percentage',()=>{
  const result=explainCell(fixture([0.31,-13,73,15,32,48]));
  const sum=result.factors.reduce((total,factor)=>total+factor.delta,0);
  assert.ok(Math.abs(sum-100)>1,'these independent comparisons do not have to total 100');
  assert.match(result.note,/인과관계/);
  assert.match(result.note,/초기화·환경·이웃/);
});

test('CA updates do not change the NB factor ranking or baseline',()=>{
  const cell=fixture([0.31,-13,73,15,32,48],0.2);
  const lower=explainCell(cell);
  const upper=explainCell({...cell,riskScore:0.8});
  assert.deepEqual(lower.factors,upper.factors);
  assert.equal(lower.nbScore,upper.nbScore);
  assert.equal(lower.caScore,20);
  assert.equal(upper.caScore,80);
  close(upper.neighborDelta-lower.neighborDelta,60);
});

test('stable-reference inputs have no fabricated risk-raising factors',()=>{
  const result=explainCell(fixture(stable));
  assert.deepEqual(result.factors,[]);
  assert.match(result.summary,/낮아지지 않습니다/);
});

test('water and invalid model output cannot produce risk explanations',()=>{
  const valid=fixture([0.31,-13,73,15,32,48]);
  assert.equal(explainCell({...valid,isLand:false}),null);
  assert.equal(explainCell({isLand:false,riskScore:null,nbRiskScore:null}),null);
  assert.equal(explainCell(null),null);
  for(const key of [...keys,'riskScore','nbRiskScore']) {
    for(const value of [undefined,null,NaN,Infinity,-Infinity]) {
      assert.equal(explainCell({...valid,[key]:value}),null,`${key}=${value}`);
    }
  }
  for(const key of ['riskScore','nbRiskScore']) {
    assert.equal(explainCell({...valid,[key]:-0.1}),null);
    assert.equal(explainCell({...valid,[key]:1.1}),null);
  }
});
