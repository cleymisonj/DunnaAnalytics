import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
// Em dev o backend fica sempre na porta que o proxy do Vite espera; um PORT genérico do ambiente não o desvia.
const backendEnv={...process.env,PORT:process.env.DUNNA_API_PORT||'3001'};
const children=[spawn(process.execPath,['backend/server/start.mjs'],{cwd:root,stdio:'inherit',env:backendEnv}),spawn(process.execPath,['frontend/node_modules/vite/bin/vite.js','frontend',...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:{...process.env,DUNNA_BACKEND_URL:process.env.DUNNA_BACKEND_URL||'http://127.0.0.1:'+backendEnv.PORT}})];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill();process.exitCode=code}
for(const child of children){child.on('error',error=>{console.error(error.message);stop(1)});child.on('exit',code=>stop(code||0))}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
