import { vehicleCosts } from './purchases.mjs';

// Margem por venda e comissões de vendedores.
// Margem = valor da venda − custo do veículo (aquisição ou repasse de consignação + despesas) − comissão.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const decode = r => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const percent = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 50;
const round2 = v => Math.round(v * 100) / 100;

export const DEFAULT_RULE = { base: 'sale', percent: 0, sellers: {} };

export async function installPerformance(db) {
    (await db.exec('CREATE TABLE IF NOT EXISTS commission_rules(store_id TEXT PRIMARY KEY REFERENCES stores(id),data TEXT NOT NULL,updated TEXT NOT NULL)'));
}

export async function readRule(db, storeId) {
    const row = (await db.prepare('SELECT data FROM commission_rules WHERE store_id=?').get(storeId));
    return row ? { ...DEFAULT_RULE, ...JSON.parse(row.data) } : { ...DEFAULT_RULE };
}

/** Comissão de uma venda pela regra da loja. null quando a base é a margem e o custo não é conhecido. */
export function commissionFor(rule, { sellerId, saleCents, costCents }) {
    if (!sellerId) return 0;
    const pct = rule.sellers?.[sellerId] ?? rule.percent;
    if (rule.base === 'margin') {
        if (costCents === null) return null;
        return Math.max(0, Math.round(((saleCents - costCents) * pct) / 100));
    }
    return Math.round((saleCents * pct) / 100);
}

// Dia da venda no fuso da loja: uma venda às 22h de Natal não pode cair no dia seguinte (UTC).
const localDay = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); };

export async function performanceReport(db, storeId, { from, to, sellerId: onlySeller } = {}) {
    const rule = (await readRule(db, storeId));
    const users = new Map((await db.prepare('SELECT id,name FROM users WHERE store_id=?').all(storeId)).map(u => [u.id, u.name]));
    const costs = new Map((await vehicleCosts(db, storeId)).map(entry => [entry.vehicle.id, entry]));
    const deals = (await db.prepare('SELECT * FROM deals WHERE store_id=?').all(storeId)).map(decode)
        .filter(d => d.status === 'completed')
        .filter(d => { const day = localDay(d.closedAt || d.createdAt); return (!from || day >= from) && (!to || day <= to); })
        .filter(d => !onlySeller || d.sellerId === onlySeller)
        .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
    const sales = deals.map(d => {
        const cost = costs.get(d.vehicleId);
        const saleCents = d.amountCents, costCents = cost?.costCents ?? null;
        const commissionCents = commissionFor(rule, { sellerId: d.sellerId, saleCents, costCents });
        const marginCents = costCents === null || commissionCents === null ? null : saleCents - costCents - commissionCents;
        const v = cost?.vehicle;
        return {
            dealId: d.id,
            closedAt: d.closedAt || d.createdAt,
            vehicleId: d.vehicleId,
            vehicleLabel: d.vehicleLabel || (v ? `${v.brand} ${v.model} ${v.version} ${v.year}` : 'Veículo removido'),
            personName: d.personName || '',
            sellerId: d.sellerId || '',
            sellerName: d.sellerId ? (users.get(d.sellerId) || 'Usuário removido') : '',
            saleCents,
            acquisitionCents: cost?.baseCostCents ?? null,
            expenseCents: cost?.expenseCents ?? 0,
            costCents,
            commissionCents,
            marginCents,
            marginPct: marginCents === null ? null : round2((marginCents / saleCents) * 100),
        };
    });
    const bySeller = new Map();
    for (const s of sales) {
        const key = s.sellerId || '';
        const acc = bySeller.get(key) || { sellerId: key, sellerName: s.sellerName || 'Sem vendedor', sales: 0, saleCents: 0, commissionCents: 0, marginCents: 0, pendingCost: 0 };
        acc.sales++;
        acc.saleCents += s.saleCents;
        acc.commissionCents += s.commissionCents ?? 0;
        if (s.marginCents === null) acc.pendingCost++;
        else acc.marginCents += s.marginCents;
        bySeller.set(key, acc);
    }
    const known = sales.filter(s => s.marginCents !== null);
    const totals = {
        sales: sales.length,
        saleCents: sales.reduce((n, s) => n + s.saleCents, 0),
        commissionCents: sales.reduce((n, s) => n + (s.commissionCents ?? 0), 0),
        marginCents: known.reduce((n, s) => n + s.marginCents, 0),
        marginPct: known.length ? round2((known.reduce((n, s) => n + s.marginCents, 0) / known.reduce((n, s) => n + s.saleCents, 0)) * 100) : null,
        pendingCost: sales.length - known.length,
    };
    return { rule, sales, sellers: [...bySeller.values()].sort((a, b) => b.saleCents - a.saleCents), totals };
}

export async function performanceRoute({ req, res, route, c, db, body, send, admin, audit }) {
    if (route === '/api/admin/commission-rules' && req.method === 'GET') {
        send(res, (await readRule(db, c.storeId)));
        return true;
    }
    if (route === '/api/admin/commission-rules' && req.method === 'PUT') {
        (await admin());
        const v = (await body(req));
        if (!['sale', 'margin'].includes(v.base) || !percent(v.percent))
            fail(422, 'Informe a base (venda ou margem) e um percentual entre 0 e 50.');
        const sellers = {};
        if (v.sellers && typeof v.sellers === 'object') {
            const ids = new Set((await db.prepare("SELECT id FROM users WHERE store_id=? AND role IN ('admin','seller')").all(c.storeId)).map(u => u.id));
            for (const [id, pct] of Object.entries(v.sellers)) {
                if (pct === null || pct === '' || pct === undefined) continue;
                if (!ids.has(id) || !percent(pct)) fail(422, 'Percentual de vendedor inválido.');
                sellers[id] = round2(pct);
            }
        }
        const rule = { base: v.base, percent: round2(v.percent), sellers };
        (await db.prepare('INSERT INTO commission_rules(store_id,data,updated) VALUES(?,?,?) ON CONFLICT(store_id) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(c.storeId, JSON.stringify(rule), new Date().toISOString()));
        (await audit(c, 'commission.rules', c.storeId));
        send(res, rule);
        return true;
    }
    if (route === '/api/admin/performance' && req.method === 'GET') {
        const url = new URL(req.url, 'http://local');
        const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
        if ((from && !validDate(from)) || (to && !validDate(to)))
            fail(422, 'Período inválido.');
        // Vendedor vê só as próprias vendas e comissões
        send(res, (await performanceReport(db, c.storeId, { from, to, sellerId: c.user.role === 'seller' ? c.user.id : '' })));
        return true;
    }
    return false;
}
