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
    return `⚠️ 残高不足のため ${debt.toLocaleString()} ${CURRENCY} が自動借入されました。`;
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

// ==================== ブラックジャックロジック ====================
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
        win:     { title: '🎉 勝利！', color: 0x57f287, desc: `${mention}**+${game.bet.toLocaleString()}** ${CURRENCY} 獲得！\n残高: **${balance?.toLocaleString()}** ${CURRENCY}` },
        lose:    { title: '😢 負け...', color: 0xff4757, desc: `${mention}**-${game.bet.toLocaleString()}** ${CURRENCY}\n残高: **${balance?.toLocaleString()}** ${CURRENCY}` },
        push:    { title: '🤝 引き分け', color: 0x95a5a6, desc: `${mention}賭け金は返還されました。\n残高: **${balance?.toLocaleString()}** ${CURRENCY}` },
        bust:    { title: '💥 バスト！', color: 0xff4757, desc: `${mention}**-${game.bet.toLocaleString()}** ${CURRENCY}\n残高: **${balance?.toLocaleString()}** ${CURRENCY}` },
        bj:      { title: '🃏 ブラックジャック！', color: 0xf1c40f, desc: `${mention}**+${Math.floor(game.bet * 1.5).toLocaleString()}** ${CURRENCY} 獲得！\n残高: **${balance?.toLocaleString()}** ${CURRENCY}` },
    };
    const s = statusMap[status];
    const dealerShow = status === 'playing' ? `${game.dealerCards[0]} ??` : game.dealerCards.join(' ');
    const dealerScore = status === 'playing' ? '?' : dealerTotal;
    return new EmbedBuilder().setTitle(s.title).setColor(s.color)
        .addFields(
            { name: `ディーラー (${dealerScore})`, value: dealerShow, inline: false },
            { name: `あなた (${playerTotal})`, value: game.playerCards.join(' '), inline: false }
        )
        .setDescription(s.desc || `${mention}賭け金: **${game.bet.toLocaleString()}** ${CURRENCY}　レバレッジ: **${game.leverage || 2}x**`)
        .setFooter({ text: 'ヒット=カードを引く / スタンド=終了 / ダブル=2倍賭けで1枚引いて終了' });
}
function buildBJRows(gameKey) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${gameKey}`).setLabel('ヒット').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj_stand_${gameKey}`).setLabel('スタンド').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj_double_${gameKey}`).setLabel('ダブルダウン').setStyle(ButtonStyle.Danger)
    )];
}

// ==================== Earn ロジック実行関数 ====================
function executeDaily(u, now) {
    const jstNow = new Date(now + 9 * 3600000);
    const todayStr = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth()+1).padStart(2,'0')}-${String(jstNow.getUTCDate()).padStart(2,'0')}`;
    if (u.dailyDate === todayStr) return { error: true, message: "⏳ 受取済（深夜0時リセット）" };
    
    const streak = (u.dailyStreak || 0) + 1;
    const base = Math.floor(Math.random() * 201) + 200;
    const bonus = Math.min(streak, 7) * 50;
    const amount = base + bonus;
    u.balance += amount; 
    u.dailyStreak = streak; 
    u.dailyDate = todayStr; 
    u.dailyLast = now;
    return { amount, base, bonus, streak };
}

function executeWork(u, now) {
    const rem = 3600000 - (now - (u.workLast || 0));
    if (rem > 0) return { error: true, remaining: rem };
    const amount = Math.floor(Math.random() * (300 - 50 + 1)) + 50;
    u.balance += amount; 
    u.workLast = now;
    return { amount };
}

function executeCrime(u, now) {
    const rem = 7200000 - (now - (u.crimeLast || 0));
    if (rem > 0) return { error: true, remaining: rem };
    u.crimeLast = now;
    const success = Math.random() < 0.45;
    if (success) {
        const amount = Math.floor(Math.random() * (2000 - 100 + 1)) + 100;
        u.balance += amount;
        return { success: true, amount };
    } else {
        const fine = Math.floor(u.balance * 0.1) + 100;
        u.balance = Math.max(0, u.balance - fine);
        return { success: false, fine };
    }
}

