const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ECON_FILE  = path.join(__dirname, 'data', 'econ.json');
const CORP_FILE  = path.join(__dirname, 'data', 'corp.json');
const SHOP_FILE  = path.join(__dirname, 'data', 'shop.json');
const CRYPTO_FILE = path.join(__dirname, 'data', 'crypto.json');

const EPH = { flags: MessageFlags.Ephemeral };
const CURRENCY = '🪙';
const CORP_COST = 10000;
const FEE_RATE = 0.02; // 売買手数料2%
const round3 = (x) => Math.round(x * 1000) / 1000;
const fmtPrice = (x) => Number.isInteger(x) ? x.toLocaleString() : x.toFixed(3).replace(/\.?0+$/, '');

// ==================== データ管理 ====================
function load(f) {
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 4)); }

function getUser(econ, userId, user) {
    if (!econ[userId]) econ[userId] = { balance: 0, dailyLast: 0, workLast: 0, crimeLast: 0, huntLast: 0, fishLast: 0, inventory: [], stocks: {}, crypto: {}, loan: 0 };
    if (user) econ[userId].username = user.username;
    return econ[userId];
}

// ==================== ユーティリティ ====================
function cdStr(remaining) {
    if (remaining <= 0) return '✅ 準備完了';
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    if (h > 0) return `⏳ あと${h}時間${m}分`;
    if (m > 0) return `⏳ あと${m}分${s}秒`;
    return `⏳ あと${s}秒`;
}

function applyDebt(u) {
    if (u.balance >= 0) return null;
    const debt = Math.abs(u.balance);
    u.loan = (u.loan || 0) + debt;
    u.balance = 0;
    if (!u.loanDate) u.loanDate = Date.now();
    if (!u.lastInterestCharge) u.lastInterestCharge = Date.now();
    return `⚠️ 残高不足のため ${debt.toLocaleString()} 🪙 が自動借入されました（借入合計: ${u.loan.toLocaleString()} 🪙）`;
}

const delBtn = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('delete_reply').setLabel('🗑️ 削除').setStyle(ButtonStyle.Secondary)
);

// ==================== 株式チャート ====================
function buildStockChart(history) {
    if (!history || history.length < 2) return null;
    const h = history.slice(-10);
    const max = Math.max(...h), min = Math.min(...h);
    const rows = 5;
    const chart = Array.from({ length: rows }, () => Array(h.length).fill(' '));
    h.forEach((v, x) => {
        const row = max === min ? 0 : Math.floor((max - v) / (max - min) * (rows - 1));
        chart[row][x] = '█';
    });
    const lines = chart.map((row, i) => {
        const label = (max - (max - min) * i / (rows - 1)).toFixed(0).padStart(6);
        return `${label} |${row.join('')}`;
    });
    return lines.join('\n') + `\n${'─'.repeat(7 + h.length)}`;
}

