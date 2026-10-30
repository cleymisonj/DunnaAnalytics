import './env.mjs';
const bucket='dunna-vehicle-photos';
export function createPhotoStorage({url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,fetchImpl=fetch}={}){
 if(!url||!key)throw new Error('Armazenamento de fotos não configurado');
 const endpoint=new URL(url);if(endpoint.protocol!=='https:')throw new Error('URL de armazenamento inválida');
 const headers={apikey:key,Authorization:'Bearer '+key};
 return {async put(name,bytes,type){const r=await fetchImpl(new URL('/storage/v1/object/'+bucket+'/'+encodeURIComponent(name),endpoint),{method:'POST',headers:{...headers,'Content-Type':type,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Falha ao salvar foto');},async get(name){const r=await fetchImpl(new URL('/storage/v1/object/'+bucket+'/'+encodeURIComponent(name),endpoint),{headers,signal:AbortSignal.timeout(15000)});if(r.status===404||r.status===400)return null;if(!r.ok)throw new Error('Falha ao carregar foto');return {bytes:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')||'application/octet-stream'}}};
}
