import './env.mjs';
import {createApi} from './api.mjs';
import {createPostgresDatabase,bufferResponse} from './postgres.mjs';
export async function createCloudApi({database=createPostgresDatabase(),seed,storage,privateFiles}={}){
 const api=await database.session(()=>createApi({database,seed,storage,privateFiles}),{initialize:true});
 return {db:database,close:()=>database.close(),async handler(req,res){const response=bufferResponse();try{await database.session(async()=>{await api.handler(req,response);if(response.statusCode>=500)throw new Error('Operation failed')},{write:!['GET','HEAD'].includes(req.method)});response.flush(res)}catch(error){console.error('Cloud API:',error.code||'operation-failed');res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Serviço temporariamente indisponível. Tente novamente.'}))}}};
}
