import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
import {setFipeFetch,parsePrice} from './fipe.mjs'
import {commissionFor} from './performance.mjs'

async function start(){
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-quickpack-'))
 const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 const api=await createApi({dataDir:dir,seed,aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',cookie='',data}={})=>{
  const response=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
 }
 const owner=(await call('/api/auth/setup',{method:'POST',data:{name:'Dono',email:'dono@example.test',password:'senha-do-dono-123456'}})).cookie
 const stop=async()=>{server.close();await api.close?.();rmSync(dir,{recursive:true,force:true})}
 return {seed,call,owner,stop}
}

test('lembretes de follow-up: data do próximo contato e motivo da perda',async()=>{
 const {call,owner,stop}=await start()
 try{
  const lead={name:'Ana Lima',phone:'84988887777',interest:'SUV automático',source:'Instagram',stage:'contact',assignedTo:'',nextContactAt:'2026-11-02T13:00:00.000Z'}
  assert.equal((await call('/api/admin/leads',{method:'POST',cookie:owner,data:{...lead,nextContactAt:'amanhã'}})).status,422)
  const created=await call('/api/admin/leads',{method:'POST',cookie:owner,data:lead})
  assert.equal(created.status,201)
  assert.equal(created.data.nextContactAt,'2026-11-02T13:00:00.000Z')
  // Perdido exige motivo
  assert.equal((await call('/api/admin/leads/'+created.data.id,{method:'PUT',cookie:owner,data:{...created.data,stage:'lost'}})).status,422)
  const lost=await call('/api/admin/leads/'+created.data.id,{method:'PUT',cookie:owner,data:{...created.data,stage:'lost',lossReason:'Comprou em outra loja'}})
  assert.equal(lost.status,200)
  assert.equal(lost.data.nextContactAt,'')
  assert.equal(lost.data.lossReason,'Comprou em outra loja')
  assert.ok(lost.data.history.some(h=>h.text==='Motivo da perda: Comprou em outra loja'))
 }finally{await stop()}
})

test('margem por negociação e comissões: regra da loja, por vendedor e visão do vendedor',async()=>{
 const {call,owner,stop}=await start()
 try{
  await call('/api/admin/users',{method:'POST',cookie:owner,data:{name:'Bruno',email:'bruno@example.test',password:'senha-do-bruno-123456',role:'seller'}})
  const bruno=(await call('/api/admin/users',{cookie:owner})).data.find(u=>u.email==='bruno@example.test')
  const person=(await call('/api/admin/people',{method:'POST',cookie:owner,data:{name:'Cliente',kind:'customer',phone:'84999999999',email:'cliente@example.test',city:'Natal/RN',notes:'',active:true}})).data
  const [carA,carB]=(await call('/api/admin/stock',{cookie:owner})).data.filter(v=>v.status==='available')
  // Custo do carro A: compra de R$ 30.000 + despesa de R$ 500
  assert.equal((await call('/api/admin/purchases',{method:'POST',cookie:owner,data:{vehicleId:carA.id,personId:person.id,amountCents:3000000,purchaseDate:'2026-01-01',payments:[{amountCents:3000000,dueDate:'2026-02-01'}],notes:''}})).status,201)
  assert.equal((await call('/api/admin/ledger',{method:'POST',cookie:owner,data:{direction:'expense',description:'Revisão',amountCents:50000,dueDate:'2026-02-01',vehicleId:carA.id}})).status,201)

  const proposal={vehicleId:carA.id,personId:person.id,status:'proposal',amountCents:4000000,payments:[{dueDate:'2026-11-01',amountCents:4000000}],notes:''}
  assert.equal((await call('/api/admin/deals',{method:'POST',cookie:owner,data:{...proposal,sellerId:'nao-existe'}})).status,422)
  const deal=(await call('/api/admin/deals',{method:'POST',cookie:owner,data:{...proposal,sellerId:bruno.id}})).data
  assert.equal(deal.sellerId,bruno.id)
  assert.equal((await call(`/api/admin/deals/${deal.id}/complete`,{method:'POST',cookie:owner,data:{revision:deal.revision}})).status,200)
  // Venda do carro B sem vendedor e sem custo conhecido
  const dealB=(await call('/api/admin/deals',{method:'POST',cookie:owner,data:{...proposal,vehicleId:carB.id,amountCents:5000000,payments:[{dueDate:'2026-11-01',amountCents:5000000}]}})).data
  assert.equal((await call(`/api/admin/deals/${dealB.id}/complete`,{method:'POST',cookie:owner,data:{revision:dealB.revision}})).status,200)

  // Sem regra: comissão zero; margem = 40.000 − 30.500
  let report=(await call('/api/admin/performance',{cookie:owner})).data
  let sale=report.sales.find(s=>s.dealId===deal.id)
  assert.equal(sale.costCents,3050000)
  assert.equal(sale.commissionCents,0)
  assert.equal(sale.marginCents,950000)
  assert.equal(report.totals.sales,2)
  assert.equal(report.totals.pendingCost,1)
  assert.equal(report.sales.find(s=>s.dealId===dealB.id).marginCents,null)

  // Regra: 1,5% sobre a venda
  assert.equal((await call('/api/admin/commission-rules',{method:'PUT',cookie:owner,data:{base:'sale',percent:80}})).status,422)
  assert.equal((await call('/api/admin/commission-rules',{method:'PUT',cookie:owner,data:{base:'sale',percent:1.5}})).status,200)
  sale=(await call('/api/admin/performance',{cookie:owner})).data.sales.find(s=>s.dealId===deal.id)
  assert.equal(sale.commissionCents,60000)
  assert.equal(sale.marginCents,890000)
  assert.equal(sale.marginPct,22.25)

  // Regra: 10% da margem, com 20% para o Bruno
  assert.equal((await call('/api/admin/commission-rules',{method:'PUT',cookie:owner,data:{base:'margin',percent:10,sellers:{[bruno.id]:20}}})).status,200)
  report=(await call('/api/admin/performance',{cookie:owner})).data
  sale=report.sales.find(s=>s.dealId===deal.id)
  assert.equal(sale.commissionCents,190000)
  assert.equal(sale.marginCents,760000)
  assert.equal(report.sellers.find(s=>s.sellerId===bruno.id).commissionCents,190000)

  // Período sem vendas
  assert.equal((await call('/api/admin/performance?from=2000-01-01&to=2000-01-31',{cookie:owner})).data.totals.sales,0)
  assert.equal((await call('/api/admin/performance?from=ontem',{cookie:owner})).status,422)

  // Vendedor: vê só as próprias vendas e não altera a regra
  const sellerCookie=(await call('/api/auth/login',{method:'POST',data:{email:'bruno@example.test',password:'senha-do-bruno-123456'}})).cookie
  const mine=(await call('/api/admin/performance',{cookie:sellerCookie})).data
  assert.deepEqual(mine.sales.map(s=>s.dealId),[deal.id])
  assert.equal((await call('/api/admin/commission-rules',{method:'PUT',cookie:sellerCookie,data:{base:'sale',percent:50}})).status,403)
 }finally{await stop()}
})

test('cadastro guarda código e referência FIPE; relatório filtra pelo dia local da venda',async()=>{
 const {call,owner,stop}=await start()
 try{
  const car=(await call('/api/admin/stock',{cookie:owner})).data.find(v=>v.status==='available')
  const stored=async()=>(await call('/api/admin/stock',{cookie:owner})).data.find(v=>v.id===car.id)
  const {revision,...vehicle}=car
  assert.equal((await call('/api/admin/stock/'+car.id,{method:'PUT',cookie:owner,data:{revision,vehicle:{...vehicle,fipe:77897,fipeCode:'002109-1',fipeReference:'outubro de 2026'}}})).status,200)
  const saved=await stored()
  assert.equal(saved.fipeCode,'002109-1')
  assert.equal(saved.fipeReference,'outubro de 2026')
  assert.equal((await call('/api/admin/stock/'+car.id,{method:'PUT',cookie:owner,data:{revision:saved.revision,vehicle:{...vehicle,fipe:77897,fipeCode:'abc'}}})).status,200)
  assert.equal((await stored()).fipeCode,undefined)

  const person=(await call('/api/admin/people',{method:'POST',cookie:owner,data:{name:'Cliente',kind:'customer',phone:'84999999999',email:'c@example.test',city:'Natal/RN',notes:'',active:true}})).data
  const deal=(await call('/api/admin/deals',{method:'POST',cookie:owner,data:{vehicleId:car.id,personId:person.id,status:'proposal',amountCents:4000000,payments:[{dueDate:'2026-11-01',amountCents:4000000}],notes:''}})).data
  assert.equal((await call(`/api/admin/deals/${deal.id}/complete`,{method:'POST',cookie:owner,data:{revision:deal.revision}})).status,200)
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})
  assert.equal((await call(`/api/admin/performance?from=${today}&to=${today}`,{cookie:owner})).data.totals.sales,1,'venda de hoje entra no filtro de hoje em qualquer horário')
 }finally{await stop()}
})

