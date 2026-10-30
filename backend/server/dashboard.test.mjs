import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'

async function start(){
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-dashboard-'))
 const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
 const api=await createApi({dataDir:dir,seed,aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const call=async(route,{method='GET',cookie='',data,raw,headers={}}={})=>{
  const response=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):raw})
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
 }
 const owner=(await call('/api/auth/setup',{method:'POST',data:{name:'Dono',email:'dono@example.test',password:'senha-do-dono-123456'}})).cookie
 const stop=async()=>{server.close();await api.close?.();rmSync(dir,{recursive:true,force:true})}
 return {call,owner,stop}
}
const localDate=(offset)=>new Date(Date.now()+offset*86400000).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})

test('painel do dono: retornos, avaliações, financeiro, estoque e vendas do mês',async()=>{
 const {call,owner,stop}=await start()
 try{
  const lead=(data)=>call('/api/admin/leads',{method:'POST',cookie:owner,data:{phone:'84999990000',interest:'SUV',source:'Instagram',stage:'contact',assignedTo:'',...data}})
  await lead({name:'Atrasada',nextContactAt:new Date(Date.now()-2*3600000).toISOString()})
  await lead({name:'Futura',nextContactAt:new Date(Date.now()+5*86400000).toISOString()})
  await lead({name:'Perdida',stage:'lost',lossReason:'Desistiu da compra',nextContactAt:''})

  // Avaliação pela vitrine, aguardando resposta
  const [photo]=(await call('/api/public/appraisals/uploads',{method:'POST',data:{store:'minha-loja',files:[{kind:'photo',type:'image/jpeg',size:10}]}})).data
  await call(photo.upload.url,{method:'PUT',raw:Buffer.alloc(10,1),headers:photo.upload.headers})
  assert.equal((await call('/api/public/appraisals',{method:'POST',data:{store:'minha-loja',name:'Paulo',phone:'84998765432',model:'Fiat Argo',year:2021,media:[photo.name]}})).status,201)

  // Financeiro: uma conta atrasada e um recebimento na semana
  await call('/api/admin/ledger',{method:'POST',cookie:owner,data:{direction:'expense',description:'Funilaria',amountCents:120000,dueDate:localDate(-2)}})
  await call('/api/admin/ledger',{method:'POST',cookie:owner,data:{direction:'income',description:'Parcela',amountCents:500000,dueDate:localDate(3)}})
  await call('/api/admin/ledger',{method:'POST',cookie:owner,data:{direction:'income',description:'Longe',amountCents:900000,dueDate:localDate(30)}})

  // Venda concluída neste mês
  const person=(await call('/api/admin/people',{method:'POST',cookie:owner,data:{name:'Cliente',kind:'customer',phone:'84999999999',email:'',city:'Natal/RN',notes:'',active:true}})).data
  const [car]=(await call('/api/admin/stock',{cookie:owner})).data.filter(v=>v.status==='available')
  const deal=(await call('/api/admin/deals',{method:'POST',cookie:owner,data:{vehicleId:car.id,personId:person.id,status:'proposal',amountCents:4000000,payments:[{dueDate:localDate(40),amountCents:4000000}],notes:''}})).data
  assert.equal((await call(`/api/admin/deals/${deal.id}/complete`,{method:'POST',cookie:owner,data:{revision:deal.revision}})).status,200)

  const d=(await call('/api/admin/dashboard',{cookie:owner})).data
  assert.equal(d.leads.overdue,1)
  assert.equal(d.leads.next[0].name,'Atrasada')
  assert.ok(d.leads.newThisWeek>=4,'inclui o lead criado pela avaliação')
  assert.equal(d.appraisals.waiting,1)
  assert.equal(d.appraisals.list[0].model,'Fiat Argo')
  assert.deepEqual([d.finance.payable.overdueCount,d.finance.payable.overdueCents],[1,120000])
  assert.deepEqual([d.finance.receivable.weekCount,d.finance.receivable.weekCents],[1,500000])
  assert.equal(d.sales.count,1)
  assert.equal(d.sales.saleCents,4000000)
  assert.ok(d.stock.vehicles>0)
  assert.equal(typeof d.legal.unsigned,'number')
 }finally{await stop()}
})

test('painel do vendedor: só os próprios interessados e vendas, sem financeiro',async()=>{
 const {call,owner,stop}=await start()
 try{
  await call('/api/admin/users',{method:'POST',cookie:owner,data:{name:'Bia',email:'bia@example.test',password:'senha-da-bia-123456',role:'seller'}})
  const bia=(await call('/api/admin/users',{cookie:owner})).data.find(u=>u.email==='bia@example.test')
  const past=new Date(Date.now()-3600000).toISOString()
  await call('/api/admin/leads',{method:'POST',cookie:owner,data:{name:'Da Bia',phone:'84999990000',interest:'',source:'',stage:'contact',assignedTo:bia.id,nextContactAt:past}})
  await call('/api/admin/leads',{method:'POST',cookie:owner,data:{name:'De outro',phone:'84999990001',interest:'',source:'',stage:'contact',assignedTo:'',nextContactAt:past}})
  const seller=(await call('/api/auth/login',{method:'POST',data:{email:'bia@example.test',password:'senha-da-bia-123456'}})).cookie
  const d=(await call('/api/admin/dashboard',{cookie:seller})).data
  assert.equal(d.leads.overdue,1)
  assert.equal(d.leads.next[0].name,'Da Bia')
  assert.equal(d.finance,undefined)
  assert.equal(d.appraisals,undefined)
  assert.equal(d.sales.marginCents,null)
 }finally{await stop()}
})
