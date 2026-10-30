import { performanceReport } from './performance.mjs';
import { agingReport } from './stockflow.mjs';
import { CHECKLISTS } from './contracts.mjs';
import { remainingCents } from './finance.mjs';

// Painel inicial: o que pede atenção hoje, reunido dos outros módulos.
// O vendedor vê só os próprios interessados e as próprias vendas.
const decode = (r) => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
const DAY = 86400000;
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const startOfLocalDay = (iso) => Date.parse(iso + 'T00:00:00-03:00');

export async function dashboardReport(db, storeId, user) {
    const seller = user.role === 'seller';
    const today = localToday();
    const now = Date.now();
    const list = async (t) => (await db.prepare(`SELECT * FROM ${t} WHERE store_id=?`).all(storeId)).map(decode);

    // Interessados: retornos atrasados/de hoje e novos sem atendimento há mais de 1 dia
    const leads = (await list('leads')).filter((l) => !seller || l.assignedTo === user.id);
    const open = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost');
    const due = (l) => (l.nextContactAt ? Date.parse(l.nextContactAt) : null);
    const endToday = startOfLocalDay(today) + DAY;
    const pick = (l) => ({ id: l.id, name: l.name, interest: l.interest, source: l.source, nextContactAt: l.nextContactAt || '', createdAt: l.createdAt || '' });
    const overdue = open.filter((l) => due(l) !== null && due(l) < now).sort((a, b) => due(a) - due(b));
    const dueToday = open.filter((l) => due(l) !== null && due(l) >= now && due(l) < endToday).sort((a, b) => due(a) - due(b));
    const untouched = open.filter((l) => l.stage === 'new' && !l.nextContactAt && l.createdAt && now - Date.parse(l.createdAt) > DAY);
    const newThisWeek = leads.filter((l) => l.createdAt && now - Date.parse(l.createdAt) <= 7 * DAY).length;

    // Vendas do mês (dia 1 até hoje, no fuso da loja)
    const monthStart = today.slice(0, 8) + '01';
    const month = await performanceReport(db, storeId, { from: monthStart, to: today, sellerId: seller ? user.id : '' });
    const report = {
        today,
        role: user.role,
        leads: { overdue: overdue.length, today: dueToday.length, untouched: untouched.length, newThisWeek, open: open.length, next: [...overdue, ...dueToday].slice(0, 6).map(pick), untouchedList: untouched.slice(0, 4).map(pick) },
        sales: { count: month.totals.sales, saleCents: month.totals.saleCents, commissionCents: month.totals.commissionCents, marginCents: seller ? null : month.totals.marginCents, marginPct: seller ? null : month.totals.marginPct, from: monthStart },
    };
    if (seller) return report;

    // Avaliações aguardando resposta
    const appraisals = (await list('appraisals')).filter((a) => a.status === 'new' || a.status === 'analyzing');
    report.appraisals = { waiting: appraisals.length, list: appraisals.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 4).map((a) => ({ id: a.id, name: a.name, model: a.model, year: a.year, status: a.status, createdAt: a.createdAt })) };

    // Estoque: idade, parados e preparação
    const aging = await agingReport(db, storeId);
    const [, second] = aging.settings.alertDays;
    const stale = aging.vehicles.filter((v) => v.status !== 'draft' && v.days >= second);
    const preps = (await list('preparations')).filter((p) => p.status === 'in_progress');
    report.stock = {
        vehicles: aging.totals.vehicles, avgDays: aging.totals.avgDays, stockCents: aging.totals.stockCents, holdingCents: aging.totals.holdingCents,
        stale: stale.length, staleList: stale.slice(0, 4).map((v) => ({ id: v.id, label: v.label, days: v.days, price: v.price, suggestion: v.suggestion?.price ?? null })),
        withSuggestion: aging.vehicles.filter((v) => v.suggestion?.price).length,
        preparing: preps.length, preparingList: preps.map((p) => ({ id: p.id, label: p.vehicleLabel, days: Math.floor((now - Date.parse(p.startedAt)) / DAY), done: p.tasks.filter((t) => t.status === 'done').length, total: p.tasks.length })).sort((a, b) => b.days - a.days).slice(0, 4),
    };

    // Financeiro: atrasados e próximos 7 dias
    const ledger = (await list('ledger')).filter((e) => e.status === 'open');
    const week = addDays(today, 7);
    const sum = (rows) => rows.reduce((s, e) => s + remainingCents(e), 0);
    const side = (direction) => {
        const rows = ledger.filter((e) => e.direction === direction);
        const late = rows.filter((e) => e.dueDate < today), soon = rows.filter((e) => e.dueDate >= today && e.dueDate <= week);
        return { overdueCount: late.length, overdueCents: sum(late), weekCount: soon.length, weekCents: sum(soon) };
    };
    report.finance = { payable: side('expense'), receivable: side('income') };

    // Jurídico: contratos sem assinatura e documentos obrigatórios pendentes
    const contracts = (await list('contracts')).filter((c) => c.status !== 'cancelled');
    const pendingDocs = contracts.map((c) => ({ c, missing: CHECKLISTS[c.process].filter(([key, , required]) => required && c.checklist[key]?.status === 'pending').length })).filter((x) => x.missing);
    report.legal = { unsigned: contracts.filter((c) => c.status === 'draft' || c.status === 'sent').length, processesWithPending: pendingDocs.length, pendingItems: pendingDocs.reduce((s, x) => s + x.missing, 0) };
    return report;
}

export async function dashboardRoute({ req, res, route, c, db, send }) {
    if (route !== '/api/admin/dashboard' || req.method !== 'GET') return false;
    send(res, await dashboardReport(db, c.storeId, c.user));
    return true;
}
