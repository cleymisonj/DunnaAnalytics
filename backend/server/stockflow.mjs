import { randomUUID } from 'node:crypto';
import { vehicleCosts } from './purchases.mjs';

// Giro do estoque: preparação (recondicionamento) do veículo e idade do estoque com sugestão de preço.
// Os serviços concluídos viram despesas no financeiro ligadas ao veículo, então entram no custo e na margem.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const decode = (r) => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const DAY = 86400000;
const daysBetween = (fromIso, toIso = today()) => Math.max(0, Math.floor((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / DAY));

export const PREP_CATEGORIES = ['Mecânica', 'Funilaria e pintura', 'Polimento e estética', 'Higienização', 'Pneus', 'Elétrica', 'Vidros e faróis', 'Documentação e vistoria', 'Fotos e anúncio', 'Outros'];
export const PREP_TEMPLATE = [
    ['Mecânica', 'Revisão mecânica e troca de óleo'],
    ['Pneus', 'Conferir pneus e estepe'],
    ['Polimento e estética', 'Polimento e cristalização'],
    ['Higienização', 'Higienização interna'],
    ['Documentação e vistoria', 'Laudo cautelar / vistoria'],
    ['Fotos e anúncio', 'Fotos para o anúncio'],
];
const TASK_STATUS = ['todo', 'doing', 'done'];
export const DEFAULT_AGING = { alertDays: [30, 60, 90], monthlyRatePct: 1.5, dailyCostCents: 0, minMarginPct: 8 };
// Depois de baixar o preço, espera este prazo para ver o efeito antes de sugerir outra redução
export const PRICE_COOLDOWN_DAYS = 15;

export async function installStockflow(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS preparations(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);CREATE INDEX IF NOT EXISTS preparations_store ON preparations(store_id);');
    await db.exec('CREATE TABLE IF NOT EXISTS aging_settings(store_id TEXT PRIMARY KEY REFERENCES stores(id),data TEXT NOT NULL,updated TEXT NOT NULL);');
}

export async function readAgingSettings(db, storeId) {
    const row = await db.prepare('SELECT data FROM aging_settings WHERE store_id=?').get(storeId);
    return { ...DEFAULT_AGING, ...(row ? JSON.parse(row.data) : {}) };
}

/** Preço "de vitrine": múltiplo de R$ 500 menos R$ 10 (ex.: 81.490). */
const showroomPrice = (reais) => Math.max(10, Math.round(reais / 500) * 500 - 10);

/** Sugestão de preço pela idade do estoque, respeitando a margem mínima sobre o custo real. */
export function suggestPrice({ price, fipe, days, costCents, settings }) {
    const [a, b, c] = settings.alertDays;
    const cut = days >= c ? 0.06 : days >= b ? 0.04 : days >= a ? 0.02 : 0;
    if (!cut) return null;
    let target = price * (1 - cut);
    // Muito acima da FIPE e parado: aproxima da FIPE
    if (fipe && price > fipe * 1.05) target = Math.min(target, fipe * 1.03);
    target = showroomPrice(target);
    const floor = costCents === null ? null : Math.ceil((costCents / 100) * (1 + settings.minMarginPct / 100));
    // No piso, arredonda para cima: o preço sugerido nunca fica abaixo da margem mínima
    if (floor !== null && target < floor) target = Math.ceil((floor + 10) / 500) * 500 - 10;
    // Redução abaixo de 0,5% não compensa sugerir
    if (target > price * 0.995) return { price: null, cutPct: 0, floor, reason: `Parado há ${days} dias, mas o preço já está perto da margem mínima de ${settings.minMarginPct}%.` };
    const pct = Math.round(((price - target) / price) * 1000) / 10;
    return { price: target, cutPct: pct, floor, reason: `Parado há ${days} dias: reduzir ${pct.toLocaleString('pt-BR')}%${floor !== null ? ` (piso de margem: ${floor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })})` : ''}.` };
}

