import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const readText=async file=>(await readFile(file,'utf8')).replace(/\r\n?/g,'\n');
await mkdir('dist',{recursive:true});
await mkdir('dist/data',{recursive:true});
for(const file of ['index.html','styles.css','app.mjs','model.mjs','viewport.mjs','analysis.worker.mjs','land-mask.mjs','data/land-mask.json','data/README.md','favicon.svg','vendor'])await cp(file,`dist/${file}`,{recursive:true});
const modules=['app.mjs','model.mjs','viewport.mjs','analysis.worker.mjs','land-mask.mjs'];
const hash=createHash('sha256');
for(const file of [...modules,'styles.css','index.html','data/land-mask.json','vendor/polygon-clipping.mjs'])hash.update(await readText(file));
const version=hash.digest('hex').slice(0,12);
// Give the complete module graph the same revision so an older cached model cannot
// reject a new worker's wider viewport after a GitHub Pages publication.
for(const file of modules){const source=await readText(file);await writeFile(`dist/${file}`,source.replace(/(['"])(\.\/(?:app|model|viewport|analysis\.worker|land-mask|vendor\/polygon-clipping)\.mjs|\.\/data\/land-mask\.json)\1/g,(_,quote,path)=>`${quote}${path}?v=${version}${quote}`));}
const html=(await readText('index.html')).replace(/(src|href)="(app\.mjs|styles\.css)"/g,`$1="$2?v=${version}"`);
await writeFile('dist/index.html',html);
await writeFile('dist/styles.css',await readText('styles.css'));
for(const src of [...modules,'vendor/maplibre-gl.js','styles.css','data/land-mask.json'])await readFile(`dist/${src}`);
if(!html.includes('교육용 시뮬레이션'))throw Error('Missing synthetic-data notice');
console.log('Built LAND:15 static site in dist/');
