const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, Events, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ActivityType } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const setupAuth = require('./auth.js');
const handleAdminCommands = require('./admin.js');
const { econCommands, handleEcon } = require('./econ.js');

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
const snipeCache = new Map(); // guildId_channelId -> { content, author, attachmentUrl, timestamp }
const giveawayTimers = new Map(); // messageId -> timeoutId
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
        new ButtonBuilder().setCustomId('set_menu_serverlock').setLabel('サーバーロック設定').setStyle(ButtonStyle.Danger)
    );
}
function buildSetPanel(s) {
    return { content: '⚙️ **サーバー管理設定パネル**\n下のボタンから各機能の設定を行ってください。', components: [createMainSetRow(s), createMainSetRow2(), createMainSetRow3(s)], flags: MessageFlags.Ephemeral };
}

setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET);
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Web Server Ready'));

client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} としてログインしました。`);
    setTimeout(updateStatus, 3000);
    setInterval(updateStatus, 30000);

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
        new SlashCommandBuilder().setName('choose').setDescription('選択肢からランダムに1つ選びます').addStringOption(o => o.setName('choices').setDescription('選択肢（カンマ区切り　例: ラーメン,カレー,寿司）').setRequired(true)),
        new SlashCommandBuilder().setName('botstatus').setDescription('Botの稼働状況を表示します'),
        new SlashCommandBuilder().setName('channelinfo').setDescription('チャンネルの詳細情報を表示します').addChannelOption(o => o.setName('channel').setDescription('対象チャンネル（未指定なら現在）')),
        new SlashCommandBuilder().setName('top').setDescription('このチャンネルの最初のメッセージへのリンクを表示します'),
        new SlashCommandBuilder().setName('snipe').setDescription('直前に削除されたメッセージを表示します'),
        new SlashCommandBuilder().setName('unban').setDescription('ユーザーのBANを解除します').addStringOption(o => o.setName('user').setDescription('ユーザーID or メンション').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
        new SlashCommandBuilder().setName('giveaway').setDescription('プレゼント抽選を開始します').addStringOption(o => o.setName('prize').setDescription('景品名').setRequired(true)).addStringOption(o => o.setName('title').setDescription('タイトル（未指定なら「プレゼント抽選」）')).addIntegerOption(o => o.setName('minutes').setDescription('終了までの時間（分）').setRequired(true).setMinValue(1)).addIntegerOption(o => o.setName('winners').setDescription('当選人数').setRequired(true).setMinValue(1)).addChannelOption(o => o.setName('channel').setDescription('開催チャンネル（未指定なら現在）').addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        ...econCommands,
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('スラッシュコマンドの再登録に成功しました。');
    } catch (error) { console.error('コマンド登録エラー:', error); }
});

client.on(Events.InteractionCreate, async (interaction) => {
    const servers = loadData(SERVERS_FILE);
    const users = loadData(USERS_FILE);
    const guildId = interaction.guildId;

    if (guildId && !servers[guildId]) {
        servers[guildId] = { logConfig: { edit: true, delete: true, join: true, leave: true, message_send: true, channel: true, role: true, timeout: true }, ngwords: [], ngwordExemptRoles: [], ngwordTimeoutSeconds: 60, ngwordViolationLimit: 3, locked: false, kasoIgnoreChannels: [], leveling: true, muteRole: null, serverLockExemptRoles: [], serverLockExemptChannels: [] };
    }

    // ==================== スラッシュコマンド ====================
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
                { name: '⚙️ 管理', value: '`/set` `/clear` `/log` `/chatlock`', inline: true },
                { name: '🔨 モデレート', value: '`/kick` `/ban` `/unban` `/mute` `/unmute` `/serverlock`', inline: true },
                { name: '🪙 エコノミー', value: '`/balance` `/daily` `/work` `/transfer` `/shop` `/buy` `/inventory` `/econrank`', inline: false },
                { name: '❓ その他', value: '`/support` `/help`', inline: true }
            ).setFooter({ text: '/set で各種サーバー設定が可能です' });
            await interaction.reply({ embeds: [embed], ...EPH });
        }

        if (commandName === 'support') await interaction.reply({ content: 'サポートサーバーはこちら: https://discord.gg/ntdWV5EWT3', ...EPH });
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
            if (sorted.length === 0) return interaction.reply({ content: 'まだランキングデータがありません。', ...EPH });
            const { embed, safePage, totalPages } = buildRankingEmbed(sorted, 1);
            await interaction.reply({ embeds: [embed], components: totalPages > 1 ? [buildRankingRow(safePage, totalPages), delBtn()] : [delBtn()] });
        }

        if (commandName === 'serverinfo') {
            const g = interaction.guild;
            const verificationLevels = ['なし', '低', '中', '高', '最高'];
            const embed = new EmbedBuilder().setTitle(`🏰 ${g.name} サーバー詳細`).setThumbnail(g.iconURL()).addFields(
                { name: 'サーバーID', value: `\`${g.id}\``, inline: true },
                { name: 'オーナー', value: `<@${g.ownerId}>`, inline: true },
                { name: 'メンバー数', value: `${g.memberCount}人`, inline: true },
                { name: '作成日', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:F>`, inline: true },
                { name: 'ブーストレベル', value: `Lv.${g.premiumTier} (${g.premiumSubscriptionCount || 0}本)`, inline: true },
                { name: '認証レベル', value: verificationLevels[g.verificationLevel] || '不明', inline: true },
                { name: 'チャンネル数', value: `テキスト: ${g.channels.cache.filter(c => c.type === ChannelType.GuildText).size} / VC: ${g.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size}`, inline: true },
                { name: 'ロール数', value: `${g.roles.cache.size}`, inline: true },
                { name: '絵文字数', value: `${g.emojis.cache.size}`, inline: true }
            ).setColor(0x3498db);
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'userinfo') {
            const user = options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            const createdTs = Math.floor(user.createdTimestamp / 1000);
            const joinedTs = member ? Math.floor(member.joinedTimestamp / 1000) : null;
            const ageMs = Date.now() - user.createdTimestamp;
            const ageDays = Math.floor(ageMs / 86400000);
            const ageYears = Math.floor(ageDays / 365);
            const ageMonths = Math.floor((ageDays % 365) / 30);
            const ageStr = ageYears > 0 ? `${ageYears}年${ageMonths}ヶ月` : `${Math.floor(ageDays / 30)}ヶ月${ageDays % 30}日`;
            const roles = member ? member.roles.cache.filter(r => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position).map(r => `${r}`).slice(0, 10).join(' ') || 'なし' : 'なし';
            const embed = new EmbedBuilder()
                .setTitle(`👤 ${user.tag}`)
                .setThumbnail(user.displayAvatarURL({ size: 256 }))
                .addFields(
                    { name: 'ユーザーID', value: `\`${user.id}\``, inline: true },
                    { name: 'ボット', value: user.bot ? 'はい' : 'いいえ', inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: 'アカウント作成日', value: `<t:${createdTs}:F>\n<t:${createdTs}:R>\n経過: **${ageStr}**`, inline: false },
                    { name: 'サーバー参加日', value: joinedTs ? `<t:${joinedTs}:F>\n<t:${joinedTs}:R>` : '取得不可', inline: false },
                    { name: '最上位ロール', value: member ? `${member.roles.highest}` : 'なし', inline: true },
                    { name: 'ニックネーム', value: member?.nickname || 'なし', inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: `ロール (${member?.roles.cache.size ? member.roles.cache.size - 1 : 0}個)`, value: roles, inline: false }
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
                await interaction.reply(`✅ グローバルチャットを <#${ch.id}> に設定しました。`);
            } else {
                delete servers[guildId].gChatChannel;
                saveData(SERVERS_FILE, servers);
                await interaction.reply('✅ グローバルチャットを解除しました。');
            }
        }

        if (commandName === 'chatlock') {
            const sec = options.getInteger('seconds');
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            await interaction.reply(`${sec}秒間、このチャンネルをロックします。`);
            setTimeout(async () => { await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }); await interaction.channel.send('ロックが解除されました。'); }, sec * 1000);
        }

        if (commandName === 'omikuji') {
            const results = [
                { label: '大吉 🎊', color: 0xFFD700, msg: '最高の一日になるでしょう！' },
                { label: '中吉 🎉', color: 0x00FF7F, msg: '良いことが起きそうです。' },
                { label: '小吉 🙂', color: 0x7FFFD4, msg: 'まずまずの運勢です。' },
                { label: '吉 😊', color: 0x87CEEB, msg: '穏やかな一日を過ごせそうです。' },
                { label: '末吉 😐', color: 0xD3D3D3, msg: '慎重に行動すると良いでしょう。' },
                { label: '凶 😟', color: 0xFFA07A, msg: '注意が必要な日です。' },
                { label: '大凶 😱', color: 0xFF4500, msg: '今日は無理をしない方が良いかも...' },
            ];
            const r = results[Math.floor(Math.random() * results.length)];
            const embed = new EmbedBuilder().setTitle(`🎴 おみくじ結果: **${r.label}**`).setDescription(r.msg).setColor(r.color).setTimestamp();
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'kaso') {
            const KASO_COOLDOWN = 3 * 60 * 1000;
            const now = Date.now();
            const lastUsed = kasoCooldowns.get(guildId) || 0;
            const remaining = KASO_COOLDOWN - (now - lastUsed);
            if (remaining > 0) {
                const sec = Math.ceil(remaining / 1000);
                const min = Math.floor(sec / 60);
                const s = sec % 60;
                return interaction.reply({ content: `⏳ クールダウン中です。あと **${min}分${s}秒** お待ちください。`, ...EPH });
            }
            kasoCooldowns.set(guildId, now);
            await interaction.deferReply();
            const ignoredChannels = servers[guildId]?.kasoIgnoreChannels || [];
            const stats = getHourlyStats(guildId, ignoredChannels);
            const topUserLines = [];
            for (const [uid, count] of stats.topUsers) {
                let name;
                try { const member = await interaction.guild.members.fetch(uid); name = member.displayName; } catch { name = `<@${uid}>`; }
                topUserLines.push(`**${name}** (${count}回)`);
            }
            const topChannelLines = stats.topChannels.map(([cid, count]) => `<#${cid}> (${count}回)`);
            const embed = new EmbedBuilder().setTitle('📊 過去1時間のサーバー稼働調査').setColor(stats.color).addFields(
                { name: '総メッセージ数', value: `${stats.total} 件`, inline: false },
                { name: '判定結果', value: stats.judgment, inline: false },
                { name: '活発なユーザー TOP3', value: topUserLines.length > 0 ? topUserLines.join('\n') : 'データなし', inline: true },
                { name: '活発なチャンネル TOP3', value: topChannelLines.length > 0 ? topChannelLines.join('\n') : 'データなし', inline: true }
            ).setFooter({ text: '直近60分間 / Bot除外 / ticket-チャンネル除外' }).setTimestamp();
            await interaction.editReply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'rp' && options.getSubcommand() === 'create') {
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x34495e);
            const row = new ActionRowBuilder();
            let count = 0;
            for (let i = 1; i <= 10; i++) {
                const r = options.getRole(`role${i}`);
                const e = options.getString(`emoji${i}`);
                if (r) { row.addComponents(new ButtonBuilder().setCustomId(`rp_${r.id}`).setLabel(r.name).setEmoji(e || '🏷️').setStyle(ButtonStyle.Secondary)); count++; }
            }
            if (count === 0) return interaction.reply({ content: '最低1つの役職を指定してください。', ...EPH });
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'rp' && options.getSubcommand() === 'delete') {
            const embed = new EmbedBuilder().setTitle('🗑️ 役職パネル削除').setDescription('下のボタンを押すと、このチャンネル内の最近の役職パネルを削除できます。').setColor(0xe74c3c);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rp_delete_panel').setLabel('最新パネルを削除').setStyle(ButtonStyle.Danger)
            );
            await interaction.reply({ embeds: [embed], components: [row], ...EPH });
        }

        if (commandName === 'janken') {
            const hands = ['グー', 'チョキ', 'パー'], emojis = { 'グー': '✊', 'チョキ': '✌️', 'パー': '✋' }, userHand = options.getString('hand'), botHand = hands[Math.floor(Math.random() * 3)];
            let result, color;
            if (userHand === botHand) { result = '引き分け 🤝'; color = 0xFFFF00; }
            else if ((userHand === 'グー' && botHand === 'チョキ') || (userHand === 'チョキ' && botHand === 'パー') || (userHand === 'パー' && botHand === 'グー')) { result = 'あなたの勝ち 🎉'; color = 0x00FF00; }
            else { result = 'Botの勝ち 😈'; color = 0xFF0000; }
            const embed = new EmbedBuilder().setTitle('✊✌️✋ じゃんけん！').setColor(color).addFields({ name: 'あなた', value: `${emojis[userHand]} ${userHand}`, inline: true }, { name: 'Bot', value: `${emojis[botHand]} ${botHand}`, inline: true }, { name: '結果', value: result, inline: false });
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'coinflip') {
            const result = Math.random() < 0.5 ? '表 🪙' : '裏 🔄';
            const embed = new EmbedBuilder().setTitle('🪙 コインフリップ').setDescription(`**${result}** が出ました！`).setColor(0xf1c40f);
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'dice') {
            const sides = options.getInteger('sides') || 6, result = Math.floor(Math.random() * sides) + 1;
            const embed = new EmbedBuilder().setTitle('🎲 ダイスロール').setColor(0x9b59b6).addFields({ name: `d${sides}`, value: `**${result}**`, inline: true });
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'choose') {
            const choices = options.getString('choices').split(',').map(c => c.trim()).filter(Boolean);
            if (choices.length < 2) return interaction.reply({ content: '❌ 選択肢を2つ以上入力してください。', ...EPH });
            const chosen = choices[Math.floor(Math.random() * choices.length)];
            const embed = new EmbedBuilder().setTitle('🎯 選択結果').setColor(0x1abc9c).setDescription(`**${chosen}**`).setFooter({ text: `${choices.length}個の選択肢から選びました` });
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'botstatus') {
            const uptimeMs = Date.now() - BOT_START;
            const d = Math.floor(uptimeMs / 86400000);
            const h = Math.floor((uptimeMs % 86400000) / 3600000);
            const m = Math.floor((uptimeMs % 3600000) / 60000);
            const s = Math.floor((uptimeMs % 60000) / 1000);
            const mem = process.memoryUsage();
            const ping = client.ws.ping;
            const embed = new EmbedBuilder()
                .setTitle('🤖 Bot ステータス')
                .setThumbnail(client.user.displayAvatarURL())
                .setColor(0x5865f2)
                .addFields(
                    { name: '⏱ 稼働時間', value: `${d}日 ${h}時間 ${m}分 ${s}秒`, inline: true },
                    { name: '📡 Ping', value: `${ping < 0 ? '...' : ping + 'ms'}`, inline: true },
                    { name: '🏰 サーバー数', value: `${client.guilds.cache.size}`, inline: true },
                    { name: '💾 メモリ使用量', value: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`, inline: true },
                    { name: '👥 総ユーザー数', value: `${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`, inline: true },
                    { name: '📅 起動日時', value: `<t:${Math.floor((Date.now() - uptimeMs) / 1000)}:F>`, inline: true }
                ).setTimestamp();
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'channelinfo') {
            const ch = options.getChannel('channel') || interaction.channel;
            const channel = interaction.guild.channels.cache.get(ch.id);
            if (!channel) return interaction.reply({ content: '❌ チャンネルが見つかりません。', ...EPH });
            const typeMap = { 0: 'テキスト', 2: 'ボイス', 4: 'カテゴリ', 5: 'アナウンス', 15: 'フォーラム', 13: 'ステージ' };
            const embed = new EmbedBuilder()
                .setTitle(`📋 #${channel.name}`)
                .setColor(0x3498db)
                .addFields(
                    { name: 'チャンネルID', value: `\`${channel.id}\``, inline: true },
                    { name: '種類', value: typeMap[channel.type] || 'その他', inline: true },
                    { name: 'カテゴリ', value: channel.parent?.name || 'なし', inline: true },
                    { name: '作成日', value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:F>`, inline: true },
                    { name: 'NSFW', value: channel.nsfw ? 'はい' : 'いいえ', inline: true },
                    { name: '低速モード', value: channel.rateLimitPerUser > 0 ? `${channel.rateLimitPerUser}秒` : 'なし', inline: true },
                    { name: 'トピック', value: channel.topic || 'なし', inline: false }
                ).setTimestamp();
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'top') {
            await interaction.deferReply();
            const msgs = await interaction.channel.messages.fetch({ limit: 1, after: '0' });
            const first = msgs.first();
            if (!first) return interaction.editReply('❌ メッセージが見つかりませんでした。');
            const embed = new EmbedBuilder()
                .setTitle('📜 最初のメッセージ')
                .setColor(0x9b59b6)
                .setDescription(`[ここをクリックしてジャンプ](${first.url})`)
                .addFields(
                    { name: '送信者', value: `<@${first.author.id}>`, inline: true },
                    { name: '送信日時', value: `<t:${Math.floor(first.createdTimestamp / 1000)}:F>`, inline: true },
                    { name: '内容', value: first.content?.slice(0, 200) || '(内容なし)', inline: false }
                );
            await interaction.editReply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'snipe') {
            const key = `${guildId}_${interaction.channelId}`;
            const cached = snipeCache.get(key);
            if (!cached) return interaction.reply({ content: '❌ このチャンネルに削除されたメッセージのキャッシュがありません。', ...EPH });
            const embed = new EmbedBuilder()
                .setTitle('🗑️ 直前の削除メッセージ')
                .setColor(0xff6b35)
                .setDescription(cached.content || '(内容なし)')
                .setAuthor({ name: cached.authorTag, iconURL: cached.authorAvatar })
                .setFooter({ text: `削除: ${new Date(cached.timestamp).toLocaleString('ja-JP')}` });
            if (cached.attachmentUrl) embed.setImage(cached.attachmentUrl);
            await interaction.reply({ embeds: [embed], components: [delBtn()] });
        }

        if (commandName === 'unban') {
            const input = options.getString('user').replace(/[<@!>]/g, '');
            try {
                const banned = await interaction.guild.bans.fetch(input).catch(() => null);
                if (!banned) return interaction.reply({ content: '❌ そのユーザーはBANされていません。', ...EPH });
                await interaction.guild.members.unban(input);
                const embed = new EmbedBuilder().setTitle('🔓 BAN解除').setColor(0x57f287).addFields({ name: '対象', value: `${banned.user.tag} (\`${input}\`)` }).setTimestamp();
                await interaction.reply({ embeds: [embed] });
            } catch (e) {
                await interaction.reply({ content: `❌ BAN解除に失敗しました: ${e.message}`, ...EPH });
            }
        }

        if (commandName === 'giveaway') {
            const prize = options.getString('prize');
            const title = options.getString('title') || '🎁 プレゼント抽選';
            const minutes = options.getInteger('minutes');
            const winnersCount = options.getInteger('winners');
            const targetChannel = options.getChannel('channel') || interaction.channel;
            const endTime = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(`**景品:** ${prize}\n\n🎉 に反応して参加しよう！\n\n**終了:** <t:${endTime}:R>\n**当選人数:** ${winnersCount}人`)
                .setColor(0xf1c40f)
                .setFooter({ text: `終了: ${new Date(endTime * 1000).toLocaleString('ja-JP')}` });
            const msg = await targetChannel.send({ embeds: [embed] });
            await msg.react('🎉');
            await interaction.reply({ content: `✅ <#${targetChannel.id}> でギブアウェイを開始しました！`, ...EPH });

            const timer = setTimeout(async () => {
                const fetchedMsg = await targetChannel.messages.fetch(msg.id).catch(() => null);
                if (!fetchedMsg) return;
                const reaction = fetchedMsg.reactions.cache.get('🎉');
                const users = reaction ? (await reaction.users.fetch()).filter(u => !u.bot) : new Map();
                const endEmbed = new EmbedBuilder().setTitle('🎁 プレゼント抽選 — 終了').setColor(0x95a5a6);
                if (users.size === 0) {
                    endEmbed.setDescription(`**景品:** ${prize}\n\n参加者がいなかったため抽選できませんでした。`);
                    await fetchedMsg.edit({ embeds: [endEmbed] });
                    await targetChannel.send('😢 参加者がいなかったため当選者なしです。');
                } else {
                    const shuffled = [...users.values()].sort(() => Math.random() - 0.5);
                    const winners = shuffled.slice(0, Math.min(winnersCount, shuffled.length));
                    endEmbed.setDescription(`**景品:** ${prize}\n\n**当選者:** ${winners.map(u => `<@${u.id}>`).join(' ')}`);
                    await fetchedMsg.edit({ embeds: [endEmbed] });
                    await targetChannel.send(`🎉 おめでとうございます！ ${winners.map(u => `<@${u.id}>`).join(' ')} が **${prize}** に当選しました！`);
                }
                giveawayTimers.delete(msg.id);
            }, minutes * 60 * 1000);
            giveawayTimers.set(msg.id, timer);
        }


        if (commandName === 'kick') {
            const target = options.getUser('user');
            const reason = options.getString('reason') || '理由なし';
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return interaction.reply({ content: '❌ サーバーにいないユーザーです。', ...EPH });
            if (!member.kickable) return interaction.reply({ content: '❌ このユーザーをキックできません。（権限不足）', ...EPH });
            await member.kick(reason);
            const embed = new EmbedBuilder().setTitle('👢 キック').setColor(0xff6b35).addFields({ name: '対象', value: `${target.tag} (${target.id})`, inline: true }, { name: '理由', value: reason, inline: true }).setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'ban') {
            const target = options.getUser('user');
            const reason = options.getString('reason') || '理由なし';
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (member && !member.bannable) return interaction.reply({ content: '❌ このユーザーをBANできません。（権限不足）', ...EPH });
            await interaction.guild.members.ban(target.id, { reason });
            const embed = new EmbedBuilder().setTitle('🔨 BAN').setColor(0xff0000).addFields({ name: '対象', value: `${target.tag} (${target.id})`, inline: true }, { name: '理由', value: reason, inline: true }).setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'embed') {
            const targetChannel = options.getChannel('channel') || interaction.channel;
            const colorStr = options.getString('color');
            let color = 0x5865f2;
            if (colorStr) {
                const parsed = parseInt(colorStr.replace('#', ''), 16);
                if (!isNaN(parsed)) color = parsed;
            }
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(color).setTimestamp();
            const imageUrl = options.getString('image');
            if (imageUrl) embed.setImage(imageUrl);
            await targetChannel.send({ embeds: [embed] });
            await interaction.reply({ content: `✅ <#${targetChannel.id}> にEmbedを送信しました。`, ...EPH });
        }

        if (commandName === 'mute') {
            const target = options.getUser('user');
            const reason = options.getString('reason') || '理由なし';
            const muteRoleId = servers[guildId]?.muteRole;
            if (!muteRoleId) return interaction.reply({ content: '❌ ミュートロールが設定されていません。`/set` から設定してください。', ...EPH });
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return interaction.reply({ content: '❌ サーバーにいないユーザーです。', ...EPH });
            if (member.roles.cache.has(muteRoleId)) return interaction.reply({ content: '⚠️ 既にミュートされています。', ...EPH });
            await member.roles.add(muteRoleId, reason);
            const embed = new EmbedBuilder().setTitle('🔇 ミュート').setColor(0xff6b35).addFields({ name: '対象', value: `${target.tag} (${target.id})`, inline: true }, { name: '理由', value: reason, inline: true }).setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'unmute') {
            const target = options.getUser('user');
            const muteRoleId = servers[guildId]?.muteRole;
            if (!muteRoleId) return interaction.reply({ content: '❌ ミュートロールが設定されていません。`/set` から設定してください。', ...EPH });
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return interaction.reply({ content: '❌ サーバーにいないユーザーです。', ...EPH });
            if (!member.roles.cache.has(muteRoleId)) return interaction.reply({ content: '⚠️ このユーザーはミュートされていません。', ...EPH });
            await member.roles.remove(muteRoleId);
            const embed = new EmbedBuilder().setTitle('🔊 ミュート解除').setColor(0x57f287).addFields({ name: '対象', value: `${target.tag} (${target.id})` }).setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'serverlock') {
            const action = options.getString('action');
            const conf = servers[guildId];
            const exemptRoles = conf?.serverLockExemptRoles || [];
            const exemptChannels = conf?.serverLockExemptChannels || [];
            await interaction.deferReply({ ...EPH });
            const isLock = action === 'lock';
            const textChannels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText && !exemptChannels.includes(c.id));
            const allRoles = interaction.guild.roles.cache.filter(r =>
                r.id !== interaction.guild.id &&
                !r.managed &&
                !exemptRoles.includes(r.id) &&
                !r.permissions.has(PermissionFlagsBits.Administrator)
            );
            // 全対象ロールの権限を剥奪/復元
            for (const [, role] of allRoles) {
                await role.setPermissions(isLock ? 0n : role.permissions).catch(() => {});
            }
            // 全対象チャンネルの@everyoneのViewChannelを剥奪/復元
            for (const [, ch] of textChannels) {
                await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: isLock ? false : null }).catch(() => {});
            }
            servers[guildId].serverLocked = isLock;
            saveData(SERVERS_FILE, servers);
            const embed = new EmbedBuilder()
                .setTitle(isLock ? '🔒 サーバーロック実行' : '🔓 サーバーロック解除')
                .setDescription(isLock ? '対象ロールの権限を剥奪し、全チャンネルの閲覧を制限しました。' : 'サーバーロックを解除しました。')
                .setColor(isLock ? 0xff0000 : 0x57f287)
                .addFields(
                    { name: '除外ロール', value: exemptRoles.length > 0 ? exemptRoles.map(r => `<@&${r}>`).join(' ') : 'なし', inline: true },
                    { name: '除外チャンネル', value: exemptChannels.length > 0 ? exemptChannels.map(c => `<#${c}>`).join(' ') : 'なし', inline: true }
                ).setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }

        // econコマンド
        const econCommandNames = ['balance','daily','work','transfer','shop','buy','inventory','econrank','additem','removeitem','give'];
        if (econCommandNames.includes(commandName)) {
            await handleEcon(interaction);
        }
    }

    // ==================== セレクトメニュー ====================
    if (interaction.isChannelSelectMenu()) {
        const cid = interaction.customId;
        const channelId = interaction.values[0];
        if (cid === 'select_log_channel') {
            servers[guildId].logChannel = channelId;
            saveData(SERVERS_FILE, servers);
            await interaction.update({ content: `✅ ログ送信先を <#${channelId}> に設定しました。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }
        if (cid === 'select_welcome_channel') {
            pendingWelcomeChannel.set(`${guildId}_${interaction.user.id}`, channelId);
            const modal = new ModalBuilder().setCustomId('modal_welcome_message').setTitle('入室通知メッセージ');
            const input = new TextInputBuilder().setCustomId('welcome_message').setLabel('通知メッセージ').setStyle(TextInputStyle.Paragraph).setPlaceholder('{user} {server} {members} が使えます').setRequired(true);
            if (servers[guildId].welcome?.message) input.setValue(servers[guildId].welcome.message);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
        if (cid === 'select_bye_channel') {
            pendingByeChannel.set(`${guildId}_${interaction.user.id}`, channelId);
            const modal = new ModalBuilder().setCustomId('modal_bye_message').setTitle('退室通知メッセージ');
            const input = new TextInputBuilder().setCustomId('bye_message').setLabel('通知メッセージ').setStyle(TextInputStyle.Paragraph).setPlaceholder('{user} {server} {members} が使えます').setRequired(true);
            if (servers[guildId].bye?.message) input.setValue(servers[guildId].bye.message);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
        if (cid === 'select_kaso_exclude_add') {
            if (!servers[guildId].kasoIgnoreChannels) servers[guildId].kasoIgnoreChannels = [];
            if (!servers[guildId].kasoIgnoreChannels.includes(channelId)) {
                servers[guildId].kasoIgnoreChannels.push(channelId);
                saveData(SERVERS_FILE, servers);
                await interaction.update({ content: `✅ <#${channelId}> を除外しました。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_kaso').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
            } else {
                await interaction.update({ content: '⚠️ そのチャンネルは既に除外されています。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_kaso').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
            }
        }
        if (cid === 'select_kaso_exclude_del') {
            const before = servers[guildId].kasoIgnoreChannels?.length || 0;
            servers[guildId].kasoIgnoreChannels = (servers[guildId].kasoIgnoreChannels || []).filter(c => c !== channelId);
            saveData(SERVERS_FILE, servers);
            if ((servers[guildId].kasoIgnoreChannels?.length || 0) < before) {
                await interaction.update({ content: `✅ <#${channelId}> の除外を解除しました。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_kaso').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
            } else {
                await interaction.update({ content: '⚠️ そのチャンネルは除外リストにありません。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_kaso').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
            }
        }
        const backToServerLock = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_serverlock').setLabel('← 戻る').setStyle(ButtonStyle.Secondary));
        if (cid === 'select_serverlock_ch_add') {
            if (!servers[guildId].serverLockExemptChannels) servers[guildId].serverLockExemptChannels = [];
            if (!servers[guildId].serverLockExemptChannels.includes(channelId)) {
                servers[guildId].serverLockExemptChannels.push(channelId);
                saveData(SERVERS_FILE, servers);
                await interaction.update({ content: `✅ <#${channelId}> を除外チャンネルに追加しました。`, components: [backToServerLock] });
            } else {
                await interaction.update({ content: '⚠️ 既に除外されています。', components: [backToServerLock] });
            }
        }
        if (cid === 'select_serverlock_ch_del') {
            const before = servers[guildId].serverLockExemptChannels?.length || 0;
            servers[guildId].serverLockExemptChannels = (servers[guildId].serverLockExemptChannels || []).filter(c => c !== channelId);
            saveData(SERVERS_FILE, servers);
            if ((servers[guildId].serverLockExemptChannels?.length || 0) < before) {
                await interaction.update({ content: `✅ <#${channelId}> の除外を解除しました。`, components: [backToServerLock] });
            } else {
                await interaction.update({ content: '⚠️ そのチャンネルは除外リストにありません。', components: [backToServerLock] });
            }
        }
    }

    if (interaction.isRoleSelectMenu()) {
        const cid = interaction.customId;
        const roleId = interaction.values[0];
        if (cid === 'select_ngword_exempt_add') {
            if (!servers[guildId].ngwordExemptRoles) servers[guildId].ngwordExemptRoles = [];
            if (!servers[guildId].ngwordExemptRoles.includes(roleId)) {
                servers[guildId].ngwordExemptRoles.push(roleId);
                saveData(SERVERS_FILE, servers);
                await interaction.update({ content: `✅ <@&${roleId}> を除外ロールに追加しました。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
            } else {
                await interaction.update({ content: '⚠️ そのロールは既に登録されています。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
            }
        }
        if (cid === 'select_ngword_exempt_del') {
            const before = servers[guildId].ngwordExemptRoles?.length || 0;
            servers[guildId].ngwordExemptRoles = (servers[guildId].ngwordExemptRoles || []).filter(r => r !== roleId);
            saveData(SERVERS_FILE, servers);
            if ((servers[guildId].ngwordExemptRoles?.length || 0) < before) {
                await interaction.update({ content: `✅ <@&${roleId}> を除外ロールから削除しました。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
            } else {
                await interaction.update({ content: '⚠️ そのロールは登録されていません。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
            }
        }
        const backToSLRole = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_serverlock').setLabel('← 戻る').setStyle(ButtonStyle.Secondary));
        if (cid === 'select_serverlock_role_add') {
            if (!servers[guildId].serverLockExemptRoles) servers[guildId].serverLockExemptRoles = [];
            if (!servers[guildId].serverLockExemptRoles.includes(roleId)) {
                servers[guildId].serverLockExemptRoles.push(roleId);
                saveData(SERVERS_FILE, servers);
                await interaction.update({ content: `✅ <@&${roleId}> を除外ロールに追加しました。`, components: [backToSLRole] });
            } else {
                await interaction.update({ content: '⚠️ 既に登録されています。', components: [backToSLRole] });
            }
        }
        if (cid === 'select_serverlock_role_del') {
            const before = servers[guildId].serverLockExemptRoles?.length || 0;
            servers[guildId].serverLockExemptRoles = (servers[guildId].serverLockExemptRoles || []).filter(r => r !== roleId);
            saveData(SERVERS_FILE, servers);
            if ((servers[guildId].serverLockExemptRoles?.length || 0) < before) {
                await interaction.update({ content: `✅ <@&${roleId}> を除外ロールから削除しました。`, components: [backToSLRole] });
            } else {
                await interaction.update({ content: '⚠️ そのロールは登録されていません。', components: [backToSLRole] });
            }
        }
    }

    // ==================== モーダル ====================
    if (interaction.isModalSubmit()) {
        const cid = interaction.customId;
        if (cid === 'modal_welcome_message') {
            const message = interaction.fields.getTextInputValue('welcome_message');
            const channelId = pendingWelcomeChannel.get(`${guildId}_${interaction.user.id}`);
            if (!channelId) return interaction.reply({ content: '❌ タイムアウトしました。再度設定してください。', ...EPH });
            pendingWelcomeChannel.delete(`${guildId}_${interaction.user.id}`);
            servers[guildId].welcome = { channel: channelId, message };
            saveData(SERVERS_FILE, servers);
            await interaction.reply({ content: `✅ 入室通知を <#${channelId}> に設定しました。\nメッセージ: \`${message}\`\n変数: \`{user}\` \`{server}\` \`{members}\``, ...EPH });
        }
        if (cid === 'modal_bye_message') {
            const message = interaction.fields.getTextInputValue('bye_message');
            const channelId = pendingByeChannel.get(`${guildId}_${interaction.user.id}`);
            if (!channelId) return interaction.reply({ content: '❌ タイムアウトしました。再度設定してください。', ...EPH });
            pendingByeChannel.delete(`${guildId}_${interaction.user.id}`);
            servers[guildId].bye = { channel: channelId, message };
            saveData(SERVERS_FILE, servers);
            await interaction.reply({ content: `✅ 退室通知を <#${channelId}> に設定しました。\nメッセージ: \`${message}\`\n変数: \`{user}\` \`{server}\` \`{members}\``, ...EPH });
        }
        if (cid === 'modal_ngword_add') {
            const word = interaction.fields.getTextInputValue('ngword_input').trim();
            if (!word) return interaction.reply({ content: '❌ ワードを入力してください。', ...EPH });
            if (!servers[guildId].ngwords) servers[guildId].ngwords = [];
            if (!servers[guildId].ngwords.includes(word)) {
                servers[guildId].ngwords.push(word);
                saveData(SERVERS_FILE, servers);
                await interaction.reply({ content: `✅ 「${word}」をNGワードに追加しました。`, ...EPH });
            } else { await interaction.reply({ content: '⚠️ そのワードは既に登録されています。', ...EPH }); }
        }
        if (cid === 'modal_ngword_del') {
            const word = interaction.fields.getTextInputValue('ngword_input').trim();
            const before = servers[guildId].ngwords?.length || 0;
            servers[guildId].ngwords = (servers[guildId].ngwords || []).filter(w => w !== word);
            saveData(SERVERS_FILE, servers);
            if ((servers[guildId].ngwords?.length || 0) < before) { await interaction.reply({ content: `✅ 「${word}」をNGワードから削除しました。`, ...EPH }); }
            else { await interaction.reply({ content: '⚠️ そのワードは登録されていません。', ...EPH }); }
        }
        if (cid === 'modal_ngword_timeout') {
            const sec = parseInt(interaction.fields.getTextInputValue('timeout_seconds').trim());
            if (isNaN(sec) || sec < 0) return interaction.reply({ content: '❌ 正しい秒数を入力してください。', ...EPH });
            servers[guildId].ngwordTimeoutSeconds = sec;
            saveData(SERVERS_FILE, servers);
            await interaction.reply({ content: `✅ タイムアウト秒数を ${sec}秒 に設定しました。`, ...EPH });
        }
        if (cid === 'modal_ngword_violation') {
            const count = parseInt(interaction.fields.getTextInputValue('violation_count').trim());
            if (isNaN(count) || count < 1) return interaction.reply({ content: '❌ 1以上の数値を入力してください。', ...EPH });
            servers[guildId].ngwordViolationLimit = count;
            saveData(SERVERS_FILE, servers);
            await interaction.reply({ content: `✅ 連呼罰則を ${count}回 に設定しました。`, ...EPH });
        }
        if (cid === 'modal_mute_role') {
            const roleName = interaction.fields.getTextInputValue('mute_role_name').trim();
            if (!roleName) return interaction.reply({ content: '❌ ロール名を入力してください。', ...EPH });
            let role = interaction.guild.roles.cache.find(r => r.name === roleName);
            if (!role) {
                role = await interaction.guild.roles.create({ name: roleName, permissions: [], reason: 'ミュートロール自動作成' }).catch(() => null);
                if (!role) return interaction.reply({ content: '❌ ロールの作成に失敗しました。', ...EPH });
            }
            servers[guildId].muteRole = role.id;
            saveData(SERVERS_FILE, servers);
            await interaction.reply({ content: `✅ ミュートロールを <@&${role.id}> に設定しました。`, ...EPH });
        }
    }

    // ==================== ボタン ====================
    if (interaction.isButton()) {
        const cid = interaction.customId;

        if (cid === 'delete_reply') {
            await interaction.message.delete().catch(() => {});
            return;
        }

        if (cid.startsWith('ranking_prev_') || cid.startsWith('ranking_next_')) {
            const isPrev = cid.startsWith('ranking_prev_');
            const currentPage = parseInt(cid.split('_')[2]);
            const newPage = isPrev ? currentPage - 1 : currentPage + 1;
            const sorted = getAllRanking(users);
            const { embed, safePage, totalPages } = buildRankingEmbed(sorted, newPage);
            await interaction.update({ embeds: [embed], components: totalPages > 1 ? [buildRankingRow(safePage, totalPages)] : [] });
        }

        if (cid === 'set_menu_log') {
            const select = new ChannelSelectMenuBuilder().setCustomId('select_log_channel').setPlaceholder('ログ送信先チャンネルを選択').addChannelTypes(ChannelType.GuildText);
            const lc = servers[guildId].logConfig;
            await interaction.update({ content: `📋 **ログ設定**\n\n現在のログチャンネル: ${servers[guildId].logChannel ? `<#${servers[guildId].logChannel}>` : '未設定'}\n\nチャンネルを選択してください。`, components: [new ActionRowBuilder().addComponents(select), ...createLogConfigRows(lc)] });
        }
        if (cid === 'set_back_main') await interaction.update(buildSetPanel(servers[guildId]));
        if (cid === 'set_lv_toggle') { servers[guildId].leveling = !servers[guildId].leveling; saveData(SERVERS_FILE, servers); await interaction.update(buildSetPanel(servers[guildId])); }
        if (cid === 'set_menu_lock') {
            servers[guildId].locked = !servers[guildId].locked;
            const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
            for (const [, ch] of channels) await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: servers[guildId].locked ? false : null }).catch(() => {});
            saveData(SERVERS_FILE, servers);
            await interaction.update(buildSetPanel(servers[guildId]));
        }
        if (cid.startsWith('log_toggle_')) {
            const key = cid.replace('log_toggle_', '');
            if (!servers[guildId].logConfig) servers[guildId].logConfig = {};
            servers[guildId].logConfig[key] = !servers[guildId].logConfig[key];
            saveData(SERVERS_FILE, servers);
            const select = new ChannelSelectMenuBuilder().setCustomId('select_log_channel').setPlaceholder('ログ送信先チャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({ content: `📋 **ログ設定**\n\n現在のログチャンネル: ${servers[guildId].logChannel ? `<#${servers[guildId].logChannel}>` : '未設定'}`, components: [new ActionRowBuilder().addComponents(select), ...createLogConfigRows(servers[guildId].logConfig)] });
        }
        if (cid === 'set_menu_welcome') {
            const current = servers[guildId].welcome;
            const select = new ChannelSelectMenuBuilder().setCustomId('select_welcome_channel').setPlaceholder('送信先チャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({ content: `📥 **入室通知設定**\n\n現在: ${current?.channel ? `<#${current.channel}>` : '未設定'}\nメッセージ: ${current?.message || '未設定'}\n\nチャンネルを選択後、メッセージを入力します。`, components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }
        if (cid === 'set_menu_bye') {
            const current = servers[guildId].bye;
            const select = new ChannelSelectMenuBuilder().setCustomId('select_bye_channel').setPlaceholder('送信先チャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({ content: `📤 **退室通知設定**\n\n現在: ${current?.channel ? `<#${current.channel}>` : '未設定'}\nメッセージ: ${current?.message || '未設定'}\n\nチャンネルを選択後、メッセージを入力します。`, components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }
        if (cid === 'set_menu_ngword') await interaction.update(buildNgwordPanel(servers[guildId]));
        if (cid === 'ngword_add') {
            const modal = new ModalBuilder().setCustomId('modal_ngword_add').setTitle('NGワード追加');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ngword_input').setLabel('追加するワード').setStyle(TextInputStyle.Short).setRequired(true)));
            await interaction.showModal(modal);
        }
        if (cid === 'ngword_del') {
            const modal = new ModalBuilder().setCustomId('modal_ngword_del').setTitle('NGワード削除');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ngword_input').setLabel('削除するワード').setStyle(TextInputStyle.Short).setRequired(true)));
            await interaction.showModal(modal);
        }
        if (cid === 'ngword_exempt_add') {
            const select = new RoleSelectMenuBuilder().setCustomId('select_ngword_exempt_add').setPlaceholder('除外するロールを選択');
            await interaction.update({ content: '🔓 **除外ロール追加**\n\n除外するロールを選択してください。', components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }
        if (cid === 'ngword_exempt_del') {
            const select = new RoleSelectMenuBuilder().setCustomId('select_ngword_exempt_del').setPlaceholder('削除するロールを選択');
            await interaction.update({ content: '🔒 **除外ロール削除**\n\n削除するロールを選択してください。', components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }
        if (cid === 'ngword_timeout_set') {
            const modal = new ModalBuilder().setCustomId('modal_ngword_timeout').setTitle('タイムアウト秒数設定');
            const input = new TextInputBuilder().setCustomId('timeout_seconds').setLabel('秒数 (0=タイムアウトなし)').setStyle(TextInputStyle.Short).setPlaceholder('例: 300').setRequired(true);
            if (servers[guildId].ngwordTimeoutSeconds != null) input.setValue(String(servers[guildId].ngwordTimeoutSeconds));
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
        if (cid === 'ngword_violation_set') {
            const modal = new ModalBuilder().setCustomId('modal_ngword_violation').setTitle('連呼罰則回数設定');
            const input = new TextInputBuilder().setCustomId('violation_count').setLabel('何回でタイムアウトするか').setStyle(TextInputStyle.Short).setPlaceholder('例: 3').setRequired(true);
            if (servers[guildId].ngwordViolationLimit != null) input.setValue(String(servers[guildId].ngwordViolationLimit));
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
        if (cid === 'set_menu_kaso') {
            const ignored = servers[guildId].kasoIgnoreChannels || [];
            const list = ignored.length > 0 ? ignored.map(c => `<#${c}>`).join('、') : 'なし';
            const selectAdd = new ChannelSelectMenuBuilder().setCustomId('select_kaso_exclude_add').setPlaceholder('除外するチャンネルを選択').addChannelTypes(ChannelType.GuildText);
            const selectDel = new ChannelSelectMenuBuilder().setCustomId('select_kaso_exclude_del').setPlaceholder('除外を解除するチャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({ content: `📊 **調査除外設定**\n\n除外チャンネル: ${list}\n※ticket-チャンネルは自動除外`, components: [new ActionRowBuilder().addComponents(selectAdd), new ActionRowBuilder().addComponents(selectDel), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }
        if (cid === 'set_menu_mute') {
            const modal = new ModalBuilder().setCustomId('modal_mute_role').setTitle('ミュートロール設定');
            const input = new TextInputBuilder().setCustomId('mute_role_name').setLabel('ロール名（なければ自動作成）').setStyle(TextInputStyle.Short).setPlaceholder('例: Muted').setRequired(true);
            const current = servers[guildId].muteRole ? interaction.guild.roles.cache.get(servers[guildId].muteRole)?.name : null;
            if (current) input.setValue(current);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
        if (cid === 'set_menu_serverlock') {
            const conf = servers[guildId];
            const exemptRoles = conf.serverLockExemptRoles || [];
            const exemptChannels = conf.serverLockExemptChannels || [];
            const content = `🔒 **サーバーロック設定**\n\n除外ロール: ${exemptRoles.length > 0 ? exemptRoles.map(r => `<@&${r}>`).join(' ') : 'なし'}\n除外チャンネル: ${exemptChannels.length > 0 ? exemptChannels.map(c => `<#${c}>`).join(' ') : 'なし'}\n\n※ロック実行は \`/serverlock\` から`;
            const selectRoleAdd = new RoleSelectMenuBuilder().setCustomId('select_serverlock_role_add').setPlaceholder('除外ロールを追加');
            const selectRoleDel = new RoleSelectMenuBuilder().setCustomId('select_serverlock_role_del').setPlaceholder('除外ロールを削除');
            const selectChAdd = new ChannelSelectMenuBuilder().setCustomId('select_serverlock_ch_add').setPlaceholder('除外チャンネルを追加').addChannelTypes(ChannelType.GuildText);
            const selectChDel = new ChannelSelectMenuBuilder().setCustomId('select_serverlock_ch_del').setPlaceholder('除外チャンネルを削除').addChannelTypes(ChannelType.GuildText);
            await interaction.update({ content, components: [
                new ActionRowBuilder().addComponents(selectRoleAdd),
                new ActionRowBuilder().addComponents(selectRoleDel),
                new ActionRowBuilder().addComponents(selectChAdd),
                new ActionRowBuilder().addComponents(selectChDel),
                new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('← 戻る').setStyle(ButtonStyle.Secondary))
            ]});
        }
        if (cid.startsWith('ticket_open_')) {
            const mid = cid.split('_')[2];
            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: mid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });
            const closeBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `<@&${mid}> チケット作成ありがとうございます！ \n管理者が来るまでお待ちください`, components: [closeBtn] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ...EPH });
        }
        if (cid === 'ticket_close') {
            await interaction.reply('チケットを閉鎖します...');
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
        }
        if (cid === 'rp_delete_panel') {
            const msgs = await interaction.channel.messages.fetch({ limit: 50 });
            const panel = msgs.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components.some(c => c.customId?.startsWith('rp_')));
            if (!panel) return interaction.reply({ content: '❌ 近くに役職パネルが見つかりませんでした。', ...EPH });
            await panel.delete().catch(() => {});
            await interaction.reply({ content: '✅ 役職パネルを削除しました。', ...EPH });
        }
        if (cid.startsWith('rp_') && cid !== 'rp_delete_panel') {
            const rid = cid.split('_')[1];
            if (interaction.member.roles.cache.has(rid)) { await interaction.member.roles.remove(rid); await interaction.reply({ content: '役職を解除しました。', ...EPH }); }
            else { await interaction.member.roles.add(rid); await interaction.reply({ content: '役職を付与しました。', ...EPH }); }
        }
    }
});

// ==================== メッセージイベント ====================
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.content.startsWith('!') && OWNER_IDS.includes(message.author.id)) {
        const args = message.content.slice(1).trim().split(/\s+/);
        const cmd = args.shift().toLowerCase();

        if (cmd === 'kick') {
            const input = args[0];
            if (!input) return message.reply('使用法: !kick [ユーザーID or メンション] [理由]');
            const userId = input.replace(/[<@!>]/g, '');
            const reason = args.slice(1).join(' ') || '理由なし';
            if (!message.guild) return message.reply('❌ サーバー内で使用してください。');
            const member = await message.guild.members.fetch(userId).catch(() => null);
            if (!member) return message.reply('❌ ユーザーが見つかりません。');
            if (!member.kickable) return message.reply('❌ このユーザーをキックできません。');
            await member.kick(reason);
            return message.reply(`👢 **${member.user.tag}** をキックしました。理由: ${reason}`);
        }

        if (cmd === 'ban') {
            const input = args[0];
            if (!input) return message.reply('使用法: !ban [ユーザーID or メンション] [理由]');
            const userId = input.replace(/[<@!>]/g, '');
            const reason = args.slice(1).join(' ') || '理由なし';
            if (!message.guild) return message.reply('❌ サーバー内で使用してください。');
            const member = await message.guild.members.fetch(userId).catch(() => null);
            if (member && !member.bannable) return message.reply('❌ このユーザーをBANできません。');
            await message.guild.members.ban(userId, { reason });
            return message.reply(`🔨 \`${userId}\` をBANしました。理由: ${reason}`);
        }

        if (cmd === 'unban') {
            const input = args[0];
            if (!input) return message.reply('使用法: !unban [ユーザーID or メンション]');
            const userId = input.replace(/[<@!>]/g, '');
            if (!message.guild) return message.reply('❌ サーバー内で使用してください。');
            const banned = await message.guild.bans.fetch(userId).catch(() => null);
            if (!banned) return message.reply('❌ そのユーザーはBANされていません。');
            await message.guild.members.unban(userId);
            return message.reply(`🔓 \`${userId}\` のBANを解除しました。`);
        }

        await handleAdminCommands(message, client, OWNER_IDS, loadData, saveData, USERS_FILE);
        return;
    }
    if (!message.guild) return;
    const servers = loadData(SERVERS_FILE);
    const users = loadData(USERS_FILE);
    const gid = message.guildId;

    if (!message.channel.name?.startsWith('ticket-')) recordMessage(gid, message.channelId, message.author.id);

    // メッセージ送信ログ
    if (servers[gid]?.logConfig?.message_send) {
        const content = message.content || (message.attachments.size > 0 ? `[添付ファイル: ${message.attachments.map(a => a.name).join(', ')}]` : '[内容なし]');
        const embed = new EmbedBuilder().setTitle('💬 メッセージ送信').setDescription(`**送信者:** <@${message.author.id}>\n**チャンネル:** <#${message.channelId}>\n\n**内容:**\n${content.slice(0, 1000)}`).setColor(0x57f287).setTimestamp();
        await sendLog(message.guild, embed);
    }

    // NGワード判定
    if (servers[gid]?.ngwords?.length > 0) {
        const exempt = servers[gid].ngwordExemptRoles || [];
        if (!exempt.some(r => message.member?.roles?.cache?.has(r)) && containsNgWord(message.content, servers[gid].ngwords)) {
            await message.delete().catch(() => {});
            const key = `${gid}_${message.author.id}`;
            const now = Date.now();
            const v = ngwordViolations.get(key) || { count: 0, resetAt: now + 60000 };
            if (now > v.resetAt) { v.count = 0; v.resetAt = now + 60000; }
            v.count++;
            ngwordViolations.set(key, v);
            const limit = servers[gid].ngwordViolationLimit || 3;
            if (v.count >= limit) {
                ngwordViolations.delete(key);
                await message.member?.timeout((servers[gid].ngwordTimeoutSeconds || 60) * 1000, 'NGワード連呼').catch(() => {});
                return message.channel.send(`<@${message.author.id}> NGワードを連呼したため ${servers[gid].ngwordTimeoutSeconds || 60}秒 タイムアウトしました。`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            }
            return message.channel.send(`<@${message.author.id}> 不適切な言葉が含まれていたため削除しました。(${v.count}/${limit}回)`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
        }
    }

    // レベリング（30秒クールダウン）
    if (servers[gid]?.leveling !== false) {
        const key = `${gid}_${message.author.id}`;
        const now = Date.now();
        const last = xpCooldowns.get(key) || 0;
        if (now - last >= 30000) {
            xpCooldowns.set(key, now);
            if (!users[message.author.id]) users[message.author.id] = { xp: 0, lv: 0 };
            if (typeof users[message.author.id].xp !== 'number') users[message.author.id].xp = 0;
            if (typeof users[message.author.id].lv !== 'number') users[message.author.id].lv = 0;
            users[message.author.id].xp += 15;
            users[message.author.id].username = message.author.username;
            if (users[message.author.id].xp >= getNextLevelXP(users[message.author.id].lv)) {
                users[message.author.id].lv++;
                message.reply(`🎉 レベルアップ！ **Lv.${users[message.author.id].lv}** になりました！`);
            }
            saveData(USERS_FILE, users);
        }
    }

    // グローバルチャット
    if (servers[gid]?.gChatChannel === message.channelId) {
        const embed = new EmbedBuilder().setAuthor({ name: `${message.author.tag} (${message.guild.name})`, iconURL: message.author.displayAvatarURL() }).setDescription(message.content || ' ').setColor(0x00ff00).setTimestamp();
        if (message.attachments.size > 0) embed.setImage(message.attachments.first().url);
        for (const targetGid in servers) {
            const targetChId = servers[targetGid].gChatChannel;
            if (targetChId && targetChId !== message.channelId) {
                const ch = client.channels.cache.get(targetChId);
                if (ch) ch.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }
});

client.on(Events.MessageDelete, async (msg) => {
    if (!msg.guild || !msg.author || msg.author.bot) return;
    // snipeキャッシュ
    const key = `${msg.guildId}_${msg.channelId}`;
    snipeCache.set(key, {
        content: msg.content || '',
        authorTag: msg.author.tag,
        authorAvatar: msg.author.displayAvatarURL(),
        attachmentUrl: msg.attachments.first()?.url || null,
        timestamp: Date.now()
    });
    const s = loadData(SERVERS_FILE);
    if (s[msg.guildId]?.logConfig?.delete) {
        const embed = new EmbedBuilder().setTitle('🗑 メッセージ削除').setDescription(`**送信者:** <@${msg.author.id}>\n**チャンネル:** <#${msg.channelId}>\n\n**内容:**\n${msg.content || '内容なし'}`).setColor(0xff0000).setTimestamp();
        await sendLog(msg.guild, embed);
    }
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (!oldMsg.guild || !oldMsg.author || oldMsg.author.bot || oldMsg.content === newMsg.content) return;
    const s = loadData(SERVERS_FILE);
    if (s[oldMsg.guildId]?.logConfig?.edit) {
        const embed = new EmbedBuilder().setTitle('📝 メッセージ編集').setDescription(`**送信者:** <@${oldMsg.author.id}>\n**チャンネル:** <#${oldMsg.channelId}>\n\n**編集前:**\n${oldMsg.content}\n\n**編集後:**\n${newMsg.content}`).setColor(0xffff00).setTimestamp();
        await sendLog(oldMsg.guild, embed);
    }
});

client.on(Events.GuildMemberAdd, async (member) => {
    const s = loadData(SERVERS_FILE);
    const conf = s[member.guild.id];
    if (conf?.welcome) {
        const ch = member.guild.channels.cache.get(conf.welcome.channel);
        if (ch) ch.send(replacePlaceholders(conf.welcome.message, member));
    }
    if (conf?.logConfig?.join) {
        const embed = new EmbedBuilder().setTitle('📥 入室通知').setDescription(`<@${member.id}> が参加しました。`).setColor(0x00ff00).setTimestamp();
        await sendLog(member.guild, embed);
    }
    updateStatus();
});

client.on(Events.GuildMemberRemove, async (member) => {
    const s = loadData(SERVERS_FILE);
    const conf = s[member.guild.id];
    if (conf?.bye) {
        const ch = member.guild.channels.cache.get(conf.bye.channel);
        if (ch) ch.send(replacePlaceholders(conf.bye.message, member));
    }
    if (conf?.logConfig?.leave) {
        const embed = new EmbedBuilder().setTitle('📤 退出通知').setDescription(`<@${member.id}> が退出しました。`).setColor(0xffa500).setTimestamp();
        await sendLog(member.guild, embed);
    }
});

client.on(Events.GuildCreate, () => updateStatus());
client.on(Events.GuildDelete, () => updateStatus());

// チャンネル作成ログ
client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    const s = loadData(SERVERS_FILE);
    if (!s[channel.guild.id]?.logConfig?.channel) return;
    const embed = new EmbedBuilder().setTitle('📁 チャンネル作成').setDescription(`**名前:** <#${channel.id}> (\`${channel.name}\`)\n**種類:** ${channel.type === ChannelType.GuildText ? 'テキスト' : channel.type === ChannelType.GuildVoice ? 'ボイス' : 'その他'}`).setColor(0x00bfff).setTimestamp();
    await sendLog(channel.guild, embed);
});

// ロール付与/剥奪ログ
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const s = loadData(SERVERS_FILE);
    if (!s[newMember.guild.id]?.logConfig?.role) return;
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id) && r.id !== newMember.guild.id);
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id) && r.id !== newMember.guild.id);
    if (added.size === 0 && removed.size === 0) return;
    const lines = [];
    if (added.size > 0) lines.push(`**付与:** ${added.map(r => `<@&${r.id}>`).join(' ')}`);
    if (removed.size > 0) lines.push(`**剥奪:** ${removed.map(r => `<@&${r.id}>`).join(' ')}`);
    const embed = new EmbedBuilder().setTitle('🏷️ ロール変更').setDescription(`**対象:** <@${newMember.id}>\n${lines.join('\n')}`).setColor(added.size > 0 ? 0x57f287 : 0xed4245).setTimestamp();
    await sendLog(newMember.guild, embed);
});

// タイムアウトログ
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const s = loadData(SERVERS_FILE);
    if (!s[newMember.guild.id]?.logConfig?.timeout) return;
    const wasTimedOut = oldMember.communicationDisabledUntil;
    const isTimedOut = newMember.communicationDisabledUntil;
    if (!wasTimedOut && isTimedOut && new Date(isTimedOut) > new Date()) {
        const until = Math.floor(new Date(isTimedOut).getTime() / 1000);
        const embed = new EmbedBuilder().setTitle('🔇 タイムアウト').setDescription(`**対象:** <@${newMember.id}>\n**解除予定:** <t:${until}:R> (<t:${until}:F>)`).setColor(0xff6b35).setTimestamp();
        await sendLog(newMember.guild, embed);
    } else if (wasTimedOut && (!isTimedOut || new Date(isTimedOut) <= new Date())) {
        const embed = new EmbedBuilder().setTitle('🔊 タイムアウト解除').setDescription(`**対象:** <@${newMember.id}>`).setColor(0x57f287).setTimestamp();
        await sendLog(newMember.guild, embed);
    }
});

client.login(TOKEN);
