import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
test('RENAVE: preparação persistente, validação, isolamento e bloqueio de operações',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-renave-'))
 let api=await createApi({dataDir:dir,seed:[],aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',data,cookie='',store=''}={})=>{const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',Cookie:cookie,'X-Store-Id':store,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  assert.equal((await call('/api/admin/renave')).status,401)
  const setup=await call('/api/auth/setup',{method:'POST',data:{name:'Owner',email:'owner@example.test',password:'local-test-password-123'}}),cookie=setup.cookie
  const initial=(await call('/api/admin/renave',{cookie})).data
  assert.equal(initial.connected,false);assert.equal(initial.revision,0)
  const valid={...initial,cnpj:'11222333000181',legalName:'Empresa de teste',notes:'Pendência interna'}
  assert.equal((await call('/api/admin/renave',{cookie,method:'PUT',data:{...valid,cnpj:'11111111111111'}})).status,422)
  assert.equal((await call('/api/admin/renave',{cookie,method:'PUT',data:{...valid,contract:true}})).status,422)
  const saved=await call('/api/admin/renave',{cookie,method:'PUT',data:{...valid,connected:true,certificatePassword:'do-not-save'}})
  assert.equal(saved.status,200);assert.equal(saved.data.revision,1);assert.equal(saved.data.connected,false);assert.equal(saved.data.certificatePassword,undefined)
  assert.equal((await call('/api/admin/renave',{cookie,method:'PUT',data:valid})).status,409)
  assert.equal((await call('/api/admin/renave/entry',{cookie,method:'POST',data:{}})).status,503)
  const second=await call('/api/admin/stores',{cookie,method:'POST',data:{name:'Outra loja',slug:'outra-loja',phone:'84920046908',city:'Natal/RN'}})
  assert.equal(second.status,201)
  const otherId=second.data.id
  assert.equal((await call('/api/admin/renave',{cookie,store:otherId})).data.cnpj,'')
  const seller=await call('/api/admin/users',{cookie,method:'POST',data:{name:'Vendedor',email:'seller@example.test',password:'local-seller-password',role:'seller'}})
  assert.equal(seller.status,201)
  const login=await call('/api/auth/login',{method:'POST',data:{email:'seller@example.test',password:'local-seller-password'}})
  assert.equal((await call('/api/admin/renave',{cookie:login.cookie})).status,403)
  assert.equal((await call('/api/admin/renave',{cookie:login.cookie,store:otherId})).status,403)
  const pub=JSON.stringify((await call('/api/stock')).data)
  assert.ok(!pub.includes(valid.cnpj));assert.ok(!pub.includes(valid.notes))
  api.close();api=await createApi({dataDir:dir,seed:[],aiKey:''})
  assert.equal((await call('/api/admin/renave',{cookie})).data.notes,valid.notes)
 }finally{await new Promise(resolve=>server.close(resolve));api.close();rmSync(dir,{recursive:true,force:true})}
})