// ==================== UIパネル生成 ====================
function buildEarnPanel(u, now) {
    const jstNow = new Date(now + 9 * 3600000);
    const todayStr = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth()+1).padStart(2,'0')}-${String(jstNow.getUTCDate()).padStart(2,'0')}`;
    const dailyDone = u.dailyDate === todayStr;
    const workRem  = 3600000  - (now - (u.workLast  || 0));
    const crimeRem = 7200000  - (now - (u.crimeLast || 0));
    const huntRem  = 1800000  - (now - (u.huntLast  || 0));
    const fishRem  = 2700000  - (now - (u.fishLast  || 0));

    const embed = new EmbedBuilder()
        .setTitle('💰 お金を稼ぐ')
        .setColor(0xf1c40f)
        .addFields(
            { name: '🎁 デイリー', value: `200〜400+ボーナス ${CURRENCY}\n連続${u.dailyStreak || 0}日目 🔥\n${dailyDone ? '⏳ 受取済（深夜0時リセット）' : '✅ 準備完了'}`, inline: true },
            { name: '💼 労働', value: `50〜300 ${CURRENCY}\nCD: 1時間\n${cdStr(workRem)}`, inline: true },
            { name: '🦹 犯罪', value: `成功: 100〜2000 ${CURRENCY}\n失敗: 没収あり\nCD: 2時間\n${cdStr(crimeRem)}`, inline: true },
            { name: '🏹 狩猟', value: `アイテムドロップ\nCD: 30分\n${cdStr(huntRem)}\n\`/earn hunt\``, inline: true },
            { name: '🎣 釣り', value: `魚ドロップ（レア有）\nCD: 45分\n${cdStr(fishRem)}\n\`/earn fish\``, inline: true },
            { name: '🎲 ゲーム', value: '`/earn rob` 強盗\n`/earn flip` コインフリップ\n`/earn slots` スロット\n`/earn bj` BJ', inline: true }
        );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('earn_daily').setLabel('🎁 デイリー').setStyle(ButtonStyle.Success).setDisabled(dailyDone),
        new ButtonBuilder().setCustomId('earn_work').setLabel('💼 労働').setStyle(ButtonStyle.Primary).setDisabled(workRem > 0),
        new ButtonBuilder().setCustomId('earn_crime').setLabel('🦹 犯罪').setStyle(ButtonStyle.Danger).setDisabled(crimeRem > 0)
    );
    return { embeds: [embed], components: [row] };
}

