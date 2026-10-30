// Cria o primeiro acesso (administrador da plataforma) no banco de produção.
// Na Vercel o primeiro acesso é bloqueado de propósito; este script roda no seu computador,
// sobe a API localmente ligada ao mesmo Postgres e usa a rota de primeiro acesso.
//
// Uso (PowerShell, dentro de backend/):
//   $env:DATABASE_URL="postgresql://postgres.ID:SENHA@aws-0-REGIAO.pooler.supabase.com:6543/postgres"
//   node scripts/create-admin.mjs --ca C:\caminho\prod-ca-2021.crt
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { ca: { type: 'string' } } });
if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL com a URL do Transaction pooler do Supabase.');
  process.exit(1);
}
if (values.ca) process.env.DATABASE_CA_CERT = readFileSync(values.ca, 'utf8');
delete process.env.VERCEL;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); else if (!/[\r\n]/.test(s)) process.stdout.write('*'); };
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

const { createCloudApi } = await import('../server/cloud.mjs');
const { connectionProblem } = await import('../server/postgres.mjs');
let api;
try {
  // Sem seed, como na função da Vercel: o script não insere veículos de exemplo na produção.
  api = await createCloudApi();
} catch (error) {
  const hints = { url: 'DATABASE_URL inválida.', auth: 'usuário ou senha do banco recusados.', network: 'banco inacessível; confira o host do pooler e a porta 6543.', tls: 'certificado não reconhecido; passe --ca com o certificado SSL do Supabase.', other: error.code || 'erro desconhecido.' };
  console.error('Não foi possível conectar ao banco: ' + hints[connectionProblem(error)]);
  process.exit(1);
}
const server = http.createServer(api.handler);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const name = await ask('Seu nome: ');
  const email = await ask('E-mail: ');
  const password = await ask('Senha (mínimo 12 caracteres): ', { hidden: true });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dunna-Request': '1' },
    body: JSON.stringify({ name, email, password }),
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok) console.log(`Acesso criado para ${result.user?.email}. Entre em /admin com esse e-mail e senha.`);
  else { console.error(result.error || `Falha (${response.status}).`); process.exitCode = 1; }
} finally {
  server.close();
  await api.close();
}
