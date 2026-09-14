import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const readText=async file=>(await readFile(file,'utf8')).replace(/\r\n?/g,'\n');
await mkdir('dist',{recursive:true});
await mkdir('dist/data',{recursive:true});
const modules=['app.mjs','model.mjs','viewport.mjs','analysis.worker.mjs','land-mask.mjs','ui-controls.mjs','explanation.mjs','history-view.mjs','presentation.mjs'];
const styles=['styles.css','ui-controls.css','experiences.css','presentation.css'];
for(const file of ['index.html',...styles,...modules,'data/land-mask.json','data/history.json','data/history-sources.md','data/README.md','favicon.svg','vendor'])await cp(file,`dist/${file}`,{recursive:true});
const hash=createHash('sha256');
for(const file of [...modules,...styles,'index.html','data/land-mask.json','data/history.json','vendor/polygon-clipping.mjs'])hash.update(await readText(file));
const version=hash.digest('hex').slice(0,12);
// Give the complete module graph the same revision so an older cached model cannot
// reject a new worker's wider viewport after a GitHub Pages publication.
for(const file of modules){const source=await readText(file);await writeFile(`dist/${file}`,source.replace(/(['"])(\.\/(?:[\w.-]+|vendor\/polygon-clipping)\.mjs|\.\/data\/(?:land-mask|history)\.json)\1/g,(_,quote,path)=>`${quote}${path}?v=${version}${quote}`));}
const html=(await readText('index.html')).replace(/(src|href)="(app\.mjs|[\w-]+\.css)"/g,`$1="$2?v=${version}"`);
await writeFile('dist/index.html',html);
for(const style of styles)await writeFile(`dist/${style}`,await readText(style));
await writeFile('dist/data/history.json',await readText('data/history.json'));
for(const src of [...modules,...styles,'vendor/maplibre-gl.js','data/land-mask.json','data/history.json'])await readFile(`dist/${src}`);
if(!html.includes('교육용 시뮬레이션'))throw Error('Missing synthetic-data notice');
console.log('Built LAND:15 static site in dist/');