// ==================== ブラックジャック ====================
const bjGames = new Map();
function buildDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const deck = [];
    for (const s of suits) for (const r of ranks) deck.push(`${r}${s}`);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return deck;
}
function drawCard(deck) { return deck.pop(); }
function cardValue(card) {
    const r = card.slice(0, -1);
    if (r === 'A') return 11;
    if (['J', 'Q', 'K'].includes(r)) return 10;
    return parseInt(r);
}
function calcBJ(cards) {
    let total = cards.reduce((s, c) => s + cardValue(c), 0);
    let aces = cards.filter(c => c.startsWith('A')).length;
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}
function buildBJEmbed(game, status, balance, user) {
    const playerTotal = calcBJ(game.playerCards);
    const dealerTotal = calcBJ(game.dealerCards);
    const mention = user ? `<@${user.id}> ` : '';
    const statusMap = {
        playing: { title: '🃏 ブラックジャック', color: 0x3498db, desc: '' },
        win:     { title: '🎉 勝利！', color: 0x57f287, desc: `${mention}**+${game.bet.toLocaleString()}** 🪙 獲得！\n残高: **${balance?.toLocaleString()}** 🪙` },
        lose:    { title: '😢 負け...', color: 0xff4757, desc: `${mention}**-${game.bet.toLocaleString()}** 🪙\n残高: **${balance?.toLocaleString()}** 🪙` },
        push:    { title: '🤝 引き分け', color: 0x95a5a6, desc: `${mention}賭け金は返還されました。\n残高: **${balance?.toLocaleString()}** 🪙` },
        bust:    { title: '💥 バスト！', color: 0xff4757, desc: `${mention}**-${game.bet.toLocaleString()}** 🪙\n残高: **${balance?.toLocaleString()}** 🪙` },
        bj:      { title: '🃏 ブラックジャック！', color: 0xf1c40f, desc: `${mention}**+${Math.floor(game.bet * 1.5).toLocaleString()}** 🪙 獲得！\n残高: **${balance?.toLocaleString()}** 🪙` },
    };
    const s = statusMap[status];
    const dealerShow = status === 'playing' ? `${game.dealerCards[0]} ??` : game.dealerCards.join(' ');
    const dealerScore = status === 'playing' ? '?' : dealerTotal;
    return new EmbedBuilder().setTitle(s.title).setColor(s.color)
        .addFields(
            { name: `ディーラー (${dealerScore})`, value: dealerShow, inline: false },
            { name: `あなた (${playerTotal})`, value: game.playerCards.join(' '), inline: false }
        )
        .setDescription(s.desc || `${mention}賭け金: **${game.bet.toLocaleString()}** 🪙　レバレッジ: **${game.leverage || 2}x**`)
        .setFooter({ text: 'ヒット=カードを引く / スタンド=終了 / ダブル=2倍賭けで1枚引いて終了' });
}
function buildBJRows(gameKey) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${gameKey}`).setLabel('ヒット').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj_stand_${gameKey}`).setLabel('スタンド').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj_double_${gameKey}`).setLabel('ダブルダウン').setStyle(ButtonStyle.Danger)
    )];
}

// ==================== UI Panels ====================
function buildBankPanel(u) {
    const loan = u.loan || 0;
    const embed = new EmbedBuilder()
        .setTitle('🏦 銀行')
        .setColor(0x2ecc71)
        .addFields(
            { name: '残高', value: `**${u.balance.toLocaleString()}** ${CURRENCY}`, inline: true },
            { name: '借入残高', value: `**${loan.toLocaleString()}** ${CURRENCY}`, inline: true },
            { name: 'ローン上限', value: `**5,000** ${CURRENCY}`, inline: true }
        )
        .setDescription('ローンを借りると3時間ごとに5%の利子が加算されます。')
        .setFooter({ text: '金額は数字・all・halfで指定できます' });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bank_loan').setLabel('💸 借りる').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bank_repay').setLabel('💰 返済する').setStyle(ButtonStyle.Success).setDisabled(loan <= 0),
        new ButtonBuilder().setCustomId('bank_reload').setLabel('🔄 リロード').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

function buildEarnPanel(u, now) {
    const jstNow = new Date(now + 9 * 3600000);
    const todayStr = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth()+1).padStart(2,'0')}-${String(jstNow.getUTCDate()).padStart(2,'0')}`;
    const dailyDone = u.dailyDate === todayStr;
    const workRem  = 3600000  - (now - (u.workLast  || 0));
    const crimeRem = 7200000  - (now - (u.crimeLast || 0));
    const huntRem  = 1800000  - (now - (u.huntLast  || 0));
    const fishRem  = 2700000  - (now - (u.fishLast  || 0));
    const streak = u.dailyStreak || 0;
    const embed = new EmbedBuilder()
        .setTitle('💰 お金を稼ぐ')
        .setColor(0xf1c40f)
        .addFields(
            { name: '🎁 デイリー', value: `200〜400+ボーナス ${CURRENCY}\n連続${streak}日目 🔥\n${dailyDone ? '⏳ 受取済（深夜0時リセット）' : '✅ 準備完了'}`, inline: true },
            { name: '💼 労働', value: `50〜300 ${CURRENCY}\nCD: 1時間\n${cdStr(workRem)}`, inline: true },
            { name: '🦹 犯罪', value: `成功: 100〜2000 ${CURRENCY}\n失敗: 没収あり\nCD: 2時間\n${cdStr(crimeRem)}`, inline: true },
            { name: '🏹 狩猟', value: `アイテムドロップ\nCD: 30分\n${cdStr(huntRem)}\n\`/earn hunt\``, inline: true },
            { name: '🎣 釣り', value: `魚ドロップ（レア有）\nCD: 45分\n${cdStr(fishRem)}\n\`/earn fish\``, inline: true },
            { name: '🎲 ゲーム', value: '`/earn rob` 強盗\n`/earn flip` コインフリップ\n`/earn slots` スロット\n`/earn bj` BJ', inline: true }
        );
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('earn_daily').setLabel('🎁 デイリー').setStyle(ButtonStyle.Success).setDisabled(dailyDone),
        new ButtonBuilder().setCustomId('earn_work').setLabel('💼 労働').setStyle(ButtonStyle.Primary).setDisabled(workRem > 0),
        new ButtonBuilder().setCustomId('earn_crime').setLabel('🦹 犯罪').setStyle(ButtonStyle.Danger).setDisabled(crimeRem > 0)
    );
    return { embeds: [embed], components: [row1] };
}

// ==================== Slash Command Definitions ====================
const econCommands = [
    new SlashCommandBuilder().setName('balance').setDescription('所持金を確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー')),
    new SlashCommandBuilder().setName('pay').setDescription('他のユーザーに送金します').addUserOption(o => o.setName('user').setDescription('送金先').setRequired(true)).addStringOption(o => o.setName('amount').setDescription('金額（数字・all・half）').setRequired(true)),
    new SlashCommandBuilder().setName('earn').setDescription('お金を稼ぎます')
        .addSubcommand(sub => sub.setName('panel').setDescription('稼ぎパネルを表示'))
        .addSubcommand(sub => sub.setName('daily').setDescription('デイリーボーナスを受け取る'))
        .addSubcommand(sub => sub.setName('work').setDescription('働いてお金を稼ぐ'))
        .addSubcommand(sub => sub.setName('crime').setDescription('犯罪に手を染める'))
        .addSubcommand(sub => sub.setName('hunt').setDescription('狩猟する（CD: 30分）'))
        .addSubcommand(sub => sub.setName('fish').setDescription('釣りをする（CD: 45分）'))
        .addSubcommand(sub => sub.setName('rob').setDescription('強盗する').addStringOption(o => o.setName('target').setDescription('ターゲットのID or メンション').setRequired(true)))
        .addSubcommand(sub => sub.setName('flip').setDescription('コインフリップ').addStringOption(o => o.setName('amount').setDescription('金額').setRequired(true)).addStringOption(o => o.setName('side').setDescription('omote か ura').setRequired(true)))
        .addSubcommand(sub => sub.setName('slots').setDescription('スロット').addStringOption(o => o.setName('amount').setDescription('金額').setRequired(true)))
        .addSubcommand(sub => sub.setName('bj').setDescription('ブラックジャック').addStringOption(o => o.setName('amount').setDescription('金額').setRequired(true)).addIntegerOption(o => o.setName('leverage').setDescription('レバレッジ倍率(2〜10)').setMinValue(2).setMaxValue(10))),
    new SlashCommandBuilder().setName('shop').setDescription('ショップのアイテム一覧を表示します'),
    new SlashCommandBuilder().setName('buy').setDescription('アイテムを購入します').addStringOption(o => o.setName('item').setDescription('アイテム名')),
    new SlashCommandBuilder().setName('sell').setDescription('インベントリのアイテムを売却します').addStringOption(o => o.setName('item').setDescription('アイテム名')).addIntegerOption(o => o.setName('amount').setDescription('売却数').setMinValue(1)),
    new SlashCommandBuilder().setName('inventory').setDescription('所持アイテムを確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー')),
    new SlashCommandBuilder().setName('econrank').setDescription('所持金ランキングを表示します'),
    new SlashCommandBuilder().setName('bank').setDescription('銀行メニュー（残高確認・ローン・返済）'),
    new SlashCommandBuilder().setName('corp')
        .setDescription('会社の管理')
        .addSubcommand(sub => sub.setName('create').setDescription('会社を設立します（費用10,000枚）')
            .addStringOption(o => o.setName('name').setDescription('会社名').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('会社の説明').setRequired(true)))
        .addSubcommand(sub => sub.setName('setting').setDescription('会社の管理・ストア設定').addStringOption(o => o.setName('corp').setDescription('会社名')))
        .addSubcommand(sub => sub.setName('deposit').setDescription('会社にお金を入れます')
            .addStringOption(o => o.setName('amount').setDescription('金額').setRequired(true))
            .addStringOption(o => o.setName('corp').setDescription('会社名'))),
    new SlashCommandBuilder().setName('crypto')
        .setDescription('仮想通貨市場')
        .addSubcommand(sub => sub.setName('create').setDescription('仮想通貨を発行します')
            .addStringOption(o => o.setName('name').setDescription('通貨名').setRequired(true))
            .addStringOption(o => o.setName('symbol').setDescription('シンボル').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('仮想通貨一覧を表示します'))
        .addSubcommand(sub => sub.setName('view').setDescription('詳細表示').addStringOption(o => o.setName('symbol').setDescription('シンボル')))
        .addSubcommand(sub => sub.setName('buy').setDescription('仮想通貨を購入')
            .addStringOption(o => o.setName('amount').setDescription('枚数').setRequired(true))
            .addStringOption(o => o.setName('symbol').setDescription('シンボル')))
        .addSubcommand(sub => sub.setName('sell').setDescription('仮想通貨を売却')
            .addStringOption(o => o.setName('amount').setDescription('枚数').setRequired(true))
            .addStringOption(o => o.setName('symbol').setDescription('シンボル'))),
    new SlashCommandBuilder().setName('buystock').setDescription('株を購入')
        .addStringOption(o => o.setName('amount').setDescription('株数').setRequired(true))
        .addStringOption(o => o.setName('corp').setDescription('会社名')),
    new SlashCommandBuilder().setName('sellstock').setDescription('株を売却')
        .addIntegerOption(o => o.setName('amount').setDescription('株数').setRequired(true))
        .addStringOption(o => o.setName('corp').setDescription('会社名')),
    new SlashCommandBuilder().setName('stock').setDescription('株式市場を表示').addStringOption(o => o.setName('corp').setDescription('会社名')),
];

