import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
import {createSupabaseFiles} from './files.mjs'
import {validDocument} from './contracts.mjs'

const JPEG=Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(200,7)])
const MP4=Buffer.alloc(4096,3)

async function start(options={}){
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-legal-'))
 const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 const api=await createApi({dataDir:dir,seed,aiKey:'',...options})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',cookie='',data,raw,type,headers={}}={})=>{
  const response=await fetch(base+route,{method,redirect:'manual',headers:{'X-Dunna-Request':'1',...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...(type?{'Content-Type':type}:{}),...headers},body:data?JSON.stringify(data):raw})
  const ct=response.headers.get('content-type')||''
  return {status:response.status,headers:response.headers,data:ct.includes('json')?await response.json():Buffer.from(await response.arrayBuffer()),cookie:response.headers.get('set-cookie')?.split(';')[0]}
 }
 const owner=(await call('/api/auth/setup',{method:'POST',data:{name:'Dono',email:'dono@example.test',password:'senha-do-dono-123456'}})).cookie
 const stop=async()=>{server.close();await api.close?.();rmSync(dir,{recursive:true,force:true})}
 return {base,call,owner,stop}
}

test('CPF e CNPJ: dígitos verificadores',()=>{
 assert.equal(validDocument('529.982.247-25'),true)
 assert.equal(validDocument('529.982.247-24'),false)
 assert.equal(validDocument('111.111.111-11'),false)
 assert.equal(validDocument('11.222.333/0001-81'),true)
 assert.equal(validDocument('11.222.333/0001-80'),false)
})

test('avaliação pela vitrine: fotos e vídeo, lead no funil e acesso restrito aos arquivos',async()=>{
 const {call,owner,stop}=await start()
 try{
  // Limites de quantidade, formato e tamanho
  assert.equal((await call('/api/public/appraisals/uploads',{method:'POST',data:{store:'minha-loja',files:[{kind:'video',type:'video/avi',size:10}]}})).status,422)
  assert.equal((await call('/api/public/appraisals/uploads',{method:'POST',data:{store:'minha-loja',files:[{kind:'video',type:'video/mp4',size:60*1024*1024}]}})).status,422)
  assert.equal((await call('/api/public/appraisals/uploads',{method:'POST',data:{store:'minha-loja',files:Array.from({length:13},()=>({kind:'photo',type:'image/jpeg',size:100}))}})).status,422)
  const issued=await call('/api/public/appraisals/uploads',{method:'POST',data:{store:'minha-loja',files:[{kind:'photo',type:'image/jpeg',size:JPEG.length},{kind:'video',type:'video/mp4',size:MP4.length}]}})
  assert.equal(issued.status,201)
  const [photo,video]=issued.data
  assert.match(photo.name,/^principal\/appraisal\/[a-f0-9-]{36}\.jpg$/)
  for(const [f,bytes] of [[photo,JPEG],[video,MP4]])assert.equal((await call(f.upload.url,{method:'PUT',raw:bytes,headers:f.upload.headers})).status,201)
  assert.equal((await call(photo.upload.url,{method:'PUT',raw:JPEG,headers:photo.upload.headers})).status>=400,true,'não sobrescreve arquivo enviado')

  const form={store:'minha-loja',name:'Paulo Lima',phone:'(84) 99876-5432',model:'Honda Civic EXL',year:2019,mileage:45000,notes:'Único dono'}
  assert.equal((await call('/api/public/appraisals',{method:'POST',data:{...form,media:[]}})).status,422,'exige foto')
  assert.equal((await call('/api/public/appraisals',{method:'POST',data:{...form,media:[video.name]}})).status,422,'vídeo sozinho não basta')
  const sent=await call('/api/public/appraisals',{method:'POST',data:{...form,media:[photo.name,video.name]}})
  assert.equal(sent.status,201)
  assert.equal((await call('/api/public/appraisals',{method:'POST',data:{...form,media:[photo.name]}})).status,422,'arquivo não pode ser reutilizado')

  const [appraisal]=(await call('/api/admin/appraisals',{cookie:owner})).data
  assert.equal(appraisal.model,'Honda Civic EXL')
  assert.equal(appraisal.phone,'84998765432')
  assert.deepEqual(appraisal.media.map(m=>m.kind),['photo','video'])
  const lead=(await call('/api/admin/leads',{cookie:owner})).data.find(l=>l.id===appraisal.leadId)
  assert.equal(lead.source,'Avaliação de usado')
  assert.equal(lead.appraisalId,appraisal.id)
  assert.match(lead.history[0].text,/1 foto\(s\) e 1 vídeo/)

  // Arquivos: só com login, com suporte a Range para o vídeo
  assert.equal((await call('/api/admin/files/'+photo.name)).status,401)
  const img=await call('/api/admin/files/'+photo.name,{cookie:owner})
  assert.equal(img.status,200)
  assert.equal(img.headers.get('content-type'),'image/jpeg')
  const part=await call('/api/admin/files/'+video.name,{cookie:owner,headers:{Range:'bytes=0-99'}})
  assert.equal(part.status,206)
  assert.equal(part.data.length,100)
  assert.equal(part.headers.get('content-range'),`bytes 0-99/${MP4.length}`)

  // Proposta
  assert.equal((await call('/api/admin/appraisals/'+appraisal.id,{method:'PUT',cookie:owner,data:{revision:appraisal.revision,status:'offer',offerCents:null}})).status,422)
  const offer=await call('/api/admin/appraisals/'+appraisal.id,{method:'PUT',cookie:owner,data:{revision:appraisal.revision,status:'offer',offerCents:8500000,internalNotes:'Pneus novos'}})
  assert.equal(offer.status,200)
  assert.equal(offer.data.offerCents,8500000)
  assert.equal(offer.data.media.length,2)
 }finally{await stop()}
})

