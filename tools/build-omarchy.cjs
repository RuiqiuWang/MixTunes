'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'../app');
const runtime='/usr/lib/electron43';
fs.accessSync(path.join(runtime,'electron'),fs.constants.X_OK);
const version=fs.readFileSync(path.join(runtime,'version'),'utf8').trim();
if(!/^43\.\d+\.\d+$/.test(version))throw Error(`Unexpected system Electron version: ${version}`);
const result=spawnSync(process.execPath,[path.join(app,'node_modules/electron-builder/cli.js'),
  '--linux','--dir','--x64','--publish','never',
  `--config.electronDist=${runtime}`,`--config.electronVersion=${version}`],{cwd:app,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
