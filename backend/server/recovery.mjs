import { randomBytes, createHash } from 'node:crypto';
import { sendMail } from './notifications.mjs';

// Recuperação de senha: link de uso único, válido por 1 hora, enviado por e-mail (Resend).
// Sem e-mail configurado, o administrador gera o link para o vendedor em Equipe e acessos.
// Só o hash do token fica no banco; a redefinição derruba todas as sessões do usuário.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const HOUR = 3600000;
const INVALID = 'Link inválido ou expirado. Peça um novo.';

export async function installRecovery(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS password_resets(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,created TEXT NOT NULL);');
}

/** Endereço do painel usado no link: nunca vem do cabeçalho Host, que o cliente controla. */
export function panelUrl(env = process.env, origin = '') {
    const configured = env.DUNNA_SITE_URL || String(env.DUNNA_ALLOWED_ORIGINS || '').split(',')[0].trim();
    return (configured || origin || 'http://localhost:5174').replace(/\/+$/, '');
}

async function issue(db, userId) {
    const token = randomBytes(32).toString('hex');
    await db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires<?').run(userId, Date.now());
    await db.prepare('INSERT INTO password_resets VALUES(?,?,?,?)').run(sha(token), userId, Date.now() + HOUR, new Date().toISOString());
    return token;
}

export async function recoveryRoute({ req, res, route, db, body, send, limit, ip, hashPassword }) {
    if (req.method !== 'POST') return false;
    if (route === '/api/auth/forgot') {
        await limit('forgot:' + ip);
        const v = await body(req), email = typeof v?.email === 'string' ? v.email.trim().toLowerCase().slice(0, 200) : '';
        const user = email ? await db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email) : null;
        if (user) {
            const link = `${panelUrl(process.env, req.headers.origin)}/?redefinir=${await issue(db, user.id)}`;
            await sendMail({ to: user.email, subject: 'Redefinir sua senha · Dunna Analytics', html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17202d"><h2 style="font-size:19px">Redefinir senha</h2><p>Recebemos um pedido para redefinir a senha da sua conta no Dunna Analytics. O link vale por 1 hora e só pode ser usado uma vez.</p><p><a href="${link}" style="background:#4f46e5;color:#fff;padding:11px 17px;border-radius:6px;text-decoration:none;font-weight:bold">Criar nova senha</a></p><p style="color:#5d6878;font-size:13px">Se você não pediu, ignore este e-mail: sua senha continua a mesma.</p></div>` }).catch((e) => console.error('Recuperação de senha:', e.message));
        }
        // Mesma resposta para e-mail cadastrado ou não: a tela não revela quem tem conta
        send(res, { ok: true });
        return true;
    }
    if (route === '/api/auth/reset') {
        await limit('reset:' + ip);
        const v = await body(req);
        if (typeof v?.token !== 'string' || !/^[a-f0-9]{64}$/.test(v.token)) fail(400, INVALID);
        if (typeof v.password !== 'string' || v.password.length < 12 || v.password.length > 200) fail(422, 'Use uma senha entre 12 e 200 caracteres.');
        const hash = await hashPassword(v.password);
        const reset = await db.prepare('SELECT * FROM password_resets WHERE token=? AND expires>?').get(sha(v.token), Date.now());
        if (!reset) fail(400, INVALID);
        const user = await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(reset.user_id);
        if (!user) fail(400, INVALID);
        await db.exec('BEGIN IMMEDIATE');
        try {
            await db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
            await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
            await db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
            await db.prepare('INSERT INTO audit(store_id,user_id,action,entity_id,created) VALUES(?,?,?,?,?)').run(user.store_id, user.id, 'account.password.reset', user.id, new Date().toISOString());
            await db.exec('COMMIT');
        } catch (e) { await db.exec('ROLLBACK'); throw e; }
        send(res, { ok: true });
        return true;
    }
    return false;
}

/** Link gerado pelo administrador. Administrador da loja redefine só vendedores; a plataforma, qualquer um da loja. */
export async function adminResetLink({ req, res, db, c, userId, send, audit }) {
    const target = await db.prepare('SELECT * FROM users WHERE id=? AND store_id=? AND active=1').get(userId, c.storeId);
    if (!target || target.role === 'platform') fail(404, 'Usuário não encontrado.');
    if (target.id === c.user.id) fail(422, 'Para a sua própria conta, use Meu perfil.');
    if (c.user.role !== 'platform' && target.role !== 'seller') fail(403, 'Somente a plataforma redefine a senha de administradores.');
    const link = `${panelUrl(process.env, req.headers.origin)}/?redefinir=${await issue(db, target.id)}`;
    await audit(c, 'user.reset-link', target.id);
    send(res, { link, name: target.name, expiresInMinutes: 60 });
}