test('arquivos no Supabase: bucket privado, envio por link assinado e leitura por redirecionamento',async()=>{
 const calls=[]
 const fetchImpl=async(url,init)=>{calls.push([url,init?.method]);const json=(status,body)=>({ok:status<400,status,json:async()=>body})
  if(url.endsWith('/storage/v1/bucket'))return json(409,{error:'Duplicate'})
  if(url.includes('/object/upload/sign/'))return json(200,{url:'/object/upload/sign/dunna-private-files/x?token=abc'})
  if(url.includes('/object/sign/'))return json(200,{signedURL:'/object/sign/dunna-private-files/x?token=read'})
  return json(404,{})}
 const remote=createSupabaseFiles({url:'https://projeto.supabase.co',key:'chave-de-teste',fetchImpl})
 const {call,owner,stop}=await start({privateFiles:remote})
 try{
  const issued=await call('/api/public/appraisals/uploads',{method:'POST',data:{store:'minha-loja',files:[{kind:'photo',type:'image/jpeg',size:1000}]}})
  assert.equal(issued.status,201)
  assert.equal(issued.data[0].upload.url,'https://projeto.supabase.co/storage/v1/object/upload/sign/dunna-private-files/x?token=abc')
  assert.equal(issued.data[0].upload.method,'PUT')
  assert.equal((await call('/api/files/upload?name='+encodeURIComponent(issued.data[0].name),{method:'PUT',raw:JPEG})).status,404,'sem rota local na nuvem')
  assert.equal((await call('/api/public/appraisals',{method:'POST',data:{store:'minha-loja',name:'Ana',phone:'84998765432',model:'Fiat Argo',year:2021,media:[issued.data[0].name]}})).status,201)
  const file=await call('/api/admin/files/'+issued.data[0].name,{cookie:owner})
  assert.equal(file.status,302)
  assert.equal(file.headers.get('location'),'https://projeto.supabase.co/storage/v1/object/sign/dunna-private-files/x?token=read')
  assert.equal(calls.filter(([u])=>u.endsWith('/bucket')).length,1,'bucket preparado uma vez')
 }finally{await stop()}
})