// ==================== Main Logic Functions ====================
async function doBuyItem(interaction, itemName, econ, user, guild, shop) {
    const item = Object.values(shop || load(SHOP_FILE)).find(i => i.name.toLowerCase() === itemName.toLowerCase());
    if (!item) return interaction.reply({ content: `❌ **${itemName}** は存在しません。`, ...EPH });
    const u = getUser(econ, user.id, user);
    if (u.balance < item.price) return interaction.reply({ content: `❌ 残高不足。必要: **${item.price.toLocaleString()}** / 現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
    u.balance -= item.price;
    if (!u.inventory) u.inventory = [];
    u.inventory.push({ name: item.name, boughtAt: Date.now(), sellPrice: Math.floor(item.price * 0.5) });
    save(ECON_FILE, econ);
    if (item.roleId && guild) {
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (member) await member.roles.add(item.roleId).catch(() => {});
    }
    const embed = new EmbedBuilder().setTitle('✅ 購入完了').setColor(0x57f287)
        .setDescription(`**${item.name}** を購入しました！\n残高: **${u.balance.toLocaleString()}** 🪙${item.roleId ? '\n🏷️ ロールが付与されました。' : ''}`).setTimestamp();
    return interaction.reply({ embeds: [embed], components: [delBtn()] });
}

async function doSellItem(interaction, itemName, sellCount, econ, u) {
    if (!u.inventory) u.inventory = [];
    const indices = [];
    for (let i = 0; i < u.inventory.length && indices.length < sellCount; i++) {
        if (u.inventory[i].name.toLowerCase() === itemName.toLowerCase()) indices.push(i);
    }
    if (indices.length === 0) return interaction.reply({ content: `❌ **${itemName}** をインベントリに持っていません。`, ...EPH });
    if (indices.length < sellCount) return interaction.reply({ content: `❌ **${itemName}** は ${indices.length} 個しか持っていません。`, ...EPH });
    const totalPrice = indices.reduce((sum, i) => sum + (u.inventory[i].sellPrice || 0), 0);
    for (const i of [...indices].reverse()) u.inventory.splice(i, 1);
    u.balance += totalPrice;
    save(ECON_FILE, econ);
    return interaction.reply({ content: `✅ **${itemName}** × ${sellCount} を **${totalPrice.toLocaleString()}** 🪙 で売却しました。\n残高: **${u.balance.toLocaleString()}** 🪙`, components: [delBtn()] });
}

async function showStockDetail(interaction, c, econ, user) {
    const u = getUser(econ, user.id, user);
    const price = c.stock.price;
    const history = c.stock.history || [];
    const chartStr = buildStockChart(history);
    const userShares = (u.stocks || {})[c.id] || 0;
    const prev = history[history.length - 2] || price;
    const embed = new EmbedBuilder()
        .setTitle(`📈 ${c.name} 株式情報`)
        .setColor(price > prev ? 0x57f287 : price < prev ? 0xff4757 : 0x3498db)
        .addFields(
            { name: '現在株価', value: `**${fmtPrice(price)}** 🪙`, inline: true },
            { name: '発行株数', value: `**${c.stock.totalShares.toLocaleString()}** 株`, inline: true },
            { name: '保有株数', value: `**${userShares}** 株`, inline: true },
            { name: '購入可能', value: `**${c.stock.availableShares}** 株`, inline: true },
            { name: '時価総額', value: `**${fmtPrice(round3(price * c.stock.totalShares))}** 🪙`, inline: true },
            { name: '手数料', value: '売買各2%', inline: true }
        )
        .setDescription(chartStr ? `\`\`\`\n${chartStr}\n\`\`\`` : '価格履歴なし');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`stock_buy_${c.id}`).setLabel('📈 買う').setStyle(ButtonStyle.Success).setDisabled(c.stock.availableShares <= 0),
        new ButtonBuilder().setCustomId(`stock_sell_${c.id}`).setLabel('📉 売る').setStyle(ButtonStyle.Danger).setDisabled(userShares <= 0),
        new ButtonBuilder().setCustomId(`stock_refresh_${c.id}`).setLabel('🔄 更新').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({ embeds: [embed], components: [row, delBtn()] });
}

