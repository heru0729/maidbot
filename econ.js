const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ECON_FILE  = path.join(__dirname, 'data', 'econ.json');
const CORP_FILE  = path.join(__dirname, 'data', 'corp.json');
const SHOP_FILE  = path.join(__dirname, 'data', 'shop.json');
const EPH = { flags: MessageFlags.Ephemeral };
const CURRENCY = '🪙';
const CORP_COST = 10000;

function load(f) {
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 4)); }

function getUser(econ, userId, user) {
    if (!econ[userId]) econ[userId] = { balance: 0, dailyLast: 0, workLast: 0, crimeLast: 0, inventory: [] };
    if (user) econ[userId].username = user.username;
    return econ[userId];
}

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
const bjGames = new Map(); // gameKey -> game state

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
function buildBJEmbed(game, status, balance) {
    const playerTotal = calcBJ(game.playerCards);
    const dealerTotal = calcBJ(game.dealerCards);
    const statusMap = {
        playing: { title: '🃏 ブラックジャック', color: 0x3498db, desc: '' },
        win:     { title: '🎉 勝利！', color: 0x57f287, desc: `**+${game.bet.toLocaleString()}** 🪙 獲得！\n残高: **${balance?.toLocaleString()}** 🪙` },
        lose:    { title: '😢 負け...', color: 0xff4757, desc: `**-${game.bet.toLocaleString()}** 🪙\n残高: **${balance?.toLocaleString()}** 🪙` },
        push:    { title: '🤝 引き分け', color: 0x95a5a6, desc: `賭け金は返還されました。\n残高: **${balance?.toLocaleString()}** 🪙` },
        bust:    { title: '💥 バスト！', color: 0xff4757, desc: `**-${game.bet.toLocaleString()}** 🪙\n残高: **${balance?.toLocaleString()}** 🪙` },
        bj:      { title: '🃏 ブラックジャック！', color: 0xf1c40f, desc: `**+${Math.floor(game.bet * 1.5).toLocaleString()}** 🪙 獲得！\n残高: **${balance?.toLocaleString()}** 🪙` },
    };
    const s = statusMap[status];
    const dealerShow = status === 'playing'
        ? `${game.dealerCards[0]} ??` : game.dealerCards.join(' ');
    const dealerScore = status === 'playing' ? '?' : dealerTotal;
    return new EmbedBuilder().setTitle(s.title).setColor(s.color)
        .addFields(
            { name: `ディーラー (${dealerScore})`, value: dealerShow, inline: false },
            { name: `あなた (${playerTotal})`, value: game.playerCards.join(' '), inline: false }
        )
        .setDescription(s.desc || `賭け金: **${game.bet.toLocaleString()}** 🪙`)
        .setFooter({ text: 'ヒット=カードを引く / スタンド=終了 / ダブル=2倍賭けで1枚引いて終了' });
}
function buildBJRows(gameKey) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${gameKey}`).setLabel('ヒット').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj_stand_${gameKey}`).setLabel('スタンド').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj_double_${gameKey}`).setLabel('ダブルダウン').setStyle(ButtonStyle.Danger)
    )];
}

const delBtn = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('delete_reply').setLabel('🗑️ 削除').setStyle(ButtonStyle.Secondary)
);

function cdStr(remaining) {
    if (remaining <= 0) return '✅ 準備完了';
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    if (h > 0) return `⏳ あと${h}時間${m}分`;
    if (m > 0) return `⏳ あと${m}分${s}秒`;
    return `⏳ あと${s}秒`;
}

function buildEarnPanel(u, now) {
    const dailyRem = 86400000 - (now - (u.dailyLast || 0));
    const workRem  = 3600000  - (now - (u.workLast  || 0));
    const crimeRem = 7200000  - (now - (u.crimeLast || 0));
    const huntRem  = 1800000  - (now - (u.huntLast  || 0));
    const fishRem  = 2700000  - (now - (u.fishLast  || 0));
    const streak = u.dailyStreak || 0;
    const embed = new EmbedBuilder()
        .setTitle('💰 お金を稼ぐ')
        .setColor(0xf1c40f)
        .addFields(
            { name: '🎁 デイリー', value: `200〜400+ボーナス ${CURRENCY}\n連続${streak}日目 🔥\n${cdStr(dailyRem)}`, inline: true },
            { name: '💼 労働', value: `50〜300 ${CURRENCY}\nCD: 1時間\n${cdStr(workRem)}`, inline: true },
            { name: '🦹 犯罪', value: `成功: 100〜2000 ${CURRENCY}\n失敗: 没収あり\nCD: 2時間\n${cdStr(crimeRem)}`, inline: true },
            { name: '🏹 狩猟', value: `獲物を狩る\nアイテムドロップあり\nCD: 30分\n${cdStr(huntRem)}`, inline: true },
            { name: '🎣 釣り', value: `魚を釣る\nレア魚は高値\nCD: 45分\n${cdStr(fishRem)}`, inline: true },
            { name: '🔫 強盗', value: `他ユーザーの10〜30%奪取\n失敗: 罰金あり`, inline: true },
            { name: '🪙 コインフリップ', value: `賭け金額を2倍か没収\n50%の確率`, inline: true },
            { name: '🎰 スロット', value: `最大10倍\n💎揃い: 10x / ⭐揃い: 5x`, inline: true },
            { name: '🃏 ブラックジャック', value: `21に近い方が勝ち\nBJ: 1.5倍獲得`, inline: true }
        );
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('earn_daily').setLabel('🎁 デイリー').setStyle(ButtonStyle.Success).setDisabled(dailyRem > 0),
        new ButtonBuilder().setCustomId('earn_work').setLabel('💼 労働').setStyle(ButtonStyle.Primary).setDisabled(workRem > 0),
        new ButtonBuilder().setCustomId('earn_crime').setLabel('🦹 犯罪').setStyle(ButtonStyle.Danger).setDisabled(crimeRem > 0)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('earn_hunt').setLabel('🏹 狩猟').setStyle(ButtonStyle.Success).setDisabled(huntRem > 0),
        new ButtonBuilder().setCustomId('earn_fish').setLabel('🎣 釣り').setStyle(ButtonStyle.Primary).setDisabled(fishRem > 0),
        new ButtonBuilder().setCustomId('earn_rob').setLabel('🔫 強盗').setStyle(ButtonStyle.Danger)
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('earn_flip').setLabel('🪙 コインフリップ').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('earn_slots').setLabel('🎰 スロット').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('earn_bj').setLabel('🃏 BJ').setStyle(ButtonStyle.Primary)
    );
    return { embeds: [embed], components: [row1, row2, row3] };
}

const econCommands = [
    new SlashCommandBuilder().setName('balance').setDescription('所持金を確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')),
    new SlashCommandBuilder().setName('earn').setDescription('お金を稼ぐパネルを開きます'),
    new SlashCommandBuilder().setName('send').setDescription('他のユーザーに送金します').addUserOption(o => o.setName('user').setDescription('送金先ユーザー').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('金額').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('shop').setDescription('ショップのアイテム一覧を表示します'),
    new SlashCommandBuilder().setName('buy').setDescription('アイテムを購入します').addStringOption(o => o.setName('item').setDescription('アイテム名').setRequired(true)),
    new SlashCommandBuilder().setName('sell').setDescription('インベントリのアイテムを売却します').addStringOption(o => o.setName('item').setDescription('アイテム名').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('売却数（未指定で1個）').setMinValue(1)),
    new SlashCommandBuilder().setName('inventory').setDescription('所持アイテムを確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')),
    new SlashCommandBuilder().setName('econrank').setDescription('所持金ランキングを表示します'),
    new SlashCommandBuilder().setName('bank').setDescription('銀行メニュー（残高確認・ローン・返済）'),
    new SlashCommandBuilder().setName('corp').setDescription('会社を設立します（1人2社まで・設立費用10,000枚）').addStringOption(o => o.setName('name').setDescription('会社名').setRequired(true)).addStringOption(o => o.setName('description').setDescription('会社の説明').setRequired(true)),
    new SlashCommandBuilder().setName('store').setDescription('会社のストアを管理・表示します').addStringOption(o => o.setName('corp').setDescription('会社名（未指定で一覧）')),
    new SlashCommandBuilder().setName('stock').setDescription('株式市場（会社の株売買・チャート）').addStringOption(o => o.setName('corp').setDescription('会社名（未指定で市場一覧）')),
    new SlashCommandBuilder().setName('buystock').setDescription('株を購入します').addStringOption(o => o.setName('corp').setDescription('会社名').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('購入株数').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('sellstock').setDescription('株を売却します').addStringOption(o => o.setName('corp').setDescription('会社名').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('売却株数').setRequired(true).setMinValue(1)),
];

async function handleEcon(interaction) {
    const { commandName, options, user, guild } = interaction;
    const econ = load(ECON_FILE);

    if (commandName === 'balance') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const corp = load(CORP_FILE);
        const ownedCorps = Object.values(corp).filter(c => c.ownerId === target.id);
        const embed = new EmbedBuilder()
            .setTitle(`${CURRENCY} ${target.username} の所持金`)
            .setThumbnail(target.displayAvatarURL())
            .setColor(0xf1c40f)
            .addFields(
                { name: '残高', value: `**${u.balance.toLocaleString()}** ${CURRENCY}`, inline: true },
                { name: '保有会社', value: ownedCorps.length > 0 ? ownedCorps.map(c => c.name).join(', ') : 'なし', inline: true }
            ).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'earn') {
        const u = getUser(econ, user.id, user);
        const now = Date.now();
        await interaction.reply(buildEarnPanel(u, now));
        return;
    }

    if (commandName === 'send') {
        const target = options.getUser('user');
        const amount = options.getInteger('amount');
        if (target.id === user.id) return interaction.reply({ content: '❌ 自分自身には送金できません。', ...EPH });
        if (target.bot) return interaction.reply({ content: '❌ Botには送金できません。', ...EPH });
        const sender = getUser(econ, user.id, user);
        const receiver = getUser(econ, target.id, target);
        if (sender.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${sender.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        sender.balance -= amount;
        receiver.balance += amount;
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder().setTitle('💸 送金完了').setColor(0x2ecc71)
            .addFields(
                { name: '送金元', value: user.username, inline: true },
                { name: '送金先', value: target.username, inline: true },
                { name: '金額', value: `**${amount.toLocaleString()}** ${CURRENCY}`, inline: false },
                { name: '残高', value: `${sender.balance.toLocaleString()} ${CURRENCY}`, inline: true }
            ).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'shop') {
        const shop = load(SHOP_FILE);
        const items = Object.values(shop);
        if (items.length === 0) return interaction.reply({ content: '🛒 現在ショップにアイテムがありません。', ...EPH });
        const embed = new EmbedBuilder().setTitle('🛒 ショップ').setColor(0xe67e22)
            .setDescription(items.map((item, i) =>
                `**${i + 1}. ${item.name}**\n価格: **${item.price.toLocaleString()}** ${CURRENCY}　売却: **${Math.floor(item.price * 0.5).toLocaleString()}** ${CURRENCY}${item.roleId ? `　🏷️ ロール付与` : ''}\n${item.description}`
            ).join('\n\n'))
            .setFooter({ text: '/buy [アイテム名] で購入 / /sell [アイテム名] で売却（50%）' });
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'buy') {
        const itemName = options.getString('item');
        const shop = load(SHOP_FILE);
        const item = Object.values(shop).find(i => i.name.toLowerCase() === itemName.toLowerCase());
        if (!item) return interaction.reply({ content: `❌ **${itemName}** は存在しません。\`/shop\` で確認してください。`, ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < item.price) return interaction.reply({ content: `❌ 残高不足。必要: **${item.price.toLocaleString()}** / 現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        u.balance -= item.price;
        if (!u.inventory) u.inventory = [];
        u.inventory.push({ name: item.name, boughtAt: Date.now(), sellPrice: Math.floor(item.price * 0.5) });
        save(ECON_FILE, econ);
        if (item.roleId && guild) {
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (member) await member.roles.add(item.roleId).catch(() => {});
        }
        const embed = new EmbedBuilder().setTitle('✅ 購入完了').setColor(0x57f287)
            .setDescription(`**${item.name}** を購入しました！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}${item.roleId ? '\n🏷️ ロールが付与されました。' : ''}`).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'sell') {
        const itemName = options.getString('item');
        const sellCount = options.getInteger('amount') || 1;
        const u = getUser(econ, user.id, user);
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
        return interaction.reply({ content: `✅ **${itemName}** × ${sellCount} を **${totalPrice.toLocaleString()}** ${CURRENCY} で売却しました。\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`, components: [delBtn()] });
    }

    if (commandName === 'inventory') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const inv = u.inventory || [];
        const embed = new EmbedBuilder().setTitle(`🎒 ${target.username} のインベントリ`).setThumbnail(target.displayAvatarURL()).setColor(0x9b59b6);
        if (inv.length === 0) embed.setDescription('アイテムを所持していません。');
        else {
            const counts = {};
            for (const item of inv) counts[item.name] = (counts[item.name] || 0) + 1;
            embed.setDescription(Object.entries(counts).map(([name, count]) => `• **${name}** × ${count}`).join('\n'));
        }
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'econrank') {
        const sorted = Object.entries(econ).map(([id, u]) => ({ id, balance: u.balance || 0 })).sort((a, b) => b.balance - a.balance).slice(0, 10);
        if (sorted.length === 0) return interaction.reply({ content: 'まだデータがありません。', ...EPH });
        await interaction.deferReply();
        const medals = ['🥇', '🥈', '🥉'];
        const lines = await Promise.all(sorted.map(async (u, i) => {
            let name = econ[u.id]?.username;
            if (!name) {
                const member = await guild?.members.fetch(u.id).catch(() => null);
                if (member) { name = member.user.username; econ[u.id].username = name; } else name = `ID:${u.id}`;
            }
            return `${medals[i] || `**${i + 1}.**`} ${name} — **${u.balance.toLocaleString()}** ${CURRENCY}`;
        }));
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder().setTitle(`${CURRENCY} 所持金ランキング`).setColor(0xf1c40f).setDescription(lines.join('\n')).setTimestamp();
        return interaction.editReply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'corp') {
        const corpName = options.getString('name').trim();
        const corpDesc = options.getString('description').trim();
        const corpData = load(CORP_FILE);
        const u = getUser(econ, user.id, user);
        const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
        if (owned.length >= 2) return interaction.reply({ content: '❌ 1人につき最大2社まで設立できます。', ...EPH });
        if (Object.values(corpData).some(c => c.name.toLowerCase() === corpName.toLowerCase())) return interaction.reply({ content: `❌ **${corpName}** という会社はすでに存在します。`, ...EPH });
        if (u.balance < CORP_COST) return interaction.reply({ content: `❌ 設立費用不足。必要: **${CORP_COST.toLocaleString()}** ${CURRENCY}　現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        u.balance -= CORP_COST;
        const corpId = `corp_${Date.now()}_${user.id}`;
        corpData[corpId] = { id: corpId, name: corpName, description: corpDesc, ownerId: user.id, ownerName: user.username, createdAt: Date.now(), balance: 0, items: [], employees: [] };
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        const embed = new EmbedBuilder().setTitle('🏢 会社設立完了').setColor(0x3498db)
            .addFields(
                { name: '会社名', value: corpName, inline: true },
                { name: 'オーナー', value: user.username, inline: true },
                { name: '設立費用', value: `${CORP_COST.toLocaleString()} ${CURRENCY}`, inline: true },
                { name: '説明', value: corpDesc, inline: false }
            ).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /bank ====================
    if (commandName === 'bank') {
        const u = getUser(econ, user.id, user);
        const loan = u.loan || 0;
        const embed = new EmbedBuilder()
            .setTitle('🏦 銀行')
            .setColor(0x2ecc71)
            .addFields(
                { name: '残高', value: `**${u.balance.toLocaleString()}** ${CURRENCY}`, inline: true },
                { name: '借入残高', value: `**${loan.toLocaleString()}** ${CURRENCY}`, inline: true },
                { name: 'ローン上限', value: `**${(5000).toLocaleString()}** ${CURRENCY}`, inline: true }
            )
            .setDescription('ローンを借りると毎日5%の利子が加算されます。')
            .setFooter({ text: '返済は「返済」ボタンから' });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('bank_loan').setLabel('💸 借りる').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('bank_repay').setLabel('💰 返済する').setStyle(ButtonStyle.Success).setDisabled(loan <= 0)
        );
        return interaction.reply({ embeds: [embed], components: [row] });
    }

    // ==================== /stock ====================
    if (commandName === 'stock') {
        const corpData = load(CORP_FILE);
        const corpName = options.getString('corp');
        if (corpName) {
            const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
            if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
            if (!c.stock) return interaction.reply({ content: `❌ **${c.name}** はまだ株式を発行していません。オーナーが \`/store\` から発行できます。`, ...EPH });
            const price = c.stock.price;
            const history = c.stock.history || [];
            const chartStr = buildStockChart(history);
            const userShares = (u.stocks || {})[c.id] || 0;
            const embed = new EmbedBuilder()
                .setTitle(`📈 ${c.name} 株式情報`)
                .setColor(price > (history[history.length - 2] || price) ? 0x57f287 : 0xff4757)
                .addFields(
                    { name: '現在株価', value: `**${price.toLocaleString()}** ${CURRENCY}`, inline: true },
                    { name: '発行株数', value: `**${c.stock.totalShares.toLocaleString()}** 株`, inline: true },
                    { name: '保有株数', value: `**${userShares}** 株`, inline: true },
                    { name: '時価総額', value: `**${(price * c.stock.totalShares).toLocaleString()}** ${CURRENCY}`, inline: true }
                )
                .setDescription(chartStr ? `\`\`\`\n${chartStr}\n\`\`\`` : '価格履歴なし');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`stock_buy_${c.id}`).setLabel('📈 買う').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`stock_sell_${c.id}`).setLabel('📉 売る').setStyle(ButtonStyle.Danger).setDisabled(userShares <= 0)
            );
            return interaction.reply({ embeds: [embed], components: [row, delBtn()] });
        }
        // 市場一覧
        const all = Object.values(corpData).filter(c => c.stock);
        if (all.length === 0) return interaction.reply({ content: '📊 現在株式を発行している会社はありません。', ...EPH });
        const embed = new EmbedBuilder().setTitle('📊 株式市場').setColor(0x3498db)
            .setDescription(all.map((c, i) => {
                const prev = c.stock.history?.slice(-2)[0] || c.stock.price;
                const diff = c.stock.price - prev;
                const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
                return `**${i + 1}. ${c.name}** ${arrow}\n株価: **${c.stock.price.toLocaleString()}** ${CURRENCY}　発行: ${c.stock.totalShares}株`;
            }).join('\n\n'))
            .setFooter({ text: '/stock [会社名] で詳細・売買' });
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /buystock ====================
    if (commandName === 'buystock') {
        const corpName = options.getString('corp');
        const amount = options.getInteger('amount');
        const corpData = load(CORP_FILE);
        const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
        if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
        if (!c.stock) return interaction.reply({ content: `❌ **${c.name}** はまだ株式を発行していません。`, ...EPH });
        const u = getUser(econ, user.id, user);
        const total = c.stock.price * amount;
        if (u.balance < total) return interaction.reply({ content: `❌ 残高不足。必要: **${total.toLocaleString()}** ${CURRENCY}　現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        if (c.stock.availableShares < amount) return interaction.reply({ content: `❌ 購入可能株数が不足しています。現在: **${c.stock.availableShares}** 株`, ...EPH });
        u.balance -= total;
        if (!u.stocks) u.stocks = {};
        u.stocks[c.id] = (u.stocks[c.id] || 0) + amount;
        c.stock.availableShares -= amount;
        c.balance = (c.balance || 0) + total;
        // 価格変動（需要で上昇）
        c.stock.price = Math.ceil(c.stock.price * (1 + 0.01 * Math.min(amount, 10)));
        if (!c.stock.history) c.stock.history = [];
        c.stock.history.push(c.stock.price);
        if (c.stock.history.length > 20) c.stock.history.shift();
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** の株を **${amount}** 株 (**${total.toLocaleString()}** ${CURRENCY}) で購入しました！\n現在株価: **${c.stock.price.toLocaleString()}** ${CURRENCY}`, components: [delBtn()] });
    }

    // ==================== /sellstock ====================
    if (commandName === 'sellstock') {
        const corpName = options.getString('corp');
        const amount = options.getInteger('amount');
        const corpData = load(CORP_FILE);
        const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
        if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
        if (!c.stock) return interaction.reply({ content: `❌ **${c.name}** は株式を発行していません。`, ...EPH });
        const u = getUser(econ, user.id, user);
        const held = (u.stocks || {})[c.id] || 0;
        if (held < amount) return interaction.reply({ content: `❌ 保有株数が不足しています。現在: **${held}** 株`, ...EPH });
        const total = c.stock.price * amount;
        u.balance += total;
        u.stocks[c.id] -= amount;
        c.stock.availableShares += amount;
        // 価格変動（売りで下落）
        c.stock.price = Math.max(1, Math.floor(c.stock.price * (1 - 0.008 * Math.min(amount, 10))));
        if (!c.stock.history) c.stock.history = [];
        c.stock.history.push(c.stock.price);
        if (c.stock.history.length > 20) c.stock.history.shift();
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** の株を **${amount}** 株 (**${total.toLocaleString()}** ${CURRENCY}) で売却しました！\n現在株価: **${c.stock.price.toLocaleString()}** ${CURRENCY}`, components: [delBtn()] });
    }

    if (commandName === 'store') {
        const corpData = load(CORP_FILE);
        const corpName = options.getString('corp');
        if (corpName) {
            const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
            if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
            return showStore(interaction, c, user);
        }
        const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
        if (owned.length === 0) {
            const all = Object.values(corpData);
            if (all.length === 0) return interaction.reply({ content: '現在登録されている会社はありません。`/corp` で設立できます。', ...EPH });
            const embed = new EmbedBuilder().setTitle('🏢 会社一覧').setColor(0x3498db)
                .setDescription(all.map((c, i) => `**${i + 1}. ${c.name}**\nオーナー: ${c.ownerName}　商品数: ${c.items.length}\n${c.description}`).join('\n\n'))
                .setFooter({ text: '/store [会社名] でストアを見る' });
            return interaction.reply({ embeds: [embed], components: [delBtn()] });
        }
        if (owned.length === 1) return showStoreManage(interaction, owned[0], corpData, user);
        const select = new StringSelectMenuBuilder().setCustomId('store_select_corp').setPlaceholder('管理する会社を選択')
            .addOptions(owned.map(c => ({ label: c.name, description: c.description.slice(0, 50), value: c.id })));
        return interaction.reply({ content: '管理する会社を選択してください:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
    }
}

async function showStore(interaction, c, user) {
    const embed = new EmbedBuilder().setTitle(`🏪 ${c.name}`).setDescription(c.description).setColor(0xe67e22)
        .addFields(
            { name: 'オーナー', value: c.ownerName, inline: true },
            { name: '商品数', value: `${c.items.length}件`, inline: true }
        );
    if (c.items.length > 0) embed.addFields({ name: '商品一覧', value: c.items.map((item, i) => `**${i + 1}. ${item.name}** — **${item.price.toLocaleString()}** 🪙\n${item.description}`).join('\n\n'), inline: false });
    else embed.addFields({ name: '商品一覧', value: '商品がまだありません。', inline: false });
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
        .addFields(
            { name: '会社残高', value: `**${(c.balance || 0).toLocaleString()}** 🪙`, inline: true },
            { name: '商品数', value: `${c.items.length}件`, inline: true },
            { name: '株式', value: c.stock ? `株価: **${c.stock.price.toLocaleString()}** 🪙` : '未発行', inline: true }
        );
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`store_additem_${c.id}`).setLabel('商品追加').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`store_removeitem_${c.id}`).setLabel('商品削除').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`store_withdraw_${c.id}`).setLabel('売上回収').setStyle(ButtonStyle.Success)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`store_issuestock_${c.id}`).setLabel('📊 株式発行').setStyle(ButtonStyle.Secondary).setDisabled(!!c.stock),
        new ButtonBuilder().setCustomId('delete_reply').setLabel('✕ 閉じる').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({ embeds: [embed], components: [row1, row2], ...EPH });
}

async function handleEconInteraction(interaction) {
    const cid = interaction.customId;
    const { user, guild } = interaction;
    const econ = load(ECON_FILE);
    const corpData = load(CORP_FILE);

    // ==================== earnボタン ====================
    if (cid === 'earn_daily' || cid === 'earn_work' || cid === 'earn_crime') {
        const u = getUser(econ, user.id, user);
        const now = Date.now();
        let resultEmbed;

        if (cid === 'earn_daily') {
            const remaining = 86400000 - (now - (u.dailyLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ デイリーはまだ受け取れません。${cdStr(remaining)}`, ...EPH });
            const streak = (u.dailyStreak || 0) + 1;
            const base = Math.floor(Math.random() * 201) + 200;
            const bonus = Math.min(streak, 7) * 50;
            const amount = base + bonus;
            u.balance += amount; u.dailyLast = now; u.dailyStreak = streak;
            resultEmbed = new EmbedBuilder().setTitle('🎁 デイリーボーナス')
                .setDescription(`**+${amount}** ${CURRENCY} を受け取りました！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`)
                .addFields(
                    { name: '内訳', value: `ベース: ${base} + 連続ボーナス: ${bonus}`, inline: true },
                    { name: '連続ログイン', value: `${streak}日目 🔥`, inline: true }
                ).setColor(0x57f287).setTimestamp();
        }

        if (cid === 'earn_work') {
            const remaining = 3600000 - (now - (u.workLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ働けません。${cdStr(remaining)}`, ...EPH });
            const jobs = [
                { name: 'プログラマー', desc: 'コードを書きまくった', min: 80, max: 180 },
                { name: 'シェフ', desc: '料理を作って客に振る舞った', min: 60, max: 150 },
                { name: 'ゲーム実況者', desc: '配信が大盛況だった', min: 50, max: 200 },
                { name: '宅配ドライバー', desc: '荷物を時間通りに届けた', min: 70, max: 140 },
                { name: 'デザイナー', desc: 'クライアントに絶賛された', min: 90, max: 170 },
                { name: '作家', desc: '原稿を書き上げた', min: 60, max: 160 },
                { name: '教師', desc: '生徒に感謝された', min: 55, max: 130 },
                { name: '音楽家', desc: 'ライブが満員だった', min: 80, max: 220 },
                { name: '漁師', desc: '大漁だった', min: 70, max: 160 },
                { name: '株トレーダー', desc: 'うまくポジションを取った', min: 30, max: 300 },
            ];
            const job = jobs[Math.floor(Math.random() * jobs.length)];
            const amount = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
            u.balance += amount; u.workLast = now;
            resultEmbed = new EmbedBuilder().setTitle(`💼 ${job.name} として働いた`)
                .setDescription(`${job.desc}！\n**+${amount}** ${CURRENCY} を獲得！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`)
                .setColor(0x3498db).setTimestamp();
        }

        if (cid === 'earn_crime') {
            const remaining = 7200000 - (now - (u.crimeLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ犯罪はできません。${cdStr(remaining)}`, ...EPH });
            u.crimeLast = now;
            const crimes = [
                { name: '車上荒らし', success: 0.6, gain: [200, 500], fine: [100, 300] },
                { name: '銀行強盗', success: 0.3, gain: [800, 2000], fine: [400, 800] },
                { name: 'スリ', success: 0.7, gain: [100, 300], fine: [50, 200] },
                { name: '詐欺', success: 0.5, gain: [300, 700], fine: [200, 500] },
                { name: '密輸', success: 0.4, gain: [500, 1200], fine: [300, 600] },
            ];
            const crime = crimes[Math.floor(Math.random() * crimes.length)];
            const success = Math.random() < crime.success;
            if (success) {
                const amount = Math.floor(Math.random() * (crime.gain[1] - crime.gain[0] + 1)) + crime.gain[0];
                u.balance += amount;
                resultEmbed = new EmbedBuilder().setTitle(`🦹 ${crime.name} 成功！`).setDescription(`うまくいった！\n**+${amount}** ${CURRENCY} を獲得！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`).setColor(0x57f287);
            } else {
                const fine = Math.floor(Math.random() * (crime.fine[1] - crime.fine[0] + 1)) + crime.fine[0];
                u.balance = Math.max(0, u.balance - fine);
                resultEmbed = new EmbedBuilder().setTitle(`🚔 ${crime.name} 失敗！`).setDescription(`捕まった！**${fine}** ${CURRENCY} を没収された。\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`).setColor(0xff4757);
            }
        }

        if (cid === 'earn_hunt') {
            const remaining = 1800000 - (now - (u.huntLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ狩りに行けません。${cdStr(remaining)}`, ...EPH });
            u.huntLast = now;
            const hunts = [
                { name: 'ウサギ',   item: '🐰 ウサギの毛皮', sell: 80,   rare: false },
                { name: 'シカ',     item: '🦌 シカの角',     sell: 250,  rare: false },
                { name: 'クマ',     item: '🐻 クマの毛皮',   sell: 500,  rare: true  },
                { name: 'キツネ',   item: '🦊 キツネの毛皮', sell: 150,  rare: false },
                { name: 'イノシシ', item: '🐗 イノシシの牙', sell: 200,  rare: false },
                { name: 'オオカミ', item: '🐺 オオカミの毛皮',sell: 400, rare: true  },
            ];
            const weights = hunts.map(h => h.rare ? 1 : 3);
            const wtotal = weights.reduce((a, b) => a + b, 0);
            let wr = Math.random() * wtotal, hunt = hunts[0];
            for (let i = 0; i < hunts.length; i++) { wr -= weights[i]; if (wr <= 0) { hunt = hunts[i]; break; } }
            if (!u.inventory) u.inventory = [];
            u.inventory.push({ name: hunt.item, boughtAt: now, sellPrice: hunt.sell });
            resultEmbed = new EmbedBuilder()
                .setTitle(`🏹 ${hunt.name}を仕留めた！`)
                .setDescription(`**${hunt.item}** を手に入れた！\n売却価格: **${hunt.sell.toLocaleString()}** ${CURRENCY}\n\`/sell\` で売却できます。`)
                .setColor(hunt.rare ? 0xf1c40f : 0x57f287).setTimestamp();
        }

        if (cid === 'earn_fish') {
            const remaining = 2700000 - (now - (u.fishLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ釣りに行けません。${cdStr(remaining)}`, ...EPH });
            u.fishLast = now;
            const fishes = [
                { name: 'コイ',     item: '🐟 コイ',        sell: 60,   rare: false,  legendary: false },
                { name: 'サーモン', item: '🐠 サーモン',     sell: 150,  rare: false,  legendary: false },
                { name: 'マグロ',   item: '🐡 マグロ',       sell: 400,  rare: true,   legendary: false },
                { name: 'フグ',     item: '🐡 フグ',         sell: 300,  rare: true,   legendary: false },
                { name: 'タコ',     item: '🐙 タコ',         sell: 200,  rare: false,  legendary: false },
                { name: 'ゴミ',     item: '🗑️ ゴミ',        sell: 5,    rare: false,  legendary: false },
                { name: '伝説の魚', item: '✨ 伝説の魚',     sell: 2000, rare: true,   legendary: true  },
            ];
            const weights = fishes.map(f => f.legendary ? 0.2 : f.rare ? 1 : 4);
            const wtotal = weights.reduce((a, b) => a + b, 0);
            let wr = Math.random() * wtotal, fish = fishes[0];
            for (let i = 0; i < fishes.length; i++) { wr -= weights[i]; if (wr <= 0) { fish = fishes[i]; break; } }
            if (!u.inventory) u.inventory = [];
            u.inventory.push({ name: fish.item, boughtAt: now, sellPrice: fish.sell });
            resultEmbed = new EmbedBuilder()
                .setTitle(fish.legendary ? '🌟 伝説の魚を釣り上げた！！' : `🎣 ${fish.name} を釣った！`)
                .setDescription(`**${fish.item}** を手に入れた！\n売却価格: **${fish.sell.toLocaleString()}** ${CURRENCY}\n\`/sell\` で売却できます。`)
                .setColor(fish.legendary ? 0xf1c40f : fish.rare ? 0x3498db : 0x95a5a6).setTimestamp();
        }

        if (!resultEmbed) return;
        // パネルを更新してから結果をephemeralで送信
        const updatedPanel = buildEarnPanel(u, now);
        await interaction.update(updatedPanel);
        await interaction.followUp({ embeds: [resultEmbed], ...EPH });
        return;
    }

    // 銀行ボタン
    if (cid === 'bank_loan') {
        const modal = new ModalBuilder().setCustomId('modal_bank_loan').setTitle('💸 ローンを借りる');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('loan_amount').setLabel('借入額（上限5,000）').setStyle(TextInputStyle.Short).setPlaceholder('例: 1000').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }
    if (cid === 'bank_repay') {
        const modal = new ModalBuilder().setCustomId('modal_bank_repay').setTitle('💰 ローン返済');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('repay_amount').setLabel('返済額（全額返済は「all」）').setStyle(TextInputStyle.Short).setPlaceholder('例: 500 または all').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // 株ボタン
    if (cid.startsWith('stock_buy_') || cid.startsWith('stock_sell_')) {
        const isBuy = cid.startsWith('stock_buy_');
        const corpId = cid.replace(isBuy ? 'stock_buy_' : 'stock_sell_', '');
        const modal = new ModalBuilder().setCustomId(`modal_stock_${isBuy ? 'buy' : 'sell'}_${corpId}`).setTitle(isBuy ? '📈 株を購入' : '📉 株を売却');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('stock_amount').setLabel('株数').setStyle(TextInputStyle.Short).setPlaceholder('例: 10').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // ストア: 株式発行ボタン
    if (cid.startsWith('store_issuestock_')) {
        const corpId = cid.replace('store_issuestock_', '');
        const modal = new ModalBuilder().setCustomId(`modal_store_issuestock_${corpId}`).setTitle('📊 株式発行');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('stock_initial_price').setLabel('初期株価').setStyle(TextInputStyle.Short).setPlaceholder('例: 500').setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('stock_total_shares').setLabel('発行株数').setStyle(TextInputStyle.Short).setPlaceholder('例: 100').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // 強盗 → モーダルでID/メンション入力
    if (cid === 'earn_rob') {
        const modal = new ModalBuilder().setCustomId('modal_earn_rob').setTitle('🔫 強盗');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('rob_target_id').setLabel('ターゲットのユーザーID or メンション').setStyle(TextInputStyle.Short).setPlaceholder('例: 123456789 または @username').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // コインフリップ → モーダルで金額・表裏入力
    if (cid === 'earn_flip') {
        const modal = new ModalBuilder().setCustomId('modal_earn_flip').setTitle('🪙 コインフリップ');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('flip_amount').setLabel('賭け金額').setStyle(TextInputStyle.Short).setPlaceholder('例: 500').setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('flip_side').setLabel('表か裏 (omote / ura)').setStyle(TextInputStyle.Short).setPlaceholder('omote または ura').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // スロット → モーダルで金額入力
    if (cid === 'earn_slots') {
        const modal = new ModalBuilder().setCustomId('modal_earn_slots').setTitle('🎰 スロット');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('slots_amount').setLabel('賭け金額').setStyle(TextInputStyle.Short).setPlaceholder('例: 200').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // ブラックジャック → モーダルで金額入力
    if (cid === 'earn_bj') {
        const modal = new ModalBuilder().setCustomId('modal_earn_bj').setTitle('🃏 ブラックジャック');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('bj_amount').setLabel('賭け金額').setStyle(TextInputStyle.Short).setPlaceholder('例: 1000').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // BJ: ヒット
    if (cid.startsWith('bj_hit_')) {
        const gameKey = cid.replace('bj_hit_', '');
        const game = bjGames.get(gameKey);
        if (!game || game.userId !== user.id) return interaction.reply({ content: '❌ このゲームはあなたのものではありません。', ...EPH });
        game.playerCards.push(drawCard(game.deck));
        const playerTotal = calcBJ(game.playerCards);
        if (playerTotal > 21) {
            // バスト
            const econ = load(ECON_FILE);
            const u = getUser(econ, user.id, user);
            u.balance -= game.bet;
            save(ECON_FILE, econ);
            bjGames.delete(gameKey);
            return interaction.update({ embeds: [buildBJEmbed(game, 'bust', u.balance)], components: [] });
        }
        return interaction.update({ embeds: [buildBJEmbed(game, 'playing')], components: buildBJRows(gameKey) });
    }

    // BJ: スタンド
    if (cid.startsWith('bj_stand_')) {
        const gameKey = cid.replace('bj_stand_', '');
        const game = bjGames.get(gameKey);
        if (!game || game.userId !== user.id) return interaction.reply({ content: '❌ このゲームはあなたのものではありません。', ...EPH });
        // ディーラーのターン: 17以上になるまでドロー
        while (calcBJ(game.dealerCards) < 17) game.dealerCards.push(drawCard(game.deck));
        const playerTotal = calcBJ(game.playerCards);
        const dealerTotal = calcBJ(game.dealerCards);
        const econ = load(ECON_FILE);
        const u = getUser(econ, user.id, user);
        let result;
        if (dealerTotal > 21 || playerTotal > dealerTotal) { u.balance += game.bet; result = 'win'; }
        else if (playerTotal === dealerTotal) { result = 'push'; }
        else { u.balance -= game.bet; result = 'lose'; }
        save(ECON_FILE, econ);
        bjGames.delete(gameKey);
        return interaction.update({ embeds: [buildBJEmbed(game, result, u.balance)], components: [] });
    }

    // BJ: ダブルダウン
    if (cid.startsWith('bj_double_')) {
        const gameKey = cid.replace('bj_double_', '');
        const game = bjGames.get(gameKey);
        if (!game || game.userId !== user.id) return interaction.reply({ content: '❌ このゲームはあなたのものではありません。', ...EPH });
        const econ = load(ECON_FILE);
        const u = getUser(econ, user.id, user);
        if (u.balance < game.bet * 2) return interaction.reply({ content: `❌ ダブルダウンには **${(game.bet * 2).toLocaleString()}** 🪙 必要です。`, ...EPH });
        game.bet *= 2;
        game.playerCards.push(drawCard(game.deck));
        const playerTotal = calcBJ(game.playerCards);
        while (calcBJ(game.dealerCards) < 17) game.dealerCards.push(drawCard(game.deck));
        const dealerTotal = calcBJ(game.dealerCards);
        let result;
        if (playerTotal > 21) { u.balance -= game.bet; result = 'bust'; }
        else if (dealerTotal > 21 || playerTotal > dealerTotal) { u.balance += game.bet; result = 'win'; }
        else if (playerTotal === dealerTotal) { result = 'push'; }
        else { u.balance -= game.bet; result = 'lose'; }
        save(ECON_FILE, econ);
        bjGames.delete(gameKey);
        return interaction.update({ embeds: [buildBJEmbed(game, result, u.balance)], components: [] });
    }

    if (interaction.isStringSelectMenu() && cid === 'store_select_corp') {
        const corpId = interaction.values[0];
        const c = corpData[corpId];
        if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        return showStoreManage(interaction, c, corpData, user);
    }

    if (interaction.isStringSelectMenu() && cid.startsWith('store_buy_')) {
        const corpId = cid.replace('store_buy_', '');
        const c = corpData[corpId];
        if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        const itemName = interaction.values[0];
        const item = c.items.find(i => i.name === itemName);
        if (!item) return interaction.reply({ content: '❌ 商品が見つかりません。', ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < item.price) return interaction.reply({ content: `❌ 残高不足。必要: **${item.price.toLocaleString()}** / 現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
        u.balance -= item.price;
        c.balance = (c.balance || 0) + item.price;
        if (!u.inventory) u.inventory = [];
        u.inventory.push({ name: item.name, boughtAt: Date.now(), sellPrice: Math.floor(item.price * 0.3), from: c.name });
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${item.name}** を **${item.price.toLocaleString()}** 🪙 で購入しました！`, ...EPH });
    }

    if (!interaction.isButton()) return;

    if (cid.startsWith('store_additem_')) {
        const corpId = cid.replace('store_additem_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const modal = new ModalBuilder().setCustomId(`modal_store_additem_${corpId}`).setTitle(`${c.name} - 商品追加`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_name').setLabel('商品名').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_price').setLabel('価格').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_desc').setLabel('説明').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
    }

    if (cid.startsWith('store_removeitem_')) {
        const corpId = cid.replace('store_removeitem_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        if (c.items.length === 0) return interaction.reply({ content: '❌ 削除する商品がありません。', ...EPH });
        const select = new StringSelectMenuBuilder().setCustomId(`store_delitem_select_${corpId}`).setPlaceholder('削除する商品を選択')
            .addOptions(c.items.map(item => ({ label: item.name, description: `${item.price.toLocaleString()} 🪙`, value: item.name })));
        return interaction.reply({ content: '削除する商品を選択:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
    }

    if (cid.startsWith('store_withdraw_')) {
        const corpId = cid.replace('store_withdraw_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const amount = c.balance || 0;
        if (amount === 0) return interaction.reply({ content: '❌ 回収できる売上がありません。', ...EPH });
        const u = getUser(econ, user.id, user);
        u.balance += amount;
        c.balance = 0;
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** の売上 **${amount.toLocaleString()}** 🪙 を回収しました！\n残高: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
    }
}

async function handleEconModal(interaction) {
    const cid = interaction.customId;
    const { user, guild } = interaction;
    const econ = load(ECON_FILE);

    // ==================== 強盗モーダル ====================
    if (cid === 'modal_earn_rob') {
        const input = interaction.fields.getTextInputValue('rob_target_id').trim().replace(/[<@!>]/g, '');
        const robber = getUser(econ, user.id, user);
        let targetUser = null;
        if (guild) targetUser = await guild.members.fetch(input).catch(() => null);
        if (!targetUser) return interaction.reply({ content: '❌ ユーザーが見つかりません。', ...EPH });
        const target = targetUser.user;
        if (target.id === user.id) return interaction.reply({ content: '❌ 自分は強盗できません。', ...EPH });
        if (target.bot) return interaction.reply({ content: '❌ Botは強盗できません。', ...EPH });
        const victim = getUser(econ, target.id, target);
        if (victim.balance < 100) return interaction.reply({ content: `❌ **${target.username}** の残高が少なすぎます。`, ...EPH });
        const success = Math.random() < 0.4;
        let embed;
        if (success) {
            const stolen = Math.floor(victim.balance * (0.1 + Math.random() * 0.2));
            robber.balance += stolen; victim.balance -= stolen;
            embed = new EmbedBuilder().setTitle('🔫 強盗成功！').setDescription(`**${target.username}** から **${stolen.toLocaleString()}** 🪙 を奪った！\n残高: **${robber.balance.toLocaleString()}** 🪙`).setColor(0x57f287);
        } else {
            const fine = Math.floor(robber.balance * 0.1 + 200);
            robber.balance = Math.max(0, robber.balance - fine);
            embed = new EmbedBuilder().setTitle('🚔 強盗失敗！').setDescription(`捕まった！罰金 **${fine.toLocaleString()}** 🪙\n残高: **${robber.balance.toLocaleString()}** 🪙`).setColor(0xff4757);
        }
        save(ECON_FILE, econ);
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== コインフリップモーダル ====================
    if (cid === 'modal_earn_flip') {
        const amount = parseInt(interaction.fields.getTextInputValue('flip_amount')) || 0;
        const sideInput = interaction.fields.getTextInputValue('flip_side').trim().toLowerCase();
        const side = sideInput === 'omote' || sideInput === '表' ? 'heads' : sideInput === 'ura' || sideInput === '裏' ? 'tails' : null;
        if (!side) return interaction.reply({ content: '❌ 表は `omote`、裏は `ura` で入力してください。', ...EPH });
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const win = result === side;
        if (win) u.balance += amount; else u.balance -= amount;
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder()
            .setTitle(win ? '🎉 勝利！' : '😢 敗北...')
            .setColor(win ? 0x57f287 : 0xff4757)
            .addFields(
                { name: '選択', value: side === 'heads' ? '表 🪙' : '裏 🔄', inline: true },
                { name: '結果', value: result === 'heads' ? '表 🪙' : '裏 🔄', inline: true },
                { name: win ? `+${amount.toLocaleString()} 獲得` : `-${amount.toLocaleString()} 没収`, value: `残高: **${u.balance.toLocaleString()}** 🪙`, inline: false }
            );
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== スロットモーダル ====================
    if (cid === 'modal_earn_slots') {
        const amount = parseInt(interaction.fields.getTextInputValue('slots_amount')) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
        const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎'];
        const roll = () => symbols[Math.floor(Math.random() * symbols.length)];
        const s = [roll(), roll(), roll()];
        let multiplier = 0;
        if (s[0] === s[1] && s[1] === s[2]) multiplier = s[0] === '💎' ? 10 : s[0] === '⭐' ? 5 : 3;
        else if (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) multiplier = 1.5;
        const win = multiplier > 0;
        const payout = win ? Math.floor(amount * multiplier) : 0;
        u.balance += payout - amount;
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder().setTitle('🎰 スロット')
            .setDescription(`**[ ${s.join(' | ')} ]**\n\n${win ? `🎉 **${multiplier}x** 当たり！ **+${payout.toLocaleString()}** 🪙` : `💸 ハズレ... **-${amount.toLocaleString()}** 🪙`}`)
            .setColor(win ? 0xf1c40f : 0x95a5a6)
            .addFields({ name: '残高', value: `**${u.balance.toLocaleString()}** 🪙`, inline: true });
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== BJモーダル ====================
    if (cid === 'modal_earn_bj') {
        const bet = parseInt(interaction.fields.getTextInputValue('bj_amount')) || 0;
        if (bet <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < bet) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
        const deck = buildDeck();
        const playerCards = [drawCard(deck), drawCard(deck)];
        const dealerCards = [drawCard(deck), drawCard(deck)];
        const gameKey = `${user.id}_${Date.now()}`;
        bjGames.set(gameKey, { userId: user.id, bet, deck, playerCards, dealerCards });
        // BJ判定
        if (calcBJ(playerCards) === 21) {
            u.balance += Math.floor(bet * 1.5);
            save(ECON_FILE, econ);
            bjGames.delete(gameKey);
            const game = bjGames.get(gameKey) || { userId: user.id, bet, deck, playerCards, dealerCards };
            return interaction.reply({ embeds: [buildBJEmbed({ userId: user.id, bet, playerCards, dealerCards }, 'bj', u.balance)], components: [] });
        }
        const game = bjGames.get(gameKey);
        return interaction.reply({ embeds: [buildBJEmbed(game, 'playing')], components: buildBJRows(gameKey) });
    }

    // ==================== 銀行ローンモーダル ====================
    if (cid === 'modal_bank_loan') {
        const amount = parseInt(interaction.fields.getTextInputValue('loan_amount')) || 0;
        if (amount <= 0 || amount > 5000) return interaction.reply({ content: '❌ 1〜5,000の範囲で入力してください。', ...EPH });
        const u = getUser(econ, user.id, user);
        const current = u.loan || 0;
        if (current + amount > 5000) return interaction.reply({ content: `❌ 借入上限を超えます。現在の借入: **${current.toLocaleString()}** ${CURRENCY}`, ...EPH });
        u.loan = current + amount;
        u.balance += amount;
        u.loanDate = u.loanDate || Date.now();
        save(ECON_FILE, econ);
        return interaction.reply({ content: `✅ **${amount.toLocaleString()}** ${CURRENCY} を借りました。\n借入残高: **${u.loan.toLocaleString()}** ${CURRENCY}\n※毎日5%の利子が加算されます。`, ...EPH });
    }

    // ==================== 銀行返済モーダル ====================
    if (cid === 'modal_bank_repay') {
        const input = interaction.fields.getTextInputValue('repay_amount').trim().toLowerCase();
        const u = getUser(econ, user.id, user);
        const loan = u.loan || 0;
        if (loan <= 0) return interaction.reply({ content: '❌ 返済するローンがありません。', ...EPH });
        const amount = input === 'all' ? loan : parseInt(input) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
        if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        const actual = Math.min(amount, loan);
        u.balance -= actual;
        u.loan = loan - actual;
        if (u.loan <= 0) { u.loan = 0; delete u.loanDate; }
        save(ECON_FILE, econ);
        return interaction.reply({ content: `✅ **${actual.toLocaleString()}** ${CURRENCY} を返済しました。\n残り借入: **${u.loan.toLocaleString()}** ${CURRENCY}`, ...EPH });
    }

    // ==================== 株購入モーダル ====================
    if (cid.startsWith('modal_stock_buy_')) {
        const corpId = cid.replace('modal_stock_buy_', '');
        const amount = parseInt(interaction.fields.getTextInputValue('stock_amount')) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な株数を入力してください。', ...EPH });
        const corpData = load(CORP_FILE);
        const c = corpData[corpId];
        if (!c || !c.stock) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        const u = getUser(econ, user.id, user);
        const total = c.stock.price * amount;
        if (u.balance < total) return interaction.reply({ content: `❌ 残高不足。必要: **${total.toLocaleString()}** / 現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        if (c.stock.availableShares < amount) return interaction.reply({ content: `❌ 購入可能株数が不足。現在: **${c.stock.availableShares}** 株`, ...EPH });
        u.balance -= total;
        if (!u.stocks) u.stocks = {};
        u.stocks[c.id] = (u.stocks[c.id] || 0) + amount;
        c.stock.availableShares -= amount;
        c.balance = (c.balance || 0) + total;
        c.stock.price = Math.ceil(c.stock.price * (1 + 0.01 * Math.min(amount, 10)));
        if (!c.stock.history) c.stock.history = [];
        c.stock.history.push(c.stock.price);
        if (c.stock.history.length > 20) c.stock.history.shift();
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** の株を **${amount}** 株 (**${total.toLocaleString()}** ${CURRENCY}) で購入しました！\n現在株価: **${c.stock.price.toLocaleString()}** ${CURRENCY}`, ...EPH });
    }

    // ==================== 株売却モーダル ====================
    if (cid.startsWith('modal_stock_sell_')) {
        const corpId = cid.replace('modal_stock_sell_', '');
        const amount = parseInt(interaction.fields.getTextInputValue('stock_amount')) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な株数を入力してください。', ...EPH });
        const corpData = load(CORP_FILE);
        const c = corpData[corpId];
        if (!c || !c.stock) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        const u = getUser(econ, user.id, user);
        const held = (u.stocks || {})[c.id] || 0;
        if (held < amount) return interaction.reply({ content: `❌ 保有株数不足。現在: **${held}** 株`, ...EPH });
        const total = c.stock.price * amount;
        u.balance += total;
        u.stocks[c.id] -= amount;
        c.stock.availableShares += amount;
        c.stock.price = Math.max(1, Math.floor(c.stock.price * (1 - 0.008 * Math.min(amount, 10))));
        if (!c.stock.history) c.stock.history = [];
        c.stock.history.push(c.stock.price);
        if (c.stock.history.length > 20) c.stock.history.shift();
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** の株を **${amount}** 株 (**${total.toLocaleString()}** ${CURRENCY}) で売却しました！\n現在株価: **${c.stock.price.toLocaleString()}** ${CURRENCY}`, ...EPH });
    }

    // ==================== 株式発行モーダル ====================
    if (cid.startsWith('modal_store_issuestock_')) {
        const corpId = cid.replace('modal_store_issuestock_', '');
        const corpData = load(CORP_FILE);
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        if (c.stock) return interaction.reply({ content: '❌ すでに株式を発行しています。', ...EPH });
        const price = parseInt(interaction.fields.getTextInputValue('stock_initial_price')) || 0;
        const shares = parseInt(interaction.fields.getTextInputValue('stock_total_shares')) || 0;
        if (price <= 0 || shares <= 0) return interaction.reply({ content: '❌ 有効な値を入力してください。', ...EPH });
        c.stock = { price, totalShares: shares, availableShares: shares, history: [price] };
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** の株式を発行しました！\n初期株価: **${price.toLocaleString()}** ${CURRENCY}　発行数: **${shares}** 株\n\`/stock ${c.name}\` で確認できます。`, ...EPH });
    }

    // ==================== ストア商品追加モーダル ====================
    const corpData = load(CORP_FILE);
    if (cid.startsWith('modal_store_additem_')) {
        const corpId = cid.replace('modal_store_additem_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const name = interaction.fields.getTextInputValue('item_name').trim();
        const price = parseInt(interaction.fields.getTextInputValue('item_price')) || 0;
        const desc = interaction.fields.getTextInputValue('item_desc').trim();
        if (price <= 0) return interaction.reply({ content: '❌ 有効な価格を入力してください。', ...EPH });
        if (c.items.some(i => i.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: `❌ **${name}** はすでに存在します。`, ...EPH });
        c.items.push({ name, price, description: desc });
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${name}** (${price.toLocaleString()} 🪙) を **${c.name}** のストアに追加しました。`, ...EPH });
    }
}

async function handleEconSelect(interaction) {
    const cid = interaction.customId;
    const { user } = interaction;
    const corpData = load(CORP_FILE);
    if (cid.startsWith('store_delitem_select_')) {
        const corpId = cid.replace('store_delitem_select_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const itemName = interaction.values[0];
        const idx = c.items.findIndex(i => i.name === itemName);
        if (idx === -1) return interaction.reply({ content: '❌ 商品が見つかりません。', ...EPH });
        c.items.splice(idx, 1);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${itemName}** を削除しました。`, ...EPH });
    }
}

module.exports = { econCommands, handleEcon, handleEconInteraction, handleEconModal, handleEconSelect };
