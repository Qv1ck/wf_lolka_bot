// ========================================================================
// ГЕНЕРАТОР БАЗЫ ДАННЫХ ИЗ ОФИЦИАЛЬНЫХ PUBLIC EXPORT МАНИФЕСТОВ DE
// ========================================================================
//
// Источники:
//  - content.warframe.com/PublicExport — официальные данные игры (RU + EN),
//    обновляются с каждым патчем Warframe;
//  - drops.warframestat.us — таблицы дропа (WFCD, из официальных данных DE);
//  - wiki.warframe.com (Module:Warframes/data) — Гельминт-способности;
//  - github.com/calamity-inc/browse.wf (live.ts) + словари browse.wf —
//    полное расписание Цепи Дувири (варфреймы и инкарнон-оружия);
//  - api.warframe.market/v2 — слаги и иконки для ссылок на маркет (опционально).
//
// Запуск: npm run generate
// Результат: data/warframes.json, data/mods.json, data/weapons.json,
//            data/drops.json, data/duviri.json, data/aliases.json, data/meta.json
// ========================================================================

const fs = require('fs');
const path = require('path');
const lzma = require('lzma');

const PUBLIC_EXPORT = 'http://content.warframe.com/PublicExport';
const DROPS_URL = 'https://drops.warframestat.us/data/all.json';
const MARKET_ITEMS_URL = 'https://api.warframe.market/v2/items';
const WIKI_WARFRAMES_URL = 'https://wiki.warframe.com/api.php?action=parse&page=Module:Warframes/data&prop=wikitext&format=json';
const BROWSE_WF_LIVE_URL = 'https://raw.githubusercontent.com/calamity-inc/browse.wf/senpai/live.ts';
const BROWSE_WF_DICT_URL = 'https://browse.wf/warframe-public-export-plus';

const OUT_DIR = path.join(__dirname, '..', 'data');
const MANUAL_ALIASES_PATH = path.join(__dirname, 'manual_aliases.json');

// ------------------------------------------------------------------------
// Сеть
// ------------------------------------------------------------------------

async function downloadBuffer(url, headers = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'wf-lolka-bot/1.0', ...headers }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

// Индекс PublicExport сжат LZMA (alone) без маркера конца потока.
// Чистый JS-декодер останавливается по размеру из заголовка и это переживает.
function decompressLzmaAlone(buffer) {
    return new Promise((resolve, reject) => {
        lzma.decompress(Array.from(buffer), (result, err) => {
            if (err) return reject(new Error(`LZMA: ${err}`));
            resolve(typeof result === 'string' ? result : Buffer.from(result).toString('utf8'));
        });
    });
}

async function fetchManifestIndex(lang) {
    const buffer = await downloadBuffer(`${PUBLIC_EXPORT}/index_${lang}.txt.lzma`);
    const text = await decompressLzmaAlone(buffer);
    const index = new Map();
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const bang = line.indexOf('!');
        index.set(line.slice(0, bang), line);
    }
    return index;
}

async function fetchManifest(index, name) {
    const hashed = index.get(name);
    if (!hashed) throw new Error(`В индексе нет манифеста ${name}`);
    const buffer = await downloadBuffer(`${PUBLIC_EXPORT}/Manifest/${hashed}`);
    // Манифесты отдаются как готовый JSON; на всякий случай пробуем LZMA
    if (buffer[0] !== 0x7b /* { */) {
        const text = await decompressLzmaAlone(buffer);
        return JSON.parse(text);
    }
    return JSON.parse(buffer.toString('utf8'));
}

// ------------------------------------------------------------------------
// Вспомогательное
// ------------------------------------------------------------------------

