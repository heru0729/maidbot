const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// canvasが使える場合は画像チャート、使えない場合はテキストチャートにフォールバック
let buildPriceChart = null;
try {
    ({ buildPriceChart } = require('./chart.js'));
    console.log('[chart] canvasチャート有効');
} catch (e) {
    console.warn('[chart] canvasが利用不可:', e.message);
}

const ECON_FILE  = path.join(__dirname, 'data', 'econ.json');
const CORP_FILE  = path.join(__dirname, 'data', 'corp.json');
const SHOP_FILE  = path.join(__dirname, 'data', 'shop.json');
const CRYPTO_FILE = path.join(__dirname, 'data', 'crypto.json');
const BIRTHDAY_FILE = path.join(__dirname, 'data', 'birthday.json');
const LOAN_FILE  = path.join(__dirname, 'data', 'loans.json');
const TRADE_FILE = path.join(__dirname, 'data', 'trades.json');
const AUCTION_FILE = path.join(__dirname, 'data', 'auctions.json');
const EPH = { flags: MessageFlags.Ephemeral };
const CURRENCY = '🪙';
const CORP_COST = 10000;
const FEE_RATE = 0.02; // 売買手数料2%
const round3 = (x) => Math.round(x * 1000) / 1000;
const fmtPrice = (x) => Number.isInteger(x) ? x.toLocaleString() : x.toFixed(3).replace(/\.?0+$/, '');

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
// チャートを生成（canvas画像 or テキストフォールバック）
async function makeChart(ohlcOrHistory, label, color) {
    if (buildPriceChart && ohlcOrHistory && ohlcOrHistory.length >= 2) {
        try {
            const buf = buildPriceChart(ohlcOrHistory, label, color);
            return { attachment: new AttachmentBuilder(buf, { name: 'chart.png' }), imageUrl: 'attachment://chart.png' };
        } catch (e) {
            console.error('[chart] 生成エラー:', e.message);
        }
    }
    return { attachment: null, imageUrl: null };
}

// OHLCまたは数値配列から終値配列を抽出
function extractCloses(ohlcOrHistory) {
    if (!ohlcOrHistory || ohlcOrHistory.length === 0) return [];
    if (typeof ohlcOrHistory[0] === 'object' && 'c' in ohlcOrHistory[0]) {
        return ohlcOrHistory.map(d => d.c);
    }
    return ohlcOrHistory;
}

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

// 残高が負になったとき差額をローンに自動追加
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

function cdStr(remaining) {
    if (remaining <= 0) return '✅ 準備完了';
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    if (h > 0) return `⏳ あと${h}時間${m}分`;
    if (m > 0) return `⏳ あと${m}分${s}秒`;
    return `⏳ あと${s}秒`;
}

