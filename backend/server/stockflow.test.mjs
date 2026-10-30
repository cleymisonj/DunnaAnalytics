import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createApi} from './api.mjs'
import {suggestPrice,DEFAULT_AGING} from './stockflow.mjs'

async function start(){
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-stockflow-'))
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
 return {call,owner,stop}
}
const localDate=(daysAgo)=>new Date(Date.now()-daysAgo*86400000).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})

test('sugestão de preço: faixas de idade, teto pela FIPE e piso de margem',()=>{
 const s=DEFAULT_AGING
 assert.equal(suggestPrice({price:80000,fipe:null,days:10,costCents:null,settings:s}),null)
 assert.equal(suggestPrice({price:80000,fipe:null,days:35,costCents:null,settings:s}).price,78490)
 assert.equal(suggestPrice({price:80000,fipe:null,days:65,costCents:null,settings:s}).price,76990)
 assert.equal(suggestPrice({price:80000,fipe:null,days:95,costCents:null,settings:s}).price,74990)
 // Bem acima da FIPE: aproxima de FIPE + 3%
 assert.equal(suggestPrice({price:90000,fipe:70000,days:35,costCents:null,settings:s}).price,71990)
 // Piso: custo R$ 74.000 com margem mínima de 8% = R$ 79.920
 const floor=suggestPrice({price:82000,fipe:null,days:95,costCents:7400000,settings:s})
 assert.equal(floor.floor,79920)
 assert.equal(floor.price,79990)
 assert.ok(floor.price>=floor.floor)
 const stuck=suggestPrice({price:80000,fipe:null,days:95,costCents:7400000,settings:s})
 assert.equal(stuck.price,null)
 assert.match(stuck.reason,/margem mínima/)
})

test('preparação: serviços concluídos viram despesa do veículo e acompanham as mudanças',async()=>{
 const {call,owner,stop}=await start()
 try{
  const supplier=(await call('/api/admin/people',{method:'POST',cookie:owner,data:{name:'Oficina Silva',kind:'supplier',phone:'',email:'',city:'Natal/RN',notes:'',active:true}})).data
  const [car]=(await call('/api/admin/stock',{cookie:owner})).data.filter(v=>v.status==='available')
  const created=await call('/api/admin/preparations',{method:'POST',cookie:owner,data:{vehicleId:car.id}})
  assert.equal(created.status,201)
  assert.equal(created.data.tasks.length,6)
  assert.equal((await call('/api/admin/preparations',{method:'POST',cookie:owner,data:{vehicleId:car.id}})).status,409)
  let prep=created.data
  const put=(tasks)=>call('/api/admin/preparations/'+prep.id,{method:'PUT',cookie:owner,data:{revision:prep.revision,tasks}})
  const expenses=async()=>(await call('/api/admin/ledger',{cookie:owner})).data.filter(e=>e.source==='preparation')
  const cost=async()=>(await call('/api/admin/costs',{cookie:owner})).data.find(e=>e.vehicle.id===car.id).expenseCents

  // Concluir a revisão com custo cria a despesa no financeiro, ligada ao veículo e ao fornecedor
  let tasks=prep.tasks.map((t,i)=>i===0?{...t,status:'done',costCents:85000,supplierId:supplier.id}:t)
  let r=await put(tasks);assert.equal(r.status,200);prep=r.data
  let [entry]=await expenses()
  assert.equal(entry.amountCents,85000)
  assert.equal(entry.vehicleId,car.id)
  assert.equal(entry.personId,supplier.id)
  assert.equal(entry.status,'open')
  assert.equal(await cost(),85000)
  assert.ok(prep.tasks[0].doneAt)

  // Alterar o valor atualiza o mesmo lançamento
  tasks=prep.tasks.map((t,i)=>i===0?{...t,costCents:90000}:t)
  r=await put(tasks);prep=r.data
  assert.equal((await expenses()).length,1)
  assert.equal((await expenses())[0].amountCents,90000)

  // Lançamento pago não pode ser alterado pelo serviço
  entry=(await expenses())[0]
  assert.equal((await call(`/api/admin/ledger/${entry.id}/payment`,{method:'PATCH',cookie:owner,data:{revision:entry.revision,status:'paid',paidDate:localDate(0)}})).status,200)
  assert.equal((await put(prep.tasks.map((t,i)=>i===0?{...t,costCents:95000}:t))).status,409)
  assert.equal((await put(prep.tasks.filter((t,i)=>i!==0))).status,409,'não remove serviço com despesa paga')

  // Polimento concluído e depois reaberto: a despesa aberta é cancelada
  tasks=prep.tasks.map((t,i)=>i===2?{...t,status:'done',costCents:30000}:t)
  r=await put(tasks);prep=r.data
  assert.equal((await expenses()).filter(e=>e.status==='open').length,1)
  r=await put(prep.tasks.map((t,i)=>i===2?{...t,status:'doing'}:t));prep=r.data
  assert.equal((await expenses()).find(e=>e.amountCents===30000).status,'void')
  assert.equal(await cost(),90000)

  // Serviço novo e validações
  assert.equal((await put([...prep.tasks,{category:'Inexistente',description:'x',status:'todo',costCents:0}])).status,422)
  assert.equal((await put([...prep.tasks,{category:'Outros',description:'Cópia da chave',status:'todo',costCents:-1}])).status,422)

  // Finalizar exige tudo concluído
  assert.equal((await call(`/api/admin/preparations/${prep.id}/finish`,{method:'POST',cookie:owner,data:{revision:prep.revision}})).status,422)
  r=await put(prep.tasks.map(t=>({...t,status:'done'})));prep=r.data
  const done=await call(`/api/admin/preparations/${prep.id}/finish`,{method:'POST',cookie:owner,data:{revision:prep.revision}})
  assert.equal(done.status,200)
  assert.equal(done.data.status,'ready')
  assert.equal((await call('/api/admin/preparations/'+prep.id,{method:'PUT',cookie:owner,data:{revision:done.data.revision,tasks:done.data.tasks}})).status,409)
  const reopened=await call(`/api/admin/preparations/${prep.id}/reopen`,{method:'POST',cookie:owner,data:{revision:done.data.revision}})
  assert.equal(reopened.data.status,'in_progress')
 }finally{await stop()}
})