function marketSlug(enName) {
    return enName.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const RARITY_RU = {
    COMMON: 'Обычный', UNCOMMON: 'Необычный', RARE: 'Редкий', LEGENDARY: 'Легендарный'
};

const POLARITY_RU = {
    AP_ATTACK: 'Мадурай (V)', AP_DEFENSE: 'Вазарин (D)', AP_TACTIC: 'Нарамон (—)',
    AP_TECH: 'Зенурик (=)', AP_POWER: 'Унаиру', AP_UMBRA: 'Умбра (U)',
    AP_PRECEPT: 'Пенджага (Y)', AP_ANY: 'Универсальная', AP_WARD: 'Амаша (O)'
};

// ------------------------------------------------------------------------
// Варфреймы
// ------------------------------------------------------------------------

function buildWarframes(ruManifest, enManifest) {
    const enByUnique = new Map(
        enManifest.ExportWarframes.map(w => [w.uniqueName, w])
    );

    const warframes = {};
    const suits = ruManifest.ExportWarframes.filter(w => w.productCategory === 'Suits');

    for (const ru of suits) {
        const en = enByUnique.get(ru.uniqueName);
        if (!en) continue;

        const isPrime = / Prime$/.test(en.name);
        const baseName = isPrime ? en.name.replace(/ Prime$/, '') : en.name;

        const enAbilities = new Map(
            (en.abilities || []).map(a => [a.abilityUniqueName, a.abilityName])
        );

        warframes[en.name] = {
            nameRu: ru.name,
            nameEn: en.name,
            baseName,
            isPrime,
            description: ru.description,
            passive: ru.passiveDescription || '',
            stats: {
                health: ru.health, shield: ru.shield, armor: ru.armor,
                energy: ru.power, sprint: ru.sprintSpeed, mr: ru.masteryReq
            },
            abilities: (ru.abilities || []).map(a => ({
                name: a.abilityName,
                nameEn: enAbilities.get(a.abilityUniqueName) || '',
                description: a.description
            })),
            market: isPrime ? {
                slug: marketSlug(en.name),
                set: `${marketSlug(en.name)}_set`,
                thumb: null
            } : null
        };
    }

    // Привязка прайм-варианта к базовому варфрейму
    for (const wf of Object.values(warframes)) {
        if (!wf.isPrime && warframes[`${wf.nameEn} Prime`]) {
            wf.prime = warframes[`${wf.nameEn} Prime`].market;
        }
    }

    return warframes;
}

// ------------------------------------------------------------------------
// Моды
// ------------------------------------------------------------------------

function buildMods(ruManifest, enManifest) {
    const enByUnique = new Map(
        enManifest.ExportUpgrades.map(m => [m.uniqueName, m])
    );

    const mods = {};
    for (const ru of ruManifest.ExportUpgrades) {
        const en = enByUnique.get(ru.uniqueName);
        if (!en || !Array.isArray(ru.levelStats) || ru.levelStats.length === 0) continue;
        // Ослабленные копии для новичков с тем же именем пропускаем
        if (/\/(Beginner|Intermediate)\//.test(ru.uniqueName)) continue;
        // При совпадении имён оставляем версию с бо́льшим числом рангов
        if (mods[en.name] && mods[en.name].maxRank >= ru.fusionLimit) continue;

        mods[en.name] = {
            nameRu: ru.name,
            nameEn: en.name,
            polarity: POLARITY_RU[ru.polarity] || ru.polarity || '',
            rarity: RARITY_RU[ru.rarity] || ru.rarity || '',
            drain: ru.baseDrain,
            maxRank: ru.fusionLimit,
            compat: ru.compatName || '',
            type: ru.type || '',
            levels: ru.levelStats.map(l => (l.stats || []).join(', '))
        };
    }
    return mods;
}

// ------------------------------------------------------------------------
// Оружие
// ------------------------------------------------------------------------

const WEAPON_CATEGORIES = {
    LongGuns: 'Основное', Pistols: 'Вторичное', Melee: 'Ближний бой',
    SpaceGuns: 'Арчвинг (основное)', SpaceMelee: 'Арчвинг (ближнее)',
    SentinelWeapons: 'Стражи', OperatorAmplifiers: 'Усилители оператора'
};

function buildWeapons(ruManifest, enManifest) {
    const enByUnique = new Map(
        enManifest.ExportWeapons.map(w => [w.uniqueName, w])
    );

    const weapons = {};
    for (const ru of ruManifest.ExportWeapons) {
        const en = enByUnique.get(ru.uniqueName);
        if (!en || !WEAPON_CATEGORIES[ru.productCategory]) continue;

        const dps = ru.damagePerShot || [];
        weapons[en.name] = {
            nameRu: ru.name,
            nameEn: en.name,
            category: WEAPON_CATEGORIES[ru.productCategory],
            description: ru.description || '',
            mr: ru.masteryReq || 0,
            totalDamage: Math.round((ru.totalDamage || 0) * 10) / 10,
            damage: { impact: dps[0] || 0, puncture: dps[1] || 0, slash: dps[2] || 0 },
            critChance: Math.round((ru.criticalChance || 0) * 1000) / 10,
            critMult: ru.criticalMultiplier || 0,
            statusChance: Math.round((ru.procChance || 0) * 1000) / 10,
            fireRate: Math.round((ru.fireRate || 0) * 100) / 100,
            magazine: ru.magazineSize || 0,
            reload: ru.reloadTime || 0,
            trigger: ru.trigger || '',
            noise: ru.noise || ''
        };
    }
    return weapons;
}

// ------------------------------------------------------------------------
// Дропы частей варфреймов (WFCD / drops.warframestat.us)
// ------------------------------------------------------------------------

const PART_RE = /^(.+?) (Neuroptics|Chassis|Systems|Blueprint)( Blueprint)?$/;
const PART_RU = {
    Neuroptics: 'Нейроптика', Chassis: 'Каркас', Systems: 'Системы', Blueprint: 'Чертёж'
};

function buildWarframeDrops(dropsData, warframes) {
    const drops = {}; // baseName(en) → { parts: {...}, relics: [...] }
    const knownBase = new Set(
        Object.values(warframes).filter(w => !w.isPrime).map(w => w.nameEn)
    );

    // Обычные части — награды миссий
    for (const [planet, nodes] of Object.entries(dropsData.missionRewards || {})) {
        for (const [node, info] of Object.entries(nodes)) {
            const rewards = info.rewards;
            const list = Array.isArray(rewards) ? rewards : Object.values(rewards || {}).flat();
            for (const reward of list) {
                const m = PART_RE.exec(reward.itemName || '');
                if (!m || / Prime$/.test(m[1]) || !knownBase.has(m[1])) continue;
                const entry = (drops[m[1]] ||= { parts: {}, relics: [] });
                (entry.parts[m[2]] ||= []).push({
                    planet, node,
                    mission: info.gameMode || '',
                    chance: reward.chance
                });
            }
        }
    }

    // Прайм-части — содержимое реликвий
    for (const relic of dropsData.relics || []) {
        if (relic.state !== 'Intact') continue;
        for (const reward of relic.rewards || []) {
            const m = PART_RE.exec(reward.itemName || '');
            if (!m) continue;
            const base = m[1].replace(/ Prime$/, '');
            if (!/ Prime$/.test(m[1]) || !knownBase.has(base)) continue;
            const entry = (drops[base] ||= { parts: {}, relics: [] });
            entry.relics.push({
                relic: `${relic.tier} ${relic.relicName}`,
                part: m[2],
                rarity: reward.rarity,
                chance: reward.chance
            });
        }
    }

    return drops;
}

// ------------------------------------------------------------------------
// Гельминт-способности (wiki.warframe.com, Module:Warframes/data)
// ------------------------------------------------------------------------

// В Public Export данных о поглощении нет, поэтому берём поддерживаемый
// сообществом Lua-модуль вики: у каждого базового варфрейма поле Subsumed.
async function fetchHelminthData() {
    const buffer = await downloadBuffer(WIKI_WARFRAMES_URL);
    const wikitext = JSON.parse(buffer.toString('utf8')).parse.wikitext['*'];
    const lines = wikitext.split('\n');

    const start = lines.findIndex(l => /^\tWarframes = \{$/.test(l));
    if (start < 0) throw new Error('В модуле вики не найдена секция Warframes');

    const subsumed = {}; // EN-имя фрейма → EN-имя способности
    let current = null;
    let body = [];
    const flush = () => {
        if (current === null) return;
        const text = body.join('\n');
        if (!/_IgnoreEntry = true/.test(text)) {
            const m = /Subsumed = "([^"]+)"/.exec(text);
            if (m) subsumed[current] = m[1];
        }
        current = null;
    };
    for (const line of lines.slice(start)) {
        const m = /^\t\t(?:\["([^"]+)"\]|([\w-]+)) = \{$/.exec(line);
        if (m) {
            flush();
            current = m[1] || m[2];
            body = [];
        } else if (/^\t\t\},?$/.test(line)) {
            flush();
        } else if (current !== null) {
            body.push(line);
        }
    }
    flush();
    return subsumed;
}