// ==================== スラッシュコマンド定義 ====================
const econCommands = [
    new SlashCommandBuilder().setName('balance').setDescription('所持金を確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー')),
    new SlashCommandBuilder().setName('pay').setDescription('他のユーザーに送金します').addUserOption(o => o.setName('user').setDescription('送金先').setRequired(true)).addStringOption(o => o.setName('amount').setDescription('金額（数字・all・half）').setRequired(true)),
    new SlashCommandBuilder().setName('earn').setDescription('お金を稼ぎます')
        .addSubcommand(sub => sub.setName('panel').setDescription('稼ぎパネルを表示'))
        .addSubcommand(sub => sub.setName('daily').setDescription('デイリーボーナスを受け取る'))
        .addSubcommand(sub => sub.setName('work').setDescription('働いてお金を稼ぐ'))
        .addSubcommand(sub => sub.setName('crime').setDescription('犯罪に手を染める'))
        .addSubcommand(sub => sub.setName('hunt').setDescription('狩りに行く（CD: 30分）'))
        .addSubcommand(sub => sub.setName('fish').setDescription('釣りに行く（CD: 45分）'))
        .addSubcommand(sub => sub.setName('rob').setDescription('強盗する').addStringOption(o => o.setName('target').setDescription('ターゲットのID or メンション').setRequired(true)))
        .addSubcommand(sub => sub.setName('flip').setDescription('コインフリップ').addStringOption(o => o.setName('amount').setDescription('金額').setRequired(true)).addStringOption(o => o.setName('side').setDescription('omote か ura').setRequired(true)))
        .addSubcommand(sub => sub.setName('slots').setDescription('スロット').addStringOption(o => o.setName('amount').setDescription('金額').setRequired(true)))
        .addSubcommand(sub => sub.setName('bj').setDescription('ブラックジャック').addStringOption(o => o.setName('amount').setDescription('金額').setRequired(true)).addIntegerOption(o => o.setName('leverage').setDescription('レバレッジ倍率(2-10)').setMinValue(2).setMaxValue(10))),
    new SlashCommandBuilder().setName('bank').setDescription('銀行メニュー（ローン・返済）'),
    new SlashCommandBuilder().setName('shop').setDescription('ショップのアイテム一覧を表示'),
    new SlashCommandBuilder().setName('inventory').setDescription('所持アイテムを確認').addUserOption(o => o.setName('user').setDescription('対象ユーザー')),
    new SlashCommandBuilder().setName('econrank').setDescription('所持金ランキングを表示'),
    new SlashCommandBuilder().setName('corp')
        .setDescription('会社管理')
        .addSubcommand(sub => sub.setName('create').setDescription('会社を設立').addStringOption(o => o.setName('name').setDescription('会社名').setRequired(true)).addStringOption(o => o.setName('description').setDescription('会社の説明').setRequired(true)))
        .addSubcommand(sub => sub.setName('setting').setDescription('会社の管理・ストア設定'))
        .addSubcommand(sub => sub.setName('deposit').setDescription('会社にお金を入れる').addStringOption(o => o.setName('corp').setDescription('会社名')).addStringOption(o => o.setName('amount').setDescription('金額').setRequired(true))),
    new SlashCommandBuilder().setName('crypto')
        .setDescription('仮想通貨')
        .addSubcommand(sub => sub.setName('create').setDescription('通貨を発行').addStringOption(o => o.setName('name').setRequired(true).setDescription('通貨名')).addStringOption(o => o.setName('symbol').setRequired(true).setDescription('シンボル')))
        .addSubcommand(sub => sub.setName('list').setDescription('一覧表示'))
        .addSubcommand(sub => sub.setName('view').setDescription('詳細表示').addStringOption(o => o.setName('symbol').setDescription('シンボル'))),
    new SlashCommandBuilder().setName('stock').setDescription('株式市場の一覧・詳細表示').addStringOption(o => o.setName('corp').setDescription('会社名')),
    new SlashCommandBuilder().setName('buystock').setDescription('株を購入').addStringOption(o => o.setName('amount').setRequired(true).setDescription('購入数')).addStringOption(o => o.setName('corp').setDescription('会社名')),
    new SlashCommandBuilder().setName('sellstock').setDescription('株を売却').addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('売却数')).addStringOption(o => o.setName('corp').setDescription('会社名')),
];

