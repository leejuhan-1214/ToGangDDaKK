import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enhanceImageryRGBA,MAX_IMAGERY_OUTPUT_SIDE} from './imagery-quality.mjs';

function image(width,height,pixel){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(pixel(x,y),(y*width+x)*4);
  return {data,width,height};
}
const rgba=(result,x,y)=>[...result.data.slice((y*result.width+x)*4,(y*result.width+x)*4+4)];

test('uniform fields are byte-exact for both scales and all strengths',()=>{
  for(const alpha of [0,73,255])for(const scale of [1,2])for(const strength of [0,0.45,1]){
    const source=image(7,5,()=>[31,97,181,alpha]),before=new Uint8ClampedArray(source.data);
    const result=enhanceImageryRGBA(source,{scale,strength});
    assert.deepEqual(source.data,before);
    for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++)assert.deepEqual(rgba(result,x,y),[31,97,181,alpha]);
  }
});
test('a hard black/white step never acquires ringing, negative values or overshoot',()=>{
  const source=image(16,8,x=>x<8?[0,0,0,255]:[255,255,255,255]);
  const sharp=enhanceImageryRGBA(source,{strength:1});assert.deepEqual(sharp.data,source.data);
  const upsampled=enhanceImageryRGBA(source,{scale:2,strength:1});
  const row=Array.from({length:upsampled.width},(_,x)=>rgba(upsampled,x,4)[0]);
  assert.equal(row[0],0);assert.equal(row.at(-1),255);
  for(let i=1;i<row.length;i++)assert.ok(row[i]>=row[i-1],'step must stay monotonic');
  assert.ok(row.slice(0,14).every(v=>v===0));assert.ok(row.slice(18).every(v=>v===255));
});
test('affine gradients are preserved by sharpening and bicubic interior samples match analytic interpolation',()=>{
  const source=image(16,12,(x,y)=>[20+8*x+2*y,10+4*x+4*y,30+2*x+8*y,255]);
  assert.deepEqual(enhanceImageryRGBA(source,{strength:1}).data,source.data);
  const result=enhanceImageryRGBA(source,{scale:2,strength:0});
  for(let y=4;y<result.height-4;y++)for(let x=4;x<result.width-4;x++){
    const sx=(x+0.5)/2-0.5,sy=(y+0.5)/2-0.5;
    assert.deepEqual(rgba(result,x,y),[Math.round(20+8*sx+2*sy),Math.round(10+4*sx+4*sy),Math.round(30+2*sx+8*sy),255]);
  }
});
test('soft existing detail gains contrast without creating a new local maximum',()=>{
  const samples=[20,20,30,80,160,205,220,220],source=image(samples.length,4,x=>[samples[x],samples[x],samples[x],255]);
  const result=enhanceImageryRGBA(source,{strength:1});
  assert.ok(rgba(result,2,2)[0]<samples[2]);assert.ok(rgba(result,5,2)[0]>samples[5]);
  for(let x=0;x<samples.length;x++){
    const neighbours=samples.slice(Math.max(0,x-1),Math.min(samples.length,x+2)),value=rgba(result,x,2)[0];
    assert.ok(value>=Math.min(...neighbours)&&value<=Math.max(...neighbours));
  }
});
test('transparent colours and no-data boundaries cannot bleed or become filled',()=>{
  const source=image(10,6,x=>x<5?[255,0,255,0]:[35,95,55,255]);
  for(const scale of [1,2]){
    const result=enhanceImageryRGBA(source,{scale,strength:1});
    for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++)assert.deepEqual(rgba(result,x,y),x<5*scale?[255,0,255,0]:[35,95,55,255]);
  }
});
test('mixed partial alpha remains byte-exact and upsampling replicates each source alpha',()=>{
  const source=image(9,7,(x,y)=>[(x*37+y*11)%256,(y*43+x*7)%256,(x*17+y*23)%256,(x*19+y*41)%256]);
  const before=new Uint8ClampedArray(source.data);
  for(const scale of [1,2]){
    const result=enhanceImageryRGBA(source,{scale,strength:1});
    for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){
      const expected=rgba(source,Math.floor(x/scale),Math.floor(y/scale));
      assert.equal(rgba(result,x,y)[3],expected[3]);
      if(expected[3]===0)assert.deepEqual(rgba(result,x,y),expected);
    }
  }
  assert.deepEqual(source.data,before);
});
test('deterministic output has bounded channels and same-scale local extrema',()=>{
  const source=image(17,13,(x,y)=>[(x*79+y*31)%256,(x*17+y*53)%256,(x*43+y*11)%256,255]);
  const first=enhanceImageryRGBA(source,{strength:0.7}),second=enhanceImageryRGBA(source,{strength:0.7});assert.deepEqual(first.data,second.data);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)for(let c=0;c<3;c++){
    const neighbours=[[x,y],[Math.max(0,x-1),y],[Math.min(source.width-1,x+1),y],[x,Math.max(0,y-1)],[x,Math.min(source.height-1,y+1)]].map(([xx,yy])=>rgba(source,xx,yy)[c]);
    assert.ok(rgba(first,x,y)[c]>=Math.min(...neighbours)&&rgba(first,x,y)[c]<=Math.max(...neighbours));
  }
  const result=enhanceImageryRGBA(source,{scale:2,strength:0.7});assert.equal(result.displayOnly,true);assert.equal(result.addsMeasuredDetail,false);
});
test('single-pixel and narrow images preserve dimensions and alpha',()=>{
  for(const [w,h] of [[1,1],[1,9],[9,1]]){
    const result=enhanceImageryRGBA(image(w,h,()=>[15,45,90,128]),{scale:2,strength:1});
    assert.equal(result.width,w*2);assert.equal(result.height,h*2);assert.equal(result.data.length,w*h*16);
    assert.deepEqual(rgba(result,0,0),[15,45,90,128]);
  }
});
test('limits reject oversized or malformed inputs before allocating output',()=>{
  assert.equal(MAX_IMAGERY_OUTPUT_SIDE,512);
  const tiny=image(1,1,()=>[0,0,0,255]);
  for(const options of [{scale:3},{scale:0},{strength:-1},{strength:1.1},{strength:NaN}])assert.throws(()=>enhanceImageryRGBA(tiny,options),RangeError);
  assert.throws(()=>enhanceImageryRGBA({data:new Uint8Array(4),width:513,height:1}),/limit/);
  assert.throws(()=>enhanceImageryRGBA({data:new Uint8Array(4),width:257,height:1},{scale:2}),/limit/);
  assert.throws(()=>enhanceImageryRGBA({data:new Float32Array(4),width:1,height:1}),TypeError);
  assert.throws(()=>enhanceImageryRGBA({data:new Uint8Array(3),width:1,height:1}),/length/);
  assert.throws(()=>enhanceImageryRGBA({data:new Uint8Array(4),width:0,height:1}),RangeError);
});
