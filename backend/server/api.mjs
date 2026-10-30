import './env.mjs';
import { backendRoot, repositoryRoot } from './paths.mjs';
import { installAnalytics, recordEngagement, engagementReport } from './analytics.mjs';
import { installInventoryOperations, consignmentRoute } from './inventory-operations.mjs';
import { installPurchases, purchaseRoute } from './purchases.mjs';
import { installPerformance, performanceRoute } from './performance.mjs';
import { fipeRoute } from './fipe.mjs';
import { installFiles, createFiles, createSupabaseFiles } from './files.mjs';
import { installAppraisals, publicAppraisalRoute, appraisalRoute } from './appraisals.mjs';
import { installContracts, contractRoute } from './contracts.mjs';
import { installStockflow, stockflowRoute } from './stockflow.mjs';
import { dashboardRoute } from './dashboard.mjs';
import { installAgenda, agendaRoute } from './agenda.mjs';
import { installFinance, financeRoute } from './finance.mjs';
import { installTags, tagRoute } from './search.mjs';
import { insightsRoute } from './insights.mjs';
import { installNotifications, notificationRoute, publicLeadRoute } from './notifications.mjs';
import { installCommercial, commercialRoute } from './commercial.mjs';
import { installRenave, readRenave, saveRenave } from './renave.mjs';
import { generateDescription } from './ai.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
// Mesma origem, ou um domínio do front listado em DUNNA_ALLOWED_ORIGINS (front e API em deploys separados).
const allowedOrigins = () => (process.env.DUNNA_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
export function originAllowed(origin, host) {
    let url;
    try { url = new URL(origin); } catch { return false; }
    return url.host === host || allowedOrigins().includes(url.origin);
}
const scrypt = promisify(derive), now = () => new Date().toISOString(), sha = s => createHash('sha256').update(s).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const clientAddress = req => process.env.VERCEL === '1' ? String(req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim().slice(0,100) : req.socket.remoteAddress;
const statuses = ['available', 'reserved', 'sold', 'draft'], stages = ['new', 'contact', 'qualified', 'proposal', 'won', 'lost'];
async function body(req, limit = 150000) { if(req.body !== undefined){const bytes=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));if(bytes.length>limit)fail(413,'Limite de tamanho excedido.');if(req.headers['content-type']?.startsWith('application/json')){try{return JSON.parse(bytes.toString())}catch{fail(400,'JSON inválido.')}}return bytes}let n = 0; const chunks = []; for await (const c of req) {
    n += c.length;
    if (n > limit)
        fail(413, 'Limite de tamanho excedido.');
    chunks.push(c);
} const raw = Buffer.concat(chunks); if (req.headers['content-type']?.startsWith('application/json')) {
    try {
        return JSON.parse(raw.toString() || '{}');
    }
    catch {
        fail(400, 'JSON inválido.');
    }
} return raw; }
async function hashPassword(p) { const salt = randomBytes(16).toString('hex'); return salt + ':' + (await scrypt(p, salt, 64)).toString('hex'); }
async function checkPassword(p, hash) { const [salt, expected] = hash.split(':'); return timingSafeEqual(await scrypt(p, salt, 64), Buffer.from(expected, 'hex')); }
function account(v) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(v.email)))
    fail(422, 'E-mail inválido.'); if (!text(v.name))
    fail(422, 'Nome obrigatório.'); if (typeof v.password !== 'string' || v.password.length < 12 || v.password.length > 200)
    fail(422, 'Use uma senha entre 12 e 200 caracteres.'); }
