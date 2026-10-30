# API do Dunna Analytics

Servidor Node.js sem framework (`api.mjs`), com SQLite local (`node:sqlite`) ou Postgres na nuvem (`cloud.mjs` + `postgres.mjs`, que traduz o SQL). Cada módulo instala as próprias tabelas no formato `id, store_id, data (JSON), revision, updated` e expõe uma função de rota.

## Segurança e regras gerais

- Senhas com scrypt + salt (mínimo 12 caracteres), sessões de 8 horas em cookie `dunna_session` HttpOnly e SameSite=Strict, limite de tentativas.
- Escritas exigem `X-Dunna-Request: 1` e origem igual ao host ou listada em `DUNNA_ALLOWED_ORIGINS`.
- Toda consulta administrativa aplica a loja da sessão; o administrador da plataforma escolhe a loja pelo cabeçalho `X-Store-Id`, revalidado no servidor.
- Alterações concorrentes usam `revision` e respondem 409 quando o registro mudou.
- Valores financeiros em centavos inteiros. Nada é apagado: cancelamentos guardam motivo, autor e data; ações relevantes vão para a tabela `audit`.

## Módulos novos do Dunna

| Arquivo | Rotas | O que faz |
|---|---|---|
| `agenda.mjs` | `GET/POST /api/admin/tasks`, `PUT /api/admin/tasks/:id`, `PATCH /api/admin/tasks/:id/status`, `GET /api/admin/pending` | Tarefas com responsável, prazo, prioridade e vínculo (veículo, pessoa, interessado, negociação). Central de pendências reunindo atrasos e cadastros incompletos de todos os módulos. |
| `finance.mjs` | `GET/PUT /api/admin/finance/settings`, `POST /api/admin/finance/entries`, `PATCH /api/admin/finance/entries/:id`, `POST …/:id/settle`, `…/:id/reopen`, `…/:id/cancel`, `GET /api/admin/finance/cashflow`, `GET /api/admin/finance/statement` | Categorias e contas bancárias, lançamentos únicos/mensais/parcelados, baixa parcial, estorno, cancelamento com motivo, fluxo de caixa realizado + previsto e extrato com saldo acumulado. |
| `search.mjs` | `GET/POST /api/admin/tags`, `PUT/DELETE /api/admin/tags/:id`, `GET/PUT /api/admin/tags/links`, `GET /api/admin/search?q=` | Etiquetas em veículos, pessoas, interessados e negociações; busca geral respeitando loja e papel. |
| `insights.mjs` | `GET /api/admin/insights?from&to` | Central de analytics: vendas e margem, DRE gerencial, série de 12 meses, estoque e giro, mix por marca/carroceria, funil, equipe, caixa e recomendações automáticas. |

### Como os números são calculados

- **Margem por venda** (`performance.mjs`): valor da venda − custo do veículo (compra ou repasse de consignação + despesas ligadas ao carro) − comissão pela regra da loja. Sem custo registrado, a margem fica nula e o relatório avisa.
- **DRE**: vendas pela data de fechamento; demais lançamentos pelo vencimento. Despesas ligadas a veículo (compra, troca, preparação, repasse) entram no custo do carro vendido, não nas despesas operacionais. Lançamentos na categoria "Comissões" são ignorados porque a comissão vem da regra.
- **Comparação**: período anterior de mesmo tamanho; períodos que começam no dia 1 comparam com o mesmo trecho do mês anterior.
- **Caixa**: movimentos realizados vêm dos pagamentos (parciais ou integrais) de cada lançamento; o previsto é o saldo em aberto pelo vencimento, com atrasados contados para hoje.
- **Funil**: a etapa alcançada por um interessado é a mais avançada entre a atual e as do histórico ("Etapa: a → b").
- **Dias para vender**: da compra, início da consignação ou cadastro até o fechamento.

## Módulos herdados

Estoque e fotos (`api.mjs`), comercial (`commercial.mjs`: pessoas, propostas, venda atômica, contas), compras e custos (`purchases.mjs`), trocas e consignações (`inventory-operations.mjs`), preparação e idade do estoque (`stockflow.mjs`), avaliações (`appraisals.mjs`), contratos (`contracts.mjs`), margem e comissões (`performance.mjs`), painel do dia (`dashboard.mjs`), avisos e leads públicos (`notifications.mjs`), métricas de interesse por veículo (`analytics.mjs`), FIPE (`fipe.mjs`), descrição por IA (`ai.mjs`) e preparação RENAVE (`renave.mjs`, sem conexão oficial).

## Testes

`npm test` roda todos os arquivos `*.test.mjs` em bancos temporários. `dunna.test.mjs` cobre os módulos novos de ponta a ponta, incluindo permissões do vendedor, conflitos de revisão, baixa parcial, extrato, isolamento das etiquetas e os números da central de analytics.
