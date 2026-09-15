// Display-only reconstruction and sharpening of existing RGB imagery.
// This does not recover missing measured detail and must not feed scientific analysis.
export const MAX_IMAGERY_OUTPUT_SIDE=512;
const EVEN_WEIGHTS=[-0.0234375,0.2265625,0.8671875,-0.0703125];
const ODD_WEIGHTS=[-0.0703125,0.8671875,0.2265625,-0.0234375];
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

function validateImage(image,scale,strength){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1)throw new RangeError('Imagery dimensions must be positive integers.');
  if(scale!==1&&scale!==2)throw new RangeError('Imagery display scale must be 1 or 2.');
  if(!Number.isFinite(strength)||strength<0||strength>1)throw new RangeError('Imagery sharpening strength must be between 0 and 1.');
  if(image.width*scale>MAX_IMAGERY_OUTPUT_SIDE||image.height*scale>MAX_IMAGERY_OUTPUT_SIDE)throw new RangeError('Imagery output exceeds the 512-pixel side limit.');
  if(!(image.data instanceof Uint8Array)&&!(image.data instanceof Uint8ClampedArray))throw new TypeError('Imagery must use RGBA8 bytes.');
  if(image.data.length!==image.width*image.height*4)throw new RangeError('RGBA data length does not match image dimensions.');
}

function uniformAlpha(data){
  const alpha=data[3];for(let i=7;i<data.length;i+=4)if(data[i]!==alpha)return false;return true;
}

// A bicubic footprint can reach two source pixels away from its nearest centre.
// Around alpha boundaries use nearest colour as well as nearest alpha, so hidden
// RGB/no-data never contaminates a neighbouring valid pixel.
function safeAlphaFootprints(data,width,height){
  const safe=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=y*width+x,alpha=data[at*4+3];if(alpha===0)continue;
    let valid=true;
    for(let yy=Math.max(0,y-2);yy<=Math.min(height-1,y+2)&&valid;yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(width-1,x+2);xx++){
      if(data[(yy*width+xx)*4+3]!==alpha){valid=false;break;}
    }
    safe[at]=valid?1:0;
  }
  return safe;
}

function bicubic2x(data,width,height){
  const outputWidth=width*2,outputHeight=height*2;
  const output=new Uint8ClampedArray(outputWidth*outputHeight*4);
  const sameAlpha=uniformAlpha(data),safe=sameAlpha?null:safeAlphaFootprints(data,width,height);
  const horizontal=new Float32Array(outputWidth*height*3);
  const xIndices=new Int32Array(outputWidth*4),xLow=new Int32Array(outputWidth),xHigh=new Int32Array(outputWidth);
  for(let x=0;x<outputWidth;x++){
    const base=(x>>1)-(x%2===0?1:0);
    for(let k=0;k<4;k++)xIndices[x*4+k]=clamp(base+k-1,0,width-1)*4;
    xLow[x]=clamp(base,0,width-1)*4;xHigh[x]=clamp(base+1,0,width-1)*4;
  }
  // Separable Catmull–Rom reconstruction, with fixed quarter-pixel weights.
  for(let y=0;y<height;y++){
    const row=y*width*4;
    for(let x=0;x<outputWidth;x++){
      const weights=x%2===0?EVEN_WEIGHTS:ODD_WEIGHTS,p=x*4,out=(y*outputWidth+x)*3;
      for(let channel=0;channel<3;channel++)horizontal[out+channel]=
        data[row+xIndices[p]+channel]*weights[0]+data[row+xIndices[p+1]+channel]*weights[1]+
        data[row+xIndices[p+2]+channel]*weights[2]+data[row+xIndices[p+3]+channel]*weights[3];
    }
  }
  for(let y=0;y<outputHeight;y++){
    const base=(y>>1)-(y%2===0?1:0),weights=y%2===0?EVEN_WEIGHTS:ODD_WEIGHTS;
    const row0=clamp(base-1,0,height-1)*outputWidth*3,row1=clamp(base,0,height-1)*outputWidth*3;
    const row2=clamp(base+1,0,height-1)*outputWidth*3,row3=clamp(base+2,0,height-1)*outputWidth*3;
    const lowRow=clamp(base,0,height-1)*width*4,highRow=clamp(base+1,0,height-1)*width*4;
    for(let x=0;x<outputWidth;x++){
      const nearest=(y>>1)*width+(x>>1),source=nearest*4,out=(y*outputWidth+x)*4,alpha=data[source+3];
      output[out+3]=alpha;
      if(alpha===0||(!sameAlpha&&!safe[nearest])){
        output[out]=data[source];output[out+1]=data[source+1];output[out+2]=data[source+2];continue;
      }
      const x3=x*3;
      for(let channel=0;channel<3;channel++){
        const value=horizontal[row0+x3+channel]*weights[0]+horizontal[row1+x3+channel]*weights[1]+
          horizontal[row2+x3+channel]*weights[2]+horizontal[row3+x3+channel]*weights[3];
        const a=data[lowRow+xLow[x]+channel],b=data[lowRow+xHigh[x]+channel];
        const c=data[highRow+xLow[x]+channel],d=data[highRow+xHigh[x]+channel];
        // Negative cubic lobes must not introduce extrema beyond the enclosing pixels.
        output[out+channel]=Math.round(clamp(value,Math.min(a,b,c,d),Math.max(a,b,c,d)));
      }
    }
  }
  return output;
}