async function doBuyStock(interaction, c, amount, econ, user, corpData) {
    const u = getUser(econ, user.id, user);
    const price = c.stock.price;
    const subtotal = round3(price * amount);
    const fee = round3(subtotal * FEE_RATE);
    const total = round3(subtotal + fee);
    if (u.balance < total) return interaction.reply({ content: `❌ 残高不足。必要: **${fmtPrice(total)}** 🪙\n現在: **${fmtPrice(u.balance)}** 🪙`, ...EPH });
    if (c.stock.availableShares < amount) return interaction.reply({ content: `❌ 在庫不足。現在: **${c.stock.availableShares}** 株`, ...EPH });
    u.balance = round3(u.balance - total);
    if (!u.stocks) u.stocks = {};
    u.stocks[c.id] = (u.stocks[c.id] || 0) + amount;
    c.stock.availableShares -= amount;
    c.balance = round3((c.balance || 0) + subtotal);
    const ratio = 1 + 0.01 * Math.min(amount, 10);
    c.stock.price = round3(price * ratio);
    if (!c.stock.history) c.stock.history = [];
    c.stock.history.push(c.stock.price);
    if (c.stock.history.length > 30) c.stock.history.shift();
    save(ECON_FILE, econ);
    save(CORP_FILE, corpData);
    return interaction.reply({ content: `✅ **${c.name}** の株を **${amount}** 株 購入！\n現在株価: **${fmtPrice(c.stock.price)}** 🪙`, components: [delBtn()] });
}

async function doSellStock(interaction, c, amount, econ, u, corpData) {
    const held = (u.stocks || {})[c.id] || 0;
    if (held < amount) return interaction.reply({ content: `❌ 保有株数不足。現在: **${held}** 株`, ...EPH });
    const price = c.stock.price;
    const subtotal = round3(price * amount);
    const fee = round3(subtotal * FEE_RATE);
    const total = round3(subtotal - fee);
    u.balance = round3(u.balance + total);
    u.stocks[c.id] -= amount;
    c.stock.availableShares += amount;
    const ratio = 1 - 0.008 * Math.min(amount, 10);
    c.stock.price = round3(Math.max(0.001, price * ratio));
    if (!c.stock.history) c.stock.history = [];
    c.stock.history.push(c.stock.price);
    if (c.stock.history.length > 30) c.stock.history.shift();
    save(ECON_FILE, econ);
    save(CORP_FILE, corpData);
    return interaction.reply({ content: `✅ **${c.name}** の株を **${amount}** 株 売却！\n現在株価: **${fmtPrice(c.stock.price)}** 🪙`, components: [delBtn()] });
}

async function showCryptoDetail(interaction, coin, econ, user, CRYPTO_FILE, isUpdate = false) {
    const u = getUser(econ, user.id, user);
    const price = coin.price;
    const history = coin.history || [];
    const chartStr = buildStockChart(history);
    const held = (u.crypto || {})[coin.id] || 0;
    const prev = history[history.length - 2] || price;
    const embed = new EmbedBuilder()
        .setTitle(`💹 ${coin.name} (${coin.symbol})`)
        .setColor(price > prev ? 0x57f287 : price < prev ? 0xff4757 : 0xf1c40f)
        .addFields(
            { name: '現在価格', value: `**${fmtPrice(price)}** 🪙`, inline: true },
            { name: '保有枚数', value: `${held.toLocaleString()}`, inline: true },
            { name: '購入可能', value: `${coin.availableSupply.toLocaleString()}`, inline: true },
            { name: '時価総額', value: `**${fmtPrice(round3(price * coin.totalSupply))}** 🪙`, inline: true },
            { name: '手数料', value: '売買各2%', inline: true }
        )
        .setDescription(chartStr ? `\`\`\`\n${chartStr}\n\`\`\`` : '価格履歴なし');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`crypto_buy_${coin.id}`).setLabel('💰 買う').setStyle(ButtonStyle.Success).setDisabled(coin.availableSupply <= 0),
        new ButtonBuilder().setCustomId(`crypto_sell_${coin.id}`).setLabel('💸 売る').setStyle(ButtonStyle.Danger).setDisabled(held <= 0),
        new ButtonBuilder().setCustomId(`crypto_refresh_${coin.id}`).setLabel('🔄 更新').setStyle(ButtonStyle.Secondary)
    );
    if (isUpdate) return interaction.update({ embeds: [embed], components: [row, delBtn()] });
    return interaction.reply({ embeds: [embed], components: [row, delBtn()] });
}

async function doBuyCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE) {
    let amount;
    if (amtInput === 'all') amount = Math.min(Math.floor(u.balance / (coin.price * (1 + FEE_RATE))), coin.availableSupply);
    else amount = parseInt(amtInput) || 0;
    if (amount <= 0) return interaction.reply({ content: '❌ 正しい枚数を入力してください。', ...EPH });
    if (coin.availableSupply < amount) return interaction.reply({ content: `❌ 在庫不足。現在: **${coin.availableSupply.toLocaleString()}** 枚`, ...EPH });
    const subtotal = round3(coin.price * amount);
    const fee = round3(subtotal * FEE_RATE);
    const total = round3(subtotal + fee);
    if (u.balance < total) return interaction.reply({ content: `❌ 残高不足。必要: **${fmtPrice(total)}** 🪙`, ...EPH });
    u.balance = round3(u.balance - total);
    if (!u.crypto) u.crypto = {};
    u.crypto[coin.id] = (u.crypto[coin.id] || 0) + amount;
    coin.availableSupply -= amount;
    const ratio = 1 + 0.005 * Math.min(Math.log10(amount + 1), 5);
    coin.price = round3(Math.max(0.001, coin.price * ratio));
    if (!coin.history) coin.history = [];
    coin.history.push(coin.price);
    save(ECON_FILE, econ);
    save(CRYPTO_FILE, cryptoData);
    return interaction.reply({ content: `✅ **${coin.name}** を **${amount.toLocaleString()}** 枚 購入！\n現在価格: **${fmtPrice(coin.price)}** 🪙`, components: [delBtn()] });
}

