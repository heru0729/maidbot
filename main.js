const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, Events, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const setupAuth = require('./auth.js');
const handleAdminCommands = require('./admin.js');

const app = express();
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
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
// チャンネル選択後にメッセージ入力を待つための一時保存
const pendingWelcomeChannel = new Map();
const pendingByeChannel = new Map();
const EPH = { flags: MessageFlags.Ephemeral };

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

function createMainSetRow(s) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('set_menu_log').setLabel('ログ詳細設定').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_menu_kaso').setLabel('調査除外設定').setStyle(ButtonStyle.Primary),
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
function createLogConfigRow(c) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('log_toggle_edit').setLabel(`編集: ${c.edit ? 'ON' : 'OFF'}`).setStyle(c.edit ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_delete').setLabel(`削除: ${c.delete ? 'ON' : 'OFF'}`).setStyle(c.delete ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_join').setLabel(`入室: ${c.join ? 'ON' : 'OFF'}`).setStyle(c.join ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_leave').setLabel(`退出: ${c.leave ? 'ON' : 'OFF'}`).setStyle(c.leave ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary)
    );
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
function buildSetPanel(s) {
    return { content: '⚙️ **サーバー管理設定パネル**\n下のボタンから各機能の設定を行ってください。', components: [createMainSetRow(s), createMainSetRow2()], flags: MessageFlags.Ephemeral };
}

setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET);
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Web Server Ready'));

