import './env.mjs';
import { randomUUID } from 'node:crypto';

// Avisos de cliente novo: lead do site e pedido de avaliação.
// Ficam no sininho da retaguarda e, se configurado, também vão por e-mail (Resend).
//   RESEND_API_KEY      chave da conta Resend (resend.com)
//   DUNNA_NOTIFY_EMAIL   destinatário(s), separados por vírgula
//   DUNNA_NOTIFY_FROM    remetente (padrão: onboarding@resend.dev, que só entrega para o e-mail da conta Resend)
const text = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let fetchImpl = (...args) => fetch(...args);
/** Para testes: troca o fetch usado no envio de e-mail. */
export function setNotifyFetch(fn) { fetchImpl = fn; }

export async function installNotifications(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,created TEXT NOT NULL);CREATE INDEX IF NOT EXISTS notifications_store ON notifications(store_id,created);');
    await db.exec('CREATE TABLE IF NOT EXISTS notification_seen(user_id TEXT PRIMARY KEY REFERENCES users(id),seen TEXT NOT NULL);');
}

export function emailConfig(env = process.env) {
    const key = env.RESEND_API_KEY || '';
    const to = String(env.DUNNA_NOTIFY_EMAIL || '').split(',').map((e) => e.trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    return key && to.length ? { key, to, from: env.DUNNA_NOTIFY_FROM || 'Minha loja <onboarding@resend.dev>' } : null;
}

async function sendEmail(config, n, storeName) {
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#11151c"><p style="margin:0 0 6px;color:#d3161e;font-weight:bold">${escape(storeName)}</p><h2 style="margin:0 0 10px;font-size:19px">${escape(n.title)}</h2><p style="margin:0 0 16px;white-space:pre-line">${escape(n.body)}</p>${n.phone ? `<p style="margin:0 0 16px"><a href="https://wa.me/55${escape(n.phone)}" style="background:#d3161e;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:bold">Responder no WhatsApp</a></p>` : ''}<p style="margin:0;color:#5c6573;font-size:13px">Veja os detalhes na retaguarda.</p></div>`;
    const r = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: config.from, to: config.to, subject: `${n.title} · ${storeName}`, html }), signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('email ' + r.status);
}

/**
 * Registra o aviso e tenta mandar o e-mail. Falha no e-mail nunca impede o cadastro do cliente.
 * O envio é aguardado (com limite de tempo) porque na Vercel a função termina junto com a resposta.
 */
export async function notify(db, storeId, { type, title, body, phone = '', screen, refId = '' }) {
    const n = { type, title: text(title, 140), body: text(body, 600), phone: String(phone).replace(/\D/g, '').slice(0, 13), screen, refId, emailed: false };
    const id = randomUUID(), created = new Date().toISOString();
    const config = emailConfig();
    if (config) {
        try {
            const store = await db.prepare('SELECT name FROM stores WHERE id=?').get(storeId);
            await sendEmail(config, n, store?.name || 'Loja');
            n.emailed = true;
        } catch (e) {
            console.error('Aviso por e-mail:', e.message);
        }
    }
    await db.prepare('INSERT INTO notifications VALUES(?,?,?,?)').run(id, storeId, JSON.stringify(n), created);
}

export async function notificationRoute({ req, res, route, c, db, send }) {
    if (!route.startsWith('/api/admin/notifications')) return false;
    // Leads do site chegam sem responsável e avaliações são tratadas pela gerência: avisos só para administradores
    const visible = () => c.user.role !== 'seller';
    if (route === '/api/admin/notifications' && req.method === 'GET') {
        const seen = (await db.prepare('SELECT seen FROM notification_seen WHERE user_id=?').get(c.user.id))?.seen || '';
        const rows = (await db.prepare('SELECT * FROM notifications WHERE store_id=? ORDER BY created DESC LIMIT 60').all(c.storeId))
            .map((r) => ({ ...JSON.parse(r.data), id: r.id, created: r.created }))
            .filter(visible);
        send(res, { items: rows.slice(0, 30).map((n) => ({ ...n, unread: n.created > seen })), unread: rows.filter((n) => n.created > seen).length, email: !!emailConfig() });
        return true;
    }
    if (route === '/api/admin/notifications/seen' && req.method === 'POST') {
        const seen = new Date().toISOString();
        await db.prepare('INSERT INTO notification_seen VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET seen=excluded.seen').run(c.user.id, seen);
        send(res, { seen });
        return true;
    }
    return false;
}

/** Lead do formulário de contato da vitrine (o WhatsApp abre em seguida no navegador do cliente). */
export async function publicLeadRoute({ req, res, route, db, body, send, limit, ip }) {
    if (route !== '/api/public/leads' || req.method !== 'POST') return false;
    await limit('public-lead:' + ip);
    const v = await body(req, 8000);
    const store = await db.prepare('SELECT * FROM stores WHERE slug=?').get(text(v?.store, 80) || 'minha-loja');
    if (!store) throw Object.assign(new Error('Loja não encontrada.'), { status: 404 });
    const name = text(v?.name, 80), phone = text(v?.phone, 20).replace(/\D/g, '');
    if (name.length < 2 || !/^[1-9]{2}\d{8,9}$/.test(phone)) throw Object.assign(new Error('Informe nome e WhatsApp com DDD.'), { status: 422 });
    const car = text(v?.car, 120), budget = text(v?.budget, 60), notes = text(v?.notes, 1500);
    const now = new Date().toISOString(), id = randomUUID();
    const details = [car && `Procura: ${car}`, budget && `Investimento: ${budget}`, notes].filter(Boolean).join('\n');
    const lead = { id, name, phone, interest: car || 'Contato pelo site', source: 'Site (formulário de contato)', stage: 'new', assignedTo: '', nextContactAt: '', lossReason: '', history: [{ id: randomUUID(), text: details || 'Pediu contato pelo site.', author: 'Vitrine', at: now }], createdAt: now };
    await db.prepare('INSERT INTO leads VALUES(?,?,?,1,?)').run(id, store.id, JSON.stringify(lead), now);
    await notify(db, store.id, { type: 'lead', title: `Novo contato: ${name}`, body: details || 'Pediu contato pelo site.', phone, screen: 'crm', refId: id });
    send(res, { ok: true }, 201);
    return true;
}
