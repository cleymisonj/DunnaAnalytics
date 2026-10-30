import './env.mjs';

// Consulta à tabela FIPE (carros) via API pública da Parallelum, com cache em memória.
// Sem token o limite é ~1000 consultas/dia por IP; FIPE_API_TOKEN aumenta o limite.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const BASE = () => (process.env.FIPE_API_URL || 'https://fipe.parallelum.com.br/api/v2').replace(/\/+$/, '');
const LIST_TTL = 7 * 24 * 3600 * 1000;
const PRICE_TTL = 12 * 3600 * 1000;
const MAX_ENTRIES = 3000;
const cache = new Map();
let fetchImpl = (...args) => fetch(...args);

/** Para testes: troca o fetch e limpa o cache. */
export function setFipeFetch(fn) {
    fetchImpl = fn;
    cache.clear();
}

/** "R$ 77.897,00" → 77897 */
export const parsePrice = (text) => {
    const n = Number(String(text).replace(/[^\d,]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
};

async function cached(path, ttl) {
    const hit = cache.get(path);
    if (hit && hit.expires > Date.now()) return hit.value;
    const headers = { Accept: 'application/json' };
    if (process.env.FIPE_API_TOKEN) headers['X-Subscription-Token'] = process.env.FIPE_API_TOKEN;
    let response;
    try {
        response = await fetchImpl(BASE() + path, { headers, signal: AbortSignal.timeout(10000) });
    } catch {
        fail(502, 'Consulta FIPE indisponível no momento. Tente novamente.');
    }
    if (response.status === 429) fail(503, 'Limite diário de consultas FIPE atingido. Tente mais tarde.');
    if (response.status === 404) fail(404, 'Item não encontrado na tabela FIPE.');
    if (!response.ok) fail(502, 'Consulta FIPE indisponível no momento. Tente novamente.');
    const value = await response.json();
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(path, { value, expires: Date.now() + ttl });
    return value;
}

const list = (rows) => (Array.isArray(rows) ? rows : []).map((r) => ({ code: String(r.code), name: String(r.name) }));

export async function fipeRoute({ req, res, route, send }) {
    const m = route.match(/^\/api\/admin\/fipe\/brands(?:\/(\d{1,6})\/models(?:\/(\d{1,7})\/years(?:\/(\d{4}-\d{1,2}))?)?)?$/);
    if (!m || req.method !== 'GET') return false;
    const [, brand, model, year] = m;
    if (year) {
        const p = await cached(`/cars/brands/${brand}/models/${model}/years/${year}`, PRICE_TTL);
        const price = parsePrice(p.price);
        if (!price) fail(502, 'Resposta FIPE inválida.');
        send(res, { price, code: String(p.codeFipe || ''), reference: String(p.referenceMonth || ''), model: String(p.model || ''), brand: String(p.brand || ''), modelYear: Number(p.modelYear) || null, fuel: String(p.fuel || '') });
    } else if (model) {
        send(res, list(await cached(`/cars/brands/${brand}/models/${model}/years`, LIST_TTL)));
    } else if (brand) {
        send(res, list(await cached(`/cars/brands/${brand}/models`, LIST_TTL)));
    } else {
        send(res, list(await cached('/cars/brands', LIST_TTL)));
    }
    return true;
}