test('comissão: sem vendedor não paga; base margem sem custo fica pendente',()=>{
 assert.equal(commissionFor({base:'sale',percent:2,sellers:{}},{sellerId:'',saleCents:100000,costCents:null}),0)
 assert.equal(commissionFor({base:'margin',percent:10,sellers:{}},{sellerId:'x',saleCents:100000,costCents:null}),null)
 assert.equal(commissionFor({base:'margin',percent:10,sellers:{}},{sellerId:'x',saleCents:100000,costCents:120000}),0)
})

test('FIPE: proxy autenticado, preço convertido e cache',async()=>{
 const {call,owner,stop}=await start()
 const hits=[]
 setFipeFetch(async(url)=>{
  hits.push(url)
  const json=(status,body)=>({ok:status<400,status,json:async()=>body})
  if(url.endsWith('/cars/brands'))return json(200,[{code:'56',name:'Toyota'}])
  if(url.endsWith('/cars/brands/56/models'))return json(200,[{code:'5041',name:'Corolla GLi 1.8 Flex 16V  Aut.'}])
  if(url.endsWith('/models/5041/years'))return json(200,[{code:'2016-5',name:'2016 Flex'}])
  if(url.endsWith('/years/2016-5'))return json(200,{price:'R$ 77.897,00',codeFipe:'002109-1',referenceMonth:'outubro de 2026',model:'Corolla GLi 1.8 Flex 16V  Aut.',brand:'Toyota',modelYear:2016,fuel:'Flex'})
  if(url.endsWith('/years/2017-5'))return json(429,{})
  return json(404,{})
 })
 try{
  assert.equal((await call('/api/admin/fipe/brands')).status,401)
  assert.deepEqual((await call('/api/admin/fipe/brands',{cookie:owner})).data,[{code:'56',name:'Toyota'}])
  assert.equal((await call('/api/admin/fipe/brands/56/models/5041/years',{cookie:owner})).data[0].code,'2016-5')
  const price=await call('/api/admin/fipe/brands/56/models/5041/years/2016-5',{cookie:owner})
  assert.equal(price.status,200)
  assert.equal(price.data.price,77897)
  assert.equal(price.data.code,'002109-1')
  assert.equal(price.data.reference,'outubro de 2026')
  const before=hits.length
  await call('/api/admin/fipe/brands/56/models/5041/years/2016-5',{cookie:owner})
  assert.equal(hits.length,before,'segunda consulta vem do cache')
  assert.equal((await call('/api/admin/fipe/brands/56/models/5041/years/2017-5',{cookie:owner})).status,503)
  assert.equal((await call('/api/admin/fipe/brands/abc',{cookie:owner})).status,404)
  assert.equal(parsePrice('R$ 1.234.567,89'),1234567.89)
 }finally{setFipeFetch((...a)=>fetch(...a));await stop()}
})