test('preparação de rascunho: finalizar e publicar exige foto',async()=>{
 const {call,owner,stop}=await start()
 try{
  const [car]=(await call('/api/admin/stock',{cookie:owner})).data.filter(v=>v.status==='available')
  const {revision,...vehicle}=car
  await call('/api/admin/stock/'+car.id,{method:'PUT',cookie:owner,data:{revision,vehicle:{...vehicle,status:'draft'}}})
  let prep=(await call('/api/admin/preparations',{method:'POST',cookie:owner,data:{vehicleId:car.id,template:false}})).data
  assert.equal(prep.tasks.length,0)
  prep=(await call('/api/admin/preparations/'+prep.id,{method:'PUT',cookie:owner,data:{revision:prep.revision,tasks:[{category:'Higienização',description:'Lavagem completa',status:'done',costCents:0}]}})).data
  const done=await call(`/api/admin/preparations/${prep.id}/finish`,{method:'POST',cookie:owner,data:{revision:prep.revision,publish:true}})
  assert.equal(done.status,200)
  assert.equal((await call('/api/admin/stock',{cookie:owner})).data.find(v=>v.id===car.id).status,'available')
  assert.equal((await call('/api/admin/ledger',{cookie:owner})).data.filter(e=>e.source==='preparation').length,0,'serviço sem custo não gera despesa')
 }finally{await stop()}
})

