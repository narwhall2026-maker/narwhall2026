import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const file of ['index.html','app.js','style.css','camera-face-worker.js','live-pong.js']) await copyFile(file,'dist/'+file);
await copyFile('downloads/Narwhall-Beta-0.1.0.apk','dist/narwhall-beta.apk');
console.log('Built Narwhall static app.');

