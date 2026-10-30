import { performanceReport } from './performance.mjs';
import { agingReport } from './stockflow.mjs';
import { vehicleCosts } from './purchases.mjs';
import { readFinanceSettings, categoryOf, movementsOf, cashflowReport, VEHICLE_COST_SOURCES } from './finance.mjs';

// Central de analytics: resultado (DRE), vendas e margem, giro do estoque, funil de conversão, equipe e
// recomendações automáticas, sempre comparando o período escolhido com o período anterior de mesmo tamanho.
// Todos os números saem dos registros da loja; quando falta custo, a margem é marcada como incompleta.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const decode = (r) => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
const DAY = 86400000;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const localDay = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);
const pct = (part, whole) => whole ? Math.round((part / whole) * 1000) / 10 : null;
const change = (cur, prev) => prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null;
const avg = (xs) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const STAGE_ORDER = ['new', 'contact', 'qualified', 'proposal', 'won'];
const STAGE_KEYS = [...STAGE_ORDER, 'lost'];

function summarize(sales) {
    const known = sales.filter((s) => s.marginCents !== null);
    const revenueCents = sales.reduce((n, s) => n + s.saleCents, 0), knownRevenue = known.reduce((n, s) => n + s.saleCents, 0);
    const marginCents = known.reduce((n, s) => n + s.marginCents, 0);
    return {
        count: sales.length, revenueCents, avgTicketCents: sales.length ? Math.round(revenueCents / sales.length) : 0,
        cogsCents: known.reduce((n, s) => n + s.costCents, 0), commissionCents: sales.reduce((n, s) => n + (s.commissionCents ?? 0), 0),
        marginCents, marginPct: pct(marginCents, knownRevenue), pendingCost: sales.length - known.length,
        avgDaysToSell: avg(sales.map((s) => s.daysToSell).filter((d) => d !== null)),
    };
}

/** Etapa mais avançada que o interessado alcançou, lida do histórico ("Etapa: a → b") e da etapa atual. */
function reachedStage(lead) {
    let best = STAGE_ORDER.indexOf(lead.stage);
    for (const h of lead.history || []) {
        const m = /^Etapa: (\w+) → (\w+)$/.exec(h.text || '');
        if (m) for (const s of [m[1], m[2]]) best = Math.max(best, STAGE_ORDER.indexOf(s));
    }
    return Math.max(best, 0);
}

