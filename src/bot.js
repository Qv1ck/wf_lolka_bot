// ========================================================================
// WARFRAME БОТ ДЛЯ LOLKA
// ========================================================================
//
// Данные: data/*.json (генерируются через `npm run generate`
// из официальных Public Export манифестов DE).
//
// Запуск:
//   LOLKA_TOKEN=<токен> npm start
//   опционально: GUILD_ID=<id сервера> — мгновенная регистрация команд
//   (глобальные команды могут распространяться с задержкой)
// ========================================================================

const fs = require('fs');
const path = require('path');

// Простейший .env без зависимостей
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
}

const {
    Client, GatewayIntentBits, EmbedBuilder, Routes, Events
} = require('lolka.js');

// ========================================================================
// ДАННЫЕ
// ========================================================================

const DATA_DIR = path.join(__dirname, '..', 'data');

function loadJson(name, fallback = {}) {
    try {
        return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
    } catch {
        console.warn(`⚠ data/${name} не найден — сначала выполните npm run generate`);
        return fallback;
    }
}

const db = { warframes: {}, mods: {}, weapons: {}, drops: {}, aliases: {}, meta: {}, duviri: null, arbitration: {} };

function reloadData() {
    db.warframes = loadJson('warframes.json');
    db.mods = loadJson('mods.json');
    db.weapons = loadJson('weapons.json');
    db.drops = loadJson('drops.json');
    db.aliases = loadJson('aliases.json');
    db.meta = loadJson('meta.json', {});
    db.duviri = loadJson('duviri.json', null);
    db.arbitration = loadJson('arbitration.json', {});
    console.log(`✓ Данные: варфреймов ${Object.keys(db.warframes).length},` +
        ` модов ${Object.keys(db.mods).length}, оружия ${Object.keys(db.weapons).length}`);
}
reloadData();

const live = require('./live');

// Ручные справочники (в git) — запасной вариант, если сгенерированных данных нет
const MANUAL_DIR = path.join(__dirname, '..', 'manual');
const helminthDB = JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, 'helminth.json'), 'utf8'));
const duviriDB = JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, 'duviri.json'), 'utf8'));

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Номер недели цепи от эпохи расписания (browse.wf), с защитой от отрицательных значений
function getAbsoluteDuviriWeek(now = Date.now()) {
    return Math.floor((now - db.duviri.epochMs) / WEEK_MS);
}

function getDuviriFrameWeekIndex(now = Date.now()) {
    const week = getAbsoluteDuviriWeek(now) % db.duviri.frames.length;
    return (week + db.duviri.frames.length) % db.duviri.frames.length;
}

function getDuviriWeaponWeekIndex(now = Date.now()) {
    const week = getAbsoluteDuviriWeek(now) % db.duviri.weapons.length;
    return (week + db.duviri.weapons.length) % db.duviri.weapons.length;
}

// Неделя (1-based), на которой варфрейм появляется в обычной цепи
function findDuviriFrameWeek(nameEn) {
    if (!db.duviri) return null;
    const idx = db.duviri.frames.findIndex(week => week.some(f => f.nameEn === nameEn));
    return idx >= 0 ? idx + 1 : null;
}

// Неделя (1-based), на которой оружие появляется в цепи Стального Пути
function findDuviriWeaponWeek(nameEn) {
    if (!db.duviri) return null;
    const idx = db.duviri.weapons.findIndex(week => week.some(w => w.nameEn === nameEn));
    return idx >= 0 ? idx + 1 : null;
}

// Запасной расчёт из ручного справочника: 11-недельный цикл, неделя 3 от 24.11.2025
function getManualDuviriWeek(now = new Date()) {
    const elapsed = Math.floor((now.getTime() - Date.parse('2025-11-24T00:00:00Z')) / WEEK_MS);
    return ((3 - 1 + elapsed) % 11 + 11) % 11 + 1;
}

// ========================================================================
// ПЕРЕВОДЫ
// ========================================================================

const PLANET_NAMES = {
    Earth: 'Земля', Venus: 'Венера', Mercury: 'Меркурий', Mars: 'Марс',
    Phobos: 'Фобос', Deimos: 'Деймос', Ceres: 'Церера', Jupiter: 'Юпитер',
    Europa: 'Европа', Saturn: 'Сатурн', Uranus: 'Уран', Neptune: 'Нептун',
    Pluto: 'Плутон', Sedna: 'Седна', Eris: 'Эрида', Void: 'Бездна',
    Lua: 'Луа', 'Kuva Fortress': 'Крепость Кувы', Zariman: 'Зариман',
    Derelict: 'Покинутый корабль'
};

