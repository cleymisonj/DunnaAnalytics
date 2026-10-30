import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
test('métricas: deduplicação, duração visível reportada, intenção, períodos, privacidade e isolamento',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-analytics-')),seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 let api=await createApi({dataDir:dir,seed,aiKey:''});const server=http.createServer((req,res)=>api.handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',data,cookie='',store=''}={})=>{const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',Cookie:cookie,'X-Store-Id':store,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  const cookie=(await call('/api/auth/setup',{method:'POST',data:{name:'Owner',email:'owner@example.test',password:'analytics-test-password'}})).cookie
  const report=async(days=30)=>await call('/api/admin/analytics?days='+days,{cookie})
  assert.equal((await call('/api/admin/analytics')).status,401)
  assert.equal((await report()).data.totalViews,0);assert.equal((await report()).data.averageMs,null)
  const event={kind:'open',source:'detail',vehicleId:seed[0].id,store:'minha-loja',viewId:randomUUID(),elapsedMs:0}
  const post=async(data,auth='')=>call('/api/analytics/event',{method:'POST',data,cookie:auth})
  assert.equal((await post({...event,elapsedMs:-1})).status,422)
  assert.equal((await report()).data.totalViews,0)
  assert.equal((await post(event,cookie)).data.excluded,true);assert.equal((await report()).data.totalViews,0)
  assert.equal((await post(event)).status,200);assert.equal((await post(event)).status,200)
  assert.equal((await report()).data.totalViews,1)
  assert.equal((await post({...event,kind:'time',elapsedMs:86400000})).status,200)
  assert.ok((await report()).data.averageMs<5000)
  api.db.prepare('UPDATE vehicle_engagement SET created=?,elapsed_ms=0 WHERE view_id=?').run(Date.now()-20000,event.viewId)
  assert.equal((await post({...event,kind:'time',elapsedMs:10000})).status,200)
  await post({...event,kind:'time',elapsedMs:5000})
  await post({...event,kind:'interest',elapsedMs:10000});await post({...event,kind:'interest',elapsedMs:10000})
  await post({...event,viewId:randomUUID()})
  const comparison={...event,viewId:randomUUID(),source:'comparison',kind:'interest'}
  await post(comparison);await post(comparison)
  const r=(await report()).data,v=r.rows.find(v=>v.id===seed[0].id)
  assert.equal(r.totalViews,2);assert.equal(r.averageMs,5000);assert.equal(v.detailInterests,1);assert.equal(v.comparisonInterests,1);assert.equal(v.interestRate,.5);assert.equal(r.interests,2)
  assert.equal((await post({...event,viewId:randomUUID(),kind:'time'})).status,404)
  const draft=(await call('/api/admin/stock',{cookie,method:'POST',data:{vehicle:{...seed[0],status:'draft'}}})).data
  assert.equal((await post({...event,viewId:randomUUID(),vehicleId:draft.id})).status,404)
  const other=(await call('/api/admin/stores',{cookie,method:'POST',data:{name:'Outra',slug:'outra',phone:'84920046908',city:'Natal/RN'}})).data
  assert.equal((await post({...event,store:'outra',viewId:randomUUID()})).status,404)
  assert.equal((await call('/api/admin/analytics',{cookie,store:other.id})).data.totalViews,0)
  api.db.prepare('UPDATE vehicle_engagement SET created=?').run(Date.now()-10*86400000)
  assert.equal((await report(7)).data.totalViews,0);assert.equal((await report(30)).data.totalViews,2)
  assert.equal((await report(999)).status,422)
  await call('/api/admin/users',{cookie,method:'POST',data:{name:'Seller',email:'seller@example.test',password:'seller-test-password',role:'seller'}})
  const seller=(await call('/api/auth/login',{method:'POST',data:{email:'seller@example.test',password:'seller-test-password'}})).cookie
  assert.equal((await call('/api/admin/analytics',{cookie:seller})).status,403)
  const pub=(await call('/api/stock')).data
  assert.ok(!JSON.stringify(pub).includes('interestRate'));assert.ok(!JSON.stringify(pub).includes('view_id'))
  api.close();api=await createApi({dataDir:dir,seed,aiKey:''});assert.equal((await report(30)).data.totalViews,2)
 }finally{await new Promise(resolve=>server.close(resolve));api.close();rmSync(dir,{recursive:true,force:true})}
})