export async function insightsReport(db, storeId, { from, to }) {
    const today = localToday(), length = daysBetween(from, to) + 1;
    // Período começando no dia 1: compara com o mesmo trecho do mês anterior (1 a 29/10 contra 1 a 29/09)
    let prevFrom = addDays(from, -length), prevTo = addDays(from, -1);
    if (from.endsWith('-01') && length <= 31) {
        const [y, m] = from.split('-').map(Number), start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), monthEnd = addDays(from, -1);
        prevFrom = start; prevTo = addDays(start, length - 1) > monthEnd ? monthEnd : addDays(start, length - 1);
    }
    const list = async (t) => (await db.prepare(`SELECT * FROM ${t} WHERE store_id=?`).all(storeId)).map(decode);
    const [all, aging, costs, vehicles, leads, ledger, settings, users] = await Promise.all([
        performanceReport(db, storeId, {}), agingReport(db, storeId), vehicleCosts(db, storeId), list('vehicles'), list('leads'), list('ledger'),
        readFinanceSettings(db, storeId), db.prepare('SELECT id,name,role,active FROM users WHERE store_id=?').all(storeId),
    ]);
    const costBy = new Map(costs.map((x) => [x.vehicle.id, x])), carBy = new Map(vehicles.map((v) => [v.id, v]));
    const catName = new Map(settings.categories.map((x) => [x.id, x.name]));
    // Dias até vender: da entrada (compra, consignação ou cadastro) ao fechamento
    const sales = all.sales.map((s) => {
        const cost = costBy.get(s.vehicleId), car = carBy.get(s.vehicleId);
        const entry = (cost?.purchase?.purchaseDate || cost?.consignment?.startDate || car?.listedAt || '').slice(0, 10), day = localDay(s.closedAt);
        return { ...s, day, brand: car?.brand || 'Outra', body: car?.body || 'Outro', daysToSell: entry && day ? Math.max(0, daysBetween(entry, day)) : null };
    });
    const inRange = (a, b) => (s) => s.day >= a && s.day <= b;
    const curSales = sales.filter(inRange(from, to)), prevSales = sales.filter(inRange(prevFrom, prevTo));

    // Resultado operacional (competência): vendas pelo fechamento, demais lançamentos pelo vencimento
    const dre = (a, b, periodSales) => {
        const s = summarize(periodSales);
        const live = ledger.filter((e) => e.status !== 'void' && e.dueDate >= a && e.dueDate <= b && e.source !== 'sale' && e.source !== 'deal');
        const group = (rows) => { const m = new Map(); for (const e of rows) { const k = categoryOf(e); m.set(k, (m.get(k) || 0) + e.amountCents); } return [...m].map(([id, cents]) => ({ id, name: catName.get(id) || id, cents })).sort((x, y) => y.cents - x.cents); };
        // Despesas do carro (compra, preparação, repasse) já estão no custo do vendido; comissão vem da regra da loja
        const opex = group(live.filter((e) => e.direction === 'expense' && !e.vehicleId && !VEHICLE_COST_SOURCES.includes(e.source) && categoryOf(e) !== 'commission'));
        const otherIncome = group(live.filter((e) => e.direction === 'income'));
        const opexCents = opex.reduce((n, x) => n + x.cents, 0), otherIncomeCents = otherIncome.reduce((n, x) => n + x.cents, 0);
        // Vendas sem custo registrado entram sem CMV: o relatório avisa que o lucro bruto fica superestimado
        const grossCents = s.revenueCents - s.cogsCents;
        const resultCents = grossCents - s.commissionCents + otherIncomeCents - opexCents;
        return { revenueCents: s.revenueCents, cogsCents: s.cogsCents, pendingCost: s.pendingCost, grossCents, commissionCents: s.commissionCents, otherIncome, otherIncomeCents, opex, opexCents, resultCents, resultPct: pct(resultCents, s.revenueCents + otherIncomeCents) };
    };

    // Série dos últimos 12 meses terminando no mês de "to"
    const months = Array.from({ length: 12 }, (_, i) => { const [y, m] = to.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1)); return d.toISOString().slice(0, 7); });
    const moves = ledger.flatMap(movementsOf);
    const series = months.map((month) => {
        const a = month + '-01', b = addDays(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
        const ms = sales.filter(inRange(a, b)), d = dre(a, b, ms), s = summarize(ms);
        const mv = moves.filter((x) => x.date >= a && x.date <= b);
        return { month, sales: s.count, revenueCents: s.revenueCents, marginCents: s.marginCents, marginPct: s.marginPct, opexCents: d.opexCents, resultCents: d.resultCents, cashInCents: mv.filter((x) => x.signedCents > 0).reduce((n, x) => n + x.amountCents, 0), cashOutCents: mv.filter((x) => x.signedCents < 0).reduce((n, x) => n + x.amountCents, 0) };
    });

    // Estoque e giro
    const stocked = aging.vehicles.filter((v) => v.status !== 'draft');
    const buckets = [[0, 30, 'Até 30 dias'], [31, 60, '31 a 60 dias'], [61, 90, '61 a 90 dias'], [91, Infinity, 'Mais de 90 dias']].map(([a, b, label]) => { const vs = stocked.filter((v) => v.days >= a && v.days <= b); return { label, count: vs.length, valueCents: vs.reduce((n, v) => n + Math.round(v.price * 100), 0), holdingCents: vs.reduce((n, v) => n + v.holdingCents, 0) }; });
    const last90 = sales.filter(inRange(addDays(today, -89), today)).length;
    const knownStock = stocked.filter((v) => v.costCents !== null);
    const stock = {
        count: stocked.length, drafts: aging.vehicles.length - stocked.length, valueCents: stocked.reduce((n, v) => n + Math.round(v.price * 100), 0),
        costCents: knownStock.reduce((n, v) => n + v.costCents, 0), missingCost: stocked.length - knownStock.length,
        potentialMarginCents: knownStock.reduce((n, v) => n + v.marginCents, 0), potentialMarginPct: pct(knownStock.reduce((n, v) => n + v.marginCents, 0), knownStock.reduce((n, v) => n + Math.round(v.price * 100), 0)),
        avgDays: aging.totals.avgDays, holdingCents: aging.totals.holdingCents, buckets,
        salesLast90: last90, daysOfInventory: last90 ? Math.round(stocked.length / (last90 / 90)) : null, turnover90: stocked.length ? Math.round((last90 / stocked.length) * 100) / 100 : null,
        belowFipe: stocked.filter((v) => v.fipe && v.price < v.fipe).length, withFipe: stocked.filter((v) => v.fipe).length,
        priceToFipePct: avg(stocked.filter((v) => v.fipe).map((v) => Math.round((v.price / v.fipe) * 1000))) === null ? null : avg(stocked.filter((v) => v.fipe).map((v) => Math.round((v.price / v.fipe) * 1000))) / 10,
        oldest: stocked.slice(0, 5).map((v) => ({ id: v.id, label: v.label, days: v.days, price: v.price, holdingCents: v.holdingCents, suggestion: v.suggestion?.price ?? null })),
    };
    const mix = (key) => {
        const m = new Map();
        const at = (k) => { if (!m.has(k)) m.set(k, { key: k, stock: 0, stockValueCents: 0, sold: 0, revenueCents: 0, marginCents: 0, knownRevenue: 0, days: [] }); return m.get(k); };
        for (const v of stocked) { const car = carBy.get(v.id); const x = at(car?.[key] || 'Outro'); x.stock++; x.stockValueCents += Math.round(v.price * 100); }
        for (const s of curSales) { const x = at(s[key]); x.sold++; x.revenueCents += s.saleCents; if (s.marginCents !== null) { x.marginCents += s.marginCents; x.knownRevenue += s.saleCents; } if (s.daysToSell !== null) x.days.push(s.daysToSell); }
        return [...m.values()].map(({ days, knownRevenue, ...x }) => ({ ...x, marginPct: pct(x.marginCents, knownRevenue), avgDaysToSell: avg(days) })).sort((a, b) => b.sold - a.sold || b.stock - a.stock);
    };

    // Funil: interessados que chegaram no período
    const funnelFor = (a, b) => {
        const ls = leads.filter((l) => { const d = localDay(l.createdAt); return d >= a && d <= b; });
        const reached = STAGE_ORDER.map((stage, i) => ({ stage, count: ls.filter((l) => l.stage !== 'lost' ? reachedStage(l) >= i : reachedStage(l) >= i && i < STAGE_ORDER.length - 1).length }));
        const won = ls.filter((l) => l.stage === 'won').length, lost = ls.filter((l) => l.stage === 'lost').length;
        const reasons = new Map(); for (const l of ls.filter((l) => l.stage === 'lost')) reasons.set(l.lossReason || 'Sem motivo', (reasons.get(l.lossReason || 'Sem motivo') || 0) + 1);
        const sources = new Map(); for (const l of ls) { const k = l.source || 'Cadastro manual'; const x = sources.get(k) || { source: k, leads: 0, won: 0, lost: 0 }; x.leads++; if (l.stage === 'won') x.won++; if (l.stage === 'lost') x.lost++; sources.set(k, x); }
        return { leads: ls.length, won, lost, open: ls.length - won - lost, conversionPct: pct(won, ls.length), reached, lossReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count), sources: [...sources.values()].map((x) => ({ ...x, conversionPct: pct(x.won, x.leads) })).sort((x, y) => y.leads - x.leads), list: ls };
    };
    const funnel = funnelFor(from, to), prevFunnel = funnelFor(prevFrom, prevTo);
    const openNow = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost');
    const pipeline = STAGE_KEYS.filter((k) => k !== 'won' && k !== 'lost').map((stage) => ({ stage, count: openNow.filter((l) => l.stage === stage).length }));

    // Equipe: vendas, margem e conversão dos interessados atribuídos
    const team = users.filter((u) => u.role !== 'platform' || curSales.some((s) => s.sellerId === u.id)).map((u) => {
        const ss = curSales.filter((s) => s.sellerId === u.id), sum = summarize(ss), ls = funnel.list.filter((l) => l.assignedTo === u.id);
        return { id: u.id, name: u.name, role: u.role, active: !!u.active, sales: sum.count, revenueCents: sum.revenueCents, marginCents: sum.marginCents, marginPct: sum.marginPct, commissionCents: sum.commissionCents, leads: ls.length, won: ls.filter((l) => l.stage === 'won').length, conversionPct: pct(ls.filter((l) => l.stage === 'won').length, ls.length), openLeads: openNow.filter((l) => l.assignedTo === u.id).length };
    }).filter((t) => t.sales || t.leads || t.openLeads || t.active).sort((a, b) => b.revenueCents - a.revenueCents);

    const cash = await cashflowReport(db, storeId, { from: today, to: addDays(today, 30), group: 'month' });
    const current = summarize(curSales), previous = summarize(prevSales), result = dre(from, to, curSales), prevResult = dre(prevFrom, prevTo, prevSales);

    // Recomendações automáticas a partir dos números
    const tips = [];
    const tip = (tone, title, detail, target) => tips.push({ tone, title, detail, target });
    const rc = change(current.revenueCents, previous.revenueCents);
    if (rc !== null) tip(rc >= 0 ? 'good' : 'bad', `Faturamento ${rc >= 0 ? 'subiu' : 'caiu'} ${Math.abs(rc).toLocaleString('pt-BR')}%`, `${brl(current.revenueCents)} neste período contra ${brl(previous.revenueCents)} no anterior.`);
    if (current.marginPct !== null && previous.marginPct !== null && Math.abs(current.marginPct - previous.marginPct) >= 1) tip(current.marginPct >= previous.marginPct ? 'good' : 'warn', `Margem ${current.marginPct >= previous.marginPct ? 'melhorou' : 'apertou'} ${Math.abs(Math.round((current.marginPct - previous.marginPct) * 10) / 10).toLocaleString('pt-BR')} p.p.`, `Margem líquida de ${current.marginPct.toLocaleString('pt-BR')}% contra ${previous.marginPct.toLocaleString('pt-BR')}% no período anterior.`, { screen: 'performance', view: 'all', label: 'Margem e comissões' });
    if (current.pendingCost) tip('warn', `${current.pendingCost} venda(s) sem custo registrado`, 'Registre a compra ou a consignação desses carros para a margem e o resultado ficarem completos.', { screen: 'purchases', view: 'all', label: 'Compras de veículos' });
    const old = buckets[3];
    if (old.count) tip('bad', `${old.count} carro(s) há mais de 90 dias no pátio`, `${brl(old.valueCents)} parados, com custo de oportunidade estimado de ${brl(old.holdingCents)}. Revise preço ou anuncie em destaque.`, { screen: 'aging', view: 'all', label: 'Idade do estoque' });
    if (stock.daysOfInventory !== null && stock.daysOfInventory > 75) tip('warn', `Estoque para ${stock.daysOfInventory} dias`, `No ritmo dos últimos 90 dias (${last90} vendas), o estoque atual leva mais de dois meses para girar.`);
    else if (stock.daysOfInventory !== null && stock.daysOfInventory < 25 && stock.count) tip('info', `Estoque gira em ${stock.daysOfInventory} dias`, 'O ritmo de vendas está alto para o tamanho do estoque: avalie novas compras para não faltar carro.');
    const bestSource = funnel.sources.filter((x) => x.leads >= 3 && x.conversionPct !== null).sort((a, b) => b.conversionPct - a.conversionPct)[0];
    if (bestSource && funnel.conversionPct !== null && bestSource.conversionPct > funnel.conversionPct) tip('good', `${bestSource.source} converte melhor`, `${bestSource.conversionPct.toLocaleString('pt-BR')}% de conversão contra ${funnel.conversionPct.toLocaleString('pt-BR')}% da média. Vale reforçar esse canal.`, { screen: 'insights', view: 'funnel', label: 'Funil e conversão' });
    if (funnel.lossReasons[0] && funnel.lost >= 3) tip('warn', `Principal motivo de perda: ${funnel.lossReasons[0].reason}`, `${funnel.lossReasons[0].count} de ${funnel.lost} oportunidades perdidas no período.`, { screen: 'insights', view: 'funnel', label: 'Funil e conversão' });
    if (cash.overdue.incomeCents) tip('bad', `${brl(cash.overdue.incomeCents)} a receber em atraso`, 'Cobre os clientes em atraso antes de assumir novas compras.', { screen: 'finance', view: 'income', label: 'Contas a receber' });
    if (cash.endBalanceCents < 0) tip('bad', 'Caixa projetado negativo em 30 dias', `Saldo previsto de ${brl(cash.endBalanceCents)} considerando contas abertas até ${addDays(today, 30).split('-').reverse().join('/')}.`, { screen: 'finance', view: 'cashflow', label: 'Fluxo de caixa' });
    const brands = mix('brand').filter((x) => x.sold >= 2 && x.marginPct !== null).sort((a, b) => b.marginPct - a.marginPct);
    if (brands.length >= 2) tip('info', `${brands[0].key} tem a melhor margem`, `${brands[0].marginPct.toLocaleString('pt-BR')}% de margem média em ${brands[0].sold} vendas. ${brands[brands.length - 1].key} fica com ${brands[brands.length - 1].marginPct.toLocaleString('pt-BR')}%.`, { screen: 'insights', view: 'stock', label: 'Estoque e giro' });
    if (!tips.length) tip('info', 'Sem alertas no período', 'Cadastre vendas, compras e interessados para o Dunna gerar recomendações a partir dos seus números.');

    return {
        from, to, previous: { from: prevFrom, to: prevTo }, today,
        sales: { current, previous, changes: { revenue: rc, count: change(current.count, previous.count), ticket: change(current.avgTicketCents, previous.avgTicketCents), margin: change(current.marginCents, previous.marginCents) }, list: curSales.slice(0, 50).map(({ day, ...s }) => s) },
        dre: { current: result, previous: prevResult },
        series, stock, mix: { brand: mix('brand'), body: mix('body') },
        funnel: { ...funnel, list: undefined, previous: { leads: prevFunnel.leads, won: prevFunnel.won, conversionPct: prevFunnel.conversionPct }, pipeline },
        team, cash: { next30: cash.totals, endBalanceCents: cash.endBalanceCents, startBalanceCents: cash.startBalanceCents, overdue: cash.overdue, accounts: cash.accounts },
        tips,
    };
}

export async function insightsRoute({ req, res, route, c, db, send, admin }) {
    if (route !== '/api/admin/insights' || req.method !== 'GET') return false;
    await admin();
    const url = new URL(req.url, 'http://local'), today = localToday();
    const from = url.searchParams.get('from') || today.slice(0, 8) + '01', to = url.searchParams.get('to') || today;
    if (!isDate(from) || !isDate(to) || from > to || daysBetween(from, to) > 731) fail(422, 'Período inválido (até 2 anos).');
    send(res, await insightsReport(db, c.storeId, { from, to }));
    return true;
}
