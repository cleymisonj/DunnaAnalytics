import { randomUUID } from 'node:crypto';
import { validDocument } from './contracts.mjs';
import { readFinanceSettings } from './finance.mjs';

// Importação de planilhas (CSV lido no navegador): estoque, pessoas e contas.
// dryRun confere tudo sem gravar; ao confirmar, só as linhas válidas entram, numa única transação.
// Veículos entram como rascunho, porque publicar exige foto.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const fold = (s) => str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MAX_ROWS = 2000;

/** "R$ 1.234,56", "1234,56" ou "1234.56" em centavos. */
export function parseCents(value) {
    const t = str(value).replace(/[R$\s]/g, '');
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    return t && Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
/** "31/12/2026" ou "2026-12-31" em data ISO; vazio quando inválida. */
export function parseDate(value) {
    const t = str(value), br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/), iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso) return '';
    return iso;
}
const pick = (value, options, fallback) => options.find((o) => fold(o) === fold(value)) || fallback;
const int = (v) => Number(str(v).replace(/\D/g, ''));

function vehicleRow(r, validateVehicle) {
    const year = int(r.year), price = parseCents(r.price) / 100;
    if (!str(r.brand) || !str(r.model)) fail(422, 'Informe marca e modelo.');
    if (!year) fail(422, 'Informe o ano do modelo.');
    if (!(price > 0)) fail(422, 'Preço inválido.');
    return validateVehicle({ brand: str(r.brand), model: str(r.model), version: str(r.version) || 'Não informada', color: str(r.color) || 'Não informada', year, yearMade: int(r.yearMade) || year, price, mileage: int(r.mileage), transmission: pick(r.transmission, ['Automático', 'Manual', 'Automatizado'], 'Manual'), body: pick(r.body, ['SUV', 'Sedan', 'Hatch', 'Picape'], 'Hatch'), fuel: pick(r.fuel, ['Flex', 'Gasolina', 'Diesel', 'Híbrido', 'Elétrico'], 'Flex'), condition: pick(r.condition, ['Novo', 'Seminovo'], 'Seminovo'), status: 'draft', images: [], plate: str(r.plate), renavam: str(r.renavam), chassis: str(r.chassis), documentation: str(r.notes, 3000), fipe: parseCents(r.fipe) > 0 ? parseCents(r.fipe) / 100 : undefined });
}
function personRow(r) {
    const name = str(r.name), phone = str(r.phone, 30).replace(/\D/g, ''), email = str(r.email).toLowerCase(), document = str(r.document, 30).replace(/\D/g, ''), zip = str(r.zip, 12).replace(/\D/g, '');
    if (!name) fail(422, 'Informe o nome.');
    if (phone && !/^\d{10,13}$/.test(phone)) fail(422, 'Telefone inválido.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422, 'E-mail inválido.');
    if (document && !validDocument(document)) fail(422, 'CPF ou CNPJ inválido.');
    const kind = /fornec/.test(fold(r.kind)) ? 'supplier' : /parc/.test(fold(r.kind)) ? 'partner' : 'customer';
    return { name, kind, phone, email, city: str(r.city), notes: str(r.notes, 2000), active: true, document, rg: '', nationality: '', maritalStatus: '', profession: '', address: str(r.address, 240), zip: zip.length === 8 ? zip : '' };
}
function ledgerRow(r, settings) {
    const kind = fold(r.direction), direction = /receb|receita|entrada/.test(kind) ? 'income' : /pag|despesa|saida/.test(kind) ? 'expense' : '';
    const amountCents = parseCents(r.amount), dueDate = parseDate(r.dueDate), paidDate = parseDate(r.paidDate);
    if (!direction) fail(422, 'Tipo deve ser pagar ou receber.');
    if (!str(r.description)) fail(422, 'Informe a descrição.');
    if (!(amountCents > 0)) fail(422, 'Valor inválido.');
    if (!dueDate) fail(422, 'Vencimento inválido (use dd/mm/aaaa).');
    if (str(r.paidDate) && !paidDate) fail(422, 'Data de pagamento inválida.');
    const category = settings.categories.find((c) => c.direction === direction && fold(c.name) === fold(r.category));
    return { direction, description: str(r.description), amountCents, dueDate, status: paidDate ? 'paid' : 'open', paidDate, payments: [], vehicleId: '', personId: '', dealId: '', source: 'manual', categoryId: category?.id || '', accountId: '', notes: str(r.notes, 2000) };
}

export async function importRoute({ req, res, route, c, db, body, send, admin, audit, validateVehicle }) {
    const m = route.match(/^\/api\/admin\/import\/(vehicles|people|ledger)$/);
    if (!m) return false;
    await admin();
    if (req.method !== 'POST') fail(405, 'Método não permitido.');
    const kind = m[1], v = await body(req, 3 * 1024 * 1024);
    if (!Array.isArray(v?.rows) || !v.rows.length) fail(422, 'Nenhuma linha para importar.');
    if (v.rows.length > MAX_ROWS) fail(422, `Importe no máximo ${MAX_ROWS} linhas por vez.`);
    const existing = (await db.prepare(`SELECT data FROM ${kind} WHERE store_id=?`).all(c.storeId)).map((r) => JSON.parse(r.data));
    const settings = kind === 'ledger' ? await readFinanceSettings(db, c.storeId) : null;
    // Chave de duplicidade: placa/chassi; documento/telefone/nome; descrição + valor + vencimento
    const keysOf = (d) => kind === 'vehicles' ? [d.plate, d.chassis].filter(Boolean).map((k) => 'v:' + k) : kind === 'people' ? [d.document && 'd:' + d.document, d.phone && 'p:' + d.phone, !d.document && !d.phone && 'n:' + fold(d.name)].filter(Boolean) : ['l:' + fold(d.description) + d.amountCents + d.dueDate];
    const seen = new Set(existing.flatMap(keysOf)), valid = [], errors = [], duplicates = [];
    v.rows.forEach((raw, i) => {
        const line = i + 2; // linha na planilha, contando o cabeçalho
        try {
            const data = kind === 'vehicles' ? vehicleRow(raw, validateVehicle) : kind === 'people' ? personRow(raw) : ledgerRow(raw, settings);
            const keys = keysOf(data);
            if (keys.some((k) => seen.has(k))) { duplicates.push(line); return; }
            keys.forEach((k) => seen.add(k));
            valid.push(data);
        } catch (e) {
            if (!e.status) throw e;
            errors.push({ line, message: e.message });
        }
    });
    const result = { total: v.rows.length, valid: valid.length, duplicates, errors: errors.slice(0, 200), errorCount: errors.length, created: 0 };
    if (v.dryRun || !valid.length) { send(res, result); return true; }
    const at = new Date().toISOString();
    await db.exec('BEGIN IMMEDIATE');
    try {
        for (const data of valid) {
            const id = randomUUID();
            if (kind === 'vehicles') data.id = id;
            await db.prepare(`INSERT INTO ${kind} VALUES(?,?,?,1,?)`).run(id, c.storeId, JSON.stringify(kind === 'vehicles' ? { ...data, listedAt: at, priceHistory: [] } : kind === 'ledger' ? { ...data, createdBy: c.user.name, createdAt: at } : data), at);
        }
        await audit(c, 'import.' + kind, String(valid.length));
        await db.exec('COMMIT');
    } catch (e) { await db.exec('ROLLBACK'); throw e; }
    send(res, { ...result, created: valid.length }, 201);
    return true;
}