// Проставляет wf.helminth базовым варфреймам, сопоставляя EN-имя
// способности из вики со способностями из манифеста (через nameEn)
function applyHelminth(warframes, subsumed) {
    let matched = 0;
    for (const wf of Object.values(warframes)) {
        if (wf.isPrime) continue;
        const abilityEn = subsumed[wf.nameEn];
        if (!abilityEn) continue;
        const idx = wf.abilities.findIndex(a => a.nameEn === abilityEn);
        wf.helminth = {
            name: idx >= 0 ? wf.abilities[idx].name : abilityEn,
            nameEn: abilityEn,
            slot: idx >= 0 ? idx + 1 : 0
        };
        matched++;
    }
    return matched;
}

// ------------------------------------------------------------------------
// Цепь Дувири: полное расписание (browse.wf live.ts + словари browse.wf)
// ------------------------------------------------------------------------

// browse.wf поддерживает актуальное расписание цепи (неделя вычисляется
// от фиксированной эпохи, сами списки — в live.ts репозитория).
// Имена внутри — локализационные ключи игры, разворачиваем их словарями.
async function fetchDuviriCircuit(knownNamesRu = {}) {
    const [liveBuffer, dictEnBuffer, dictRuBuffer] = await Promise.all([
        downloadBuffer(BROWSE_WF_LIVE_URL),
        downloadBuffer(`${BROWSE_WF_DICT_URL}/dict.en.json`),
        downloadBuffer(`${BROWSE_WF_DICT_URL}/dict.ru.json`)
    ]);
    const liveTs = liveBuffer.toString('utf8');
    const dictEn = JSON.parse(dictEnBuffer.toString('utf8'));
    const dictRu = JSON.parse(dictRuBuffer.toString('utf8'));

    const parseChoices = (name) => {
        const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(liveTs);
        if (!m) throw new Error(`В live.ts не найден блок ${name}`);
        const weeks = [];
        for (const week of m[1].matchAll(/\[([^\]]+)\]/g)) {
            weeks.push([...week[1].matchAll(/"([^"]+)"/g)].map(p => p[1]));
        }
        return weeks;
    };

    const framesBlockAt = liveTs.indexOf('const frameChoices');
    const epochMatch = /EPOCH = (\d+) \* 1000/.exec(liveTs.slice(framesBlockAt));
    if (framesBlockAt < 0 || !epochMatch) throw new Error('В live.ts не найдена эпоха цепи');

    const resolve = (key) => {
        const nameEn = dictEn[key] || key.split('/').pop();
        return {
            nameEn,
            // словарь browse.wf местами не локализован (Lex и т.п.) —
            // в таких случаях предпочитаем имя из манифеста DE
            nameRu: knownNamesRu[nameEn] || dictRu[key] || nameEn
        };
    };

    return {
        epochMs: Number(epochMatch[1]) * 1000,
        frames: parseChoices('frameChoices').map(week => week.map(resolve)),
        weapons: parseChoices('weaponChoices').map(week => week.map(resolve))
    };
}

