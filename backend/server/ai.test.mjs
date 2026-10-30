import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {generateDescription} from './ai.mjs'
import {createApi} from './api.mjs'
const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))

test('IA envia apenas ficha pública, usa Responses e exige revisão',async()=>{
 let payload
 const result=await generateDescription({...seed[0],documentation:'SEGREDO INTERNO',description:'Descrição anterior',ownerEmail:'privado@example.test'}, {name:'Aero',city:'Natal',phone:'Telefone interno'}, {apiKey:'chave-ficticia',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');payload=JSON.parse(options.body)
  return {ok:true,json:async()=>({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:'Descrição de teste baseada na ficha.'}]}]})}
 }})
 assert.equal(result.requiresReview,true);assert.equal(result.description,'Descrição de teste baseada na ficha.')
 assert.equal(payload.store,false);assert.equal(payload.model,'gpt-5-mini')
 assert.ok(!payload.input.includes('SEGREDO INTERNO'));assert.ok(!payload.input.includes('privado@example.test'));assert.ok(!payload.input.includes('Telefone interno'));assert.ok(!payload.input.includes('Descrição anterior'))
 await assert.rejects(()=>generateDescription(seed[0],{},{}),e=>e.status===503)
 await assert.rejects(()=>generateDescription(seed[0],{},{apiKey:'test',fetchImpl:async()=>({ok:false,status:429})}),e=>e.status===502)
 await assert.rejects(()=>generateDescription(seed[0],{},{apiKey:'test',fetchImpl:async()=>({ok:false,status:429,json:async()=>({error:{code:'credit_balance_exhausted'}})})}),e=>e.status===502&&e.message.includes('sem créditos'))
 await assert.rejects(()=>generateDescription(seed[0],{},{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})})}),e=>e.status===502)
})

test('geração autenticada não salva automaticamente e limita consumo por loja',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-ai-test-'));let requests=0
 const api=await createApi({dataDir:dir,seed,aiKey:'test-only',aiFetch:async()=>{requests++;return{ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Descrição simulada apenas neste teste automatizado.'}]}]})}}})
 const server=http.createServer((req,res)=>api.handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,method='GET',data,cookie='')=>{const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1','Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  assert.equal((await call('/api/admin/ai/description','POST',{vehicle:seed[0]})).status,401)
  const auth=await call('/api/auth/setup','POST',{name:'QA',email:'ai@example.test',password:'qa-test-password-123'});assert.equal(auth.status,201)
  assert.equal((await call('/api/admin/ai/status','GET',undefined,auth.cookie)).body.configured,true)
  assert.equal((await call('/api/admin/ai/description','POST',{vehicle:{...seed[0],id:'not-in-this-store'}},auth.cookie)).status,404)
  for(let i=0;i<20;i++)assert.equal((await call('/api/admin/ai/description','POST',{vehicle:seed[0]},auth.cookie)).status,200)
  assert.equal((await call('/api/admin/ai/description','POST',{vehicle:seed[0]},auth.cookie)).status,429);assert.equal(requests,20)
  const stock=await call('/api/admin/stock','GET',undefined,auth.cookie)
  const vehicle=stock.body.find(v=>v.id===seed[0].id);assert.equal(vehicle.description,undefined)
  const saved=await call('/api/admin/stock/'+vehicle.id,'PUT',{vehicle:{...vehicle,description:'Texto revisado e aprovado.'},revision:vehicle.revision},auth.cookie);assert.equal(saved.status,200)
  const published=await call('/api/stock');assert.equal(published.body.vehicles.find(v=>v.id===vehicle.id).description,'Texto revisado e aprovado.')
 }finally{await new Promise(resolve=>server.close(resolve));api.close();assert.ok(dir.startsWith(path.join(tmpdir(),'dunna-ai-test-')));rmSync(dir,{recursive:true,force:true})}
})
