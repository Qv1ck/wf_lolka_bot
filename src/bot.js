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
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, Events
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

const warframes = loadJson('warframes.json');
const mods = loadJson('mods.json');
const weapons = loadJson('weapons.json');
const drops = loadJson('drops.json');
const aliases = loadJson('aliases.json');
const meta = loadJson('meta.json', {});

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

const MARKET_URL = 'https://warframe.market/ru/items';

// ========================================================================
// ПОИСК
// ========================================================================

function findWarframe(query) {
    const q = query.toLowerCase().trim();
    if (aliases[q]) return warframes[aliases[q]] || null;

    const entries = Object.values(warframes);
    const aliasKeys = Object.keys(aliases);
    const aliasMatch = aliasKeys.find(a => a.startsWith(q));

    return entries.find(w => w.nameEn.toLowerCase() === q || w.nameRu.toLowerCase() === q)
        || entries.find(w => w.nameEn.toLowerCase().startsWith(q) || w.nameRu.toLowerCase().startsWith(q))
        || (aliasMatch && warframes[aliases[aliasMatch]])
        || entries.find(w => w.nameEn.toLowerCase().includes(q) || w.nameRu.toLowerCase().includes(q))
        || null;
}

function findMod(query) {
    const q = query.toLowerCase().trim();
    const entries = Object.values(mods);
    return entries.find(m => m.nameEn.toLowerCase() === q || m.nameRu.toLowerCase() === q)
        || entries.find(m => m.nameEn.toLowerCase().startsWith(q) || m.nameRu.toLowerCase().startsWith(q))
        || entries.find(m => m.nameEn.toLowerCase().includes(q) || m.nameRu.toLowerCase().includes(q))
        || null;
}

function findWeapon(query) {
    const q = query.toLowerCase().trim();
    const entries = Object.values(weapons);
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
    const date = meta.generatedAt
        ? new Date(meta.generatedAt).toLocaleDateString('ru-RU')
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
    const entry = drops[baseName];
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
    const entry = drops[baseName];
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
    return `||${set}||\n||${parts}||`;
}

function warframeEmbed(wf) {
    const embed = new EmbedBuilder()
        .setTitle(`🤖 ${wf.nameRu} (${wf.nameEn})`)
        .setDescription(truncate(cleanDescription(wf.description), 400) || null)
        .setColor(wf.isPrime ? COLOR_PRIME : COLOR_BASE)
        .setFooter(dataFooter());

    if (wf.isPrime && wf.market?.thumb) embed.setThumbnail(wf.market.thumb);

    wf.abilities.forEach((a, i) => {
        embed.addFields({
            name: `${i + 1}. ${a.name}`,
            value: truncate(cleanDescription(a.description), 300) || '\u200b'
        });
    });

    const s = wf.stats;
    embed.addFields({
        name: '📊 Характеристики',
        value: `❤️ ${s.health} · 🛡 ${s.shield} · 🔩 ${s.armor} · ⚡ ${s.energy} · 🏃 ${s.sprint}` +
               (s.mr ? ` · 🎖 РМ ${s.mr}` : ''),
        inline: false
    });

    if (wf.passive) {
        embed.addFields({ name: '✨ Пассивная способность', value: truncate(cleanDescription(wf.passive), 300) });
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
    return embed;
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
    }
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
// ЗАПУСК
// ========================================================================

const token = process.env.LOLKA_TOKEN || process.env.BOT_TOKEN;

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once(Events.ClientReady, async (c) => {
    console.log(`✓ Вошли как ${c.user.tag}`);

    try {
        const rest = new REST().setToken(token);
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
                choices = autocompleteChoices(query, Object.values(warframes),
                    w => ({ name: `${w.nameRu} (${w.nameEn})`.slice(0, 100), value: w.nameEn }));
            } else if (interaction.commandName === 'mod') {
                choices = autocompleteChoices(query, Object.values(mods),
                    m => ({ name: `${m.nameRu} (${m.nameEn})`.slice(0, 100), value: m.nameEn }));
            } else if (interaction.commandName === 'weapon') {
                choices = autocompleteChoices(query, Object.values(weapons),
                    w => ({ name: `${w.nameRu} (${w.nameEn})`.slice(0, 100), value: w.nameEn }));
            }
            await interaction.respond(choices);
            return;
        }

        if (!interaction.isChatInputCommand()) return;

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
    warframeEmbed, modEmbed, weaponEmbed,
    autocompleteChoices
};

if (require.main === module) {
    if (!token) {
        console.error('❌ Не задан токен. Укажите LOLKA_TOKEN в окружении или .env');
        process.exit(1);
    }
    client.login(token).catch(error => {
        console.error('❌ Ошибка входа:', error.message);
        process.exit(1);
    });
}
