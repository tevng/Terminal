import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import {xtermImePlugin} from './patches/xterm-ime.mjs';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, outdir: 'dist', splitting: true, chunkNames:'chunks/[name]-[hash]', assetNames:'fonts/[name]-[hash]', loader:{'.woff2':'file','.woff':'file','.ttf':'file'}, platform: 'browser', format: 'esm', target: 'chrome140', sourcemap: true, minify: true,plugins:[xtermImePlugin()],tsconfigRaw:{compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false}} });
await copyFile('src/index.html', 'dist/index.html');
await copyFile('assets/terminal.png','dist/terminal.png');
await copyFile('assets/terminal.ico','dist/terminal.ico');
