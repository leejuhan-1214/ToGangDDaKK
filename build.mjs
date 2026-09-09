import {mkdir,cp,readFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const file of ['index.html','styles.css','app.mjs','model.mjs','favicon.svg','vendor'])await cp(file,`dist/${file}`,{recursive:true});
const html=await readFile('dist/index.html','utf8');
for(const src of ['app.mjs','model.mjs','vendor/maplibre-gl.js','styles.css'])await readFile(`dist/${src}`);
if(!html.includes('교육용 시뮬레이션'))throw Error('Missing synthetic-data notice');
console.log('Built LAND:15 static site in dist/');
