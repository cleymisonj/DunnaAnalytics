import { randomUUID } from 'node:crypto';

// Jurídico: contratos gerados a partir das negociações e compras, com checklist de documentos.
// Os textos são modelos para a loja revisar com seu advogado; o documento assinado fica congelado.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const decode = (r) => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBr = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '___/___/______');
const blank = (v, size = 24) => (v ? String(v) : '_'.repeat(size));
const digits = (v) => String(v || '').replace(/\D/g, '');
const formatPhone = (v) => { const d = digits(v); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : v; };

export const CONTRACT_TYPES = {
    sale: { label: 'Contrato de compra e venda (venda ao cliente)', source: 'deal' },
    delivery: { label: 'Termo de entrega e responsabilidade', source: 'deal' },
    purchase: { label: 'Contrato de compra de veículo (entrada no estoque)', source: 'purchase' },
};
export const CONTRACT_STATUS = ['draft', 'sent', 'signed', 'cancelled'];

/** Documentos de cada processo. `required` entra no indicador de pendências. */
export const CHECKLISTS = {
    purchase: [
        ['crlv', 'CRLV-e do veículo', true],
        ['atpv', 'ATPV-e (autorização de transferência) assinado pelo vendedor', true],
        ['seller-id', 'Documento com foto e CPF/CNPJ do vendedor', true],
        ['seller-address', 'Comprovante de endereço do vendedor', false],
        ['debts', 'Consulta de débitos: IPVA, licenciamento e multas', true],
        ['restrictions', 'Consulta de restrições: gravame, roubo/furto e RENAJUD', true],
        ['inspection', 'Laudo cautelar / vistoria', true],
        ['payoff', 'Quitação do financiamento (se houver)', false],
        ['keys', 'Chave reserva e manual', false],
        ['contract', 'Contrato de compra assinado', true],
    ],
    sale: [
        ['buyer-id', 'Documento com foto e CPF/CNPJ do comprador', true],
        ['buyer-address', 'Comprovante de endereço do comprador', true],
        ['contract', 'Contrato de compra e venda assinado', true],
        ['payment', 'Comprovante de pagamento ou aprovação do financiamento', true],
        ['atpv', 'ATPV-e preenchido em nome do comprador (ou entrada no RENAVE)', true],
        ['inspection', 'Laudo cautelar entregue ao comprador', false],
        ['delivery', 'Termo de entrega assinado', true],
        ['transfer', 'Comprovante de transferência / comunicação de venda', true],
    ],
};
const ITEM_STATUS = ['pending', 'received', 'na'];