export function validateVehicle(v) {
    for (const k of ['brand', 'model', 'version', 'color'])
        if (!text(v[k], 100))
            fail(422, 'Preencha marca, modelo, versão e cor.');
    for (const k of ['year', 'yearMade'])
        if (!Number.isInteger(v[k]) || v[k] < 1900 || v[k] > new Date().getFullYear() + 1)
            fail(422, 'Ano inválido.');
    if (v.yearMade > v.year)
        fail(422, 'Fabricação posterior ao modelo.');
    if (!Number.isFinite(v.price) || v.price <= 0 || v.price > 1e8)
        fail(422, 'Preço inválido.');
    if (!Number.isInteger(v.mileage) || v.mileage < 0 || v.mileage > 1e7)
        fail(422, 'Quilometragem inválida.');
    if (!['Automático', 'Manual', 'Automatizado'].includes(v.transmission) || !['SUV', 'Sedan', 'Hatch', 'Picape'].includes(v.body) || !['Flex', 'Gasolina', 'Diesel', 'Híbrido', 'Elétrico'].includes(v.fuel) || !['Novo', 'Seminovo'].includes(v.condition) || !statuses.includes(v.status))
        fail(422, 'Classificação ou disponibilidade inválida.');
    if (!Array.isArray(v.images) || v.images.length > 30 || v.images.some(s => typeof s !== 'string' || !/^\/(veiculos|uploads)\/[a-zA-Z0-9_./-]+$/.test(s) || s.includes('..')))
        fail(422, 'Fotos inválidas.');
    if (v.status !== 'draft' && !v.images.length)
        fail(422, 'Adicione uma foto para publicar.');
    if (v.fipe != null && (!Number.isFinite(v.fipe) || v.fipe <= 0))
        fail(422, 'FIPE inválida.');
    // Dados de documento (internos, usados nos contratos): placa antiga ou Mercosul, RENAVAM com 11 dígitos, chassi com 17
    const plate = text(v.plate, 12).toUpperCase().replace(/[^A-Z0-9]/g, ''), renavam = text(v.renavam, 24).replace(/\D/g, ''), chassis = text(v.chassis, 30).toUpperCase().replace(/\s/g, '');
    if (plate && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate))
        fail(422, 'Placa inválida.');
    if (renavam && !/^\d{11}$/.test(renavam))
        fail(422, 'RENAVAM deve ter 11 dígitos.');
    if (chassis && !/^[A-HJ-NPR-Z0-9]{17}$/.test(chassis))
        fail(422, 'Chassi deve ter 17 caracteres (sem I, O e Q).');
    return { id: text(v.id), brand: text(v.brand, 100), model: text(v.model, 100), version: text(v.version, 100), color: text(v.color, 100), year: v.year, yearMade: v.yearMade, price: v.price, mileage: v.mileage, transmission: v.transmission, body: v.body, fuel: v.fuel, condition: v.condition, status: v.status, fipe: v.fipe, armored: !!v.armored, badge: ['Abaixo da FIPE', 'Único Dono', 'Destaque', 'Recém Chegado'].includes(v.badge) ? v.badge : undefined, documentation: text(v.documentation, 3000), description: text(v.description, 5000), images: v.images, options: (Array.isArray(v.options) ? v.options : []).slice(0, 60).map(s => text(s, 120)).filter(Boolean), specs: (Array.isArray(v.specs) ? v.specs : []).slice(0, 30).map(s => ({ label: text(s.label, 80), value: text(s.value, 160) })).filter(s => s.label && s.value), sellerId: typeof v.sellerId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v.sellerId) ? v.sellerId : undefined, fipeCode: v.fipe != null && typeof v.fipeCode === 'string' && /^\d{6}-\d$/.test(v.fipeCode) ? v.fipeCode : undefined, fipeReference: v.fipe != null ? text(v.fipeReference, 40) || undefined : undefined, plate: plate || undefined, renavam: renavam || undefined, chassis: chassis || undefined };
}
export async function createApi({ database, storage, privateFiles, root = backendRoot, dataDir = process.env.DUNNA_DATA_DIR || path.join(repositoryRoot, 'data'), seed, aiKey = process.env.OPENAI_API_KEY, aiModel = process.env.OPENAI_MODEL || 'gpt-5-mini', aiFetch = globalThis.fetch } = {}) {
    if (!database) mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    const db = database || new DatabaseSync(path.join(dataDir, 'dunna.sqlite'));
    (await db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,city TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS vehicles(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS vehicles_store ON vehicles(store_id);
 CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS leads_store ON leads(store_id);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,store_id TEXT,user_id TEXT,action TEXT NOT NULL,entity_id TEXT,created TEXT NOT NULL);`));
    if (!(await db.prepare('SELECT id FROM stores LIMIT 1').get())) {
        (await db.exec('BEGIN'));
        try {
            (await db.prepare('INSERT INTO stores VALUES(?,?,?,?,?,?)').run('principal', 'minha-loja', 'Minha loja', '', '', now()));
            const insert = db.prepare('INSERT INTO vehicles VALUES(?,?,?,1,?)');
            for (const v of seed ?? [])
                (await insert.run(v.id, 'principal', JSON.stringify({ ...v, status: statuses.includes(v.status) ? v.status : 'available', documentation: '' }), now()));
            (await db.exec('COMMIT'));
        }
        catch (e) {
            (await db.exec('ROLLBACK'));
            throw e;
        }
    }
    (await installCommercial(db));
    (await installPurchases(db));
    (await installPerformance(db));
    (await installInventoryOperations(db));
    (await installAnalytics(db));
    (await installRenave(db));
    (await installFiles(db));
    (await installAppraisals(db));
    (await installContracts(db));
    (await installStockflow(db));
    (await installNotifications(db));
    (await installAgenda(db));
    (await installFinance(db));
    (await installTags(db));
    // Arquivos privados: Supabase quando a API roda na nuvem (com armazenamento de fotos), senão pasta local
    const files = createFiles({ db, dataDir, remote: privateFiles !== undefined ? privateFiles : storage ? createSupabaseFiles() : null });
    const audit = async (c, a, id) => (await db.prepare('INSERT INTO audit(store_id,user_id,action,entity_id,created) VALUES(?,?,?,?,?)').run(c.storeId, c.user.id, a, id, now()));
    const decode = r => ({ ...JSON.parse(r.data), revision: r.revision, updatedAt: r.updated });
    const viewUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, storeId: u.store_id });
    const cookie = req => req.headers.cookie?.match(/(?:^|;\s*)dunna_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const userFor = async (req) => { const t = cookie(req); return t ? (await db.prepare('SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1').get(sha(t), Date.now())) : null; };
    const context = async (req, write = false) => { const user = (await userFor(req)); if (!user)
        fail(401, 'Entre novamente para continuar.'); const requested = text(req.headers['x-store-id']); const storeId = user.role === 'platform' && requested ? requested : user.store_id; if (requested && requested !== storeId)
        fail(403, 'Sem permissão para esta loja.'); if (!(await db.prepare('SELECT id FROM stores WHERE id=?').get(storeId)))
        fail(404, 'Loja não encontrada.'); if (write && user.role === 'seller')
        fail(403, 'Somente administradores podem alterar este recurso.'); return { user, storeId }; };
    const login = async (res, user) => { (await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now())); const t = randomBytes(32).toString('hex'); (await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(t), user.id, Date.now() + 28800000)); res.setHeader('Set-Cookie', `dunna_session=${t}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${(process.env.COOKIE_SECURE === 'true' || process.env.VERCEL === '1') ? '; Secure' : ''}`); };
    const analyticsLimits = new Map();
    await db.exec('CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,deadline INTEGER NOT NULL);');
    const attempts = new Map();
    const limit = async key => { if(db.isPostgres){const k=sha(key||'unknown'),time=Date.now();await db.prepare('DELETE FROM login_attempts WHERE deadline<?').run(time);const old=await db.prepare('SELECT * FROM login_attempts WHERE key=?').get(k);if(old&&old.count>=8)fail(429,'Muitas tentativas. Aguarde 15 minutos.');await db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=login_attempts.count+1').run(k,time+900000);return} const r = attempts.get(key); if (r && r.until > Date.now() && r.count >= 8)
        fail(429, 'Muitas tentativas. Aguarde 15 minutos.'); if (!r || r.until < Date.now())
        attempts.set(key, { count: 1, until: Date.now() + 900000 });
    else
        r.count++; if (attempts.size > 1000)
        for (const [k, v] of attempts)
            if (v.until < Date.now())
                attempts.delete(k); };
    const send = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    async function handler(req, res, next = () => { res.writeHead(404); res.end(); }) {
        const url = new URL(req.url, 'http://localhost'), route = url.pathname;
        if (!route.startsWith('/api/') && !route.startsWith('/uploads/'))
            return next();
        try {
            if (route.startsWith('/uploads/') && req.method === 'GET') {
                const filename = route.slice(9);
                if (!/^[a-zA-Z0-9-]+\.(jpg|png|webp)$/.test(filename))
                    fail(404, 'Foto não encontrada.');
                if(storage){const user=await userFor(req);const rows=await db.prepare('SELECT store_id,data FROM vehicles').all();const allowed=rows.some(row=>{const v=JSON.parse(row.data);return v.images?.includes('/uploads/'+filename)&&(['available','reserved'].includes(v.status)||user&&(user.role==='platform'||user.store_id===row.store_id))})||user&&filename.startsWith(user.store_id+'-');if(!allowed)fail(404,'Foto não encontrada.');const photo=await storage.get(filename);if(!photo)fail(404,'Foto não encontrada.');res.writeHead(200,{'Content-Type':photo.type,'Cache-Control':'private,max-age=300','X-Content-Type-Options':'nosniff'});res.end(photo.bytes);return}
                const file = path.join(dataDir, 'uploads', filename);
                if (!existsSync(file))
                    fail(404, 'Foto não encontrada.');
                res.writeHead(200, { 'Content-Type': ({ 'jpg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp' })[filename.split('.').pop()], 'Cache-Control': 'public,max-age=31536000,immutable', 'X-Content-Type-Options': 'nosniff' });
                res.end(readFileSync(file));
                return;
            }
            if (!['GET', 'HEAD'].includes(req.method)) {
                if (req.headers['x-dunna-request'] !== '1')
                    fail(403, 'Requisição não autorizada.');
                if (req.headers.origin && !originAllowed(req.headers.origin, req.headers.host))
                    fail(403, 'Origem não autorizada.');
            }
            if (route === '/api/auth/status' && req.method === 'GET') {
                const u = (await userFor(req));
                return send(res, { needsSetup: !(await db.prepare('SELECT id FROM users LIMIT 1').get()), user: u ? viewUser(u) : null });
            }
            if (route === '/api/auth/setup' && req.method === 'POST') {
                if (process.env.VERCEL === '1' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
                    fail(403, 'Configure o primeiro acesso no computador do servidor.');
                await limit('setup:' + req.socket.remoteAddress);
                if ((await db.prepare('SELECT id FROM users LIMIT 1').get()))
                    fail(409, 'Primeiro acesso já configurado.');
                const v = await body(req);
                account(v);
                const hash = await hashPassword(v.password);
                if ((await db.prepare('SELECT id FROM users LIMIT 1').get()))
                    fail(409, 'Primeiro acesso já configurado.');
                const id = randomUUID();
                (await db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,1,?)').run(id, 'principal', text(v.name), text(v.email).toLowerCase(), hash, 'platform', now()));
                // Dados da primeira loja informados no primeiro acesso (opcionais)
                const storeName = text(v.storeName, 120), storeCity = text(v.storeCity, 120), storePhone = String(v.storePhone || '').replace(/\D/g, '').slice(0, 11);
                if (storeName)
                    (await db.prepare('UPDATE stores SET name=?,city=?,phone=? WHERE id=?').run(storeName, storeCity, storePhone, 'principal'));
                const u = (await db.prepare('SELECT * FROM users WHERE id=?').get(id));
                (await login(res, u));
                return send(res, { user: viewUser(u) }, 201);
            }
            if (route === '/api/auth/login' && req.method === 'POST') {
                await limit(clientAddress(req));
                const v = await body(req);
                const u = (await db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(text(v.email).toLowerCase()));
                if (!u || typeof v.password !== 'string' || v.password.length > 200 || !await checkPassword(v.password, u.password))
                    fail(401, 'E-mail ou senha incorretos.');
                attempts.delete(clientAddress(req));if(db.isPostgres)await db.prepare('DELETE FROM login_attempts WHERE key=?').run(sha(clientAddress(req)||'unknown'));
                (await login(res, u));
                return send(res, { user: viewUser(u) });
            }
            if (route === '/api/auth/logout' && req.method === 'POST') {
                const t = cookie(req);
                if (t)
                    (await db.prepare('DELETE FROM sessions WHERE token=?').run(sha(t)));
                res.setHeader('Set-Cookie', 'dunna_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
                return send(res, { ok: true });
            }
            if (route === '/api/account') {
                const user = (await userFor(req));
                if (!user)
                    fail(401, 'Entre novamente para continuar.');
                const profile = async (u) => ({ user: viewUser(u), store: (await db.prepare('SELECT id,name,city FROM stores WHERE id=?').get(u.store_id)) });
                if (req.method === 'GET')
                    return send(res, (await profile(user)));
                if (req.method !== 'PUT')
                    fail(405, 'Método não permitido.');
                const v = await body(req);
                if (!v || typeof v !== 'object')
                    fail(422, 'Dados inválidos.');
                const name = text(v.name), email = text(v.email).toLowerCase();
                if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
                    fail(422, 'Informe nome e e-mail válidos.');
                if (v.expectedName !== user.name || v.expectedEmail !== user.email)
                    fail(409, 'Seu perfil foi alterado em outra sessão. Recarregue antes de salvar.');
                const changePassword = typeof v.newPassword === 'string' && v.newPassword.length > 0, securityChange = changePassword || email !== user.email;
                let password = user.password;
                if (securityChange) {
                    await limit('account:' + user.id);
                    if (typeof v.currentPassword !== 'string' || v.currentPassword.length > 200 || !await checkPassword(v.currentPassword, user.password))
                        fail(403, 'Senha atual incorreta.');
                    if (changePassword) {
                        if (v.newPassword.length < 12 || v.newPassword.length > 200)
                            fail(422, 'A nova senha precisa ter entre 12 e 200 caracteres.');
                        password = await hashPassword(v.newPassword);
                    }
                }
                // Recheck after password derivation, which yields while other requests can run.
                const current = (await userFor(req));
                if (!current)
                    fail(401, 'Entre novamente para continuar.');
                if (current.name !== user.name || current.email !== user.email || current.password !== user.password)
                    fail(409, 'Seu perfil foi alterado em outra sessão. Recarregue antes de salvar.');
                if ((await db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, user.id)))
                    fail(409, 'Este e-mail já está em uso.');
                (await db.exec('BEGIN IMMEDIATE'));
                try {
                    (await db.prepare('UPDATE users SET name=?,email=?,password=? WHERE id=?').run(name, email, password, user.id));
                    (await audit({ user, storeId: user.store_id }, securityChange ? 'account.security.update' : 'account.profile.update', user.id));
                    if (securityChange)
                        (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id));
                    (await db.exec('COMMIT'));
                }
                catch (e) {
                    (await db.exec('ROLLBACK'));
                    throw e;
                }
                const updated = (await db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
                if (securityChange)
                    (await login(res, updated));
                return send(res, { ...(await profile(updated)), sessionsReset: securityChange });
            }
            if (route === '/api/stock' && req.method === 'GET') {
                const store = (await db.prepare('SELECT * FROM stores WHERE slug=?').get(url.searchParams.get('store') || 'minha-loja'));
                if (!store)
                    fail(404, 'Loja não encontrada.');
                const sellers = new Map((await db.prepare("SELECT id,name FROM users WHERE store_id=? AND active=1 AND role IN ('admin','seller')").all(store.id)).map(u => [u.id, u.name]));
                const vehicles = (await db.prepare('SELECT * FROM vehicles WHERE store_id=? ORDER BY updated DESC,id').all(store.id)).map(decode).filter(v => ['available', 'reserved'].includes(v.status)).map(v => { const seller = sellers.get(v.sellerId); delete v.documentation; delete v.revision; delete v.updatedAt; delete v.sellerId; delete v.plate; delete v.renavam; delete v.chassis; delete v.priceHistory; delete v.listedAt; if (seller) v.seller = { name: seller }; return v; });
                return send(res, { store, vehicles });
            }
            if (route === '/api/analytics/event' && req.method === 'POST') {
                if ((await userFor(req)))
                    return send(res, { ok: true, excluded: true });
                const key = req.socket.remoteAddress, now = Date.now(), old = analyticsLimits.get(key);
                if (old && now - old.started < 600000) {
                    if (old.count >= 1200)
                        fail(429, 'Limite de eventos atingido.');
                    old.count++;
                }
                else
                    analyticsLimits.set(key, { started: now, count: 1 });
                if (analyticsLimits.size > 2000)
                    for (const [k, v] of analyticsLimits)
                        if (now - v.started >= 600000)
                            analyticsLimits.delete(k);
                return send(res, (await recordEngagement(db, await body(req, 5000))));
            }
            if (route === '/api/files/upload' && req.method === 'PUT') {
                await files.receiveLocal(url.searchParams.get('name') || '', await body(req, 50 * 1024 * 1024));
                return send(res, { ok: true }, 201);
            }
            if (await publicLeadRoute({ req, res, route, db, body, send, limit, ip: clientAddress(req) }))
                return;
            if (await publicAppraisalRoute({ req, res, route, db, body, send, files, limit, ip: clientAddress(req) }))
                return;
            if (!route.startsWith('/api/admin/'))
                fail(404, 'Recurso não encontrado.');
            const c = (await context(req));
            if (route === '/api/admin/analytics' && req.method === 'GET') {
                (await context(req, true));
                return send(res, (await engagementReport(db, c.storeId, Number(url.searchParams.get('days') || 30))));
            }
            if (await notificationRoute({ req, res, route, c, db, send }))
                return;
            if (await dashboardRoute({ req, res, route, c, db, send }))
                return;
            if (await agendaRoute({ req, res, route, c, db, body, send, audit }))
                return;
            if (await tagRoute({ req, res, route, c, db, body, send, admin: async () => (await context(req, true)), audit }))
                return;
            if (await financeRoute({ req, res, route, c, db, body, send, admin: async () => (await context(req, true)), audit }))
                return;
            if (await insightsRoute({ req, res, route, c, db, send, admin: async () => (await context(req, true)) }))
                return;
            if (await consignmentRoute({ req, res, route, c, db, body, send, admin: async () => (await context(req, true)), audit }))
                return;
            if (await performanceRoute({ req, res, route, c, db, body, send, admin: async () => (await context(req, true)), audit }))
                return;
            if (await fipeRoute({ req, res, route, send }))
                return;
            if (await purchaseRoute({ req, res, route, c, db, body, send, admin: async () => (await context(req, true)), audit }))
                return;
            if (await commercialRoute({ req, res, route, c, db, body, send, admin: async () => (await context(req, true)), audit }))
                return;
            if (route.startsWith('/api/admin/files/') && req.method === 'GET') {
                (await context(req, true));
                const name = decodeURIComponent(route.slice('/api/admin/files/'.length));
                if (!(await files.owns(c.storeId, name)))
                    fail(404, 'Arquivo não encontrado.');
                return await files.serve(req, res, name);
            }
            if (route.startsWith('/api/admin/appraisals')) {
                (await context(req, true));
                if (await appraisalRoute({ req, res, route, c, db, body, send, audit }))
                    return;
            }
            if (await contractRoute({ req, res, route, c, db, body, send, admin: async () => (await context(req, true)), audit, files }))
                return;
            if (await stockflowRoute({ req, res, route, c, db, body, send, admin: async () => (await context(req, true)), audit }))
                return;
            if (route === '/api/admin/renave') {
                (await context(req, true));
                if (req.method === 'GET')
                    return send(res, (await readRenave(db, c.storeId)));
                if (req.method === 'PUT') {
                    const result = (await saveRenave(db, c.storeId, await body(req)));
                    (await audit(c, 'renave.preparation.update', c.storeId));
                    return send(res, result);
                }
                fail(405, 'Método não permitido.');
            }
            if (route.startsWith('/api/admin/renave/')) {
                (await context(req, true));
                fail(503, 'RENAVE ainda não conectado. Credenciamento, contrato, certificado e homologação são necessários para habilitar operações oficiais.');
            }
            if (route === '/api/admin/ai/status' && req.method === 'GET') {
                (await context(req, true));
                return send(res, { configured: !!aiKey, model: aiModel });
            }
            if (route === '/api/admin/ai/description' && req.method === 'POST') {
                (await context(req, true));
                if (!aiKey)
                    fail(503, 'A geração com IA ainda não foi ativada. Configure OPENAI_API_KEY no servidor.');
                const input = await body(req), vehicle = validateVehicle({ ...input.vehicle, status: 'draft' });
                if (vehicle.id && !(await db.prepare('SELECT id FROM vehicles WHERE id=? AND store_id=?').get(vehicle.id, c.storeId)))
                    fail(404, 'Veículo não encontrado.');
                const since = new Date(Date.now() - 3600000).toISOString();
                const count = (await db.prepare("SELECT count(*) as n FROM audit WHERE store_id=? AND action='ai.description.request' AND created>?").get(c.storeId, since)).n;
                if (count >= 20)
                    fail(429, 'Esta loja atingiu o limite de 20 gerações por hora. Tente mais tarde.');
                (await audit(c, 'ai.description.request', vehicle.id || 'new'));
                const store = (await db.prepare('SELECT name,city FROM stores WHERE id=?').get(c.storeId));
                const result = await generateDescription(vehicle, store, { apiKey: aiKey, model: aiModel, fetchImpl: aiFetch });
                return send(res, result);
            }
            if (route === '/api/admin/stores') {
                if (req.method === 'GET')
                    return send(res, c.user.role === 'platform' ? (await db.prepare('SELECT * FROM stores ORDER BY created').all()) : (await db.prepare('SELECT * FROM stores WHERE id=?').all(c.storeId)));
                if (req.method === 'POST') {
                    if (c.user.role !== 'platform')
                        fail(403, 'Apenas o administrador da plataforma pode criar lojas.');
                    const v = await body(req), slug = text(v.slug, 60).toLowerCase();
                    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !text(v.name) || !/^\d{10,11}$/.test(v.phone) || !text(v.city))
                        fail(422, 'Preencha nome, identificador, telefone com DDD e cidade.');
                    if ((await db.prepare('SELECT id FROM stores WHERE slug=?').get(slug)))
                        fail(409, 'Identificador já utilizado.');
                    const id = randomUUID();
                    (await db.prepare('INSERT INTO stores VALUES(?,?,?,?,?,?)').run(id, slug, text(v.name), v.phone, text(v.city), now()));
                    (await audit(c, 'store.create', id));
                    return send(res, (await db.prepare('SELECT * FROM stores WHERE id=?').get(id)), 201);
                }
            }
            if (route === '/api/admin/users') {
                (await context(req, true));
                if (req.method === 'GET')
                    return send(res, (await db.prepare('SELECT id,name,email,role,active FROM users WHERE store_id=? ORDER BY name').all(c.storeId)));
                if (req.method === 'POST') {
                    const v = await body(req);
                    account(v);
                    if (!['admin', 'seller'].includes(v.role))
                        fail(422, 'Permissão inválida.');
                    if ((await db.prepare('SELECT id FROM users WHERE email=?').get(text(v.email).toLowerCase())))
                        fail(409, 'E-mail já cadastrado.');
                    const id = randomUUID(), hash = await hashPassword(v.password);
                    (await db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,1,?)').run(id, c.storeId, text(v.name), text(v.email).toLowerCase(), hash, v.role, now()));
                    (await audit(c, 'user.create', id));
                    return send(res, { id }, 201);
                }
            }
            const um = route.match(/^\/api\/admin\/users\/([a-zA-Z0-9-]+)$/);
            if (um && req.method === 'PATCH') {
                (await context(req, true));
                const v = await body(req), u = (await db.prepare('SELECT * FROM users WHERE id=? AND store_id=?').get(um[1], c.storeId));
                if (!u || u.role === 'platform')
                    fail(404, 'Usuário não encontrado.');
                if (u.id === c.user.id)
                    fail(422, 'Não é possível desativar seu próprio acesso.');
                (await db.prepare('UPDATE users SET active=? WHERE id=?').run(v.active ? 1 : 0, u.id));
                if (!v.active)
                    (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id));
                (await audit(c, 'user.access', u.id));
                return send(res, { ok: true });
            }
            if (route === '/api/admin/stock' && req.method === 'GET')
                return send(res, (await db.prepare('SELECT * FROM vehicles WHERE store_id=? ORDER BY updated DESC,id').all(c.storeId)).map(decode));
            const vm = route.match(/^\/api\/admin\/stock\/([a-zA-Z0-9-]+)$/);
            if ((route === '/api/admin/stock' && req.method === 'POST') || (vm && req.method === 'PUT')) {
                (await context(req, true));
                const v = await body(req), car = validateVehicle(v.vehicle), id = vm ? vm[1] : randomUUID();
                car.id = id;
                if (car.sellerId && !(await db.prepare("SELECT id FROM users WHERE id=? AND store_id=? AND active=1 AND role IN ('admin','seller')").get(car.sellerId, c.storeId)))
                    fail(422, 'Vendedor inválido para esta loja.');
                if (vm) {
                    const old = (await db.prepare('SELECT * FROM vehicles WHERE id=? AND store_id=?').get(id, c.storeId));
                    if (!old)
                        fail(404, 'Veículo não encontrado.');
                    if (v.revision !== old.revision)
                        fail(409, 'Veículo alterado em outra sessão. Atualize o painel.');
                    // Campos internos que o formulário não envia: entrada no estoque e histórico de preço
                    const previous = JSON.parse(old.data);
                    car.listedAt = previous.listedAt;
                    car.priceHistory = previous.priceHistory || [];
                    if (previous.price !== car.price)
                        car.priceHistory = [...car.priceHistory, { from: previous.price, to: car.price, at: now(), by: c.user.name }].slice(-50);
                    (await db.prepare('UPDATE vehicles SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(car), now(), id, c.storeId));
                }
                else
                    (await db.prepare('INSERT INTO vehicles VALUES(?,?,?,1,?)').run(id, c.storeId, JSON.stringify({ ...car, listedAt: now(), priceHistory: [] }), now()));
                (await audit(c, vm ? 'vehicle.update' : 'vehicle.create', id));
                return send(res, decode((await db.prepare('SELECT * FROM vehicles WHERE id=?').get(id))), vm ? 200 : 201);
            }
            if (route === '/api/admin/upload' && req.method === 'POST') {
                (await context(req, true));
                const b = await body(req, 4 * 1024 * 1024);
                const ext = b.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpg' : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
                if (!ext)
                    fail(422, 'Use JPG, PNG ou WebP válido de até 4 MB.');
                const name = `${c.storeId}-${randomUUID()}.${ext}`;
                if(storage) await storage.put(name,b,({'jpg':'image/jpeg','png':'image/png','webp':'image/webp'})[ext]);else writeFileSync(path.join(dataDir, 'uploads', name), b, { flag: 'wx' });
                (await audit(c, 'photo.upload', name));
                return send(res, { url: '/uploads/' + name }, 201);
            }
            if (route === '/api/admin/leads' && req.method === 'GET') {
                const rows = (await db.prepare('SELECT * FROM leads WHERE store_id=? ORDER BY updated DESC').all(c.storeId)).map(decode);
                return send(res, c.user.role === 'seller' ? rows.filter(l => l.assignedTo === c.user.id) : rows);
            }
            const lm = route.match(/^\/api\/admin\/leads\/([a-zA-Z0-9-]+)$/);
            if ((route === '/api/admin/leads' && req.method === 'POST') || (lm && req.method === 'PUT')) {
                const v = await body(req), id = lm ? lm[1] : randomUUID(), row = lm && (await db.prepare('SELECT * FROM leads WHERE id=? AND store_id=?').get(id, c.storeId));
                if (lm && !row)
                    fail(404, 'Interessado não encontrado.');
                const old = row ? decode(row) : null;
                if (c.user.role === 'seller' && old && old.assignedTo !== c.user.id)
                    fail(403, 'Sem acesso a este interessado.');
                if (old && v.revision !== old.revision)
                    fail(409, 'Cadastro alterado. Atualize o painel.');
                const assignedTo = c.user.role === 'seller' ? c.user.id : text(v.assignedTo);
                if (assignedTo && !(await db.prepare('SELECT id FROM users WHERE id=? AND store_id=? AND active=1').get(assignedTo, c.storeId)))
                    fail(422, 'Vendedor não pertence a esta loja.');
                if (!text(v.name) || !/^\d{10,11}$/.test(v.phone) || !stages.includes(v.stage))
                    fail(422, 'Preencha nome, telefone com DDD e etapa.');
                // Próximo contato: data/hora ISO; some sozinho quando o lead é ganho ou perdido
                const closed = v.stage === 'won' || v.stage === 'lost';
                let nextContactAt = '';
                if (!closed && v.nextContactAt) {
                    const when = new Date(v.nextContactAt);
                    if (typeof v.nextContactAt !== 'string' || Number.isNaN(when.getTime()) || when.getFullYear() < 2000 || when.getFullYear() > 2100)
                        fail(422, 'Data do próximo contato inválida.');
                    nextContactAt = when.toISOString();
                }
                const lossReason = v.stage === 'lost' ? text(v.lossReason, 120) : '';
                if (v.stage === 'lost' && !lossReason)
                    fail(422, 'Informe o motivo da perda.');
                const history = old?.history || [];
                if (lossReason && lossReason !== old?.lossReason)
                    history.push({ id: randomUUID(), text: `Motivo da perda: ${lossReason}`, author: c.user.name, at: now() });
                if (text(v.note, 2000))
                    history.push({ id: randomUUID(), text: text(v.note, 2000), author: c.user.name, at: now() });
                if (old && old.stage !== v.stage)
                    history.push({ id: randomUUID(), text: `Etapa: ${old.stage} → ${v.stage}`, author: c.user.name, at: now() });
                const lead = { id, name: text(v.name), phone: v.phone, interest: text(v.interest), source: text(v.source) || 'Cadastro manual', stage: v.stage, assignedTo, nextContactAt, lossReason, history: history.slice(-200), createdAt: old?.createdAt || now() };
                if (old)
                    (await db.prepare('UPDATE leads SET data=?,revision=revision+1,updated=? WHERE id=? AND store_id=?').run(JSON.stringify(lead), now(), id, c.storeId));
                else
                    (await db.prepare('INSERT INTO leads VALUES(?,?,?,1,?)').run(id, c.storeId, JSON.stringify(lead), now()));
                (await audit(c, old ? 'lead.update' : 'lead.create', id));
                return send(res, decode((await db.prepare('SELECT * FROM leads WHERE id=?').get(id))), old ? 200 : 201);
            }
            fail(404, 'Recurso não encontrado.');
        }
        catch (e) {
            if (!e.status)
                console.error('API:', e.message);
            if (!res.headersSent)
                send(res, { error: e.status ? e.message : 'Não foi possível concluir a operação.' }, e.status || 500);
            else
                res.end();
        }
    }
    let queue=Promise.resolve();
    const serialized=(req,res,next)=>{const operation=queue.then(()=>handler(req,res,next));queue=operation.catch(()=>{});return operation};
    return { handler: db.isPostgres ? handler : serialized, close: () => db.close(), db };
}