// ==================== メインハンドラー ====================
async function handleEcon(interaction) {
    const { commandName, options, user, guild } = interaction;
    const econ = load(ECON_FILE);
    const now = Date.now();

    // --- /balance ---
    if (commandName === 'balance') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const corpData = load(CORP_FILE);
        const ownedCorps = Object.values(corpData).filter(c => c.ownerId === target.id);
        const loan = u.loan || 0;
        const netBalance = u.balance - loan;
        const embed = new EmbedBuilder()
            .setTitle(`${CURRENCY} ${target.username} の所持金`)
            .setThumbnail(target.displayAvatarURL())
            .setColor(netBalance < 0 ? 0xff4757 : 0xf1c40f)
            .addFields(
                { name: '残高', value: `**${u.balance.toLocaleString()}** ${CURRENCY}`, inline: true },
                { name: '借入残高', value: loan > 0 ? `**-${loan.toLocaleString()}** ${CURRENCY}` : 'なし', inline: true },
                { name: '保有会社', value: ownedCorps.length > 0 ? ownedCorps.map(c => c.name).join(', ') : 'なし', inline: true }
            );
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // --- /pay ---
    if (commandName === 'pay') {
        const target = options.getUser('user');
        if (target.id === user.id) return interaction.reply({ content: '❌ 自分には送金できません。', ...EPH });
        if (target.bot) return interaction.reply({ content: '❌ Botには送金できません。', ...EPH });
        
        const sender = getUser(econ, user.id, user);
        const receiver = getUser(econ, target.id, target);
        const amtInput = options.getString('amount').trim().toLowerCase();
        
        let amount = amtInput === 'all' ? sender.balance : amtInput === 'half' ? Math.floor(sender.balance / 2) : parseInt(amtInput);
        if (isNaN(amount) || amount <= 0) return interaction.reply({ content: '❌ 正しい金額を入力してください。', ...EPH });
        if (sender.balance < amount) return interaction.reply({ content: '❌ 残高が不足しています。', ...EPH });

        sender.balance -= amount;
        receiver.balance += amount;
        save(ECON_FILE, econ);
        return interaction.reply({ content: `✅ <@${target.id}> に **${amount.toLocaleString()}** ${CURRENCY} を送金しました。` });
    }

    // --- /earn ---
    if (commandName === 'earn') {
        const sub = options.getSubcommand();
        const u = getUser(econ, user.id, user);

        if (sub === 'panel') {
            return interaction.reply(buildEarnPanel(u, now));
        }

        if (sub === 'daily') {
            const res = executeDaily(u, now);
            if (res.error) return interaction.reply({ content: res.message, ...EPH });
            save(ECON_FILE, econ);
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎁 デイリー').setDescription(`**+${res.amount}** ${CURRENCY} を獲得しました！\n連続${res.streak}日目 🔥`).setColor(0x57f287)] });
        }

        if (sub === 'work') {
            const res = executeWork(u, now);
            if (res.error) return interaction.reply({ content: `⏳ 労働CD中: ${cdStr(res.remaining)}`, ...EPH });
            save(ECON_FILE, econ);
            return interaction.reply({ content: `💼 働いて **${res.amount.toLocaleString()}** ${CURRENCY} 獲得しました！` });
        }

        if (sub === 'crime') {
            const res = executeCrime(u, now);
            if (res.error) return interaction.reply({ content: `⏳ 犯罪CD中: ${cdStr(res.remaining)}`, ...EPH });
            save(ECON_FILE, econ);
            if (res.success) return interaction.reply({ content: `🦹 成功！ **${res.amount.toLocaleString()}** ${CURRENCY} 奪いました！` });
            return interaction.reply({ content: `🚔 失敗... **${res.fine.toLocaleString()}** ${CURRENCY} 没収されました。` });
        }

        if (sub === 'hunt') {
            const remaining = 1800000 - (now - (u.huntLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ狩りに行けません。${cdStr(remaining)}`, ...EPH });
            u.huntLast = now;
            const huntItems = [
                { item: '🐰 ウサギの毛皮', sell: 80, rare: false },
                { item: '🦌 シカの角', sell: 250, rare: false },
                { item: '🐻 クマの毛皮', sell: 500, rare: true  },
            ];
            const hunt = huntItems[Math.floor(Math.random() * huntItems.length)];
            u.inventory.push({ name: hunt.item, sellPrice: hunt.sell });
            save(ECON_FILE, econ);
            return interaction.reply({ content: `🏹 **${hunt.item}** を手に入れました！ (売却額: ${hunt.sell} ${CURRENCY})` });
        }

        if (sub === 'fish') {
            const remaining = 2700000 - (now - (u.fishLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ釣りに行けません。${cdStr(remaining)}`, ...EPH });
            u.fishLast = now;
            const fishItems = [
                { item: '🐟 コイ', sell: 60, rare: false },
                { item: '🐡 フグ', sell: 300, rare: true },
                { item: '✨ 伝説の魚', sell: 2000, rare: true },
            ];
            const fish = fishItems[Math.floor(Math.random() * fishItems.length)];
            u.inventory.push({ name: fish.item, sellPrice: fish.sell });
            save(ECON_FILE, econ);
            return interaction.reply({ content: `🎣 **${fish.item}** を釣りました！ (売却額: ${fish.sell} ${CURRENCY})` });
        }

        if (sub === 'rob') {
            const targetInput = options.getString('target').replace(/[<@!>]/g, '');
            const robber = u;
            const victim = econ[targetInput];
            if (!victim || targetInput === user.id) return interaction.reply({ content: '❌ 無効なターゲットです。', ...EPH });
            if (victim.balance < 100) return interaction.reply({ content: '❌ 相手の所持金が少なすぎます。', ...EPH });
            
            const success = Math.random() < 0.4;
            if (success) {
                const stolen = Math.floor(victim.balance * 0.2);
                robber.balance += stolen; victim.balance -= stolen;
                save(ECON_FILE, econ);
                return interaction.reply({ content: `🔫 成功！ <@${targetInput}> から **${stolen.toLocaleString()}** ${CURRENCY} 奪いました！` });
            } else {
                const fine = Math.floor(robber.balance * 0.1) + 100;
                robber.balance = Math.max(0, robber.balance - fine);
                save(ECON_FILE, econ);
                return interaction.reply({ content: `🚔 失敗！ 警察に見つかり **${fine.toLocaleString()}** ${CURRENCY} の罰金を払いました。` });
            }
        }

        if (sub === 'flip') {
            const amtStr = options.getString('amount').toLowerCase();
            const side = options.getString('side').toLowerCase();
            let amount = amtStr === 'all' ? u.balance : amtStr === 'half' ? Math.floor(u.balance/2) : parseInt(amtStr);
            if (isNaN(amount) || amount <= 0 || u.balance < amount) return interaction.reply({ content: '❌ 金額が不正です。', ...EPH });
            
            const result = Math.random() < 0.5 ? 'omote' : 'ura';
            const win = side.includes(result);
            if (win) u.balance += amount; else u.balance -= amount;
            save(ECON_FILE, econ);
            return interaction.reply({ content: `${win ? '🎉 勝ち！' : '😢 負け...'} 結果は **${result === 'omote' ? '表' : '裏'}** でした。 (**${win ? '+' : '-'}${amount}** ${CURRENCY})` });
        }

        if (sub === 'slots') {
            const amtStr = options.getString('amount').toLowerCase();
            let amount = amtStr === 'all' ? u.balance : amtStr === 'half' ? Math.floor(u.balance/2) : parseInt(amtStr);
            if (isNaN(amount) || amount <= 0 || u.balance < amount) return interaction.reply({ content: '❌ 金額が不正です。', ...EPH });

            const icons = ['🍒', '🍋', '⭐', '💎'];
            const res = [icons[Math.floor(Math.random()*4)], icons[Math.floor(Math.random()*4)], icons[Math.floor(Math.random()*4)]];
            let multi = 0;
            if (res[0] === res[1] && res[1] === res[2]) multi = res[0] === '💎' ? 10 : 5;
            else if (res[0] === res[1] || res[1] === res[2] || res[0] === res[2]) multi = 2;

            const payout = amount * multi;
            u.balance = u.balance - amount + payout;
            save(ECON_FILE, econ);
            return interaction.reply({ content: `🎰 [ ${res.join(' | ')} ]\n${multi > 0 ? `🎉 当たり！ **${payout.toLocaleString()}** ${CURRENCY} 獲得！` : '💸 ハズレ...'}` });
        }

        if (sub === 'bj') {
            const amtStr = options.getString('amount').toLowerCase();
            const leverage = options.getInteger('leverage') || 2;
            let bet = amtStr === 'all' ? u.balance : amtStr === 'half' ? Math.floor(u.balance/2) : parseInt(amtStr);
            if (isNaN(bet) || bet <= 0 || u.balance < bet) return interaction.reply({ content: '❌ 金額が不正です。', ...EPH });

            const deck = buildDeck();
            const game = { userId: user.id, bet, leverage, deck, playerCards: [drawCard(deck), drawCard(deck)], dealerCards: [drawCard(deck), drawCard(deck)] };
            const gameKey = `${user.id}_${Date.now()}`;
            
            if (calcBJ(game.playerCards) === 21) {
                u.balance += Math.floor(bet * leverage * 1.5);
                save(ECON_FILE, econ);
                return interaction.reply({ embeds: [buildBJEmbed(game, 'bj', u.balance, user)] });
            }
            bjGames.set(gameKey, game);
            return interaction.reply({ embeds: [buildBJEmbed(game, 'playing', null, user)], components: buildBJRows(gameKey) });
        }
    }

    // --- /corp ---
    if (commandName === 'corp') {
        const sub = options.getSubcommand();
        const corpData = load(CORP_FILE);
        if (sub === 'create') {
            const name = options.getString('name');
            const desc = options.getString('description');
            const u = getUser(econ, user.id, user);
            if (u.balance < CORP_COST) return interaction.reply({ content: `❌ 設立費用 (${CORP_COST} ${CURRENCY}) が足りません。`, ...EPH });
            u.balance -= CORP_COST;
            const id = `corp_${Date.now()}`;
            corpData[id] = { id, name, description: desc, ownerId: user.id, ownerName: user.username, balance: 0, items: [], createdAt: Date.now() };
            save(ECON_FILE, econ);
            save(CORP_FILE, corpData);
            return interaction.reply({ content: `🏢 会社 **${name}** を設立しました！` });
        }
        // 他のサブコマンド...
    }

    // --- /crypto ---
    if (commandName === 'crypto') {
        const sub = options.getSubcommand();
        const cryptoData = load(CRYPTO_FILE);
        if (sub === 'list') {
            const list = Object.values(cryptoData).map(c => `• **${c.name}** (${c.symbol}): ${fmtPrice(c.price)} ${CURRENCY}`).join('\n') || 'なし';
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('💹 仮想通貨市場').setDescription(list)] });
        }
    }
    
    // 他のコマンド(stock, bank, etc)も同様の構造で実装...
}

