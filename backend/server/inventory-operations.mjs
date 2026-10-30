import { randomUUID } from 'node:crypto';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const money = v => Number.isSafeInteger(v) && v > 0 && v <= 10000000000;
const decode = r => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
const get = async (db, t, id, store) => (await db.prepare(`SELECT * FROM ${t} WHERE id=? AND store_id=?`).get(id, store));
const insert = async (db, t, id, store, data) => (await db.prepare(`INSERT INTO ${t} VALUES(?,?,?,1,?)`).run(id, store, JSON.stringify(data), new Date().toISOString()));
const update = async (db, t, id, store, data) => (await db.prepare(`UPDATE ${t} SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?`).run(JSON.stringify(data), new Date().toISOString(), id, store));
export async function installInventoryOperations(db) { (await db.exec(`CREATE TABLE IF NOT EXISTS consignments(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);CREATE INDEX IF NOT EXISTS consignments_store ON consignments(store_id);CREATE UNIQUE INDEX IF NOT EXISTS consignment_vehicle ON consignments(store_id,json_extract(data,'$.vehicleId')) WHERE json_extract(data,'$.status') IN ('active','sold');`)); }
export async function activeConsignment(db, store, vehicleId) { const r = (await db.prepare("SELECT * FROM consignments WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='active'").get(store, vehicleId)); return r ? decode(r) : null; }
export async function validateTrade(db, store, trade, outgoing) {
    if (trade == null)
        return null;
    if (!trade || typeof trade !== 'object' || !money(trade.amountCents) || !Number.isInteger(trade.vehicleRevision))
        fail(422, 'Informe o veículo e o valor aceito na troca.');
    if (trade.vehicleId === outgoing)
        fail(422, 'O veículo recebido deve ser diferente do veículo vendido.');
    const r = (await get(db, 'vehicles', text(trade.vehicleId), store));
    if (!r)
        fail(422, 'Veículo da troca não pertence a esta loja.');
    const vehicle = decode(r);
    if (vehicle.revision !== trade.vehicleRevision)
        fail(409, 'O veículo da troca foi alterado. Reabra a proposta para selecionar a revisão atual.');
    if (vehicle.status !== 'draft')
        fail(409, 'O veículo recebido na troca deve estar como rascunho até a conclusão da venda.');
    if ((await db.prepare("SELECT id FROM purchases WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='confirmed'").get(store, vehicle.id)) || (await db.prepare("SELECT id FROM consignments WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status') IN ('active','sold')").get(store, vehicle.id)) || (await db.prepare("SELECT id FROM deals WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='completed'").get(store, vehicle.id)))
        fail(409, 'O veículo da troca já tem aquisição, consignação ou venda. Cadastre uma nova entrada como rascunho.');
    return { vehicleId: vehicle.id, amountCents: trade.amountCents, vehicleRevision: vehicle.revision };
}
export async function validatePayout(db, store, vehicleId, amountCents, dueDate) { const consignment = (await activeConsignment(db, store, vehicleId)); if (consignment) {
    if (amountCents < consignment.payoutCents)
        fail(422, 'A venda não pode ser inferior ao repasse acordado nesta versão.');
    if (!validDate(dueDate))
        fail(422, 'Informe o vencimento do repasse ao proprietário.');
} return consignment; }
// Called only inside the sale transaction; all records roll back with the sale.
export async function settleInventoryOperations({ db, c, deal, customer, audit }) {
    const result = {}, consignment = (await validatePayout(db, c.storeId, deal.vehicleId, deal.amountCents, deal.payoutDueDate));
    if (consignment) {
        const owner = (await get(db, 'people', consignment.personId, c.storeId));
        if (!owner || !decode(owner).active)
            fail(422, 'Proprietário da consignação está inativo.');
        const ledgerId = randomUUID();
        (await insert(db, 'ledger', ledgerId, c.storeId, { direction: 'expense', description: `Repasse consignação ${consignment.vehicleLabel}`, amountCents: consignment.payoutCents, dueDate: deal.payoutDueDate, status: 'open', paidDate: '', vehicleId: deal.vehicleId, personId: consignment.personId, dealId: deal.id, consignmentId: consignment.id, source: 'consignment', notes: '' }));
        (await update(db, 'consignments', consignment.id, c.storeId, { ...consignment, status: 'sold', dealId: deal.id, payoutLedgerId: ledgerId, soldAt: new Date().toISOString() }));
        result.consignment = { id: consignment.id, personName: consignment.personName, payoutCents: consignment.payoutCents };
        (await audit(c, 'consignment.sale', consignment.id));
    }
    const trade = (await validateTrade(db, c.storeId, deal.tradeIn, deal.vehicleId));
    if (trade) {
        const r = (await get(db, 'vehicles', trade.vehicleId, c.storeId)), v = decode(r), purchaseId = randomUUID();
        (await insert(db, 'purchases', purchaseId, c.storeId, { vehicleId: v.id, personId: customer.id, personName: customer.name, vehicleLabel: [v.brand, v.model, v.version, v.year].join(' '), amountCents: trade.amountCents, purchaseDate: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), payments: [], notes: 'Aquisição vinculada à venda com troca.', status: 'confirmed', source: 'trade', tradeDealId: deal.id, createdAt: new Date().toISOString() }));
        (await update(db, 'vehicles', v.id, c.storeId, { ...JSON.parse(r.data), status: v.images.length ? 'available' : 'draft' }));
        result.tradeIn = { ...trade, vehicleLabel: [v.brand, v.model, v.version, v.year].join(' '), purchaseId };
        (await audit(c, 'trade.acquire', v.id));
    }
    return result;
}
export async function consignmentRoute({ req, res, route, c, db, body, send, admin, audit }) {
    if (!route.startsWith('/api/admin/consignments'))
        return false;
    (await admin());
    if (req.method === 'GET' && route === '/api/admin/consignments') {
        send(res, (await db.prepare('SELECT * FROM consignments WHERE store_id=? ORDER BY updated DESC').all(c.storeId)).map(decode));
        return true;
    }
    const v = await body(req);
    if (!v || typeof v !== 'object')
        fail(422, 'Dados inválidos.');
    const transaction = async (fn) => { (await db.exec('BEGIN IMMEDIATE')); try {
        (await fn());
        (await db.exec('COMMIT'));
    }
    catch (e) {
        (await db.exec('ROLLBACK'));
        throw e;
    } };
    if (req.method === 'POST' && route === '/api/admin/consignments') {
        if (!money(v.payoutCents) || !validDate(v.startDate) || v.startDate > new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))
            fail(422, 'Informe repasse positivo e data de entrada válida, sem data futura.');
        const id = randomUUID();
        (await transaction(async () => {
            const r = (await get(db, 'vehicles', text(v.vehicleId), c.storeId)), owner = (await get(db, 'people', text(v.personId), c.storeId));
            if (!r || decode(r).status === 'sold')
                fail(422, 'Selecione um veículo não vendido desta loja.');
            if (!owner || !decode(owner).active)
                fail(422, 'Selecione um proprietário ativo desta loja.');
            if ((await db.prepare("SELECT id FROM purchases WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='confirmed'").get(c.storeId, v.vehicleId)) || (await db.prepare("SELECT id FROM consignments WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status') IN ('active','sold')").get(c.storeId, v.vehicleId)) || (await db.prepare("SELECT id FROM deals WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='completed'").get(c.storeId, v.vehicleId)))
                fail(409, 'O veículo já possui aquisição, consignação ou venda registrada.');
            const car = decode(r), person = decode(owner);
            (await insert(db, 'consignments', id, c.storeId, { vehicleId: car.id, vehicleLabel: [car.brand, car.model, car.version, car.year].join(' '), personId: person.id, personName: person.name, payoutCents: v.payoutCents, startDate: v.startDate, notes: text(v.notes, 2000), status: 'active', createdAt: new Date().toISOString() }));
            (await audit(c, 'consignment.create', id));
        }));
        send(res, decode((await get(db, 'consignments', id, c.storeId))), 201);
        return true;
    }
    const returned = route.match(/^\/api\/admin\/consignments\/([a-zA-Z0-9-]+)\/return$/);
    if (returned && req.method === 'POST') {
        if (!text(v.reason, 1000))
            fail(422, 'Informe o motivo da devolução.');
        const id = returned[1];
        (await transaction(async () => {
            const r = (await get(db, 'consignments', id, c.storeId));
            if (!r)
                fail(404, 'Consignação não encontrada.');
            const consignment = decode(r), vehicle = (await get(db, 'vehicles', consignment.vehicleId, c.storeId));
            if (consignment.revision !== v.revision || consignment.status !== 'active' || !vehicle || decode(vehicle).status === 'sold')
                fail(409, 'Consignação alterada ou já encerrada.');
            if ((await db.prepare("SELECT id FROM deals WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='completed'").get(c.storeId, consignment.vehicleId)))
                fail(409, 'Veículo já vendido.');
            (await update(db, 'vehicles', consignment.vehicleId, c.storeId, { ...JSON.parse(vehicle.data), status: 'draft' }));
            (await update(db, 'consignments', id, c.storeId, { ...consignment, status: 'returned', returnReason: text(v.reason, 1000), returnedAt: new Date().toISOString() }));
            (await audit(c, 'consignment.return', id));
        }));
        send(res, decode((await get(db, 'consignments', id, c.storeId))));
        return true;
    }
    fail(405, 'Método não permitido.');
}