export async function agingReport(db, storeId) {
    const settings = await readAgingSettings(db, storeId);
    const costs = new Map((await vehicleCosts(db, storeId)).map((e) => [e.vehicle.id, e]));
    const preps = (await db.prepare('SELECT * FROM preparations WHERE store_id=?').all(storeId)).map(decode);
    const rows = (await db.prepare('SELECT * FROM vehicles WHERE store_id=?').all(storeId)).map(decode).filter((v) => v.status !== 'sold');
    const out = [];
    for (const v of rows) {
        const cost = costs.get(v.id);
        let entryDate = cost?.purchase?.purchaseDate || cost?.consignment?.startDate || v.listedAt || '';
        let entrySource = cost?.purchase ? 'purchase' : cost?.consignment ? 'consignment' : 'listed';
        if (!entryDate) {
            const first = await db.prepare("SELECT MIN(created) AS created FROM audit WHERE store_id=? AND entity_id=? AND action LIKE 'vehicle.%'").get(storeId, v.id);
            entryDate = first?.created || v.updatedAt;
            entrySource = 'estimated';
        }
        const days = daysBetween(entryDate);
        const costCents = cost?.costCents ?? null;
        const priceCents = Math.round(v.price * 100);
        const base = costCents ?? priceCents;
        const holdingCents = Math.round(base * (settings.monthlyRatePct / 100) * (days / 30)) + settings.dailyCostCents * days;
        const prep = preps.filter((p) => p.vehicleId === v.id).sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0];
        const [a, b, c] = settings.alertDays;
        const lastCut = [...(v.priceHistory || [])].reverse().find((h) => h.to < h.from);
        const sinceCut = lastCut ? daysBetween(lastCut.at) : null;
        let suggestion = v.status === 'available' ? suggestPrice({ price: v.price, fipe: v.fipe ?? null, days, costCents, settings }) : null;
        if (suggestion?.price && sinceCut !== null && sinceCut < PRICE_COOLDOWN_DAYS)
            suggestion = { price: null, cutPct: 0, floor: suggestion.floor, reason: `Preço reduzido há ${sinceCut} dia(s). Aguarde ${PRICE_COOLDOWN_DAYS - sinceCut} dia(s) para ver o efeito antes de outra redução.` };
        out.push({
            id: v.id, revision: v.revision, label: `${v.brand} ${v.model} ${v.version} ${v.year}`, image: v.images?.[0] || '', status: v.status,
            price: v.price, fipe: v.fipe ?? null, entryDate: entryDate.slice(0, 10), entrySource, days, band: days >= c ? 3 : days >= b ? 2 : days >= a ? 1 : 0,
            costCents, marginCents: costCents === null ? null : priceCents - costCents, marginPct: costCents === null ? null : Math.round(((priceCents - costCents) / priceCents) * 1000) / 10,
            holdingCents, preparation: prep ? { id: prep.id, status: prep.status, days: daysBetween(prep.startedAt, prep.readyAt || today()) } : null,
            priceHistory: (v.priceHistory || []).slice(-5),
            suggestion,
        });
    }
    out.sort((x, y) => y.days - x.days);
    const stocked = out.filter((v) => v.status !== 'draft');
    return {
        settings, vehicles: out,
        totals: { vehicles: stocked.length, avgDays: stocked.length ? Math.round(stocked.reduce((s, v) => s + v.days, 0) / stocked.length) : 0, stale: stocked.filter((v) => v.band >= 2).length, holdingCents: out.reduce((s, v) => s + v.holdingCents, 0), stockCents: stocked.reduce((s, v) => s + (v.costCents ?? Math.round(v.price * 100)), 0) },
    };
}