const econCommands = [
    new SlashCommandBuilder().setName('balance').setDescription('所持金を確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')),
    new SlashCommandBuilder().setName('earn').setDescription('お金を稼ぐ')
        .addSubcommand(s => s.setName('daily').setDescription('デイリーボーナスを受け取る'))
        .addSubcommand(s => s.setName('work').setDescription('働いてコインを稼ぐ（CD: 1時間）'))
        .addSubcommand(s => s.setName('crime').setDescription('犯罪でコインを稼ぐ（CD: 2時間）'))
        .addSubcommand(s => s.setName('hunt').setDescription('狩猟してアイテムを入手（CD: 30分）'))
        .addSubcommand(s => s.setName('fish').setDescription('釣りをしてアイテムを入手（CD: 45分）'))
        .addSubcommand(s => s.setName('rob').setDescription('他ユーザーから強盗').addStringOption(o => o.setName('target').setDescription('ターゲットのID or メンション').setRequired(true)))
        .addSubcommand(s => s.setName('flip').setDescription('コインフリップ').addStringOption(o => o.setName('amount').setDescription('金額（数字・all・half）').setRequired(true)).addStringOption(o => o.setName('side').setDescription('omote か ura').setRequired(true)))
        .addSubcommand(s => s.setName('slots').setDescription('スロット').addStringOption(o => o.setName('amount').setDescription('金額（数字・all・half）').setRequired(true)))
        .addSubcommand(s => s.setName('bj').setDescription('ブラックジャック').addStringOption(o => o.setName('amount').setDescription('賭け金額（数字・all・half）').setRequired(true)).addIntegerOption(o => o.setName('leverage').setDescription('レバレッジ倍率（2〜10）').setMinValue(2).setMaxValue(10))),
    new SlashCommandBuilder().setName('pay').setDescription('他のユーザーに送金します').addUserOption(o => o.setName('user').setDescription('送金先ユーザー').setRequired(true)).addStringOption(o => o.setName('amount').setDescription('金額（数字・all・half）').setRequired(true)),
    new SlashCommandBuilder().setName('dust').setDescription('インベントリのアイテムを捨てます').addStringOption(o => o.setName('item').setDescription('アイテム名（未指定でセレクト）')).addIntegerOption(o => o.setName('amount').setDescription('捨てる数（未指定で1個）').setMinValue(1)),
    new SlashCommandBuilder().setName('shop').setDescription('ショップ・会社ストアのアイテム一覧を表示します'),
    new SlashCommandBuilder().setName('buy').setDescription('アイテムを購入します').addStringOption(o => o.setName('item').setDescription('アイテム名（未指定でセレクト）')).addIntegerOption(o => o.setName('amount').setDescription('購入数（数字のみ、未指定で1）').setMinValue(1)),
    new SlashCommandBuilder().setName('sell').setDescription('インベントリのアイテムを売却します')
        .addSubcommand(sub => sub.setName('trader').setDescription('アイテムを規定価格でショップに売却').addStringOption(o => o.setName('item').setDescription('アイテム名（未指定でセレクト）')).addIntegerOption(o => o.setName('amount').setDescription('個数（未指定で1）').setMinValue(1)))
        .addSubcommand(sub => sub.setName('shop').setDescription('価格を設定してプレイヤーに販売').addStringOption(o => o.setName('item').setDescription('アイテム名').setRequired(true)).addIntegerOption(o => o.setName('price').setDescription('販売価格').setRequired(true).setMinValue(1)).addUserOption(o => o.setName('buyer').setDescription('販売相手（未指定で告知のみ）'))),
    new SlashCommandBuilder().setName('inventory').setDescription('所持アイテムを確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')),
    new SlashCommandBuilder().setName('econrank').setDescription('所持金ランキングを表示します'),
    new SlashCommandBuilder().setName('bank').setDescription('銀行メニュー（残高確認・ローン・返済）'),
    new SlashCommandBuilder().setName('exchange').setDescription('UnbelievaBoatの通貨とmaidbotの🪙を換金します'),
    new SlashCommandBuilder().setName('corp')
        .setDescription('会社の管理')
        .addSubcommand(sub => sub.setName('create').setDescription('会社を設立します（1人2社まで・設立費用10,000枚）')
            .addStringOption(o => o.setName('name').setDescription('会社名').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('会社の説明').setRequired(true)))
        .addSubcommand(sub => sub.setName('setting').setDescription('自分の会社の管理・ストア設定').addStringOption(o => o.setName('corp').setDescription('会社名（1社の場合は省略可）')))
        .addSubcommand(sub => sub.setName('view').setDescription('会社情報・ストアを閲覧します').addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト）')))
        .addSubcommand(sub => sub.setName('deposit').setDescription('会社にお金を入れます').addStringOption(o => o.setName('amount').setDescription('金額（数字・all・half）').setRequired(true)).addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト）')))
        .addSubcommand(sub => sub.setName('join').setDescription('会社に就職します').addStringOption(o => o.setName('corp').setDescription('会社名').setRequired(true)))
        .addSubcommand(sub => sub.setName('leave').setDescription('会社を退職します'))
        .addSubcommand(sub => sub.setName('kick').setDescription('社員を解雇します（オーナーのみ）').addUserOption(o => o.setName('user').setDescription('解雇するユーザー').setRequired(true)).addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト）')))
        .addSubcommand(sub => sub.setName('salary').setDescription('日給を設定します（オーナーのみ）').addStringOption(o => o.setName('amount').setDescription('日給額（数字・0で無給）').setRequired(true)).addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト）'))),
    new SlashCommandBuilder().setName('crypto')
        .setDescription('仮想通貨市場')
        .addSubcommand(sub => sub.setName('create').setDescription('仮想通貨を発行します（1人1枚）')
            .addStringOption(o => o.setName('name').setDescription('通貨名').setRequired(true))
            .addStringOption(o => o.setName('symbol').setDescription('シンボル（例: BTC）').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('仮想通貨一覧を表示します'))
        .addSubcommand(sub => sub.setName('view').setDescription('チャートと詳細を表示します').addStringOption(o => o.setName('symbol').setDescription('シンボル（未指定でセレクト）')))
        .addSubcommand(sub => sub.setName('buy').setDescription('仮想通貨を購入します').addStringOption(o => o.setName('amount').setDescription('購入枚数（数字・小数・all 例: 0.5）').setRequired(true)).addStringOption(o => o.setName('symbol').setDescription('シンボル（未指定でセレクト）')))
        .addSubcommand(sub => sub.setName('sell').setDescription('仮想通貨を売却します').addStringOption(o => o.setName('amount').setDescription('売却枚数（数字・小数・all 例: 0.5）').setRequired(true)).addStringOption(o => o.setName('symbol').setDescription('シンボル（未指定でセレクト）'))),
    new SlashCommandBuilder().setName('stock').setDescription('株式市場（会社の株売買・チャート）').addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト表示）')),
    new SlashCommandBuilder().setName('buystock').setDescription('株を購入します').addStringOption(o => o.setName('amount').setDescription('購入株数（数字・all）').setRequired(true)).addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト表示）')),
    new SlashCommandBuilder().setName('sellstock').setDescription('株を売却します').addIntegerOption(o => o.setName('amount').setDescription('売却株数').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト表示）')),

    // 誕生日
    new SlashCommandBuilder().setName('birthday')
        .setDescription('誕生日を管理します')
        .addSubcommand(sub => sub.setName('set').setDescription('誕生日を登録します').addStringOption(o => o.setName('date').setDescription('誕生日（例: 03/20）').setRequired(true)))
        .addSubcommand(sub => sub.setName('check').setDescription('誕生日を確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')))
        .addSubcommand(sub => sub.setName('list').setDescription('サーバーの誕生日一覧を表示します'))
        .addSubcommand(sub => sub.setName('channel').setDescription('誕生日通知チャンネルを設定します（管理者）').addChannelOption(o => o.setName('channel').setDescription('通知先チャンネル').setRequired(true))),

    // 融資
    new SlashCommandBuilder().setName('loan')
        .setDescription('会社からの融資管理')
        .addSubcommand(sub => sub.setName('request').setDescription('会社に融資を申請します').addStringOption(o => o.setName('corp').setDescription('融資先の会社名').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('融資額').setRequired(true).setMinValue(1)))
        .addSubcommand(sub => sub.setName('repay').setDescription('融資を返済します').addStringOption(o => o.setName('amount').setDescription('返済額（数字・all）').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('融資申請一覧（会社オーナー用）').addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト）')))
        .addSubcommand(sub => sub.setName('approve').setDescription('融資を承認します（会社オーナー用）').addStringOption(o => o.setName('id').setDescription('申請ID').setRequired(true)))
        .addSubcommand(sub => sub.setName('deny').setDescription('融資を却下します（会社オーナー用）').addStringOption(o => o.setName('id').setDescription('申請ID').setRequired(true)))
        .addSubcommand(sub => sub.setName('setlimit').setDescription('融資上限を設定します（会社オーナー用）').addIntegerOption(o => o.setName('amount').setDescription('上限額（0で無効）').setRequired(true).setMinValue(0)).addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト）'))),

    // 会社間取引
    new SlashCommandBuilder().setName('trade')
        .setDescription('会社間でアイテムを取引します')
        .addSubcommand(sub => sub.setName('offer').setDescription('他社にアイテムを売却オファーします').addStringOption(o => o.setName('item').setDescription('アイテム名').setRequired(true)).addIntegerOption(o => o.setName('price').setDescription('希望価格').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('target').setDescription('取引相手の会社名').setRequired(true)).addStringOption(o => o.setName('corp').setDescription('自分の会社名（未指定でセレクト）')))
        .addSubcommand(sub => sub.setName('accept').setDescription('取引オファーを承認します').addStringOption(o => o.setName('id').setDescription('オファーID').setRequired(true)))
        .addSubcommand(sub => sub.setName('deny').setDescription('取引オファーを却下します').addStringOption(o => o.setName('id').setDescription('オファーID').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('届いているオファー一覧を表示します').addStringOption(o => o.setName('corp').setDescription('会社名（未指定でセレクト）'))),

    // オークション
    new SlashCommandBuilder().setName('auction')
        .setDescription('オークション管理')
        .addSubcommand(sub => sub.setName('start').setDescription('オークションを開始します').addStringOption(o => o.setName('item').setDescription('出品するアイテム名').setRequired(true)).addIntegerOption(o => o.setName('start_price').setDescription('開始価格').setRequired(true).setMinValue(1)).addIntegerOption(o => o.setName('minutes').setDescription('終了までの時間（分）').setRequired(true).setMinValue(1).setMaxValue(1440)))
        .addSubcommand(sub => sub.setName('list').setDescription('開催中のオークション一覧'))
        .addSubcommand(sub => sub.setName('cancel').setDescription('自分のオークションをキャンセルします').addStringOption(o => o.setName('id').setDescription('オークションID').setRequired(true))),
];

async function handleEcon(interaction) {
    const { commandName, options, user, guild, guildId } = interaction;
    const econ = load(ECON_FILE);

    if (commandName === 'balance') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const corp = load(CORP_FILE);
        const cryptoData = load(CRYPTO_FILE);
        const ownedCorps = Object.values(corp).filter(c => c.ownerId === target.id);
        const loan = u.loan || 0;
        const netBalance = round3(u.balance - loan);

        // 仮想通貨保有情報
        const heldCrypto = Object.entries(u.crypto || {}).filter(([, amt]) => amt > 0);
        let cryptoValue = 0;
        const cryptoLines = heldCrypto.map(([id, amt]) => {
            const coin = cryptoData[id];
            if (!coin) return null;
            const val = round3(amt * coin.price);
            cryptoValue += val;
            return `${coin.symbol}: **${fmtPrice(amt)}** 枚 (≒ **${fmtPrice(val)}** 🪙)`;
        }).filter(Boolean);

        const embed = new EmbedBuilder()
            .setTitle(`${CURRENCY} ${target.username} の所持金`)
            .setThumbnail(target.displayAvatarURL())
            .setColor(netBalance < 0 ? 0xff4757 : 0xf1c40f)
            .addFields(
                { name: '残高', value: `**${fmtPrice(u.balance)}** ${CURRENCY}`, inline: true },
                { name: '借入残高', value: loan > 0 ? `**-${fmtPrice(loan)}** ${CURRENCY}` : 'なし', inline: true },
                { name: '実質残高', value: `**${fmtPrice(netBalance)}** ${CURRENCY}${netBalance < 0 ? ' 🔴' : ''}`, inline: true },
                { name: '保有会社', value: ownedCorps.length > 0 ? ownedCorps.map(c => c.name).join(', ') : 'なし', inline: true },
                { name: '💹 仮想通貨', value: cryptoLines.length > 0 ? cryptoLines.join('\n') : 'なし', inline: false },
                { name: '仮想通貨評価額', value: `**${fmtPrice(cryptoValue)}** 🪙`, inline: true }
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

    if (commandName === 'earn') {
        const sub = options.getSubcommand();
        const u = getUser(econ, user.id, user);
        const now = Date.now();

        if (sub === 'daily') {
            const jstNow = new Date(now + 9 * 3600000);
            const todayStr = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth()+1).padStart(2,'0')}-${String(jstNow.getUTCDate()).padStart(2,'0')}`;
            if (u.dailyDate === todayStr) {
                const nextMidnight = new Date(jstNow); nextMidnight.setUTCHours(24, 0, 0, 0);
                const rem = nextMidnight.getTime() - jstNow.getTime();
                const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
                return interaction.reply({ content: `⏳ 今日のデイリーは受け取り済みです。次回: **${h}時間${m}分後**（深夜0時リセット）`, ...EPH });
            }
            const streak = (u.dailyStreak || 0) + 1;
            const base = Math.floor(Math.random() * 201) + 200;
            const bonus = Math.min(streak, 7) * 50;
            u.balance += base + bonus; u.dailyLast = now; u.dailyStreak = streak; u.dailyDate = todayStr;
            save(ECON_FILE, econ);
            const embed = new EmbedBuilder().setTitle('🎁 デイリーボーナス')
                .setDescription(`<@${user.id}> **+${base + bonus}** ${CURRENCY} を受け取りました！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`)
                .addFields({ name: '内訳', value: `ベース: ${base} + 連続: ${bonus}`, inline: true }, { name: '連続ログイン', value: `${streak}日目 🔥`, inline: true })
                .setColor(0x57f287).setTimestamp();
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'work') {
            const workRem = 3600000 - (now - (u.workLast || 0));
            if (workRem > 0) return interaction.reply({ content: `⏳ まだ働けません。${cdStr(workRem)}`, ...EPH });
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
            save(ECON_FILE, econ);
            const embed = new EmbedBuilder().setTitle(`💼 ${job.name} として働いた`)
                .setDescription(`<@${user.id}> ${job.desc}！\n**+${amount}** ${CURRENCY} を獲得！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`)
                .setColor(0x3498db).setTimestamp();
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'crime') {
            const crimeRem = 7200000 - (now - (u.crimeLast || 0));
            if (crimeRem > 0) return interaction.reply({ content: `⏳ まだ犯罪はできません。${cdStr(crimeRem)}`, ...EPH });
            u.crimeLast = now;
            const crimes = [
                { name: '車上荒らし', success: 0.6, gain: [200, 500], fine: [100, 300] },
                { name: '銀行強盗',   success: 0.3, gain: [800, 2000], fine: [400, 800] },
                { name: 'スリ',       success: 0.7, gain: [100, 300],  fine: [50, 200] },
                { name: '詐欺',       success: 0.5, gain: [300, 700],  fine: [200, 500] },
                { name: '密輸',       success: 0.4, gain: [500, 1200], fine: [300, 600] },
            ];
            const crime = crimes[Math.floor(Math.random() * crimes.length)];
            const success = Math.random() < crime.success;
            let embed;
            if (success) {
                const amount = Math.floor(Math.random() * (crime.gain[1] - crime.gain[0] + 1)) + crime.gain[0];
                u.balance += amount;
                embed = new EmbedBuilder().setTitle(`🦹 ${crime.name} 成功！`).setDescription(`<@${user.id}> **+${amount}** ${CURRENCY}！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`).setColor(0x57f287);
            } else {
                const fine = Math.floor(Math.random() * (crime.fine[1] - crime.fine[0] + 1)) + crime.fine[0];
                u.balance = Math.max(0, u.balance - fine);
                embed = new EmbedBuilder().setTitle(`🚔 ${crime.name} 失敗！`).setDescription(`<@${user.id}> 捕まった！**${fine}** ${CURRENCY} 没収。\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`).setColor(0xff4757);
            }
            save(ECON_FILE, econ);
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'hunt') {
            const remaining = 1800000 - (now - (u.huntLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ狩りに行けません。${cdStr(remaining)}`, ...EPH });
            u.huntLast = now;
            const hunts = [
                { name: 'ウサギ',   item: '🐰 ウサギの毛皮',  sell: 80,  rare: false },
                { name: 'シカ',     item: '🦌 シカの角',      sell: 250, rare: false },
                { name: 'クマ',     item: '🐻 クマの毛皮',    sell: 500, rare: true  },
                { name: 'キツネ',   item: '🦊 キツネの毛皮',  sell: 150, rare: false },
                { name: 'イノシシ', item: '🐗 イノシシの牙',  sell: 200, rare: false },
                { name: 'オオカミ', item: '🐺 オオカミの毛皮', sell: 400, rare: true  },
            ];
            const wt = hunts.map(h => h.rare ? 1 : 3), wsum = wt.reduce((a,b)=>a+b,0);
            let wr = Math.random()*wsum, hunt=hunts[0];
            for(let i=0;i<hunts.length;i++){wr-=wt[i];if(wr<=0){hunt=hunts[i];break;}}
            if(!u.inventory) u.inventory=[];
            u.inventory.push({name:hunt.item,boughtAt:now,sellPrice:hunt.sell});
            save(ECON_FILE,econ);
            const embed = new EmbedBuilder().setTitle(`🏹 ${hunt.name}を仕留めた！`)
                .setDescription(`<@${user.id}> **${hunt.item}** を入手！\n売却価格: **${hunt.sell.toLocaleString()}** ${CURRENCY}`)
                .setColor(hunt.rare ? 0xf1c40f : 0x57f287).setTimestamp();
            const r = await interaction.reply({ embeds: [embed], fetchReply: true });
            setTimeout(() => r.delete().catch(()=>{}), 8000);
            return;
        }

        if (sub === 'fish') {
            const remaining = 2700000 - (now - (u.fishLast || 0));
            if (remaining > 0) return interaction.reply({ content: `⏳ まだ釣りに行けません。${cdStr(remaining)}`, ...EPH });
            u.fishLast = now;
            const fishes = [
                { name: 'コイ',     item: '🐟 コイ',       sell: 60,   rare: false, legendary: false },
                { name: 'サーモン', item: '🐠 サーモン',    sell: 150,  rare: false, legendary: false },
                { name: 'マグロ',   item: '🐡 マグロ',      sell: 400,  rare: true,  legendary: false },
                { name: 'フグ',     item: '🐡 フグ',        sell: 300,  rare: true,  legendary: false },
                { name: 'タコ',     item: '🐙 タコ',        sell: 200,  rare: false, legendary: false },
                { name: 'ゴミ',     item: '🗑️ ゴミ',       sell: 5,    rare: false, legendary: false },
                { name: '伝説の魚', item: '✨ 伝説の魚',    sell: 2000, rare: true,  legendary: true  },
            ];
            const wt = fishes.map(f => f.legendary ? 0.2 : f.rare ? 1 : 4), wsum = wt.reduce((a,b)=>a+b,0);
            let wr = Math.random()*wsum, fish=fishes[0];
            for(let i=0;i<fishes.length;i++){wr-=wt[i];if(wr<=0){fish=fishes[i];break;}}
            if(!u.inventory) u.inventory=[];
            u.inventory.push({name:fish.item,boughtAt:now,sellPrice:fish.sell});
            save(ECON_FILE,econ);
            const embed = new EmbedBuilder()
                .setTitle(fish.legendary ? '🌟 伝説の魚を釣り上げた！！' : `🎣 ${fish.name} を釣った！`)
                .setDescription(`<@${user.id}> **${fish.item}** を入手！\n売却価格: **${fish.sell.toLocaleString()}** ${CURRENCY}`)
                .setColor(fish.legendary ? 0xf1c40f : fish.rare ? 0x3498db : 0x95a5a6).setTimestamp();
            const r = await interaction.reply({ embeds: [embed], fetchReply: true });
            setTimeout(() => r.delete().catch(()=>{}), fish.legendary ? 30000 : 8000);
            return;
        }

        if (sub === 'rob') {
            const input = options.getString('target').replace(/[<@!>]/g, '');
            const member = guild ? await guild.members.fetch(input).catch(() => null) : null;
            let targetId = input, targetName = null;
            if (member) { targetId = member.user.id; targetName = member.user.username; }
            else {
                const found = Object.entries(econ).find(([id,eu])=>id===input||eu.username?.toLowerCase()===input.toLowerCase());
                if (found) { targetId=found[0]; targetName=found[1].username||`ID:${found[0]}`; }
                else return interaction.reply({ content: '❌ ユーザーが見つかりません。', ...EPH });
            }
            if (targetId === user.id) return interaction.reply({ content: '❌ 自分は強盗できません。', ...EPH });
            const victim = getUser(econ, targetId, null);
            if (victim.balance < 100) return interaction.reply({ content: `❌ **${targetName}** の残高が少なすぎます。`, ...EPH });
            const success = Math.random() < 0.4;
            let embed;
            if (success) {
                const stolen = Math.floor(victim.balance * (0.1 + Math.random() * 0.2));
                u.balance += stolen; victim.balance -= stolen;
                embed = new EmbedBuilder().setTitle('🔫 強盗成功！').setDescription(`**${targetName}** から **${stolen.toLocaleString()}** 🪙 を奪った！\n残高: **${u.balance.toLocaleString()}** 🪙`).setColor(0x57f287);
            } else {
                const fine = Math.floor(u.balance * 0.1 + 200);
                u.balance = Math.max(0, u.balance - fine);
                embed = new EmbedBuilder().setTitle('🚔 強盗失敗！').setDescription(`捕まった！罰金 **${fine.toLocaleString()}** 🪙\n残高: **${u.balance.toLocaleString()}** 🪙`).setColor(0xff4757);
            }
            save(ECON_FILE, econ);
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'flip') {
            const amtInput = options.getString('amount').trim().toLowerCase();
            const sideInput = options.getString('side').trim().toLowerCase();
            let amount;
            if (amtInput === 'all') amount = u.balance;
            else if (amtInput === 'half') amount = Math.floor(u.balance / 2);
            else amount = parseInt(amtInput) || 0;
            const side = (sideInput === 'omote' || sideInput === '表') ? 'heads' : 'tails';
            if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
            if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
            const result = Math.random() < 0.5 ? 'heads' : 'tails';
            const win = result === side;
            if (win) u.balance += amount; else u.balance -= amount;
            save(ECON_FILE, econ);
            const embed = new EmbedBuilder().setTitle(win ? '🎉 勝利！' : '😢 敗北...').setColor(win ? 0x57f287 : 0xff4757)
                .addFields(
                    { name: '選択', value: side === 'heads' ? '表 🪙' : '裏 🔄', inline: true },
                    { name: '結果', value: result === 'heads' ? '表 🪙' : '裏 🔄', inline: true },
                    { name: win ? `+${amount.toLocaleString()} 獲得` : `-${amount.toLocaleString()} 没収`, value: `残高: **${u.balance.toLocaleString()}** 🪙`, inline: false }
                );
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'slots') {
            const amtInput = options.getString('amount').trim().toLowerCase();
            let amount;
            if (amtInput === 'all') amount = u.balance;
            else if (amtInput === 'half') amount = Math.floor(u.balance / 2);
            else amount = parseInt(amtInput) || 0;
            if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
            if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
            const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎'];
            const roll = () => symbols[Math.floor(Math.random() * symbols.length)];
            const s = [roll(), roll(), roll()];
            let multiplier = 0;
            if (s[0]===s[1]&&s[1]===s[2]) multiplier = s[0]==='💎'?10:s[0]==='⭐'?5:3;
            else if (s[0]===s[1]||s[1]===s[2]||s[0]===s[2]) multiplier = 1.5;
            const win = multiplier > 0;
            const payout = win ? Math.floor(amount * multiplier) : 0;
            u.balance += payout - amount;
            save(ECON_FILE, econ);
            const embed = new EmbedBuilder().setTitle('🎰 スロット')
                .setDescription(`**[ ${s.join(' | ')} ]**\n\n${win?`🎉 **${multiplier}x** 当たり！ **+${payout.toLocaleString()}** 🪙`:`💸 ハズレ... **-${amount.toLocaleString()}** 🪙`}`)
                .setColor(win ? 0xf1c40f : 0x95a5a6)
                .addFields({ name: '残高', value: `**${u.balance.toLocaleString()}** 🪙`, inline: true });
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'bj') {
            const amtInput = options.getString('amount').trim().toLowerCase();
            const leverageRaw = options.getInteger('leverage') || 2;
            const leverage = Math.min(10, Math.max(2, leverageRaw));
            let bet;
            if (amtInput === 'all') bet = u.balance;
            else if (amtInput === 'half') bet = Math.floor(u.balance / 2);
            else bet = parseInt(amtInput) || 0;
            if (bet <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
            if (u.balance < bet) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
            const deck = buildDeck();
            const playerCards = [drawCard(deck), drawCard(deck)];
            const dealerCards = [drawCard(deck), drawCard(deck)];
            const gameKey = `${user.id}_${Date.now()}`;
            const gameObj = { userId: user.id, bet, leverage, deck, playerCards, dealerCards };
            if (calcBJ(playerCards) === 21) {
                u.balance += Math.floor(bet * leverage * 1.5);
                save(ECON_FILE, econ);
                return interaction.reply({ embeds: [buildBJEmbed(gameObj, 'bj', u.balance, user)], components: [delBtn()], ...EPH });
            }
            bjGames.set(gameKey, gameObj);
            return interaction.reply({ embeds: [buildBJEmbed(gameObj, 'playing', null, user)], components: buildBJRows(gameKey), ...EPH });
        }
        return;
    }

    if (commandName === 'pay') {
        const target = options.getUser('user');
        if (target.id === user.id) return interaction.reply({ content: '❌ 自分自身には送金できません。', ...EPH });
        if (target.bot) return interaction.reply({ content: '❌ Botには送金できません。', ...EPH });
        const sender = getUser(econ, user.id, user);
        const receiver = getUser(econ, target.id, target);
        const amtInput = options.getString('amount').trim().toLowerCase();
        let amount;
        if (amtInput === 'all') amount = sender.balance;
        else if (amtInput === 'half') amount = Math.floor(sender.balance / 2);
        else amount = parseInt(amtInput) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
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

    if (commandName === 'exchange') {
        const serverCfg = (() => {
            try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'data','servers.json'),'utf8'))[guildId] || {}; } catch(e){ return {}; }
        })();
        const ex = serverCfg.exchange || {};
        if (!ex.enabled) return interaction.reply({ content: '❌ このサーバーでは換金機能が無効です。管理者が `/set` → **UNB換金** から有効化できます。', ...EPH });
        if (!process.env.UNB_TOKEN) return interaction.reply({ content: '❌ UNB_TOKENが環境変数に設定されていません。', ...EPH });

        // メンバー数チェック（30人以上のサーバーのみ）
        const MIN_MEMBERS = 30;
        const memberCount = interaction.guild?.memberCount || 0;
        if (memberCount < MIN_MEMBERS) return interaction.reply({ content: `❌ この機能はメンバーが **${MIN_MEMBERS}人以上** のサーバーでのみ利用できます。\n現在: **${memberCount}人**`, ...EPH });

        // UNB残高を取得して表示
        let unbBalance = 0;
        try {
            const { Client } = require('unb-api');
            const unbClient = new Client(process.env.UNB_TOKEN);
            const unbUser = await unbClient.getUserBalance(guildId, user.id);
            unbBalance = unbUser.cash || 0;
        } catch(e) {
            return interaction.reply({ content: `❌ UNB API接続エラー: ${e.message}\nAPIトークンを確認してください。`, ...EPH });
        }

        const u = getUser(econ, user.id, user);
        const r1 = 1;
        const r2 = 1;

        const embed = new EmbedBuilder()
            .setTitle('💱 換金')
            .setColor(0x5865f2)
            .addFields(
                { name: 'UNB残高', value: `**${unbBalance.toLocaleString()}** UNB`, inline: true },
                { name: 'maidbot残高', value: `**${u.balance.toLocaleString()}** 🪙`, inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                { name: 'UNB → 🪙 レート', value: `1 UNB = **${r1}** 🪙`, inline: true },
                { name: '🪙 → UNB レート', value: `1 🪙 = **${r2}** UNB`, inline: true }
            );
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('exchange_unb_to_bot').setLabel('UNB → 🪙').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('exchange_bot_to_unb').setLabel('🪙 → UNB').setStyle(ButtonStyle.Primary)
        );
        return interaction.reply({ embeds: [embed], components: [row, delBtn()], ...EPH });
    }

    if (commandName === 'dust') {
        const u = getUser(econ, user.id, user);
        if (!u.inventory || u.inventory.length === 0) return interaction.reply({ content: '❌ インベントリが空です。', ...EPH });
        const itemName = options.getString('item');
        const dustCount = options.getInteger('amount') || 1;
        if (!itemName) {
            const counts = {};
            for (const item of u.inventory) counts[item.name] = (counts[item.name] || 0) + 1;
            const select = new StringSelectMenuBuilder()
                .setCustomId(`dust_select_${dustCount}`)
                .setPlaceholder('捨てるアイテムを選択')
                .addOptions(Object.entries(counts).slice(0, 25).map(([name, count]) => ({
                    label: name, description: `所持: ${count}個`, value: name
                })));
            return interaction.reply({ content: `🗑️ 捨てるアイテムを選択してください（${dustCount}個捨てます）:`, components: [new ActionRowBuilder().addComponents(select)], ...EPH });
        }
        return doDustItem(interaction, itemName, dustCount, econ, u);
    }

    if (commandName === 'shop') {
        const shop = load(SHOP_FILE);
        const corpData = load(CORP_FILE);
        const shopItems = Object.values(shop);
        const corps = Object.values(corpData).filter(c => c.items && c.items.length > 0);

        if (shopItems.length === 0 && corps.length === 0) {
            return interaction.reply({ content: '🛒 現在ショップにアイテムがありません。', ...EPH });
        }

        const embed = new EmbedBuilder().setTitle('🛒 ショップ').setColor(0xe67e22);

        if (shopItems.length > 0) {
            embed.addFields({
                name: '📦 公式ショップ',
                value: shopItems.map((item, i) =>
                    `**${i + 1}. ${item.name}**${item.roleId ? ' 🏷️' : ''}\n💰 **${item.price.toLocaleString()}** 🪙　↩️ 売却: **${Math.floor(item.price * 0.5).toLocaleString()}** 🪙\n${item.description}`
                ).join('\n\n'),
                inline: false
            });
        }

        for (const corp of corps) {
            embed.addFields({
                name: `🏪 ${corp.name}（オーナー: ${corp.ownerName}）`,
                value: corp.items.map((item, i) =>
                    `**${i + 1}. ${item.name}**\n💰 **${item.price.toLocaleString()}** 🪙　${item.description}`
                ).join('\n\n'),
                inline: false
            });
        }

        embed.setDescription('`/buy` で購入　`/sell shop` でショップ売却　`/sell trader` でプレイヤー販売')
            .setFooter({ text: `公式${shopItems.length}件 + 会社ストア${corps.reduce((a,c)=>a+c.items.length,0)}件` });

        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'buy') {
        const shop = load(SHOP_FILE);
        const items = Object.values(shop);
        if (items.length === 0) return interaction.reply({ content: '🛒 現在ショップにアイテムがありません。', ...EPH });
        const itemName = options.getString('item');
        const buyAmount = options.getInteger('amount') || 1;
        if (!itemName) {
            const select = new StringSelectMenuBuilder()
                .setCustomId(`buy_select_${buyAmount}`)
                .setPlaceholder('購入するアイテムを選択')
                .addOptions(items.slice(0, 25).map(item => ({
                    label: item.name,
                    description: `${item.price.toLocaleString()} 🪙${item.roleId ? ' | ロール付与' : ''}`,
                    value: item.name
                })));
            return interaction.reply({ content: `🛒 購入するアイテムを選択してください（${buyAmount}個）:`, components: [new ActionRowBuilder().addComponents(select)], ...EPH });
        }
        return doBuyItem(interaction, itemName, buyAmount, econ, user, guild, shop);
    }

    if (commandName === 'sell') {
        const sub = options.getSubcommand();
        const u = getUser(econ, user.id, user);
        if (!u.inventory || u.inventory.length === 0) return interaction.reply({ content: '❌ インベントリが空です。', ...EPH });

        if (sub === 'trader') {
            // 規定価格でショップに売却
            const itemName = options.getString('item');
            const sellCount = options.getInteger('amount') || 1;
            if (!itemName) {
                const counts = {};
                for (const item of u.inventory) counts[item.name] = (counts[item.name] || 0) + 1;
                if (Object.keys(counts).length === 0) return interaction.reply({ content: '❌ 売却できるアイテムがありません。', ...EPH });
                const select = new StringSelectMenuBuilder()
                    .setCustomId(`sell_select_${sellCount}`)
                    .setPlaceholder('売却するアイテムを選択')
                    .addOptions(Object.entries(counts).slice(0, 25).map(([name, count]) => {
                        const sellPrice = u.inventory.find(i => i.name === name)?.sellPrice || 0;
                        return { label: name, description: `所持: ${count}個 | 規定価格: ${sellPrice.toLocaleString()} 🪙/個`, value: name };
                    }));
                return interaction.reply({ content: `🎒 売却するアイテムを選択してください（${sellCount}個）:`, components: [new ActionRowBuilder().addComponents(select)], ...EPH });
            }
            return doSellItem(interaction, itemName, sellCount, econ, u);
        }

        if (sub === 'shop') {
            // 価格設定してプレイヤーに販売
            const itemName = options.getString('item');
            const price = options.getInteger('price');
            const buyer = options.getUser('buyer');
            const item = u.inventory.find(i => i.name.toLowerCase() === itemName.toLowerCase());
            if (!item) return interaction.reply({ content: `❌ **${itemName}** をインベントリに持っていません。`, ...EPH });
            if (buyer) {
                if (buyer.id === user.id) return interaction.reply({ content: '❌ 自分自身には売れません。', ...EPH });
                if (buyer.bot) return interaction.reply({ content: '❌ Botには売れません。', ...EPH });
                const buyerData = getUser(econ, buyer.id, buyer);
                if (buyerData.balance < price) return interaction.reply({ content: `❌ **${buyer.username}** の残高不足。（必要: **${price.toLocaleString()}** 🪙 / 現在: **${buyerData.balance.toLocaleString()}** 🪙）`, ...EPH });
                const idx = u.inventory.findIndex(i => i.name.toLowerCase() === itemName.toLowerCase());
                u.inventory.splice(idx, 1);
                buyerData.balance -= price;
                u.balance += price;
                if (!buyerData.inventory) buyerData.inventory = [];
                buyerData.inventory.push({ ...item, boughtAt: Date.now() });
                save(ECON_FILE, econ);
                const embed = new EmbedBuilder().setTitle('🛒 取引完了').setColor(0x2ecc71)
                    .addFields(
                        { name: '売り手', value: user.username, inline: true },
                        { name: '買い手', value: buyer.username, inline: true },
                        { name: 'アイテム', value: itemName, inline: true },
                        { name: '価格', value: `**${price.toLocaleString()}** 🪙`, inline: true }
                    );
                return interaction.reply({ embeds: [embed], components: [delBtn()] });
            } else {
                const embed = new EmbedBuilder().setTitle('📢 出品告知').setColor(0xe67e22)
                    .setDescription(`<@${user.id}> が **${itemName}** を **${price.toLocaleString()}** 🪙 で出品中！\n購入希望者は本人に連絡してください。`);
                return interaction.reply({ embeds: [embed], components: [delBtn()] });
            }
        }
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

    // ==================== 誕生日 ====================
    if (commandName === 'birthday') {
        const sub = options.getSubcommand();
        const birthday = load(BIRTHDAY_FILE);
        if (!birthday[guildId]) birthday[guildId] = {};

        if (sub === 'set') {
            const date = options.getString('date').trim();
            if (!/^\d{1,2}\/\d{1,2}$/.test(date)) return interaction.reply({ content: '❌ 形式が違います。例: `03/20`', ...EPH });
            const [m, d] = date.split('/').map(Number);
            if (m < 1 || m > 12 || d < 1 || d > 31) return interaction.reply({ content: '❌ 無効な日付です。', ...EPH });
            birthday[guildId][user.id] = { month: m, day: d, username: user.username };
            save(BIRTHDAY_FILE, birthday);
            return interaction.reply({ content: `🎂 誕生日を **${m}月${d}日** に登録しました！`, ...EPH });
        }
        if (sub === 'check') {
            const target = options.getUser('user') || user;
            const data = birthday[guildId]?.[target.id];
            if (!data) return interaction.reply({ content: `❌ **${target.username}** の誕生日は登録されていません。`, ...EPH });
            return interaction.reply({ content: `🎂 **${target.username}** の誕生日は **${data.month}月${data.day}日** です！` });
        }
        if (sub === 'list') {
            const entries = Object.entries(birthday[guildId] || {});
            if (entries.length === 0) return interaction.reply({ content: '誕生日が登録されているユーザーはいません。', ...EPH });
            const sorted = entries.sort((a, b) => a[1].month * 100 + a[1].day - (b[1].month * 100 + b[1].day));
            const lines = sorted.map(([, d]) => `• **${d.username}** — ${d.month}月${d.day}日`).join('\n');
            const embed = new EmbedBuilder().setTitle('🎂 誕生日一覧').setDescription(lines).setColor(0xff9ff3).setTimestamp();
            return interaction.reply({ embeds: [embed], components: [delBtn()] });
        }
        if (sub === 'channel') {
            if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ 管理者のみ設定できます。', ...EPH });
            const ch = options.getChannel('channel');
            if (!birthday._settings) birthday._settings = {};
            if (!birthday._settings[guildId]) birthday._settings[guildId] = {};
            birthday._settings[guildId].channelId = ch.id;
            save(BIRTHDAY_FILE, birthday);
            return interaction.reply({ content: `✅ 誕生日通知チャンネルを <#${ch.id}> に設定しました。`, ...EPH });
        }
    }

    // ==================== 融資 ====================
    if (commandName === 'loan') {
        const sub = options.getSubcommand();
        const loans = load(LOAN_FILE);
        const corpData = load(CORP_FILE);
        if (!loans[guildId]) loans[guildId] = {};

        if (sub === 'request') {
            const corpName = options.getString('corp');
            const amount = options.getInteger('amount');
            const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
            if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
            if (c.ownerId === user.id) return interaction.reply({ content: '❌ 自分の会社には申請できません。', ...EPH });
            const limit = c.loanLimit || 0;
            if (limit <= 0) return interaction.reply({ content: `❌ **${c.name}** は融資を受け付けていません。`, ...EPH });
            if (amount > limit) return interaction.reply({ content: `❌ **${c.name}** の融資上限は **${limit.toLocaleString()}** 🪙です。`, ...EPH });
            // 既存申請チェック
            const existing = Object.values(loans[guildId]).find(l => l.userId === user.id && l.corpId === c.id && l.status === 'pending');
            if (existing) return interaction.reply({ content: '❌ すでに申請中の融資があります。', ...EPH });
            const id = `loan_${Date.now()}_${user.id}`;
            loans[guildId][id] = { id, userId: user.id, username: user.username, corpId: c.id, corpName: c.name, amount, status: 'pending', createdAt: Date.now() };
            save(LOAN_FILE, loans);
            return interaction.reply({ content: `✅ **${c.name}** に **${amount.toLocaleString()}** 🪙 の融資を申請しました。（申請ID: \`${id}\`）`, ...EPH });
        }
        if (sub === 'repay') {
            const amtInput = options.getString('amount').toLowerCase();
            const u = getUser(econ, user.id, user);
            const activeLoan = Object.values(loans[guildId]).find(l => l.userId === user.id && l.status === 'active');
            if (!activeLoan) return interaction.reply({ content: '❌ 返済すべき融資がありません。', ...EPH });
            let amount;
            if (amtInput === 'all') amount = activeLoan.remaining;
            else amount = parseInt(amtInput) || 0;
            if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
            if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
            amount = Math.min(amount, activeLoan.remaining);
            u.balance -= amount;
            const c = corpData[activeLoan.corpId];
            if (c) c.balance = (c.balance || 0) + amount;
            activeLoan.remaining = round3(activeLoan.remaining - amount);
            if (activeLoan.remaining <= 0) activeLoan.status = 'repaid';
            save(ECON_FILE, econ);
            save(CORP_FILE, corpData);
            save(LOAN_FILE, loans);
            return interaction.reply({ content: `✅ **${activeLoan.corpName}** に **${amount.toLocaleString()}** 🪙 を返済しました。残債: **${activeLoan.remaining.toLocaleString()}** 🪙`, ...EPH });
        }
        if (sub === 'list') {
            const corpName = options.getString('corp');
            const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
            if (owned.length === 0) return interaction.reply({ content: '❌ 会社を所有していません。', ...EPH });
            let c;
            if (corpName) c = owned.find(co => co.name.toLowerCase() === corpName.toLowerCase());
            else if (owned.length === 1) c = owned[0];
            else {
                const select = new StringSelectMenuBuilder().setCustomId('loan_list_select').setPlaceholder('会社を選択').addOptions(owned.map(co => ({ label: co.name, value: co.id })));
                return interaction.reply({ content: '会社を選択:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
            }
            if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
            const pending = Object.values(loans[guildId]).filter(l => l.corpId === c.id && l.status === 'pending');
            if (pending.length === 0) return interaction.reply({ content: '申請中の融資はありません。', ...EPH });
            const embed = new EmbedBuilder().setTitle(`📋 ${c.name} への融資申請`).setColor(0x3498db)
                .setDescription(pending.map(l => `**${l.username}** — **${l.amount.toLocaleString()}** 🪙\nID: \`${l.id}\``).join('\n\n'));
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }
        if (sub === 'approve' || sub === 'deny') {
            const id = options.getString('id');
            const l = loans[guildId]?.[id];
            if (!l || l.status !== 'pending') return interaction.reply({ content: '❌ 申請が見つかりません。', ...EPH });
            const c = corpData[l.corpId];
            if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
            if (sub === 'deny') {
                l.status = 'denied';
                save(LOAN_FILE, loans);
                return interaction.reply({ content: `❌ **${l.username}** の融資申請を却下しました。`, ...EPH });
            }
            if ((c.balance || 0) < l.amount) return interaction.reply({ content: `❌ 会社残高不足。現在: **${(c.balance||0).toLocaleString()}** 🪙`, ...EPH });
            const u = getUser(econ, l.userId, null);
            u.balance += l.amount;
            c.balance = (c.balance || 0) - l.amount;
            l.status = 'active';
            l.remaining = l.amount;
            l.approvedAt = Date.now();
            save(ECON_FILE, econ);
            save(CORP_FILE, corpData);
            save(LOAN_FILE, loans);
            return interaction.reply({ content: `✅ **${l.username}** への **${l.amount.toLocaleString()}** 🪙 の融資を承認しました。`, ...EPH });
        }
        if (sub === 'setlimit') {
            const amount = options.getInteger('amount');
            const corpName = options.getString('corp');
            const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
            if (owned.length === 0) return interaction.reply({ content: '❌ 会社を所有していません。', ...EPH });
            let c;
            if (corpName) c = owned.find(co => co.name.toLowerCase() === corpName.toLowerCase());
            else if (owned.length === 1) c = owned[0];
            else return interaction.reply({ content: '❌ 会社名を指定してください。', ...EPH });
            if (!c) return interaction.reply({ content: '❌ あなたの会社ではありません。', ...EPH });
            c.loanLimit = amount;
            save(CORP_FILE, corpData);
            return interaction.reply({ content: amount > 0 ? `✅ **${c.name}** の融資上限を **${amount.toLocaleString()}** 🪙 に設定しました。` : `✅ **${c.name}** の融資を無効にしました。`, ...EPH });
        }
    }

    // ==================== 会社間取引 ====================
    if (commandName === 'trade') {
        const sub = options.getSubcommand();
        const trades = load(TRADE_FILE);
        const corpData = load(CORP_FILE);
        if (!trades[guildId]) trades[guildId] = {};

        if (sub === 'offer') {
            const itemName = options.getString('item');
            const price = options.getInteger('price');
            const targetName = options.getString('target');
            const corpName = options.getString('corp');
            const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
            if (owned.length === 0) return interaction.reply({ content: '❌ 会社を所有していません。', ...EPH });
            let fromCorp;
            if (corpName) fromCorp = owned.find(c => c.name.toLowerCase() === corpName.toLowerCase());
            else if (owned.length === 1) fromCorp = owned[0];
            else return interaction.reply({ content: '❌ 会社名を指定してください（複数保有のため）。', ...EPH });
            if (!fromCorp) return interaction.reply({ content: '❌ あなたの会社ではありません。', ...EPH });
            const toCorp = Object.values(corpData).find(c => c.name.toLowerCase() === targetName.toLowerCase());
            if (!toCorp) return interaction.reply({ content: `❌ **${targetName}** という会社は存在しません。`, ...EPH });
            if (fromCorp.id === toCorp.id) return interaction.reply({ content: '❌ 自分の会社には取引できません。', ...EPH });
            // 在庫確認（会社の商品として持っているか）
            const item = fromCorp.items?.find(i => i.name.toLowerCase() === itemName.toLowerCase());
            if (!item) return interaction.reply({ content: `❌ **${fromCorp.name}** のストアに **${itemName}** がありません。`, ...EPH });
            const id = `trade_${Date.now()}_${user.id}`;
            trades[guildId][id] = { id, fromCorpId: fromCorp.id, fromCorpName: fromCorp.name, toCorpId: toCorp.id, toCorpName: toCorp.name, itemName, price, status: 'pending', createdAt: Date.now() };
            save(TRADE_FILE, trades);
            return interaction.reply({ content: `✅ **${toCorp.name}** に **${itemName}** を **${price.toLocaleString()}** 🪙 で取引オファーを送りました。（ID: \`${id}\`）`, ...EPH });
        }
        if (sub === 'list') {
            const corpName = options.getString('corp');
            const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
            if (owned.length === 0) return interaction.reply({ content: '❌ 会社を所有していません。', ...EPH });
            let c;
            if (corpName) c = owned.find(co => co.name.toLowerCase() === corpName.toLowerCase());
            else if (owned.length === 1) c = owned[0];
            else return interaction.reply({ content: '❌ 会社名を指定してください。', ...EPH });
            const incoming = Object.values(trades[guildId]).filter(t => t.toCorpId === c.id && t.status === 'pending');
            if (incoming.length === 0) return interaction.reply({ content: `**${c.name}** への取引オファーはありません。`, ...EPH });
            const embed = new EmbedBuilder().setTitle(`📦 ${c.name} への取引オファー`).setColor(0xe67e22)
                .setDescription(incoming.map(t => `**${t.fromCorpName}** → **${t.itemName}** — **${t.price.toLocaleString()}** 🪙\nID: \`${t.id}\``).join('\n\n'));
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }
        if (sub === 'accept' || sub === 'deny') {
            const id = options.getString('id');
            const t = trades[guildId]?.[id];
            if (!t || t.status !== 'pending') return interaction.reply({ content: '❌ オファーが見つかりません。', ...EPH });
            const toCorp = corpData[t.toCorpId];
            if (!toCorp || toCorp.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
            if (sub === 'deny') {
                t.status = 'denied';
                save(TRADE_FILE, trades);
                return interaction.reply({ content: `❌ **${t.fromCorpName}** からのオファーを却下しました。`, ...EPH });
            }
            const fromCorp = corpData[t.fromCorpId];
            if (!fromCorp) return interaction.reply({ content: '❌ 取引元の会社が見つかりません。', ...EPH });
            if ((toCorp.balance || 0) < t.price) return interaction.reply({ content: `❌ **${toCorp.name}** の残高不足。現在: **${(toCorp.balance||0).toLocaleString()}** 🪙`, ...EPH });
            const itemIdx = fromCorp.items?.findIndex(i => i.name.toLowerCase() === t.itemName.toLowerCase());
            if (itemIdx === undefined || itemIdx < 0) return interaction.reply({ content: '❌ 取引元の会社にアイテムがありません。', ...EPH });
            const item = fromCorp.items.splice(itemIdx, 1)[0];
            if (!toCorp.items) toCorp.items = [];
            toCorp.items.push(item);
            toCorp.balance = (toCorp.balance || 0) - t.price;
            fromCorp.balance = (fromCorp.balance || 0) + t.price;
            t.status = 'completed';
            save(CORP_FILE, corpData);
            save(TRADE_FILE, trades);
            const embed = new EmbedBuilder().setTitle('🤝 会社間取引完了').setColor(0x2ecc71)
                .addFields(
                    { name: '売り手', value: fromCorp.name, inline: true },
                    { name: '買い手', value: toCorp.name, inline: true },
                    { name: 'アイテム', value: t.itemName, inline: true },
                    { name: '価格', value: `**${t.price.toLocaleString()}** 🪙`, inline: true }
                );
            return interaction.reply({ embeds: [embed], components: [delBtn()] });
        }
    }

    // ==================== オークション ====================
    if (commandName === 'auction') {
        const sub = options.getSubcommand();
        const auctions = load(AUCTION_FILE);
        if (!auctions[guildId]) auctions[guildId] = {};

        if (sub === 'start') {
            const itemName = options.getString('item');
            const startPrice = options.getInteger('start_price');
            const minutes = options.getInteger('minutes');
            const u = getUser(econ, user.id, user);
            const itemIdx = u.inventory?.findIndex(i => i.name.toLowerCase() === itemName.toLowerCase());
            if (itemIdx === undefined || itemIdx < 0) return interaction.reply({ content: `❌ **${itemName}** をインベントリに持っていません。`, ...EPH });
            const item = u.inventory.splice(itemIdx, 1)[0];
            save(ECON_FILE, econ);
            const endAt = Date.now() + minutes * 60000;
            const id = `auc_${Date.now()}_${user.id}`;
            auctions[guildId][id] = { id, sellerId: user.id, sellerName: user.username, item, currentPrice: startPrice, startPrice, topBidderId: null, topBidderName: null, endAt, status: 'active' };
            save(AUCTION_FILE, auctions);
            const embed = new EmbedBuilder().setTitle('🔨 オークション開始！').setColor(0xf1c40f)
                .addFields(
                    { name: '出品者', value: user.username, inline: true },
                    { name: 'アイテム', value: itemName, inline: true },
                    { name: '開始価格', value: `**${startPrice.toLocaleString()}** 🪙`, inline: true },
                    { name: '終了時刻', value: `<t:${Math.floor(endAt / 1000)}:R>`, inline: true },
                    { name: 'ID', value: `\`${id}\``, inline: true }
                );
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`auction_bid_${id}`).setLabel('💰 入札する').setStyle(ButtonStyle.Success)
            );
            return interaction.reply({ embeds: [embed], components: [row] });
        }
        if (sub === 'list') {
            const active = Object.values(auctions[guildId]).filter(a => a.status === 'active' && a.endAt > Date.now());
            if (active.length === 0) return interaction.reply({ content: '現在開催中のオークションはありません。', ...EPH });
            const embed = new EmbedBuilder().setTitle('🔨 オークション一覧').setColor(0xf1c40f)
                .setDescription(active.map(a =>
                    `**${a.item.name}** — 現在価格: **${a.currentPrice.toLocaleString()}** 🪙\n出品者: ${a.sellerName}　終了: <t:${Math.floor(a.endAt / 1000)}:R>\n入札者: ${a.topBidderName || 'なし'}　ID: \`${a.id}\``
                ).join('\n\n'));
            const rows = active.slice(0, 4).map(a => new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`auction_bid_${a.id}`).setLabel(`💰 ${a.item.name} に入札`).setStyle(ButtonStyle.Success)
            ));
            return interaction.reply({ embeds: [embed], components: [...rows, delBtn()] });
        }
        if (sub === 'cancel') {
            const id = options.getString('id');
            const a = auctions[guildId]?.[id];
            if (!a || a.status !== 'active') return interaction.reply({ content: '❌ オークションが見つかりません。', ...EPH });
            if (a.sellerId !== user.id) return interaction.reply({ content: '❌ 自分のオークションのみキャンセルできます。', ...EPH });
            if (a.topBidderId) return interaction.reply({ content: '❌ 入札者がいるためキャンセルできません。', ...EPH });
            a.status = 'cancelled';
            const u = getUser(econ, user.id, user);
            if (!u.inventory) u.inventory = [];
            u.inventory.push(a.item);
            save(ECON_FILE, econ);
            save(AUCTION_FILE, auctions);
            return interaction.reply({ content: `✅ **${a.item.name}** のオークションをキャンセルし、アイテムを返却しました。`, ...EPH });
        }
    }

    if (commandName === 'econrank') {
        const sorted = Object.entries(econ)
            .map(([id, u]) => ({ id, balance: u.balance || 0 }))
            .filter(u => u.balance > 0)
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 10);
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
        const sub = options.getSubcommand();
        const corpData = load(CORP_FILE);

        if (sub === 'create') {
            const corpName = options.getString('name').trim();
            const corpDesc = options.getString('description').trim();
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
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'setting') {
            const corpName = options.getString('corp');
            const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
            if (owned.length === 0) return interaction.reply({ content: '❌ 会社を所有していません。`/corp create` で設立できます。', ...EPH });
            let c;
            if (corpName) {
                c = owned.find(c => c.name.toLowerCase() === corpName.toLowerCase());
                if (!c) return interaction.reply({ content: `❌ **${corpName}** はあなたの会社ではありません。他の会社は \`/corp view\` で閲覧できます。`, ...EPH });
            } else if (owned.length === 1) {
                c = owned[0];
            } else {
                const select = new StringSelectMenuBuilder().setCustomId('store_select_corp').setPlaceholder('管理する会社を選択')
                    .addOptions(owned.map(c => ({ label: c.name, description: `残高: ${(c.balance||0).toLocaleString()} 🪙 | 社員: ${(c.employees||[]).length}人`, value: c.id })));
                return interaction.reply({ content: '⚙️ 管理する会社を選択してください:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
            }
            return showStoreManage(interaction, c, corpData, user);
        }

        if (sub === 'view') {
            const corpName = options.getString('corp');
            const all = Object.values(corpData);
            if (all.length === 0) return interaction.reply({ content: '現在登録されている会社はありません。', ...EPH });
            let c;
            if (corpName) {
                c = all.find(c => c.name.toLowerCase() === corpName.toLowerCase());
                if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
            } else if (all.length === 1) {
                c = all[0];
            } else {
                const select = new StringSelectMenuBuilder().setCustomId('store_select_view').setPlaceholder('見たい会社を選択')
                    .addOptions(all.slice(0, 25).map(c => ({ label: c.name, description: `${c.ownerName} | 社員: ${(c.employees||[]).length}人 | 日給: ${c.salary||0}🪙`, value: c.id })));
                return interaction.reply({ content: '🏪 会社を選択してください:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
            }
            return showCorpInfo(interaction, c, econ, user);
        }

        if (sub === 'join') {
            const corpName = options.getString('corp');
            const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
            if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
            if (c.ownerId === user.id) return interaction.reply({ content: '❌ 自分の会社には就職できません。', ...EPH });
            if (!c.employees) c.employees = [];
            // 他の会社に既に就職しているか確認
            const currentJob = Object.values(corpData).find(co => (co.employees||[]).includes(user.id));
            if (currentJob) return interaction.reply({ content: `❌ すでに **${currentJob.name}** に就職しています。先に \`/corp leave\` で退職してください。`, ...EPH });
            if (c.employees.includes(user.id)) return interaction.reply({ content: '❌ すでにこの会社に就職しています。', ...EPH });
            c.employees.push(user.id);
            save(CORP_FILE, corpData);
            return interaction.reply({ content: `✅ **${c.name}** に就職しました！\n日給: **${(c.salary||0).toLocaleString()}** 🪙（毎日0時に支給）`, ...EPH });
        }

        if (sub === 'leave') {
            const currentJob = Object.values(corpData).find(c => (c.employees||[]).includes(user.id));
            if (!currentJob) return interaction.reply({ content: '❌ 現在どの会社にも就職していません。', ...EPH });
            currentJob.employees = currentJob.employees.filter(id => id !== user.id);
            save(CORP_FILE, corpData);
            return interaction.reply({ content: `✅ **${currentJob.name}** を退職しました。`, ...EPH });
        }

        if (sub === 'kick') {
            const target = options.getUser('user');
            const corpName = options.getString('corp');
            const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
            if (owned.length === 0) return interaction.reply({ content: '❌ 会社を所有していません。', ...EPH });
            let c;
            if (corpName) {
                c = owned.find(c => c.name.toLowerCase() === corpName.toLowerCase());
                if (!c) return interaction.reply({ content: '❌ あなたの会社ではありません。', ...EPH });
            } else if (owned.length === 1) {
                c = owned[0];
            } else {
                return interaction.reply({ content: '❌ 会社名を指定してください。', ...EPH });
            }
            if (!(c.employees||[]).includes(target.id)) return interaction.reply({ content: `❌ **${target.username}** はこの会社の社員ではありません。`, ...EPH });
            c.employees = c.employees.filter(id => id !== target.id);
            save(CORP_FILE, corpData);
            return interaction.reply({ content: `✅ **${target.username}** を **${c.name}** から解雇しました。`, ...EPH });
        }

        if (sub === 'salary') {
            const amtInput = options.getString('amount').trim();
            const amount = parseInt(amtInput) || 0;
            if (amount < 0) return interaction.reply({ content: '❌ 0以上の金額を入力してください。', ...EPH });
            const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
            if (owned.length === 0) return interaction.reply({ content: '❌ 会社を所有していません。', ...EPH });
            const corpName = options.getString('corp');
            let c;
            if (corpName) {
                c = owned.find(c => c.name.toLowerCase() === corpName.toLowerCase());
                if (!c) return interaction.reply({ content: '❌ あなたの会社ではありません。', ...EPH });
            } else if (owned.length === 1) {
                c = owned[0];
            } else {
                return interaction.reply({ content: '❌ 会社名を指定してください。', ...EPH });
            }
            c.salary = amount;
            save(CORP_FILE, corpData);
            return interaction.reply({ content: `✅ **${c.name}** の日給を **${amount.toLocaleString()}** 🪙 に設定しました。\n社員 **${(c.employees||[]).length}** 人に毎日0時（JST）に支給されます。`, ...EPH });
        }

        if (sub === 'deposit') {
            const corpName = options.getString('corp');
            const amtInput = (options.getString('amount') || '0').trim().toLowerCase();
            const u = getUser(econ, user.id, user);
            let c;
            if (corpName) {
                c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
                if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
            } else {
                const owned = Object.values(corpData).filter(co => co.ownerId === user.id);
                if (owned.length === 0) return interaction.reply({ content: '❌ 会社を所有していません。', ...EPH });
                if (owned.length === 1) { c = owned[0]; }
                else {
                    const select = new StringSelectMenuBuilder().setCustomId(`corp_deposit_select_${amtInput}`).setPlaceholder('入金する会社を選択')
                        .addOptions(owned.map(co => ({ label: co.name, description: `会社残高: ${(co.balance || 0).toLocaleString()} 🪙`, value: co.id })));
                    return interaction.reply({ content: '入金する会社を選択してください:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
                }
            }
            let amount;
            if (amtInput === 'all') amount = u.balance;
            else if (amtInput === 'half') amount = Math.floor(u.balance / 2);
            else amount = parseInt(amtInput) || 0;
            if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
            if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
            u.balance -= amount;
            c.balance = (c.balance || 0) + amount;
            save(ECON_FILE, econ);
            save(CORP_FILE, corpData);
            return interaction.reply({ content: `✅ **${c.name}** に **${amount.toLocaleString()}** ${CURRENCY} を入金しました。\n会社残高: **${c.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        }
    }

    // ==================== /bank ====================
    if (commandName === 'bank') {
        const u = getUser(econ, user.id, user);
        return interaction.reply(buildBankPanel(u));
    }

    // ==================== /stock ====================
    // ==================== /crypto ====================
    if (commandName === 'crypto') {
        const sub = options.getSubcommand();
        const CRYPTO_FILE = path.join(__dirname, 'data', 'crypto.json');
        const cryptoData = load(CRYPTO_FILE);

        if (sub === 'create') {
            const name = options.getString('name').trim();
            const symbol = options.getString('symbol').trim().toUpperCase();
            const owned = Object.values(cryptoData).filter(c => c.ownerId === user.id);
            if (owned.length >= 1) return interaction.reply({ content: '❌ 仮想通貨は1人1枚までです。', ...EPH });
            if (Object.values(cryptoData).some(c => c.symbol === symbol)) return interaction.reply({ content: `❌ シンボル **${symbol}** はすでに使用されています。`, ...EPH });
            const coinId = `coin_${Date.now()}_${user.id}`;
            const TOTAL_SUPPLY = 100000000; // 1億枚
            cryptoData[coinId] = {
                id: coinId, name, symbol,
                ownerId: user.id, ownerName: user.username,
                createdAt: Date.now(),
                price: 0.005,
                totalSupply: TOTAL_SUPPLY,
                availableSupply: TOTAL_SUPPLY,
                history: [0.005],
                marketCap: round3(0.005 * TOTAL_SUPPLY),
            };
            save(CRYPTO_FILE, cryptoData);
            const embed = new EmbedBuilder().setTitle('🪙 仮想通貨発行完了').setColor(0xf1c40f)
                .addFields(
                    { name: '通貨名', value: name, inline: true },
                    { name: 'シンボル', value: symbol, inline: true },
                    { name: '発行枚数', value: `${TOTAL_SUPPLY.toLocaleString()} 枚`, inline: true },
                    { name: '初期価格', value: `0.005 🪙`, inline: true }
                ).setTimestamp();
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'list') {
            const coins = Object.values(cryptoData);
            if (coins.length === 0) return interaction.reply({ content: '現在発行されている仮想通貨はありません。`/crypto create` で作れます。', ...EPH });
            const embed = new EmbedBuilder().setTitle('💹 仮想通貨市場').setColor(0xf1c40f)
                .setDescription(coins.map((c, i) => {
                    const prev = c.history?.slice(-2)[0] || c.price;
                    const arrow = c.price > prev ? '📈' : c.price < prev ? '📉' : '➡️';
                    return `${arrow} **${c.name}** (${c.symbol})\n価格: **${fmtPrice(c.price)}** 🪙　時価総額: **${fmtPrice(round3(c.price * c.totalSupply))}** 🪙`;
                }).join('\n\n'))
                .setFooter({ text: '/crypto view [symbol] で詳細 | 手数料2%' });
            return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
        }

        if (sub === 'view') {
            const sym = options.getString('symbol')?.toUpperCase();
            if (!sym) {
                const coins = Object.values(cryptoData);
                if (coins.length === 0) return interaction.reply({ content: '仮想通貨がまだありません。', ...EPH });
                if (coins.length === 1) return showCryptoDetail(interaction, coins[0], econ, user, CRYPTO_FILE);
                const select = new StringSelectMenuBuilder().setCustomId('crypto_view_select').setPlaceholder('通貨を選択')
                    .addOptions(coins.map(c => ({ label: `${c.name} (${c.symbol})`, description: `価格: ${fmtPrice(c.price)} 🪙`, value: c.id })));
                return interaction.reply({ content: '💹 通貨を選択:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
            }
            const coin = Object.values(cryptoData).find(c => c.symbol === sym);
            if (!coin) return interaction.reply({ content: `❌ **${sym}** という通貨は存在しません。`, ...EPH });
            return showCryptoDetail(interaction, coin, econ, user, CRYPTO_FILE);
        }

        if (sub === 'buy') {
            const sym = options.getString('symbol')?.toUpperCase();
            const amtInput = options.getString('amount').trim().toLowerCase();
            const u = getUser(econ, user.id, user);
            if (!sym) {
                const coins = Object.values(cryptoData).filter(c => c.availableSupply > 0);
                if (coins.length === 0) return interaction.reply({ content: '現在購入できる仮想通貨はありません。', ...EPH });
                if (coins.length === 1) return doBuyCrypto(interaction, coins[0], amtInput, econ, u, cryptoData, CRYPTO_FILE);
                const select = new StringSelectMenuBuilder().setCustomId(`crypto_buyselect_${amtInput}`).setPlaceholder('購入する通貨を選択')
                    .addOptions(coins.map(c => ({ label: `${c.name} (${c.symbol})`, description: `価格: ${fmtPrice(c.price)} 🪙　残: ${c.availableSupply.toLocaleString()}枚`, value: c.id })));
                return interaction.reply({ content: '💹 購入する通貨を選択:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
            }
            const coin = Object.values(cryptoData).find(c => c.symbol === sym);
            if (!coin) return interaction.reply({ content: `❌ **${sym}** は存在しません。`, ...EPH });
            return doBuyCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE);
        }

        if (sub === 'sell') {
            const sym = options.getString('symbol')?.toUpperCase();
            const amtInput = options.getString('amount').trim().toLowerCase();
            const u = getUser(econ, user.id, user);
            if (!sym) {
                const heldCoins = Object.values(cryptoData).filter(c => (u.crypto || {})[c.id] > 0);
                if (heldCoins.length === 0) return interaction.reply({ content: '保有している仮想通貨がありません。', ...EPH });
                if (heldCoins.length === 1) return doSellCrypto(interaction, heldCoins[0], amtInput, econ, u, cryptoData, CRYPTO_FILE);
                const select = new StringSelectMenuBuilder().setCustomId(`crypto_sellselect_${amtInput}`).setPlaceholder('売却する通貨を選択')
                    .addOptions(heldCoins.map(c => ({ label: `${c.name} (${c.symbol})`, description: `価格: ${fmtPrice(c.price)} 🪙　保有: ${(u.crypto || {})[c.id].toLocaleString()}枚`, value: c.id })));
                return interaction.reply({ content: '💹 売却する通貨を選択:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
            }
            const coin = Object.values(cryptoData).find(c => c.symbol === sym);
            if (!coin) return interaction.reply({ content: `❌ **${sym}** は存在しません。`, ...EPH });
            return doSellCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE);
        }
    }

    if (commandName === 'stock') {
        const corpData = load(CORP_FILE);
        const corpName = options.getString('corp');
        if (!corpName) {
            const stockCorps = Object.values(corpData).filter(c => c.stock);
            const allCorps = Object.values(corpData);
            if (allCorps.length === 0) return interaction.reply({ content: '現在登録されている会社はありません。', ...EPH });
            if (stockCorps.length === 0) {
                // 株未発行の一覧を表示
                const embed = new EmbedBuilder().setTitle('📊 株式市場').setColor(0x3498db)
                    .setDescription(allCorps.map((c, i) => `**${i + 1}. ${c.name}**\n${c.stock ? `株価: **${c.stock.price.toLocaleString()}** ${CURRENCY}` : '株式未発行'}`).join('\n'))
                    .setFooter({ text: 'まだ株式を発行している会社はありません' });
                return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
            }
            if (stockCorps.length === 1) {
                // 1社しかなければ直接表示
                const c = stockCorps[0];
                return showStockDetail(interaction, c, econ, user);
            }
            // セレクトメニュー
            const select = new StringSelectMenuBuilder()
                .setCustomId('stock_select_view')
                .setPlaceholder('会社を選択')
                .addOptions(stockCorps.map(c => {
                    const prev = c.stock.history?.slice(-2)[0] || c.stock.price;
                    const arrow = c.stock.price > prev ? '📈' : c.stock.price < prev ? '📉' : '➡️';
                    return { label: `${arrow} ${c.name}`, description: `株価: ${c.stock.price.toLocaleString()} 🪙`, value: c.id };
                }));
            return interaction.reply({ content: '📊 **株式市場** — 会社を選択してください', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
        }
        const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
        if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
        if (!c.stock) return interaction.reply({ content: `❌ **${c.name}** はまだ株式を発行していません。`, ...EPH });
        return showStockDetail(interaction, c, econ, user);
    }

    // ==================== /buystock ====================
    if (commandName === 'buystock') {
        const corpData = load(CORP_FILE);
        const corpName = options.getString('corp');
        const amtInput = (options.getString('amount') || '1').trim().toLowerCase();
        const u = getUser(econ, user.id, user);
        const resolveAmount = (c) => {
            if (amtInput === 'all') return Math.min(Math.floor(u.balance / c.stock.price), c.stock.availableShares);
            return parseInt(amtInput) || 1;
        };
        if (!corpName) {
            const stockCorps = Object.values(corpData).filter(c => c.stock && c.stock.availableShares > 0);
            if (stockCorps.length === 0) return interaction.reply({ content: '📊 現在購入できる株式はありません。', ...EPH });
            if (stockCorps.length === 1) { const amt = resolveAmount(stockCorps[0]); return doBuyStock(interaction, stockCorps[0], amt, econ, user, corpData); }
            const select = new StringSelectMenuBuilder()
                .setCustomId(`stock_buyselect_${amtInput}`)
                .setPlaceholder('購入する会社を選択')
                .addOptions(stockCorps.map(c => ({ label: c.name, description: `株価: ${c.stock.price.toLocaleString()} 🪙　残: ${c.stock.availableShares}株`, value: c.id })));
            return interaction.reply({ content: `📈 購入する会社を選択してください`, components: [new ActionRowBuilder().addComponents(select)], ...EPH });
        }
        const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
        if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
        if (!c.stock) return interaction.reply({ content: `❌ **${c.name}** はまだ株式を発行していません。`, ...EPH });
        const amt = resolveAmount(c);
        if (amt <= 0) return interaction.reply({ content: '❌ 購入できる株数がありません。残高不足か在庫不足です。', ...EPH });
        return doBuyStock(interaction, c, amt, econ, user, corpData);
    }

    if (commandName === 'sellstock') {
        const corpData = load(CORP_FILE);
        const corpName = options.getString('corp');
        const amount = options.getInteger('amount');
        const u = getUser(econ, user.id, user);
        if (!corpName) {
            const heldCorps = Object.values(corpData).filter(c => c.stock && (u.stocks || {})[c.id] > 0);
            if (heldCorps.length === 0) return interaction.reply({ content: '📊 保有している株がありません。', ...EPH });
            if (heldCorps.length === 1) return doSellStock(interaction, heldCorps[0], amount, econ, u, corpData);
            const select = new StringSelectMenuBuilder()
                .setCustomId(`stock_sellselect_${amount}`)
                .setPlaceholder('売却する会社を選択')
                .addOptions(heldCorps.map(c => ({ label: c.name, description: `株価: ${c.stock.price.toLocaleString()} 🪙　保有: ${(u.stocks || {})[c.id]}株`, value: c.id })));
            return interaction.reply({ content: `📉 **${amount}株** 売却する会社を選択してください`, components: [new ActionRowBuilder().addComponents(select)], ...EPH });
        }
        const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
        if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
        if (!c.stock) return interaction.reply({ content: `❌ **${c.name}** は株式を発行していません。`, ...EPH });
        return doSellStock(interaction, c, amount, econ, u, corpData);
    }
}

async function doDustItem(interaction, itemName, dustCount, econ, u) {
    const indices = [];
    for (let i = 0; i < u.inventory.length && indices.length < dustCount; i++) {
        if (u.inventory[i].name.toLowerCase() === itemName.toLowerCase()) indices.push(i);
    }
    if (indices.length === 0) return interaction.reply({ content: `❌ **${itemName}** をインベントリに持っていません。`, ...EPH });
    if (indices.length < dustCount) return interaction.reply({ content: `❌ **${itemName}** は ${indices.length} 個しか持っていません。`, ...EPH });
    for (const i of [...indices].reverse()) u.inventory.splice(i, 1);
    save(ECON_FILE, econ);
    return interaction.reply({ content: `🗑️ **${itemName}** × ${dustCount} を捨てました。`, ...EPH });
}

async function doBuyItem(interaction, itemName, amount, econ, user, guild, shop) {
    const item = Object.values(shop || load(SHOP_FILE)).find(i => i.name.toLowerCase() === itemName.toLowerCase());
    if (!item) return interaction.reply({ content: `❌ **${itemName}** は存在しません。`, ...EPH });
    const u = getUser(econ, user.id, user);
    const total = item.price * amount;
    if (u.balance < total) return interaction.reply({ content: `❌ 残高不足。必要: **${total.toLocaleString()}** / 現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
    u.balance -= total;
    if (!u.inventory) u.inventory = [];
    for (let i = 0; i < amount; i++) {
        u.inventory.push({ name: item.name, boughtAt: Date.now(), sellPrice: Math.floor(item.price * 0.5) });
    }
    save(ECON_FILE, econ);
    if (item.roleId && guild) {
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (member) await member.roles.add(item.roleId).catch(() => {});
    }
    const embed = new EmbedBuilder().setTitle('✅ 購入完了').setColor(0x57f287)
        .setDescription(`**${item.name}** × ${amount} を購入しました！\n合計: **${total.toLocaleString()}** 🪙\n残高: **${u.balance.toLocaleString()}** 🪙${item.roleId ? '\n🏷️ ロールが付与されました。' : ''}`).setTimestamp();
    return interaction.reply({ embeds: [embed], components: [delBtn()], ...EPH });
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
    return interaction.reply({ content: `✅ **${itemName}** × ${sellCount} を **${totalPrice.toLocaleString()}** 🪙 で売却しました。\n残高: **${u.balance.toLocaleString()}** 🪙`, components: [delBtn()], ...EPH });
}

async function showStockDetail(interaction, c, econ, user) {
    const u = getUser(econ, user.id, user);
    const price = c.stock.price;
    const history = c.stock.history || [];
    const userShares = (u.stocks || {})[c.id] || 0;
    const prev = history[history.length - 2] || price;
    const accentColor = price > prev ? 0x57f287 : price < prev ? 0xff4757 : 0x3498db;
    const { attachment, imageUrl } = await makeChart(c.stock?.ohlc || history, `${c.name} 株式`, price > prev ? '#26a69a' : price < prev ? '#ef5350' : '#5865f2');
    const embed = new EmbedBuilder()
        .setTitle(`📈 ${c.name} 株式情報`)
        .setColor(accentColor)
        .addFields(
            { name: '現在株価', value: `**${fmtPrice(price)}** 🪙`, inline: true },
            { name: '発行株数', value: `**${c.stock.totalShares.toLocaleString()}** 株`, inline: true },
            { name: '保有株数', value: `**${userShares}** 株`, inline: true },
            { name: '購入可能', value: `**${c.stock.availableShares}** 株`, inline: true },
            { name: '時価総額', value: `**${fmtPrice(round3(price * c.stock.totalShares))}** 🪙`, inline: true },
            { name: '手数料', value: '売買各2%', inline: true },
            { name: '配当プール', value: `**${fmtPrice(c.stock.feePool || 0)}** 🪙`, inline: true }
        );
    if (imageUrl) embed.setImage(imageUrl);
    else {
        const chartData = c.stock.ohlc ? c.stock.ohlc.map(d => d.c) : history;
        const chartStr = buildStockChart(chartData);
        if (chartStr) embed.setDescription(`\`\`\`\n${chartStr}\n\`\`\``);
        else embed.setDescription('価格履歴なし（しばらくお待ちください）');
    }
    const publicUrl = process.env.PUBLIC_URL || '';
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`stock_sell_${c.id}`).setLabel('📉 売る').setStyle(ButtonStyle.Danger).setDisabled(userShares <= 0),
        new ButtonBuilder().setCustomId(`stock_refresh_${c.id}`).setLabel('🔄 更新').setStyle(ButtonStyle.Secondary),
        ...(publicUrl ? [new ButtonBuilder().setLabel('📊 ロウソク足').setStyle(ButtonStyle.Link).setURL(`${publicUrl}/chart/stock/${c.id}`)] : [])
    );
    const files = attachment ? [attachment] : [];
    return interaction.reply({ embeds: [embed], components: [row, delBtn()], files, ...EPH });
}

async function showStockDetailUpdate(interaction, c, econ, user) {
    const u = getUser(econ, user.id, user);
    const price = c.stock.price;
    const history = c.stock.history || [];
    const userShares = (u.stocks || {})[c.id] || 0;
    const prev = history[history.length - 2] || price;
    const accentColor = price > prev ? 0x57f287 : price < prev ? 0xff4757 : 0x3498db;
    const { attachment, imageUrl } = await makeChart(c.stock?.ohlc || history, `${c.name} 株式`, price > prev ? '#26a69a' : price < prev ? '#ef5350' : '#5865f2');
    const embed = new EmbedBuilder()
        .setTitle(`📈 ${c.name} 株式情報`)
        .setColor(accentColor)
        .addFields(
            { name: '現在株価', value: `**${fmtPrice(price)}** 🪙`, inline: true },
            { name: '発行株数', value: `**${c.stock.totalShares.toLocaleString()}** 株`, inline: true },
            { name: '保有株数', value: `**${userShares}** 株`, inline: true },
            { name: '購入可能', value: `**${c.stock.availableShares}** 株`, inline: true },
            { name: '時価総額', value: `**${fmtPrice(round3(price * c.stock.totalShares))}** 🪙`, inline: true },
            { name: '手数料', value: '売買各2%', inline: true },
            { name: '配当プール', value: `**${fmtPrice(c.stock.feePool || 0)}** 🪙`, inline: true }
        );
    if (imageUrl) embed.setImage(imageUrl);
    else {
        const chartData = c.stock.ohlc ? c.stock.ohlc.map(d => d.c) : history;
        const chartStr = buildStockChart(chartData);
        if (chartStr) embed.setDescription(`\`\`\`\n${chartStr}\n\`\`\``);
        else embed.setDescription('価格履歴なし（しばらくお待ちください）');
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`stock_buy_${c.id}`).setLabel('📈 買う').setStyle(ButtonStyle.Success).setDisabled(c.stock.availableShares <= 0),
        new ButtonBuilder().setCustomId(`stock_sell_${c.id}`).setLabel('📉 売る').setStyle(ButtonStyle.Danger).setDisabled(userShares <= 0),
        new ButtonBuilder().setCustomId(`stock_refresh_${c.id}`).setLabel('🔄 更新').setStyle(ButtonStyle.Secondary),
        ...((process.env.PUBLIC_URL) ? [new ButtonBuilder().setLabel('📊 ロウソク足').setStyle(ButtonStyle.Link).setURL(`${process.env.PUBLIC_URL}/chart/stock/${c.id}`)] : [])
    );
    const files = attachment ? [attachment] : [];
    return interaction.update({ embeds: [embed], components: [row, delBtn()], files });
}

async function doBuyStock(interaction, c, amount, econ, user, corpData) {
    // 自己売買防止
    if (c.ownerId === user.id) return interaction.reply({ content: '❌ 自分の会社の株は購入できません。', ...EPH });
    const u = getUser(econ, user.id, user);
    const price = c.stock.price;
    // 1回の購入上限: 残高の30% or 発行総数の10% のうち少ない方
    const maxByBalance = Math.floor(u.balance * 0.3 / (price * (1 + FEE_RATE)));
    const maxBySupply = Math.floor(c.stock.totalShares * 0.1);
    const maxPerTx = Math.max(1, Math.min(maxByBalance, maxBySupply));
    if (amount > maxPerTx) return interaction.reply({ content: `❌ 1回の購入上限は **${maxPerTx.toLocaleString()}** 株です（残高の30%・発行数の10%制限）。`, ...EPH });
    const subtotal = round3(price * amount);
    const fee = round3(subtotal * FEE_RATE);
    const total = round3(subtotal + fee);
    if (u.balance < total) return interaction.reply({ content: `❌ 残高不足。必要: **${fmtPrice(total)}** 🪙 (手数料${fmtPrice(fee)}含)\n現在: **${fmtPrice(u.balance)}** 🪙`, ...EPH });
    if (c.stock.availableShares < amount) return interaction.reply({ content: `❌ 購入可能株数が不足。現在: **${c.stock.availableShares}** 株`, ...EPH });
    u.balance = round3(u.balance - total);
    if (!u.stocks) u.stocks = {};
    u.stocks[c.id] = (u.stocks[c.id] || 0) + amount;
    c.stock.availableShares -= amount;
    // 手数料の50%を配当プールに積立（自己売買ループ防止のため購入代金は会社残高に入れない）
    c.stock.feePool = round3((c.stock.feePool || 0) + fee * 0.5);
    const ratio = 1 + 0.01 * Math.min(amount, 10);
    c.stock.price = round3(price * ratio);
    if (!c.stock.history) c.stock.history = [];
    c.stock.history.push(c.stock.price);
    if (c.stock.history.length > 1440) c.stock.history.shift();
    save(ECON_FILE, econ);
    save(CORP_FILE, corpData);
    return interaction.reply({ content: `✅ **${c.name}** の株を **${amount}** 株 購入！\n小計: ${fmtPrice(subtotal)} 🪙 + 手数料: ${fmtPrice(fee)} 🪙\n現在株価: **${fmtPrice(c.stock.price)}** 🪙`, components: [delBtn()], ...EPH });
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
    // 売却手数料の50%も配当プールに積立
    c.stock.feePool = round3((c.stock.feePool || 0) + fee * 0.5);
    // 供給による価格下落（小数点対応）
    const ratio = 1 - 0.008 * Math.min(amount, 10);
    c.stock.price = round3(Math.max(0.001, price * ratio));
    if (!c.stock.history) c.stock.history = [];
    c.stock.history.push(c.stock.price);
    if (c.stock.history.length > 1440) c.stock.history.shift();
    save(ECON_FILE, econ);
    save(CORP_FILE, corpData);
    return interaction.reply({ content: `✅ **${c.name}** の株を **${amount}** 株 売却！\n小計: ${fmtPrice(subtotal)} 🪙 - 手数料: ${fmtPrice(fee)} 🪙 = **${fmtPrice(total)}** 🪙\n現在株価: **${fmtPrice(c.stock.price)}** 🪙`, components: [delBtn()], ...EPH });
}

async function showCorpInfo(interaction, c, econ, user) {
    const employees = c.employees || [];
    const salary = c.salary || 0;
    const dailyCost = salary * employees.length;
    const isEmployee = employees.includes(user.id);
    const isOwner = c.ownerId === user.id;

    // 社員名を取得
    let empNames = '（なし）';
    if (employees.length > 0) {
        const names = employees.map(id => {
            const u = econ[id];
            return u?.username ? `• ${u.username}` : `• ID:${id}`;
        });
        empNames = names.join('\n');
    }

    const embed = new EmbedBuilder()
        .setTitle(`🏢 ${c.name}`)
        .setDescription(c.description)
        .setColor(0xe67e22)
        .addFields(
            { name: 'オーナー', value: c.ownerName, inline: true },
            { name: '日給', value: `**${salary.toLocaleString()}** 🪙`, inline: true },
            { name: '社員数', value: `**${employees.length}** 人`, inline: true },
            { name: '会社残高', value: `**${(c.balance||0).toLocaleString()}** 🪙`, inline: true },
            { name: '日次人件費', value: `**${dailyCost.toLocaleString()}** 🪙`, inline: true },
            { name: '株式', value: c.stock ? `株価: **${fmtPrice(c.stock.price)}** 🪙` : '未発行', inline: true },
            { name: `社員一覧 (${employees.length}人)`, value: empNames, inline: false }
        );

    if (c.items && c.items.length > 0) {
        embed.addFields({ name: '📦 商品', value: c.items.map(i => `• **${i.name}** — ${i.price.toLocaleString()} 🪙`).join('\n'), inline: false });
    }

    const rows = [delBtn()];
    if (!isOwner && !isEmployee) {
        rows.unshift(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`corp_join_${c.id}`).setLabel('🏢 就職する').setStyle(ButtonStyle.Success)
        ));
    }
    return interaction.reply({ embeds: [embed], components: rows });
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
    return interaction.reply({ embeds: [embed], components: rows, ...EPH });
}

async function showCryptoDetail(interaction, coin, econ, user, CRYPTO_FILE, isUpdate = false) {
    const u = getUser(econ, user.id, user);
    const price = coin.price;
    const history = coin.history || [];
    const held = (u.crypto || {})[coin.id] || 0;
    const prev = history[history.length - 2] || price;
    const accentColor = price > prev ? 0x57f287 : price < prev ? 0xff4757 : 0xf1c40f;
    const { attachment, imageUrl } = await makeChart(coin.ohlc || history, `${coin.name} (${coin.symbol})`, price > prev ? '#26a69a' : price < prev ? '#ef5350' : '#f1c40f');
    const embed = new EmbedBuilder()
        .setTitle(`💹 ${coin.name} (${coin.symbol})`)
        .setColor(accentColor)
        .addFields(
            { name: '現在価格', value: `**${fmtPrice(price)}** 🪙`, inline: true },
            { name: '発行枚数', value: `${coin.totalSupply.toLocaleString()}`, inline: true },
            { name: '保有枚数', value: `${held.toLocaleString()}`, inline: true },
            { name: '購入可能', value: `${coin.availableSupply.toLocaleString()}`, inline: true },
            { name: '時価総額', value: `**${fmtPrice(round3(price * coin.totalSupply))}** 🪙`, inline: true },
            { name: '手数料', value: '売買各2%', inline: true }
        );
    if (imageUrl) embed.setImage(imageUrl);
    else {
        const chartData = coin.ohlc ? coin.ohlc.map(d => d.c) : history;
        const chartStr = buildStockChart(chartData);
        if (chartStr) embed.setDescription(`\`\`\`\n${chartStr}\n\`\`\``);
        else embed.setDescription('価格履歴なし（しばらくお待ちください）');
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`crypto_buy_${coin.id}`).setLabel('💰 買う').setStyle(ButtonStyle.Success).setDisabled(coin.availableSupply <= 0),
        new ButtonBuilder().setCustomId(`crypto_sell_${coin.id}`).setLabel('💸 売る').setStyle(ButtonStyle.Danger).setDisabled(held <= 0),
        new ButtonBuilder().setCustomId(`crypto_refresh_${coin.id}`).setLabel('🔄 更新').setStyle(ButtonStyle.Secondary),
        ...((process.env.PUBLIC_URL) ? [new ButtonBuilder().setLabel('📊 ロウソク足').setStyle(ButtonStyle.Link).setURL(`${process.env.PUBLIC_URL}/chart/crypto/${coin.symbol}`)] : [])
    );
    const files = attachment ? [attachment] : [];
    if (isUpdate) return interaction.update({ embeds: [embed], components: [row, delBtn()], files });
    return interaction.reply({ embeds: [embed], components: [row, delBtn()], files, ...EPH });
}

async function doBuyCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE) {
    const maxPerTx = round3(coin.totalSupply * 0.05); // 1回の上限: 発行総数の5%
    let amount;
    if (amtInput === 'all') {
        const budget = round3(u.balance * 0.1);
        amount = round3(Math.min(budget / (coin.price * (1 + FEE_RATE)), coin.availableSupply, maxPerTx));
    } else {
        amount = round3(parseFloat(amtInput) || 0); // 小数点対応
    }
    if (amount <= 0) return interaction.reply({ content: '❌ 有効な枚数を入力してください。（小数点可: 例 0.5）', ...EPH });
    if (amount > maxPerTx) return interaction.reply({ content: `❌ 1回の購入上限は **${fmtPrice(maxPerTx)}** 枚です（発行総数の5%）。`, ...EPH });
    if (coin.availableSupply < amount) return interaction.reply({ content: `❌ 購入可能枚数不足。現在: **${fmtPrice(coin.availableSupply)}** 枚`, ...EPH });
    const subtotal = round3(coin.price * amount);
    const fee = round3(subtotal * FEE_RATE);
    const total = round3(subtotal + fee);
    if (u.balance < total) return interaction.reply({ content: `❌ 残高不足。必要: **${fmtPrice(total)}** 🪙 (手数料${fmtPrice(fee)}含)\n現在: **${fmtPrice(u.balance)}** 🪙`, ...EPH });
    u.balance = round3(u.balance - total);
    if (!u.crypto) u.crypto = {};
    u.crypto[coin.id] = (u.crypto[coin.id] || 0) + amount;
    coin.availableSupply -= amount;
    const ratio = 1 + 0.02 * Math.min(Math.log10(amount + 1), 5);
    coin.price = round3(Math.max(0.001, coin.price * ratio));
    if (!coin.history) coin.history = [];
    coin.history.push(coin.price);
    if (coin.history.length > 60) coin.history.shift();
    save(ECON_FILE, econ);
    save(CRYPTO_FILE, cryptoData);
    return interaction.reply({ content: `✅ **${coin.name}** を **${amount.toLocaleString()}** 枚 購入！\n小計: ${fmtPrice(subtotal)} 🪙 + 手数料: ${fmtPrice(fee)} 🪙\n現在価格: **${fmtPrice(coin.price)}** 🪙`, components: [delBtn()], ...EPH });
}

async function doSellCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE) {
    const held = round3((u.crypto || {})[coin.id] || 0);
    let amount;
    if (amtInput === 'all') amount = held;
    else amount = round3(parseFloat(amtInput) || 0);
    if (amount <= 0) return interaction.reply({ content: '❌ 有効な枚数を入力してください。（小数点可: 例 0.5）', ...EPH });
    if (held < amount) return interaction.reply({ content: `❌ 保有枚数不足。現在: **${fmtPrice(held)}** 枚`, ...EPH });
    const subtotal = round3(coin.price * amount);
    const fee = round3(subtotal * FEE_RATE);
    const total = round3(subtotal - fee);
    u.balance = round3(u.balance + total);
    u.crypto[coin.id] = round3(held - amount);
    coin.availableSupply += amount;
    const ratio = 1 - 0.015 * Math.min(Math.log10(amount + 1), 5); // 最大-7.5%
    coin.price = round3(Math.max(0.001, coin.price * ratio));
    if (!coin.history) coin.history = [];
    coin.history.push(coin.price);
    if (coin.history.length > 60) coin.history.shift();
    save(ECON_FILE, econ);
    save(CRYPTO_FILE, cryptoData);
    return interaction.reply({ content: `✅ **${coin.name}** を **${amount.toLocaleString()}** 枚 売却！\n小計: ${fmtPrice(subtotal)} 🪙 - 手数料: ${fmtPrice(fee)} 🪙 = **${fmtPrice(total)}** 🪙\n現在価格: **${fmtPrice(coin.price)}** 🪙`, components: [delBtn()], ...EPH });
}

async function showStoreManage(interaction, c, corpData, user) {
    const employees = c.employees || [];
    const salary = c.salary || 0;
    const embed = new EmbedBuilder().setTitle(`⚙️ ${c.name} 管理`).setColor(0x9b59b6)
        .addFields(
            { name: '会社残高', value: `**${(c.balance || 0).toLocaleString()}** 🪙`, inline: true },
            { name: '商品数', value: `${c.items.length}件`, inline: true },
            { name: '株式', value: c.stock ? `株価: **${fmtPrice(c.stock.price)}** 🪙` : '未発行', inline: true },
            { name: '日給', value: `**${salary.toLocaleString()}** 🪙`, inline: true },
            { name: '社員数', value: `**${employees.length}** 人`, inline: true },
            { name: '日次人件費', value: `**${(salary * employees.length).toLocaleString()}** 🪙`, inline: true }
        );
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`store_additem_${c.id}`).setLabel('商品追加').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`store_removeitem_${c.id}`).setLabel('商品削除').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`store_withdraw_${c.id}`).setLabel('売上回収').setStyle(ButtonStyle.Success)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`store_issuestock_${c.id}`).setLabel(c.stock ? '📊 株式追加発行' : '📊 株式発行').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`corp_dissolve_${c.id}`).setLabel('🗑️ 会社解散').setStyle(ButtonStyle.Danger)
    );
    return interaction.reply({ embeds: [embed], components: [row1, row2], ...EPH });
}

