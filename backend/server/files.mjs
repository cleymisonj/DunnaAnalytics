import './env.mjs';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Arquivos privados (mídia das avaliações e documentos dos contratos).
// Na nuvem o navegador envia direto ao Supabase Storage por link assinado: a Vercel limita o corpo
// da requisição a 4,5 MB e um vídeo passa disso. Localmente os arquivos ficam em <dataDir>/private.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const BUCKET = 'dunna-private-files';
const MB = 1024 * 1024;

export const FILE_KINDS = {
    photo: { types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }, maxBytes: 10 * MB },
    video: { types: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }, maxBytes: 50 * MB },
    document: { types: { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }, maxBytes: 10 * MB },
};
const NAME = /^[a-z0-9-]+\/[a-z]+\/[a-f0-9-]{36}\.(jpg|png|webp|mp4|mov|webm|pdf)$/;
export const validFileName = (name) => typeof name === 'string' && NAME.test(name);
const typeOf = (name) => Object.values(FILE_KINDS).flatMap((k) => Object.entries(k.types)).find(([, ext]) => name.endsWith('.' + ext))?.[0] || 'application/octet-stream';

/** Supabase Storage com bucket privado criado na primeira utilização. */
export function createSupabaseFiles({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = (...a) => fetch(...a) } = {}) {
    if (!url || !key) return null;
    const base = new URL(url);
    if (base.protocol !== 'https:') fail(500, 'URL de armazenamento inválida.');
    const headers = { apikey: key, Authorization: 'Bearer ' + key };
    const api = (p) => new URL('/storage/v1' + p, base).href;
    let bucketReady;
    const ensureBucket = () => (bucketReady ??= (async () => {
        const r = await fetchImpl(api('/bucket'), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: FILE_KINDS.video.maxBytes, allowed_mime_types: [...new Set(Object.values(FILE_KINDS).flatMap((k) => Object.keys(k.types)))] }), signal: AbortSignal.timeout(15000) });
        // 409/400 "already exists" é o caso normal depois da primeira vez
        if (!r.ok && ![400, 409].includes(r.status)) { bucketReady = undefined; fail(502, 'Não foi possível preparar o armazenamento de arquivos.'); }
    })());
    return {
        async uploadTarget(name, type) {
            await ensureBucket();
            const r = await fetchImpl(api(`/object/upload/sign/${BUCKET}/${name}`), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
            const j = r.ok ? await r.json() : null;
            if (!j?.url) fail(502, 'Não foi possível preparar o envio do arquivo.');
            return { url: api(j.url), method: 'PUT', headers: { 'Content-Type': type, 'x-upsert': 'false' } };
        },
        async readUrl(name) {
            const r = await fetchImpl(api(`/object/sign/${BUCKET}/${name}`), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }), signal: AbortSignal.timeout(15000) });
            const j = r.ok ? await r.json() : null;
            if (!j?.signedURL) fail(404, 'Arquivo não encontrado.');
            return api(j.signedURL);
        },
    };
}

export async function installFiles(db) {
    await db.exec('CREATE TABLE IF NOT EXISTS file_uploads(name TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),purpose TEXT NOT NULL,kind TEXT NOT NULL,max_bytes INTEGER NOT NULL,expires INTEGER NOT NULL,claimed INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);');
}

/**
 * Serviço de arquivos privados. `remote` é o Supabase (ou null para guardar localmente).
 * Cada envio é autorizado antes (issue) e depois "reivindicado" pelo registro que o usa (claim).
 */
export function createFiles({ db, dataDir, remote }) {
    const dir = path.join(dataDir, 'private');
    const local = (name) => path.join(dir, name.replaceAll('/', '__'));
    return {
        async issue(storeId, purpose, files) {
            if (!Array.isArray(files) || !files.length) fail(422, 'Nenhum arquivo informado.');
            const out = [];
            for (const f of files) {
                const kind = FILE_KINDS[f?.kind];
                const ext = kind?.types[f?.type];
                if (!ext) fail(422, 'Formato de arquivo não aceito.');
                if (!Number.isSafeInteger(f.size) || f.size <= 0 || f.size > kind.maxBytes) fail(422, `Arquivo acima do limite de ${kind.maxBytes / MB} MB.`);
                const name = `${storeId}/${purpose}/${randomUUID()}.${ext}`;
                await db.prepare('INSERT INTO file_uploads VALUES(?,?,?,?,?,?,0,?)').run(name, storeId, purpose, f.kind, kind.maxBytes, Date.now() + 3600000, new Date().toISOString());
                out.push({ name, kind: f.kind, upload: remote ? await remote.uploadTarget(name, f.type) : { url: `/api/files/upload?name=${encodeURIComponent(name)}`, method: 'PUT', headers: { 'Content-Type': f.type, 'X-Dunna-Request': '1' } } });
            }
            return out;
        },
        /** Recebe o arquivo no modo local (sem Supabase). */
        async receiveLocal(name, bytes) {
            if (remote || !validFileName(name)) fail(404, 'Envio não encontrado.');
            const row = await db.prepare('SELECT * FROM file_uploads WHERE name=?').get(name);
            if (!row || row.claimed || row.expires < Date.now()) fail(403, 'Envio expirado. Tente de novo.');
            if (bytes.length > row.max_bytes) fail(413, 'Arquivo acima do limite.');
            mkdirSync(dir, { recursive: true });
            writeFileSync(local(name), bytes, { flag: 'wx' });
        },
        /** Marca os arquivos como usados por um registro; recusa nomes não emitidos para esta loja/finalidade. */
        async claim(storeId, purpose, names, kinds, check) {
            const unique = [...new Set(names)];
            const rows = [];
            for (const name of unique) {
                const row = validFileName(name) && await db.prepare('SELECT * FROM file_uploads WHERE name=? AND store_id=? AND purpose=?').get(name, storeId, purpose);
                if (!row || row.claimed || (kinds && !kinds.includes(row.kind))) fail(422, 'Arquivo inválido ou já utilizado. Envie novamente.');
                rows.push(row);
            }
            // Validação do conjunto antes de marcar: uma recusa não pode inutilizar os arquivos enviados
            check?.(rows);
            for (const row of rows) await db.prepare('UPDATE file_uploads SET claimed=1 WHERE name=?').run(row.name);
            return rows.map((r) => ({ name: r.name, kind: r.kind }));
        },
        async owns(storeId, name) {
            return validFileName(name) && !!(await db.prepare('SELECT name FROM file_uploads WHERE name=? AND store_id=? AND claimed=1').get(name, storeId));
        },
        /** Entrega o arquivo: redireciona para link assinado (nuvem) ou transmite com suporte a Range (vídeo). */
        async serve(req, res, name) {
            if (remote) { res.writeHead(302, { Location: await remote.readUrl(name), 'Cache-Control': 'no-store' }); res.end(); return; }
            const file = local(name);
            if (!existsSync(file)) fail(404, 'Arquivo não encontrado.');
            const size = statSync(file).size, type = typeOf(name);
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
            const head = { 'Content-Type': type, 'Cache-Control': 'private,max-age=300', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
            if (range && (range[1] || range[2])) {
                const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
                const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
                if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
                res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
                createReadStream(file, { start, end }).pipe(res);
                return;
            }
            res.writeHead(200, { ...head, 'Content-Length': size });
            createReadStream(file).pipe(res);
        },
    };
}