// ------------------------------------------------------------------------
// Алиасы для поиска (авто + ручные из старого бота)
// ------------------------------------------------------------------------

function buildAliases(warframes, manualAliases) {
    const aliases = {}; // alias(lower) → EN name
    const add = (alias, enName) => {
        const key = String(alias).toLowerCase().trim();
        if (key && !aliases[key]) aliases[key] = enName;
    };

    for (const wf of Object.values(warframes)) {
        add(wf.nameEn, wf.nameEn);
        add(wf.nameRu, wf.nameEn);
        if (wf.isPrime) {
            add(`${wf.baseName} prime`, wf.nameEn);
            add(wf.nameRu.replace(/ Прайм$/, ''), wf.baseName);
        }
    }

    // Ручные алиасы имеют приоритет (народные прозвища: "некр", "абизян"...)
    for (const [enName, list] of Object.entries(manualAliases)) {
        if (!warframes[enName]) continue;
        for (const alias of list) aliases[String(alias).toLowerCase().trim()] = enName;
    }

    return aliases;
}

// ------------------------------------------------------------------------
// Маркет: проверка слагов и иконки прайм-сетов (необязательный источник)
// ------------------------------------------------------------------------

async function fetchMarketData() {
    try {
        const buffer = await downloadBuffer(MARKET_ITEMS_URL, { Language: 'ru' });
        const data = JSON.parse(buffer.toString('utf8'));
        const bySlug = new Map();
        for (const item of data.data || []) {
            bySlug.set(item.slug, {
                nameRu: item.i18n?.ru?.name || '',
                thumb: item.i18n?.ru?.thumb || item.i18n?.en?.thumb || ''
            });
        }
        return bySlug;
    } catch (error) {
        console.warn(`⚠ Маркет недоступен, слаги без проверки: ${error.message}`);
        return new Map();
    }
}

// ------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------