async function handleEconInteraction(interaction) {
    const cid = interaction.customId;
    const { user, guild } = interaction;
    const econ = load(ECON_FILE);
    const corpData = load(CORP_FILE);

    // 換金ボタン
    if (cid === 'exchange_unb_to_bot' || cid === 'exchange_bot_to_unb') {
        const serverCfg = (() => {
            try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'data','servers.json'),'utf8'))[interaction.guildId] || {}; } catch(e){ return {}; }
        })();
        const ex = serverCfg.exchange || {};
        const isUNBtoBot = cid === 'exchange_unb_to_bot';
        const r1 = 1;
        const r2 = 1;
        const modal = new ModalBuilder()
            .setCustomId(isUNBtoBot ? 'modal_exchange_unb_to_bot' : 'modal_exchange_bot_to_unb')
            .setTitle(isUNBtoBot ? 'UNB → 🪙 換金' : '🪙 → UNB 換金');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('exchange_amount')
                    .setLabel(isUNBtoBot ? `換金するUNB量（レート: 1 UNB = ${r1} 🪙）` : `換金する🪙量（レート: 1 🪙 = ${r2} UNB）`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('例: 1000')
                    .setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // オークション入札ボタン
    if (cid.startsWith('auction_bid_')) {
        const auctionId = cid.replace('auction_bid_', '');
        const auctions = load(AUCTION_FILE);
        const a = auctions[guildId]?.[auctionId];
        if (!a || a.status !== 'active') return interaction.reply({ content: '❌ このオークションは終了しています。', ...EPH });
        if (a.endAt < Date.now()) return interaction.reply({ content: '❌ オークションの時間が終了しています。', ...EPH });
        if (a.sellerId === user.id) return interaction.reply({ content: '❌ 自分のオークションには入札できません。', ...EPH });
        const modal = new ModalBuilder().setCustomId(`modal_auction_bid_${auctionId}`).setTitle(`🔨 ${a.item.name} に入札`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('bid_amount').setLabel(`入札額（現在: ${a.currentPrice.toLocaleString()} 🪙 より高く）`).setStyle(TextInputStyle.Short).setPlaceholder(`例: ${a.currentPrice + 100}`).setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // 就職ボタン
    if (cid.startsWith('corp_join_')) {
        const corpId = cid.replace('corp_join_', '');
        const c = corpData[corpId];
        if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        if (c.ownerId === user.id) return interaction.reply({ content: '❌ 自分の会社には就職できません。', ...EPH });
        if (!c.employees) c.employees = [];
        const currentJob = Object.values(corpData).find(co => (co.employees||[]).includes(user.id));
        if (currentJob) return interaction.reply({ content: `❌ すでに **${currentJob.name}** に就職しています。先に \`/corp leave\` で退職してください。`, ...EPH });
        if (c.employees.includes(user.id)) return interaction.reply({ content: '❌ すでにこの会社に就職しています。', ...EPH });
        c.employees.push(user.id);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** に就職しました！\n日給: **${(c.salary||0).toLocaleString()}** 🪙（毎日0時JST支給）`, ...EPH });
    }

    // 会社解散ボタン（確認）
    if (cid.startsWith('corp_dissolve_') && !cid.startsWith('corp_dissolve_confirm_') && cid !== 'corp_dissolve_cancel') {
        const corpId = cid.replace('corp_dissolve_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 会社のオーナーのみ解散できます。', ...EPH });
        const embed = new EmbedBuilder().setTitle('⚠️ 会社解散の確認').setColor(0xff4757)
            .setDescription(`**${c.name}** を解散しますか？\n\n以下が自動処理されます：\n• 会社残高 **${(c.balance || 0).toLocaleString()}** 🪙 をオーナーに返還\n• 株式保有者に現在株価で自動買い戻し\n\n**この操作は取り消せません。**`);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`corp_dissolve_confirm_${corpId}`).setLabel('解散する').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`corp_dissolve_cancel`).setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({ embeds: [embed], components: [row], ...EPH });
    }

    // 会社解散確定
    if (cid.startsWith('corp_dissolve_confirm_')) {
        const corpId = cid.replace('corp_dissolve_confirm_', '');
        const corpData2 = load(CORP_FILE);
        const c = corpData2[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 会社のオーナーのみ解散できます。', ...EPH });
        const u = getUser(econ, user.id, user);

        // 会社残高をオーナーに返還
        if (c.balance > 0) u.balance += c.balance;

        // 株主に現在株価で自動買い戻し
        let stockRefundMsg = '';
        if (c.stock) {
            for (const [uid, userData] of Object.entries(econ)) {
                const held = (userData.stocks || {})[corpId] || 0;
                if (held > 0) {
                    const refund = Math.floor(c.stock.price * held);
                    userData.balance = (userData.balance || 0) + refund;
                    delete userData.stocks[corpId];
                }
            }
            stockRefundMsg = `\n株主に合計 **${(c.stock.price * (c.stock.totalShares - c.stock.availableShares)).toLocaleString()}** 🪙 を返還`;
        }

        delete corpData2[corpId];
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData2);
        return interaction.reply({ content: `✅ **${c.name}** を解散しました。\n会社残高 **${(c.balance || 0).toLocaleString()}** 🪙 を回収${stockRefundMsg}`, ...EPH });
    }

    if (cid === 'corp_dissolve_cancel') {
        return interaction.update({ content: '❌ 解散をキャンセルしました。', embeds: [], components: [] });
    }
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
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const isAdditional = !!c.stock;
        const modal = new ModalBuilder().setCustomId(`modal_store_issuestock_${corpId}`).setTitle(isAdditional ? '📊 株式追加発行' : '📊 株式発行');
        if (isAdditional) {
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('stock_total_shares').setLabel(`追加発行株数（現在: ${c.stock.totalShares.toLocaleString()}株　株価: ${fmtPrice(c.stock.price)}🪙）`).setStyle(TextInputStyle.Short).setPlaceholder('例: 100').setRequired(true)
                )
            );
        } else {
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('stock_initial_price').setLabel('初期株価').setStyle(TextInputStyle.Short).setPlaceholder('例: 500').setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('stock_total_shares').setLabel('発行株数').setStyle(TextInputStyle.Short).setPlaceholder('例: 100').setRequired(true)
                )
            );
        }
        return interaction.showModal(modal);
    }

    if (cid === 'balance_reload') {
        const u = getUser(econ, user.id, user);
        const corp = load(CORP_FILE);
        const cryptoData = load(CRYPTO_FILE);
        const ownedCorps = Object.values(corp).filter(c => c.ownerId === user.id);
        const loan = u.loan || 0;
        const netBalance = round3(u.balance - loan);
        const heldCrypto = Object.entries(u.crypto || {}).filter(([, amt]) => amt > 0);
        let cryptoValue = 0;
        const cryptoLines = heldCrypto.map(([id, amt]) => {
            const coin = cryptoData[id];
            if (!coin) return null;
            const val = round3(amt * coin.price);
            cryptoValue += val;
            return `${coin.symbol}: **${fmtPrice(amt)}** 枚 (≒ **${fmtPrice(val)}** 🪙)`;
        }).filter(Boolean);
        const embed = new EmbedBuilder()
            .setTitle(`${CURRENCY} ${user.username} の所持金`)
            .setThumbnail(user.displayAvatarURL())
            .setColor(netBalance < 0 ? 0xff4757 : 0xf1c40f)
            .addFields(
                { name: '残高', value: `**${fmtPrice(u.balance)}** ${CURRENCY}`, inline: true },
                { name: '借入残高', value: loan > 0 ? `**-${fmtPrice(loan)}** ${CURRENCY}` : 'なし', inline: true },
                { name: '実質残高', value: `**${fmtPrice(netBalance)}** ${CURRENCY}${netBalance < 0 ? ' 🔴' : ''}`, inline: true },
                { name: '保有会社', value: ownedCorps.length > 0 ? ownedCorps.map(c => c.name).join(', ') : 'なし', inline: true },
                { name: '💹 仮想通貨', value: cryptoLines.length > 0 ? cryptoLines.join('\n') : 'なし', inline: false },
                { name: '仮想通貨評価額', value: `**${fmtPrice(cryptoValue)}** 🪙`, inline: true }
            ).setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('balance_reload').setLabel('🔄 更新').setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({ embeds: [embed], components: [row, delBtn()] });
    }

    // crypto ボタン
    if (cid.startsWith('crypto_buy_') || cid.startsWith('crypto_sell_') || cid.startsWith('crypto_refresh_')) {
        const CRYPTO_FILE = path.join(__dirname, 'data', 'crypto.json');
        const cryptoData = load(CRYPTO_FILE);
        const action = cid.startsWith('crypto_buy_') ? 'buy' : cid.startsWith('crypto_sell_') ? 'sell' : 'refresh';
        const coinId = cid.replace(`crypto_${action}_`, '');
        const coin = cryptoData[coinId];
        if (!coin) return interaction.reply({ content: '❌ 通貨が見つかりません。', ...EPH });
        if (action === 'refresh') return showCryptoDetail(interaction, coin, econ, user, CRYPTO_FILE, true);
        const modal = new ModalBuilder().setCustomId(`modal_crypto_${action}_${coinId}`).setTitle(action === 'buy' ? `💰 ${coin.name} 購入` : `💸 ${coin.name} 売却`);
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('crypto_amount').setLabel('枚数（数字・all）').setStyle(TextInputStyle.Short).setPlaceholder('例: 1000 または all').setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    // crypto セレクト
    if (interaction.isStringSelectMenu() && cid === 'crypto_view_select') {
        const CRYPTO_FILE = path.join(__dirname, 'data', 'crypto.json');
        const cryptoData = load(CRYPTO_FILE);
        const coin = cryptoData[interaction.values[0]];
        if (!coin) return interaction.reply({ content: '❌ 通貨が見つかりません。', ...EPH });
        return showCryptoDetail(interaction, coin, econ, user, CRYPTO_FILE);
    }
    if (interaction.isStringSelectMenu() && cid.startsWith('crypto_buyselect_')) {
        const CRYPTO_FILE = path.join(__dirname, 'data', 'crypto.json');
        const cryptoData = load(CRYPTO_FILE);
        const amtInput = cid.replace('crypto_buyselect_', '');
        const coin = cryptoData[interaction.values[0]];
        if (!coin) return interaction.reply({ content: '❌ 通貨が見つかりません。', ...EPH });
        const u = getUser(econ, user.id, user);
        return doBuyCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE);
    }
    if (interaction.isStringSelectMenu() && cid.startsWith('crypto_sellselect_')) {
        const CRYPTO_FILE = path.join(__dirname, 'data', 'crypto.json');
        const cryptoData = load(CRYPTO_FILE);
        const amtInput = cid.replace('crypto_sellselect_', '');
        const coin = cryptoData[interaction.values[0]];
        if (!coin) return interaction.reply({ content: '❌ 通貨が見つかりません。', ...EPH });
        const u = getUser(econ, user.id, user);
        return doSellCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE);
    }

    // BJ: ヒット
    if (cid.startsWith('bj_hit_')) {
        const gameKey = cid.replace('bj_hit_', '');
        const game = bjGames.get(gameKey);
        if (!game || game.userId !== user.id) return interaction.reply({ content: '❌ このゲームはあなたのものではありません。', ...EPH });
        game.playerCards.push(drawCard(game.deck));
        const playerTotal = calcBJ(game.playerCards);
        if (playerTotal > 21) {
            const econ2 = load(ECON_FILE);
            const u = getUser(econ2, user.id, user);
            u.balance -= game.bet * (game.leverage || 2);
            const debtMsg = applyDebt(u);
            save(ECON_FILE, econ2);
            bjGames.delete(gameKey);
            const embed = buildBJEmbed(game, 'bust', u.balance, user);
            if (debtMsg) embed.setFooter({ text: debtMsg });
            return interaction.update({ embeds: [embed], components: [delBtn()] });
        }
        return interaction.update({ embeds: [buildBJEmbed(game, 'playing', null, user)], components: buildBJRows(gameKey) });
    }

    if (cid.startsWith('bj_stand_')) {
        const gameKey = cid.replace('bj_stand_', '');
        const game = bjGames.get(gameKey);
        if (!game || game.userId !== user.id) return interaction.reply({ content: '❌ このゲームはあなたのものではありません。', ...EPH });
        while (calcBJ(game.dealerCards) < 17) game.dealerCards.push(drawCard(game.deck));
        const playerTotal = calcBJ(game.playerCards);
        const dealerTotal = calcBJ(game.dealerCards);
        const econ2 = load(ECON_FILE);
        const u = getUser(econ2, user.id, user);
        const lev = game.leverage || 2;
        let result;
        if (dealerTotal > 21 || playerTotal > dealerTotal) { u.balance += game.bet * lev; result = 'win'; }
        else if (playerTotal === dealerTotal) { result = 'push'; }
        else { u.balance -= game.bet * lev; result = 'lose'; }
        const debtMsg = applyDebt(u);
        save(ECON_FILE, econ2);
        bjGames.delete(gameKey);
        const embed = buildBJEmbed(game, result, u.balance, user);
        if (debtMsg) embed.setFooter({ text: debtMsg });
        return interaction.update({ embeds: [embed], components: [delBtn()] });
    }

    if (cid.startsWith('bj_double_')) {
        const gameKey = cid.replace('bj_double_', '');
        const game = bjGames.get(gameKey);
        if (!game || game.userId !== user.id) return interaction.reply({ content: '❌ このゲームはあなたのものではありません。', ...EPH });
        const econ2 = load(ECON_FILE);
        const u = getUser(econ2, user.id, user);
        const lev = game.leverage || 2;
        if (u.balance < game.bet * lev * 2) return interaction.reply({ content: `❌ ダブルダウンには **${(game.bet * lev * 2).toLocaleString()}** 🪙 必要です。`, ...EPH });
        game.bet *= 2;
        game.playerCards.push(drawCard(game.deck));
        const playerTotal = calcBJ(game.playerCards);
        while (calcBJ(game.dealerCards) < 17) game.dealerCards.push(drawCard(game.deck));
        const dealerTotal = calcBJ(game.dealerCards);
        let result;
        if (playerTotal > 21) { u.balance -= game.bet * lev; result = 'bust'; }
        else if (dealerTotal > 21 || playerTotal > dealerTotal) { u.balance += game.bet * lev; result = 'win'; }
        else if (playerTotal === dealerTotal) { result = 'push'; }
        else { u.balance -= game.bet * lev; result = 'lose'; }
        const debtMsg = applyDebt(u);
        save(ECON_FILE, econ2);
        bjGames.delete(gameKey);
        const embed = buildBJEmbed(game, result, u.balance, user);
        if (debtMsg) embed.setFooter({ text: debtMsg });
        return interaction.update({ embeds: [embed], components: [delBtn()] });
    }

    // dust セレクト
    if (interaction.isStringSelectMenu() && cid.startsWith('dust_select_')) {
        const dustCount = parseInt(cid.replace('dust_select_', '')) || 1;
        const itemName = interaction.values[0];
        const u = getUser(econ, user.id, user);
        return doDustItem(interaction, itemName, dustCount, econ, u);
    }

    // buy セレクト
    if (interaction.isStringSelectMenu() && cid.startsWith('buy_select')) {
        const amount = parseInt(cid.replace('buy_select_', '')) || 1;
        const itemName = interaction.values[0];
        const shop = load(SHOP_FILE);
        return doBuyItem(interaction, itemName, amount, econ, user, guild, shop);
    }

    // sell セレクト
    if (interaction.isStringSelectMenu() && cid.startsWith('sell_select_')) {
        const amtRaw = cid.replace('sell_select_', '');
        const itemName = interaction.values[0];
        const u = getUser(econ, user.id, user);
        const have = (u.inventory||[]).filter(i => i.name.toLowerCase() === itemName.toLowerCase()).length;
        let sellCount;
        if (amtRaw === 'all') sellCount = have;
        else if (amtRaw === 'half') sellCount = Math.floor(have / 2);
        else sellCount = parseInt(amtRaw) || 1;
        return doSellItem(interaction, itemName, sellCount, econ, u);
    }

    if (interaction.isStringSelectMenu() && cid === 'store_select_corp') {
        const corpId = interaction.values[0];
        const c = corpData[corpId];
        if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        return showStoreManage(interaction, c, corpData, user);
    }

    // stock 会社選択（閲覧）
    if (interaction.isStringSelectMenu() && cid === 'stock_select_view') {
        const corpId = interaction.values[0];
        const c = corpData[corpId];
        if (!c || !c.stock) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        return showStockDetail(interaction, c, econ, user);
    }

    // buystock 会社選択
    if (interaction.isStringSelectMenu() && cid.startsWith('stock_buyselect_')) {
        const amount = parseInt(cid.replace('stock_buyselect_', '')) || 1;
        const corpId = interaction.values[0];
        const c = corpData[corpId];
        if (!c || !c.stock) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        return doBuyStock(interaction, c, amount, econ, user, corpData);
    }

    // sellstock 会社選択
    if (interaction.isStringSelectMenu() && cid.startsWith('stock_sellselect_')) {
        const amount = parseInt(cid.replace('stock_sellselect_', '')) || 1;
        const corpId = interaction.values[0];
        const c = corpData[corpId];
        if (!c || !c.stock) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        const u = getUser(econ, user.id, user);
        return doSellStock(interaction, c, amount, econ, u, corpData);
    }

    // store 会社選択（閲覧 or 管理混在）
    if (interaction.isStringSelectMenu() && cid === 'store_select_view') {
        const corpId = interaction.values[0];
        const c = corpData[corpId];
        if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        return showStore(interaction, c, user);
    }

    if (interaction.isStringSelectMenu() && cid === 'store_select_mixed') {
        const val = interaction.values[0];
        if (val.startsWith('manage_')) {
            const corpId = val.replace('manage_', '');
            const c = corpData[corpId];
            if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
            return showStoreManage(interaction, c, corpData, user);
        } else {
            const corpId = val.replace('view_', '');
            const c = corpData[corpId];
            if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
            return showStore(interaction, c, user);
        }
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
        if ((c.balance || 0) === 0) return interaction.reply({ content: '❌ 回収できる売上がありません。', ...EPH });
        const modal = new ModalBuilder().setCustomId(`modal_store_withdraw_${corpId}`).setTitle(`${c.name} - 売上回収`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('withdraw_amount').setLabel(`金額（数字・all・half）　会社残高: ${(c.balance || 0).toLocaleString()} 🪙`).setStyle(TextInputStyle.Short).setPlaceholder('例: 1000 / all / half').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // 株式チャート更新
    if (cid.startsWith('stock_refresh_')) {
        const corpId = cid.replace('stock_refresh_', '');
        const corpData2 = load(CORP_FILE);
        const c = corpData2[corpId];
        if (!c || !c.stock) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        return showStockDetailUpdate(interaction, c, econ, user);
    }

    // corp deposit 会社選択
    if (interaction.isStringSelectMenu() && cid.startsWith('corp_deposit_select_')) {
        const amtInput = cid.replace('corp_deposit_select_', '');
        const corpId = interaction.values[0];
        const c = corpData[corpId];
        if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        const u = getUser(econ, user.id, user);
        let amount;
        if (amtInput === 'all') amount = u.balance;
        else if (amtInput === 'half') amount = Math.floor(u.balance / 2);
        else amount = parseInt(amtInput) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
        if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
        u.balance -= amount;
        c.balance = (c.balance || 0) + amount;
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** に **${amount.toLocaleString()}** 🪙 を入金しました。\n会社残高: **${c.balance.toLocaleString()}** 🪙`, ...EPH });
    }
}

