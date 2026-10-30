import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
import {setNotifyFetch,emailConfig} from './notifications.mjs'

async function start(){
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-notify-'))
 const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 const api=await createApi({dataDir:dir,seed,aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',cookie='',data,raw,headers={}}={})=>{
  const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):raw})
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}
 }
 const owner=(await call('/api/auth/setup',{method:'POST',data:{name:'Dono',email:'dono@example.test',password:'senha-do-dono-123456'}})).cookie
 return {call,owner,stop:async()=>{server.close();await api.close?.();rmSync(dir,{recursive:true,force:true})}}
}
const withEnv=async(vars,fn)=>{const old={};for(const k of Object.keys(vars)){old[k]=process.env[k];if(vars[k]===undefined)delete process.env[k];else process.env[k]=vars[k]}try{return await fn()}finally{for(const k of Object.keys(old)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}}}
const contact={store:'minha-loja',name:'Carla Dias',phone:'(84) 98877-6655',car:'SUV automático',budget:'até R$ 90 mil',notes:'Tenho um Onix para troca'}

test('configuração do e-mail: chave e destinatário válidos',()=>{
 assert.equal(emailConfig({}),null)
 assert.equal(emailConfig({RESEND_API_KEY:'re_x'}),null)
 assert.equal(emailConfig({RESEND_API_KEY:'re_x',DUNNA_NOTIFY_EMAIL:'nao-e-email'}),null)
 assert.deepEqual(emailConfig({RESEND_API_KEY:'re_x',DUNNA_NOTIFY_EMAIL:'a@loja.com, b@loja.com'}).to,['a@loja.com','b@loja.com'])
})

test('contato do site vira lead no funil e aviso no sininho',async()=>{
 await withEnv({RESEND_API_KEY:undefined,DUNNA_NOTIFY_EMAIL:undefined},async()=>{
  const {call,owner,stop}=await start()
  try{
   assert.equal((await call('/api/public/leads',{method:'POST',data:{...contact,phone:'123'}})).status,422)
   assert.equal((await call('/api/public/leads',{method:'POST',data:contact})).status,201)
   const lead=(await call('/api/admin/leads',{cookie:owner})).data.find(l=>l.name==='Carla Dias')
   assert.equal(lead.phone,'84988776655')
   assert.equal(lead.source,'Site (formulário de contato)')
   assert.equal(lead.interest,'SUV automático')
   assert.match(lead.history[0].text,/Investimento: até R\$ 90 mil/)
   let n=(await call('/api/admin/notifications',{cookie:owner})).data
   assert.equal(n.unread,1)
   assert.equal(n.email,false)
   assert.equal(n.items[0].title,'Novo contato: Carla Dias')
   assert.equal(n.items[0].screen,'crm')
   assert.equal(n.items[0].unread,true)
   assert.equal((await call('/api/admin/notifications/seen',{method:'POST',cookie:owner,data:{}})).status,200)
   n=(await call('/api/admin/notifications',{cookie:owner})).data
   assert.equal(n.unread,0)
   assert.equal(n.items[0].unread,false)
   assert.equal((await call('/api/admin/notifications')).status,401)
  }finally{await stop()}
 })
})

test('aviso por e-mail quando configurado; falha no e-mail não perde o cliente',async()=>{
 const sent=[]
 await withEnv({RESEND_API_KEY:'re_teste',DUNNA_NOTIFY_EMAIL:'dono@loja.test',DUNNA_NOTIFY_FROM:undefined},async()=>{
  setNotifyFetch(async(url,init)=>{sent.push({url,body:JSON.parse(init.body),auth:init.headers.Authorization});return {ok:true,status:200}})
  const {call,owner,stop}=await start()
  try{
   assert.equal((await call('/api/public/leads',{method:'POST',data:contact})).status,201)
   assert.equal(sent.length,1)
   assert.equal(sent[0].url,'https://api.resend.com/emails')
   assert.equal(sent[0].auth,'Bearer re_teste')
   assert.deepEqual(sent[0].body.to,['dono@loja.test'])
   assert.match(sent[0].body.subject,/Novo contato: Carla Dias · Minha loja/)
   assert.match(sent[0].body.html,/wa\.me\/5584988776655/)
   assert.equal((await call('/api/admin/notifications',{cookie:owner})).data.items[0].emailed,true)

   // Serviço de e-mail fora do ar: o lead e o aviso no sininho continuam
   setNotifyFetch(async()=>({ok:false,status:500}))
   assert.equal((await call('/api/public/leads',{method:'POST',data:{...contact,name:'Outro Cliente'}})).status,201)
   const n=(await call('/api/admin/notifications',{cookie:owner})).data
   assert.equal(n.items[0].title,'Novo contato: Outro Cliente')
   assert.equal(n.items[0].emailed,false)
  }finally{setNotifyFetch((...a)=>fetch(...a));await stop()}
 })
})

test('avaliação gera aviso; vendedor não recebe avisos',async()=>{
 await withEnv({RESEND_API_KEY:undefined},async()=>{
  const {call,owner,stop}=await start()
  try{
   const [photo]=(await call('/api/public/appraisals/uploads',{method:'POST',data:{store:'minha-loja',files:[{kind:'photo',type:'image/jpeg',size:10}]}})).data
   await call(photo.upload.url,{method:'PUT',raw:Buffer.alloc(10,1),headers:photo.upload.headers})
   assert.equal((await call('/api/public/appraisals',{method:'POST',data:{store:'minha-loja',name:'Paulo',phone:'84998765432',model:'Fiat Argo',year:2021,mileage:30000,media:[photo.name]}})).status,201)
   const [item]=(await call('/api/admin/notifications',{cookie:owner})).data.items
   assert.equal(item.type,'appraisal')
   assert.equal(item.title,'Avaliação: Fiat Argo 2021')
   assert.match(item.body,/Paulo enviou 1 foto\(s\) · 30\.000 km/)
   assert.equal(item.screen,'appraisals')

   await call('/api/admin/users',{method:'POST',cookie:owner,data:{name:'Bia',email:'bia@example.test',password:'senha-da-bia-123456',role:'seller'}})
   const seller=(await call('/api/auth/login',{method:'POST',data:{email:'bia@example.test',password:'senha-da-bia-123456'}})).cookie
   const s=(await call('/api/admin/notifications',{cookie:seller})).data
   assert.deepEqual([s.items.length,s.unread],[0,0])
  }finally{await stop()}
 })
})
