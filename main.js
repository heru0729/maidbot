const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, Events, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, ActivityType } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const setupAuth = require('./auth.js');
const handleAdminCommands = require('./admin.js');
const { econCommands, handleEcon, handleEconInteraction, handleEconModal, handleEconSelect } = require('./econ.js');

const app = express();
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration],
    partials: [Partials.Channel, Partials.Message]
});

const TOKEN = process.env.TOKEN;
const OWNER_IDS = process.env.OWNER_ID ? process.env.OWNER_ID.split(',').map(id => id.trim()) : [];
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

function loadData(f) {
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function saveData(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 4)); }
const getNextLevelXP = (lv) => (lv + 1) * 500;
const xpCooldowns = new Map();
const messageHistory = new Map();
const ngwordViolations = new Map();
const pendingWelcomeChannel = new Map();
const pendingByeChannel = new Map();
const kasoCooldowns = new Map();
const EPH = { flags: MessageFlags.Ephemeral };
const delBtn = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_reply').setLabel('🗑️ 削除').setStyle(ButtonStyle.Secondary));
const snipeCache = new Map(); 
const giveawayTimers = new Map();
const BOT_START = Date.now();

function updateStatus() {
    const serverCount = client.guilds.cache.size;
    const ping = client.ws.ping;
    const pingStr = ping < 0 ? '...' : `${ping}ms`;
    client.user.setActivity(`/help | ${serverCount} Servers | ${pingStr}`, { type: ActivityType.Watching });
}

function replacePlaceholders(t, m) {
    if (!t) return "";
    return t.replace(/{user}/g, `<@${m.id}>`).replace(/{server}/g, m.guild.name).replace(/{members}/g, m.guild.memberCount.toString());
}

async function sendLog(guild, embed) {
    const s = loadData(SERVERS_FILE);
    const config = s[guild.id];
    if (config?.logChannel) {
        const channel = guild.channels.cache.get(config.logChannel);
        if (channel) await channel.send({ embeds: [embed] }).catch(console.error);
    }
}