const MISSION_TYPES = {
    Exterminate: 'Истребление', Survival: 'Выживание', Defense: 'Защита',
    Capture: 'Захват', Rescue: 'Спасение', Sabotage: 'Саботаж',
    'Mobile Defense': 'Мобильная защита', Excavation: 'Раскопки',
    Interception: 'Перехват', Spy: 'Шпионаж', Assassination: 'Убийство',
    Disruption: 'Сбой', 'Void Cascade': 'Каскад Бездны',
    'Void Flood': 'Потоп Бездны', 'Void Armageddon': 'Армагеддон Бездны',
    Defection: 'Дезертирство', Hive: 'Улей', Hijack: 'Угон',
    'Infested Salvage': 'Заражённый улов', Skirmish: 'Стычка',
    Volatile: 'Нестабильность', Orphix: 'Орфикс'
};

const PART_RU = {
    Neuroptics: 'Нейроптика', Chassis: 'Каркас', Systems: 'Системы', Blueprint: 'Чертёж'
};

// Фракции и модификаторы вылазки приходят из live-API по-английски
const FACTION_RU = {
    Grineer: 'Гринир', Corpus: 'Корпус', Infested: 'Заражённые',
    Orokin: 'Орокин', Corrupted: 'Осквернённые', Sentient: 'Сентиенты',
    'The Murmur': 'Скрижаль', Scaldra: 'Скальдра', Techrot: 'Техногниль'
};

const SORTIE_MOD_RU = {
    'Enemy Physical Enhancement: Impact': 'Усиление врагов: ударный урон',
    'Enemy Physical Enhancement: Slash': 'Усиление врагов: режущий урон',
    'Enemy Physical Enhancement: Puncture': 'Усиление врагов: проникающий урон',
    'Enemy Elemental Enhancement: Corrosive': 'Усиление врагов: коррозия',
    'Enemy Elemental Enhancement: Viral': 'Усиление врагов: вирус',
    'Enemy Elemental Enhancement: Electricity': 'Усиление врагов: электричество',
    'Enemy Elemental Enhancement: Radiation': 'Усиление врагов: радиация',
    'Enemy Elemental Enhancement: Gas': 'Усиление врагов: газ',
    'Enemy Elemental Enhancement: Heat': 'Усиление врагов: огонь',
    'Enemy Elemental Enhancement: Blast': 'Усиление врагов: взрыв',
    'Enemy Elemental Enhancement: Cold': 'Усиление врагов: холод',
    'Enemy Elemental Enhancement: Toxin': 'Усиление врагов: токсин',
    'Enemy Elemental Enhancement: Magnetic': 'Усиление врагов: магнетизм',
    'Eximus Stronghold': 'Крепость экзимусов',
    'Energy Reduction': 'Снижение энергии',
    'Radiation Hazard': 'Радиационная угроза',
    'Electromagnetic Anomalies': 'Электромагнитные аномалии',
    'Dense Fog': 'Густой туман',
    'Fire Hazard': 'Пожароопасность',
    'Cryogenic Leakage': 'Криогенная утечка',
    'Extreme Cold': 'Экстремальный холод',
    'Augmented Enemy Armor': 'Усиленная броня врагов',
    'Enhanced Enemy Shields': 'Усиленные щиты врагов',
    'Pistol Only': 'Только пистолеты',
    'Shotgun Only': 'Только дробовики',
    'Sniper Only': 'Только снайперские винтовки',
    'Assault Rifle Only': 'Только штурмовые винтовки',
    'Melee Only': 'Только ближний бой',
    'Bow Only': 'Только луки'
};

const SORTIE_BOSS_RU = {
    'Sargas Ruk': 'Саргас Рук', 'Kela De Thaym': 'Кела Де Тайм',
    'Tyl Regor': 'Тил Регор', 'Nef Anyo': 'Неф Аньо',
    Amar: 'Амар', Nira: 'Нира', Boreal: 'Борей'
};

// "Tycho (Lua)" → { node: 'Tycho', planet: 'Луа' }
function parseNode(nodeStr) {
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(nodeStr || '');
    if (!m) return { node: nodeStr || '?', planet: '' };
    return { node: m[1], planet: PLANET_NAMES[m[2]] || m[2] };
}