export function validDocument(value) {
    const d = digits(value);
    if (d.length === 11) {
        if (/^(\d)\1+$/.test(d)) return false;
        const check = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
        return check(9) === Number(d[9]) && check(10) === Number(d[10]);
    }
    if (d.length === 14) {
        if (/^(\d)\1+$/.test(d)) return false;
        const check = (n) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = w.reduce((t, x, i) => t + Number(d[i]) * x, 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
        return check(12) === Number(d[12]) && check(13) === Number(d[13]);
    }
    return false;
}
export const formatDocument = (value) => {
    const d = digits(value);
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return value || '';
};

export async function installContracts(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS contracts(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);CREATE INDEX IF NOT EXISTS contracts_store ON contracts(store_id);');
    await db.exec('CREATE TABLE IF NOT EXISTS store_legal(store_id TEXT PRIMARY KEY REFERENCES stores(id),data TEXT NOT NULL,updated TEXT NOT NULL);');
}

export async function readLegal(db, storeId) {
    const row = await db.prepare('SELECT data FROM store_legal WHERE store_id=?').get(storeId);
    return { legalName: '', document: '', address: '', cityUf: '', representative: '', representativeDocument: '', warrantyMonths: 3, warrantyScope: 'motor e câmbio', forum: '', ...(row ? JSON.parse(row.data) : {}) };
}

const personParty = (p) => {
    const doc = p?.document ? `${digits(p.document).length === 14 ? 'CNPJ' : 'CPF'} nº ${formatDocument(p.document)}` : 'CPF nº ______________';
    const extra = [p?.nationality, p?.maritalStatus, p?.profession].filter(Boolean).join(', ');
    return `${blank(p?.name?.toUpperCase(), 30)}${extra ? `, ${extra}` : ''}, ${doc}${p?.rg ? `, RG nº ${p.rg}` : ''}, residente e domiciliado(a) em ${blank(p?.address, 40)}${p?.city ? `, ${p.city}` : ''}${p?.zip ? `, CEP ${digits(p.zip).replace(/(\d{5})(\d{3})/, '$1-$2')}` : ''}${p?.phone ? `, telefone ${formatPhone(p.phone)}` : ''}`;
};
const storeParty = (store, legal) =>
    `${(legal.legalName || store.name).toUpperCase()}${legal.legalName && legal.legalName !== store.name ? ` (nome fantasia ${store.name})` : ''}, inscrita no CNPJ sob o nº ${blank(formatDocument(legal.document), 18)}, com sede em ${blank(legal.address, 40)}, ${legal.cityUf || store.city}, neste ato representada por ${blank(legal.representative, 30)}${legal.representativeDocument ? `, CPF nº ${formatDocument(legal.representativeDocument)}` : ''}`;
const vehicleText = (v) =>
    `marca/modelo ${v.brand} ${v.model} ${v.version || ''}`.trim() + `, ano de fabricação/modelo ${v.yearMade || v.year}/${v.year}, cor ${blank(v.color, 10)}, combustível ${v.fuel || '______'}, placa ${blank(v.plate, 8)}, RENAVAM ${blank(v.renavam, 11)}, chassi ${blank(v.chassis, 17)}, com ${Number(v.mileage || 0).toLocaleString('pt-BR')} km aproximados no hodômetro`;
const paymentLines = (payments = []) => payments.map((p, i) => `${i + 1}) ${brl(p.amountCents)} com vencimento em ${dateBr(p.dueDate)}`);

/** Monta o documento a partir dos dados atuais. Retorna { title, sections: [{ heading, paragraphs }] }. */
export function buildDocument({ contract, store, legal, vehicle, person, deal, purchase, tradeVehicle }) {
    const place = legal.cityUf || store.city;
    // Venda ao consumidor: foro do domicílio do comprador (CDC, art. 101, I). Na compra, o foro escolhido pela loja.
    const forum = contract.type === 'purchase' ? legal.forum || place : 'do domicílio do COMPRADOR';
    const signatures = (a, b) => ({ heading: '', paragraphs: [`${place}, ${dateBr(contract.signedAt || new Date().toISOString())}.`, `______________________________\n${a}`, `______________________________\n${b}`, 'Testemunhas:\n1) ____________________ CPF: ____________\n2) ____________________ CPF: ____________'] });
    const extra = contract.extraClauses ? [{ heading: 'Cláusulas adicionais', paragraphs: contract.extraClauses.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean) }] : [];
    if (contract.type === 'sale') {
        const trade = deal.tradeIn;
        const paid = deal.payments || [];
        return {
            title: 'Contrato particular de compra e venda de veículo usado',
            sections: [
                { heading: 'Partes', paragraphs: [`VENDEDORA: ${storeParty(store, legal)}.`, `COMPRADOR(A): ${personParty(person)}.`, 'As partes têm entre si justo e contratado o seguinte:'] },
                { heading: 'Cláusula 1ª – Do objeto', paragraphs: [`A VENDEDORA vende ao COMPRADOR o veículo ${vehicleText(vehicle)}, no estado em que se encontra, que o COMPRADOR declara ter vistoriado e testado.`] },
                { heading: 'Cláusula 2ª – Do preço e da forma de pagamento', paragraphs: [`O preço total é de ${brl(deal.amountCents)}, pago da seguinte forma:`, ...(trade ? [`Veículo dado na troca: ${tradeVehicle ? vehicleText(tradeVehicle) : '______________'}, avaliado em ${brl(trade.amountCents)}, que o COMPRADOR declara livre de ônus, débitos e restrições, respondendo por eles até a data da entrega.`] : []), ...paymentLines(paid), 'Parcelas pagas por financiamento seguem o contrato próprio firmado entre o COMPRADOR e a instituição financeira.'] },
                { heading: 'Cláusula 3ª – Da entrega e da transferência', paragraphs: ['A posse do veículo é transferida na data e hora registradas no Termo de Entrega, a partir de quando o COMPRADOR responde por multas, infrações, tributos e danos relativos ao uso do veículo.', 'O COMPRADOR deve providenciar a transferência de propriedade no prazo de 30 (trinta) dias a contar da emissão da ATPV-e (art. 123, § 1º, do Código de Trânsito Brasileiro). A VENDEDORA fará a comunicação de venda ao órgão de trânsito.', 'Débitos de IPVA, licenciamento e multas com fato gerador anterior à entrega são de responsabilidade da VENDEDORA.'] },
                { heading: 'Cláusula 4ª – Da garantia', paragraphs: ['A VENDEDORA presta a garantia legal de 90 (noventa) dias para vícios do produto, nos termos do art. 26, II, do Código de Defesa do Consumidor.', ...(legal.warrantyMonths ? [`Além da garantia legal, a VENDEDORA concede garantia contratual de ${legal.warrantyMonths} (${legal.warrantyMonths === 1 ? 'um' : legal.warrantyMonths}) mês(es) para ${legal.warrantyScope || 'motor e câmbio'}, contada da entrega, excluídos desgaste natural, mau uso e itens de manutenção periódica.`] : []), 'Perdem a garantia contratual os reparos feitos fora da rede indicada pela VENDEDORA sem autorização prévia, salvo em caso de urgência comprovada.'] },
                { heading: 'Cláusula 5ª – Das declarações', paragraphs: ['A VENDEDORA declara que o veículo está livre de ônus, alienação fiduciária, restrições judiciais e administrativas, salvo as expressamente informadas neste contrato, respondendo pela evicção.', 'O COMPRADOR declara ter recebido as informações sobre o estado de conservação, a quilometragem e o laudo cautelar do veículo.'] },
                ...extra,
                { heading: 'Cláusula final – Do foro', paragraphs: [`Fica eleito o foro ${forum.startsWith('do ') ? forum : 'da comarca de ' + forum} para dirimir dúvidas oriundas deste contrato.`, 'E, por estarem justas e contratadas, as partes assinam o presente em 2 (duas) vias de igual teor, na presença de 2 (duas) testemunhas.'] },
                signatures(`VENDEDORA – ${legal.legalName || store.name}`, `COMPRADOR(A) – ${person?.name || ''}`),
            ],
        };
    }
    if (contract.type === 'delivery') {
        return {
            title: 'Termo de entrega de veículo e transferência de responsabilidade',
            sections: [
                { heading: 'Partes', paragraphs: [`ENTREGANTE: ${storeParty(store, legal)}.`, `RECEBEDOR(A): ${personParty(person)}.`] },
                { heading: 'Veículo', paragraphs: [`Veículo ${vehicleText(vehicle)}.`] },
                { heading: 'Entrega', paragraphs: [`Data e hora da entrega: ${contract.deliveredAt ? new Date(contract.deliveredAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '___/___/______ às ____:____'}. Quilometragem na entrega: ${contract.deliveryMileage ? Number(contract.deliveryMileage).toLocaleString('pt-BR') + ' km' : '__________ km'}.`, `Itens entregues: ${contract.deliveryItems || 'chave principal, chave reserva, manual do proprietário, estepe, macaco, chave de roda e triângulo'}.`] },
                { heading: 'Responsabilidade', paragraphs: ['A partir da data e hora acima, o RECEBEDOR assume integral responsabilidade civil, criminal e administrativa pelo veículo, inclusive por infrações de trânsito, nos termos do art. 134 do Código de Trânsito Brasileiro.', 'O RECEBEDOR declara ter recebido o veículo em perfeitas condições de uso, conforme vistoria realizada neste ato.'] },
                ...extra,
                signatures(`ENTREGANTE – ${legal.legalName || store.name}`, `RECEBEDOR(A) – ${person?.name || ''}`),
            ],
        };
    }
    return {
        title: 'Contrato particular de compra de veículo usado',
        sections: [
            { heading: 'Partes', paragraphs: [`VENDEDOR(A): ${personParty(person)}.`, `COMPRADORA: ${storeParty(store, legal)}.`] },
            { heading: 'Cláusula 1ª – Do objeto', paragraphs: [`O VENDEDOR vende à COMPRADORA o veículo ${vehicleText(vehicle)}, de sua propriedade.`] },
            { heading: 'Cláusula 2ª – Do preço', paragraphs: [`O preço é de ${brl(purchase.amountCents)}, pago da seguinte forma:`, ...paymentLines(purchase.payments), 'A quitação de cada pagamento se dá com o comprovante de transferência bancária para a conta de titularidade do VENDEDOR.'] },
            { heading: 'Cláusula 3ª – Das declarações do vendedor', paragraphs: ['O VENDEDOR declara que o veículo está livre e desembaraçado de ônus, alienação fiduciária, penhora, restrições judiciais ou administrativas, e que não foi objeto de roubo, furto, sinistro com perda total ou adulteração, respondendo pela evicção e pelos vícios ocultos.', 'Débitos de IPVA, licenciamento, seguro obrigatório e multas com fato gerador até a data da entrega são de responsabilidade do VENDEDOR, que autoriza o desconto desses valores do preço, se identificados antes do pagamento.'] },
            { heading: 'Cláusula 4ª – Da entrega e dos documentos', paragraphs: [`Na entrega, o VENDEDOR assina a ATPV-e em favor da COMPRADORA e entrega o CRLV-e, a chave reserva e o manual, quando houver. Data da compra: ${dateBr(purchase.purchaseDate)}.`, 'A partir da entrega, a COMPRADORA responde pelas infrações cometidas com o veículo.'] },
            ...extra,
            { heading: 'Cláusula final – Do foro', paragraphs: [`Fica eleito o foro da comarca de ${forum} para dirimir dúvidas oriundas deste contrato.`, 'E, por estarem justas e contratadas, as partes assinam o presente em 2 (duas) vias de igual teor.'] },
            signatures(`VENDEDOR(A) – ${person?.name || ''}`, `COMPRADORA – ${legal.legalName || store.name}`),
        ],
    };
}

