import { randomUUID } from 'node:crypto';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const money = v => Number.isSafeInteger(v) && v > 0 && v <= 10000000000;
const decode = r => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
export async function installPurchases(db) {
    (await db.exec(`CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS purchases_store ON purchases(store_id);
 CREATE UNIQUE INDEX IF NOT EXISTS purchases_active_vehicle ON purchases(store_id,json_extract(data,'$.vehicleId')) WHERE json_extract(data,'$.status')='confirmed';`));
}
export async function vehicleCosts(db, storeId) {
    const list = async (t) => (await db.prepare(`SELECT * FROM ${t} WHERE store_id=?`).all(storeId)).map(decode);
    const purchases = (await list('purchases')), ledger = (await list('ledger')), deals = (await list('deals')), consignments = (await list('consignments'));
    return (await list('vehicles')).map(v => {
        const purchase = purchases.find(p => p.vehicleId === v.id && p.status === 'confirmed') || null;
        const consignment = consignments.find(p => p.vehicleId === v.id && ['active', 'sold'].includes(p.status)) || null;
        const expenses = ledger.filter(e => e.vehicleId === v.id && e.direction === 'expense' && e.source !== 'purchase' && e.source !== 'consignment' && e.status !== 'void');
        const expenseCents = expenses.reduce((sum, e) => sum + e.amountCents, 0), acquisitionCents = purchase?.amountCents ?? null;
        const baseCostCents = acquisitionCents ?? consignment?.payoutCents ?? null, costCents = baseCostCents === null ? null : baseCostCents + expenseCents;
        const sale = deals.find(d => d.vehicleId === v.id && d.status === 'completed');
        const referenceCents = sale?.amountCents ?? Math.round(v.price * 100);
        return { vehicle: { id: v.id, brand: v.brand, model: v.model, version: v.version, year: v.year, status: v.status, price: v.price, image: v.images[0] || '' }, purchase, consignment, baseCostCents, expenses, expenseCents, acquisitionCents, costCents, referenceCents, referenceType: sale ? 'sale' : 'asking', differenceCents: costCents === null ? null : referenceCents - costCents, daysSincePurchase: purchase ? Math.max(0, Math.floor((Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })) - Date.parse(purchase.purchaseDate)) / 86400000)) : null };
    });
}
export async function purchaseRoute({ req, res, route, c, db, body, send, admin, audit }) {
    if (route !== '/api/admin/costs' && !route.startsWith('/api/admin/purchases'))
        return false;
    (await admin());
    const row = async (t, id) => (await db.prepare(`SELECT * FROM ${t} WHERE id=? AND store_id=?`).get(id, c.storeId));
    const insert = async (t, id, data) => (await db.prepare(`INSERT INTO ${t} VALUES(?,?,?,1,?)`).run(id, c.storeId, JSON.stringify(data), new Date().toISOString()));
    const update = async (t, id, data) => (await db.prepare(`UPDATE ${t} SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?`).run(JSON.stringify(data), new Date().toISOString(), id, c.storeId));
    const transaction = async (fn) => { (await db.exec('BEGIN IMMEDIATE')); try {
        (await fn());
        (await db.exec('COMMIT'));
    }
    catch (e) {
        (await db.exec('ROLLBACK'));
        throw e;
    } };
    if (route === '/api/admin/costs') {
        if (req.method !== 'GET')
            fail(405, 'Método não permitido.');
        send(res, (await vehicleCosts(db, c.storeId)));
        return true;
    }
    if (route === '/api/admin/purchases' && req.method === 'GET') {
        send(res, (await db.prepare('SELECT * FROM purchases WHERE store_id=? ORDER BY updated DESC').all(c.storeId)).map(decode));
        return true;
    }
    if (route === '/api/admin/purchases' && req.method === 'POST') {
        const v = await body(req);
        if (!v || !money(v.amountCents) || !validDate(v.purchaseDate))
            fail(422, 'Informe valor de compra e data válidos.');
        if (v.purchaseDate > new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))
            fail(422, 'A data de compra não pode estar no futuro.');
        if (!Array.isArray(v.payments) || !v.payments.length || v.payments.length > 60 || v.payments.some(p => !p || !money(p.amountCents) || !validDate(p.dueDate)))
            fail(422, 'Informe os pagamentos com valores e vencimentos válidos.');
        if (v.payments.reduce((sum, p) => sum + p.amountCents, 0) !== v.amountCents)
            fail(422, 'A soma dos pagamentos precisa ser igual ao valor da compra.');
        const id = randomUUID();
        (await transaction(async () => {
            const vehicleRow = (await row('vehicles', text(v.vehicleId)));
            if (!vehicleRow)
                fail(422, 'Selecione um veículo desta loja.');
            const vehicle = decode(vehicleRow);
            if (vehicle.status === 'sold' || (await db.prepare("SELECT id FROM deals WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='completed'").get(c.storeId, vehicle.id)))
                fail(409, 'Este veículo já possui venda. Registre uma nova entrada no estoque para uma recompra.');
            if ((await db.prepare("SELECT id FROM purchases WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='confirmed'").get(c.storeId, vehicle.id)))
                fail(409, 'Este veículo já possui uma compra registrada.');
            if ((await db.prepare("SELECT id FROM consignments WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status') IN ('active','sold')").get(c.storeId, vehicle.id)))
                fail(409, 'O veículo possui consignação registrada. Encerre a consignação antes de registrar uma compra.');
            const personRow = (await row('people', text(v.personId)));
            if (!personRow || !decode(personRow).active)
                fail(422, 'Selecione um fornecedor ou proprietário ativo desta loja.');
            const person = decode(personRow), data = { vehicleId: vehicle.id, personId: person.id, personName: person.name, vehicleLabel: [vehicle.brand, vehicle.model, vehicle.version, vehicle.year].join(' '), amountCents: v.amountCents, purchaseDate: v.purchaseDate, payments: v.payments.map(p => ({ amountCents: p.amountCents, dueDate: p.dueDate })), notes: text(v.notes, 2000), status: 'confirmed', createdAt: new Date().toISOString() };
            (await insert('purchases', id, data));
            await Promise.all(data.payments.map(async (p, i) => (await insert('ledger', randomUUID(), { direction: 'expense', description: `Compra ${vehicle.brand} ${vehicle.model} · ${i + 1}/${data.payments.length}`, amountCents: p.amountCents, dueDate: p.dueDate, status: 'open', paidDate: '', vehicleId: vehicle.id, personId: person.id, dealId: '', purchaseId: id, source: 'purchase', notes: '' }))));
            (await audit(c, 'purchase.create', id));
        }));
        send(res, decode((await row('purchases', id))), 201);
        return true;
    }
    const cancel = route.match(/^\/api\/admin\/purchases\/([a-zA-Z0-9-]+)\/cancel$/);
    if (cancel && req.method === 'POST') {
        const v = await body(req), id = cancel[1];
        if (!v || !text(v.reason, 1000))
            fail(422, 'Informe o motivo do cancelamento.');
        (await transaction(async () => {
            const r = (await row('purchases', id));
            if (!r)
                fail(404, 'Compra não encontrada nesta loja.');
            const p = decode(r);
            if (p.source === 'trade')
                fail(409, 'Aquisição vinculada a uma venda com troca não pode ser cancelada separadamente.');
            if (p.revision !== v.revision || p.status !== 'confirmed')
                fail(409, 'Compra alterada ou cancelada. Recarregue a lista.');
            const vehicle = (await row('vehicles', p.vehicleId));
            if (!vehicle || decode(vehicle).status === 'sold' || (await db.prepare("SELECT id FROM deals WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='completed'").get(c.storeId, p.vehicleId)))
                fail(409, 'Não é possível cancelar a compra de um veículo vendido.');
            const entries = (await db.prepare("SELECT * FROM ledger WHERE store_id=? AND json_extract(data,'$.purchaseId')=?").all(c.storeId, id)).map(decode);
            if (entries.length !== p.payments.length || entries.some(e => e.status !== 'open'))
                fail(409, 'A compra possui pagamento baixado ou lançamento alterado. Reabra as contas antes de cancelar.');
            for (const entry of entries)
                (await update('ledger', entry.id, { ...entry, status: 'void', cancelReason: text(v.reason, 1000) }));
            (await update('purchases', id, { ...p, status: 'cancelled', cancelReason: text(v.reason, 1000), cancelledAt: new Date().toISOString() }));
            (await audit(c, 'purchase.cancel', id));
        }));
        send(res, decode((await row('purchases', id))));
        return true;
    }
    fail(405, 'Método não permitido.');
}