// "1ч 23м" до указанной даты (ISO-строка или миллисекунды)
function timeLeft(date) {
    const target = typeof date === 'number' ? date : Date.parse(date);
    const ms = target - Date.now();
    if (ms <= 0) return 'скоро';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

const MARKET_URL = 'https://warframe.market/ru/items';

// ========================================================================
// ПОИСК
// ========================================================================

function findWarframe(query) {
    const q = query.toLowerCase().trim();
    if (db.aliases[q]) return db.warframes[db.aliases[q]] || null;

    const entries = Object.values(db.warframes);
    const aliasKeys = Object.keys(db.aliases);
    const aliasMatch = aliasKeys.find(a => a.startsWith(q));

    return entries.find(w => w.nameEn.toLowerCase() === q || w.nameRu.toLowerCase() === q)
        || entries.find(w => w.nameEn.toLowerCase().startsWith(q) || w.nameRu.toLowerCase().startsWith(q))
        || (aliasMatch && db.warframes[db.aliases[aliasMatch]])
        || entries.find(w => w.nameEn.toLowerCase().includes(q) || w.nameRu.toLowerCase().includes(q))
        || null;
}

function findMod(query) {
    const q = query.toLowerCase().trim();
    const entries = Object.values(db.mods);
    return entries.find(m => m.nameEn.toLowerCase() === q || m.nameRu.toLowerCase() === q)
        || entries.find(m => m.nameEn.toLowerCase().startsWith(q) || m.nameRu.toLowerCase().startsWith(q))
        || entries.find(m => m.nameEn.toLowerCase().includes(q) || m.nameRu.toLowerCase().includes(q))
        || null;
}

function findWeapon(query) {
    const q = query.toLowerCase().trim();
    const entries = Object.values(db.weapons);
    return entries.find(w => w.nameEn.toLowerCase() === q || w.nameRu.toLowerCase() === q)
        || entries.find(w => w.nameEn.toLowerCase().startsWith(q) || w.nameRu.toLowerCase().startsWith(q))
        || entries.find(w => w.nameEn.toLowerCase().includes(q) || w.nameRu.toLowerCase().includes(q))
        || null;
}

// ========================================================================
// EMBED'Ы
// ========================================================================

const COLOR_BASE = 0x5865F2;
const COLOR_PRIME = 0xD4AF37;
const COLOR_MOD = 0x2ECC71;
const COLOR_WEAPON = 0xE67E22;

function dataFooter() {
    const date = db.meta.generatedAt
        ? new Date(db.meta.generatedAt).toLocaleDateString('ru-RU')
        : 'неизвестно';
    return { text: `Данные: Public Export DE · обновлено ${date}` };
}

function truncate(text, max = 300) {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// В текстах DE встречаются неподставленные плейсхолдеры (|MULT|, <AFFINITY_SHARE>)
function cleanDescription(text) {
    if (!text) return '';
    return text
        .replace(/<[A-Z_]+>/g, '')
        .replace(/\|[A-Z_]+\|/g, 'N')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function formatDropsField(baseName) {
    const entry = db.drops[baseName];
    if (!entry || !entry.parts || Object.keys(entry.parts).length === 0) return null;

    const lines = [];
    for (const part of ['Neuroptics', 'Chassis', 'Systems', 'Blueprint']) {
        const list = entry.parts[part];
        if (!list) continue;
        const spots = list.slice(0, 2).map(d =>
            `${PLANET_NAMES[d.planet] || d.planet} — ${d.node}` +
            `${d.mission ? ` (${MISSION_TYPES[d.mission] || d.mission})` : ''} · ${d.chance}%`
        );
        lines.push(`**${PART_RU[part]}:** ${spots.join(' | ')}`);
    }
    return lines.length ? lines.join('\n') : null;
}

function formatRelicsField(baseName) {
    const entry = db.drops[baseName];
    if (!entry || !entry.relics || entry.relics.length === 0) return null;

    const byPart = {};
    for (const r of entry.relics) {
        (byPart[r.part] ||= new Set()).add(r.relic);
    }
    const lines = [];
    for (const part of ['Neuroptics', 'Chassis', 'Systems', 'Blueprint']) {
        if (!byPart[part]) continue;
        lines.push(`**${PART_RU[part]}:** ${[...byPart[part]].sort().join(', ')}`);
    }
    return lines.length ? lines.join('\n') : null;
}

function primeMarketText(prime) {
    const setLabel = prime.nameRu || 'Прайм — комплект';
    const set = `[${setLabel}](${MARKET_URL}/${prime.set})`;
    const parts = ['Neuroptics', 'Chassis', 'Systems', 'Blueprint']
        .map(p => `[${PART_RU[p]}](${MARKET_URL}/${prime.slug}_${p.toLowerCase()})`)
        .join(' · ');
    return `${set}\n${parts}`;
}

function warframeEmbed(wf) {
    const embed = new EmbedBuilder()
        .setTitle(`🤖 ${wf.nameRu} (${wf.nameEn})`)
        .setColor(wf.isPrime ? COLOR_PRIME : COLOR_BASE)
        .setFooter(dataFooter());

    if (wf.isPrime && wf.market?.thumb) embed.setThumbnail(wf.market.thumb);

    if (wf.abilities.length) {
        embed.addFields({
            name: '⚡ Способности',
            value: wf.abilities.map((a, i) => `${i + 1}. ${a.name}`).join('\n')
        });
    }

    const helminth = wf.helminth || helminthDB[wf.baseName] || helminthDB[wf.nameEn];
    if (helminth) {
        const abilityName = helminth.name || helminth.ability;
        embed.addFields({
            name: '🧬 Гельминт-способность',
            value: helminth.slot ? `${abilityName} (слот ${helminth.slot})` : abilityName
        });
    }

    const s = wf.stats;
    embed.addFields({
        name: '📊 Статы',
        value: `❤️ ${s.health} · 🛡 ${s.shield} · 🔩 ${s.armor} · ⚡ ${s.energy} · 🏃 ${s.sprint}` +
               (s.mr ? ` · 🎖 РМ ${s.mr}` : ''),
        inline: false
    });

    const duviriWeek = db.duviri
        ? findDuviriFrameWeek(wf.baseName)
        : duviriDB[wf.baseName.toLowerCase()];
    if (duviriWeek) {
        const total = db.duviri ? db.duviri.frames.length : 11;
        const current = db.duviri ? getDuviriFrameWeekIndex() + 1 : getManualDuviriWeek();
        embed.addFields({
            name: '🌀 Цепь Дувири',
            value: duviriWeek === current
                ? `Неделя ${duviriWeek} из ${total} — ✅ доступен СЕЙЧАС`
                : `Неделя ${duviriWeek} из ${total} (сейчас ${current})`
        });
    }

    if (wf.isPrime) {
        const relics = formatRelicsField(wf.baseName);
        if (relics) embed.addFields({ name: '🏺 Реликвии', value: truncate(relics, 900) });
        if (wf.market) embed.addFields({ name: '💎 Warframe Market', value: primeMarketText({ ...wf.market, nameRu: wf.nameRu }) });
    } else {
        const dropText = formatDropsField(wf.nameEn);
        if (dropText) embed.addFields({ name: '🎯 Где добыть', value: truncate(dropText, 900) });
        if (wf.prime) embed.addFields({ name: `💎 ${wf.prime.nameRu || `${wf.nameEn} Prime`} — Warframe Market`, value: primeMarketText(wf.prime) });
    }

    return embed;
}

function modEmbed(mod) {
    const embed = new EmbedBuilder()
        .setTitle(`🔧 ${mod.nameRu} (${mod.nameEn})`)
        .setColor(COLOR_MOD)
        .setFooter(dataFooter());

    const info = [
        mod.polarity && `Полярность: **${mod.polarity}**`,
        mod.rarity && `Редкость: **${mod.rarity}**`,
        `Энергия: **${mod.drain}** → **${mod.drain + mod.maxRank}**`,
        mod.compat && `Совместимость: **${mod.compat}**`
    ].filter(Boolean).join('\n');
    embed.addFields({ name: '📋 Свойства', value: info });

    if (mod.levels.length > 0) {
        embed.addFields(
            { name: 'Ранг 0', value: truncate(mod.levels[0], 200), inline: true },
            { name: `Ранг ${mod.levels.length - 1} (макс)`, value: truncate(mod.levels[mod.levels.length - 1], 200), inline: true }
        );
    }
    return embed;
}

function weaponEmbed(w) {
    const embed = new EmbedBuilder()
        .setTitle(`🔫 ${w.nameRu} (${w.nameEn})`)
        .setDescription(truncate(cleanDescription(w.description), 300) || null)
        .setColor(COLOR_WEAPON)
        .setFooter(dataFooter());

    const lines = [
        `Класс: **${w.category}**` + (w.mr ? ` · 🎖 РМ ${w.mr}` : ''),
        `💥 Урон: **${w.totalDamage}** (🔨 ${w.damage.impact} / 🗡 ${w.damage.puncture} / ⚔️ ${w.damage.slash})`,
        `🎯 Крит: **${w.critChance}%** ×**${w.critMult}** · 💠 Статус: **${w.statusChance}%**`
    ];
    if (w.fireRate) lines.push(`🔥 Скорострельность: **${w.fireRate}**` + (w.trigger ? ` (${w.trigger})` : ''));
    if (w.magazine) lines.push(`📦 Магазин: **${w.magazine}** · 🔄 Перезарядка: **${w.reload}с**`);
    if (w.noise) lines.push(`🔊 Шум: **${w.noise}**`);

    embed.addFields({ name: '📊 Характеристики', value: lines.join('\n') });

    const circuitWeek = findDuviriWeaponWeek(w.nameEn);
    if (circuitWeek) {
        const total = db.duviri.weapons.length;
        const current = getDuviriWeaponWeekIndex() + 1;
        embed.addFields({
            name: '🌀 Инкарнон (Цепь Дувири)',
            value: circuitWeek === current
                ? `Неделя ${circuitWeek} из ${total} — ✅ доступен СЕЙЧАС`
                : `Неделя ${circuitWeek} из ${total} (сейчас ${current})`
        });
    }
    return embed;
}

function circuitEmbed() {
    const frameIdx = getDuviriFrameWeekIndex();
    const weaponIdx = getDuviriWeaponWeekIndex();
    const nextReset = db.duviri.epochMs + (getAbsoluteDuviriWeek() + 1) * WEEK_MS;

    return new EmbedBuilder()
        .setTitle('🌀 Цепь Дувири — текущая неделя')
        .setColor(COLOR_BASE)
        .addFields(
            {
                name: `Варфреймы (неделя ${frameIdx + 1} из ${db.duviri.frames.length})`,
                value: db.duviri.frames[frameIdx].map(f => f.nameRu).join('\n')
            },
            {
                name: `Инкарнон-оружия, Стальной Путь (неделя ${weaponIdx + 1} из ${db.duviri.weapons.length})`,
                value: db.duviri.weapons[weaponIdx].map(w => w.nameRu).join('\n')
            }
        )
        .setFooter({ text: `Смена: ${new Date(nextReset).toLocaleDateString('ru-RU')} · расписание: browse.wf` });
}

// ========================================================================
// LIVE-EMBED'Ы (текущее состояние мира)
// ========================================================================

async function fissuresEmbed() {
    const all = (await live.getFissures())
        .filter(f => !f.expired && !f.isStorm)
        .sort((a, b) => a.tierNum - b.tierNum);

    const format = (list) => list.slice(0, 12).map(f => {
        const { node, planet } = parseNode(f.node);
        return `**${f.tier}** · ${MISSION_TYPES[f.missionTypeKey] || f.missionType}` +
            ` — ${FACTION_RU[f.enemyKey] || f.enemy} · ${node} (${planet}) · ${timeLeft(f.expiry)}`;
    }).join('\n') || '—';

    return new EmbedBuilder()
        .setTitle('☢️ Разломы Бездны')
        .setColor(COLOR_BASE)
        .addFields(
            { name: 'Обычные', value: format(all.filter(f => !f.isHard)) },
            { name: 'Стальной Путь', value: format(all.filter(f => f.isHard)) }
        )
        .setFooter({ text: 'Данные: warframestat.us' });
}

async function sortieEmbed() {
    const s = await live.getSortie();
    const embed = new EmbedBuilder()
        .setTitle(`📋 Вылазка — ${SORTIE_BOSS_RU[s.boss] || s.boss} (${FACTION_RU[s.factionKey] || s.faction})`)
        .setColor(COLOR_BASE)
        .setFooter({ text: `До конца: ${timeLeft(s.expiry)} · warframestat.us` });

    s.variants.forEach((v, i) => {
        const { node, planet } = parseNode(v.node);
        embed.addFields({
            name: `${i + 1}. ${MISSION_TYPES[v.missionTypeKey] || v.missionType} — ${node} (${planet})`,
            value: `⚠ ${SORTIE_MOD_RU[v.modifier] || v.modifier}`
        });
    });
    return embed;
}

async function arbitrationEmbed() {
    const arb = await live.getArbitration(db.arbitration);
    if (!arb || !arb.node) {
        return new EmbedBuilder()
            .setTitle('🎯 Арбитраж')
            .setColor(COLOR_BASE)
            .setDescription('Не удалось определить текущий узел.');
    }
    return new EmbedBuilder()
        .setTitle('🎯 Арбитраж')
        .setColor(COLOR_BASE)
        .setDescription(
            `**${arb.node.mission || '?'}** — ${arb.node.faction || '?'}\n` +
            `${arb.node.name} (${arb.node.planet})\n` +
            `Смена через ${timeLeft(new Date(arb.expiresAt).toISOString())}`
        )
        .setFooter({ text: 'Расписание: browse.wf' });
}

async function timeEmbed() {
    const [cetus, vallis, cambion] = await Promise.all([
        live.getCetus(), live.getVallis(), live.getCambion()
    ]);
    const row = (name, state, expiry) => `${name}: ${state} — смена через ${timeLeft(expiry)}`;
    return new EmbedBuilder()
        .setTitle('🌍 Циклы миров')
        .setColor(COLOR_BASE)
        .setDescription([
            row('🌅 Равнины Эйдолона', cetus.isDay ? '☀️ день' : '🌑 НОЧЬ', cetus.expiry),
            row('🏔 Долина Орбис', vallis.isWarm ? '☀️ тепло' : '❄️ холод', vallis.expiry),
            row('🦠 Дрейф Камбионы', cambion.state === 'fass' ? '🟠 Фасс' : '🔵 Воум', cambion.expiry)
        ].join('\n'))
        .setFooter({ text: 'Данные: warframestat.us' });
}

function baroEmbed(vt) {
    const embed = new EmbedBuilder()
        .setTitle('🚑 Баро Ки\'Тиир')
        .setColor(COLOR_PRIME);

    if (!vt.active) {
        embed.setDescription(
            `Прибывает **${new Date(vt.activation).toLocaleString('ru-RU')}**\n` +
            `${vt.location} — через ${timeLeft(vt.activation)}`
        );
    } else {
        const items = vt.items.slice(0, 20).map(i =>
            `${i.name} — ${i.ducats} дук. + ${Number(i.credits).toLocaleString('ru-RU')} кр.`
        ).join('\n') || 'Ассортимент ещё не раскрыт';
        embed.setDescription(`**УЖЕ НА РЕЛЕЕ:** ${vt.location}, улетит через ${timeLeft(vt.expiry)}`)
            .addFields({ name: '🛒 Ассортимент', value: truncate(items, 1000) });
    }
    return embed.setFooter({ text: 'Данные: worldState DE через oracle.browse.wf' });
}

// ========================================================================
// КОМАНДЫ
// ========================================================================

const COMMANDS = [
    {
        name: 'search',
        description: 'Найти варфрейма',
        options: [{
            name: 'запрос',
            description: 'Название варфрейма (рус или eng)',
            type: 3, // STRING
            required: true,
            autocomplete: true
        }]
    },
    {
        name: 'mod',
        description: 'Найти мод',
        options: [{
            name: 'запрос',
            description: 'Название мода (рус или eng)',
            type: 3,
            required: true,
            autocomplete: true
        }]
    },
    {
        name: 'weapon',
        description: 'Найти оружие',
        options: [{
            name: 'запрос',
            description: 'Название оружия (рус или eng)',
            type: 3,
            required: true,
            autocomplete: true
        }]
    },
    {
        name: 'circuit',
        description: 'Текущая неделя Цепи Дувири (варфреймы и инкарнон-оружия)'
    },
    { name: 'fissures', description: 'Активные разломы Бездны' },
    { name: 'sortie', description: 'Вылазка дня' },
    { name: 'arbitration', description: 'Текущий арбитраж' },
    { name: 'time', description: 'Циклы миров (Равнины, Орбис, Деймос)' },
    { name: 'baro', description: 'Баро Ки\'Тиир: когда и что привёз' }
];

function autocompleteChoices(query, entries, makeChoice) {
    const q = query.toLowerCase().trim();
    const starts = [], contains = [];
    for (const entry of entries) {
        const hay = `${entry.nameEn} ${entry.nameRu}`.toLowerCase();
        if (hay.startsWith(q) || hay.split(' ').some(p => p.startsWith(q))) starts.push(makeChoice(entry));
        else if (hay.includes(q)) contains.push(makeChoice(entry));
        if (starts.length >= 25) break;
    }
    return [...starts, ...contains].slice(0, 25);
}

// ========================================================================
// АВТООБНОВЛЕНИЕ БАЗЫ (раз в неделю, со сменой недели Цепи Дувири)
// ========================================================================

const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000; // проверка каждые 6 часов

// Номер текущей недели (по эпохе цепи, иначе — просто абсолютная неделя)
function currentWeekStamp(now = Date.now()) {
    const epoch = db.duviri?.epochMs || 0;
    return Math.floor((now - epoch) / WEEK_MS);
}

function dataWeekStamp() {
    const generated = Date.parse(db.meta.generatedAt || 0) || 0;
    const epoch = db.duviri?.epochMs || 0;
    return Math.floor((generated - epoch) / WEEK_MS);
}

async function refreshDatabase(reason) {
    console.log(`🔄 Обновление базы (${reason})...`);
    const { spawn } = require('child_process');
    const generator = path.join(__dirname, '..', 'tools', 'generate_data.js');
    const code = await new Promise(resolve => {
        spawn(process.execPath, [generator], { stdio: 'inherit' })
            .on('exit', c => resolve(c ?? 1));
    });
    if (code === 0) {
        reloadData();
        console.log('✓ База обновлена');
    } else {
        console.error(`❌ Генератор завершился с кодом ${code}, оставляю старые данные`);
    }
}

function checkWeeklyUpdate() {
    if (dataWeekStamp() < currentWeekStamp()) {
        refreshDatabase('началась новая игровая неделя').catch(console.error);
    }
}

// ========================================================================
// АВТОПОСТЫ В КАНАЛ (смена Цепи Дувири, прилёт Баро)
// ========================================================================

const STATE_PATH = path.join(__dirname, '..', 'state.json');
const AUTOPOST_CHECK_MS = 15 * 60 * 1000;

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
        return null; // первый запуск — состояние записывается молча, без постов
    }
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_PATH, JSON.stringify(state));
    } catch (error) {
        console.warn(`⚠ Не удалось сохранить state.json: ${error.message}`);
    }
}

