import {createCloudApi} from '../server/cloud.mjs';
import {createPhotoStorage} from '../server/photo-storage.mjs';
import {connectionProblem} from '../server/postgres.mjs';
const HINTS={url:'DATABASE_URL inválida: use a URL postgresql:// do Transaction pooler do Supabase.',auth:'Usuário ou senha do banco recusados: confira a senha na DATABASE_URL.',network:'Banco inacessível: use a URL do Transaction pooler (porta 6543) do Supabase.',tls:'Certificado do banco não reconhecido: cadastre DATABASE_CA_CERT com o certificado SSL do Supabase.',other:'Confira a configuração do servidor.'};
let initialized;
export default async function handler(req,res){
 // A Vercel só roteia funções com nome fixo fora do Next.js: vercel.json manda todo /api/* para cá com o caminho em __path.
 const url=new URL(req.url,'http://localhost'),original=url.searchParams.get('__path');
 if(original!==null){url.searchParams.delete('__path');const query=url.searchParams.toString();req.url=(original.startsWith('uploads/')?'/':'/api/')+original+(query?'?'+query:'')}
 if(req.url.startsWith('/api/uploads/'))req.url=req.url.replace('/api/uploads/','/uploads/');
 if(!process.env.DATABASE_URL){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Retaguarda ainda não configurada.'}));return}
 try{initialized??=createCloudApi({storage:createPhotoStorage()}).catch(error=>{initialized=undefined;throw error});const api=await initialized;await api.handler(req,res)}catch(error){const problem=connectionProblem(error);console.error('Backend initialization:',error.code||'configuration',problem);res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Não foi possível conectar à retaguarda. '+HINTS[problem],reason:problem}))}
}
