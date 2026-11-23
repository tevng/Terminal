import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url), env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),['.'],{stdio:'inherit',env});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