const missingData = ({ legal, vehicle, person }) => {
    const missing = [];
    if (!legal.document) missing.push('CNPJ da loja');
    if (!legal.address) missing.push('endereço da loja');
    if (!legal.representative) missing.push('representante da loja');
    if (!person?.document) missing.push('CPF/CNPJ do cliente');
    if (!person?.address) missing.push('endereço do cliente');
    if (!vehicle?.plate) missing.push('placa');
    if (!vehicle?.renavam) missing.push('RENAVAM');
    if (!vehicle?.chassis) missing.push('chassi');
    return missing;
};

export async function contractRoute({ req, res, route, c, db, body, send, admin, audit, files }) {
    if (!route.startsWith('/api/admin/legal') && !route.startsWith('/api/admin/contracts')) return false;
    await admin();
    const row = async (t, id) => { const r = await db.prepare(`SELECT * FROM ${t} WHERE id=? AND store_id=?`).get(id, c.storeId); return r ? decode(r) : null; };
    const store = await db.prepare('SELECT * FROM stores WHERE id=?').get(c.storeId);
    const sources = async (contract) => {
        const deal = contract.dealId ? await row('deals', contract.dealId) : null;
        const purchase = contract.purchaseId ? await row('purchases', contract.purchaseId) : null;
        const vehicle = await row('vehicles', (deal || purchase)?.vehicleId || contract.vehicleId);
        const person = await row('people', (deal || purchase)?.personId || contract.personId);
        const tradeVehicle = deal?.tradeIn?.vehicleId ? await row('vehicles', deal.tradeIn.vehicleId) : null;
        return { deal, purchase, vehicle, person, tradeVehicle };
    };
    const now = () => new Date().toISOString();

    if (route === '/api/admin/legal' && req.method === 'GET') { send(res, await readLegal(db, c.storeId)); return true; }
    if (route === '/api/admin/legal' && req.method === 'PUT') {
        const v = await body(req);
        const legal = { legalName: text(v.legalName, 160), document: digits(v.document), address: text(v.address, 240), cityUf: text(v.cityUf, 80), representative: text(v.representative, 120), representativeDocument: digits(v.representativeDocument), warrantyMonths: Number(v.warrantyMonths) || 0, warrantyScope: text(v.warrantyScope, 120), forum: text(v.forum, 80) };
        if (legal.document && (legal.document.length !== 14 || !validDocument(legal.document))) fail(422, 'CNPJ da loja inválido.');
        if (legal.representativeDocument && (legal.representativeDocument.length !== 11 || !validDocument(legal.representativeDocument))) fail(422, 'CPF do representante inválido.');
        if (!Number.isInteger(legal.warrantyMonths) || legal.warrantyMonths < 0 || legal.warrantyMonths > 24) fail(422, 'Garantia contratual deve ficar entre 0 e 24 meses.');
        await db.prepare('INSERT INTO store_legal VALUES(?,?,?) ON CONFLICT(store_id) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(c.storeId, JSON.stringify(legal), now());
        await audit(c, 'legal.update', c.storeId);
        send(res, legal);
        return true;
    }
    if (route === '/api/admin/contracts' && req.method === 'GET') {
        send(res, { contracts: (await db.prepare('SELECT * FROM contracts WHERE store_id=? ORDER BY updated DESC,id').all(c.storeId)).map(decode), checklists: CHECKLISTS, types: CONTRACT_TYPES });
        return true;
    }
    if (route === '/api/admin/contracts' && req.method === 'POST') {
        const v = await body(req);
        const type = CONTRACT_TYPES[v?.type];
        if (!type) fail(422, 'Tipo de contrato inválido.');
        const ref = type.source === 'deal' ? await row('deals', text(v.dealId, 64)) : await row('purchases', text(v.purchaseId, 64));
        if (!ref) fail(422, type.source === 'deal' ? 'Selecione uma negociação desta loja.' : 'Selecione uma compra desta loja.');
        if (type.source === 'deal' && ref.status === 'cancelled') fail(422, 'Negociação cancelada.');
        const open = (await db.prepare('SELECT * FROM contracts WHERE store_id=?').all(c.storeId)).map(decode).find((k) => k.type === v.type && k.status !== 'cancelled' && (k.dealId || k.purchaseId) === ref.id);
        if (open) fail(409, 'Já existe um contrato deste tipo para este processo.');
        const year = new Date().getFullYear();
        const count = (await db.prepare('SELECT data FROM contracts WHERE store_id=?').all(c.storeId)).filter((r) => JSON.parse(r.data).number?.startsWith(`${year}-`)).length;
        const id = randomUUID();
        const process = type.source === 'deal' ? 'sale' : 'purchase';
        const contract = { type: v.type, number: `${year}-${String(count + 1).padStart(4, '0')}`, dealId: type.source === 'deal' ? ref.id : '', purchaseId: type.source === 'purchase' ? ref.id : '', vehicleId: ref.vehicleId, personId: ref.personId, process, status: 'draft', extraClauses: '', deliveredAt: '', deliveryMileage: null, deliveryItems: '', checklist: Object.fromEntries(CHECKLISTS[process].map(([key]) => [key, { status: 'pending', files: [], note: '' }])), signedFile: '', snapshot: null, signedAt: '', createdAt: now(), createdBy: c.user.name };
        await db.prepare('INSERT INTO contracts VALUES(?,?,?,1,?)').run(id, c.storeId, JSON.stringify(contract), now());
        await audit(c, 'contract.create', id);
        send(res, decode(await db.prepare('SELECT * FROM contracts WHERE id=?').get(id)), 201);
        return true;
    }
    if (route === '/api/admin/contracts/uploads' && req.method === 'POST') {
        const v = await body(req);
        const list = Array.isArray(v?.files) ? v.files.slice(0, 10) : [];
        if (list.some((f) => f?.kind !== 'document')) fail(422, 'Envie PDF ou imagem do documento.');
        send(res, await files.issue(c.storeId, 'contract', list), 201);
        return true;
    }
    const m = route.match(/^\/api\/admin\/contracts\/([a-zA-Z0-9-]+)(?:\/(document|sign|cancel))?$/);
    if (!m) return false;
    const [, id, action] = m;
    const contract = await row('contracts', id);
    if (!contract) fail(404, 'Contrato não encontrado.');
    const save = async (data, event) => {
        const { id: _i, revision: _r, updatedAt: _u, ...rest } = data;
        await db.prepare('UPDATE contracts SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(rest), now(), id, c.storeId);
        await audit(c, event, id);
        send(res, decode(await db.prepare('SELECT * FROM contracts WHERE id=?').get(id)));
    };
    if (action === 'document' && req.method === 'GET') {
        if (contract.snapshot) { send(res, { ...contract.snapshot, frozen: true, missing: [] }); return true; }
        const src = await sources(contract);
        const legal = await readLegal(db, c.storeId);
        send(res, { ...buildDocument({ contract, store, legal, ...src }), frozen: false, missing: missingData({ legal, ...src }) });
        return true;
    }
    if (req.method !== 'PUT' && req.method !== 'POST') fail(405, 'Método não permitido.');
    const v = await body(req);
    if (v?.revision !== contract.revision) fail(409, 'Contrato alterado por outra sessão. Atualize o painel.');
    if (action === 'cancel') {
        if (contract.status === 'signed') fail(409, 'Contrato assinado não pode ser cancelado; registre um distrato nas cláusulas de um novo contrato.');
        await save({ ...contract, status: 'cancelled' }, 'contract.cancel');
        return true;
    }
    if (action === 'sign') {
        if (contract.status === 'signed' || contract.status === 'cancelled') fail(409, 'Este contrato já foi encerrado.');
        const src = await sources(contract);
        const legal = await readLegal(db, c.storeId);
        const missing = missingData({ legal, ...src });
        if (missing.length) fail(422, `Complete antes de assinar: ${missing.join(', ')}.`);
        const signedFile = text(v.signedFile, 120);
        if (signedFile && !(await files.claim(c.storeId, 'contract', [signedFile], ['document'])).length) fail(422, 'Arquivo inválido.');
        const signedAt = now();
        const snapshot = buildDocument({ contract: { ...contract, signedAt }, store, legal, ...src });
        const checklist = { ...contract.checklist };
        if (checklist.contract) checklist.contract = { ...checklist.contract, status: signedFile ? 'received' : checklist.contract.status, files: signedFile ? [...checklist.contract.files, signedFile] : checklist.contract.files };
        if (contract.type === 'delivery' && checklist.delivery) checklist.delivery = { ...checklist.delivery, status: signedFile ? 'received' : checklist.delivery.status };
        await save({ ...contract, status: 'signed', signedAt, signedFile, snapshot, checklist }, 'contract.sign');
        return true;
    }
    if (action) fail(405, 'Método não permitido.');
    // Edição: cláusulas e dados de entrega só enquanto não assinado; checklist sempre
    const next = { ...contract };
    if (!['signed', 'cancelled'].includes(contract.status)) {
        if (v.status && !['draft', 'sent'].includes(v.status)) fail(422, 'Use "Marcar como assinado" para assinar.');
        next.status = v.status || contract.status;
        next.extraClauses = text(v.extraClauses, 6000);
        next.deliveryItems = text(v.deliveryItems, 400);
        next.deliveryMileage = v.deliveryMileage === '' || v.deliveryMileage == null ? null : Number(v.deliveryMileage);
        if (next.deliveryMileage !== null && (!Number.isInteger(next.deliveryMileage) || next.deliveryMileage < 0)) fail(422, 'Quilometragem de entrega inválida.');
        next.deliveredAt = v.deliveredAt ? new Date(v.deliveredAt).toISOString() : '';
    }
    if (v.checklist && typeof v.checklist === 'object') {
        const keys = CHECKLISTS[contract.process].map(([key]) => key);
        const checklist = {}, added = [];
        for (const key of keys) {
            const item = v.checklist[key] || contract.checklist[key];
            if (!ITEM_STATUS.includes(item?.status)) fail(422, 'Situação de documento inválida.');
            const oldFiles = contract.checklist[key]?.files || [];
            const names = Array.isArray(item.files) ? [...new Set(item.files.filter((n) => typeof n === 'string'))].slice(0, 10) : oldFiles;
            added.push(...names.filter((n) => !oldFiles.includes(n)));
            checklist[key] = { status: item.status, files: names, note: text(item.note, 300) };
        }
        // Só reivindica os anexos novos depois de validar o checklist inteiro
        if (added.length) await files.claim(c.storeId, 'contract', added, ['document']);
        next.checklist = checklist;
    }
    await save(next, 'contract.update');
    return true;
}
