import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await mkdir('dist',{recursive:true});
for(const file of ['index.html','styles.css','app.mjs','model.mjs','viewport.mjs','analysis.worker.mjs','favicon.svg','vendor'])await cp(file,`dist/${file}`,{recursive:true});
const modules=['app.mjs','model.mjs','viewport.mjs','analysis.worker.mjs'];
const hash=createHash('sha256');
for(const file of [...modules,'styles.css'])hash.update(await readFile(file));
const version=hash.digest('hex').slice(0,12);
// Give the complete module graph the same revision so an older cached model cannot
// reject a new worker's wider viewport after a GitHub Pages publication.
for(const file of modules){const source=await readFile(file,'utf8');await writeFile(`dist/${file}`,source.replace(/(['"])(\.\/(?:app|model|viewport|analysis\.worker)\.mjs)\1/g,(_,quote,path)=>`${quote}${path}?v=${version}${quote}`));}
const html=(await readFile('index.html','utf8')).replace(/(src|href)="(app\.mjs|styles\.css)"/g,`$1="$2?v=${version}"`);
await writeFile('dist/index.html',html);
for(const src of ['app.mjs','model.mjs','viewport.mjs','analysis.worker.mjs','vendor/maplibre-gl.js','styles.css'])await readFile(`dist/${src}`);
if(!html.includes('교육용 시뮬레이션'))throw Error('Missing synthetic-data notice');
console.log('Built LAND:15 static site in dist/');
