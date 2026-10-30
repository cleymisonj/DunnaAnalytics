import {AsyncLocalStorage} from 'node:async_hooks';
import pg from 'pg';
pg.types.setTypeParser(20,Number);
pg.types.setTypeParser(1700,Number);
export function postgresSql(sql){
 let s=sql.replace(/PRAGMA[^;]+;/g,'').replace(/json_extract\(data,'\$\.([A-Za-z]+)'\)/g,"(data::jsonb->>'$1')").replace(/id INTEGER PRIMARY KEY,store_id TEXT,user_id TEXT/g,'id BIGSERIAL PRIMARY KEY,store_id TEXT,user_id TEXT').replace(/\bINTEGER\b/g,'BIGINT');
 const ignore=/INSERT OR IGNORE/i.test(s);s=s.replace(/INSERT OR IGNORE/i,'INSERT');if(ignore)s+=' ON CONFLICT DO NOTHING';
 let quoted=false,index=0,result='';for(let i=0;i<s.length;i++){const ch=s[i];if(ch==="'"){result+=ch;if(quoted&&s[i+1]==="'"){result+=s[++i];continue}quoted=!quoted}else result+=ch==='?'&&!quoted?'$'+(++index):ch}return result;
}
// O Postgres do Supabase usa um certificado assinado pela CA do próprio Supabase, fora das CAs públicas do Node.
// DATABASE_CA_CERT recebe esse certificado (PEM baixado no painel do Supabase); a verificação continua sempre ligada.
export function databaseSsl(env=process.env){const ca=(env.DATABASE_CA_CERT||'').replace(/\\n/g,'\n').trim();return ca?{ca,rejectUnauthorized:true}:{rejectUnauthorized:true}}
/** Motivo da falha de conexão sem expor dados: url, auth, network, tls ou other. */
export function connectionProblem(error){const code=String(error?.code||''),message=String(error?.message||'');if(/DATABASE_URL/.test(message)||code==='ERR_INVALID_URL')return 'url';if(['28P01','28000','3D000'].includes(code)||/password|tenant|user not found/i.test(message))return 'auth';if(['ENOTFOUND','ENETUNREACH','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ECONNRESET'].includes(code)||/timeout/i.test(message))return 'network';if(/CERT|SSL|TLS/i.test(code+message))return 'tls';return 'other'}
export function createPostgresDatabase({pool}={}){
 if(!pool){const url=new URL(process.env.DATABASE_URL||'');if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DATABASE_URL inválida');url.searchParams.delete('sslmode');pool=new pg.Pool({connectionString:url.href,max:3,idleTimeoutMillis:15000,connectionTimeoutMillis:10000,ssl:databaseSsl()})}
 const context=new AsyncLocalStorage();
 const state=()=>{const value=context.getStore();if(!value)throw new Error('Conexão PostgreSQL fora do contexto');return value};
 const query=(sql,values=[])=>state().client.query(postgresSql(sql),values);
 const db={isPostgres:true,
  prepare(sql){return {async get(...v){return (await query(sql,v)).rows[0]},async all(...v){return (await query(sql,v)).rows},async run(...v){const r=await query(sql,v);return {changes:r.rowCount}}}},
  async exec(sql){const s=state();if(/^BEGIN(?: IMMEDIATE)?$/i.test(sql)){await s.client.query('SAVEPOINT dunna_'+(++s.depth));return}if(/^COMMIT$/i.test(sql)){await s.client.query('RELEASE SAVEPOINT dunna_'+s.depth--);return}if(/^ROLLBACK$/i.test(sql)){await s.client.query('ROLLBACK TO SAVEPOINT dunna_'+s.depth);await s.client.query('RELEASE SAVEPOINT dunna_'+s.depth--);return}const statement=postgresSql(sql);if(statement.trim())await s.client.query(statement)},
  async session(fn,{initialize=false,write=true}={}){const client=await pool.connect();try{await client.query('BEGIN');if(write)await client.query('SELECT pg_advisory_xact_lock(6748021001)');if(initialize){await client.query('CREATE SCHEMA IF NOT EXISTS dunna_private');await client.query('REVOKE ALL ON SCHEMA dunna_private FROM PUBLIC')}await client.query('SET LOCAL search_path TO dunna_private,pg_catalog');await client.query("SET LOCAL statement_timeout='20s'");const result=await context.run({client,depth:0},fn);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}},
  close(){return pool.end()}
 };return db;
}
export function bufferResponse(){const headers=new Map();return {statusCode:200,headersSent:false,body:undefined,setHeader(k,v){headers.set(k.toLowerCase(),v)},getHeader(k){return headers.get(k.toLowerCase())},writeHead(code,h={}){this.statusCode=code;for(const [k,v]of Object.entries(h))this.setHeader(k,v)},end(body){this.body=body;this.headersSent=true},flush(res){for(const[k,v]of headers)res.setHeader(k,v);res.statusCode=this.statusCode;res.end(this.body)}}}
