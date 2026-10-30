import { validateTrade, validatePayout, settleInventoryOperations } from './inventory-operations.mjs';
import { randomUUID } from 'node:crypto';
import { validDocument } from './contracts.mjs';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const money = v => Number.isSafeInteger(v) && v > 0 && v <= 10000000000;
const decode = r => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
export async function installCommercial(db) { for (const table of ['people', 'deals', 'ledger'])
    (await db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);CREATE INDEX IF NOT EXISTS ${table}_store ON ${table}(store_id);`)); }
export async function commercialRoute({ req, res, route, c, db, body, send, admin, audit }) {
    const match = route.match(/^\/api\/admin\/(people|deals|ledger)(?:\/([a-zA-Z0-9-]+)(?:\/(complete|payment))?)?$/);
    if (!match)
        return false;
    (await admin());
    const [, table, id, action] = match;
    const row = async (t, key) => (await db.prepare(`SELECT * FROM ${t} WHERE id=? AND store_id=?`).get(key, c.storeId));
    const list = async (t) => (await db.prepare(`SELECT * FROM ${t} WHERE store_id=? ORDER BY updated DESC,id`).all(c.storeId)).map(decode);
    const insert = async (t, key, data) => (await db.prepare(`INSERT INTO ${t} VALUES(?,?,?,1,?)`).run(key, c.storeId, JSON.stringify(data), new Date().toISOString()));
    const update = async (t, key, data) => (await db.prepare(`UPDATE ${t} SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?`).run(JSON.stringify(data), new Date().toISOString(), key, c.storeId));
    const transaction = async (fn) => { (await db.exec('BEGIN IMMEDIATE')); try {
        const result = (await fn());
        (await db.exec('COMMIT'));
        return result;
    }
    catch (e) {
        (await db.exec('ROLLBACK'));
        throw e;
    } };
    const current = async (t, key, rev) => { const r = (await row(t, key)); if (!r)
        fail(404, 'Cadastro não encontrado nesta loja.'); if (r.revision !== rev)
        fail(409, 'Cadastro alterado por outra sessão. Recarregue para continuar.'); return decode(r); };
    if (req.method === 'GET' && !id) {
        send(res, (await list(table)));
        return true;
    }
    if (!['POST', 'PUT', 'PATCH'].includes(req.method))
        fail(405, 'Método não permitido.');
    const v = await body(req);
    if (!v || typeof v !== 'object')
        fail(422, 'Dados inválidos.');
    if (table === 'people' && !action && ((!id && req.method === 'POST') || (id && req.method === 'PUT'))) {
        if (!text(v.name) || !['customer', 'supplier', 'partner'].includes(v.kind) || typeof v.active !== 'boolean')
            fail(422, 'Informe nome, categoria e situação.');
        const phone = text(v.phone, 30).replace(/\D/g, ''), email = text(v.email, 200).toLowerCase();
        if (phone && !/^\d{10,13}$/.test(phone))
            fail(422, 'Telefone inválido. Informe o DDD.');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            fail(422, 'E-mail inválido.');
        // Qualificação usada nos contratos (opcional no cadastro, exigida para assinar)
        const document = text(v.document, 30).replace(/\D/g, ''), zip = text(v.zip, 12).replace(/\D/g, '');
        if (document && !validDocument(document))
            fail(422, 'CPF ou CNPJ inválido.');
        if (zip && zip.length !== 8)
            fail(422, 'CEP deve ter 8 dígitos.');
        const key = id || randomUUID(), data = { name: text(v.name), kind: v.kind, phone, email, city: text(v.city), notes: text(v.notes, 2000), active: v.active, document, rg: text(v.rg, 30), nationality: text(v.nationality, 40), maritalStatus: text(v.maritalStatus, 40), profession: text(v.profession, 80), address: text(v.address, 240), zip };
        (await transaction(async () => { if (id) {
            (await current(table, id, v.revision));
            (await update(table, id, data));
        }
        else
            (await insert(table, key, data)); (await audit(c, id ? 'person.update' : 'person.create', key)); }));
        send(res, decode((await row(table, key))), id ? 200 : 201);
        return true;
    }
    if (table === 'deals' && !action && ((!id && req.method === 'POST') || (id && req.method === 'PUT'))) {
        if (!['draft', 'proposal', 'cancelled'].includes(v.status) || !money(v.amountCents))
            fail(422, 'Informe valor válido e etapa da proposta.');
        if (!(await row('vehicles', text(v.vehicleId))))
            fail(422, 'Selecione um veículo desta loja.');
        const person = (await row('people', text(v.personId)));
        if (!person || !decode(person).active)
            fail(422, 'Selecione uma pessoa ativa desta loja.');
        const tradeIn = (await validateTrade(db, c.storeId, v.tradeIn, text(v.vehicleId)));
        if (tradeIn && tradeIn.amountCents > v.amountCents)
            fail(422, 'O valor da troca não pode superar o valor da venda nesta versão.');
        (await validatePayout(db, c.storeId, text(v.vehicleId), v.amountCents, v.payoutDueDate));
        if (!Array.isArray(v.payments) || (!v.payments.length && !tradeIn) || v.payments.length > 60 || v.payments.some(p => !p || typeof p !== 'object' || !date(p.dueDate) || !money(p.amountCents)))
            fail(422, 'Informe de 1 a 60 recebimentos, com vencimentos e valores válidos.');
        if (v.payments.reduce((s, p) => s + p.amountCents, 0) + (tradeIn?.amountCents || 0) !== v.amountCents)
            fail(422, 'A soma dos recebimentos e do veículo na troca deve ser igual ao valor da venda.');
        // Vendedor da negociação (base das comissões): usuário ativo desta loja, opcional
        const sellerId = text(v.sellerId, 64);
        if (sellerId && !(await db.prepare("SELECT id FROM users WHERE id=? AND store_id=? AND active=1 AND role IN ('admin','seller')").get(sellerId, c.storeId)))
            fail(422, 'Vendedor não pertence a esta loja.');
        const key = id || randomUUID(), data = { vehicleId: text(v.vehicleId), personId: text(v.personId), sellerId, status: v.status, amountCents: v.amountCents, tradeIn, payoutDueDate: text(v.payoutDueDate, 10), payments: v.payments.map(p => ({ dueDate: p.dueDate, amountCents: p.amountCents })), notes: text(v.notes, 3000), createdAt: new Date().toISOString() };
        (await transaction(async () => { if (id) {
            const old = (await current(table, id, v.revision));
            if (['completed', 'cancelled'].includes(old.status))
                fail(409, 'Negociação encerrada não pode ser alterada.');
            data.createdAt = old.createdAt;
            (await update(table, id, data));
        }
        else
            (await insert(table, key, data)); (await audit(c, id ? 'deal.update' : 'deal.create', key)); }));
        send(res, decode((await row(table, key))), id ? 200 : 201);
        return true;
    }
    if (table === 'deals' && id && action === 'complete' && req.method === 'POST') {
        (await transaction(async () => {
            const deal = (await current(table, id, v.revision));
            if (!['draft', 'proposal'].includes(deal.status))
                fail(409, 'Esta negociação já foi encerrada.');
            if ((await db.prepare("SELECT id FROM deals WHERE store_id=? AND json_extract(data,'$.vehicleId')=? AND json_extract(data,'$.status')='completed' LIMIT 1").get(c.storeId, deal.vehicleId)))
                fail(409, 'Este registro de veículo já possui uma venda concluída. Uma nova entrada do veículo precisa de um cadastro próprio no estoque.');
            const person = (await row('people', deal.personId));
            if (!person || !decode(person).active)
                fail(422, 'Cliente inativo. Atualize a proposta.');
            const vehicleRow = (await row('vehicles', deal.vehicleId));
            if (!vehicleRow)
                fail(404, 'Veículo não encontrado.');
            const vehicle = decode(vehicleRow);
            if (!['available', 'reserved'].includes(vehicle.status))
                fail(409, 'O veículo precisa estar disponível ou reservado para concluir a venda.');
            (await update('vehicles', deal.vehicleId, { ...JSON.parse(vehicleRow.data), status: 'sold' }));
            const customer = decode(person);
            const inventoryResult = (await settleInventoryOperations({ db, c, deal, customer, audit }));
            await Promise.all(deal.payments.map(async (p, i) => (await insert('ledger', randomUUID(), { direction: 'income', description: `Venda ${vehicle.brand} ${vehicle.model} · ${i + 1}/${deal.payments.length}`, amountCents: p.amountCents, dueDate: p.dueDate, status: 'open', paidDate: '', vehicleId: deal.vehicleId, personId: deal.personId, dealId: id, customerName: customer.name, source: 'sale', notes: '' }))));
            (await update(table, id, { ...deal, ...inventoryResult, status: 'completed', personName: customer.name, vehicleLabel: [vehicle.brand, vehicle.model, vehicle.version, vehicle.year].join(' '), closedAt: new Date().toISOString() }));
            (await audit(c, 'deal.complete', id));
        }));
        send(res, decode((await row(table, id))));
        return true;
    }
    if (table === 'ledger' && !id && req.method === 'POST') {
        if (!['income', 'expense'].includes(v.direction) || !text(v.description) || !money(v.amountCents) || !date(v.dueDate))
            fail(422, 'Informe descrição, tipo, valor e vencimento válidos.');
        const vehicleId = text(v.vehicleId);
        if (vehicleId && !(await row('vehicles', vehicleId)))
            fail(422, 'Veículo não pertence a esta loja.');
        const key = randomUUID();
        (await insert(table, key, { direction: v.direction, description: text(v.description), amountCents: v.amountCents, dueDate: v.dueDate, status: 'open', paidDate: '', vehicleId, personId: '', dealId: '', source: 'manual', notes: text(v.notes, 2000) }));
        (await audit(c, 'ledger.create', key));
        send(res, decode((await row(table, key))), 201);
        return true;
    }
    if (table === 'ledger' && id && action === 'payment' && req.method === 'PATCH') {
        if (!['open', 'paid'].includes(v.status) || v.status === 'paid' && !date(v.paidDate))
            fail(422, 'Informe situação e data do pagamento válidas.');
        (await transaction(async () => { const old = (await current(table, id, v.revision)); if (old.status === 'void')
            fail(409, 'Lançamento cancelado não pode receber baixa ou ser reaberto.'); (await update(table, id, { ...old, status: v.status, paidDate: v.status === 'paid' ? v.paidDate : '', payments: v.status === 'paid' ? (old.payments || []) : [] })); (await audit(c, v.status === 'paid' ? 'ledger.paid' : 'ledger.reopen', id)); }));
        send(res, decode((await row(table, id))));
        return true;
    }
    fail(405, 'Método não permitido.');
}
