"""Derive adaptive coast tiles and a conservative global-view LOD.

Run build-mask.py first with the same --scratch-dir. The default scratch
directory is the current working directory, independent of this script's path.
"""
from pathlib import Path
import argparse,sys,json,time
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--scratch-dir',type=Path,default=Path.cwd(),help='Scratch directory used by build-mask.py (default: current directory).')
args=parser.parse_args()
ROOT=args.scratch_dir.expanduser().resolve()
source=ROOT/'data'/'land-mask-unoptimized.json'
if not source.is_file():parser.error(f'Missing {source}; run build-mask.py with the same --scratch-dir first.')
data=json.loads(source.read_text())
if data.get('format')!=1:parser.error('Expected the unoptimized format-1 output from build-mask.py.')
sys.path.insert(0,str(ROOT/'build-deps'))
from shapely.geometry import Polygon,MultiPolygon,box
from shapely import union_all,make_valid,STRtree
start=time.perf_counter()
scale=data['precision']

def polygons(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [g]
    if hasattr(g,'geoms'):return [p for child in g.geoms for p in polygons(child)]
    return []
def decode(encoded):
    polys=[]
    for p in encoded:
        rings=[]
        for r in p:
            x=y=0;ring=[]
            for i in range(0,len(r),2):
                x+=r[i];y+=r[i+1];ring.append((x/scale,y/scale))
            rings.append(ring)
        polys.extend(polygons(make_valid(Polygon(rings[0],rings[1:]))))
    return union_all(polys)
def encode_ring(r):
    out=[];prev=(0,0)
    for x,y in r.coords:
        v=(round(x*scale),round(y*scale))
        if out and v==prev:continue
        out.extend([v[0]-prev[0],v[1]-prev[1]]);prev=v
    return out
def encode(g):
    return [[encode_ring(p.exterior)]+[encode_ring(r) for r in p.interiors] for p in polygons(g)]
def child(g,b,depth):
    if g.is_empty:return 0
    tile=box(*b)
    if g.covers(tile):return 1
    if depth==0:return {'p':encode(g)}
    x0,y0,x1,y1=b;xm=(x0+x1)/2;ym=(y0+y1)/2
    boxes=[(x0,y0,xm,ym),(xm,y0,x1,ym),(x0,ym,xm,y1),(xm,ym,x1,y1)]
    return {'c':[child(g.intersection(box(*c)),c,depth-1) for c in boxes]}

fine={};worldparts=[]
for i,(key,encoded) in enumerate(data['tiles'].items()):
    keynum=int(key);x=keynum%180*2-180;y=keynum//180*2-90
    geom=decode(encoded)
    fine[key]=child(geom,(x,y,x+2,y+2),3)
    worldparts.append(geom)
    if i%500==0:print('adaptive tiles',i,'seconds',round(time.perf_counter()-start,1),flush=True)
for key,state in enumerate(data['states']):
    if state=='1':
        x=key%180*2-180;y=key//180*2-90;worldparts.append(box(x,y,x+2,y+2))
print('union world',round(time.perf_counter()-start,1),flush=True)
world=union_all(worldparts)
print('conservative coarse world',round(time.perf_counter()-start,1),flush=True)
# Erosion exceeds simplification tolerance: coarse cartography is a subset of land.
# Intersect again with the original land mask as a strict final containment check.
coarse=world.simplify(.01,preserve_topology=True).buffer(-.03,quad_segs=1).simplify(.01,preserve_topology=True).intersection(world)
coarse_polys=polygons(coarse);tree=STRtree(coarse_polys)
states=['0']*16200;tiles={}
for y in range(90):
    for x in range(180):
        tile=box(x*2-180,y*2-90,x*2-178,y*2-88)
        hits=tree.query(tile,predicate='intersects')
        if not len(hits):continue
        geom=union_all([coarse_polys[int(i)].intersection(tile) for i in hits])
        key=y*180+x
        if geom.covers(tile):states[key]='1'
        elif not geom.is_empty:states[key]='2';tiles[str(key)]={'p':encode(geom)}
data['format']=2;data['tiles']=fine
data['coarse']={'states':''.join(states),'tiles':tiles,'minCellDegrees':1,'erosionDegrees':.03,'simplificationDegrees':.01}
dest=ROOT/'data'/'land-mask.json';dest.write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
print(json.dumps({'bytes':dest.stat().st_size,'fineCoastTiles':len(fine),'coarseCoastTiles':len(tiles),'seconds':time.perf_counter()-start}),flush=True)
