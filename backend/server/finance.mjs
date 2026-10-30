import { randomUUID } from 'node:crypto';

// Financeiro completo: contas bancárias, categorias, baixa parcial, recorrência, fluxo de caixa e extrato.
// Os lançamentos continuam na tabela ledger (criados também por vendas, compras, consignações e preparação);
// aqui eles ganham categoria, conta e pagamentos parciais. Valores sempre em centavos inteiros.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const decode = (r) => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const money = (v) => Number.isSafeInteger(v) && v > 0 && v <= 10000000000;
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const addMonths = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10); };

export const ACCOUNT_KINDS = ['checking', 'savings', 'cash', 'card', 'other'];
export const DEFAULT_CATEGORIES = [
    ['sale', 'income', 'Venda de veículos'], ['service', 'income', 'Serviços e despachante'], ['financing', 'income', 'Retorno de financiamento'], ['other-income', 'income', 'Outras receitas'],
    ['purchase', 'expense', 'Compra de veículos'], ['preparation', 'expense', 'Preparação e oficina'], ['consignment', 'expense', 'Repasse de consignação'], ['commission', 'expense', 'Comissões'],
    ['rent', 'expense', 'Aluguel e condomínio'], ['payroll', 'expense', 'Folha e pró-labore'], ['marketing', 'expense', 'Marketing e anúncios'], ['taxes', 'expense', 'Impostos e taxas'],
    ['utilities', 'expense', 'Água, luz e internet'], ['other-expense', 'expense', 'Outras despesas'],
].map(([id, direction, name]) => ({ id, direction, name, active: true, system: true }));
// Lançamentos gerados por outros módulos já nascem classificados
const SOURCE_CATEGORY = { sale: 'sale', deal: 'sale', purchase: 'purchase', trade: 'purchase', consignment: 'consignment', preparation: 'preparation' };
// Saídas ligadas ao custo do veículo: entram no custo do carro vendido, não nas despesas operacionais
export const VEHICLE_COST_SOURCES = ['purchase', 'trade', 'consignment', 'preparation'];

export const categoryOf = (e) => e.categoryId || SOURCE_CATEGORY[e.source] || (e.direction === 'income' ? 'other-income' : 'other-expense');
export const paidCents = (e) => e.status === 'paid' ? e.amountCents : e.status === 'void' ? 0 : (e.payments || []).reduce((s, p) => s + p.amountCents, 0);
export const remainingCents = (e) => e.status === 'open' ? Math.max(0, e.amountCents - paidCents(e)) : 0;

/** Movimentos de caixa realizados de um lançamento: pagamentos parciais e, se baixado por inteiro, o restante. */
export function movementsOf(e) {
    if (e.status === 'void') return [];
    const sign = e.direction === 'income' ? 1 : -1;
    const out = (e.payments || []).map((p) => ({ entryId: e.id, date: p.date, amountCents: p.amountCents, signedCents: sign * p.amountCents, accountId: p.accountId || e.accountId || '', description: e.description, direction: e.direction, categoryId: categoryOf(e) }));
    if (e.status === 'paid') {
        const rest = e.amountCents - out.reduce((s, m) => s + m.amountCents, 0);
        if (rest > 0) out.push({ entryId: e.id, date: e.paidDate || e.dueDate, amountCents: rest, signedCents: sign * rest, accountId: e.accountId || '', description: e.description, direction: e.direction, categoryId: categoryOf(e) });
    }
    return out;
}

export async function installFinance(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS finance_settings(store_id TEXT PRIMARY KEY REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);');
}

export async function readFinanceSettings(db, storeId) {
    const row = await db.prepare('SELECT * FROM finance_settings WHERE store_id=?').get(storeId);
    if (!row) return { categories: DEFAULT_CATEGORIES, accounts: [{ id: 'cash', name: 'Caixa da loja', kind: 'cash', openingCents: 0, openingDate: localToday().slice(0, 8) + '01', active: true }], revision: 0 };
    const data = JSON.parse(row.data);
    // Categorias padrão novas aparecem também para lojas já configuradas
    const known = new Set(data.categories.map((c) => c.id));
    return { ...data, categories: [...data.categories, ...DEFAULT_CATEGORIES.filter((c) => !known.has(c.id))], revision: row.revision };
}