function normalizeText(text) {
    return text
        .replace(/[\u200B-\u200D\uFEFF\u00AD\u034F\u2060-\u2064\u2066-\u206F]/g, '')
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/　/g, ' ')
        .replace(/[\u30A1-\u30F6]/g, s => String.fromCharCode(s.charCodeAt(0) - 0x60))
        .replace(/[ｦ-ﾟ]/g, s => { const map = 'をぁぃぅぇぉゃゅょっーあいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん゛゜'; const idx = s.charCodeAt(0) - 0xFF66; return idx >= 0 && idx < map.length ? map[idx] : s; })
        .replace(/[\s\-_\.・。、!！?？~〜ー\/\\|*#@$%^&()（）\[\]【】「」『』{}]/g, '')
        .replace(/(.)\1{2,}/g, '$1')
        .toLowerCase();
}

function containsNgWord(text, ngwords) {
    const normalized = normalizeText(text);
    for (const word of ngwords) {
        const nw = normalizeText(word);
        if (nw && normalized.includes(nw)) return true;
    }
    return false;
}

function recordMessage(guildId, channelId, authorId) {
    if (!messageHistory.has(guildId)) messageHistory.set(guildId, []);
    const arr = messageHistory.get(guildId);
    arr.push({ channelId, authorId, timestamp: Date.now() });
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    while (arr.length > 0 && arr[0].timestamp < oneHourAgo) arr.shift();
}

function getHourlyStats(guildId, ignoredChannels = []) {
    const arr = messageHistory.get(guildId) || [];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = arr.filter(m => m.timestamp >= oneHourAgo && !ignoredChannels.includes(m.channelId));
    const total = recent.length;
    const userCount = {};
    for (const m of recent) userCount[m.authorId] = (userCount[m.authorId] || 0) + 1;
    const topUsers = Object.entries(userCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const channelCount = {};
    for (const m of recent) channelCount[m.channelId] = (channelCount[m.channelId] || 0) + 1;
    const topChannels = Object.entries(channelCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    let judgment, color;
    if (total >= 50) { judgment = '🔥 活発'; color = 0x00ff00; }
    else if (total >= 10) { judgment = '💬 普通'; color = 0xffff00; }
    else { judgment = '💤 過疎'; color = 0xff4444; }
    return { total, topUsers, topChannels, judgment, color };
}

function getAllRanking(users) {
    return Object.entries(users)
        .filter(([, v]) => typeof v.xp === 'number')
        .sort((a, b) => b[1].xp - a[1].xp);
}

function buildRankingEmbed(sorted, page) {
    const PAGE_SIZE = 10;
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    const current = sorted.slice(start, start + PAGE_SIZE);
    const medals = ['🥇', '🥈', '🥉'];
    const list = current.map((e, i) => {
        const pos = start + i + 1;
        const icon = pos <= 3 ? medals[pos - 1] : `**${pos}.**`;
        const name = e[1].username || `ID:${e[0]}`;
        return `${icon} ${name} — Lv.${e[1].lv ?? 0} (${e[1].xp} XP)`;
    }).join('\n');
    const embed = new EmbedBuilder()
        .setTitle('🏆 レベルランキング')
        .setDescription(list || 'データなし')
        .setColor(0xf1c40f)
        .setFooter({ text: `ページ ${safePage} / ${totalPages}　全 ${sorted.length} ユーザー` });
    return { embed, safePage, totalPages };
}

function buildRankingRow(page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ranking_prev_${page}`).setLabel('◀ 前へ').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId(`ranking_next_${page}`).setLabel('次へ ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
    );
}

function createMainSetRow(s) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('set_menu_log').setLabel('ログ詳細設定').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_menu_kaso').setLabel('過疎調査除外設定').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_lv_toggle').setLabel(`レベル機能: ${s.leveling !== false ? 'ON' : 'OFF'}`).setStyle(s.leveling !== false ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('set_menu_lock').setLabel('一括ロック切替').setStyle(ButtonStyle.Danger)
    );
}
function createMainSetRow2() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('set_menu_welcome').setLabel('入室通知設定').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_menu_bye').setLabel('退室通知設定').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('NGワード管理').setStyle(ButtonStyle.Danger)
    );
}
function createLogConfigRows(c) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('log_toggle_edit').setLabel(`編集: ${c.edit ? 'ON' : 'OFF'}`).setStyle(c.edit ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('log_toggle_delete').setLabel(`削除: ${c.delete ? 'ON' : 'OFF'}`).setStyle(c.delete ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('log_toggle_join').setLabel(`入室: ${c.join ? 'ON' : 'OFF'}`).setStyle(c.join ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('log_toggle_leave').setLabel(`退出: ${c.leave ? 'ON' : 'OFF'}`).setStyle(c.leave ? ButtonStyle.Success : ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('log_toggle_message_send').setLabel(`送信: ${c.message_send ? 'ON' : 'OFF'}`).setStyle(c.message_send ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('log_toggle_channel').setLabel(`CH作成: ${c.channel ? 'ON' : 'OFF'}`).setStyle(c.channel ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('log_toggle_role').setLabel(`ロール: ${c.role ? 'ON' : 'OFF'}`).setStyle(c.role ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('log_toggle_timeout').setLabel(`TO: ${c.timeout ? 'ON' : 'OFF'}`).setStyle(c.timeout ? ButtonStyle.Success : ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('set_back_main').setLabel('← 戻る').setStyle(ButtonStyle.Secondary)
        ),
    ];
}
function buildNgwordPanel(s) {
    const list = s.ngwords?.length > 0 ? s.ngwords.map(w => `\`${w}\``).join('、') : 'なし';
    const exemptRoles = s.ngwordExemptRoles?.length > 0 ? s.ngwordExemptRoles.map(r => `<@&${r}>`).join('、') : 'なし';
    const content = `🚫 **NGワード管理**\n\nNGワード: ${list}\n除外ロール: ${exemptRoles}\n連呼罰則: ${s.ngwordViolationLimit || 3}回でタイムアウト ${s.ngwordTimeoutSeconds || 60}秒`;
    return {
        content,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ngword_add').setLabel('ワード追加').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('ngword_del').setLabel('ワード削除').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('ngword_exempt_add').setLabel('除外ロール追加').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('ngword_exempt_del').setLabel('除外ロール削除').setStyle(ButtonStyle.Secondary)
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ngword_timeout_set').setLabel('タイムアウト秒数').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('ngword_violation_set').setLabel('連呼回数').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary)
            )
        ]
    };
}
function createMainSetRow3(s) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('set_menu_mute').setLabel(`ミュートロール: ${s.muteRole ? '✅設定済' : '未設定'}`).setStyle(s.muteRole ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('set_menu_serverlock').setLabel('サーバーロック設定').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('set_menu_autoreply').setLabel(`自動返信 (${(s.autoReplies || []).length}件)`).setStyle(ButtonStyle.Primary)
    );
}
function buildSetPanel(s) {
    return { content: '⚙️ **サーバー管理設定パネル**\n下のボタンから各機能の設定を行ってください。', components: [createMainSetRow(s), createMainSetRow2(), createMainSetRow3(s)], flags: MessageFlags.Ephemeral };
}

