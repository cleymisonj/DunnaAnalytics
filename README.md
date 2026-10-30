# Dunna Analytics

Retaguarda completa para lojas de veículos: estoque, CRM, negociações, financeiro, jurídico e uma central de inteligência que transforma os registros da loja em indicadores e recomendações. Multiloja (SaaS), em React + TypeScript + Vite e Node.js com SQLite (local) ou Postgres/Supabase (nuvem).

Nasceu da retaguarda da Aero Motors e foi reorganizado como produto: sem vitrine embutida, sem dados de loja específica e com módulos novos que vão além do AutoCloud.

## Executar

Requer Node.js 22.23 ou superior. No Windows/PowerShell, se `npm` for bloqueado pela política de scripts, use `npm.cmd`.

```sh
npm install
npm run dev
```

O `npm run dev` sobe a API em `http://127.0.0.1:3001` e o painel em `http://localhost:5174` (o Vite repassa `/api` e `/uploads` para a API). O primeiro acesso, feito no próprio computador do servidor, cria o administrador da plataforma e dá nome à primeira loja. Não há senha padrão.

```sh
npm run build          # gera frontend/dist
npm start              # sobe só a API (porta 3001, ou PORT)
npm run test:backend   # 35 testes de API em bancos temporários
```

Os dados ficam em `data/` (`dunna.sqlite` e `uploads/`), ou no diretório indicado em `DUNNA_DATA_DIR`.

## Módulos

**Minha loja**
- Painel do dia: retornos de clientes, carros parados, contas da semana, avaliações e contratos pendentes.
- Central de pendências: reúne atrasos e cadastros incompletos de todos os módulos (tarefas, retornos de CRM, contas vencidas, carros sem custo ou documentação, propostas paradas, avaliações, contratos e preparações longas), ordenados por urgência e com atalho para resolver.
- Agenda: tarefas com responsável, prazo e prioridade, vinculadas a veículo, pessoa, interessado ou negociação. Vendedor vê e cria só as próprias.

**Inteligência** (administradores)
- Visão executiva: faturamento, margem líquida, ticket médio, resultado operacional, dias para vender, conversão de leads, estoque e caixa em 30 dias, sempre comparados ao período anterior; recomendações automáticas geradas a partir dos números.
- Resultado (DRE gerencial): receita, custo dos veículos vendidos, lucro bruto, comissões, outras receitas e despesas operacionais por categoria, por competência, com série de 12 meses.
- Estoque e giro: valor e custo do estoque, margem potencial, custo de carregar, cobertura em dias, giro, preço x FIPE, faixas de idade e desempenho por marca e carroceria.
- Funil e conversão: etapas alcançadas pelos interessados do período, motivos de perda e conversão por origem.
- Equipe: vendas, margem, comissão e conversão por vendedor.

**Financeiro**
- Contas a pagar e a receber com baixa parcial, estorno, edição e cancelamento com motivo (o registro nunca é apagado).
- Lançamentos únicos, mensais recorrentes ou parcelados; categorias e contas bancárias/caixas com saldo inicial.
- Fluxo de caixa realizado + previsto por mês ou dia, extrato por conta com saldo acumulado e exportação CSV.

**Veículos, Pessoas, Comercial, Jurídico** (herdados e mantidos da Aero)
- Estoque, fotos, preparação, idade do estoque com sugestão de preço, compras, consignações, custos por veículo, consulta FIPE e descrição por IA.
- Clientes, fornecedores e parceiros; funil de oportunidades com próximos contatos; avaliações de usados; propostas, trocas e vendas atômicas; margem e comissões.
- Contratos de compra e venda, termo de entrega e checklist de documentos; preparação RENAVE.

**Organização**
- Etiquetas coloridas em veículos, pessoas, interessados e negociações.
- Busca geral na barra superior (Ctrl+K): veículos (também por placa, RENAVAM e chassi), interessados, tarefas, pessoas, negociações e lançamentos, respeitando loja e papel do usuário.

## Permissões

- Plataforma: cria lojas e acessa cada uma.
- Administrador da loja: todos os módulos da própria loja.
- Vendedor: estoque (leitura), os próprios interessados, as próprias tarefas e comissões.

Todas as consultas aplicam a loja no servidor. Escritas exigem o cabeçalho `X-Dunna-Request` e origem compatível.

## API pública para o site da loja

O painel não inclui vitrine, mas a API continua oferecendo `/api/stock?store=<identificador>` (estoque publicado), `/api/public/leads` e `/api/public/appraisals` para o site próprio de cada loja enviar contatos e pedidos de avaliação direto para o CRM.

## Deploy

São dois projetos na Vercel no mesmo repositório: painel (raiz `frontend`) e API (raiz `backend`). O `frontend/vercel.json` repassa `/api/*` e `/uploads/*` para `dunna-backend.vercel.app`; troque esse endereço se a API ganhar outro.

Variáveis da API: `DATABASE_URL` (Postgres, Transaction pooler), `DATABASE_CA_CERT`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (arquivos), `DUNNA_ALLOWED_ORIGINS` (endereço do painel), e opcionais `OPENAI_API_KEY`/`OPENAI_MODEL` (descrição por IA) e `RESEND_API_KEY`/`DUNNA_NOTIFY_EMAIL`/`DUNNA_NOTIFY_FROM` (avisos por e-mail). Em produção o primeiro acesso é criado com `npm run create:admin --prefix backend`.

## Dados de teste

`backend/server/seed.json` é usado apenas pelos testes automatizados; uma instalação nova começa com o estoque vazio.

Mais detalhes técnicos em `backend/server/README.md` e o roteiro de evolução em `backend/server/ROADMAP-GESTAO.md`.