const ledgerOf = async (db, storeId) => (await db.prepare('SELECT * FROM ledger WHERE store_id=?').all(storeId)).map(decode);

export async function cashflowReport(db, storeId, { from, to, group = 'month', accountId = '' }) {
    const settings = await readFinanceSettings(db, storeId), ledger = await ledgerOf(db, storeId), today = localToday();
    const inAccount = (m) => !accountId || (accountId === 'none' ? !m.accountId : m.accountId === accountId);
    const accounts = settings.accounts.filter((a) => !accountId || a.id === accountId);
    const opening = accountId === 'none' ? 0 : accounts.reduce((s, a) => s + (a.openingDate < from ? a.openingCents : 0), 0);
    const moves = ledger.flatMap(movementsOf).filter(inAccount);
    const key = (date) => group === 'day' ? date : date.slice(0, 7);
    const rows = new Map();
    const at = (k) => { if (!rows.has(k)) rows.set(k, { period: k, realizedIn: 0, realizedOut: 0, projectedIn: 0, projectedOut: 0 }); return rows.get(k); };
    // Saldo inicial: abertura das contas antes do período + tudo que já foi realizado antes dele
    let balance = opening + moves.filter((m) => m.date < from).reduce((s, m) => s + m.signedCents, 0);
    for (const a of accounts) if (a.openingDate >= from && a.openingDate <= to) at(key(a.openingDate)).realizedIn += a.openingCents;
    for (const m of moves.filter((m) => m.date >= from && m.date <= to)) at(key(m.date))[m.direction === 'income' ? 'realizedIn' : 'realizedOut'] += m.amountCents;
    // Previsto: o que falta receber/pagar, pela data de vencimento (atrasados entram em hoje)
    const open = ledger.filter((e) => remainingCents(e) > 0 && (!accountId || inAccount({ accountId: e.accountId || '' })));
    for (const e of open) { const due = e.dueDate < today ? today : e.dueDate; if (due >= from && due <= to) at(key(due))[e.direction === 'income' ? 'projectedIn' : 'projectedOut'] += remainingCents(e); }
    const startBalance = balance;
    const series = [...rows.values()].sort((a, b) => a.period.localeCompare(b.period)).map((r) => { balance += r.realizedIn - r.realizedOut + r.projectedIn - r.projectedOut; return { ...r, balanceCents: balance }; });
    const sum = (k) => series.reduce((s, r) => s + r[k], 0);
    const accountBalances = settings.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, active: a.active, balanceCents: a.openingCents + ledger.flatMap(movementsOf).filter((m) => m.accountId === a.id && m.date <= today).reduce((s, m) => s + m.signedCents, 0) }));
    const unassigned = ledger.flatMap(movementsOf).filter((m) => !m.accountId && m.date <= today).reduce((s, m) => s + m.signedCents, 0);
    const overdue = (direction) => open.filter((e) => e.direction === direction && e.dueDate < today).reduce((s, e) => s + remainingCents(e), 0);
    return {
        from, to, group, accountId, startBalanceCents: startBalance, endBalanceCents: balance, series,
        totals: { realizedIn: sum('realizedIn'), realizedOut: sum('realizedOut'), projectedIn: sum('projectedIn'), projectedOut: sum('projectedOut') },
        accounts: accountBalances, unassignedCents: unassigned, overdue: { incomeCents: overdue('income'), expenseCents: overdue('expense') },
    };
}

