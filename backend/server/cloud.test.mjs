import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createPostgresDatabase,databaseSsl,connectionProblem} from './postgres.mjs';
import {createCloudApi} from './cloud.mjs';
test('PostgreSQL: login, isolamento, estoque persistente e venda atômica',async()=>{
 const pg=new PGlite();let queue=Promise.resolve();
 const pool={async connect(){let release;const old=queue;queue=new Promise(r=>release=r);await old;return {query:async(sql,values)=>{if(sql==='SELECT pg_advisory_xact_lock(6748021001)')return {rows:[]};if(values?.length)return pg.query(sql,values);const r=await pg.exec(sql);return r.at(-1)||{rows:[]}},release}},end:()=>pg.close()};
 const database=createPostgresDatabase({pool});const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'));
 const api=await createCloudApi({database,seed});const server=http.createServer(api.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const request=async(path,method='GET',body,store)=>{const r=await fetch(base+path,{method,headers:{'X-Dunna-Request':'1','Content-Type':'application/json',Cookie:cookie,...(store?{'X-Store-Id':store}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()}};
 try{
 assert.equal((await request('/api/admin/stock')).status,401);
 assert.equal((await request('/api/auth/setup','POST',{name:'Administrador teste',email:'admin@example.test',password:'test-password-12345'})).status,201);
 const stock=await request('/api/admin/stock');assert.equal(stock.data.length,10);
 const car=stock.data.find(v=>v.status==='available');const edited=await request('/api/admin/stock/'+car.id,'PUT',{vehicle:{...car,price:car.price+100},revision:car.revision});assert.equal(edited.status,200);assert.equal(edited.data.revision,2);
 assert.equal((await request('/api/admin/stock/'+car.id,'PUT',{vehicle:car,revision:1})).status,409);
 const person=await request('/api/admin/people','POST',{name:'Cliente de teste',kind:'customer',active:true});assert.equal(person.status,201);
 const deal=await request('/api/admin/deals','POST',{vehicleId:car.id,personId:person.data.id,status:'proposal',amountCents:100000,payments:[{dueDate:'2026-10-28',amountCents:100000}]});assert.equal(deal.status,201);
 const sale=await request('/api/admin/deals/'+deal.data.id+'/complete','POST',{revision:deal.data.revision});assert.equal(sale.status,200);assert.equal(sale.data.status,'completed');
 assert.equal((await request('/api/admin/commission-rules','PUT',{base:'sale',percent:2})).status,200);assert.equal((await request('/api/admin/commission-rules','PUT',{base:'margin',percent:5})).status,200);assert.equal((await request('/api/admin/commission-rules')).data.base,'margin');
 const report=await request('/api/admin/performance');assert.equal(report.status,200);assert.equal(report.data.totals.sales,1);
 const lead=await request('/api/admin/leads','POST',{name:'Lead nuvem',phone:'84988887777',stage:'contact',nextContactAt:'2026-11-03T12:00:00.000Z'});assert.equal(lead.status,201);assert.equal(lead.data.nextContactAt,'2026-11-03T12:00:00.000Z');
 const ledger=await request('/api/admin/ledger');assert.equal(ledger.data.length,1);assert.equal(ledger.data[0].amountCents,100000);
 assert.equal((await request('/api/admin/deals/'+deal.data.id+'/complete','POST',{revision:deal.data.revision})).status,409);
 const store=await request('/api/admin/stores','POST',{name:'Outra loja teste',slug:'outra-teste',phone:'84999999999',city:'Natal'});assert.equal(store.status,201);assert.equal((await request('/api/admin/stock','GET',undefined,store.data.id)).data.length,0);
 assert.equal((await request('/api/admin/stock/'+car.id,'PUT',{vehicle:car,revision:2},store.data.id)).status,404);
 await database.session(async()=>{assert.equal((await database.prepare('SELECT count(*) AS n FROM ledger').get()).n,1)});
 }finally{await new Promise(r=>server.close(r));await api.close()}
});
test('PostgreSQL: certificado do Supabase sempre verificado e motivo da falha sem dados sensíveis',()=>{
 assert.deepEqual(databaseSsl({}),{rejectUnauthorized:true});
 const pem='-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';
 assert.deepEqual(databaseSsl({DATABASE_CA_CERT:pem.replace(/\n/g,'\n')}),{ca:pem,rejectUnauthorized:true});
 assert.equal(connectionProblem(new Error('DATABASE_URL inválida')),'url');
 assert.equal(connectionProblem(Object.assign(new Error('password authentication failed'),{code:'28P01'})),'auth');
 assert.equal(connectionProblem(Object.assign(new Error('getaddrinfo'),{code:'ENOTFOUND'})),'network');
 assert.equal(connectionProblem(Object.assign(new Error('self-signed certificate in certificate chain'),{code:'SELF_SIGNED_CERT_IN_CHAIN'})),'tls');
 assert.equal(connectionProblem(new Error('x')),'other');
});
test('PostgreSQL: avaliações, arquivos privados e contratos',async()=>{
 const pg=new PGlite();let queue=Promise.resolve();
 const pool={async connect(){let release;const old=queue;queue=new Promise(r=>release=r);await old;return {query:async(sql,values)=>{if(sql==='SELECT pg_advisory_xact_lock(6748021001)')return {rows:[]};if(values?.length)return pg.query(sql,values);const r=await pg.exec(sql);return r.at(-1)||{rows:[]}},release}},end:()=>pg.close()};
 const database=createPostgresDatabase({pool});const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'));
 const privateFiles={uploadTarget:async()=>({url:'https://exemplo.supabase.co/upload',method:'PUT',headers:{}}),readUrl:async()=>'https://exemplo.supabase.co/read'};
 const api=await createCloudApi({database,seed,privateFiles});const server=http.createServer(api.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const request=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,redirect:'manual',headers:{'X-Dunna-Request':'1','Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,location:r.headers.get('location'),data:r.status===302?null:await r.json()}};
 try{
  assert.equal((await request('/api/auth/setup','POST',{name:'Dono',email:'dono@example.test',password:'senha-do-dono-123456'})).status,201);
  const [photo]=(await request('/api/public/appraisals/uploads','POST',{store:'minha-loja',files:[{kind:'photo',type:'image/jpeg',size:500}]})).data;
  assert.equal((await request('/api/public/appraisals','POST',{store:'minha-loja',name:'Ana',phone:'84998765432',model:'Fiat Argo',year:2021,media:[photo.name]})).status,201);
  const [appraisal]=(await request('/api/admin/appraisals')).data;
  assert.equal(appraisal.media[0].name,photo.name);
  assert.equal((await request('/api/admin/files/'+photo.name)).location,'https://exemplo.supabase.co/read');
  assert.equal((await request('/api/admin/legal','PUT',{legalName:'Aero Ltda',document:'11222333000181',address:'Av. X, 1',cityUf:'Natal/RN',representative:'Dono',warrantyMonths:3})).status,200);
  assert.equal((await request('/api/admin/legal')).data.legalName,'Aero Ltda');
  const [car]=(await request('/api/admin/stock')).data.filter(v=>v.status==='available');
  const person=(await request('/api/admin/people','POST',{name:'Maria',kind:'customer',phone:'84999999999',email:'',city:'Natal/RN',notes:'',active:true,document:'52998224725'})).data;
  const deal=(await request('/api/admin/deals','POST',{vehicleId:car.id,personId:person.id,status:'proposal',amountCents:4000000,payments:[{dueDate:'2026-11-10',amountCents:4000000}],notes:''})).data;
  const contract=await request('/api/admin/contracts','POST',{type:'delivery',dealId:deal.id});
  assert.equal(contract.status,201);
  assert.equal((await request(`/api/admin/contracts/${contract.data.id}/document`)).data.title,'Termo de entrega de veículo e transferência de responsabilidade');
 }finally{server.close();await api.close()}
});
test('PostgreSQL: preparação com despesa e idade do estoque',async()=>{
 const pg=new PGlite();let queue=Promise.resolve();
 const pool={async connect(){let release;const old=queue;queue=new Promise(r=>release=r);await old;return {query:async(sql,values)=>{if(sql==='SELECT pg_advisory_xact_lock(6748021001)')return {rows:[]};if(values?.length)return pg.query(sql,values);const r=await pg.exec(sql);return r.at(-1)||{rows:[]}},release}},end:()=>pg.close()};
 const database=createPostgresDatabase({pool});const seed=JSON.parse(readFileSync(new URL('./seed.json',import.meta.url),'utf8'));
 const api=await createCloudApi({database,seed,privateFiles:null});const server=http.createServer(api.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const request=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'X-Dunna-Request':'1','Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()}};
 try{
  await request('/api/auth/setup','POST',{name:'Dono',email:'dono@example.test',password:'senha-do-dono-123456'});
  const [car]=(await request('/api/admin/stock')).data.filter(v=>v.status==='available');
  let prep=(await request('/api/admin/preparations','POST',{vehicleId:car.id})).data;
  const r=await request('/api/admin/preparations/'+prep.id,'PUT',{revision:prep.revision,tasks:prep.tasks.map((t,i)=>i===0?{...t,status:'done',costCents:50000}:t)});
  assert.equal(r.status,200);
  assert.equal((await request('/api/admin/ledger')).data.filter(e=>e.source==='preparation')[0].amountCents,50000);
  assert.equal((await request('/api/admin/stock-aging/settings','PUT',{alertDays:[30,60,90],monthlyRatePct:1.5,dailyCostCents:0,minMarginPct:8})).status,200);
  const report=(await request('/api/admin/stock-aging')).data;
  const row=report.vehicles.find(v=>v.id===car.id);
  assert.equal(row.preparation.status,'in_progress');
  assert.equal(typeof row.days,'number');
  assert.ok(report.totals.vehicles>0);
 }finally{server.close();await api.close()}
});