test('contratos: dados exigidos, documento congelado ao assinar e checklist com anexos',async()=>{
 const {call,owner,stop}=await start()
 try{
  const [car]=(await call('/api/admin/stock',{cookie:owner})).data.filter(v=>v.status==='available')
  // Placa, RENAVAM e chassi validados e escondidos da vitrine
  const {revision,...vehicle}=car
  assert.equal((await call('/api/admin/stock/'+car.id,{method:'PUT',cookie:owner,data:{revision,vehicle:{...vehicle,plate:'AB-1234'}}})).status,422)
  assert.equal((await call('/api/admin/stock/'+car.id,{method:'PUT',cookie:owner,data:{revision,vehicle:{...vehicle,plate:'qfr-4e21',renavam:'0123456789-0',chassis:'9BWZZZ377VT004251'}}})).status,200)
  const stored=(await call('/api/admin/stock',{cookie:owner})).data.find(v=>v.id===car.id)
  assert.deepEqual([stored.plate,stored.renavam,stored.chassis],['QFR4E21','01234567890','9BWZZZ377VT004251'])
  const pub=(await call('/api/stock?store=minha-loja')).data.vehicles.find(v=>v.id===car.id)
  assert.equal(pub.plate,undefined)
  assert.equal(pub.chassis,undefined)

  assert.equal((await call('/api/admin/people',{method:'POST',cookie:owner,data:{name:'Cliente',kind:'customer',phone:'84999999999',email:'',city:'Natal/RN',notes:'',active:true,document:'529.982.247-24'}})).status,422)
  const person=(await call('/api/admin/people',{method:'POST',cookie:owner,data:{name:'Maria Souza',kind:'customer',phone:'84999999999',email:'',city:'Natal/RN',notes:'',active:true,document:'529.982.247-25',rg:'1.234.567 SSP/RN',maritalStatus:'casada',profession:'professora',nationality:'brasileira'}})).data
  assert.equal(person.document,'52998224725')
  const deal=(await call('/api/admin/deals',{method:'POST',cookie:owner,data:{vehicleId:car.id,personId:person.id,status:'proposal',amountCents:4500000,payments:[{dueDate:'2026-11-10',amountCents:1500000},{dueDate:'2026-12-10',amountCents:3000000}],notes:''}})).data

  const created=await call('/api/admin/contracts',{method:'POST',cookie:owner,data:{type:'sale',dealId:deal.id}})
  assert.equal(created.status,201)
  assert.match(created.data.number,/^\d{4}-0001$/)
  assert.equal((await call('/api/admin/contracts',{method:'POST',cookie:owner,data:{type:'sale',dealId:deal.id}})).status,409)
  const contract=created.data
  let doc=(await call(`/api/admin/contracts/${contract.id}/document`,{cookie:owner})).data
  assert.equal(doc.frozen,false)
  assert.deepEqual(doc.missing,['CNPJ da loja','endereço da loja','representante da loja','endereço do cliente'])
  const all=JSON.stringify(doc.sections)
  assert.match(all,/529\.982\.247-25/)
  assert.match(all,/QFR4E21/)
  assert.match(all,/R\$\s45\.000,00/)
  assert.match(all,/art\. 26, II/)
  assert.equal((await call(`/api/admin/contracts/${contract.id}/sign`,{method:'POST',cookie:owner,data:{revision:contract.revision}})).status,422)

  assert.equal((await call('/api/admin/legal',{method:'PUT',cookie:owner,data:{legalName:'Minha loja Comércio de Veículos Ltda',document:'11.222.333/0001-80'}})).status,422)
  assert.equal((await call('/api/admin/legal',{method:'PUT',cookie:owner,data:{legalName:'Minha loja Comércio de Veículos Ltda',document:'11.222.333/0001-81',address:'Av. Prudente de Morais, 1000, Lagoa Nova',cityUf:'Natal/RN',representative:'Dono da Loja',warrantyMonths:3,warrantyScope:'motor e câmbio'}})).status,200)
  await call('/api/admin/people/'+person.id,{method:'PUT',cookie:owner,data:{...person,address:'Rua das Flores, 10, Tirol',zip:'59020-000'}})

  // Anexo no checklist
  const up=(await call('/api/admin/contracts/uploads',{method:'POST',cookie:owner,data:{files:[{kind:'document',type:'application/pdf',size:300}]}})).data[0]
  assert.equal((await call(up.upload.url,{method:'PUT',raw:Buffer.from('%PDF-1.4 teste'),headers:up.upload.headers,cookie:owner})).status,201)
  let current=(await call('/api/admin/contracts',{cookie:owner})).data.contracts[0]
  const checked=await call('/api/admin/contracts/'+contract.id,{method:'PUT',cookie:owner,data:{revision:current.revision,status:'sent',extraClauses:'O comprador recebeu o laudo cautelar.',checklist:{...current.checklist,'buyer-id':{status:'received',files:[up.name],note:'CNH'}}}})
  assert.equal(checked.status,200)
  assert.equal(checked.data.checklist['buyer-id'].status,'received')
  assert.deepEqual(checked.data.checklist['buyer-id'].files,[up.name])
  assert.equal((await call('/api/admin/contracts/'+contract.id,{method:'PUT',cookie:owner,data:{revision:checked.data.revision,checklist:{...checked.data.checklist,'buyer-address':{status:'received',files:['aero/contract/00000000-0000-0000-0000-000000000000.pdf']}}}})).status,422,'arquivo não emitido')

  const signed=await call(`/api/admin/contracts/${contract.id}/sign`,{method:'POST',cookie:owner,data:{revision:checked.data.revision}})
  assert.equal(signed.status,200)
  assert.equal(signed.data.status,'signed')
  // Depois de assinado, mudar o cadastro não muda o contrato
  await call('/api/admin/people/'+person.id,{method:'PUT',cookie:owner,data:{...(await call('/api/admin/people',{cookie:owner})).data.find(p=>p.id===person.id),name:'Outro Nome'}})
  doc=(await call(`/api/admin/contracts/${contract.id}/document`,{cookie:owner})).data
  assert.equal(doc.frozen,true)
  assert.match(JSON.stringify(doc.sections),/MARIA SOUZA/)
  assert.match(JSON.stringify(doc.sections),/O comprador recebeu o laudo cautelar/)
  assert.equal((await call(`/api/admin/contracts/${contract.id}/cancel`,{method:'POST',cookie:owner,data:{revision:signed.data.revision}})).status,409)
 }finally{await stop()}
})