export async function statementReport(db, storeId, { from, to, accountId = '' }) {
    const settings = await readFinanceSettings(db, storeId), ledger = await ledgerOf(db, storeId);
    const names = new Map(settings.categories.map((c) => [c.id, c.name]));
    const inAccount = (m) => !accountId || (accountId === 'none' ? !m.accountId : m.accountId === accountId);
    const accounts = settings.accounts.filter((a) => !accountId || a.id === accountId);
    const moves = ledger.flatMap(movementsOf).filter(inAccount);
    let balance = (accountId === 'none' ? 0 : accounts.reduce((s, a) => s + (a.openingDate < from ? a.openingCents : 0), 0)) + moves.filter((m) => m.date < from).reduce((s, m) => s + m.signedCents, 0);
    const openingCents = balance;
    const rows = [
        ...accounts.filter((a) => accountId !== 'none' && a.openingDate >= from && a.openingDate <= to).map((a) => ({ date: a.openingDate, description: `Saldo inicial · ${a.name}`, direction: 'income', amountCents: a.openingCents, signedCents: a.openingCents, entryId: '', categoryName: '', accountId: a.id })),
        ...moves.filter((m) => m.date >= from && m.date <= to).map((m) => ({ ...m, categoryName: names.get(m.categoryId) || '' })),
    ].sort((a, b) => a.date.localeCompare(b.date)).map((m) => { balance += m.signedCents; return { ...m, balanceCents: balance }; });
    return { from, to, accountId, openingCents, closingCents: balance, rows };
}

