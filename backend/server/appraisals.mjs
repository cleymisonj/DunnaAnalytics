import { randomUUID } from 'node:crypto';
import { notify } from './notifications.mjs';

// Avaliação de usado enviada pela vitrine: dados do carro, fotos e um vídeo.
// Vira um item em "Avaliações" e um interessado no funil (origem "Avaliação de usado").
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const decode = (r) => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
export const APPRAISAL_STATUS = ['new', 'analyzing', 'offer', 'accepted', 'declined'];
export const MAX_PHOTOS = 12;
export const MAX_VIDEOS = 1;

export async function installAppraisals(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS appraisals(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);CREATE INDEX IF NOT EXISTS appraisals_store ON appraisals(store_id);');
}

const storeBySlug = async (db, slug) => {
    const store = await db.prepare('SELECT * FROM stores WHERE slug=?').get(text(slug, 80) || 'minha-loja');
    if (!store) fail(404, 'Loja não encontrada.');
    return store;
};

/** Rotas públicas (vitrine). `limit(key)` é o limitador de tentativas da API. */
export async function publicAppraisalRoute({ req, res, route, db, body, send, files, limit, ip }) {
    if (route === '/api/public/appraisals/uploads' && req.method === 'POST') {
        await limit('appraisal-upload:' + ip);
        const v = await body(req);
        const store = await storeBySlug(db, v?.store);
        const list = Array.isArray(v?.files) ? v.files : [];
        if (list.filter((f) => f?.kind === 'photo').length > MAX_PHOTOS || list.filter((f) => f?.kind === 'video').length > MAX_VIDEOS || list.some((f) => !['photo', 'video'].includes(f?.kind)))
            fail(422, `Envie até ${MAX_PHOTOS} fotos e ${MAX_VIDEOS} vídeo.`);
        send(res, await files.issue(store.id, 'appraisal', list), 201);
        return true;
    }
    if (route === '/api/public/appraisals' && req.method === 'POST') {
        await limit('appraisal:' + ip);
        const v = await body(req, 20000);
        const store = await storeBySlug(db, v?.store);
        const name = text(v?.name, 80), phone = text(v?.phone, 20).replace(/\D/g, ''), model = text(v?.model, 120);
        const year = Number(v?.year), mileage = v?.mileage === '' || v?.mileage == null ? null : Number(v.mileage);
        if (name.length < 2) fail(422, 'Informe seu nome.');
        if (!/^[1-9]{2}\d{8,9}$/.test(phone)) fail(422, 'Informe um WhatsApp válido com DDD.');
        if (model.length < 2) fail(422, 'Informe marca e modelo do carro.');
        if (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1) fail(422, 'Informe um ano válido.');
        if (mileage !== null && (!Number.isInteger(mileage) || mileage < 0 || mileage > 2000000)) fail(422, 'Quilometragem inválida.');
        const names = Array.isArray(v?.media) ? v.media.filter((n) => typeof n === 'string').slice(0, MAX_PHOTOS + MAX_VIDEOS) : [];
        if (!names.length) fail(422, 'Envie pelo menos uma foto do carro.');
        const media = await files.claim(store.id, 'appraisal', names, ['photo', 'video'], (rows) => {
            if (!rows.some((r) => r.kind === 'photo')) fail(422, 'Envie pelo menos uma foto do carro.');
        });
        const now = new Date().toISOString(), id = randomUUID(), leadId = randomUUID();
        const label = `${model} ${year}`;
        const appraisal = { name, phone, model, year, mileage, notes: text(v?.notes, 1500), media, status: 'new', offerCents: null, internalNotes: '', leadId, createdAt: now };
        await db.prepare('INSERT INTO appraisals VALUES(?,?,?,1,?)').run(id, store.id, JSON.stringify(appraisal), now);
        const counts = `${media.filter((m) => m.kind === 'photo').length} foto(s)${media.some((m) => m.kind === 'video') ? ' e 1 vídeo' : ''}`;
        const lead = { id: leadId, name, phone, interest: `Avaliação: ${label}`, source: 'Avaliação de usado', stage: 'new', assignedTo: '', nextContactAt: '', lossReason: '', appraisalId: id, history: [{ id: randomUUID(), text: `Pediu avaliação do ${label}${mileage !== null ? `, ${mileage.toLocaleString('pt-BR')} km` : ''}, com ${counts}.`, author: 'Vitrine', at: now }], createdAt: now };
        await db.prepare('INSERT INTO leads VALUES(?,?,?,1,?)').run(leadId, store.id, JSON.stringify(lead), now);
        await notify(db, store.id, { type: 'appraisal', title: `Avaliação: ${label}`, body: `${name} enviou ${counts}${mileage !== null ? ` · ${mileage.toLocaleString('pt-BR')} km` : ''}.${appraisal.notes ? `
${appraisal.notes}` : ''}`, phone, screen: 'appraisals', refId: id });
        send(res, { id }, 201);
        return true;
    }
    return false;
}

export async function appraisalRoute({ req, res, route, c, db, body, send, audit }) {
    if (route === '/api/admin/appraisals' && req.method === 'GET') {
        send(res, (await db.prepare('SELECT * FROM appraisals WHERE store_id=? ORDER BY updated DESC,id').all(c.storeId)).map(decode));
        return true;
    }
    const m = route.match(/^\/api\/admin\/appraisals\/([a-zA-Z0-9-]+)$/);
    if (!m || req.method !== 'PUT') return false;
    const v = await body(req);
    const row = await db.prepare('SELECT * FROM appraisals WHERE id=? AND store_id=?').get(m[1], c.storeId);
    if (!row) fail(404, 'Avaliação não encontrada.');
    const old = decode(row);
    if (v?.revision !== old.revision) fail(409, 'Avaliação alterada por outra sessão. Atualize o painel.');
    if (!APPRAISAL_STATUS.includes(v.status)) fail(422, 'Situação inválida.');
    const offerCents = v.offerCents === null || v.offerCents === '' || v.offerCents === undefined ? null : v.offerCents;
    if (offerCents !== null && (!Number.isSafeInteger(offerCents) || offerCents <= 0 || offerCents > 10000000000)) fail(422, 'Valor da proposta inválido.');
    if (['offer', 'accepted'].includes(v.status) && offerCents === null) fail(422, 'Informe o valor da proposta.');
    const { id, revision, updatedAt, ...data } = old;
    const next = { ...data, status: v.status, offerCents, internalNotes: text(v.internalNotes, 3000) };
    await db.prepare('UPDATE appraisals SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(next), new Date().toISOString(), id, c.storeId);
    await audit(c, 'appraisal.update', id);
    send(res, decode(await db.prepare('SELECT * FROM appraisals WHERE id=?').get(id)));
    return true;
}