async function handleEconModal(interaction) {
    const cid = interaction.customId;
    const { user, guild } = interaction;
    const econ = load(ECON_FILE);

    // ==================== crypto 購入/売却モーダル ====================
    if (cid.startsWith('modal_crypto_buy_') || cid.startsWith('modal_crypto_sell_')) {
        const isBuy = cid.startsWith('modal_crypto_buy_');
        const coinId = cid.replace(isBuy ? 'modal_crypto_buy_' : 'modal_crypto_sell_', '');
        const CRYPTO_FILE = path.join(__dirname, 'data', 'crypto.json');
        const cryptoData = load(CRYPTO_FILE);
        const coin = cryptoData[coinId];
        if (!coin) return interaction.reply({ content: '❌ 通貨が見つかりません。', ...EPH });
        const amtInput = interaction.fields.getTextInputValue('crypto_amount').trim().toLowerCase();
        const u = getUser(econ, user.id, user);
        if (isBuy) return doBuyCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE);
        else return doSellCrypto(interaction, coin, amtInput, econ, u, cryptoData, CRYPTO_FILE);
    }

    // ==================== オークション入札モーダル ====================
    if (cid.startsWith('modal_auction_bid_')) {
        const auctionId = cid.replace('modal_auction_bid_', '');
        const auctions = load(AUCTION_FILE);
        const a = auctions[interaction.guildId]?.[auctionId];
        if (!a || a.status !== 'active' || a.endAt < Date.now()) return interaction.reply({ content: '❌ このオークションは終了しています。', ...EPH });
        const bidAmount = parseInt(interaction.fields.getTextInputValue('bid_amount').replace(/,/g, '')) || 0;
        if (bidAmount <= a.currentPrice) return interaction.reply({ content: `❌ 現在価格 **${a.currentPrice.toLocaleString()}** 🪙 より高い金額を入力してください。`, ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < bidAmount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
        // 前の入札者に返金
        if (a.topBidderId && a.topBidderId !== user.id) {
            const prev = getUser(econ, a.topBidderId, null);
            if (prev) prev.balance += a.currentPrice;
        } else if (a.topBidderId === user.id) {
            u.balance += a.currentPrice; // 自分の前入札分を返金
        }
        u.balance -= bidAmount;
        a.currentPrice = bidAmount;
        a.topBidderId = user.id;
        a.topBidderName = user.username;
        save(ECON_FILE, econ);
        save(AUCTION_FILE, auctions);
        const embed = new EmbedBuilder().setTitle('💰 入札しました！').setColor(0x26a69a)
            .addFields(
                { name: 'アイテム', value: a.item.name, inline: true },
                { name: '入札額', value: `**${bidAmount.toLocaleString()}** 🪙`, inline: true },
                { name: '終了', value: `<t:${Math.floor(a.endAt / 1000)}:R>`, inline: true }
            );
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`auction_bid_${auctionId}`).setLabel('💰 再入札する').setStyle(ButtonStyle.Success)
        );
        return interaction.reply({ embeds: [embed], components: [row], ...EPH });
    }

    // ==================== 換金モーダル ====================
    if (cid === 'modal_exchange_unb_to_bot' || cid === 'modal_exchange_bot_to_unb') {
        const serverCfg = (() => {
            try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'data','servers.json'),'utf8'))[interaction.guildId] || {}; } catch(e){ return {}; }
        })();
        const ex = serverCfg.exchange || {};
        if (!ex.enabled) return interaction.reply({ content: '❌ このサーバーでは換金機能が無効です。管理者が `/set` → **UNB換金** から有効化できます。', ...EPH });
        if (!process.env.UNB_TOKEN) return interaction.reply({ content: '❌ UNB_TOKENが環境変数に設定されていません。', ...EPH });

        const amountStr = interaction.fields.getTextInputValue('exchange_amount').trim().replace(/,/g, '');
        const amount = parseInt(amountStr) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });

        const { Client } = require('unb-api');
        const unbClient = new Client(process.env.UNB_TOKEN);
        const isUNBtoBot = cid === 'modal_exchange_unb_to_bot';
        const u = getUser(econ, user.id, user);

        if (isUNBtoBot) {
            const rate = ex.rateUNBtoBot || 1;
            const receive = Math.floor(amount * rate);
            // UNB残高確認
            let unbUser;
            try { unbUser = await unbClient.getUserBalance(interaction.guildId, user.id); }
            catch(e) { return interaction.reply({ content: `❌ UNB APIエラー: ${e.message}`, ...EPH }); }
            if ((unbUser.cash || 0) < amount) return interaction.reply({ content: `❌ UNBのcash残高不足。現在: **${(unbUser.cash||0).toLocaleString()}** UNB`, ...EPH });
            // UNBから減算
            try { await unbClient.editUserBalance(interaction.guildId, user.id, { cash: -amount }, `maidbot換金 by ${user.username}`); }
            catch(e) { return interaction.reply({ content: `❌ UNB減算失敗: ${e.message}`, ...EPH }); }
            // maidbot加算
            u.balance += receive;
            save(ECON_FILE, econ);
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('💱 換金完了').setColor(0x26a69a)
                .addFields(
                    { name: '支払い', value: `**${amount.toLocaleString()}** UNB`, inline: true },
                    { name: '受取', value: `**${receive.toLocaleString()}** 🪙`, inline: true },
                    { name: 'レート', value: `1 UNB = ${rate} 🪙`, inline: true },
                    { name: 'maidbot残高', value: `**${u.balance.toLocaleString()}** 🪙`, inline: true }
                ).setTimestamp()], components: [delBtn()], ...EPH });
        } else {
            const rate = ex.rateBotToUNB || 1;
            const receive = Math.floor(amount * rate);
            if (u.balance < amount) return interaction.reply({ content: `❌ maidbot残高不足。現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
            // maidbot減算（先に引く）
            u.balance -= amount;
            save(ECON_FILE, econ);
            // UNBに加算
            try { await unbClient.editUserBalance(interaction.guildId, user.id, { cash: receive }, `maidbot換金 by ${user.username}`); }
            catch(e) {
                // 失敗したら返金
                u.balance += amount;
                save(ECON_FILE, econ);
                return interaction.reply({ content: `❌ UNB加算失敗: ${e.message}`, ...EPH });
            }
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('💱 換金完了').setColor(0x5865f2)
                .addFields(
                    { name: '支払い', value: `**${amount.toLocaleString()}** 🪙`, inline: true },
                    { name: '受取', value: `**${receive.toLocaleString()}** UNB`, inline: true },
                    { name: 'レート', value: `1 🪙 = ${rate} UNB`, inline: true },
                    { name: 'maidbot残高', value: `**${u.balance.toLocaleString()}** 🪙`, inline: true }
                ).setTimestamp()], components: [delBtn()], ...EPH });
        }
    }

    // ==================== 売上回収モーダル ====================
    if (cid.startsWith('modal_store_withdraw_')) {
        const corpId = cid.replace('modal_store_withdraw_', '');
        const corpData = load(CORP_FILE);
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const input = interaction.fields.getTextInputValue('withdraw_amount').trim().toLowerCase();
        const balance = c.balance || 0;
        let amount;
        if (input === 'all') amount = balance;
        else if (input === 'half') amount = Math.floor(balance / 2);
        else amount = parseInt(input) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
        if (amount > balance) return interaction.reply({ content: `❌ 会社残高が不足しています。現在: **${balance.toLocaleString()}** 🪙`, ...EPH });
        const u = getUser(econ, user.id, user);
        u.balance += amount;
        c.balance = balance - amount;
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** から **${amount.toLocaleString()}** 🪙 を回収しました！\n残高: **${u.balance.toLocaleString()}** 🪙　会社残高: **${c.balance.toLocaleString()}** 🪙`, ...EPH });
    }

    // ==================== 強盗モーダル ====================
    // ==================== 銀行ローンモーダル ====================
    if (cid === 'modal_bank_loan') {
        const input = interaction.fields.getTextInputValue('loan_amount').trim().toLowerCase();
        const u = getUser(econ, user.id, user);
        const current = u.loan || 0;
        const remaining = 5000 - current;
        let amount;
        if (input === 'all') amount = remaining;
        else if (input === 'half') amount = Math.floor(remaining / 2);
        else amount = parseInt(input) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
        if (amount > remaining) return interaction.reply({ content: `❌ 借入上限を超えます。あと **${remaining.toLocaleString()}** ${CURRENCY} まで借りられます。`, ...EPH });
        u.loan = current + amount;
        u.balance += amount;
        u.loanDate = u.loanDate || Date.now();
        u.lastInterestCharge = u.lastInterestCharge || Date.now();
        save(ECON_FILE, econ);
        return interaction.reply({ content: `✅ **${amount.toLocaleString()}** ${CURRENCY} を借りました。\n借入残高: **${u.loan.toLocaleString()}** ${CURRENCY}\n※3時間ごとに5%の利子が加算されます。`, ...EPH });
    }

    if (cid === 'modal_bank_repay') {
        const input = interaction.fields.getTextInputValue('repay_amount').trim().toLowerCase();
        const u = getUser(econ, user.id, user);
        const loan = u.loan || 0;
        if (loan <= 0) return interaction.reply({ content: '❌ 返済するローンがありません。', ...EPH });
        let amount;
        if (input === 'all') amount = loan;
        else if (input === 'half') amount = Math.ceil(loan / 2);
        else amount = parseInt(input) || 0;
        if (amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', ...EPH });
        if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        const actual = Math.min(amount, loan);
        u.balance -= actual;
        u.loan = loan - actual;
        if (u.loan <= 0) { u.loan = 0; delete u.loanDate; delete u.lastInterestCharge; }
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
        const shares = parseInt(interaction.fields.getTextInputValue('stock_total_shares')) || 0;
        if (shares <= 0) return interaction.reply({ content: '❌ 有効な株数を入力してください。', ...EPH });
        if (c.stock) {
            // 追加発行
            c.stock.totalShares += shares;
            c.stock.availableShares += shares;
            save(CORP_FILE, corpData);
            return interaction.reply({ content: `✅ **${c.name}** の株式を **${shares.toLocaleString()}** 株 追加発行しました！\n総発行株数: **${c.stock.totalShares.toLocaleString()}** 株　現在株価: **${fmtPrice(c.stock.price)}** 🪙`, ...EPH });
        } else {
            // 新規発行
            const price = parseFloat(interaction.fields.getTextInputValue('stock_initial_price')) || 0;
            if (price <= 0) return interaction.reply({ content: '❌ 有効な株価を入力してください。', ...EPH });
            c.stock = { price: round3(price), totalShares: shares, availableShares: shares, history: [round3(price)] };
            save(CORP_FILE, corpData);
            return interaction.reply({ content: `✅ **${c.name}** の株式を新規発行しました！\n初期株価: **${fmtPrice(price)}** 🪙　発行数: **${shares.toLocaleString()}** 株`, ...EPH });
        }
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