function sharpen(data,width,height,strength){
  const output=new Uint8ClampedArray(data);
  if(strength===0)return output;
  const luma=new Uint8Array(width*height);
  for(let p=0;p<luma.length;p++){const i=p*4;luma[p]=(54*data[i]+183*data[i+1]+19*data[i+2]+128)>>8;}
  // Missing neighbours beyond tile boundaries must not create edge sharpening.
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const centre=y*width+x,c=centre*4,alpha=data[c+3];if(alpha===0)continue;
    const left=centre-1,right=centre+1,up=centre-width,down=centre+width;
    const l=left*4,r=right*4,u=up*4,d=down*4;
    if(data[l+3]!==alpha||data[r+3]!==alpha||data[u+3]!==alpha||data[d+3]!==alpha)continue;
    const contrast=Math.max(luma[centre],luma[left],luma[right],luma[up],luma[down])-Math.min(luma[centre],luma[left],luma[right],luma[up],luma[down]);
    if(contrast<=2)continue;
    // Suppress amplification in nearly uniform/noisy regions and at hard edges.
    const gain=strength*(contrast/(contrast+16))*(1-contrast/255);
    for(let channel=0;channel<3;channel++){
      const value=data[c+channel],a=data[l+channel],b=data[r+channel],e=data[u+channel],f=data[d+channel];
      const detail=value-(a+b+e+f)*0.25;
      output[c+channel]=Math.round(clamp(value+gain*detail,Math.min(value,a,b,e,f),Math.max(value,a,b,e,f)));
    }
  }
  return output;
}

/** Enhance only existing display RGB, never elevation or classification data.
 * Input is unchanged. Alpha is exact at scale1 and nearest-replicated at scale2.
 * Missing/transparent pixels remain transparent; scale2 interpolates existing data
 * and does not add measured spatial detail. Maximum output is 512×512 RGBA8.
 */
export function enhanceImageryRGBA(image,{strength=0.45,scale=1}={}){
  validateImage(image,scale,strength);
  const width=image.width*scale,height=image.height*scale;
  const reconstructed=scale===2?bicubic2x(image.data,image.width,image.height):image.data;
  const data=sharpen(reconstructed,width,height,strength);
  return {data,width,height,scale,strength,sourceWidth:image.width,sourceHeight:image.height,
    method:scale===2?'bounded-bicubic-2x + contrast-adaptive-unsharp':'contrast-adaptive-unsharp',
    displayOnly:true,addsMeasuredDetail:false};
}
