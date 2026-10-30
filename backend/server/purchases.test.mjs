import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
test('compras e custos: aquisição única, financeiro atômico, despesas, cancelamento e isolamento',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-purchases-')),seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 let api=await createApi({dataDir:dir,seed,aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',data,cookie='',store=''}={})=>{const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',Cookie:cookie,'X-Store-Id':store,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  assert.equal((await call('/api/admin/costs')).status,401)
  const setup=await call('/api/auth/setup',{method:'POST',data:{name:'Owner',email:'owner@example.test',password:'purchases-test-password-123'}}),cookie=setup.cookie
  const person=await call('/api/admin/people',{cookie,method:'POST',data:{name:'Fornecedor teste',kind:'supplier',phone:'',email:'',city:'Natal/RN',notes:'',active:true}})
  const input={vehicleId:seed[0].id,personId:person.data.id,amountCents:3000000,purchaseDate:'2000-01-01',payments:[{amountCents:1000000,dueDate:'2026-11-01'},{amountCents:2000000,dueDate:'2026-12-01'}],notes:'Nota de aquisição privada'}
  let costs=(await call('/api/admin/costs',{cookie})).data
  assert.equal(costs.find(c=>c.vehicle.id===seed[0].id).costCents,null)
  assert.equal((await call('/api/admin/purchases',{cookie,method:'POST',data:{...input,amountCents:1}})).status,422)
  assert.equal((await call('/api/admin/purchases',{cookie,method:'POST',data:{...input,purchaseDate:'2999-01-01'}})).status,422)
  assert.equal((await call('/api/admin/purchases',{cookie,method:'POST',data:{...input,payments:[null]}})).status,422)
  api.db.exec("CREATE TRIGGER purchase_rollback_test BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT,'purchase rollback test'); END;")
  assert.equal((await call('/api/admin/purchases',{cookie,method:'POST',data:input})).status,500)
  assert.equal((await call('/api/admin/purchases',{cookie})).data.length,0);assert.equal((await call('/api/admin/ledger',{cookie})).data.length,0)
  api.db.exec('DROP TRIGGER purchase_rollback_test')
  const purchase=await call('/api/admin/purchases',{cookie,method:'POST',data:input});assert.equal(purchase.status,201)
  assert.equal((await call('/api/admin/purchases',{cookie,method:'POST',data:input})).status,409)
  let entries=(await call('/api/admin/ledger',{cookie})).data
  assert.equal(entries.length,2);assert.equal(entries.reduce((sum,e)=>sum+e.amountCents,0),3000000);assert.ok(entries.every(e=>e.source==='purchase'&&e.direction==='expense'&&e.status==='open'))
  const expense=await call('/api/admin/ledger',{cookie,method:'POST',data:{direction:'expense',vehicleId:seed[0].id,description:'Preparação',amountCents:60000,dueDate:'2026-11-01'}});assert.equal(expense.status,201)
  const checkCost=async()=> (await call('/api/admin/costs',{cookie})).data.find(c=>c.vehicle.id===seed[0].id)
  let c=await checkCost();assert.equal(c.acquisitionCents,3000000);assert.equal(c.expenseCents,60000);assert.equal(c.costCents,3060000);assert.equal(c.differenceCents,Math.round(seed[0].price*100)-3060000)
  let paid=await call(`/api/admin/ledger/${entries[0].id}/payment`,{cookie,method:'PATCH',data:{revision:1,status:'paid',paidDate:'2026-11-01'}});assert.equal(paid.status,200)
  assert.equal((await checkCost()).costCents,3060000)
  await call(`/api/admin/ledger/${expense.data.id}/payment`,{cookie,method:'PATCH',data:{revision:1,status:'paid',paidDate:'2026-11-01'}})
  assert.equal((await checkCost()).costCents,3060000)
  assert.equal((await call(`/api/admin/purchases/${purchase.data.id}/cancel`,{cookie,method:'POST',data:{revision:1,reason:'Correção'}})).status,409)
  const other=await call('/api/admin/stores',{cookie,method:'POST',data:{name:'Outra',slug:'outra',phone:'84920046908',city:'Natal/RN'}}),store=other.data.id
  assert.equal((await call('/api/admin/purchases',{cookie,store})).data.length,0);assert.equal((await call('/api/admin/costs',{cookie,store})).data.length,0)
  assert.equal((await call('/api/admin/purchases',{cookie,store,method:'POST',data:input})).status,422)
  assert.equal((await call(`/api/admin/purchases/${purchase.data.id}/cancel`,{cookie,store,method:'POST',data:{revision:1,reason:'x'}})).status,404)
  await call('/api/admin/users',{cookie,method:'POST',data:{name:'Seller',email:'seller@example.test',password:'seller-test-password',role:'seller'}})
  const seller=(await call('/api/auth/login',{method:'POST',data:{email:'seller@example.test',password:'seller-test-password'}})).cookie
  for(const route of ['costs','purchases'])assert.equal((await call('/api/admin/'+route,{cookie:seller})).status,403)
  await call(`/api/admin/ledger/${entries[0].id}/payment`,{cookie,method:'PATCH',data:{revision:2,status:'open'}})
  assert.equal((await call(`/api/admin/purchases/${purchase.data.id}/cancel`,{cookie,method:'POST',data:{revision:0,reason:'Correção'}})).status,409)
  assert.equal((await call(`/api/admin/purchases/${purchase.data.id}/cancel`,{cookie,method:'POST',data:{revision:1,reason:'Correção do valor'}})).status,200)
  entries=(await call('/api/admin/ledger',{cookie})).data.filter(e=>e.purchaseId===purchase.data.id)
  assert.ok(entries.every(e=>e.status==='void'))
  assert.equal((await call(`/api/admin/ledger/${entries[0].id}/payment`,{cookie,method:'PATCH',data:{revision:entries[0].revision,status:'paid',paidDate:'2026-11-01'}})).status,409)
  c=await checkCost();assert.equal(c.costCents,null);assert.equal(c.differenceCents,null);assert.equal(c.expenseCents,60000)
  const recreated=await call('/api/admin/purchases',{cookie,method:'POST',data:input});assert.equal(recreated.status,201)
  assert.equal((await checkCost()).costCents,3060000)
  const proposal=await call('/api/admin/deals',{cookie,method:'POST',data:{vehicleId:seed[0].id,personId:person.data.id,status:'proposal',amountCents:4000000,payments:[{dueDate:'2026-11-01',amountCents:4000000}],notes:''}})
  assert.equal((await call(`/api/admin/deals/${proposal.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,200)
  c=await checkCost();assert.equal(c.referenceType,'sale');assert.equal(c.referenceCents,4000000);assert.equal(c.differenceCents,940000)
  assert.equal((await call(`/api/admin/purchases/${recreated.data.id}/cancel`,{cookie,method:'POST',data:{revision:1,reason:'Correção'}})).status,409)
  assert.equal((await call('/api/admin/purchases',{cookie,method:'POST',data:{...input,vehicleId:seed[0].id}})).status,409)
  const publicStock=JSON.stringify((await call('/api/stock')).data);assert.ok(!publicStock.includes(input.notes));assert.ok(!publicStock.includes('acquisitionCents'))
  const localToday=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})
  const purchaseToday=await call('/api/admin/purchases',{cookie,method:'POST',data:{...input,vehicleId:seed[1].id,purchaseDate:localToday}})
  assert.equal(purchaseToday.status,201)
  assert.equal((await call('/api/admin/costs',{cookie})).data.find(c=>c.vehicle.id===seed[1].id).daysSincePurchase,0)
  api.close();api=await createApi({dataDir:dir,seed,aiKey:''});assert.equal((await checkCost()).costCents,3060000)
 }finally{await new Promise(resolve=>server.close(resolve));api.close();rmSync(dir,{recursive:true,force:true})}
})