// ==================== インタラクションハンドラー ====================
async function handleEconInteraction(interaction) {
    const cid = interaction.customId;
    const { user } = interaction;
    const econ = load(ECON_FILE);
    const now = Date.now();
    const u = getUser(econ, user.id, user);

    if (cid === 'earn_daily') {
        const res = executeDaily(u, now);
        if (res.error) return interaction.reply({ content: res.message, ...EPH });
        save(ECON_FILE, econ);
        await interaction.update(buildEarnPanel(u, now));
        return interaction.followUp({ content: `🎁 **+${res.amount}** ${CURRENCY} 獲得！ (連続${res.streak}日目)`, ...EPH });
    }

    if (cid === 'earn_work') {
        const res = executeWork(u, now);
        if (res.error) return interaction.reply({ content: '⏳ まだ働けません。', ...EPH });
        save(ECON_FILE, econ);
        await interaction.update(buildEarnPanel(u, now));
        return interaction.followUp({ content: `💼 **+${res.amount}** ${CURRENCY} 獲得！`, ...EPH });
    }

    if (cid === 'earn_crime') {
        const res = executeCrime(u, now);
        if (res.error) return interaction.reply({ content: '⏳ まだ犯罪はできません。', ...EPH });
        save(ECON_FILE, econ);
        await interaction.update(buildEarnPanel(u, now));
        const msg = res.success ? `🦹 成功！ **+${res.amount}** ${CURRENCY}` : `🚔 失敗... **-${res.fine}** ${CURRENCY}`;
        return interaction.followUp({ content: msg, ...EPH });
    }

    if (cid === 'delete_reply') return interaction.message.delete().catch(() => {});

    // BJ 操作
    if (cid.startsWith('bj_')) {
        const [,, gameKey] = cid.split('_');
        const game = bjGames.get(gameKey);
        if (!game || game.userId !== user.id) return interaction.reply({ content: '❌ 自分のゲームではありません。', ...EPH });

        if (cid.startsWith('bj_hit')) {
            game.playerCards.push(drawCard(game.deck));
            if (calcBJ(game.playerCards) > 21) {
                u.balance -= (game.bet * game.leverage);
                applyDebt(u); save(ECON_FILE, econ); bjGames.delete(gameKey);
                return interaction.update({ embeds: [buildBJEmbed(game, 'bust', u.balance, user)], components: [delBtn()] });
            }
            return interaction.update({ embeds: [buildBJEmbed(game, 'playing', null, user)] });
        }
        
        if (cid.startsWith('bj_stand')) {
            while (calcBJ(game.dealerCards) < 17) game.dealerCards.push(drawCard(game.deck));
            const p = calcBJ(game.playerCards);
            const d = calcBJ(game.dealerCards);
            let result = 'lose';
            if (d > 21 || p > d) { result = 'win'; u.balance += (game.bet * game.leverage); }
            else if (p === d) { result = 'push'; }
            else { u.balance -= (game.bet * game.leverage); }
            applyDebt(u); save(ECON_FILE, econ); bjGames.delete(gameKey);
            return interaction.update({ embeds: [buildBJEmbed(game, result, u.balance, user)], components: [delBtn()] });
        }
    }
}

module.exports = { econCommands, handleEcon, handleEconInteraction };
