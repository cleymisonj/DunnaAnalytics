import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'

test('autenticação, isolamento entre lojas, estoque, conflitos e permissões do CRM',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-api-test-'))
 const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 const api=await createApi({dataDir:dir,seed,aiKey:""})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',cookie='',store='',data,raw,headers={}}={})=>{
  const response=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',...(cookie?{Cookie:cookie}:{}),...(store?{'X-Store-Id':store}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):raw})
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
 }
 try{
  assert.equal((await call('/api/admin/stock')).status,401)
  assert.equal((await call('/api/auth/status')).data.needsSetup,true)
  const setup=await call('/api/auth/setup',{method:'POST',data:{name:'Test Owner',email:'owner@example.test',password:'test-owner-password-123'}})
  assert.equal(setup.status,201);assert.match(setup.cookie,/dunna_session=/);const owner=setup.cookie
  assert.equal((await call('/api/auth/setup',{method:'POST',data:{name:'Other',email:'other@example.test',password:'another-test-password'}})).status,409)
  const csrf=await fetch(base+'/api/admin/stores',{method:'POST',headers:{Cookie:owner,'Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403)
  assert.equal((await call('/api/admin/stores',{method:'POST',cookie:owner,data:{},headers:{Origin:'https://untrusted.example'}})).status,403)
  let stock=await call('/api/admin/stock',{cookie:owner});assert.equal(stock.data.length,seed.length)
  const original=stock.data.find(v=>v.status === 'available')
  assert.equal((await call('/api/admin/ai/status',{cookie:owner})).data.configured,false)
  assert.equal((await call('/api/admin/ai/description',{method:'POST',cookie:owner,data:{vehicle:original}})).status,503)
  assert.equal((await call('/api/admin/stock/'+original.id,{method:'PUT',cookie:owner,data:{vehicle:{...original,price:-1},revision:original.revision}})).status,422)
  const sold=await call('/api/admin/stock/'+original.id,{method:'PUT',cookie:owner,data:{vehicle:{...original,status:'sold',documentation:'PRIVATE DOCUMENT NOTES'},revision:original.revision}})
  assert.equal(sold.status,200);assert.equal(sold.data.revision,original.revision+1)
  assert.equal((await call('/api/admin/stock/'+original.id,{method:'PUT',cookie:owner,data:{vehicle:original,revision:original.revision}})).status,409)
  const publicStock=await call('/api/stock');assert.equal(publicStock.data.vehicles.length,6);assert.ok(publicStock.data.vehicles.every(v=>!('documentation' in v)))
  const other=await call('/api/admin/stores',{method:'POST',cookie:owner,data:{name:'Other Motors',slug:'other-motors',phone:'84999999999',city:'Natal/RN'}});assert.equal(other.status,201)
  const otherId=other.data.id
  assert.equal((await call('/api/admin/stock',{cookie:owner,store:otherId})).data.length,0)
  const user=await call('/api/admin/users',{method:'POST',cookie:owner,store:otherId,data:{name:'Store Admin',email:'admin@example.test',password:'test-admin-password-123',role:'admin'}});assert.equal(user.status,201)
  const signed=await call('/api/auth/login',{method:'POST',data:{email:'admin@example.test',password:'test-admin-password-123'}});assert.equal(signed.status,200)
  const admin=signed.cookie
  assert.equal((await call('/api/admin/stock',{cookie:admin,store:'principal'})).status,403)
  assert.equal((await call('/api/admin/stock/'+original.id,{method:'PUT',cookie:admin,data:{vehicle:original,revision:1}})).status,404)
  const created=await call('/api/admin/stock',{method:'POST',cookie:admin,data:{vehicle:{...original,id:'',status:'draft',images:[]},revision:0}});assert.equal(created.status,201)
  assert.equal((await call('/api/stock?store=other-motors')).data.vehicles.length,0)
  const publish=await call('/api/admin/stock/'+created.data.id,{method:'PUT',cookie:admin,data:{vehicle:{...created.data,status:'available',images:original.images},revision:1}});assert.equal(publish.status,200)
  assert.equal((await call('/api/stock?store=other-motors')).data.vehicles.length,1)
  const seller=await call('/api/admin/users',{method:'POST',cookie:admin,data:{name:'Seller',email:'seller@example.test',password:'test-seller-password-123',role:'seller'}});assert.equal(seller.status,201)
  const sellerLogin=await call('/api/auth/login',{method:'POST',data:{email:'seller@example.test',password:'test-seller-password-123'}});const sellerCookie=sellerLogin.cookie
  assert.equal((await call('/api/admin/stock',{method:'POST',cookie:sellerCookie,data:{vehicle:original}})).status,403)
  assert.equal((await call('/api/admin/users',{cookie:sellerCookie})).status,403)
  assert.equal((await call('/api/admin/ai/description',{method:'POST',cookie:sellerCookie,data:{vehicle:original}})).status,403)
  const lead=await call('/api/admin/leads',{method:'POST',cookie:admin,data:{name:'Interested person',phone:'84999999999',stage:'new',assignedTo:seller.data.id,interest:'SUV',note:'First conversation'}});assert.equal(lead.status,201)
  assert.equal((await call('/api/admin/leads',{cookie:sellerCookie})).data.length,1)
  await call('/api/admin/leads',{method:'POST',cookie:admin,data:{name:'Unassigned',phone:'84999999998',stage:'new',assignedTo:''}})
  assert.equal((await call('/api/admin/leads',{cookie:sellerCookie})).data.length,1)
  assert.equal((await call('/api/admin/leads',{cookie:owner})).data.length,0)
  const updated=await call('/api/admin/leads/'+lead.data.id,{method:'PUT',cookie:sellerCookie,data:{...lead.data,stage:'contact',note:'Called client'}});assert.equal(updated.status,200);assert.equal(updated.data.history.length,3)
  assert.equal((await call('/api/admin/upload',{method:'POST',cookie:admin,raw:Buffer.from('<svg>not an image</svg>'),headers:{'Content-Type':'image/svg+xml'}})).status,422)
  assert.equal((await call('/api/admin/users/'+seller.data.id,{method:'PATCH',cookie:admin,data:{active:false}})).status,200)
  assert.equal((await call('/api/admin/stock',{cookie:sellerCookie})).status,401)
  assert.equal((await call('/api/auth/logout',{method:'POST',cookie:admin})).status,200)
  assert.equal((await call('/api/admin/stock',{cookie:admin})).status,401)
  api.close()
  const reopened=await createApi({dataDir:dir,seed:[]})
  assert.equal(reopened.db.prepare('SELECT count(*) as n FROM stores').get().n,2)
  assert.equal(reopened.db.prepare('SELECT count(*) as n FROM vehicles').get().n,seed.length+1)
  reopened.close()
 }finally{
  await new Promise(resolve=>server.close(resolve))
  try{api.close()}catch{}
  assert.ok(dir.startsWith(path.join(tmpdir(),'dunna-api-test-')))
  rmSync(dir,{recursive:true,force:true})
 }
})

