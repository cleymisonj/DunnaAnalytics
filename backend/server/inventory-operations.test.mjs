import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
test('troca e consignação: fechamento atômico, saldo, aquisição, repasse e devolução',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-inventory-')),seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 let api=await createApi({dataDir:dir,seed,aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',data,cookie='',store=''}={})=>{const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',Cookie:cookie,'X-Store-Id':store,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  assert.equal((await call('/api/admin/consignments')).status,401)
  const cookie=(await call('/api/auth/setup',{method:'POST',data:{name:'Owner',email:'owner@example.test',password:'inventory-test-password-123'}})).cookie
  const person=(await call('/api/admin/people',{cookie,method:'POST',data:{name:'Proprietário teste',kind:'customer',phone:'',email:'',city:'Natal/RN',notes:'',active:true}})).data
  const incoming=(await call('/api/admin/stock',{cookie,method:'POST',data:{vehicle:{...seed[0],model:'Recebido na troca',status:'draft'}}})).data
  const consignment={vehicleId:seed[1].id,personId:person.id,payoutCents:3000000,startDate:'2000-01-01',notes:'Controle privado'}
  const cons=(await call('/api/admin/consignments',{cookie,method:'POST',data:consignment}));assert.equal(cons.status,201)
  assert.equal((await call('/api/admin/ledger',{cookie})).data.length,0)
  assert.equal((await call('/api/admin/consignments',{cookie,method:'POST',data:consignment})).status,409)
  assert.equal((await call('/api/admin/purchases',{cookie,method:'POST',data:{vehicleId:seed[1].id,personId:person.id,amountCents:3000000,purchaseDate:'2000-01-01',payments:[{amountCents:3000000,dueDate:'2026-11-01'}]}})).status,409)
  const trade={vehicleId:incoming.id,vehicleRevision:incoming.revision,amountCents:1000000}
  const input={vehicleId:seed[1].id,personId:person.id,status:'proposal',amountCents:4000000,payments:[{amountCents:3000000,dueDate:'2026-11-01'}],tradeIn:trade,payoutDueDate:'2026-11-02',notes:''}
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...input,payoutDueDate:''}})).status,422)
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...input,amountCents:2000000,payments:[{amountCents:1000000,dueDate:'2026-11-01'}]}})).status,422)
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...input,tradeIn:{...trade,amountCents:5000000}}})).status,422)
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...input,tradeIn:{...trade,vehicleRevision:0}}})).status,409)
  const deal=(await call('/api/admin/deals',{cookie,method:'POST',data:input}));assert.equal(deal.status,201)
  const rival=(await call('/api/admin/deals',{cookie,method:'POST',data:{...input,vehicleId:seed[3].id,payoutDueDate:''}}));assert.equal(rival.status,201)
  assert.equal((await call('/api/admin/purchases',{cookie})).data.length,0)
  assert.equal((await call('/api/stock')).data.vehicles.some(v=>v.id===incoming.id),false)
  api.db.exec("CREATE TRIGGER inventory_rollback_test BEFORE INSERT ON purchases BEGIN SELECT RAISE(ABORT,'inventory rollback test'); END;")
  assert.equal((await call(`/api/admin/deals/${deal.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,500)
  assert.equal((await call('/api/admin/ledger',{cookie})).data.length,0)
  assert.equal((await call('/api/admin/consignments',{cookie})).data[0].status,'active')
  assert.equal((await call('/api/admin/stock',{cookie})).data.find(v=>v.id===seed[1].id).status,'available')
  api.db.exec('DROP TRIGGER inventory_rollback_test')
  assert.equal((await call(`/api/admin/deals/${deal.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,200)
  const stock=(await call('/api/admin/stock',{cookie})).data
  assert.equal(stock.find(v=>v.id===seed[1].id).status,'sold');assert.equal(stock.find(v=>v.id===incoming.id).status,'available')
  let ledger=(await call('/api/admin/ledger',{cookie})).data
  assert.equal(ledger.length,2)
  assert.equal(ledger.filter(e=>e.direction==='income').reduce((s,e)=>s+e.amountCents,0),3000000)
  const payout=ledger.find(e=>e.source==='consignment');assert.equal(payout.amountCents,3000000);assert.equal(payout.status,'open')
  const acquisition=(await call('/api/admin/purchases',{cookie})).data[0]
  assert.equal(acquisition.source,'trade');assert.equal(acquisition.amountCents,1000000);assert.equal(acquisition.payments.length,0)
  assert.equal((await call(`/api/admin/purchases/${acquisition.id}/cancel`,{cookie,method:'POST',data:{revision:1,reason:'Correção'}})).status,409)
  assert.equal((await call(`/api/admin/deals/${deal.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,409)
  assert.equal((await call(`/api/admin/deals/${rival.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,409)
  assert.equal((await call('/api/admin/ledger',{cookie})).data.length,2)
  assert.equal((await call('/api/admin/stock',{cookie})).data.find(v=>v.id===seed[3].id).status,'available')
  assert.equal((await call(`/api/admin/consignments/${cons.data.id}/return`,{cookie,method:'POST',data:{revision:2,reason:'Devolução'}})).status,409)
  await call('/api/admin/ledger',{cookie,method:'POST',data:{vehicleId:seed[1].id,direction:'expense',description:'Preparação',amountCents:10000,dueDate:'2026-11-01'}})
  let costs=(await call('/api/admin/costs',{cookie})).data
  assert.equal(costs.find(c=>c.vehicle.id===seed[1].id).costCents,3010000)
  assert.equal(costs.find(c=>c.vehicle.id===seed[1].id).differenceCents,990000)
  assert.equal(costs.find(c=>c.vehicle.id===incoming.id).acquisitionCents,1000000)
  await call(`/api/admin/ledger/${payout.id}/payment`,{cookie,method:'PATCH',data:{revision:1,status:'paid',paidDate:'2026-11-02'}})
  assert.equal((await call('/api/admin/costs',{cookie})).data.find(c=>c.vehicle.id===seed[1].id).costCents,3010000)
  const back=(await call('/api/admin/consignments',{cookie,method:'POST',data:{...consignment,vehicleId:seed[4].id}})).data
  assert.equal((await call(`/api/admin/consignments/${back.id}/return`,{cookie,method:'POST',data:{revision:1,reason:'Solicitação do proprietário'}})).status,200)
  assert.equal((await call('/api/stock')).data.vehicles.some(v=>v.id===seed[4].id),false)
  const other=(await call('/api/admin/stores',{cookie,method:'POST',data:{name:'Outra',slug:'outra',phone:'84920046908',city:'Natal/RN'}})).data
  assert.equal((await call('/api/admin/consignments',{cookie,store:other.id})).data.length,0)
  assert.equal((await call('/api/admin/consignments',{cookie,store:other.id,method:'POST',data:consignment})).status,422)
  assert.equal((await call(`/api/admin/consignments/${back.id}/return`,{cookie,store:other.id,method:'POST',data:{revision:2,reason:'x'}})).status,404)
  await call('/api/admin/users',{cookie,method:'POST',data:{name:'Seller',email:'seller@example.test',password:'seller-test-password',role:'seller'}})
  const seller=(await call('/api/auth/login',{method:'POST',data:{email:'seller@example.test',password:'seller-test-password'}})).cookie
  assert.equal((await call('/api/admin/consignments',{cookie:seller})).status,403)
  const publicData=JSON.stringify((await call('/api/stock')).data);assert.ok(!publicData.includes(consignment.notes));assert.ok(!publicData.includes('payoutCents'))
  const noPhoto=(await call('/api/admin/stock',{cookie,method:'POST',data:{vehicle:{...seed[0],model:'Troca integral',status:'draft',images:[]}}})).data
  const fullInput={...input,vehicleId:seed[3].id,amountCents:1000000,payments:[],payoutDueDate:'',tradeIn:{vehicleId:noPhoto.id,amountCents:1000000,vehicleRevision:noPhoto.revision}}
  const full=(await call('/api/admin/deals',{cookie,method:'POST',data:fullInput}));assert.equal(full.status,201)
  const changed=(await call(`/api/admin/stock/${noPhoto.id}`,{cookie,method:'PUT',data:{revision:noPhoto.revision,vehicle:{...noPhoto,description:'Ficha revisada'}}})).data
  assert.equal((await call(`/api/admin/deals/${full.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,409)
  const corrected=(await call(`/api/admin/deals/${full.data.id}`,{cookie,method:'PUT',data:{...fullInput,revision:1,tradeIn:{...fullInput.tradeIn,vehicleRevision:changed.revision}}}));assert.equal(corrected.status,200)
  const beforeFull=(await call('/api/admin/ledger',{cookie})).data.length
  assert.equal((await call(`/api/admin/deals/${full.data.id}/complete`,{cookie,method:'POST',data:{revision:2}})).status,200)
  assert.equal((await call('/api/admin/ledger',{cookie})).data.length,beforeFull)
  assert.equal((await call('/api/admin/stock',{cookie})).data.find(v=>v.id===noPhoto.id).status,'draft')
  const foreign=(await call('/api/admin/stock',{cookie,store:other.id,method:'POST',data:{vehicle:{...seed[0],status:'draft'}}})).data
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...input,vehicleId:seed[5].id,payoutDueDate:'',tradeIn:{vehicleId:foreign.id,vehicleRevision:foreign.revision,amountCents:1000000}}})).status,422)
  api.close();api=await createApi({dataDir:dir,seed,aiKey:''})
  assert.equal((await call('/api/admin/consignments',{cookie})).data.find(c=>c.id===cons.data.id).status,'sold')
 }finally{await new Promise(resolve=>server.close(resolve));api.close();rmSync(dir,{recursive:true,force:true})}
})