// Канал для автопостов: NEWS_CHANNEL_ID из .env, иначе ищем текстовый
// канал со словом "warframe" в названии на сервере GUILD_ID
let newsChannel = null;
async function resolveNewsChannel() {
    if (newsChannel) return newsChannel;
    try {
        if (process.env.NEWS_CHANNEL_ID) {
            newsChannel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
        } else if (process.env.GUILD_ID) {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const channels = await guild.channels.fetch();
            newsChannel = channels.find(c => c.isTextBased() && /warframe/i.test(c.name)) || null;
        }
        if (newsChannel) console.log(`✓ Канал автопостов: #${newsChannel.name}`);
    } catch (error) {
        console.warn(`⚠ Канал автопостов не найден: ${error.message}`);
    }
    return newsChannel;
}

async function checkAutoposts() {
    const channel = await resolveNewsChannel();
    if (!channel) return;

    const state = loadState();
    const week = db.duviri ? currentWeekStamp() : null;

    if (!state) {
        saveState({ circuitWeek: week, baroNotified: true }); // баро без поста до первого визита
        return;
    }

    if (week !== null && state.circuitWeek !== null && state.circuitWeek !== week) {
        await channel.send({ embeds: [circuitEmbed()] }).catch(e => console.warn(`⚠ автопост цепи: ${e.message}`));
    }
    if (week !== null) state.circuitWeek = week;

    try {
        const vt = await live.getBaro();
        if (vt && vt.active && state.baroId !== vt.id) {
            await channel.send({ embeds: [baroEmbed(vt)] }).catch(e => console.warn(`⚠ автопост Баро: ${e.message}`));
            state.baroId = vt.id;
        }
    } catch (error) {
        console.warn(`⚠ проверка Баро: ${error.message}`);
    }

    saveState(state);
}

