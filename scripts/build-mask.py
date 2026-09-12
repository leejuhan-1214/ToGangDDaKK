"""Reproducible Natural Earth land-minus-lakes tiling for a static browser app.

Requires Python 3, shapely 2.1.2. Pass --scratch-dir to the directory containing
land.geojson and lakes.geojson. The default is the current working directory.
Coordinates are quantized to 1e-6 degrees; clipping precedes quantization.
"""
from pathlib import Path
import argparse, sys, json, hashlib, time
from datetime import date
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--scratch-dir', type=Path, default=Path.cwd(), help='Scratch directory for inputs, optional build-deps, and generated data (default: current directory).')
parser.add_argument('--source-date', default=date.today().isoformat(), help='ISO download date to record in source metadata.')
args = parser.parse_args()
ROOT = args.scratch_dir.expanduser().resolve()
ROOT.mkdir(parents=True, exist_ok=True)
for name in ['land.geojson', 'lakes.geojson']:
    if not (ROOT/name).is_file(): parser.error(f'Missing input: {ROOT/name}')
sys.path.insert(0, str(ROOT/'build-deps'))
from shapely.geometry import shape, box, Polygon, MultiPolygon
from shapely import make_valid, STRtree, union_all

def polygons(geom):
    if geom.is_empty: return []
    if geom.geom_type == 'Polygon': return [geom]
    if hasattr(geom, 'geoms'): return [p for child in geom.geoms for p in polygons(child)]
    return []

def read(name):
    data=json.loads((ROOT/name).read_text(encoding='utf-8'))
    return [p for f in data['features'] for p in polygons(make_valid(shape(f['geometry'])))]

def encode_ring(ring):
    out=[]; previous=(0,0)
    for x,y in ring.coords:
        point=(round(x*1e6),round(y*1e6))
        if out and point==previous: continue
        out.extend([point[0]-previous[0],point[1]-previous[1]])
        previous=point
    return out

land=read('land.geojson'); lakes=read('lakes.geojson')
lt=STRtree(land); wt=STRtree(lakes)
step=2; width=180; height=90; states=['0']*(width*height); tiles={}
start=time.perf_counter(); point_count=0
for y in range(height):
    for x in range(width):
        tile=box(x*step-180,y*step-90,(x+1)*step-180,(y+1)*step-90)
        hits=lt.query(tile, predicate='intersects')
        if not len(hits): continue
        geom=union_all([land[int(i)].intersection(tile) for i in hits])
        water=wt.query(tile,predicate='intersects')
        if len(water): geom=geom.difference(union_all([lakes[int(i)].intersection(tile) for i in water]))
        if geom.is_empty: continue
        key=y*width+x
        if geom.covers(tile): states[key]='1'; continue
        polys=polygons(geom)
        if not polys: continue
        encoded=[[encode_ring(p.exterior)]+[encode_ring(r) for r in p.interiors] for p in polys]
        point_count+=sum(len(r)//2 for p in encoded for r in p)
        tiles[str(key)]=encoded; states[key]='2'
    if y%15==0: print('latitude',y*step-90,'seconds',round(time.perf_counter()-start,1),flush=True)
out={'format':1,'step':step,'precision':1000000,'states':''.join(states),'tiles':tiles,'source':'Natural Earth ne_10m_land minus ne_10m_lakes','sourceScale':'1:10,000,000','sourceDate':args.source_date,'sourceSha256':{n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ['land.geojson','lakes.geojson']}}
dest=ROOT/'data'/'land-mask-unoptimized.json'; dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
print(json.dumps({'bytes':dest.stat().st_size,'coastTiles':len(tiles),'fullTiles':states.count('1'),'points':point_count,'seconds':time.perf_counter()-start}))