async function main() {
    console.log('▶ Загрузка индексов PublicExport...');
    const [indexRu, indexEn] = await Promise.all([
        fetchManifestIndex('ru'), fetchManifestIndex('en')
    ]);
    console.log(`  RU: ${indexRu.size} манифестов, EN: ${indexEn.size}`);

    console.log('▶ Загрузка манифестов...');
    const [warframesRu, warframesEn, upgradesRu, upgradesEn, weaponsRu, weaponsEn] =
        await Promise.all([
            fetchManifest(indexRu, 'ExportWarframes_ru.json'),
            fetchManifest(indexEn, 'ExportWarframes_en.json'),
            fetchManifest(indexRu, 'ExportUpgrades_ru.json'),
            fetchManifest(indexEn, 'ExportUpgrades_en.json'),
            fetchManifest(indexRu, 'ExportWeapons_ru.json'),
            fetchManifest(indexEn, 'ExportWeapons_en.json')
        ]);

    console.log('▶ Сборка варфреймов...');
    const warframes = buildWarframes(warframesRu, warframesEn);
    console.log(`  ${Object.keys(warframes).length} записей`);

    console.log('▶ Сборка модов...');
    const mods = buildMods(upgradesRu, upgradesEn);
    console.log(`  ${Object.keys(mods).length} модов`);

    console.log('▶ Сборка оружия...');
    const weapons = buildWeapons(weaponsRu, weaponsEn);
    console.log(`  ${Object.keys(weapons).length} оружия`);

    console.log('▶ Загрузка таблиц дропа WFCD...');
    let drops = {};
    try {
        const dropsBuffer = await downloadBuffer(DROPS_URL);
        drops = buildWarframeDrops(JSON.parse(dropsBuffer.toString('utf8')), warframes);
        console.log(`  дропы для ${Object.keys(drops).length} варфреймов`);
    } catch (error) {
        console.warn(`⚠ Дропы недоступны: ${error.message}`);
    }

    console.log('▶ Гельминт-способности (wiki.warframe.com)...');
    try {
        const subsumed = await fetchHelminthData();
        console.log(`  вики отдала ${Object.keys(subsumed).length} записей,` +
            ` сопоставлено: ${applyHelminth(warframes, subsumed)}`);
    } catch (error) {
        console.warn(`⚠ Вики недоступна, Гельминт не обновлён: ${error.message}`);
    }

    console.log('▶ Расписание Цепи Дувири (browse.wf)...');
    let duviri = null;
    try {
        const knownNamesRu = {};
        for (const entry of [...Object.values(warframes), ...Object.values(weapons)]) {
            knownNamesRu[entry.nameEn] = entry.nameRu;
        }
        duviri = await fetchDuviriCircuit(knownNamesRu);
        console.log(`  недель с варфреймами: ${duviri.frames.length}, с оружием: ${duviri.weapons.length}`);
    } catch (error) {
        console.warn(`⚠ Расписание цепи не получено: ${error.message}`);
    }

    console.log('▶ Проверка слагов маркета...');
    const market = await fetchMarketData();
    let verified = 0;
    for (const wf of Object.values(warframes)) {
        if (wf.market && market.has(wf.market.set)) {
            const info = market.get(wf.market.set);
            wf.market.nameRu = info.nameRu;
            wf.market.thumb = info.thumb
                ? `https://warframe.market/static/assets/${info.thumb}`
                : null;
            verified++;
        }
    }
    console.log(`  подтверждено прайм-сетов: ${verified}`);

    const manualAliases = fs.existsSync(MANUAL_ALIASES_PATH)
        ? JSON.parse(fs.readFileSync(MANUAL_ALIASES_PATH, 'utf8'))
        : {};
    const aliases = buildAliases(warframes, manualAliases);
    console.log(`▶ Алиасы: ${Object.keys(aliases).length}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const write = (name, obj) => {
        fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(obj, null, 1));
        const kb = Math.round(fs.statSync(path.join(OUT_DIR, name)).size / 1024);
        console.log(`  ✓ data/${name} (${kb} KB)`);
    };

    write('warframes.json', warframes);
    write('mods.json', mods);
    write('weapons.json', weapons);
    write('drops.json', drops);
    if (duviri) write('duviri.json', duviri);
    write('aliases.json', aliases);
    write('meta.json', {
        generatedAt: new Date().toISOString(),
        manifests: Object.fromEntries(
            ['ExportWarframes_ru.json', 'ExportUpgrades_ru.json', 'ExportWeapons_ru.json']
                .map(n => [n, indexRu.get(n)])
        )
    });

    console.log('✔ Готово');
}

main().catch(error => {
    console.error('✖ Ошибка генерации:', error);
    process.exit(1);
});