export async function stockflowRoute({ req, res, route, c, db, body, send, admin, audit }) {
    if (!route.startsWith('/api/admin/preparations') && !route.startsWith('/api/admin/stock-aging')) return false;
    await admin();
    const now = () => new Date().toISOString();
    const vehicleRow = async (id) => db.prepare('SELECT * FROM vehicles WHERE id=? AND store_id=?').get(id, c.storeId);

    // ---------- Idade do estoque ----------
    if (route === '/api/admin/stock-aging' && req.method === 'GET') { send(res, await agingReport(db, c.storeId)); return true; }
    if (route === '/api/admin/stock-aging/settings' && req.method === 'PUT') {
        const v = await body(req);
        const days = Array.isArray(v?.alertDays) ? v.alertDays.map(Number) : [];
        if (days.length !== 3 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 720) || !(days[0] < days[1] && days[1] < days[2])) fail(422, 'Informe três prazos de alerta crescentes, em dias.');
        const rate = Number(v.monthlyRatePct), daily = Number(v.dailyCostCents), margin = Number(v.minMarginPct);
        if (!Number.isFinite(rate) || rate < 0 || rate > 10) fail(422, 'Custo do capital deve ficar entre 0% e 10% ao mês.');
        if (!Number.isSafeInteger(daily) || daily < 0 || daily > 10000000) fail(422, 'Custo diário inválido.');
        if (!Number.isFinite(margin) || margin < 0 || margin > 50) fail(422, 'Margem mínima deve ficar entre 0% e 50%.');
        const settings = { alertDays: days, monthlyRatePct: Math.round(rate * 100) / 100, dailyCostCents: daily, minMarginPct: Math.round(margin * 100) / 100 };
        await db.prepare('INSERT INTO aging_settings VALUES(?,?,?) ON CONFLICT(store_id) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(c.storeId, JSON.stringify(settings), now());
        await audit(c, 'aging.settings', c.storeId);
        send(res, settings);
        return true;
    }
    // Data de entrada informada à mão (para carros sem compra ou consignação registrada)
    const em = route.match(/^\/api\/admin\/stock-aging\/([a-zA-Z0-9-]+)\/entry$/);
    if (em && req.method === 'POST') {
        const v = await body(req);
        const row = await vehicleRow(em[1]);
        if (!row) fail(404, 'Veículo não encontrado.');
        if (v?.revision !== row.revision) fail(409, 'Veículo alterado em outra sessão. Atualize o painel.');
        const date = text(v.date, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date > today() || date < '2000-01-01') fail(422, 'Informe uma data de entrada válida, que não seja futura.');
        const data = JSON.parse(row.data);
        await db.prepare('UPDATE vehicles SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify({ ...data, listedAt: date + 'T12:00:00.000Z' }), now(), row.id, c.storeId);
        await audit(c, 'vehicle.entry', row.id);
        send(res, { id: row.id, entryDate: date });
        return true;
    }
    const pm = route.match(/^\/api\/admin\/stock-aging\/([a-zA-Z0-9-]+)\/price$/);
    if (pm && req.method === 'POST') {
        const v = await body(req);
        const row = await vehicleRow(pm[1]);
        if (!row) fail(404, 'Veículo não encontrado.');
        if (v?.revision !== row.revision) fail(409, 'Veículo alterado em outra sessão. Atualize o painel.');
        const price = Number(v.price);
        if (!Number.isFinite(price) || price <= 0 || price > 1e8) fail(422, 'Preço inválido.');
        const data = JSON.parse(row.data);
        if (data.status === 'sold') fail(409, 'Veículo já vendido.');
        const next = { ...data, price, priceHistory: [...(data.priceHistory || []), { from: data.price, to: price, at: now(), by: c.user.name, reason: text(v.reason, 120) || 'Ajuste pela idade do estoque' }].slice(-50) };
        await db.prepare('UPDATE vehicles SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(next), now(), row.id, c.storeId);
        await audit(c, 'vehicle.price', row.id);
        send(res, { id: row.id, price });
        return true;
    }

    // ---------- Preparação ----------
    const list = async () => (await db.prepare('SELECT * FROM preparations WHERE store_id=? ORDER BY updated DESC,id').all(c.storeId)).map(decode);
    if (route === '/api/admin/preparations' && req.method === 'GET') { send(res, { preparations: await list(), categories: PREP_CATEGORIES }); return true; }
    if (route === '/api/admin/preparations' && req.method === 'POST') {
        const v = await body(req);
        const row = await vehicleRow(text(v?.vehicleId, 64));
        if (!row) fail(422, 'Selecione um veículo desta loja.');
        const vehicle = decode(row);
        if (vehicle.status === 'sold') fail(409, 'Veículo já vendido.');
        if ((await list()).some((p) => p.vehicleId === vehicle.id && p.status === 'in_progress')) fail(409, 'Este veículo já está em preparação.');
        const id = randomUUID();
        const tasks = v.template === false ? [] : PREP_TEMPLATE.map(([category, description]) => ({ id: randomUUID(), category, description, supplierId: '', costCents: 0, status: 'todo', doneAt: '', ledgerId: '' }));
        const prep = { vehicleId: vehicle.id, vehicleLabel: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`, status: 'in_progress', startedAt: now(), readyAt: '', tasks, notes: '' };
        await db.prepare('INSERT INTO preparations VALUES(?,?,?,1,?)').run(id, c.storeId, JSON.stringify(prep), now());
        await audit(c, 'preparation.create', id);
        send(res, decode(await db.prepare('SELECT * FROM preparations WHERE id=?').get(id)), 201);
        return true;
    }
    const m = route.match(/^\/api\/admin\/preparations\/([a-zA-Z0-9-]+)(?:\/(finish|reopen))?$/);
    if (!m) return false;
    const [, id, action] = m;
    const row = await db.prepare('SELECT * FROM preparations WHERE id=? AND store_id=?').get(id, c.storeId);
    if (!row) fail(404, 'Preparação não encontrada.');
    const prep = decode(row);
    const v = await body(req);
    if (v?.revision !== prep.revision) fail(409, 'Preparação alterada por outra sessão. Atualize o painel.');
    const ledgerRow = async (ledgerId) => { const r = ledgerId && await db.prepare('SELECT * FROM ledger WHERE id=? AND store_id=?').get(ledgerId, c.storeId); return r ? decode(r) : null; };
    const updateLedger = async (entry) => { const { id: lid, revision, updatedAt, ...data } = entry; await db.prepare('UPDATE ledger SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(data), now(), lid, c.storeId); };
    const save = async (data, event) => {
        const { id: _i, revision: _r, updatedAt: _u, ...rest } = data;
        await db.prepare('UPDATE preparations SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(rest), now(), id, c.storeId);
        await audit(c, event, id);
        send(res, decode(await db.prepare('SELECT * FROM preparations WHERE id=?').get(id)));
    };

    if (action === 'reopen' && req.method === 'POST') {
        if (prep.status !== 'ready') fail(409, 'A preparação já está em andamento.');
        await save({ ...prep, status: 'in_progress', readyAt: '' }, 'preparation.reopen');
        return true;
    }
    if (action === 'finish' && req.method === 'POST') {
        if (prep.status !== 'in_progress') fail(409, 'Preparação já concluída.');
        if (!prep.tasks.length || prep.tasks.some((t) => t.status !== 'done')) fail(422, 'Conclua ou remova os serviços pendentes antes de finalizar.');
        await db.exec('BEGIN IMMEDIATE');
        try {
            if (v.publish) {
                const vr = await vehicleRow(prep.vehicleId);
                const data = vr && JSON.parse(vr.data);
                if (!data) fail(404, 'Veículo não encontrado.');
                if (data.status === 'draft') {
                    if (!data.images?.length) fail(422, 'Adicione fotos ao veículo antes de publicar.');
                    await db.prepare('UPDATE vehicles SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify({ ...data, status: 'available' }), now(), vr.id, c.storeId);
                    await audit(c, 'vehicle.publish', vr.id);
                }
            }
            const { id: _i, revision: _r, updatedAt: _u, ...rest } = { ...prep, status: 'ready', readyAt: now() };
            await db.prepare('UPDATE preparations SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(rest), now(), id, c.storeId);
            await audit(c, 'preparation.finish', id);
            await db.exec('COMMIT');
        } catch (e) { await db.exec('ROLLBACK'); throw e; }
        send(res, decode(await db.prepare('SELECT * FROM preparations WHERE id=?').get(id)));
        return true;
    }
    if (action || req.method !== 'PUT') fail(405, 'Método não permitido.');
    if (prep.status !== 'in_progress') fail(409, 'Reabra a preparação para alterar os serviços.');
    if (!Array.isArray(v.tasks) || v.tasks.length > 40) fail(422, 'Informe até 40 serviços.');
    const suppliers = new Set((await db.prepare('SELECT * FROM people WHERE store_id=?').all(c.storeId)).map(decode).filter((p) => p.active).map((p) => p.id));
    const old = new Map(prep.tasks.map((t) => [t.id, t]));
    const tasks = v.tasks.map((t) => {
        const description = text(t?.description, 160), costCents = t?.costCents === '' || t?.costCents == null ? 0 : t.costCents;
        if (!description) fail(422, 'Descreva cada serviço.');
        if (!PREP_CATEGORIES.includes(t.category) || !TASK_STATUS.includes(t.status)) fail(422, 'Categoria ou situação do serviço inválida.');
        if (!Number.isSafeInteger(costCents) || costCents < 0 || costCents > 100000000) fail(422, 'Custo do serviço inválido.');
        const supplierId = text(t.supplierId, 64);
        if (supplierId && !suppliers.has(supplierId)) fail(422, 'Fornecedor não encontrado nesta loja.');
        const before = old.get(t.id);
        return { id: before ? t.id : randomUUID(), category: t.category, description, supplierId, costCents, status: t.status, doneAt: t.status === 'done' ? before?.doneAt || now() : '', ledgerId: before?.ledgerId || '' };
    });
    const vehicle = decode(await vehicleRow(prep.vehicleId));
    await db.exec('BEGIN IMMEDIATE');
    try {
        // Remove/cancela lançamentos de serviços excluídos ou reabertos; cria/atualiza os concluídos com custo
        const keep = new Set(tasks.map((t) => t.id));
        const release = async (ledgerId) => {
            const entry = await ledgerRow(ledgerId);
            if (!entry || entry.status === 'void') return;
            if (entry.status === 'paid') fail(409, `O lançamento "${entry.description}" já foi pago. Estorne no financeiro antes de alterar o serviço.`);
            await updateLedger({ ...entry, status: 'void', cancelReason: 'Serviço de preparação alterado' });
        };
        for (const t of prep.tasks) if (!keep.has(t.id) && t.ledgerId) await release(t.ledgerId);
        for (const t of tasks) {
            const description = `Preparação ${vehicle.brand} ${vehicle.model}: ${t.description}`;
            if (t.status === 'done' && t.costCents > 0) {
                const entry = await ledgerRow(t.ledgerId);
                if (entry && entry.status !== 'void') {
                    if (entry.amountCents !== t.costCents || entry.personId !== t.supplierId || entry.description !== description) {
                        if (entry.status === 'paid') fail(409, `O lançamento "${entry.description}" já foi pago. Estorne no financeiro antes de alterar o valor.`);
                        await updateLedger({ ...entry, amountCents: t.costCents, personId: t.supplierId, description });
                    }
                } else {
                    t.ledgerId = randomUUID();
                    await db.prepare('INSERT INTO ledger VALUES(?,?,?,1,?)').run(t.ledgerId, c.storeId, JSON.stringify({ direction: 'expense', description, amountCents: t.costCents, dueDate: today(), status: 'open', paidDate: '', vehicleId: prep.vehicleId, personId: t.supplierId, dealId: '', preparationId: id, source: 'preparation', notes: t.category }), now());
                }
            } else if (t.ledgerId) {
                await release(t.ledgerId);
                t.ledgerId = '';
            }
        }
        const { id: _i, revision: _r, updatedAt: _u, ...rest } = { ...prep, tasks, notes: text(v.notes, 2000) };
        await db.prepare('UPDATE preparations SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(rest), now(), id, c.storeId);
        await audit(c, 'preparation.update', id);
        await db.exec('COMMIT');
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
    send(res, decode(await db.prepare('SELECT * FROM preparations WHERE id=?').get(id)));
    return true;
}