async function doSellCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE) {
    const held = (u.crypto || {})[coin.id] || 0;
    let amount = amtInput === 'all' ? held : parseInt(amtInput);
    if (isNaN(amount) || amount <= 0 || held < amount) return interaction.reply({ content: '❌ 枚数が正しくないか保有数が足りません。', ...EPH });
    const subtotal = round3(coin.price * amount);
    const fee = round3(subtotal * FEE_RATE);
    const total = round3(subtotal - fee);
    u.balance = round3(u.balance + total);
    u.crypto[coin.id] = held - amount;
    coin.availableSupply += amount;
    const ratio = 1 - 0.004 * Math.min(Math.log10(amount + 1), 5);
    coin.price = round3(Math.max(0.001, coin.price * ratio));
    if (!coin.history) coin.history = [];
    coin.history.push(coin.price);
    save(ECON_FILE, econ);
    save(CRYPTO_FILE, cryptoData);
    return interaction.reply({ content: `✅ **${coin.name}** を **${amount.toLocaleString()}** 枚 売却！\n現在価格: **${fmtPrice(coin.price)}** 🪙`, components: [delBtn()] });
}

async function showStore(interaction, c, user) {
    const embed = new EmbedBuilder().setTitle(`🏪 ${c.name}`).setDescription(c.description).setColor(0xe67e22)
        .addFields({ name: 'オーナー', value: c.ownerName, inline: true }, { name: '商品数', value: `${c.items.length}件`, inline: true });
    if (c.items.length > 0) embed.addFields({ name: '商品一覧', value: c.items.map((item, i) => `**${item.name}** — **${item.price.toLocaleString()}** 🪙\n${item.description}`).join('\n\n') });
    const rows = [];
    if (c.items.length > 0 && c.ownerId !== user.id) {
        const select = new StringSelectMenuBuilder().setCustomId(`store_buy_${c.id}`).setPlaceholder('購入する商品を選択')
            .addOptions(c.items.map(item => ({ label: item.name, description: `${item.price.toLocaleString()} 🪙`, value: item.name })));
        rows.push(new ActionRowBuilder().addComponents(select));
    }
    rows.push(delBtn());
    return interaction.reply({ embeds: [embed], components: rows });
}

async function showStoreManage(interaction, c, corpData, user) {
    const embed = new EmbedBuilder().setTitle(`⚙️ ${c.name} 管理`).setColor(0x9b59b6)
        .addFields({ name: '会社残高', value: `**${(c.balance || 0).toLocaleString()}** 🪙`, inline: true }, { name: '商品数', value: `${c.items.length}件`, inline: true });
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`store_additem_${c.id}`).setLabel('商品追加').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`store_removeitem_${c.id}`).setLabel('商品削除').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`store_withdraw_${c.id}`).setLabel('売上回収').setStyle(ButtonStyle.Success)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`store_issuestock_${c.id}`).setLabel('📊 株式発行').setStyle(ButtonStyle.Secondary).setDisabled(!!c.stock)
    );
    return interaction.reply({ embeds: [embed], components: [row1, row2], ...EPH });
}

