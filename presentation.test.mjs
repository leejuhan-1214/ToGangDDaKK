import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoryTimeline,normalizePresentationSnapshot} from './presentation.mjs';

function fakeTime(){let now=0,serial=0;const timers=new Map();return {setTimer(fn,delay){const id=++serial;timers.set(id,{at:now+delay,fn});return id;},clearTimer(id){timers.delete(id);},advance(ms){const end=now+ms;while(true){const first=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!first||first[1].at>end)break;now=first[1].at;timers.delete(first[0]);first[1].fn();}now=end;},get pending(){return timers.size;}};}

test('presentation risk percentage uses land area and retains units and true score reduction',()=>{
 const result=normalizePresentationSnapshot({regionName:'해안',hasLand:true,landArea:800,riskArea:200,riskPercent:99,budget:30,spent:11.5,selectedCount:99,selected:[{risk:70,cost:11.5,area:12}],beforeScore:60,afterScore:59.25,reductionPercent:30});
 assert.equal(result.riskPercent,25);assert.equal(result.scoreDifference,.75);assert.equal(result.selectedCount,1);assert.equal(result.spent,11.5);assert.equal(result.selected[0].area,12);assert.equal(result.reductionPercent,30);
});
test('ocean snapshot cannot fabricate zero-risk land or restoration benefits',()=>{
 const result=normalizePresentationSnapshot({hasLand:false,landArea:100,riskArea:99,budget:30,spent:12,selected:[{risk:90,cost:12,area:100}],beforeScore:99,afterScore:60,explanation:{summary:'위험'}});
 assert.equal(result.landArea,0);assert.equal(result.riskPercent,null);assert.equal(result.beforeScore,null);assert.equal(result.afterScore,null);assert.equal(result.scoreDifference,null);assert.equal(result.selectedCount,0);assert.equal(result.spent,0);assert.equal(result.explanation,null);assert.equal(result.budget,30);
});
test('empty and non-finite inputs cannot become NaN in exported presentation',()=>{
 const result=normalizePresentationSnapshot({landArea:NaN,riskArea:Infinity,budget:-10,beforeScore:NaN,afterScore:Infinity});
 assert.equal(result.hasLand,false);assert.equal(result.budget,0);assert.equal(result.riskPercent,null);assert.equal(result.beforeScore,null);assert.equal(result.afterScore,null);
});
test('autoplay advances five stages and stops permanently at completion',()=>{
 const clock=fakeTime(),states=[],timeline=createStoryTimeline({...clock,onChange:s=>states.push(s)});
 timeline.start();timeline.play();clock.advance(32000);
 assert.equal(timeline.state.index,4);assert.equal(timeline.state.playing,false);assert.equal(clock.pending,0);
 assert.deepEqual(states.filter(s=>s.reason==='start'||s.reason==='step').map(s=>[s.index,s.after]),[[0,false],[1,false],[2,false],[3,true],[4,false]]);
 clock.advance(100000);assert.equal(timeline.state.index,4);timeline.play();assert.equal(clock.pending,0);
});
test('pause, manual jump, close and restart cancel obsolete playback timers',()=>{
 const clock=fakeTime(),timeline=createStoryTimeline({...clock});
 timeline.start();timeline.play();clock.advance(3000);timeline.pause();assert.equal(clock.pending,0);clock.advance(15000);assert.equal(timeline.state.index,0);
 timeline.play();clock.advance(2000);timeline.select(2);clock.advance(6000);assert.equal(timeline.state.index,2);clock.advance(2000);assert.equal(timeline.state.index,3);
 timeline.close();assert.equal(clock.pending,0);clock.advance(40000);assert.equal(timeline.state.active,false);
 timeline.start();assert.deepEqual(timeline.state,{active:true,playing:false,index:0,after:false});assert.equal(clock.pending,0);
});
test('comparison is confined to step four and auto-play has at least seven seconds per step',()=>{
 const clock=fakeTime(),timeline=createStoryTimeline({...clock,delay:100});
 timeline.start();timeline.toggleComparison(true);assert.equal(timeline.state.after,false);
 timeline.select(3);assert.equal(timeline.state.after,true);timeline.toggleComparison(false);assert.equal(timeline.state.after,false);
 timeline.select(0);timeline.play();clock.advance(6999);assert.equal(timeline.state.index,0);clock.advance(1);assert.equal(timeline.state.index,1);
});
