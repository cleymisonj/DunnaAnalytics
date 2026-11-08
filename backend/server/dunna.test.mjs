import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {createApi} from './api.mjs'
import {createCloudApi} from './cloud.mjs'
import {createPostgresDatabase} from './postgres.mjs'

const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})
const plusDays=(n)=>new Date(Date.parse(today()+'T12:00:00Z')+n*86400000).toISOString().slice(0,10)

const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'))
const client=(base)=>async(route,{method='GET',data,cookie='',store=''}={})=>{const r=await fetch(base+route,{method,headers:{'X-Dunna-Request':'1',Cookie:cookie,'X-Store-Id':store,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}

// O mesmo cenário roda em SQLite e em Postgres (PGlite): em produção a API usa Postgres.
async function scenario(call){
  const setup=await call('/api/auth/setup',{method:'POST',data:{name:'Dona',email:'dona@example.test',password:'local-test-password-123',storeName:'Prime Veículos',storeCity:'Natal/RN',storePhone:'(84) 99999-0000'}}),cookie=setup.cookie
  assert.equal(setup.status,201)
  const stores=(await call('/api/admin/stores',{cookie})).data;assert.equal(stores[0].name,'Prime Veículos');assert.equal(stores[0].phone,'84999990000')
  await call('/api/admin/users',{cookie,method:'POST',data:{name:'Vendedor',email:'vendedor@example.test',password:'local-test-password-123',role:'seller'}})
  const seller=(await call('/api/auth/login',{method:'POST',data:{email:'vendedor@example.test',password:'local-test-password-123'}})).cookie
  const sellerId=(await call('/api/account',{cookie:seller})).data.user.id

  // Agenda: tarefa vinculada a veículo, atraso vira pendência, vendedor vê só as próprias
  const car=seed[0]
  assert.equal((await call('/api/admin/tasks',{cookie,method:'POST',data:{title:'',dueAt:new Date().toISOString(),priority:'normal'}})).status,422)
  const late=await call('/api/admin/tasks',{cookie,method:'POST',data:{title:'Levar para vistoria',dueAt:new Date(Date.now()-3600000).toISOString(),priority:'high',link:{kind:'vehicle',id:car.id}}})
  assert.equal(late.status,201);assert.match(late.data.link.label,new RegExp(car.model))
  const mine=await call('/api/admin/tasks',{cookie:seller,method:'POST',data:{title:'Ligar para cliente',dueAt:new Date(Date.now()+86400000).toISOString(),priority:'normal',assignedTo:'qualquer'}})
  assert.equal(mine.data.assignedTo,sellerId)
  assert.equal((await call('/api/admin/tasks',{cookie:seller,method:'POST',data:{title:'x',dueAt:new Date().toISOString(),priority:'normal',link:{kind:'person',id:'x'}}})).status,403)
  assert.deepEqual((await call('/api/admin/tasks',{cookie:seller})).data.map(t=>t.title),['Ligar para cliente'])
  assert.equal((await call('/api/admin/tasks',{cookie})).data.length,2)
  assert.equal((await call('/api/admin/tasks/'+late.data.id+'/status',{cookie:seller,method:'PATCH',data:{status:'done',revision:1}})).status,403)
  let pending=(await call('/api/admin/pending',{cookie})).data
  assert.ok(pending.items.some(i=>i.id==='task-'+late.data.id&&i.severity==='high'))
  assert.ok(pending.items.some(i=>i.kind==='vehicle'&&i.title.startsWith('Custo de aquisição')))
  assert.equal((await call('/api/admin/pending',{cookie:seller})).data.items.some(i=>i.kind==='vehicle'),false)
  assert.equal((await call('/api/admin/tasks/'+late.data.id+'/status',{cookie,method:'PATCH',data:{status:'done',revision:0}})).status,409)
  assert.equal((await call('/api/admin/tasks/'+late.data.id+'/status',{cookie,method:'PATCH',data:{status:'done',revision:1}})).data.status,'done')
  pending=(await call('/api/admin/pending',{cookie})).data;assert.equal(pending.items.some(i=>i.id==='task-'+late.data.id),false)

  // Financeiro: contas e categorias, parcelamento, baixa parcial, estorno, cancelamento, fluxo e extrato
  assert.equal((await call('/api/admin/finance/settings',{cookie:seller})).status,403)
  const settings=(await call('/api/admin/finance/settings',{cookie})).data
  assert.ok(settings.categories.some(x=>x.id==='rent'));assert.equal(settings.revision,0)
  const first=plusDays(-40)
  const saved=await call('/api/admin/finance/settings',{cookie,method:'PUT',data:{revision:0,categories:settings.categories,accounts:[...settings.accounts.map(a=>({...a,openingDate:first})),{name:'Banco do Brasil',kind:'checking',openingCents:1000000,openingDate:first}]}})
  assert.equal(saved.status,200);const bank=saved.data.accounts.find(a=>a.name==='Banco do Brasil')
  assert.equal((await call('/api/admin/finance/settings',{cookie,method:'PUT',data:{revision:1,categories:saved.data.categories.filter(x=>x.id!=='rent'),accounts:saved.data.accounts}})).status,422)
  const rent=await call('/api/admin/finance/entries',{cookie,method:'POST',data:{direction:'expense',description:'Aluguel',amountCents:300000,dueDate:plusDays(-5),categoryId:'rent',accountId:bank.id,repeat:{count:3,mode:'monthly'}}})
  assert.equal(rent.status,201);assert.equal(rent.data.length,3);assert.equal(rent.data[2].description,'Aluguel · 3/3')
  const split=(await call('/api/admin/finance/entries',{cookie,method:'POST',data:{direction:'income',description:'Serviço',amountCents:1000,dueDate:today(),categoryId:'service',repeat:{count:3,mode:'installments'}}})).data
  assert.deepEqual(split.map(e=>e.amountCents),[333,333,334])
  assert.equal((await call('/api/admin/finance/entries',{cookie,method:'POST',data:{direction:'income',description:'Errado',amountCents:1000,dueDate:today(),categoryId:'rent'}})).status,422)
  const r0=rent.data[0]
  assert.equal((await call(`/api/admin/finance/entries/${r0.id}/settle`,{cookie,method:'POST',data:{revision:r0.revision,amountCents:400000,date:today()}})).status,422)
  let s1=await call(`/api/admin/finance/entries/${r0.id}/settle`,{cookie,method:'POST',data:{revision:r0.revision,amountCents:100000,date:plusDays(-1)}})
  assert.equal(s1.data.entry.status,'open');assert.equal(s1.data.entry.payments.length,1)
  pending=(await call('/api/admin/pending',{cookie})).data;assert.equal(pending.items.find(i=>i.id==='ledger-'+r0.id).amountCents,200000)
  s1=await call(`/api/admin/finance/entries/${r0.id}/settle`,{cookie,method:'POST',data:{revision:s1.data.entry.revision,amountCents:200000,date:today()}})
  assert.equal(s1.data.entry.status,'paid');assert.equal(s1.data.entry.paidDate,today())
  assert.equal((await call(`/api/admin/finance/entries/${r0.id}`,{cookie,method:'PATCH',data:{revision:s1.data.entry.revision,amountCents:1,dueDate:r0.dueDate,description:'Aluguel'}})).status,422)
  let st=(await call(`/api/admin/finance/statement?account=${bank.id}&from=${first}&to=${today()}`,{cookie})).data
  assert.equal(st.openingCents,0);assert.equal(st.rows.length,3);assert.equal(st.closingCents,1000000-300000)
  const flow=(await call(`/api/admin/finance/cashflow?from=${first}&to=${plusDays(90)}`,{cookie})).data
  assert.equal(flow.accounts.find(a=>a.id===bank.id).balanceCents,700000)
  assert.equal(flow.totals.projectedOut,600000);assert.equal(flow.totals.projectedIn,1000)
  const reopened=await call(`/api/admin/finance/entries/${r0.id}/reopen`,{cookie,method:'POST',data:{revision:s1.data.entry.revision}})
  assert.equal(reopened.data.entry.status,'open');assert.equal(reopened.data.entry.payments.length,0)
  assert.equal((await call(`/api/admin/finance/entries/${split[0].id}/cancel`,{cookie,method:'POST',data:{revision:1,reason:''}})).status,422)
  assert.equal((await call(`/api/admin/finance/entries/${split[0].id}/cancel`,{cookie,method:'POST',data:{revision:1,reason:'Lançado em duplicidade'}})).data.entry.status,'void')
  // A baixa antiga (integral) e a reabertura continuam funcionando e limpam pagamentos parciais
  const r1=rent.data[1],p1=await call(`/api/admin/finance/entries/${r1.id}/settle`,{cookie,method:'POST',data:{revision:1,amountCents:50000,date:today()}})
  const back=await call(`/api/admin/ledger/${r1.id}/payment`,{cookie,method:'PATCH',data:{revision:p1.data.entry.revision,status:'open'}})
  assert.equal(back.status,200);assert.equal(back.data.payments.length,0)

  // Etiquetas e busca geral
  assert.equal((await call('/api/admin/tags',{cookie:seller,method:'POST',data:{name:'VIP',color:'amber'}})).status,403)
  const vip=(await call('/api/admin/tags',{cookie,method:'POST',data:{name:'VIP',color:'amber'}})).data
  assert.equal((await call('/api/admin/tags',{cookie,method:'POST',data:{name:'vip',color:'rose'}})).status,409)
  assert.equal((await call('/api/admin/tags/links',{cookie,method:'PUT',data:{kind:'vehicle',id:car.id,tagIds:[vip.id]}})).status,200)
  assert.deepEqual((await call('/api/admin/tags/links?kind=vehicle',{cookie})).data,{['vehicle:'+car.id]:[vip.id]})
  assert.equal((await call('/api/admin/tags/links',{cookie:seller,method:'PUT',data:{kind:'vehicle',id:car.id,tagIds:[]}})).status,403)
  const lead=(await call('/api/admin/leads',{cookie:seller,method:'POST',data:{name:'Marina Alves',phone:'84988887777',interest:car.model,source:'Instagram',stage:'new'}})).data
  assert.equal((await call('/api/admin/tags/links',{cookie:seller,method:'PUT',data:{kind:'lead',id:lead.id,tagIds:[vip.id]}})).status,200)
  assert.equal((await call('/api/admin/tags',{cookie})).data[0].count,2)
  let found=(await call('/api/admin/search?q=vip',{cookie})).data.groups
  assert.deepEqual(found.map(g=>g.kind).sort(),['lead','vehicle'])
  found=(await call('/api/admin/search?q=8888',{cookie:seller})).data.groups;assert.equal(found[0].items[0].title,'Marina Alves')
  found=(await call('/api/admin/search?q=aluguel',{cookie:seller})).data.groups;assert.equal(found.length,0)
  found=(await call('/api/admin/search?q=aluguel',{cookie})).data.groups;assert.equal(found[0].kind,'finance')
  assert.equal((await call('/api/admin/tags/'+vip.id,{cookie,method:'DELETE'})).status,200)
  assert.deepEqual((await call('/api/admin/tags/links',{cookie})).data,{})

  // Central de analytics: venda com compra registrada gera margem, DRE com despesa operacional e funil
  const person=(await call('/api/admin/people',{cookie,method:'POST',data:{name:'Comprador',kind:'customer',phone:'84977776666',email:'',city:'',notes:'',active:true}})).data
  const supplier=(await call('/api/admin/people',{cookie,method:'POST',data:{name:'Fornecedor',kind:'supplier',phone:'',email:'',city:'',notes:'',active:true}})).data
  assert.equal((await call('/api/admin/purchases',{cookie,method:'POST',data:{vehicleId:car.id,personId:supplier.id,amountCents:5000000,purchaseDate:plusDays(-20),payments:[{amountCents:5000000,dueDate:plusDays(-20)}]}})).status,201)
  const deal=(await call('/api/admin/deals',{cookie,method:'POST',data:{vehicleId:car.id,personId:person.id,sellerId,status:'proposal',amountCents:6000000,payments:[{amountCents:6000000,dueDate:today()}],notes:''}})).data
  assert.equal((await call(`/api/admin/deals/${deal.id}/complete`,{cookie,method:'POST',data:{revision:deal.revision}})).status,200)
  const leadRow=(await call('/api/admin/leads',{cookie})).data.find(l=>l.id===lead.id)
  await call('/api/admin/leads/'+lead.id,{cookie,method:'PUT',data:{...leadRow,stage:'won',note:''}})
  assert.equal((await call('/api/admin/insights',{cookie:seller})).status,403)
  assert.equal((await call('/api/admin/insights?from=2026-13-01',{cookie})).status,422)
  const report=(await call(`/api/admin/insights?from=${plusDays(-10)}&to=${today()}`,{cookie})).data
  assert.equal(report.sales.current.count,1);assert.equal(report.sales.current.revenueCents,6000000);assert.equal(report.sales.current.marginCents,1000000)
  assert.equal(report.sales.current.avgDaysToSell,20)
  assert.equal(report.dre.current.cogsCents,5000000);assert.equal(report.dre.current.grossCents,1000000)
  assert.ok(report.dre.current.opex.some(x=>x.id==='rent'));assert.ok(report.dre.current.opex.every(x=>x.id!=='purchase'))
  assert.equal(report.funnel.won,1);assert.equal(report.funnel.sources[0].source,'Instagram')
  assert.equal(report.team.find(t=>t.id===sellerId).sales,1)
  assert.equal(report.series.length,12);assert.equal(report.series[11].sales,1)
  assert.ok(report.tips.length>0)

  // Dados da loja: administrador edita a própria, vendedor não
  const storeId=stores[0].id
  assert.equal((await call('/api/admin/stores/'+storeId,{cookie:seller,method:'PUT',data:{name:'X',phone:'84999990000',city:'Natal'}})).status,403)
  assert.equal((await call('/api/admin/stores/'+storeId,{cookie,method:'PUT',data:{name:'Prime Motors',phone:'',city:'Natal/RN'}})).status,422)
  assert.equal((await call('/api/admin/stores/'+storeId,{cookie,method:'PUT',data:{name:'Prime Motors',phone:'(84) 98888-7777',city:'Parnamirim/RN'}})).data.phone,'84988887777')

  // Importação: confere antes de gravar, recusa linha ruim e ignora duplicados
  const peopleRows=[{name:'Novo Cliente',phone:'84911112222',kind:'Cliente'},{name:'Sem documento válido',document:'11111111111'},{name:'Repetido',phone:'84977776666'},{name:'Fornecedor X',kind:'fornecedor'}]
  assert.equal((await call('/api/admin/import/people',{cookie:seller,method:'POST',data:{rows:peopleRows}})).status,403)
  const dry=(await call('/api/admin/import/people',{cookie,method:'POST',data:{rows:peopleRows,dryRun:true}})).data
  assert.equal(dry.valid,2);assert.deepEqual(dry.duplicates,[4]);assert.equal(dry.errors[0].line,3);assert.equal(dry.created,0)
  const before=(await call('/api/admin/people',{cookie})).data.length
  assert.equal((await call('/api/admin/import/people',{cookie,method:'POST',data:{rows:peopleRows}})).data.created,2)
  assert.equal((await call('/api/admin/people',{cookie})).data.length,before+2)
  assert.equal((await call('/api/admin/import/people',{cookie,method:'POST',data:{rows:peopleRows}})).data.created,0)
  const imported=(await call('/api/admin/import/vehicles',{cookie,method:'POST',data:{rows:[{brand:'Fiat',model:'Argo',year:'2022',price:'R$ 72.900,50',mileage:'41.000',body:'hatch',plate:'ABC1D23'},{brand:'Fiat',model:'Mobi',year:'2022',price:'zero'}]}})).data
  assert.equal(imported.created,1);assert.equal(imported.errorCount,1)
  const argo=(await call('/api/admin/stock',{cookie})).data.find(v=>v.model==='Argo');assert.equal(argo.status,'draft');assert.equal(argo.price,72900.5);assert.equal(argo.mileage,41000)
  const bills=(await call('/api/admin/import/ledger',{cookie,method:'POST',data:{rows:[{direction:'Pagar',description:'Contador',amount:'450,00',dueDate:'10/12/2026',category:'Outras despesas'},{direction:'Receber',description:'Antigo',amount:'100',dueDate:'2026-10-01',paidDate:'02/10/2026'},{direction:'x',description:'y',amount:'1',dueDate:'31/02/2026'}]}})).data
  assert.equal(bills.created,2);assert.equal(bills.errorCount,1)
  assert.equal((await call('/api/admin/ledger',{cookie})).data.find(e=>e.description==='Antigo').status,'paid')

  // Conciliação OFX: sugere o lançamento em aberto, cria o avulso e não repete a importação
  const stamp=today().replace(/-/g,'')
  const ofx=`OFXHEADER:100\n<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${stamp}120000[-3:BRT]<TRNAMT>-3000.00<FITID>A1<MEMO>PIX ALUGUEL</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${stamp}<TRNAMT>123,45<FITID>A2<NAME>TED RECEBIDA</STMTTRN><STMTTRN><TRNTYPE>FEE<DTPOSTED>${stamp}<TRNAMT>-9.90<FITID>A3<MEMO>TARIFA</STMTTRN></BANKTRANLIST></OFX>`
  assert.equal((await call('/api/admin/finance/ofx',{cookie,method:'POST',data:{accountId:bank.id,content:'nada'}})).status,422)
  const parsed=(await call('/api/admin/finance/ofx',{cookie,method:'POST',data:{accountId:bank.id,content:ofx}})).data.rows
  assert.deepEqual(parsed.map(r=>r.status),['suggested','new','new']);assert.equal(parsed[0].entryId,r0.id);assert.equal(parsed[1].direction,'income');assert.equal(parsed[1].amountCents,12345)
  const done=(await call('/api/admin/finance/reconcile',{cookie,method:'POST',data:{accountId:bank.id,items:[{...parsed[0],action:'match'},{...parsed[1],action:'create',categoryId:'other-income'},{...parsed[2],action:'ignore'}]}})).data
  assert.deepEqual(done,{matched:1,created:1,ignored:1,skipped:0})
  assert.equal((await call('/api/admin/ledger',{cookie})).data.find(e=>e.id===r0.id).status,'paid')
  assert.deepEqual((await call('/api/admin/finance/ofx',{cookie,method:'POST',data:{accountId:bank.id,content:ofx}})).data.rows.map(r=>r.status),['imported','imported','imported'])
  assert.equal((await call('/api/admin/finance/reconcile',{cookie,method:'POST',data:{accountId:bank.id,items:[{...parsed[0],action:'match'}]}})).data.skipped,1)

  // Estorno de venda: bloqueado com baixa, depois devolve o carro ao estoque e tira a venda dos números
  const income=(await call('/api/admin/ledger',{cookie})).data.find(e=>e.dealId===deal.id)
  const received=await call(`/api/admin/finance/entries/${income.id}/settle`,{cookie,method:'POST',data:{revision:income.revision,amountCents:income.amountCents,date:today()}})
  let sold=(await call('/api/admin/deals',{cookie})).data.find(d=>d.id===deal.id)
  assert.equal((await call(`/api/admin/deals/${deal.id}/reverse`,{cookie,method:'POST',data:{revision:sold.revision,reason:'Cliente desistiu'}})).status,409)
  await call(`/api/admin/finance/entries/${income.id}/reopen`,{cookie,method:'POST',data:{revision:received.data.entry.revision}})
  assert.equal((await call(`/api/admin/deals/${deal.id}/reverse`,{cookie,method:'POST',data:{revision:sold.revision,reason:''}})).status,422)
  const reversed=await call(`/api/admin/deals/${deal.id}/reverse`,{cookie,method:'POST',data:{revision:sold.revision,reason:'Cliente desistiu'}})
  assert.equal(reversed.status,200);assert.equal(reversed.data.status,'reversed')
  assert.equal((await call('/api/admin/stock',{cookie})).data.find(v=>v.id===car.id).status,'available')
  assert.equal((await call('/api/admin/ledger',{cookie})).data.find(e=>e.id===income.id).status,'void')
  assert.equal((await call(`/api/admin/insights?from=${plusDays(-10)}&to=${today()}`,{cookie})).data.sales.current.count,0)
  assert.equal((await call(`/api/admin/deals/${deal.id}/reverse`,{cookie,method:'POST',data:{revision:reversed.data.revision,reason:'De novo'}})).status,409)

  // Recuperação de senha: resposta igual para qualquer e-mail, link de uso único e sessões derrubadas
  assert.deepEqual((await call('/api/auth/forgot',{method:'POST',data:{email:'ninguem@example.test'}})).data,{ok:true})
  assert.deepEqual((await call('/api/auth/forgot',{method:'POST',data:{email:'vendedor@example.test'}})).data,{ok:true})
  assert.equal((await call(`/api/admin/users/${sellerId}/reset-link`,{cookie:seller,method:'POST'})).status,403)
  const link=(await call(`/api/admin/users/${sellerId}/reset-link`,{cookie,method:'POST'})).data.link,token=link.split('redefinir=')[1]
  assert.equal((await call('/api/auth/reset',{method:'POST',data:{token:'0'.repeat(64),password:'nova-senha-do-vendedor'}})).status,400)
  assert.equal((await call('/api/auth/reset',{method:'POST',data:{token,password:'curta'}})).status,422)
  assert.equal((await call('/api/auth/reset',{method:'POST',data:{token,password:'nova-senha-do-vendedor'}})).status,200)
  assert.equal((await call('/api/auth/reset',{method:'POST',data:{token,password:'outra-senha-do-vendedor'}})).status,400)
  assert.equal((await call('/api/admin/tasks',{cookie:seller})).status,401)
  assert.equal((await call('/api/auth/login',{method:'POST',data:{email:'vendedor@example.test',password:'local-test-password-123'}})).status,401)
  assert.equal((await call('/api/auth/login',{method:'POST',data:{email:'vendedor@example.test',password:'nova-senha-do-vendedor'}})).status,200)
}

test('dunna (SQLite): agenda, pendências, financeiro completo, etiquetas, busca e central de analytics',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dunna-modules-'))
 let api=await createApi({dataDir:dir,seed,aiKey:''})
 const server=http.createServer((req,res)=>api.handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  await scenario(client(`http://127.0.0.1:${server.address().port}`))
  // Tudo persiste ao reabrir o banco
  api.close();api=await createApi({dataDir:dir,seed,aiKey:''})
  assert.equal(api.db.prepare('SELECT count(*) as n FROM tasks').get().n,2)
  assert.equal(api.db.prepare('SELECT revision FROM finance_settings').get().revision,1)
 }finally{await new Promise(resolve=>server.close(resolve));api.close();assert.ok(dir.startsWith(path.join(tmpdir(),'dunna-modules-')));rmSync(dir,{recursive:true,force:true})}
})

test('dunna (Postgres): os módulos novos funcionam no banco de produção',async()=>{
 const pg=new PGlite();let queue=Promise.resolve()
 const pool={async connect(){let release;const old=queue;queue=new Promise(r=>release=r);await old;return {query:async(sql,values)=>{if(sql==='SELECT pg_advisory_xact_lock(6748021001)')return {rows:[]};if(values?.length)return pg.query(sql,values);const r=await pg.exec(sql);return r.at(-1)||{rows:[]}},release}},end:()=>pg.close()}
 const database=createPostgresDatabase({pool}),api=await createCloudApi({database,seed})
 const server=http.createServer(api.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r))
 try{await scenario(client(`http://127.0.0.1:${server.address().port}`))}
 finally{await new Promise(r=>server.close(r));await api.close()}
})