function buildAutoReplyPanel(s) {
    const replies = s.autoReplies || [];
    let desc = replies.length === 0 ? '設定なし' : replies.map((r, i) => {
        const modeLabel = r.mode === 'reply' ? '↩️ 返信' : '💬 送信';
        const matchLabel = r.matchType === 'exact' ? '完全一致' : '含む';
        const resPreview = r.responses.length === 1 ? r.responses[0] : `${r.responses[0]} 他${r.responses.length - 1}件`;
        return `**${i + 1}.** トリガー: \`${r.trigger}\`\n返答: ${resPreview.slice(0, 40)}\nモード: ${modeLabel} | 判定: ${matchLabel}`;
    }).join('\n\n');
    if (desc.length > 3800) desc = desc.slice(0, 3700) + '\n...(省略)';
    return {
        embeds: [new EmbedBuilder().setTitle('💬 自動返信設定').setDescription(desc).setColor(0x3498db).setFooter({ text: '追加: モーダルでトリガー・返答を設定 / 返答は,区切りでランダム' })],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('autoreply_add').setLabel('➕ 追加').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('autoreply_del').setLabel('🗑️ 削除').setStyle(ButtonStyle.Danger).setDisabled(replies.length === 0),
                new ButtonBuilder().setCustomId('set_back_main').setLabel('← 戻る').setStyle(ButtonStyle.Secondary)
            )
        ],
        ...{flags: MessageFlags.Ephemeral}
    };
}

setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET);
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Web Server Ready'));

