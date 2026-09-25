import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {posix} from 'node:path';
import {createHash} from 'node:crypto';

const modules=['hand-controls.mjs','hand-camera.mjs','hand-motion.mjs','hand-tracker.worker.mjs','atlas-console.mjs','camera-orbit.mjs','imagery-quality.mjs','imagery-source.mjs','terrain-source.mjs','live-buildings.js','real-height-buildings.mjs','live-app.mjs','live-viewport.mjs','observation-data.mjs','landcover-data.mjs','unccd-reference.mjs','degradation-data.mjs',
 'app.mjs','model.mjs','viewport.mjs','analysis.worker.mjs','land-mask.mjs','ui-controls.mjs','explanation.mjs','history-view.mjs','presentation.mjs'];
const styles=['console.css','styles.css','ui-controls.css','experiences.css','presentation.css','design.css','live.css'];
const pages=['index.html','simulation.html'];
async function tree(directory){
 const entries=await readdir(directory,{withFileTypes:true}),files=[];
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
  const path=`${directory}/${entry.name}`;
  if(entry.isDirectory())files.push(...await tree(path));
  else if(entry.isFile())files.push(path);
  else throw new Error(`Unsupported deployment file: ${path}`);
 }
 return files;
}
const dataFiles=(await tree('data')).filter(file=>/\.(json|md)$/i.test(file));
const vendorFiles=await tree('vendor');
const files=[...pages,...modules,...styles,'favicon.svg',...dataFiles,...vendorFiles].sort();
const fileSet=new Set(files),contents=new Map(),hash=createHash('sha256');
const isText=path=>/\.(?:mjs|js|css|html|json|md|svg|txt)$/i.test(path)||/(?:^|\/)[^/]*LICENSE[^/]*$/i.test(path);
// Read a single snapshot and normalize text line endings for identical Windows/CI builds.
for(const path of files){
 const raw=await readFile(path),content=isText(path)?Buffer.from(raw.toString('utf8').replace(/\r\n?/g,'\n')):raw;
 contents.set(path,content);hash.update(path).update('\0').update(content).update('\0');
}
const version=hash.digest('hex').slice(0,12);
function revision(reference,currentFile){
 if(/^(?:[a-z][\w+.-]*:|\/|#|\?)/i.test(reference))return reference;
 const [path,fragment]=reference.split('#'),cleanPath=path.split('?')[0];
 const resolved=posix.normalize(posix.join(posix.dirname(currentFile),cleanPath));
 if(!fileSet.has(resolved))return reference;
 return `${cleanPath}?v=${version}${fragment===undefined?'':`#${fragment}`}`;
}
const deployed=[];
for(const path of files){
 let content=contents.get(path);
 if(modules.includes(path)){
  // Static/dynamic imports, worker URLs, local JSON URLs and local document links.
  content=Buffer.from(content.toString('utf8').replace(/(['"])(\.?\.?\/?[\w./-]+\.(?:mjs|js|json|md|html)(?:\?[^'"\s]*)?(?:#[^'"\s]*)?)\1/g,
   (_,quote,reference)=>`${quote}${revision(reference,path)}${quote}`));
 }else if(pages.includes(path)){
  content=Buffer.from(content.toString('utf8').replace(/\b(src|href)=(['"])([^'"\s]+)\2/g,
   (_,attribute,quote,reference)=>`${attribute}=${quote}${revision(reference,path)}${quote}`));
 }else if(styles.includes(path)){
  content=Buffer.from(content.toString('utf8').replace(/url\((['"]?)([^)'"\s]+)\1\)/g,
   (_,quote,reference)=>`url(${quote}${revision(reference,path)}${quote})`));
 }
 await mkdir(`dist/${posix.dirname(path)}`,{recursive:true});
 await writeFile(`dist/${path}`,content);
 deployed.push({path,bytes:content.byteLength,sha256:createHash('sha256').update(content).digest('hex')});
}
const html=await readFile('dist/index.html','utf8'),simulation=await readFile('dist/simulation.html','utf8');
if(!/<body[^>]*class="[^"]*\blive-app\b[^"]*"/.test(html)||!html.includes(`live-app.mjs?v=${version}`))throw new Error('Default page must load the observed-data atlas.');
if(!simulation.includes('교육용')||!simulation.includes(`app.mjs?v=${version}`))throw new Error('Simulation page must retain its notice and separate entry point.');
for(const path of ['vendor/geotiff/geotiff.js','data/degradation-cogs.json','data/unccd-reference.json','data/country-boundaries.json'])if(!fileSet.has(path))throw new Error(`Missing deployment dependency: ${path}`);
const degradation=await readFile('dist/degradation-data.mjs','utf8');
if(!degradation.includes(`./vendor/geotiff/geotiff.js?v=${version}`))throw new Error('GeoTIFF dynamic import must share the deployment revision.');
await writeFile('dist/build-manifest.json',JSON.stringify({version,files:deployed},null,2)+'\n');
console.log(`Built LAND:15 observed atlas and simulation (${version}; ${files.length} assets) in dist/`);