// ==================== Main Handler ====================
async function handleEcon(interaction) {
    const { commandName, options, user, guild } = interaction;
    const econ = load(ECON_FILE);
    const now = Date.now();

    if (commandName === 'balance') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const corpData = load(CORP_FILE);
        const ownedCorps = Object.values(corpData).filter(c => c.ownerId === target.id);
        const loan = u.loan || 0;
        const netBalance = round3(u.balance - loan);
        const embed = new EmbedBuilder()
            .setTitle(`${CURRENCY} ${target.username} の所持金`)
            .setThumbnail(target.displayAvatarURL())
            .setColor(netBalance < 0 ? 0xff4757 : 0xf1c40f)
            .addFields(
                { name: '残高', value: `**${fmtPrice(u.balance)}** ${CURRENCY}`, inline: true },
                { name: '借入残高', value: loan > 0 ? `**-${fmtPrice(loan)}** ${CURRENCY}` : 'なし', inline: true },
                { name: '実質残高', value: `**${fmtPrice(netBalance)}** ${CURRENCY}${netBalance < 0 ? ' 🔴' : ''}`, inline: true },
                { name: '保有会社', value: ownedCorps.length > 0 ? ownedCorps.map(c => c.name).join(', ') : 'なし', inline: true }
            ).setTimestamp();
        const isSelf = target.id === user.id;
        const rows = [delBtn()];
        if (isSelf) {
            rows.unshift(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('balance_reload').setLabel('🔄 更新').setStyle(ButtonStyle.Secondary)
            ));
        }
        return interaction.reply({ embeds: [embed], components: rows });
    }

    if (commandName === 'pay') {
        const target = options.getUser('user');
        if (target.id === user.id) return interaction.reply({ content: '❌ 自分には送金できません。', ...EPH });
        if (target.bot) return interaction.reply({ content: '❌ Botには送金できません。', ...EPH });
        const sender = getUser(econ, user.id, user);
        const receiver = getUser(econ, target.id, target);
        const amtInput = options.getString('amount').trim().toLowerCase();
        let amount = amtInput === 'all' ? sender.balance : amtInput === 'half' ? Math.floor(sender.balance / 2) : parseInt(amtInput);
        if (isNaN(amount) || amount <= 0) return interaction.reply({ content: '❌ 正しい金額を入力してください。', ...EPH });
        if (sender.balance < amount) return interaction.reply({ content: `❌ 残高不足。`, ...EPH });
        sender.balance -= amount; receiver.balance += amount; save(ECON_FILE, econ);
        return interaction.reply({ content: `✅ <@${target.id}> に **${amount.toLocaleString()}** 🪙 を送金しました。` });
    }

    if (commandName === 'earn') {
        const sub = options.getSubcommand();
        const u = getUser(econ, user.id, user);

        if (sub === 'panel') return interaction.reply({ ...buildEarnPanel(u, now), ...EPH });

        if (sub === 'daily') {
            const jstNow = new Date(now + 9 * 3600000);
            const todayStr = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth()+1).padStart(2,'0')}-${String(jstNow.getUTCDate()).padStart(2,'0')}`;
            if (u.dailyDate === todayStr) return interaction.reply({ content: '⏳ 受取済（深夜0時リセット）', ...EPH });
            const streak = (u.dailyStreak || 0) + 1;
            const base = Math.floor(Math.random() * 201) + 200;
            const bonus = Math.min(streak, 7) * 50;
            const amount = base + bonus;
            u.balance += amount; u.dailyStreak = streak; u.dailyDate = todayStr; u.dailyLast = now;
            save(ECON_FILE, econ);
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎁 デイリー').setDescription(`**+${amount}** ${CURRENCY} 獲得！\n連続${streak}日目 🔥`).setColor(0x57f287)] });
        }

        if (sub === 'work') {
            const rem = 3600000 - (now - (u.workLast || 0));
            if (rem > 0) return interaction.reply({ content: `⏳ CD中: ${cdStr(rem)}`, ...EPH });
            const amt = Math.floor(Math.random() * (300 - 50 + 1)) + 50;
            u.balance += amt; u.workLast = now; save(ECON_FILE, econ);
            return interaction.reply({ content: `💼 働いて **${amt}** ${CURRENCY} 獲得！` });
        }

        if (sub === 'crime') {
            const rem = 7200000 - (now - (u.crimeLast || 0));
            if (rem > 0) return interaction.reply({ content: `⏳ CD中: ${cdStr(rem)}`, ...EPH });
            u.crimeLast = now;
            if (Math.random() < 0.45) {
                const amt = Math.floor(Math.random() * 1901) + 100;
                u.balance += amt; save(ECON_FILE, econ);
                return interaction.reply({ content: `🦹 成功！ **+${amt}** ${CURRENCY}` });
            } else {
                const fine = Math.floor(u.balance * 0.1) + 100;
                u.balance = Math.max(0, u.balance - fine); save(ECON_FILE, econ);
                return interaction.reply({ content: `🚔 失敗... **-${fine}** ${CURRENCY} 没収されました` });
            }
        }

        if (sub === 'hunt') {
            const remaining = 1800000 - (now - (u.huntLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ狩りに行けません。${cdStr(remaining)}`, ...EPH });
            u.huntLast = now;
            const hunts = [{ name: '🐰 ウサギの毛皮', sell: 80 }, { name: '🦌 シカの角', sell: 250 }, { name: '🐻 クマの毛皮', sell: 500 }];
            const hunt = hunts[Math.floor(Math.random() * hunts.length)];
            u.inventory.push({name:hunt.name, sellPrice:hunt.sell});
            save(ECON_FILE, econ);
            return interaction.reply({ content: `🏹 **${hunt.name}** を手に入れた！(売値: ${hunt.sell} 🪙)` });
        }

        if (sub === 'fish') {
            const remaining = 2700000 - (now - (u.fishLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ釣りに行けません。${cdStr(remaining)}`, ...EPH });
            u.fishLast = now;
            const fishes = [{ name: '🐟 コイ', sell: 60 }, { name: '🐡 フグ', sell: 300 }, { name: '✨ 伝説の魚', sell: 2000 }];
            const fish = fishes[Math.random() < 0.05 ? 2 : Math.random() < 0.2 ? 1 : 0];
            u.inventory.push({name:fish.name, sellPrice:fish.sell});
            save(ECON_FILE, econ);
            return interaction.reply({ content: `🎣 **${fish.name}** を釣った！(売値: ${fish.sell} 🪙)` });
        }

        if (sub === 'rob') {
            const targetInput = options.getString('target').replace(/[<@!>]/g, '');
            if (targetInput === user.id) return interaction.reply({ content: '自分は強盗できません', ...EPH });
            const victim = econ[targetInput];
            if (!victim || victim.balance < 100) return interaction.reply({ content: '相手が見つからないか残高不足です', ...EPH });
            if (Math.random() < 0.4) {
                const stolen = Math.floor(victim.balance * 0.2);
                u.balance += stolen; victim.balance -= stolen; save(ECON_FILE, econ);
                return interaction.reply({ content: `🔫 <@${targetInput}> から **${stolen}** 奪いました！` });
            } else {
                const fine = 200; u.balance = Math.max(0, u.balance - fine); save(ECON_FILE, econ);
                return interaction.reply({ content: `🚔 失敗！罰金 **${fine}**` });
            }
        }

        if (sub === 'flip') {
            const amtStr = options.getString('amount').toLowerCase(), side = options.getString('side').toLowerCase();
            let amt = amtStr === 'all' ? u.balance : parseInt(amtStr);
            if (isNaN(amt) || amt <= 0 || u.balance < amt) return interaction.reply({ content: '金額が不正です', ...EPH });
            const win = Math.random() < 0.5;
            u.balance += win ? amt : -amt; save(ECON_FILE, econ);
            return interaction.reply(win ? `🎉 勝ち！ **+${amt}**` : `😢 負け... **-${amt}**`);
        }

        if (sub === 'slots') {
            const amtStr = options.getString('amount').toLowerCase();
            let amt = amtStr === 'all' ? u.balance : parseInt(amtStr);
            if (isNaN(amt) || u.balance < amt) return interaction.reply({ content: '残高不足', ...EPH });
            const icons = ['🍒','💎','⭐'], res = [icons[Math.floor(Math.random()*3)],icons[Math.floor(Math.random()*3)],icons[Math.floor(Math.random()*3)]];
            const win = res[0]===res[1] && res[1]===res[2];
            u.balance += win ? amt*5 : -amt; save(ECON_FILE, econ);
            return interaction.reply(`🎰 [${res.join('|')}] ${win ? '当たり！' : 'ハズレ'}`);
        }

        if (sub === 'bj') {
            const amtStr = options.getString('amount').toLowerCase();
            const leverage = options.getInteger('leverage') || 2;
            let bet = amtStr === 'all' ? u.balance : parseInt(amtStr);
            if (isNaN(bet) || u.balance < bet) return interaction.reply('残高不足');
            const deck = buildDeck();
            const game = { userId: user.id, bet, leverage, deck, playerCards: [drawCard(deck), drawCard(deck)], dealerCards: [drawCard(deck), drawCard(deck)] };
            const key = `${user.id}_${now}`; bjGames.set(key, game);
            return interaction.reply({ embeds: [buildBJEmbed(game, 'playing', null, user)], components: buildBJRows(key) });
        }
    }

    if (commandName === 'bank') return interaction.reply(buildBankPanel(getUser(econ, user.id, user)));

    if (commandName === 'shop') {
        const shop = load(SHOP_FILE);
        const embed = new EmbedBuilder().setTitle('🛒 ショップ').setColor(0xe67e22)
            .addFields(Object.values(shop).map(i => ({ name: i.name, value: `💰 **${i.price.toLocaleString()}** 🪙\n${i.description}` })));
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'buy') {
        const shop = load(SHOP_FILE);
        const itemName = options.getString('item');
        if (!itemName) {
            const select = new StringSelectMenuBuilder().setCustomId('buy_select').setPlaceholder('購入するアイテムを選択')
                .addOptions(Object.values(shop).slice(0, 25).map(item => ({ label: item.name, description: `${item.price.toLocaleString()} 🪙`, value: item.name })));
            return interaction.reply({ content: '🛒 アイテムを選択:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
        }
        return doBuyItem(interaction, itemName, econ, user, guild, shop);
    }

    if (commandName === 'sell') {
        const itemName = options.getString('item');
        const count = options.getInteger('amount') || 1;
        const u = getUser(econ, user.id, user);
        if (!itemName) {
            const counts = {};
            for (const item of u.inventory) counts[item.name] = (counts[item.name] || 0) + 1;
            const select = new StringSelectMenuBuilder().setCustomId(`sell_select_${count}`).setPlaceholder('売却するアイテムを選択')
                .addOptions(Object.entries(counts).slice(0, 25).map(([name, num]) => ({ label: name, description: `所持: ${num}個`, value: name })));
            return interaction.reply({ content: '🎒 アイテムを選択:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
        }
        return doSellItem(interaction, itemName, count, econ, u);
    }

    if (commandName === 'inventory') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const embed = new EmbedBuilder().setTitle(`🎒 ${target.username} の所持品`).setColor(0x9b59b6);
        const counts = {};
        for (const item of u.inventory) counts[item.name] = (counts[item.name] || 0) + 1;
        embed.setDescription(Object.entries(counts).map(([n, c]) => `• **${n}** × ${c}`).join('\n') || 'なし');
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'corp') {
        const sub = options.getSubcommand();
        const corpData = load(CORP_FILE);
        if (sub === 'create') {
            const name = options.getString('name'), desc = options.getString('description'), u = getUser(econ, user.id, user);
            if (u.balance < CORP_COST) return interaction.reply('資金不足');
            u.balance -= CORP_COST;
            const id = `corp_${now}`;
            corpData[id] = { id, name, description: desc, ownerId: user.id, ownerName: user.username, balance: 0, items: [], createdAt: now };
            save(ECON_FILE, econ); save(CORP_FILE, corpData);
            return interaction.reply(`🏢 **${name}** を設立しました！`);
        }
        if (sub === 'setting') {
            const name = options.getString('corp');
            const c = Object.values(corpData).find(c => c.name === name) || Object.values(corpData).find(c => c.ownerId === user.id);
            if (!c) return interaction.reply('見つかりません');
            return c.ownerId === user.id ? showStoreManage(interaction, c, corpData, user) : showStore(interaction, c, user);
        }
        if (sub === 'deposit') {
            const amtStr = options.getString('amount').toLowerCase(), name = options.getString('corp');
            const u = getUser(econ, user.id, user);
            const c = Object.values(corpData).find(c => c.name === name) || Object.values(corpData).find(c => c.ownerId === user.id);
            if (!c) return interaction.reply('見つかりません');
            let amt = amtStr === 'all' ? u.balance : parseInt(amtStr);
            if (isNaN(amt) || u.balance < amt) return interaction.reply('残高不足');
            u.balance -= amt; c.balance += amt; save(ECON_FILE, econ); save(CORP_FILE, corpData);
            return interaction.reply(`✅ **${c.name}** に **${amt}** 入金しました`);
        }
    }

    if (commandName === 'crypto') {
        const sub = options.getSubcommand();
        const cryptoData = load(CRYPTO_FILE);
        if (sub === 'list') {
            const embed = new EmbedBuilder().setTitle('💹 仮想通貨市場').setColor(0xf1c40f)
                .setDescription(Object.values(cryptoData).map(c => `• **${c.name}** (${c.symbol}): ${fmtPrice(c.price)} 🪙`).join('\n') || 'なし');
            return interaction.reply({ embeds: [embed], components: [delBtn()] });
        }
        if (sub === 'view') {
            const sym = options.getString('symbol')?.toUpperCase();
            const coin = Object.values(cryptoData).find(c => c.symbol === sym);
            if (!coin) return interaction.reply('見つかりません');
            return showCryptoDetail(interaction, coin, econ, user, CRYPTO_FILE);
        }
        if (sub === 'buy' || sub === 'sell') {
            const sym = options.getString('symbol')?.toUpperCase(), amt = options.getString('amount');
            const coin = Object.values(cryptoData).find(c => c.symbol === sym);
            if (!coin) return interaction.reply('見つかりません');
            const u = getUser(econ, user.id, user);
            return sub === 'buy' ? doBuyCrypto(interaction, coin, amt, econ, u, cryptoData, CRYPTO_FILE) : doSellCrypto(interaction, coin, amt, econ, u, cryptoData, CRYPTO_FILE);
        }
    }

    if (commandName === 'stock') {
        const corpData = load(CORP_FILE), name = options.getString('corp');
        const c = Object.values(corpData).find(c => c.name === name && c.stock);
        if (!c) return interaction.reply('株式未発行か存在しません');
        return showStockDetail(interaction, c, econ, user);
    }
}

// ==================== Button & Interaction Handler ====================
async function handleEconInteraction(interaction) {
    const cid = interaction.customId;
    const { user } = interaction;
    const econ = load(ECON_FILE);
    const now = Date.now();
    const u = getUser(econ, user.id, user);

    if (cid === 'earn_daily') {
        const today = new Date(now + 9 * 3600000).toISOString().split('T')[0];
        if (u.dailyDate === today) return interaction.reply({ content: '受取済', ...EPH });
        const streak = (u.dailyStreak || 0) + 1, amt = 200 + Math.floor(Math.random() * 201) + (Math.min(streak, 7) * 50);
        u.balance += amt; u.dailyStreak = streak; u.dailyDate = today; save(ECON_FILE, econ);
        await interaction.update(buildEarnPanel(u, now));
        return interaction.followUp({ content: `🎁 **+${amt}** 獲得！`, ...EPH });
    }

    if (cid === 'earn_work') {
        if (now - (u.workLast || 0) < 3600000) return interaction.reply({ content: 'CD中', ...EPH });
        const amt = 100; u.balance += amt; u.workLast = now; save(ECON_FILE, econ);
        await interaction.update(buildEarnPanel(u, now));
        return interaction.followUp({ content: `💼 **+${amt}** 獲得！`, ...EPH });
    }

    if (cid === 'bank_loan') {
        const modal = new ModalBuilder().setCustomId('modal_bank_loan').setTitle('借入');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('loan_amount').setLabel('金額(5000迄)').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
    }

    if (cid.startsWith('bj_hit_')) {
        const key = cid.replace('bj_hit_', ''), game = bjGames.get(key);
        if (!game || game.userId !== user.id) return;
        game.playerCards.push(drawCard(game.deck));
        if (calcBJ(game.playerCards) > 21) {
            u.balance -= (game.bet * game.leverage); applyDebt(u); save(ECON_FILE, econ); bjGames.delete(key);
            return interaction.update({ embeds: [buildBJEmbed(game, 'bust', u.balance, user)], components: [] });
        }
        return interaction.update({ embeds: [buildBJEmbed(game, 'playing', null, user)] });
    }

    if (cid.startsWith('bj_stand_')) {
        const key = cid.replace('bj_stand_', ''), game = bjGames.get(key);
        if (!game) return;
        while (calcBJ(game.dealerCards) < 17) game.dealerCards.push(drawCard(game.deck));
        const p = calcBJ(game.playerCards), d = calcBJ(game.dealerCards);
        let res = (d > 21 || p > d) ? 'win' : (p === d ? 'push' : 'lose');
        if (res === 'win') u.balance += (game.bet * game.leverage); else if (res === 'lose') u.balance -= (game.bet * game.leverage);
        applyDebt(u); save(ECON_FILE, econ); bjGames.delete(key);
        return interaction.update({ embeds: [buildBJEmbed(game, res, u.balance, user)], components: [] });
    }

    if (cid.startsWith('store_additem_')) {
        const modal = new ModalBuilder().setCustomId(`modal_store_additem_${cid.split('_')[2]}`).setTitle('追加');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('名').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price').setLabel('額').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('説').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
    }

    if (cid === 'delete_reply') return interaction.message.delete().catch(() => {});
}

// ==================== Modal & Select Handlers ====================
async function handleEconModal(interaction) {
    const cid = interaction.customId, econ = load(ECON_FILE), u = getUser(econ, interaction.user.id, interaction.user);
    if (cid === 'modal_bank_loan') {
        const amt = parseInt(interaction.fields.getTextInputValue('loan_amount'));
        if (isNaN(amt) || (u.loan||0)+amt > 5000) return interaction.reply('上限越え');
        u.loan = (u.loan||0)+amt; u.balance += amt; save(ECON_FILE, econ);
        return interaction.reply(`✅ **${amt}** 借りました`);
    }
    if (cid.startsWith('modal_store_additem_')) {
        const corpId = cid.split('_')[3], corpData = load(CORP_FILE), c = corpData[corpId];
        const name = interaction.fields.getTextInputValue('name'), price = parseInt(interaction.fields.getTextInputValue('price')), desc = interaction.fields.getTextInputValue('desc');
        c.items.push({ name, price, description: desc }); save(CORP_FILE, corpData);
        return interaction.reply('✅ 商品を追加しました');
    }
}

async function handleEconSelect(interaction) {
    const cid = interaction.customId, corp = load(CORP_FILE);
    if (cid.startsWith('store_buy_')) {
        const corpId = cid.split('_')[2], c = corp[corpId], u = getUser(load(ECON_FILE), interaction.user.id, interaction.user);
        const item = c.items.find(i => i.name === interaction.values[0]);
        if (!item || u.balance < item.price) return interaction.reply('失敗');
        u.balance -= item.price; c.balance += item.price; u.inventory.push({ name: item.name, sellPrice: Math.floor(item.price * 0.4) });
        save(ECON_FILE, load(ECON_FILE)); save(CORP_FILE, corp);
        return interaction.reply('✅ 購入完了');
    }
}

module.exports = { econCommands, handleEcon, handleEconInteraction, handleEconModal, handleEconSelect };
