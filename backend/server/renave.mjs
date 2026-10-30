export async function installRenave(db) {
    (await db.exec(`CREATE TABLE IF NOT EXISTS renave_preparation(store_id TEXT PRIMARY KEY REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL,updated TEXT NOT NULL);`));
}
export async function readRenave(db, storeId) {
    const row = (await db.prepare('SELECT * FROM renave_preparation WHERE store_id=?').get(storeId));
    return { ...(row ? JSON.parse(row.data) : { cnpj: '', legalName: '', credencia: false, contract: false, certificate: false, stateConfirmed: false, notes: '' }), revision: row?.revision || 0, updatedAt: row?.updated || null, connected: false, mode: 'preparation' };
}
export async function saveRenave(db, storeId, input) {
    const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
    const clean = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
    const cnpj = clean(input.cnpj, 30).replace(/\D/g, '');
    if (cnpj) {
        const digit = (s) => { let weight = s.length - 7, sum = 0; for (const ch of s) {
            sum += Number(ch) * weight--;
            if (weight < 2)
                weight = 9;
        } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
        if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj) || digit(cnpj.slice(0, 12)) !== Number(cnpj[12]) || digit(cnpj.slice(0, 13)) !== Number(cnpj[13]))
            fail(422, 'CNPJ inválido. Confira os dígitos.');
    }
    for (const key of ['credencia', 'contract', 'certificate', 'stateConfirmed'])
        if (typeof input[key] !== 'boolean')
            fail(422, 'Checklist inválido.');
    if ((input.credencia || input.contract || input.certificate) && (!cnpj || !clean(input.legalName, 180)))
        fail(422, 'Informe CNPJ e razão social antes de registrar o credenciamento.');
    if (input.contract && !input.credencia || input.certificate && !input.contract)
        fail(422, 'Conclua o credenciamento antes do contrato e o contrato antes da habilitação do certificado.');
    const data = { cnpj, legalName: clean(input.legalName, 180), credencia: input.credencia, contract: input.contract, certificate: input.certificate, stateConfirmed: input.stateConfirmed, notes: clean(input.notes, 2000) };
    const updated = new Date().toISOString();
    (await db.exec('BEGIN IMMEDIATE'));
    try {
        const old = (await readRenave(db, storeId));
        if (old.revision !== input.revision)
            fail(409, 'Preparação alterada por outro administrador. Recarregue antes de salvar.');
        (await db.prepare('INSERT INTO renave_preparation VALUES(?,?,?,?) ON CONFLICT(store_id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated=excluded.updated').run(storeId, JSON.stringify(data), old.revision + 1, updated));
        (await db.exec('COMMIT'));
    }
    catch (e) {
        (await db.exec('ROLLBACK'));
        throw e;
    }
    return (await readRenave(db, storeId));
}
