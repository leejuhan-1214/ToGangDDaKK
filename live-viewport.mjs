// CanvasSource's canonical tile centre must stay inside one longitude world.
// Split wrapped views at the dateline instead of stretching or dropping a side.
export const MAX_MERCATOR_LATITUDE=85.0511287798066;

/** Return one or two canonical [west,south,east,north] windows for CanvasSource.
 * Longitudes may be unwrapped. More than one world is represented once globally.
 * Each returned interval has positive width/height and stays within ±180°.
 */
export function splitViewportBounds(bounds){
  if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite))throw new RangeError('유효한 지도 범위 네 값이 필요합니다.');
  const [rawWest,rawSouth,rawEast,rawNorth]=bounds;
  if(rawNorth<=rawSouth)throw new RangeError('지도 위도 범위가 비어 있습니다.');
  const south=Math.max(-MAX_MERCATOR_LATITUDE,rawSouth),north=Math.min(MAX_MERCATOR_LATITUDE,rawNorth);
  if(north<=south)throw new RangeError('표시 가능한 지도 위도 범위를 벗어났습니다.');
  const rawSpan=rawEast-rawWest;
  if(!Number.isFinite(rawSpan)||rawSpan===0)throw new RangeError('지도 경도 범위가 비어 있거나 유효하지 않습니다.');
  if(Math.abs(rawSpan)>=360)return [[-180,south,180,north]];
  const span=rawSpan<0?rawSpan+360:rawSpan;
  const west=(((rawWest+180)%360)+360)%360-180,east=west+span;
  if(east<=180)return [[west,south,east,north]];
  return [[west,south,180,north],[-180,south,east-360,north]];
}