export async function financeRoute({ req, res, route, c, db, body, send, admin, audit }) {
    if (!route.startsWith('/api/admin/finance/')) return false;
    await admin();
    const url = new URL(req.url, 'http://local');
    const today = localToday();
    const period = () => {
        const from = url.searchParams.get('from') || today.slice(0, 8) + '01', to = url.searchParams.get('to') || addMonths(today.slice(0, 8) + '01', 1);
        if (!isDate(from) || !isDate(to) || from > to) fail(422, 'Período inválido.');
        return { from, to };
    };
    if (route === '/api/admin/finance/settings') {
        if (req.method === 'GET') { send(res, await readFinanceSettings(db, c.storeId)); return true; }
        if (req.method !== 'PUT') fail(405, 'Método não permitido.');
        const v = await body(req), old = await readFinanceSettings(db, c.storeId);
        if (v.revision !== old.revision) fail(409, 'Configuração alterada em outra sessão. Recarregue.');
        if (!Array.isArray(v.categories) || !Array.isArray(v.accounts) || v.categories.length > 120 || v.accounts.length > 40) fail(422, 'Dados inválidos.');
        const systemIds = new Set(DEFAULT_CATEGORIES.map((x) => x.id));
        const categories = v.categories.map((x) => {
            const name = text(x?.name, 80), direction = x?.direction, id = text(x?.id, 64) || randomUUID();
            if (!name || !['income', 'expense'].includes(direction)) fail(422, 'Cada categoria precisa de nome e tipo.');
            const system = systemIds.has(id);
            return { id, name, direction: system ? DEFAULT_CATEGORIES.find((d) => d.id === id).direction : direction, active: x.active !== false, system };
        });
        for (const s of systemIds) if (!categories.some((x) => x.id === s)) fail(422, 'Categorias padrão podem ser desativadas, mas não removidas.');
        const used = new Set((await ledgerOf(db, c.storeId)).flatMap((e) => [e.accountId, ...(e.payments || []).map((p) => p.accountId)]).filter(Boolean));
        const accounts = v.accounts.map((a) => {
            const name = text(a?.name, 80), id = text(a?.id, 64) || randomUUID();
            if (!name || !ACCOUNT_KINDS.includes(a?.kind)) fail(422, 'Cada conta precisa de nome e tipo.');
            if (!Number.isSafeInteger(a.openingCents) || Math.abs(a.openingCents) > 10000000000) fail(422, 'Saldo inicial inválido.');
            if (!isDate(a.openingDate)) fail(422, 'Data do saldo inicial inválida.');
            return { id, name, kind: a.kind, bank: text(a.bank, 80), openingCents: a.openingCents, openingDate: a.openingDate, active: a.active !== false };
        });
        for (const id of used) if (old.accounts.some((a) => a.id === id) && !accounts.some((a) => a.id === id)) fail(422, 'Conta com movimentações não pode ser removida. Desative-a.');
        const data = JSON.stringify({ categories, accounts }), at = new Date().toISOString();
        if (old.revision) await db.prepare('UPDATE finance_settings SET data=?,revision=revision+1,updated=? WHERE store_id=?').run(data, at, c.storeId);
        else await db.prepare('INSERT INTO finance_settings VALUES(?,?,1,?)').run(c.storeId, data, at);
        await audit(c, 'finance.settings', c.storeId);
        send(res, await readFinanceSettings(db, c.storeId));
        return true;
    }
    if (route === '/api/admin/finance/cashflow' && req.method === 'GET') {
        const group = url.searchParams.get('group') === 'day' ? 'day' : 'month';
        send(res, await cashflowReport(db, c.storeId, { ...period(), group, accountId: text(url.searchParams.get('account') || '', 64) }));
        return true;
    }
    if (route === '/api/admin/finance/statement' && req.method === 'GET') {
        send(res, await statementReport(db, c.storeId, { ...period(), accountId: text(url.searchParams.get('account') || '', 64) }));
        return true;
    }
    const settings = await readFinanceSettings(db, c.storeId);
    const category = (id, direction) => { if (!id) return ''; const cat = settings.categories.find((x) => x.id === id); if (!cat || cat.direction !== direction) fail(422, 'Categoria inválida para este tipo de lançamento.'); return cat.id; };
    const account = (id) => { if (!id) return ''; if (!settings.accounts.some((a) => a.id === id)) fail(422, 'Conta bancária não encontrada.'); return id; };
    const transaction = async (fn) => { await db.exec('BEGIN IMMEDIATE'); try { const r = await fn(); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; } };
    const row = async (id) => { const r = await db.prepare('SELECT * FROM ledger WHERE id=? AND store_id=?').get(id, c.storeId); return r ? decode(r) : null; };
    const save = async ({ id, revision, updatedAt, ...data }) => await db.prepare('UPDATE ledger SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(data), new Date().toISOString(), id, c.storeId);
    if (route === '/api/admin/finance/entries' && req.method === 'POST') {
        const v = await body(req);
        if (!['income', 'expense'].includes(v.direction) || !text(v.description) || !money(v.amountCents) || !isDate(v.dueDate)) fail(422, 'Informe descrição, tipo, valor e vencimento válidos.');
        const vehicleId = text(v.vehicleId, 64), personId = text(v.personId, 64);
        if (vehicleId && !(await db.prepare('SELECT id FROM vehicles WHERE id=? AND store_id=?').get(vehicleId, c.storeId))) fail(422, 'Veículo não pertence a esta loja.');
        if (personId && !(await db.prepare('SELECT id FROM people WHERE id=? AND store_id=?').get(personId, c.storeId))) fail(422, 'Pessoa não pertence a esta loja.');
        // Repetição: "installments" divide o valor em N parcelas; "monthly" repete o mesmo valor por N meses
        const count = v.repeat?.count ?? 1, mode = v.repeat?.mode || 'monthly';
        if (!Number.isInteger(count) || count < 1 || count > 60 || !['installments', 'monthly'].includes(mode)) fail(422, 'Repetição inválida: de 1 a 60 vezes.');
        const base = mode === 'installments' ? Math.floor(v.amountCents / count) : v.amountCents;
        if (base <= 0) fail(422, 'Valor insuficiente para o número de parcelas.');
        const group = count > 1 ? randomUUID() : '';
        const entries = Array.from({ length: count }, (_, i) => ({
            direction: v.direction, description: text(v.description) + (count > 1 ? ` · ${i + 1}/${count}` : ''),
            amountCents: mode === 'installments' && i === count - 1 ? v.amountCents - base * (count - 1) : base,
            dueDate: addMonths(v.dueDate, i), status: 'open', paidDate: '', payments: [], vehicleId, personId, dealId: '', source: 'manual',
            categoryId: category(text(v.categoryId, 64), v.direction), accountId: account(text(v.accountId, 64)), notes: text(v.notes, 2000), recurrenceId: group, createdBy: c.user.name, createdAt: new Date().toISOString(),
        }));
        const ids = await transaction(async () => Promise.all(entries.map(async (e) => { const id = randomUUID(); await db.prepare('INSERT INTO ledger VALUES(?,?,?,1,?)').run(id, c.storeId, JSON.stringify(e), new Date().toISOString()); await audit(c, 'ledger.create', id); return id; })));
        send(res, await Promise.all(ids.map(row)), 201);
        return true;
    }
    const m = route.match(/^\/api\/admin\/finance\/entries\/([a-zA-Z0-9-]+)(?:\/(settle|reopen|cancel))?$/);
    if (!m) fail(404, 'Recurso não encontrado.');
    const [, id, action] = m, v = await body(req);
    if (!v || typeof v !== 'object') fail(422, 'Dados inválidos.');
    const result = await transaction(async () => {
        const e = await row(id);
        if (!e) fail(404, 'Lançamento não encontrado.');
        if (v.revision !== e.revision) fail(409, 'Lançamento alterado em outra sessão. Recarregue.');
        if (e.status === 'void') fail(409, 'Lançamento cancelado não pode ser alterado.');
        const payments = e.payments || [];
        if (!action && req.method === 'PATCH') {
            const next = { ...e, categoryId: category(text(v.categoryId, 64), e.direction), accountId: account(text(v.accountId, 64)), notes: text(v.notes, 2000) };
            // Valor, vencimento e descrição só mudam em lançamento manual ainda sem pagamento
            const changesTerms = (v.amountCents !== undefined && v.amountCents !== e.amountCents) || (v.dueDate !== undefined && v.dueDate !== e.dueDate) || (v.description !== undefined && text(v.description) !== e.description);
            if (changesTerms) {
                if (e.source !== 'manual') fail(422, 'Valor e vencimento deste lançamento vêm de outro módulo (venda, compra ou preparação).');
                if (e.status !== 'open' || payments.length) fail(422, 'Reabra o lançamento antes de alterar valor ou vencimento.');
                if (!money(v.amountCents) || !isDate(v.dueDate) || !text(v.description)) fail(422, 'Informe descrição, valor e vencimento válidos.');
                Object.assign(next, { amountCents: v.amountCents, dueDate: v.dueDate, description: text(v.description) });
            }
            await save(next);
            await audit(c, 'ledger.update', id);
            return 'Lançamento atualizado.';
        }
        if (action === 'settle' && req.method === 'POST') {
            if (e.status !== 'open') fail(409, 'Este lançamento já está baixado.');
            const rest = remainingCents(e);
            if (!money(v.amountCents) || v.amountCents > rest) fail(422, 'Informe um valor entre R$ 0,01 e o saldo em aberto.');
            if (!isDate(v.date) || v.date > today) fail(422, 'Data do pagamento inválida (não pode ser futura).');
            const accountId = account(text(v.accountId, 64)) || e.accountId || '';
            const nextPayments = [...payments, { id: randomUUID(), date: v.date, amountCents: v.amountCents, accountId, by: c.user.name, at: new Date().toISOString() }];
            const done = v.amountCents === rest;
            await save({ ...e, payments: nextPayments, status: done ? 'paid' : 'open', paidDate: done ? v.date : '' });
            await audit(c, done ? 'ledger.paid' : 'ledger.partial', id);
            return done ? 'Baixa total registrada.' : 'Pagamento parcial registrado.';
        }
        if (action === 'reopen' && req.method === 'POST') {
            if (e.status !== 'paid' && !payments.length) fail(409, 'Não há pagamentos para estornar.');
            await save({ ...e, payments: [], status: 'open', paidDate: '', reopenedAt: new Date().toISOString(), reopenedBy: c.user.name });
            await audit(c, 'ledger.reopen', id);
            return 'Pagamentos estornados. O lançamento voltou a ficar em aberto.';
        }
        if (action === 'cancel' && req.method === 'POST') {
            if (e.source !== 'manual') fail(422, 'Lançamentos de venda, compra ou consignação são cancelados no próprio processo.');
            if (e.status !== 'open' || payments.length) fail(422, 'Estorne os pagamentos antes de cancelar.');
            const reason = text(v.reason, 500);
            if (!reason) fail(422, 'Informe o motivo do cancelamento.');
            await save({ ...e, status: 'void', cancelReason: reason, cancelledBy: c.user.name, cancelledAt: new Date().toISOString() });
            await audit(c, 'ledger.cancel', id);
            return 'Lançamento cancelado.';
        }
        fail(405, 'Método não permitido.');
    });
    send(res, { message: result, entry: await row(id) });
    return true;
}
