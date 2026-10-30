const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function installAnalytics(db) { (await db.exec(`CREATE TABLE IF NOT EXISTS vehicle_engagement(store_id TEXT NOT NULL REFERENCES stores(id),vehicle_id TEXT NOT NULL REFERENCES vehicles(id),view_id TEXT NOT NULL,source TEXT NOT NULL,viewed INTEGER NOT NULL,elapsed_ms INTEGER NOT NULL DEFAULT 0,interested INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,PRIMARY KEY(store_id,vehicle_id,view_id,source));CREATE INDEX IF NOT EXISTS engagement_period ON vehicle_engagement(store_id,created);CREATE TABLE IF NOT EXISTS analytics_activation(store_id TEXT PRIMARY KEY REFERENCES stores(id),started INTEGER NOT NULL);`)); (await db.prepare('DELETE FROM vehicle_engagement WHERE created<?').run(Date.now() - 180 * 86400000)); }
export async function recordEngagement(db, v) {
    if (!v || !uuid(v.viewId) || typeof v.vehicleId !== 'string' || !['open', 'time', 'interest'].includes(v.kind) || !['detail', 'comparison'].includes(v.source))
        fail(422, 'Evento inválido.');
    const store = (await db.prepare('SELECT id FROM stores WHERE slug=?').get(typeof v.store === 'string' ? v.store : ''));
    if (!store)
        fail(404, 'Loja não encontrada.');
    if (v.elapsedMs !== undefined && (!Number.isInteger(v.elapsedMs) || v.elapsedMs < 0 || v.elapsedMs > 86400000))
        fail(422, 'Duração inválida.');
    const key = [store.id, v.vehicleId, v.viewId, v.source], now = Date.now();
    let old = (await db.prepare('SELECT * FROM vehicle_engagement WHERE store_id=? AND vehicle_id=? AND view_id=? AND source=?').get(...key));
    if (v.source === 'comparison' && v.kind !== 'interest')
        fail(422, 'Evento inválido.');
    if (!old) {
        if (v.kind === 'time')
            fail(404, 'Visualização não encontrada.');
        const row = (await db.prepare('SELECT data FROM vehicles WHERE id=? AND store_id=?').get(v.vehicleId, store.id));
        if (!row || !['available', 'reserved'].includes(JSON.parse(row.data).status))
            fail(404, 'Veículo não publicado.');
        (await db.prepare('INSERT INTO vehicle_engagement VALUES(?,?,?,?,?,0,?,?)').run(...key, v.source === 'detail' ? 1 : 0, v.kind === 'interest' ? 1 : 0, now));
        old = (await db.prepare('SELECT * FROM vehicle_engagement WHERE store_id=? AND vehicle_id=? AND view_id=? AND source=?').get(...key));
    }
    if (now - old.created > 86400000)
        fail(410, 'Visualização expirada.');
    const elapsed = v.source === 'detail' ? Math.max(old.elapsed_ms, Math.min(v.elapsedMs || 0, Math.max(0, now - old.created + 2000))) : 0;
    (await db.prepare('UPDATE vehicle_engagement SET elapsed_ms=?,interested=? WHERE store_id=? AND vehicle_id=? AND view_id=? AND source=?').run(elapsed, old.interested || v.kind === 'interest' ? 1 : 0, ...key));
    (await db.prepare('INSERT OR IGNORE INTO analytics_activation VALUES(?,?)').run(store.id, now));
    return { ok: true };
}
export async function engagementReport(db, storeId, days = 30) {
    if (![7, 30, 90].includes(days))
        fail(422, 'Período inválido.');
    const since = Date.now() - days * 86400000;
    const stats = (await db.prepare(`SELECT vehicle_id,SUM(viewed) views,SUM(CASE WHEN viewed=1 THEN elapsed_ms ELSE 0 END) total_ms,SUM(CASE WHEN viewed=1 THEN interested ELSE 0 END) detail_interests,SUM(CASE WHEN source='comparison' THEN interested ELSE 0 END) comparison_interests FROM vehicle_engagement WHERE store_id=? AND created>=? GROUP BY vehicle_id`).all(storeId, since));
    const rows = (await db.prepare('SELECT id,data FROM vehicles WHERE store_id=?').all(storeId)).map(row => { const v = JSON.parse(row.data), s = stats.find(s => s.vehicle_id === row.id); const views = s?.views || 0, detailInterests = s?.detail_interests || 0, comparisonInterests = s?.comparison_interests || 0; return { id: row.id, brand: v.brand, model: v.model, version: v.version, year: v.year, status: v.status, image: v.images[0] || '', views, averageMs: views ? Math.round(s.total_ms / views) : null, totalMs: s?.total_ms || 0, detailInterests, comparisonInterests, interests: detailInterests + comparisonInterests, interestRate: views ? detailInterests / views : null }; });
    const totalViews = rows.reduce((s, r) => s + r.views, 0), totalMs = rows.reduce((s, r) => s + r.totalMs, 0), interests = rows.reduce((s, r) => s + r.interests, 0);
    return { days, startedAt: (await db.prepare('SELECT started FROM analytics_activation WHERE store_id=?').get(storeId))?.started || null, totalViews, averageMs: totalViews ? Math.round(totalMs / totalViews) : null, interests, rows };
}
