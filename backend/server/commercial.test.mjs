import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
test('comercial: venda atômica, recebimentos, baixas, permissões e isolamento',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-commercial-'))
 const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 let api=await createApi({dataDir:dir,seed,aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',data,cookie='',store=''}={})=>{const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',Cookie:cookie,'X-Store-Id':store,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  assert.equal((await call('/api/admin/people')).status,401)
  const setup=await call('/api/auth/setup',{method:'POST',data:{name:'Owner',email:'owner@example.test',password:'local-test-password-123'}}),cookie=setup.cookie
  const person={name:'Cliente de teste',kind:'customer',phone:'84999999999',email:'buyer@example.test',city:'Natal/RN',notes:'Dado privado',active:true}
  const p=await call('/api/admin/people',{cookie,method:'POST',data:person});assert.equal(p.status,201)
  assert.equal((await call('/api/admin/people',{cookie,method:'POST',data:{...person,email:'errado'}})).status,422)
  assert.equal((await call('/api/admin/people/'+p.data.id,{cookie,method:'PUT',data:{...p.data,revision:0}})).status,409)
  const proposal={vehicleId:seed[0].id,personId:p.data.id,status:'proposal',amountCents:1000000,payments:[{dueDate:'2026-11-01',amountCents:300000},{dueDate:'2026-12-01',amountCents:700000}],notes:'Condições acordadas'}
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...proposal,amountCents:999999}})).status,422)
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...proposal,payments:[{dueDate:'2026-02-30',amountCents:1000000}]}})).status,422)
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...proposal,status:'completed'}})).status,422)
  const deal=await call('/api/admin/deals',{cookie,method:'POST',data:proposal});assert.equal(deal.status,201)
  const rival=await call('/api/admin/deals',{cookie,method:'POST',data:proposal});assert.equal(rival.status,201)
  assert.equal((await call('/api/admin/ledger',{cookie})).data.length,0)
  // Simulate a ledger failure after vehicle update: the sale must roll back completely.
  api.db.exec("CREATE TRIGGER reject_test_ledger BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT,'test rollback'); END;")
  assert.equal((await call(`/api/admin/deals/${deal.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,500)
  assert.equal((await call('/api/admin/stock',{cookie})).data.find(c=>c.id===seed[0].id).status,'available')
  assert.equal((await call('/api/admin/ledger',{cookie})).data.length,0)
  api.db.exec('DROP TRIGGER reject_test_ledger')
  const complete=await call(`/api/admin/deals/${deal.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})
  assert.equal(complete.status,200);assert.equal(complete.data.status,'completed');assert.equal(complete.data.personName,person.name)
  assert.equal((await call('/api/stock')).data.vehicles.some(c=>c.id===seed[0].id),false)
  let entries=(await call('/api/admin/ledger',{cookie})).data;assert.equal(entries.length,2);assert.equal(entries.reduce((s,e)=>s+e.amountCents,0),1000000);assert.ok(entries.every(e=>e.status==='open'))
  assert.equal((await call(`/api/admin/deals/${deal.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,409)
  assert.equal((await call(`/api/admin/deals/${rival.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,409)
  assert.equal((await call('/api/admin/ledger',{cookie})).data.length,2)
  assert.equal((await call(`/api/admin/deals/${deal.data.id}`,{cookie,method:'PUT',data:{...complete.data,status:'proposal'}})).status,409)
  api.db.prepare("UPDATE vehicles SET data=json_set(data,'$.status','available') WHERE id=?").run(seed[0].id)
  assert.equal((await call(`/api/admin/deals/${rival.data.id}/complete`,{cookie,method:'POST',data:{revision:1}})).status,409)
  api.db.prepare("UPDATE vehicles SET data=json_set(data,'$.status','sold') WHERE id=?").run(seed[0].id)
  assert.equal((await call('/api/admin/deals',{cookie,method:'POST',data:{...proposal,payments:[null]}})).status,422)
  let payment=await call(`/api/admin/ledger/${entries[0].id}/payment`,{cookie,method:'PATCH',data:{revision:1,status:'paid',paidDate:'2026-11-01'}})
  assert.equal(payment.status,200);assert.equal(payment.data.status,'paid')
  assert.equal((await call(`/api/admin/ledger/${entries[0].id}/payment`,{cookie,method:'PATCH',data:{revision:1,status:'paid',paidDate:'2026-11-01'}})).status,409)
  payment=await call(`/api/admin/ledger/${entries[0].id}/payment`,{cookie,method:'PATCH',data:{revision:2,status:'open'}})
  assert.equal(payment.data.paidDate,'')
  const expense=await call('/api/admin/ledger',{cookie,method:'POST',data:{direction:'expense',description:'Revisão',amountCents:50000,dueDate:'2026-11-01',vehicleId:seed[0].id}});assert.equal(expense.status,201)
  const other=await call('/api/admin/stores',{cookie,method:'POST',data:{name:'Outra loja',slug:'outra',phone:'84920046908',city:'Natal/RN'}});assert.equal(other.status,201)
  const store=other.data.id
  for(const route of ['people','deals','ledger'])assert.equal((await call('/api/admin/'+route,{cookie,store})).data.length,0)
  assert.equal((await call('/api/admin/deals',{cookie,store,method:'POST',data:proposal})).status,422)
  assert.equal((await call(`/api/admin/ledger/${entries[0].id}/payment`,{cookie,store,method:'PATCH',data:{revision:3,status:'paid',paidDate:'2026-11-01'}})).status,404)
  await call('/api/admin/users',{cookie,method:'POST',data:{name:'Seller',email:'seller@example.test',password:'local-seller-password',role:'seller'}})
  const login=await call('/api/auth/login',{method:'POST',data:{email:'seller@example.test',password:'local-seller-password'}})
  for(const route of ['people','deals','ledger'])assert.equal((await call('/api/admin/'+route,{cookie:login.cookie})).status,403)
  assert.ok(!JSON.stringify((await call('/api/stock')).data).includes(person.email))
  api.close();api=await createApi({dataDir:dir,seed,aiKey:''})
  assert.equal((await call('/api/admin/ledger',{cookie})).data.length,3)
  assert.equal((await call('/api/admin/deals',{cookie})).data.find(d=>d.id===deal.data.id).status,'completed')
 }finally{await new Promise(resolve=>server.close(resolve));api.close();rmSync(dir,{recursive:true,force:true})}
})
