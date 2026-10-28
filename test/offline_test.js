// Офлайн-проверка поиска и сборки embed'ов без подключения к Lolka
const assert = require('assert');
const {
    findWarframe, findMod, findWeapon,
    warframeEmbed, modEmbed, weaponEmbed, circuitEmbed
} = require('../src/bot');

// --- Поиск варфреймов ---
assert.strictEqual(findWarframe('Локи')?.nameEn, 'Loki', 'по русскому имени');
assert.strictEqual(findWarframe('loki')?.nameEn, 'Loki', 'по английскому имени');
assert.strictEqual(findWarframe('некр')?.nameEn, 'Nekros', 'по народному прозвищу');
assert.strictEqual(findWarframe('абизян')?.nameEn, 'Wukong', 'по мемному прозвищу');
assert.strictEqual(findWarframe('Локи Прайм')?.nameEn, 'Loki Prime', 'прайм напрямую');
assert.strictEqual(findWarframe('экс')?.nameEn, 'Excalibur', 'короткий алиас');
assert.ok(findWarframe('asdfrandomnonexistent') === null, 'мусор не находится');

// --- Embed варфрейма ---
const loki = findWarframe('Локи');
const embed = warframeEmbed(loki).toJSON();
assert.strictEqual(embed.title, '🤖 Локи (Loki)');
assert.ok(embed.fields.some(f => f.name === '⚡ Способности' && f.value.includes('Приманка')), 'способности из манифеста');
assert.ok(embed.fields.some(f => f.name === '🧬 Гельминт-способность'), 'гельминт');
assert.ok(embed.fields.some(f => f.name === '🌀 Цепь Дувири'), 'цепь дувири');
assert.ok(embed.fields.some(f => f.name === '🎯 Где добыть'), 'места дропа');
const primeField = embed.fields.find(f => f.name.includes('Локи Прайм'));
assert.ok(primeField, 'поле прайм-версии');
assert.ok(primeField.value.includes('warframe.market/ru/items/loki_prime_set'), 'ссылка на маркет');

// --- Прайм-вариант напрямую ---
const lokiPrime = findWarframe('Loki Prime');
const primeEmbed = warframeEmbed(lokiPrime).toJSON();
assert.ok(primeEmbed.fields.some(f => f.name === '🏺 Реликвии'), 'реликвии у прайма');
assert.ok(primeEmbed.thumbnail?.url, 'иконка с маркета у прайма');

// --- Моды ---
const serration = findMod('Зазубрины');
assert.ok(serration, 'мод по русскому имени');
const modE = modEmbed(serration).toJSON();
assert.ok(modE.fields.some(f => f.value.includes('Мадурай')), 'полярность по-русски');
assert.ok(modE.fields.some(f => f.value.includes('+15% урона')), 'ранг 0');
assert.ok(modE.fields.some(f => f.value.includes('+165% урона')), 'макс ранг');

// --- Оружие ---
const soma = findWeapon('Сома');
assert.ok(soma, 'оружие по русскому имени');
const wE = weaponEmbed(soma).toJSON();
assert.ok(JSON.stringify(wE).includes('Крит'), 'характеристики оружия');

// --- Гельминт из сгенерированных данных (вики) ---
assert.ok(loki.helminth, 'гельминт в данных Локи');
assert.strictEqual(loki.helminth.nameEn, 'Decoy', 'гельминт Локи — Decoy по вики');
assert.strictEqual(loki.helminth.name, 'Приманка', 'гельминт Локи по-русски');

// --- Цепь Дувири: расписание из browse.wf ---
const duviri = require('../data/duviri.json');
assert.strictEqual(duviri.frames.length, 11, '11 недель варфреймов');
assert.strictEqual(duviri.weapons.length, 9, '9 недель оружия');
assert.ok(duviri.frames.some(week => week.some(f => f.nameEn === 'Loki')), 'Локи есть в расписании');
const circuit = circuitEmbed().toJSON();
assert.ok(circuit.fields[0].value.length > 0, 'текущие варфреймы цепи');
assert.ok(circuit.fields[1].value.length > 0, 'текущие инкарнон-оружия');

// --- Лимиты embed (Lolka: поле ≤ 1024, сумма ≤ 6000) ---
for (const [name, wf] of Object.entries(require('../data/warframes.json'))) {
    const e = warframeEmbed(wf).toJSON();
    const total = (e.title?.length || 0) + (e.description?.length || 0) +
        (e.fields || []).reduce((s, f) => s + f.name.length + f.value.length, 0);
    assert.ok(total <= 6000, `лимит 6000 символов: ${name} (${total})`);
    for (const f of e.fields || []) {
        assert.ok(f.value.length <= 1024, `лимит поля 1024: ${name} / ${f.name} (${f.value.length})`);
    }
}

console.log('✔ Все офлайн-проверки пройдены');
