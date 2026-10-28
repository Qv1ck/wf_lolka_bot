// ========================================================================
// ЖИВОЕ СОСТОЯНИЕ МИРА (live-данные)
// ========================================================================
//
//  - api.warframestat.us — разломы, вылазка, циклы (кэш 60 сек);
//  - oracle.browse.wf — Баро Ки'Тиир из worldState DE (у warframestat
//    ассортимент всегда пустой), имена товаров через словарь browse.wf;
//  - browse.wf/arbys.txt — почасовое расписание арбитражей (кэш 30 мин),
//    метаданные нод берутся из сгенерированного data/arbitration.json.
// ========================================================================

const fs = require('fs');
const path = require('path');

const WFSTAT = 'https://api.warframestat.us/pc';
const ARBYS_URL = 'https://browse.wf/arbys.txt';
const ORACLE_WORLDSTATE_URL = 'https://oracle.browse.wf/worldState.min.json';
const BROWSE_WF_URL = 'https://browse.wf';
const BROWSE_WF_DICT_URL = 'https://browse.wf/warframe-public-export-plus';

// Баро прилетает только на эти релеи (warframestat сломан, oracle отдаёт ключ ноды)
const RELAY_NAMES = {
    MercuryHUB: 'Релей Ларунда (Меркурий)',
    SaturnHUB: 'Релей Крония (Сатурн)',
    EarthHUB: 'Релей Страта (Земля)',
    PlutoHUB: 'Релей Оркус (Плутон)',
    VenusHUB: 'Релей Веспер (Венера)',
    ErisHUB: 'Релей Куйпер (Эрида)',
    CetusHUB: 'Релей ТенноКон (Земля)'
};

const WEEK_CACHE_MS = 7 * 24 * 3_600_000;

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

// Словарь локализации DE (RU) — большой, кэшируем на неделю
const getDictRu = () => cached('dictRu', `${BROWSE_WF_DICT_URL}/dict.ru.json`, WEEK_CACHE_MS);

// Имя предмета по uniqueName из worldState: JSON предмета на browse.wf → ключ → словарь
async function getItemNameRu(uniqueName, dict) {
    const path = uniqueName.replace(/^\/Lotus\/StoreItems\//, '/Lotus/');
    try {
        const item = await cached(`item:${uniqueName}`, `${BROWSE_WF_URL}${path}`, WEEK_CACHE_MS);
        return dict[item.name] || item.name || uniqueName.split('/').pop();
    } catch {
        return uniqueName.split('/').pop();
    }
}

// Баро Ки'Тиир из worldState DE через oracle browse.wf
async function getBaro() {
    const ws = await cached('worldState', ORACLE_WORLDSTATE_URL, 300_000);
    const vt = ws.VoidTraders?.[0];
    if (!vt) return null;

    const activation = Number(vt.Activation.$date.$numberLong);
    const expiry = Number(vt.Expiry.$date.$numberLong);
    const active = Date.now() >= activation && Date.now() < expiry;

    const items = [];
    if (active && Array.isArray(vt.Manifest)) {
        const dict = await getDictRu();
        for (const entry of vt.Manifest) {
            items.push({
                name: await getItemNameRu(entry.ItemType, dict),
                ducats: entry.PrimePrice,
                credits: entry.RegularPrice
            });
        }
        items.sort((a, b) => b.ducats - a.ducats);
    }

    return {
        id: String(activation),
        active, activation, expiry,
        location: RELAY_NAMES[vt.Node] || vt.Node,
        items
    };
}

module.exports = {
    getFissures, getSortie, getCetus, getVallis, getCambion,
    getBaro, getArbitration
};