client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} としてログインしました。`);
    setTimeout(updateStatus, 3000);
    setInterval(updateStatus, 30000);

    // ローン利子処理
    setInterval(() => {
        const fs = require('fs'), path = require('path');
        const econPath = path.join(__dirname, 'data', 'econ.json');
        if (!fs.existsSync(econPath)) return;
        const econ = JSON.parse(fs.readFileSync(econPath, 'utf8'));
        const now = Date.now();
        let changed = false;
        for (const [id, u] of Object.entries(econ)) {
            if (!u.loan || u.loan <= 0) continue;
            const lastCharge = u.lastInterestCharge || u.loanDate || now;
            const periodsPassed = Math.floor((now - lastCharge) / 10800000);
            if (periodsPassed >= 1) {
                const interest = Math.ceil(u.loan * 0.05 * periodsPassed);
                u.loan += interest;
                u.lastInterestCharge = lastCharge + periodsPassed * 10800000;
                changed = true;
            }
        }
        if (changed) fs.writeFileSync(econPath, JSON.stringify(econ, null, 4));
    }, 3600000);

    // 市場自動調整
    setInterval(() => {
        const fs = require('fs'), path = require('path');
        const r3 = (x) => Math.round(x * 1000) / 1000;

        const corpPath = path.join(__dirname, 'data', 'corp.json');
        if (fs.existsSync(corpPath)) {
            const corp = JSON.parse(fs.readFileSync(corpPath, 'utf8'));
            let changed = false;
            for (const c of Object.values(corp)) {
                if (!c.stock) continue;
                const circRatio = 1 - c.stock.availableShares / c.stock.totalShares;
                const baseDrift = (circRatio - 0.5) * 0.008;
                const noise = (Math.random() - 0.5) * 0.012;
                const change = 1 + baseDrift + noise;
                c.stock.price = r3(Math.max(0.001, c.stock.price * change));
                c.stock.history = c.stock.history || [];
                c.stock.history.push(c.stock.price);
                if (c.stock.history.length > 60) c.stock.history.shift();
                changed = true;
            }
            if (changed) fs.writeFileSync(corpPath, JSON.stringify(corp, null, 4));
        }

        const cryptoPath = path.join(__dirname, 'data', 'crypto.json');
        if (fs.existsSync(cryptoPath)) {
            const cryptoData = JSON.parse(fs.readFileSync(cryptoPath, 'utf8'));
            let changed = false;
            for (const c of Object.values(cryptoData)) {
                const circRatio = 1 - c.availableSupply / c.totalSupply;
                const baseDrift = (circRatio - 0.5) * 0.01;
                const noise = (Math.random() - 0.5) * 0.02;
                const change = 1 + baseDrift + noise;
                c.price = r3(Math.max(0.001, c.price * change));
                c.history = c.history || [];
                c.history.push(c.price);
                if (c.history.length > 60) c.history.shift();
                changed = true;
            }
            if (changed) fs.writeFileSync(cryptoPath, JSON.stringify(cryptoData, null, 4));
        }
    }, 60000);

    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('ボットのコマンド一覧を表示します'),
        new SlashCommandBuilder().setName('set').setDescription('サーバー管理用設定パネルを開きます').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('support').setDescription('サポートサーバーの招待リンクを表示します'),
        new SlashCommandBuilder().setName('rank').setDescription('現在のレベルとXPを確認します').addUserOption(o => o.setName('user').setDescription('確認したいユーザー')),
        new SlashCommandBuilder().setName('ranking').setDescription('レベルランキングを表示します'),
        new SlashCommandBuilder().setName('serverinfo').setDescription('現在のサーバーの詳細情報を表示します'),
        new SlashCommandBuilder().setName('userinfo').setDescription('ユーザーの詳細情報を表示します').addUserOption(o => o.setName('user').setDescription('対象ユーザー')),
        new SlashCommandBuilder().setName('clear').setDescription('指定した件数のメッセージを削除します').addIntegerOption(o => o.setName('num').setDescription('件数 (1-100)').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
        new SlashCommandBuilder().setName('log').setDescription('ログの送信先チャンネルを設定します').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('authset').setDescription('OAuth2認証用のパネルを設置します').addStringOption(o => o.setName('title').setDescription('埋め込みタイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('埋め込み説明').setRequired(true)).addStringOption(o => o.setName('button').setDescription('ボタンのラベル').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('認証後に付与するロール').setRequired(true)).addChannelOption(o => o.setName('channel').setDescription('設置先チャンネル（未指定なら現在）').addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('ticket').setDescription('問い合わせチケットパネルを作成します').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o => o.setName('button').setDescription('ボタン名').setRequired(true)).addRoleOption(o => o.setName('mention-role').setDescription('通知先ロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('gchat').setDescription('グローバルチャットの設定をします').addChannelOption(o => o.setName('channel').setDescription('チャンネルを指定（未指定で解除）').addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('chatlock').setDescription('チャンネルを一時的にロックします').addIntegerOption(o => o.setName('seconds').setDescription('秒数').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占います'),
        new SlashCommandBuilder().setName('kaso').setDescription('過去1時間のサーバー稼働調査を表示します（3分クールダウン）'),
        new SlashCommandBuilder().setName('rp').setDescription('セルフ役職付与パネルを作成します').addSubcommand(sub => {
            sub.setName('create').setDescription('パネル作成').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true));
            for (let i = 1; i <= 10; i++) sub.addRoleOption(o => o.setName(`role${i}`).setDescription(`役職${i}`)).addStringOption(o => o.setName(`emoji${i}`).setDescription(`絵文字${i}`));
            return sub;
        }).addSubcommand(sub => sub.setName('delete').setDescription('パネルを削除します')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('kick').setDescription('ユーザーをサーバーからキックします').addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('理由')).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
        new SlashCommandBuilder().setName('ban').setDescription('ユーザーをサーバーからBANします').addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('理由')).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
        new SlashCommandBuilder().setName('embed').setDescription('Embedメッセージを送信します').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o => o.setName('color').setDescription('カラーコード (例: #ff0000)')).addStringOption(o => o.setName('image').setDescription('画像URL')).addChannelOption(o => o.setName('channel').setDescription('送信先チャンネル（未指定なら現在）').addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('mute').setDescription('ユーザーをミュートします').addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('理由')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('unmute').setDescription('ユーザーのミュートを解除します').addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('serverlock').setDescription('サーバーロックを実行/解除します').addStringOption(o => o.setName('action').setDescription('実行/解除').setRequired(true).addChoices({ name: 'ロック', value: 'lock' }, { name: '解除', value: 'unlock' })).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('janken').setDescription('Botとじゃんけんをします').addStringOption(o => o.setName('hand').setDescription('グー / チョキ / パー').setRequired(true).addChoices({ name: 'グー ✊', value: 'グー' }, { name: 'チョキ ✌️', value: 'チョキ' }, { name: 'パー ✋', value: 'パー' })),
        new SlashCommandBuilder().setName('coinflip').setDescription('コインを投げます（表/裏）'),
        new SlashCommandBuilder().setName('dice').setDescription('サイコロを振ります').addIntegerOption(o => o.setName('sides').setDescription('面数（デフォルト6）').setMinValue(2).setMaxValue(100)),
        new SlashCommandBuilder().setName('choose').setDescription('選択肢からランダムに1つ選びます').addStringOption(o => o.setName('choices').setDescription('選択肢（カンマ区切り）').setRequired(true)),
        new SlashCommandBuilder().setName('botstatus').setDescription('Botの稼働状況を表示します'),
        new SlashCommandBuilder().setName('channelinfo').setDescription('チャンネルの詳細情報を表示します').addChannelOption(o => o.setName('channel').setDescription('対象チャンネル')),
        new SlashCommandBuilder().setName('top').setDescription('このチャンネルの最初のメッセージへのリンクを表示します'),
        new SlashCommandBuilder().setName('snipe').setDescription('直前に削除されたメッセージを表示します'),
        new SlashCommandBuilder().setName('unban').setDescription('ユーザーのBANを解除します').addStringOption(o => o.setName('user').setDescription('ユーザーID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
        new SlashCommandBuilder().setName('giveaway').setDescription('プレゼント抽選を開始します').addStringOption(o => o.setName('prize').setDescription('景品名').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('終了までの時間（分）').setRequired(true)).addIntegerOption(o => o.setName('winners').setDescription('当選人数').setRequired(true)).addStringOption(o => o.setName('title').setDescription('タイトル')).addChannelOption(o => o.setName('channel').setDescription('開催チャンネル').addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('chset').setDescription('チャンネルの設定を変更します').addChannelOption(o => o.setName('channel').setDescription('対象チャンネル').addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        ...econCommands,
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log(`コマンド登録開始: ${commands.length}個`);
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log(`スラッシュコマンドの登録に成功しました。`);
    } catch (error) {
        console.error('コマンド登録エラー:', error?.message || error);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    const servers = loadData(SERVERS_FILE);
    const users = loadData(USERS_FILE);
    const guildId = interaction.guildId;

    if (guildId && !servers[guildId]) {
        servers[guildId] = { logConfig: { edit: true, delete: true, join: true, leave: true, message_send: true, channel: true, role: true, timeout: true }, ngwords: [], ngwordExemptRoles: [], ngwordTimeoutSeconds: 60, ngwordViolationLimit: 3, locked: false, kasoIgnoreChannels: [], leveling: true, muteRole: null, serverLockExemptRoles: [], serverLockExemptChannels: [] };
    }

    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📖 コマンド一覧').setColor(0x3498db).addFields(
                { name: '📊 レベル', value: '`/rank` `/ranking`', inline: true },
                { name: '👤 ユーザー', value: '`/userinfo`', inline: true },
                { name: '🏰 サーバー', value: '`/serverinfo` `/kaso` `/channelinfo`', inline: true },
                { name: '🎮 エンタメ', value: '`/omikuji` `/janken` `/coinflip` `/dice` `/choose`', inline: true },
                { name: '🎁 ギブアウェイ', value: '`/giveaway`', inline: true },
                { name: '🎫 チケット', value: '`/ticket`', inline: true },
                { name: '🔐 認証', value: '`/authset`', inline: true },
                { name: '🌐 グローバル', value: '`/gchat`', inline: true },
                { name: '🏷️ 役職', value: '`/rp create` `/rp delete`', inline: true },
                { name: '📢 告知', value: '`/embed`', inline: true },
                { name: '🔍 ユーティリティ', value: '`/botstatus` `/snipe` `/top`', inline: true },
                { name: '⚙️ 管理', value: '`/set` `/clear` `/log` `/chatlock` `/chset`', inline: true },
                { name: '🔨 モデレート', value: '`/kick` `/ban` `/unban` `/mute` `/unmute` `/serverlock`', inline: true },
                { name: '🪙 エコノミー', value: '`/balance` `/earn` `/pay` `/bank` `/shop` `/inventory` `/econrank` `/corp` `/crypto` `/stock` `/buystock` `/sellstock`', inline: false },
                { name: '❓ その他', value: '`/support` `/help`', inline: true }
            ).setFooter({ text: '/set で各種サーバー設定が可能です' });
            await interaction.reply({ embeds: [embed], ...EPH });
        }

        if (commandName === 'support') await interaction.reply({ content: 'サポートサーバー: https://discord.gg/ntdWV5EWT3', ...EPH });
        if (commandName === 'set') await interaction.reply(buildSetPanel(servers[guildId]));

        if (commandName === 'rank') {
            const target = options.getUser('user') || interaction.user;
            const raw = users[target.id] || {};
            const xp = typeof raw.xp === 'number' ? raw.xp : 0;
            const lv = typeof raw.lv === 'number' ? raw.lv : 0;
            const next = getNextLevelXP(lv);
            const sorted = getAllRanking(users);
            const rank = sorted.findIndex(e => e[0] === target.id) + 1;
            const filled = Math.round((xp / next) * 10);
            const progressBar = '█'.repeat(filled) + '░'.repeat(10 - filled);
            const embed = new EmbedBuilder()
                .setTitle(`📊 ${target.username} のステータス`)
                .setThumbnail(target.displayAvatarURL())
                .addFields(
                    { name: 'レベル', value: `Lv.${lv}`, inline: true },
                    { name: 'ランキング', value: rank > 0 ? `${rank}位` : '--', inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: `XP (${xp} / ${next})`, value: `\`${progressBar}\``, inline: false }
                ).setColor(0x2ecc71);
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'ranking') {
            const sorted = getAllRanking(users);
            if (sorted.length === 0) return interaction.reply({ content: 'データがありません。', ...EPH });
            await interaction.deferReply();
            for (const [id, data] of sorted) {
                if (!data.username) {
                    const member = await interaction.guild.members.fetch(id).catch(() => null);
                    if (member) {
                        data.username = member.user.username;
                        users[id] = users[id] || {};
                        users[id].username = member.user.username;
                    }
                }
            }
            saveData(USERS_FILE, users);
            const { embed, safePage, totalPages } = buildRankingEmbed(sorted, 1);
            await interaction.editReply({ embeds: [embed], components: totalPages > 1 ? [buildRankingRow(safePage, totalPages), delBtn()] : [delBtn()] });
        }

        if (commandName === 'serverinfo') {
            const g = interaction.guild;
            const embed = new EmbedBuilder().setTitle(`🏰 ${g.name} サーバー詳細`).setThumbnail(g.iconURL()).addFields(
                { name: 'サーバーID', value: `\`${g.id}\``, inline: true },
                { name: 'オーナー', value: `<@${g.ownerId}>`, inline: true },
                { name: 'メンバー数', value: `${g.memberCount}人`, inline: true },
                { name: '作成日', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:F>`, inline: true },
                { name: 'ブーストレベル', value: `Lv.${g.premiumTier}`, inline: true },
                { name: 'チャンネル数', value: `${g.channels.cache.size}`, inline: true }
            ).setColor(0x3498db);
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'userinfo') {
            const user = options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            const createdTs = Math.floor(user.createdTimestamp / 1000);
            const joinedTs = member ? Math.floor(member.joinedTimestamp / 1000) : null;
            const embed = new EmbedBuilder()
                .setTitle(`👤 ${user.tag}`)
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'ID', value: `\`${user.id}\``, inline: true },
                    { name: 'アカウント作成日', value: `<t:${createdTs}:F>`, inline: false },
                    { name: '参加日', value: joinedTs ? `<t:${joinedTs}:F>` : '不明', inline: false }
                ).setColor(member?.displayHexColor || 0x9b59b6);
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'clear') {
            const num = options.getInteger('num');
            if (num < 1 || num > 100) return interaction.reply({ content: '1〜100の間で指定してください。', ...EPH });
            const deleted = await interaction.channel.bulkDelete(num, true);
            await interaction.reply({ content: `✅ ${deleted.size}件のメッセージを削除しました。`, ...EPH });
        }

        if (commandName === 'log') {
            const channel = options.getChannel('channel');
            servers[guildId].logChannel = channel.id;
            saveData(SERVERS_FILE, servers);
            await interaction.reply(`ログ送信先を ${channel} に設定しました。`);
        }

        if (commandName === 'authset') {
            const role = options.getRole('role');
            const targetChannel = options.getChannel('channel') || interaction.channel;
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x00ae86);
            const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guildId}_${role.id}`;
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(options.getString('button')).setURL(authUrl).setStyle(ButtonStyle.Link));
            await targetChannel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: 'パネルを設置しました。', ...EPH });
        }

        if (commandName === 'ticket') {
            const mid = options.getRole('mention-role').id;
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x5865f2);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_open_${mid}`).setLabel(options.getString('button')).setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'gchat') {
            const ch = options.getChannel('channel');
            if (ch) {
                servers[guildId].gChatChannel = ch.id;
                saveData(SERVERS_FILE, servers);
                await interaction.reply(`グローバルチャットを <#${ch.id}> に設定しました。`);
            } else {
                delete servers[guildId].gChatChannel;
                saveData(SERVERS_FILE, servers);
                await interaction.reply('グローバルチャットを解除しました。');
            }
        }

        if (commandName === 'chatlock') {
            const sec = options.getInteger('seconds');
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            await interaction.reply(`${sec}秒間ロックします。`);
            setTimeout(async () => { await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }); }, sec * 1000);
        }

        if (commandName === 'omikuji') {
            const results = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];
            const res = results[Math.floor(Math.random() * results.length)];
            await interaction.reply({ content: `今日の運勢は **${res}** です！`, components: [delBtn()] });
        }

        if (commandName === 'kaso') {
            const KASO_COOLDOWN = 3 * 60 * 1000;
            const now = Date.now();
            const lastUsed = kasoCooldowns.get(guildId) || 0;
            if (now - lastUsed < KASO_COOLDOWN) return interaction.reply({ content: 'クールダウン中です。', ...EPH });
            kasoCooldowns.set(guildId, now);
            await interaction.deferReply();
            const stats = getHourlyStats(guildId, servers[guildId]?.kasoIgnoreChannels || []);
            const embed = new EmbedBuilder().setTitle('📊 過去1時間のサーバー稼働調査').setColor(stats.color).addFields(
                { name: '総メッセージ数', value: `${stats.total} 件`, inline: false },
                { name: '判定', value: stats.judgment, inline: false }
            ).setTimestamp();
            await interaction.editReply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'rp' && options.getSubcommand() === 'create') {
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x34495e);
            const row = new ActionRowBuilder();
            let count = 0;
            for (let i = 1; i <= 10; i++) {
                const r = options.getRole(`role${i}`);
                if (r) { row.addComponents(new ButtonBuilder().setCustomId(`rp_${r.id}`).setLabel(r.name).setStyle(ButtonStyle.Secondary)); count++; }
            }
            if (count === 0) return interaction.reply({ content: '役職を指定してください。', ...EPH });
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'janken') {
            const hands = ['グー', 'チョキ', 'パー'], userHand = options.getString('hand'), botHand = hands[Math.floor(Math.random() * 3)];
            let res = userHand === botHand ? '引き分け' : ((userHand === 'グー' && botHand === 'チョキ') || (userHand === 'チョキ' && botHand === 'パー') || (userHand === 'パー' && botHand === 'グー')) ? '勝ち' : '負け';
            await interaction.reply({ content: `自分: ${userHand} / Bot: ${botHand} → **${res}**！`, components: [delBtn()] });
        }

        if (commandName === 'dice') {
            const sides = options.getInteger('sides') || 6;
            await interaction.reply({ content: `🎲 **${Math.floor(Math.random() * sides) + 1}** が出ました！`, components: [delBtn()] });
        }

        if (commandName === 'botstatus') {
            const uptime = Math.floor((Date.now() - BOT_START) / 1000);
            await interaction.reply({ content: `🤖 ステータス:\n稼働時間: ${uptime}秒\nPing: ${client.ws.ping}ms\nサーバー数: ${client.guilds.cache.size}`, components: [delBtn()] });
        }

        if (commandName === 'snipe') {
            const cached = snipeCache.get(`${guildId}_${interaction.channelId}`);
            if (!cached) return interaction.reply({ content: 'キャッシュなし', ...EPH });
            await interaction.reply({ content: `直前の削除メッセージ (${cached.authorTag}):\n${cached.content}` });
        }

        if (commandName === 'giveaway') {
            const minutes = options.getInteger('minutes');
            const winnersCount = options.getInteger('winners');
            const prize = options.getString('prize');
            const targetChannel = options.getChannel('channel') || interaction.channel;
            const embed = new EmbedBuilder().setTitle('🎁 プレゼント抽選').setDescription(`景品: ${prize}\n当選人数: ${winnersCount}\n終了: <t:${Math.floor((Date.now() + minutes * 60000) / 1000)}:R>`).setColor(0xf1c40f);
            const msg = await targetChannel.send({ embeds: [embed] });
            await msg.react('🎉');
            await interaction.reply({ content: '開始しました。', ...EPH });

            setTimeout(async () => {
                const fetched = await targetChannel.messages.fetch(msg.id).catch(() => null);
                if (!fetched) return;
                const reaction = fetched.reactions.cache.get('🎉');
                const users = reaction ? (await reaction.users.fetch()).filter(u => !u.bot) : [];
                if (users.size === 0) return targetChannel.send('参加者なし');
                const winners = [...users.values()].sort(() => Math.random() - 0.5).slice(0, winnersCount);
                targetChannel.send(`当選者: ${winners.map(u => `<@${u.id}>`).join(', ')} おめでとう！`);
            }, minutes * 60000);
        }

        if (commandName === 'chset') {
            const target = options.getChannel('channel') || interaction.channel;
            const embed = new EmbedBuilder().setTitle(`⚙️ チャンネル設定: #${target.name}`).setColor(0x3498db).setDescription('設定を選択してください');
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`chset_name_${target.id}`).setLabel('名前変更').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`chset_topic_${target.id}`).setLabel('トピック変更').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`chset_slowmode_${target.id}`).setLabel('低速モード').setStyle(ButtonStyle.Secondary)
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`chset_nsfw_${target.id}`).setLabel('NSFW切替').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`chset_lock_${target.id}`).setLabel('ロック').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`chset_unlock_${target.id}`).setLabel('解除').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('chset_close').setLabel('閉じる').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ embeds: [embed], components: [row1, row2], ...EPH });
        }

        // Econコマンド実行
        const econCommandNames = ['balance','earn','pay','bank','shop','buy','sell','inventory','econrank','corp','crypto','stock','buystock','sellstock'];
        if (econCommandNames.includes(commandName)) {
            await handleEcon(interaction);
        }
    }

    if (interaction.isButton()) {
        const cid = interaction.customId;
        if (cid === 'delete_reply') return interaction.message.delete().catch(() => {});

        // 設定パネル
        if (cid === 'set_menu_log') {
            const select = new ChannelSelectMenuBuilder().setCustomId('select_log_channel').setPlaceholder('ログチャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({ content: 'ログ設定', components: [new ActionRowBuilder().addComponents(select), ...createLogConfigRows(servers[guildId].logConfig)] });
        }
        if (cid === 'set_back_main') await interaction.update(buildSetPanel(servers[guildId]));
        if (cid === 'set_lv_toggle') { servers[guildId].leveling = !servers[guildId].leveling; saveData(SERVERS_FILE, servers); await interaction.update(buildSetPanel(servers[guildId])); }

        // Econボタン
        const econBtnPrefixes = ['earn_', 'bj_', 'bank_', 'balance_', 'stock_', 'crypto_', 'store_'];
        if (econBtnPrefixes.some(p => cid.startsWith(p))) {
            await handleEconInteraction(interaction);
        }
    }

    if (interaction.isStringSelectMenu()) {
        const cid = interaction.customId;
        const econSelectPrefixes = ['buy_select', 'sell_select_', 'store_', 'stock_', 'corp_', 'crypto_'];
        if (econSelectPrefixes.some(p => cid.startsWith(p))) {
            await handleEconInteraction(interaction);
        }
    }

    if (interaction.isModalSubmit()) {
        const cid = interaction.customId;
        if (cid.startsWith('modal_store_') || cid.startsWith('modal_earn_') || cid.startsWith('modal_bank_') || cid.startsWith('modal_stock_') || cid.startsWith('modal_crypto_')) {
            await handleEconModal(interaction);
        }
    }
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.content.startsWith('!') && OWNER_IDS.includes(message.author.id)) {
        await handleAdminCommands(message, client, OWNER_IDS, loadData, saveData, USERS_FILE);
        return;
    }
    if (!message.guild) return;
    const gid = message.guildId;
    recordMessage(gid, message.channelId, message.author.id);

    const servers = loadData(SERVERS_FILE);
    const users = loadData(USERS_FILE);

    // NGワード
    if (servers[gid]?.ngwords?.length > 0) {
        if (!servers[gid].ngwordExemptRoles?.some(r => message.member?.roles.cache.has(r)) && containsNgWord(message.content, servers[gid].ngwords)) {
            await message.delete().catch(() => {});
            return;
        }
    }

    // 自動返信
    if (servers[gid]?.autoReplies?.length > 0) {
        for (const rule of servers[gid].autoReplies) {
            const matched = rule.matchType === 'exact' ? message.content === rule.trigger : message.content.includes(rule.trigger);
            if (matched) {
                const res = rule.responses[Math.floor(Math.random() * rule.responses.length)];
                rule.mode === 'reply' ? await message.reply(res) : await message.channel.send(res);
                break;
            }
        }
    }

    // レベリング
    if (servers[gid]?.leveling !== false) {
        const key = `${gid}_${message.author.id}`;
        const now = Date.now();
        if (now - (xpCooldowns.get(key) || 0) >= 30000) {
            xpCooldowns.set(key, now);
            if (!users[message.author.id]) users[message.author.id] = { xp: 0, lv: 0 };
            users[message.author.id].xp += 15;
            users[message.author.id].username = message.author.username;
            if (users[message.author.id].xp >= getNextLevelXP(users[message.author.id].lv)) {
                users[message.author.id].lv++;
                await message.reply(`🎉 Lv.${users[message.author.id].lv}！`).catch(() => {});
            }
            saveData(USERS_FILE, users);
        }
    }
});

client.on(Events.MessageDelete, async (msg) => {
    if (!msg.guild || !msg.author || msg.author.bot) return;
    snipeCache.set(`${msg.guildId}_${msg.channelId}`, { content: msg.content || '', authorTag: msg.author.tag, timestamp: Date.now() });
});

client.login(TOKEN);
