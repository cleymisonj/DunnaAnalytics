import { randomUUID } from 'node:crypto';
import { vehicleCosts } from './purchases.mjs';
import { remainingCents } from './finance.mjs';

// Agenda e pendências: tarefas com responsável e prazo, ligadas a veículo, pessoa, interessado ou negociação,
// e a central que reúne o que está atrasado ou incompleto em todos os módulos da loja.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const decode = (r) => ({ ...JSON.parse(r.data), id: r.id, revision: r.revision, updatedAt: r.updated });
const DAY = 86400000;
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const startOfLocalDay = (iso) => Date.parse(iso + 'T00:00:00-03:00');

export const PRIORITIES = ['low', 'normal', 'high'];
export const TASK_STATUS = ['open', 'done', 'cancelled'];
export const LINK_TABLE = { vehicle: 'vehicles', person: 'people', lead: 'leads', deal: 'deals' };
export const linkLabel = (kind, d) => kind === 'vehicle' ? [d.brand, d.model, d.version, d.year].filter(Boolean).join(' ') : kind === 'deal' ? [d.personName, d.vehicleLabel].filter(Boolean).join(' · ') || 'Negociação' : d.name || '';

export async function installAgenda(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);CREATE INDEX IF NOT EXISTS tasks_store ON tasks(store_id);');
}

/** Vínculo da tarefa: confere que o registro é da loja (e, para vendedor, que o interessado é dele). */
async function validLink(db, c, link) {
    if (!link || !link.kind) return null;
    if (!LINK_TABLE[link.kind]) fail(422, 'Vínculo inválido.');
    if (c.user.role === 'seller' && !['vehicle', 'lead'].includes(link.kind)) fail(403, 'Vendedores podem vincular apenas veículos e interessados.');
    const row = await db.prepare(`SELECT * FROM ${LINK_TABLE[link.kind]} WHERE id=? AND store_id=?`).get(text(link.id, 64), c.storeId);
    if (!row) fail(422, 'Registro vinculado não encontrado nesta loja.');
    const data = JSON.parse(row.data);
    if (link.kind === 'lead' && c.user.role === 'seller' && data.assignedTo !== c.user.id) fail(403, 'Sem acesso a este interessado.');
    return { kind: link.kind, id: row.id, label: linkLabel(link.kind, data).slice(0, 160) };
}

const visibleTo = (user) => (t) => user.role !== 'seller' || t.assignedTo === user.id || t.createdBy === user.id;

