import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
test('perfil: edição própria, senha atual, sessões revogadas e privilégios preservados',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-profile-')),api=await createApi({dataDir:dir,seed:[],aiKey:''}),server=http.createServer(api.handler)
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',data,cookie='',store=''}={})=>{const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',Cookie:cookie,'X-Store-Id':store,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  assert.equal((await call('/api/account')).status,401)
  const credentials={name:'Owner',email:'owner@example.test',password:'local-profile-password-123'}
  const setup=await call('/api/auth/setup',{method:'POST',data:credentials});let cookie=setup.cookie
  const otherSession=(await call('/api/auth/login',{method:'POST',data:credentials})).cookie
  let p=(await call('/api/account',{cookie})).data
  assert.equal(p.store.name,'Minha loja');assert.equal(p.user.password,undefined)
  let input={name:'Nome atualizado',email:p.user.email,expectedName:p.user.name,expectedEmail:p.user.email,role:'seller',storeId:'other',id:'other'}
  let saved=await call('/api/account',{cookie,method:'PUT',data:input});assert.equal(saved.status,200);assert.equal(saved.data.user.name,input.name);assert.equal(saved.data.user.role,'platform');assert.equal(saved.data.user.storeId,'principal')
  assert.equal((await call('/api/account',{cookie,method:'PUT',data:input})).status,409)
  p=saved.data;input={name:p.user.name,email:'new@example.test',expectedName:p.user.name,expectedEmail:p.user.email,currentPassword:'wrong'}
  assert.equal((await call('/api/account',{cookie,method:'PUT',data:input})).status,403)
  saved=await call('/api/account',{cookie,method:'PUT',data:{...input,currentPassword:credentials.password}})
  assert.equal(saved.status,200);assert.equal(saved.data.sessionsReset,true);cookie=saved.cookie
  assert.equal((await call('/api/account',{cookie:otherSession})).status,401)
  assert.equal((await call('/api/account',{cookie})).data.user.email,'new@example.test')
  p=saved.data;input={name:p.user.name,email:p.user.email,expectedName:p.user.name,expectedEmail:p.user.email,currentPassword:credentials.password,newPassword:'short'}
  assert.equal((await call('/api/account',{cookie,method:'PUT',data:input})).status,422)
  const oldCookie=cookie
  saved=await call('/api/account',{cookie,method:'PUT',data:{...input,newPassword:'new-local-password-456'}});assert.equal(saved.status,200);cookie=saved.cookie
  assert.equal((await call('/api/account',{cookie:oldCookie})).status,401)
  assert.equal((await call('/api/auth/login',{method:'POST',data:{email:p.user.email,password:credentials.password}})).status,401)
  assert.equal((await call('/api/auth/login',{method:'POST',data:{email:p.user.email,password:'new-local-password-456'}})).status,200)
  await call('/api/admin/users',{cookie,method:'POST',data:{name:'Vendedor',email:'seller@example.test',password:'seller-local-password',role:'seller'}})
  let seller=(await call('/api/auth/login',{method:'POST',data:{email:'seller@example.test',password:'seller-local-password'}})).cookie
  p=(await call('/api/account',{cookie:seller,store:'unrelated'})).data
  saved=await call('/api/account',{cookie:seller,method:'PUT',data:{name:'Vendedor editado',email:p.user.email,expectedName:p.user.name,expectedEmail:p.user.email,role:'platform',storeId:'unrelated'}})
  assert.equal(saved.status,200);assert.equal(saved.data.user.role,'seller');assert.equal(saved.data.user.storeId,'principal')
  assert.equal((await call('/api/admin/users',{cookie:seller})).status,403)
  p=saved.data
  assert.equal((await call('/api/account',{cookie:seller,method:'PUT',data:{name:p.user.name,email:'new@example.test',currentPassword:'seller-local-password',expectedName:p.user.name,expectedEmail:p.user.email}})).status,409)
 }finally{await new Promise(resolve=>server.close(resolve));api.close();rmSync(dir,{recursive:true,force:true})}
})