// ========================================================================
// ЗАПУСК
// ========================================================================

const token = process.env.LOLKA_TOKEN || process.env.BOT_TOKEN;

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once(Events.ClientReady, async (c) => {
    console.log(`✓ Вошли как ${c.user.tag}`);

    try {
        const rest = c.rest; // внутренний REST клиента уже настроен на API Lolka
        const body = COMMANDS;
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(c.user.id, process.env.GUILD_ID),
                { body }
            );
            console.log(`✓ Команды зарегистрированы на сервере ${process.env.GUILD_ID}`);
        } else {
            await rest.put(Routes.applicationCommands(c.user.id), { body });
            console.log('✓ Глобальные команды зарегистрированы');
        }
    } catch (error) {
        console.error('❌ Не удалось зарегистрировать команды:', error.message);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isAutocomplete()) {
            const query = interaction.options.getFocused();
            let choices = [];
            if (interaction.commandName === 'search') {
                choices = autocompleteChoices(query, Object.values(db.warframes),
                    w => ({ name: `${w.nameRu} (${w.nameEn})`.slice(0, 100), value: w.nameEn }));
            } else if (interaction.commandName === 'mod') {
                choices = autocompleteChoices(query, Object.values(db.mods),
                    m => ({ name: `${m.nameRu} (${m.nameEn})`.slice(0, 100), value: m.nameEn }));
            } else if (interaction.commandName === 'weapon') {
                choices = autocompleteChoices(query, Object.values(db.weapons),
                    w => ({ name: `${w.nameRu} (${w.nameEn})`.slice(0, 100), value: w.nameEn }));
            }
            await interaction.respond(choices);
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'circuit') {
            if (!db.duviri) {
                await interaction.reply({ content: '❌ Расписание цепи не загружено (нет data/duviri.json).', ephemeral: true });
                return;
            }
            await interaction.reply({ embeds: [circuitEmbed()] });
            return;
        }

        // Live-команды: запрос к API, ответ может занять пару секунд
        const LIVE_HANDLERS = {
            fissures: fissuresEmbed,
            sortie: sortieEmbed,
            arbitration: arbitrationEmbed,
            time: timeEmbed,
            baro: async () => {
                const vt = await live.getBaro();
                if (!vt) throw new Error('Баро не найден в worldState');
                return baroEmbed(vt);
            }
        };
        if (LIVE_HANDLERS[interaction.commandName]) {
            await interaction.deferReply();
            try {
                await interaction.editReply({ embeds: [await LIVE_HANDLERS[interaction.commandName]()] });
            } catch (error) {
                console.error(`❌ live-команда ${interaction.commandName}:`, error.message);
                await interaction.editReply({ content: '❌ Live-данные сейчас недоступны, попробуйте позже.' });
            }
            return;
        }

        const query = interaction.options.getString('запрос');

        if (interaction.commandName === 'search') {
            const wf = findWarframe(query);
            if (!wf) {
                await interaction.reply({ content: `❌ Варфрейм «${query}» не найден.`, ephemeral: true });
                return;
            }
            await interaction.reply({ embeds: [warframeEmbed(wf)] });
        } else if (interaction.commandName === 'mod') {
            const mod = findMod(query);
            if (!mod) {
                await interaction.reply({ content: `❌ Мод «${query}» не найден.`, ephemeral: true });
                return;
            }
            await interaction.reply({ embeds: [modEmbed(mod)] });
        } else if (interaction.commandName === 'weapon') {
            const w = findWeapon(query);
            if (!w) {
                await interaction.reply({ content: `❌ Оружие «${query}» не найдено.`, ephemeral: true });
                return;
            }
            await interaction.reply({ embeds: [weaponEmbed(w)] });
        }
    } catch (error) {
        console.error('❌ Ошибка обработки взаимодействия:', error);
    }
});

module.exports = {
    findWarframe, findMod, findWeapon,
    warframeEmbed, modEmbed, weaponEmbed, circuitEmbed,
    autocompleteChoices
};

if (require.main === module) {
    if (!token) {
        console.error('❌ Не задан токен. Укажите LOLKA_TOKEN в окружении или .env');
        process.exit(1);
    }
    setInterval(checkWeeklyUpdate, UPDATE_CHECK_MS);
    checkWeeklyUpdate();
    client.login(token).then(() => {
        setInterval(checkAutoposts, AUTOPOST_CHECK_MS);
        // первый запуск — инициализация состояния без постов
        setTimeout(checkAutoposts, 10_000);
    }).catch(error => {
        console.error('❌ Ошибка входа:', error.message);
        process.exit(1);
    });
}