export async function agendaRoute({ req, res, route, c, db, body, send, audit }) {
    if (route === '/api/admin/pending' && req.method === 'GET') {
        send(res, await pendingReport(db, c.storeId, c.user));
        return true;
    }
    const match = route.match(/^\/api\/admin\/tasks(?:\/([a-zA-Z0-9-]+)(?:\/(status))?)?$/);
    if (!match) return false;
    const [, id, action] = match;
    const row = async (key) => await db.prepare('SELECT * FROM tasks WHERE id=? AND store_id=?').get(key, c.storeId);
    if (req.method === 'GET' && !id) {
        const tasks = (await db.prepare('SELECT * FROM tasks WHERE store_id=? ORDER BY updated DESC').all(c.storeId)).map(decode).filter(visibleTo(c.user));
        send(res, tasks);
        return true;
    }
    const v = await body(req);
    if (!v || typeof v !== 'object') fail(422, 'Dados inválidos.');
    const current = async () => {
        const r = await row(id);
        if (!r) fail(404, 'Tarefa não encontrada.');
        const task = decode(r);
        if (!visibleTo(c.user)(task)) fail(403, 'Sem acesso a esta tarefa.');
        if (v.revision !== task.revision) fail(409, 'Tarefa alterada em outra sessão. Atualize a agenda.');
        return task;
    };
    if (id && action === 'status' && req.method === 'PATCH') {
        if (!TASK_STATUS.includes(v.status)) fail(422, 'Situação inválida.');
        const task = await current();
        const data = { ...task, status: v.status, completedAt: v.status === 'done' ? new Date().toISOString() : '', completedBy: v.status === 'done' ? c.user.name : '' };
        delete data.id; delete data.revision; delete data.updatedAt;
        await db.prepare('UPDATE tasks SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(data), new Date().toISOString(), id, c.storeId);
        await audit(c, 'task.' + v.status, id);
        send(res, decode(await row(id)));
        return true;
    }
    if ((!id && req.method === 'POST') || (id && !action && req.method === 'PUT')) {
        const title = text(v.title, 160);
        if (!title) fail(422, 'Informe o título da tarefa.');
        const due = new Date(v.dueAt);
        if (typeof v.dueAt !== 'string' || Number.isNaN(due.getTime()) || due.getFullYear() < 2000 || due.getFullYear() > 2100) fail(422, 'Informe data e hora válidas.');
        if (!PRIORITIES.includes(v.priority)) fail(422, 'Prioridade inválida.');
        const assignedTo = c.user.role === 'seller' ? c.user.id : text(v.assignedTo, 64) || c.user.id;
        if (!(await db.prepare('SELECT id FROM users WHERE id=? AND store_id=? AND active=1').get(assignedTo, c.storeId)) && !(c.user.role === 'platform' && assignedTo === c.user.id)) fail(422, 'Responsável não pertence a esta loja.');
        const link = await validLink(db, c, v.link);
        const old = id ? await current() : null;
        const data = { title, notes: text(v.notes, 2000), dueAt: due.toISOString(), priority: v.priority, assignedTo, link, status: old?.status || 'open', completedAt: old?.completedAt || '', completedBy: old?.completedBy || '', createdBy: old?.createdBy || c.user.id, createdByName: old?.createdByName || c.user.name, createdAt: old?.createdAt || new Date().toISOString() };
        const key = id || randomUUID();
        if (old) await db.prepare('UPDATE tasks SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(data), new Date().toISOString(), key, c.storeId);
        else await db.prepare('INSERT INTO tasks VALUES(?,?,?,1,?)').run(key, c.storeId, JSON.stringify(data), new Date().toISOString());
        await audit(c, old ? 'task.update' : 'task.create', key);
        send(res, decode(await row(key)), old ? 200 : 201);
        return true;
    }
    fail(405, 'Método não permitido.');
}

// Central de pendências: cada item diz o que é, quão urgente está e para onde ir resolver.
export async function pendingReport(db, storeId, user) {
    const seller = user.role === 'seller', now = Date.now(), today = localToday(), endToday = startOfLocalDay(today) + DAY;
    const list = async (t) => (await db.prepare(`SELECT * FROM ${t} WHERE store_id=?`).all(storeId)).map(decode);
    const items = [];
    const push = (item) => items.push(item);

    for (const t of (await list('tasks')).filter(visibleTo(user)).filter((t) => t.status === 'open')) {
        const due = Date.parse(t.dueAt);
        if (due < now) push({ id: 'task-' + t.id, kind: 'task', severity: t.priority === 'low' ? 'medium' : 'high', title: t.title, detail: t.link ? t.link.label : 'Tarefa atrasada', date: t.dueAt, target: { screen: 'agenda', view: 'all', label: 'Agenda', focus: t.id } });
        else if (due < endToday) push({ id: 'task-' + t.id, kind: 'task', severity: 'medium', title: t.title, detail: 'Vence hoje' + (t.link ? ' · ' + t.link.label : ''), date: t.dueAt, target: { screen: 'agenda', view: 'all', label: 'Agenda', focus: t.id } });
    }
    for (const l of (await list('leads')).filter((l) => (!seller || l.assignedTo === user.id) && l.stage !== 'won' && l.stage !== 'lost')) {
        const due = l.nextContactAt ? Date.parse(l.nextContactAt) : null;
        if (due !== null && due < now) push({ id: 'lead-' + l.id, kind: 'lead', severity: 'high', title: `Retorno atrasado: ${l.name}`, detail: l.interest || l.source || 'Interessado', date: l.nextContactAt, target: { screen: 'crm', view: 'all', label: 'Funil de oportunidades', focus: l.id } });
        else if (l.stage === 'new' && !l.nextContactAt && l.createdAt && now - Date.parse(l.createdAt) > DAY) push({ id: 'lead-' + l.id, kind: 'lead', severity: 'medium', title: `Sem atendimento: ${l.name}`, detail: `Chegou há ${Math.floor((now - Date.parse(l.createdAt)) / DAY)} dias`, date: l.createdAt, target: { screen: 'crm', view: 'all', label: 'Funil de oportunidades', focus: l.id } });
    }
    if (!seller) {
        for (const e of (await list('ledger')).filter((e) => e.status === 'open' && e.dueDate < today)) {
            push({ id: 'ledger-' + e.id, kind: 'finance', severity: 'high', title: `${e.direction === 'income' ? 'Recebimento' : 'Pagamento'} atrasado: ${e.description}`, detail: e.customerName || '', amountCents: remainingCents(e), date: e.dueDate, target: { screen: 'finance', view: e.direction, label: e.direction === 'income' ? 'Contas a receber' : 'Contas a pagar', focus: e.id } });
        }
        const costs = new Map((await vehicleCosts(db, storeId)).map((x) => [x.vehicle.id, x]));
        for (const v of await list('vehicles')) {
            const label = linkLabel('vehicle', v), target = { screen: 'stock', view: 'all', label: 'Todo o estoque', focus: v.id };
            if (v.status === 'draft' && Date.parse(v.listedAt || v.updatedAt) < now - 15 * DAY) push({ id: 'draft-' + v.id, kind: 'vehicle', severity: 'low', title: `Rascunho parado: ${label}`, detail: 'Há mais de 15 dias fora do estoque publicado', date: v.updatedAt, target });
            if (['available', 'reserved'].includes(v.status)) {
                if (costs.get(v.id)?.costCents == null) push({ id: 'cost-' + v.id, kind: 'vehicle', severity: 'medium', title: `Custo de aquisição não informado: ${label}`, detail: 'Sem compra ou consignação registrada, a margem não pode ser calculada', date: v.updatedAt, target: { screen: 'purchases', view: 'all', label: 'Compras de veículos' } });
                if (!v.plate || !v.renavam || !v.chassis) push({ id: 'docs-' + v.id, kind: 'vehicle', severity: 'low', title: `Documentação incompleta: ${label}`, detail: ['placa', 'RENAVAM', 'chassi'].filter((_, i) => ![v.plate, v.renavam, v.chassis][i]).join(', ') + ' não informados', date: v.updatedAt, target });
            }
        }
        for (const d of (await list('deals')).filter((d) => d.status === 'proposal' && Date.parse(d.updatedAt) < now - 7 * DAY)) {
            push({ id: 'deal-' + d.id, kind: 'deal', severity: 'medium', title: 'Proposta sem movimento há mais de 7 dias', detail: `${(d.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, date: d.updatedAt, target: { screen: 'deals', view: 'proposal', label: 'Propostas', focus: d.id } });
        }
        for (const a of (await list('appraisals')).filter((a) => a.status === 'new' && now - Date.parse(a.createdAt) > DAY)) {
            push({ id: 'appraisal-' + a.id, kind: 'appraisal', severity: 'medium', title: `Avaliação aguardando: ${a.model} ${a.year}`, detail: a.name, date: a.createdAt, target: { screen: 'appraisals', view: 'all', label: 'Avaliações de usados' } });
        }
        for (const k of (await list('contracts')).filter((k) => k.status === 'draft' || k.status === 'sent')) {
            push({ id: 'contract-' + k.id, kind: 'contract', severity: 'low', title: `Contrato ${k.status === 'sent' ? 'aguardando assinatura' : 'em rascunho'}`, detail: k.number ? `Nº ${k.number}` : '', date: k.updatedAt, target: { screen: 'contracts', view: 'all', label: 'Contratos' } });
        }
        for (const p of (await list('preparations')).filter((p) => p.status === 'in_progress' && now - Date.parse(p.startedAt) > 10 * DAY)) {
            push({ id: 'prep-' + p.id, kind: 'vehicle', severity: 'medium', title: `Preparação longa: ${p.vehicleLabel}`, detail: `${Math.floor((now - Date.parse(p.startedAt)) / DAY)} dias em preparação`, date: p.startedAt, target: { screen: 'preparation', view: 'all', label: 'Preparação' } });
        }
    }
    const rank = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.date).localeCompare(String(b.date)));
    const counts = { high: 0, medium: 0, low: 0, total: items.length };
    for (const i of items) counts[i.severity]++;
    return { today, items, counts };
}
