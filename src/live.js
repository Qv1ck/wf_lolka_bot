// ========================================================================
// ЖИВОЕ СОСТОЯНИЕ МИРА (live-данные)
// ========================================================================
//
//  - api.warframestat.us — разломы, вылазка, циклы, Баро (кэш 60 сек);
//  - browse.wf/arbys.txt — почасовое расписание арбитражей (кэш 30 мин),
//    метаданные нод берутся из сгенерированного data/arbitration.json.
// ========================================================================

const fs = require('fs');
const path = require('path');

const WFSTAT = 'https://api.warframestat.us/pc';
const ARBYS_URL = 'https://browse.wf/arbys.txt';

const cache = new Map(); // ключ → { at, data }

async function cached(key, url, ttlMs) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    const res = await fetch(url, { headers: { 'User-Agent': 'wf-lolka-bot/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* arbys.txt — не JSON */ }
    cache.set(key, { at: Date.now(), data });
    return data;
}

const getFissures = () => cached('fissures', `${WFSTAT}/fissures`, 60_000);
const getSortie = () => cached('sortie', `${WFSTAT}/sortie`, 60_000);
const getCetus = () => cached('cetus', `${WFSTAT}/cetusCycle`, 60_000);
const getVallis = () => cached('vallis', `${WFSTAT}/vallisCycle`, 60_000);
const getCambion = () => cached('cambion', `${WFSTAT}/cambionCycle`, 60_000);
const getVoidTrader = () => cached('voidTrader', `${WFSTAT}/voidTrader`, 300_000);

// Текущий арбитраж: индекс часа от начала расписания arbys.txt
async function getArbitration(nodesDb) {
    const text = await cached('arbys', ARBYS_URL, 30 * 60_000);
    const rows = text.split('\n')
        .map(line => line.split(','))
        .filter(cols => cols.length === 2 && cols[1])
        .map(cols => [Number(cols[0]), cols[1].trim()]);
    if (!rows.length) return null;

    const currentHour = Math.floor(Date.now() / 3_600_000) * 3600;
    const idx = (currentHour - rows[0][0]) / 3600;
    const row = rows[idx];
    if (!row) return null;

    return {
        nodeKey: row[1],
        node: nodesDb[row[1]] || null,
        expiresAt: (currentHour + 3600) * 1000
    };
}

module.exports = {
    getFissures, getSortie, getCetus, getVallis, getCambion,
    getVoidTrader, getArbitration
};