client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} としてログインしました。`);
    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('ボットのコマンド一覧を表示します'),
        new SlashCommandBuilder().setName('set').setDescription('サーバー管理用設定パネルを開きます').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('support').setDescription('サポートサーバーの招待リンクを表示します'),
        new SlashCommandBuilder().setName('rank').setDescription('現在のレベルとXPを確認します').addUserOption(o => o.setName('user').setDescription('確認したいユーザー')),
        new SlashCommandBuilder().setName('ranking').setDescription('レベルランキングを表示します').addIntegerOption(o => o.setName('page').setDescription('ページ番号')),
        new SlashCommandBuilder().setName('serverinfo').setDescription('現在のサーバーの詳細情報を表示します'),
        new SlashCommandBuilder().setName('userinfo').setDescription('ユーザーの詳細情報を表示します').addUserOption(o => o.setName('user').setDescription('対象ユーザー')),
        new SlashCommandBuilder().setName('clear').setDescription('指定した件数のメッセージを削除します').addIntegerOption(o => o.setName('num').setDescription('件数 (1-100)').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
        new SlashCommandBuilder().setName('log').setDescription('ログの送信先チャンネルを設定します').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('authset').setDescription('OAuth2認証用のパネルを設置します').addStringOption(o => o.setName('title').setDescription('埋め込みタイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('埋め込み説明').setRequired(true)).addStringOption(o => o.setName('button').setDescription('ボタンのラベル').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('認証後に付与するロール').setRequired(true)).addChannelOption(o => o.setName('channel').setDescription('設置先チャンネル（未指定なら現在）').addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('ticket').setDescription('問い合わせチケットパネルを作成します').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o => o.setName('button').setDescription('ボタン名').setRequired(true)).addRoleOption(o => o.setName('mention-role').setDescription('通知先ロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャットの送信先チャンネルを設定します').addChannelOption(o => o.setName('channel').setDescription('チャンネル').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('gdel').setDescription('グローバルチャットの設定を解除します').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('chatlock').setDescription('チャンネルを一時的にロックします').addIntegerOption(o => o.setName('seconds').setDescription('秒数').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占います'),
        new SlashCommandBuilder().setName('kaso').setDescription('過去1時間のサーバー稼働調査を表示します'),
        new SlashCommandBuilder().setName('rp').setDescription('セルフ役職付与パネルを作成します').addSubcommand(sub => {
            sub.setName('create').setDescription('パネル作成').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true));
            for (let i = 1; i <= 10; i++) sub.addRoleOption(o => o.setName(`role${i}`).setDescription(`役職${i}`)).addStringOption(o => o.setName(`emoji${i}`).setDescription(`絵文字${i}`));
            return sub;
        }).addSubcommand(sub => sub.setName('delete').setDescription('パネルから役職を削除するボタンを追加')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
        servers[guildId] = { logConfig: { edit: true, delete: true, join: true, leave: true }, ngwords: [], ngwordExemptRoles: [], ngwordTimeoutSeconds: 60, ngwordViolationLimit: 3, locked: false, kasoIgnoreChannels: [], leveling: true };
    }

    // ==================== スラッシュコマンド ====================
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('📖 コマンド一覧').setColor(0x3498db).addFields(
                { name: '/help', value: 'このメニューを表示', inline: true },
                { name: '/set', value: '管理設定パネル', inline: true },
                { name: '/support', value: 'サポートサーバー', inline: true },
                { name: '/rank [user]', value: 'レベル・XP確認', inline: true },
                { name: '/ranking', value: 'XPランキング', inline: true },
                { name: '/serverinfo', value: 'サーバー情報', inline: true },
                { name: '/userinfo [user]', value: 'ユーザー情報', inline: true },
                { name: '/clear [num]', value: 'メッセージ一括削除', inline: true },
                { name: '/log [channel]', value: 'ログ送信先設定', inline: true },
                { name: '/authset', value: 'OAuth2認証パネル設置', inline: true },
                { name: '/ticket', value: 'チケットパネル作成', inline: true },
                { name: '/gset / /gdel', value: 'グローバルチャット', inline: true },
                { name: '/chatlock [sec]', value: 'チャンネル一時ロック', inline: true },
                { name: '/omikuji', value: '今日の運勢', inline: true },
                { name: '/kaso', value: '過疎調査', inline: true },
                { name: '/rp create', value: '役職付与パネル作成', inline: true }
            );
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
            const sorted = Object.entries(users).filter(([, v]) => typeof v.xp === 'number').sort((a, b) => b[1].xp - a[1].xp);
            const rank = sorted.findIndex(e => e[0] === target.id) + 1;
            const embed = new EmbedBuilder().setTitle(`📊 ${target.username} のステータス`).setThumbnail(target.displayAvatarURL()).addFields(
                { name: '現在のレベル', value: `Lv.${lv}`, inline: true },
                { name: '現在のXP', value: `${xp} / ${next}`, inline: true },
                { name: '世界ランキング', value: rank > 0 ? `${rank}位` : '--', inline: true }
            ).setColor(0x2ecc71);
            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'ranking') {
            const page = options.getInteger('page') || 1;
            const sorted = Object.entries(users).filter(([, v]) => typeof v.xp === 'number').sort((a, b) => b[1].xp - a[1].xp);
            const start = (page - 1) * 20;
            const current = sorted.slice(start, start + 20);
            if (current.length === 0) return interaction.reply('該当するデータがありません。');
            const list = current.map((e, i) => `**${start + i + 1}.** <@${e[0]}> - Lv.${e[1].lv} (${e[1].xp} XP)`).join('\n');
            const embed = new EmbedBuilder().setTitle(`🏆 レベルランキング (${page}ページ目)`).setDescription(list).setColor(0xf1c40f).setFooter({ text: `全 ${sorted.length} ユーザー` });
            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'serverinfo') {
            const g = interaction.guild;
            const embed = new EmbedBuilder().setTitle(`🏰 ${g.name} サーバー詳細`).setThumbnail(g.iconURL()).addFields(
                { name: 'サーバーID', value: `\`${g.id}\``, inline: true },
                { name: 'オーナー', value: `<@${g.ownerId}>`, inline: true },
                { name: 'メンバー数', value: `${g.memberCount}人`, inline: true },
                { name: '作成日', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
                { name: 'ブースト数', value: `${g.premiumSubscriptionCount || 0}`, inline: true },
                { name: 'チャンネル数', value: `${g.channels.cache.size}`, inline: true }
            ).setColor(0x3498db);
            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'userinfo') {
            const user = options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(user.id);
            const embed = new EmbedBuilder().setTitle(`👤 ${user.tag} のユーザー情報`).setThumbnail(user.displayAvatarURL()).addFields(
                { name: 'ユーザーID', value: `\`${user.id}\``, inline: true },
                { name: 'サーバー参加日', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: false },
                { name: 'アカウント作成日', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '最上位ロール', value: `${member.roles.highest}`, inline: true }
            ).setColor(0x9b59b6);
            await interaction.reply({ embeds: [embed] });
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

        if (commandName === 'gset') { servers[guildId].gChatChannel = options.getChannel('channel').id; saveData(SERVERS_FILE, servers); await interaction.reply('グローバルチャットを有効にしました。'); }
        if (commandName === 'gdel') { delete servers[guildId].gChatChannel; saveData(SERVERS_FILE, servers); await interaction.reply('グローバルチャットを解除しました。'); }

        if (commandName === 'chatlock') {
            const sec = options.getInteger('seconds');
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            await interaction.reply(`${sec}秒間、このチャンネルをロックします。`);
            setTimeout(async () => { await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }); await interaction.channel.send('ロックが解除されました。'); }, sec * 1000);
        }

        if (commandName === 'omikuji') {
            const results = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];
            await interaction.reply(`今日のあなたの運勢は... **${results[Math.floor(Math.random() * results.length)]}** です！`);
        }

        if (commandName === 'kaso') {
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
            ).setFooter({ text: '直近60分間 / Bot除外' }).setTimestamp();
            await interaction.editReply({ embeds: [embed] });
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
    }

    // ==================== セレクトメニュー ====================
    if (interaction.isChannelSelectMenu()) {
        const cid = interaction.customId;
        const channelId = interaction.values[0];

        // ログチャンネル設定
        if (cid === 'select_log_channel') {
            servers[guildId].logChannel = channelId;
            saveData(SERVERS_FILE, servers);
            await interaction.update({ content: `✅ ログ送信先を <#${channelId}> に設定しました。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }

        // 入室通知チャンネル選択 → メッセージ入力モーダルへ
        if (cid === 'select_welcome_channel') {
            pendingWelcomeChannel.set(`${guildId}_${interaction.user.id}`, channelId);
            const modal = new ModalBuilder().setCustomId('modal_welcome_message').setTitle('入室通知メッセージ');
            const input = new TextInputBuilder().setCustomId('welcome_message').setLabel('通知メッセージ').setStyle(TextInputStyle.Paragraph).setPlaceholder('{user} {server} {members} が使えます').setRequired(true);
            if (servers[guildId].welcome?.message) input.setValue(servers[guildId].welcome.message);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

        // 退室通知チャンネル選択 → メッセージ入力モーダルへ
        if (cid === 'select_bye_channel') {
            pendingByeChannel.set(`${guildId}_${interaction.user.id}`, channelId);
            const modal = new ModalBuilder().setCustomId('modal_bye_message').setTitle('退室通知メッセージ');
            const input = new TextInputBuilder().setCustomId('bye_message').setLabel('通知メッセージ').setStyle(TextInputStyle.Paragraph).setPlaceholder('{user} {server} {members} が使えます').setRequired(true);
            if (servers[guildId].bye?.message) input.setValue(servers[guildId].bye.message);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

        // 調査除外チャンネル追加
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

        // 調査除外チャンネル削除
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
    }

    if (interaction.isRoleSelectMenu()) {
        const cid = interaction.customId;
        const roleId = interaction.values[0];

        // NGワード除外ロール追加
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

        // NGワード除外ロール削除
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
    }

    // ==================== モーダル ====================
    if (interaction.isModalSubmit()) {
        const cid = interaction.customId;

        // 入室通知メッセージ（チャンネルはセレクトメニューで選択済み）
        if (cid === 'modal_welcome_message') {
            const message = interaction.fields.getTextInputValue('welcome_message');
            const channelId = pendingWelcomeChannel.get(`${guildId}_${interaction.user.id}`);
            if (!channelId) return interaction.reply({ content: '❌ チャンネル選択がタイムアウトしました。再度設定してください。', ...EPH });
            pendingWelcomeChannel.delete(`${guildId}_${interaction.user.id}`);
            servers[guildId].welcome = { channel: channelId, message };
            saveData(SERVERS_FILE, servers);
            await interaction.reply({ content: `✅ 入室通知を <#${channelId}> に設定しました。\nメッセージ: \`${message}\`\n変数: \`{user}\` \`{server}\` \`{members}\``, ...EPH });
        }

        // 退室通知メッセージ（チャンネルはセレクトメニューで選択済み）
        if (cid === 'modal_bye_message') {
            const message = interaction.fields.getTextInputValue('bye_message');
            const channelId = pendingByeChannel.get(`${guildId}_${interaction.user.id}`);
            if (!channelId) return interaction.reply({ content: '❌ チャンネル選択がタイムアウトしました。再度設定してください。', ...EPH });
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
            } else {
                await interaction.reply({ content: '⚠️ そのワードは既に登録されています。', ...EPH });
            }
        }

        if (cid === 'modal_ngword_del') {
            const word = interaction.fields.getTextInputValue('ngword_input').trim();
            const before = servers[guildId].ngwords?.length || 0;
            servers[guildId].ngwords = (servers[guildId].ngwords || []).filter(w => w !== word);
            saveData(SERVERS_FILE, servers);
            if ((servers[guildId].ngwords?.length || 0) < before) {
                await interaction.reply({ content: `✅ 「${word}」をNGワードから削除しました。`, ...EPH });
            } else {
                await interaction.reply({ content: '⚠️ そのワードは登録されていません。', ...EPH });
            }
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
    }

    // ==================== ボタン ====================
    if (interaction.isButton()) {
        const cid = interaction.customId;

        if (cid === 'set_menu_log') {
            // ログ設定：チャンネル選択メニュー + ON/OFF切替
            const select = new ChannelSelectMenuBuilder().setCustomId('select_log_channel').setPlaceholder('ログ送信先チャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({
                content: `📋 **ログ設定**\n\n現在のログチャンネル: ${servers[guildId].logChannel ? `<#${servers[guildId].logChannel}>` : '未設定'}\n\nチャンネルを選択してください。`,
                components: [
                    new ActionRowBuilder().addComponents(select),
                    createLogConfigRow(servers[guildId].logConfig)
                ]
            });
        }

        if (cid === 'set_back_main') await interaction.update(buildSetPanel(servers[guildId]));

        if (cid === 'set_lv_toggle') {
            servers[guildId].leveling = !servers[guildId].leveling;
            saveData(SERVERS_FILE, servers);
            await interaction.update(buildSetPanel(servers[guildId]));
        }

        if (cid === 'set_menu_lock') {
            servers[guildId].locked = !servers[guildId].locked;
            const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
            for (const [, ch] of channels) await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: servers[guildId].locked ? false : null }).catch(() => {});
            saveData(SERVERS_FILE, servers);
            await interaction.update(buildSetPanel(servers[guildId]));
        }

        if (cid.startsWith('log_toggle_')) {
            const key = cid.replace('log_toggle_', '');
            servers[guildId].logConfig[key] = !servers[guildId].logConfig[key];
            saveData(SERVERS_FILE, servers);
            const select = new ChannelSelectMenuBuilder().setCustomId('select_log_channel').setPlaceholder('ログ送信先チャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({
                content: `📋 **ログ設定**\n\n現在のログチャンネル: ${servers[guildId].logChannel ? `<#${servers[guildId].logChannel}>` : '未設定'}`,
                components: [
                    new ActionRowBuilder().addComponents(select),
                    createLogConfigRow(servers[guildId].logConfig)
                ]
            });
        }

        // 入室通知設定 → チャンネル選択メニュー表示
        if (cid === 'set_menu_welcome') {
            const current = servers[guildId].welcome;
            const select = new ChannelSelectMenuBuilder().setCustomId('select_welcome_channel').setPlaceholder('送信先チャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({
                content: `📥 **入室通知設定**\n\n現在の設定:\nチャンネル: ${current?.channel ? `<#${current.channel}>` : '未設定'}\nメッセージ: ${current?.message || '未設定'}\n\nチャンネルを選択後、メッセージを入力します。`,
                components: [
                    new ActionRowBuilder().addComponents(select),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))
                ]
            });
        }

        // 退室通知設定 → チャンネル選択メニュー表示
        if (cid === 'set_menu_bye') {
            const current = servers[guildId].bye;
            const select = new ChannelSelectMenuBuilder().setCustomId('select_bye_channel').setPlaceholder('送信先チャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({
                content: `📤 **退室通知設定**\n\n現在の設定:\nチャンネル: ${current?.channel ? `<#${current.channel}>` : '未設定'}\nメッセージ: ${current?.message || '未設定'}\n\nチャンネルを選択後、メッセージを入力します。`,
                components: [
                    new ActionRowBuilder().addComponents(select),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))
                ]
            });
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

        // 除外ロール追加 → ロール選択メニュー表示
        if (cid === 'ngword_exempt_add') {
            const select = new RoleSelectMenuBuilder().setCustomId('select_ngword_exempt_add').setPlaceholder('除外するロールを選択');
            await interaction.update({
                content: '🔓 **除外ロール追加**\n\n除外するロールを選択してください。',
                components: [
                    new ActionRowBuilder().addComponents(select),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('戻る').setStyle(ButtonStyle.Secondary))
                ]
            });
        }

        // 除外ロール削除 → ロール選択メニュー表示
        if (cid === 'ngword_exempt_del') {
            const select = new RoleSelectMenuBuilder().setCustomId('select_ngword_exempt_del').setPlaceholder('削除するロールを選択');
            await interaction.update({
                content: '🔒 **除外ロール削除**\n\n削除するロールを選択してください。',
                components: [
                    new ActionRowBuilder().addComponents(select),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('戻る').setStyle(ButtonStyle.Secondary))
                ]
            });
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

        // 調査除外設定 → チャンネル選択メニュー表示
        if (cid === 'set_menu_kaso') {
            const ignored = servers[guildId].kasoIgnoreChannels || [];
            const list = ignored.length > 0 ? ignored.map(c => `<#${c}>`).join('、') : 'なし';
            const selectAdd = new ChannelSelectMenuBuilder().setCustomId('select_kaso_exclude_add').setPlaceholder('除外するチャンネルを選択').addChannelTypes(ChannelType.GuildText);
            const selectDel = new ChannelSelectMenuBuilder().setCustomId('select_kaso_exclude_del').setPlaceholder('除外を解除するチャンネルを選択').addChannelTypes(ChannelType.GuildText);
            await interaction.update({
                content: `📊 **調査除外設定**\n\n除外チャンネル: ${list}\n※ticket-チャンネルは自動除外`,
                components: [
                    new ActionRowBuilder().addComponents(selectAdd),
                    new ActionRowBuilder().addComponents(selectDel),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))
                ]
            });
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
            await channel.send({ content: `<@&${mid}> 問い合わせが届きました。`, components: [closeBtn] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ...EPH });
        }

        if (cid === 'ticket_close') {
            await interaction.reply('チケットを閉鎖します...');
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
        }

        if (cid.startsWith('rp_')) {
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
        await handleAdminCommands(message, client, OWNER_IDS, loadData, saveData, USERS_FILE);
        return;
    }
    if (!message.guild) return;
    const servers = loadData(SERVERS_FILE);
    const users = loadData(USERS_FILE);
    const gid = message.guildId;

    if (!message.channel.name?.startsWith('ticket-')) recordMessage(gid, message.channelId, message.author.id);

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

    if (servers[gid]?.leveling !== false) {
        const key = `${gid}_${message.author.id}`;
        const now = Date.now();
        if (now - (xpCooldowns.get(key) || 0) >= 30000) {
            xpCooldowns.set(key, now);
            if (!users[message.author.id]) users[message.author.id] = { xp: 0, lv: 0 };
            if (typeof users[message.author.id].xp !== 'number') users[message.author.id].xp = 0;
            if (typeof users[message.author.id].lv !== 'number') users[message.author.id].lv = 0;
            users[message.author.id].xp += 15;
            if (users[message.author.id].xp >= getNextLevelXP(users[message.author.id].lv)) {
                users[message.author.id].lv++;
                message.reply(`🎉 レベルアップ！ **Lv.${users[message.author.id].lv}** になりました！`);
            }
            saveData(USERS_FILE, users);
        }
    }

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

client.login(TOKEN);