test('idade do estoque: data de entrada, custo parado, sugestão e histórico de preço',async()=>{
 const {call,owner,stop}=await start()
 try{
  const person=(await call('/api/admin/people',{method:'POST',cookie:owner,data:{name:'Vendedor PF',kind:'supplier',phone:'',email:'',city:'Natal/RN',notes:'',active:true}})).data
  const [car]=(await call('/api/admin/stock',{cookie:owner})).data.filter(v=>v.status==='available')
  const purchaseDate=localDate(65)
  assert.equal((await call('/api/admin/purchases',{method:'POST',cookie:owner,data:{vehicleId:car.id,personId:person.id,amountCents:3000000,purchaseDate,payments:[{amountCents:3000000,dueDate:purchaseDate}],notes:''}})).status,201)

  assert.equal((await call('/api/admin/stock-aging/settings',{method:'PUT',cookie:owner,data:{alertDays:[60,30,90],monthlyRatePct:1.5,dailyCostCents:0,minMarginPct:8}})).status,422)
  assert.equal((await call('/api/admin/stock-aging/settings',{method:'PUT',cookie:owner,data:{alertDays:[30,60,90],monthlyRatePct:2,dailyCostCents:1000,minMarginPct:8}})).status,200)
  let report=(await call('/api/admin/stock-aging',{cookie:owner})).data
  let row=report.vehicles.find(v=>v.id===car.id)
  assert.equal(row.entryDate,purchaseDate)
  assert.equal(row.entrySource,'purchase')
  assert.equal(row.days,65)
  assert.equal(row.band,2)
  assert.equal(row.costCents,3000000)
  // 2% ao mês sobre R$ 30.000 por 65 dias + R$ 10/dia
  assert.equal(row.holdingCents,Math.round(3000000*0.02*65/30)+1000*65)
  assert.ok(row.suggestion.price<car.price)
  assert.equal(report.vehicles[0].days>=report.vehicles.at(-1).days,true,'mais antigos primeiro')

  // Aplicar a sugestão grava o histórico e some da vitrine
  assert.equal((await call(`/api/admin/stock-aging/${car.id}/price`,{method:'POST',cookie:owner,data:{revision:row.revision+1,price:row.suggestion.price}})).status,409)
  assert.equal((await call(`/api/admin/stock-aging/${car.id}/price`,{method:'POST',cookie:owner,data:{revision:row.revision,price:row.suggestion.price}})).status,200)
  report=(await call('/api/admin/stock-aging',{cookie:owner})).data
  row=report.vehicles.find(v=>v.id===car.id)
  assert.equal(row.price,report.vehicles.find(v=>v.id===car.id).price)
  assert.deepEqual([row.priceHistory.at(-1).from,row.priceHistory.at(-1).to],[car.price,row.price])
  assert.equal(row.suggestion.price,null,'não sugere nova redução logo após baixar o preço')
  assert.match(row.suggestion.reason,/Aguarde 15 dia/)
  const pub=(await call('/api/stock?store=minha-loja')).data.vehicles.find(v=>v.id===car.id)
  assert.equal(pub.priceHistory,undefined)
  assert.equal(pub.price,row.price)

  // Editar o veículo pelo formulário mantém o histórico e registra a nova troca
  const current=(await call('/api/admin/stock',{cookie:owner})).data.find(v=>v.id===car.id)
  const {revision,priceHistory,listedAt,...vehicle}=current
  assert.equal((await call('/api/admin/stock/'+car.id,{method:'PUT',cookie:owner,data:{revision,vehicle:{...vehicle,price:current.price-1000}}})).status,200)
  const after=(await call('/api/admin/stock',{cookie:owner})).data.find(v=>v.id===car.id)
  assert.equal(after.priceHistory.length,2)

  // Veículo novo recebe a data de entrada
  const {id,revision:_r,priceHistory:_p,listedAt:_l,...base}=current
  const created=(await call('/api/admin/stock',{method:'POST',cookie:owner,data:{vehicle:{...base,status:'available'}}})).data
  assert.ok(created.listedAt)
  assert.equal((await call('/api/admin/stock-aging',{cookie:owner})).data.vehicles.find(v=>v.id===created.id).days,0)

  // Data de entrada ajustada à mão
  assert.equal((await call(`/api/admin/stock-aging/${created.id}/entry`,{method:'POST',cookie:owner,data:{revision:created.revision,date:localDate(-3)}})).status,422,'não aceita data futura')
  assert.equal((await call(`/api/admin/stock-aging/${created.id}/entry`,{method:'POST',cookie:owner,data:{revision:created.revision,date:localDate(40)}})).status,200)
  const adjusted=(await call('/api/admin/stock-aging',{cookie:owner})).data.vehicles.find(v=>v.id===created.id)
  assert.deepEqual([adjusted.days,adjusted.band,adjusted.entrySource,adjusted.entryDate],[40,1,'listed',localDate(40)])
 }finally{await stop()}
})
