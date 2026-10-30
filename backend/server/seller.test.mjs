import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'

test('vendedor responsável: só usuário ativo da loja, vitrine mostra apenas o nome',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-seller-test-'))
 const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 const api=await createApi({dataDir:dir,seed,aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',cookie='',store='',data}={})=>{
  const response=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',...(cookie?{Cookie:cookie}:{}),...(store?{'X-Store-Id':store}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
 }
 try{
  const owner=(await call('/api/auth/setup',{method:'POST',data:{name:'Dono',email:'dono@example.test',password:'senha-do-dono-123456'}})).cookie
  const seller=await call('/api/admin/users',{method:'POST',cookie:owner,data:{name:'Carla Souza',email:'carla@example.test',password:'senha-da-carla-123456',role:'seller'}})
  assert.equal(seller.status,201)
  const users=(await call('/api/admin/users',{cookie:owner})).data
  const carla=users.find(u=>u.email==='carla@example.test')
  assert.ok(carla?.id)

  // Outra loja, com o próprio vendedor
  const other=await call('/api/admin/stores',{method:'POST',cookie:owner,data:{slug:'outra-loja',name:'Outra Loja',phone:'84999990000',city:'Mossoró/RN'}})
  assert.equal(other.status,201)
  await call('/api/admin/users',{method:'POST',cookie:owner,store:other.data.id,data:{name:'Pedro',email:'pedro@example.test',password:'senha-do-pedro-123456',role:'seller'}})
  const pedro=(await call('/api/admin/users',{cookie:owner,store:other.data.id})).data.find(u=>u.email==='pedro@example.test')

  const car=(await call('/api/admin/stock',{cookie:owner})).data.find(v=>v.status==='available')
  // Vendedor de outra loja é recusado
  assert.equal((await call('/api/admin/stock/'+car.id,{method:'PUT',cookie:owner,data:{vehicle:{...car,sellerId:pedro.id},revision:car.revision}})).status,422)
  const saved=await call('/api/admin/stock/'+car.id,{method:'PUT',cookie:owner,data:{vehicle:{...car,sellerId:carla.id},revision:car.revision}})
  assert.equal(saved.status,200)
  assert.equal(saved.data.sellerId,carla.id)

  // Vitrine: nome do vendedor, sem id nem e-mail
  const account=(await call('/api/account',{cookie:owner})).data
  const store=(await call('/api/admin/stores',{cookie:owner})).data.find(s=>s.id===account.store.id)
  const stock=await call('/api/stock?store='+store.slug)
  const publicCar=stock.data.vehicles.find(v=>v.id===car.id)
  assert.deepEqual(publicCar.seller,{name:'Carla Souza'})
  assert.equal('sellerId' in publicCar,false)
  assert.equal(JSON.stringify(stock.data).includes('carla@example.test'),false)

 }finally{server.close();await api.close?.();rmSync(dir,{recursive:true,force:true})}
})
