import { randomUUID } from 'node:crypto';
import { LINK_TABLE, linkLabel } from './agenda.mjs';

// Etiquetas (em veículos, pessoas, interessados e negociações) e busca geral da barra superior.
// A busca respeita a loja e o papel: vendedor encontra estoque, os próprios interessados e as próprias tarefas.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const decode = (r) => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
export const TAG_COLORS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'slate', 'orange'];
export const TAG_KINDS = Object.keys(LINK_TABLE);
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function installTags(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);CREATE INDEX IF NOT EXISTS tags_store ON tags(store_id);');
    await db.exec('CREATE TABLE IF NOT EXISTS tag_links(store_id TEXT NOT NULL REFERENCES stores(id),tag_id TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,PRIMARY KEY(tag_id,kind,entity_id));CREATE INDEX IF NOT EXISTS tag_links_store ON tag_links(store_id,kind);');
}

export async function tagRoute({ req, res, route, c, db, body, send, admin, audit }) {
    if (route === '/api/admin/search' && req.method === 'GET') {
        send(res, await globalSearch(db, c, new URL(req.url, 'http://local').searchParams.get('q') || ''));
        return true;
    }
    if (!route.startsWith('/api/admin/tags')) return false;
    const tags = async () => (await db.prepare('SELECT * FROM tags WHERE store_id=? ORDER BY updated').all(c.storeId)).map(decode);
    if (route === '/api/admin/tags/links') {
        if (req.method === 'GET') {
            const kind = new URL(req.url, 'http://local').searchParams.get('kind');
            const rows = await db.prepare('SELECT tag_id,kind,entity_id FROM tag_links WHERE store_id=?').all(c.storeId);
            const map = {};
            for (const r of rows.filter((r) => !kind || r.kind === kind)) (map[`${r.kind}:${r.entity_id}`] ||= []).push(r.tag_id);
            send(res, map);
            return true;
        }
        if (req.method !== 'PUT') fail(405, 'Método não permitido.');
        const v = await body(req);
        if (!TAG_KINDS.includes(v?.kind) || !Array.isArray(v.tagIds) || v.tagIds.length > 20) fail(422, 'Dados inválidos.');
        const entity = await db.prepare(`SELECT * FROM ${LINK_TABLE[v.kind]} WHERE id=? AND store_id=?`).get(text(v.id, 64), c.storeId);
        if (!entity) fail(404, 'Registro não encontrado nesta loja.');
        // Vendedor etiqueta só os próprios interessados; o resto é do administrador
        if (c.user.role === 'seller' && !(v.kind === 'lead' && JSON.parse(entity.data).assignedTo === c.user.id)) fail(403, 'Sem permissão para etiquetar este registro.');
        const valid = new Set((await tags()).map((t) => t.id));
        if (v.tagIds.some((t) => !valid.has(t))) fail(422, 'Etiqueta não encontrada.');
        await db.exec('BEGIN IMMEDIATE');
        try {
            await db.prepare('DELETE FROM tag_links WHERE store_id=? AND kind=? AND entity_id=?').run(c.storeId, v.kind, entity.id);
            for (const t of new Set(v.tagIds)) await db.prepare('INSERT INTO tag_links VALUES(?,?,?,?)').run(c.storeId, t, v.kind, entity.id);
            await db.exec('COMMIT');
        } catch (e) { await db.exec('ROLLBACK'); throw e; }
        await audit(c, 'tags.apply', entity.id);
        send(res, { kind: v.kind, id: entity.id, tagIds: [...new Set(v.tagIds)] });
        return true;
    }
    if (route === '/api/admin/tags' && req.method === 'GET') {
        const counts = new Map((await db.prepare('SELECT tag_id,count(*) as n FROM tag_links WHERE store_id=? GROUP BY tag_id').all(c.storeId)).map((r) => [r.tag_id, Number(r.n)]));
        send(res, (await tags()).map((t) => ({ ...t, count: counts.get(t.id) || 0 })));
        return true;
    }
    await admin();
    const m = route.match(/^\/api\/admin\/tags(?:\/([a-zA-Z0-9-]+))?$/);
    if (!m) fail(404, 'Recurso não encontrado.');
    const id = m[1];
    if (id && req.method === 'DELETE') {
        if (!(await db.prepare('SELECT id FROM tags WHERE id=? AND store_id=?').get(id, c.storeId))) fail(404, 'Etiqueta não encontrada.');
        await db.prepare('DELETE FROM tag_links WHERE store_id=? AND tag_id=?').run(c.storeId, id);
        await db.prepare('DELETE FROM tags WHERE id=? AND store_id=?').run(id, c.storeId);
        await audit(c, 'tag.delete', id);
        send(res, { ok: true });
        return true;
    }
    if ((!id && req.method === 'POST') || (id && req.method === 'PUT')) {
        const v = await body(req), name = text(v?.name, 40);
        if (!name || !TAG_COLORS.includes(v.color)) fail(422, 'Informe nome e cor da etiqueta.');
        const all = await tags();
        if (all.some((t) => t.id !== id && fold(t.name) === fold(name))) fail(409, 'Já existe uma etiqueta com esse nome.');
        if (!id && all.length >= 100) fail(422, 'Limite de 100 etiquetas por loja.');
        const key = id || randomUUID();
        if (id) {
            const old = all.find((t) => t.id === id);
            if (!old) fail(404, 'Etiqueta não encontrada.');
            if (old.revision !== v.revision) fail(409, 'Etiqueta alterada em outra sessão.');
            await db.prepare('UPDATE tags SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify({ name, color: v.color }), new Date().toISOString(), id, c.storeId);
        } else await db.prepare('INSERT INTO tags VALUES(?,?,?,1,?)').run(key, c.storeId, JSON.stringify({ name, color: v.color }), new Date().toISOString());
        await audit(c, id ? 'tag.update' : 'tag.create', key);
        send(res, decode(await db.prepare('SELECT * FROM tags WHERE id=?').get(key)), id ? 200 : 201);
        return true;
    }
    fail(405, 'Método não permitido.');
}

export async function globalSearch(db, c, raw) {
    const q = fold(raw).trim().slice(0, 80);
    if (q.length < 2) return { query: raw, groups: [] };
    const words = q.split(/\s+/).filter(Boolean), digits = q.replace(/\D/g, '');
    const hit = (...fields) => { const hay = fold(fields.join(' ')); const hayDigits = hay.replace(/\D/g, ''); return words.every((w) => hay.includes(w) || (/^\d{3,}$/.test(w) && hayDigits.includes(w))) || (digits.length >= 4 && hayDigits.includes(digits)); };
    const seller = c.user.role === 'seller';
    const list = async (t) => (await db.prepare(`SELECT * FROM ${t} WHERE store_id=?`).all(c.storeId)).map(decode);
    // Etiquetas cujo nome bate com a busca trazem os registros etiquetados
    const tagRows = (await list('tags')).filter((t) => fold(t.name).includes(q));
    const tagged = new Map();
    if (tagRows.length) for (const r of await db.prepare('SELECT tag_id,kind,entity_id FROM tag_links WHERE store_id=?').all(c.storeId)) { const t = tagRows.find((t) => t.id === r.tag_id); if (t) tagged.set(`${r.kind}:${r.entity_id}`, t.name); }
    const groups = [];
    const add = (kind, label, items) => { if (items.length) groups.push({ kind, label, items: items.slice(0, 6), total: items.length }); };
    const STATUS = { available: 'Disponível', reserved: 'Reservado', sold: 'Vendido', draft: 'Rascunho' };
    add('vehicle', 'Veículos', (await list('vehicles')).filter((v) => tagged.has('vehicle:' + v.id) || hit(v.brand, v.model, v.version, v.year, v.color, seller ? '' : v.plate, seller ? '' : v.renavam, seller ? '' : v.chassis)).map((v) => ({ id: v.id, title: linkLabel('vehicle', v), subtitle: [STATUS[v.status], v.price ? v.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '', !seller && v.plate, tagged.get('vehicle:' + v.id) && 'Etiqueta ' + tagged.get('vehicle:' + v.id)].filter(Boolean).join(' · '), target: { screen: 'stock', view: 'all', label: 'Todo o estoque', focus: v.id } })));
    add('lead', 'Interessados', (await list('leads')).filter((l) => !seller || l.assignedTo === c.user.id).filter((l) => tagged.has('lead:' + l.id) || hit(l.name, l.phone, l.interest, l.source)).map((l) => ({ id: l.id, title: l.name, subtitle: [l.interest, l.phone, tagged.get('lead:' + l.id) && 'Etiqueta ' + tagged.get('lead:' + l.id)].filter(Boolean).join(' · '), target: { screen: 'crm', view: 'all', label: 'Funil de oportunidades', focus: l.id } })));
    add('task', 'Tarefas', (await list('tasks')).filter((t) => !seller || t.assignedTo === c.user.id || t.createdBy === c.user.id).filter((t) => hit(t.title, t.notes, t.link?.label)).map((t) => ({ id: t.id, title: t.title, subtitle: [t.status === 'done' ? 'Concluída' : new Date(t.dueAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }), t.link?.label].filter(Boolean).join(' · '), target: { screen: 'agenda', view: 'all', label: 'Agenda', focus: t.id } })));
    if (!seller) {
        const KIND = { customer: 'Cliente', supplier: 'Fornecedor', partner: 'Parceiro' };
        const people = await list('people'), names = new Map(people.map((p) => [p.id, p.name])), cars = new Map((await list('vehicles')).map((v) => [v.id, linkLabel('vehicle', v)]));
        const dealLabel = (d) => [d.personName || names.get(d.personId), d.vehicleLabel || cars.get(d.vehicleId)].filter(Boolean).join(' · ') || 'Negociação';
        add('person', 'Pessoas', people.filter((p) => tagged.has('person:' + p.id) || hit(p.name, p.phone, p.email, p.document, p.city)).map((p) => ({ id: p.id, title: p.name, subtitle: [KIND[p.kind], p.phone, p.city, !p.active && 'Arquivado'].filter(Boolean).join(' · '), target: { screen: 'people', view: 'all', label: 'Todos os cadastros', focus: p.name } })));
        add('deal', 'Negociações', (await list('deals')).filter((d) => tagged.has('deal:' + d.id) || hit(dealLabel(d), d.notes)).map((d) => ({ id: d.id, title: dealLabel(d), subtitle: [brl(d.amountCents), { draft: 'Rascunho', proposal: 'Proposta', completed: 'Concluída', cancelled: 'Cancelada' }[d.status]].join(' · '), target: { screen: 'deals', view: 'all', label: 'Todas as negociações', focus: d.personName || names.get(d.personId) || '' } })));
        add('finance', 'Financeiro', (await list('ledger')).filter((e) => e.status !== 'void' && hit(e.description, e.customerName, e.notes)).map((e) => ({ id: e.id, title: e.description, subtitle: [e.direction === 'income' ? 'A receber' : 'A pagar', brl(e.amountCents), 'vence ' + e.dueDate.split('-').reverse().join('/'), e.status === 'paid' ? 'Baixado' : ''].filter(Boolean).join(' · '), target: { screen: 'finance', view: e.status === 'paid' ? 'paid' : e.direction, label: 'Financeiro', focus: e.id } })));
    }
    return { query: raw, groups };
}
