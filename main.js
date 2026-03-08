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

const TOKEN = process.env.TOKEN; 
const OWNER_ID = process.env.OWNER_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// --- データ管理 ---
function loadData(filePath) {
    if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) { fs.writeFileSync(filePath, JSON.stringify({}, null, 4)); return {}; }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
    const config = servers[guild.id];
    if (config && config.logChannel) {
        const channel = guild.channels.cache.get(config.logChannel);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    }
}

// --- 認証機能セットアップ ---
setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT}`));

// --- コマンド登録 ---
client.once(Events.ClientReady, async () => {
    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('ヘルプを表示'),
        new SlashCommandBuilder().setName('authset').setDescription('認証パネル作成').addStringOption(o=>o.setName('title').setDescription('題名').setRequired(true)).addStringOption(o=>o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o=>o.setName('button').setDescription('ボタン').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('付与ロール').setRequired(true)),
        // チャンネル指定を追加
        new SlashCommandBuilder().setName('welcome').setDescription('入室設定')
            .addChannelOption(o=>o.setName('channel').setDescription('送信先チャンネル').setRequired(true))
            .addStringOption(o=>o.setName('message').setDescription('{user}{server}{members}が使用可能')),
        new SlashCommandBuilder().setName('bye').setDescription('退室設定')
            .addChannelOption(o=>o.setName('channel').setDescription('送信先チャンネル').setRequired(true))
            .addStringOption(o=>o.setName('message').setDescription('{user}{server}{members}が使用可能')),
        new SlashCommandBuilder().setName('ticket').setDescription('チケットパネル').addStringOption(o=>o.setName('title').setDescription('題名').setRequired(true)).addStringOption(o=>o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o=>o.setName('button').setDescription('ボタン').setRequired(true)).addRoleOption(o=>o.setName('mention-role').setDescription('管理者ロール').setRequired(true)),
        new SlashCommandBuilder().setName('log').setDescription('ログ設定').addChannelOption(o=>o.setName('channel').setDescription('送信先').setRequired(true)),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャット設定').addChannelOption(o=>o.setName('channel').setDescription('送信先').setRequired(true)),
        new SlashCommandBuilder().setName('gdel').setDescription('解除'),
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル').addSubcommand(s=>s.setName('create').setDescription('作成').addStringOption(o=>o.setName('setup').setDescription('🍎,ID 🍌,ID').setRequired(true))).addSubcommand(s=>s.setName('delete').setDescription('削除')),
        new SlashCommandBuilder().setName('omikuji').setDescription('おみくじ')
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
});

// --- インタラクション ---
client.on(Events.InteractionCreate, async (interaction) => {
    const servers = loadData(SERVERS_FILE);
    const guildId = interaction.guildId;
    if (!servers[guildId]) servers[guildId] = {};

    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'welcome') {
            const ch = options.getChannel('channel');
            const msg = options.getString('message');
            if (msg) {
                servers[guildId].welcome = { channel: ch.id, message: msg };
                await interaction.reply(`入室通知を ${ch} に設定しました。`);
            } else {
                delete servers[guildId].welcome;
                await interaction.reply('入室通知を解除しました。');
            }
            saveData(SERVERS_FILE, servers);
        }

        if (commandName === 'bye') {
            const ch = options.getChannel('channel');
            const msg = options.getString('message');
            if (msg) {
                servers[guildId].bye = { channel: ch.id, message: msg };
                await interaction.reply(`退室通知を ${ch} に設定しました。`);
            } else {
                delete servers[guildId].bye;
                await interaction.reply('退室通知を解除しました。');
            }
            saveData(SERVERS_FILE, servers);
        }

        // --- その他のコマンド (省略なしで維持) ---
        if (commandName === 'help') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [
                new EmbedBuilder().setTitle('MaidBot ガイド (1/2)').setColor(0x7289DA).addFields({ name: '`/help`', value: 'ヘルプを表示' }, { name: '`/omikuji`', value: '運勢を占う' })
            ], components: [row], ephemeral: true });
        }
        if (commandName === 'authset') {
            servers[guildId].authRole = options.getRole('role').id; saveData(SERVERS_FILE, servers);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('auth_button').setLabel(options.getString('button')).setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x43B581)], components: [row] });
        }
        if (commandName === 'log') { servers[guildId].logChannel = options.getChannel('channel').id; saveData(SERVERS_FILE, servers); await interaction.reply('ログ設定完了'); }
        if (commandName === 'gset') { servers[guildId].gChatChannel = options.getChannel('channel').id; saveData(SERVERS_FILE, servers); await interaction.reply('グローバルチャット設定完了'); }
        if (commandName === 'gdel') { delete servers[guildId].gChatChannel; saveData(SERVERS_FILE, servers); await interaction.reply('解除完了'); }
        if (commandName === 'omikuji') { await interaction.reply(`運勢：**${['大吉','中吉','小吉','吉','末吉','凶','大凶'][Math.floor(Math.random()*7)]}**`); }
        if (commandName === 'ticket') {
            const mId = options.getRole('mention-role').id;
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_open_${mId}`).setLabel(options.getString('button')).setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x5865F2)], components: [row] });
        }
        if (commandName === 'rp' && options.getSubcommand() === 'create') {
            const row = new ActionRowBuilder();
            options.getString('setup').split(' ').slice(0, 20).forEach(p => { 
                const [e, r] = p.split(','); 
                if(e && r) row.addComponents(new ButtonBuilder().setCustomId(`rp_${r}`).setLabel(`${e}取得`).setStyle(ButtonStyle.Primary)); 
            });
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle('役職パネル')], components: [row] });
        }
    }

    // --- ボタン処理 ---
    if (interaction.isButton()) {
        if (interaction.customId === 'help_prev') await interaction.update({ embeds: [new EmbedBuilder().setTitle('MaidBot ガイド (1/2)').setColor(0x7289DA).addFields({ name: '`/help`', value: 'ヘルプ' }, { name: '`/omikuji`', value: 'おみくじ' })], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary))] });
        if (interaction.customId === 'help_next') await interaction.update({ embeds: [new EmbedBuilder().setTitle('MaidBot ガイド (2/2)').setColor(0x7289DA).addFields({ name: '`/welcome` / `/bye`', value: '通知' }, { name: '`/log`', value: 'ログ' }, { name: '`/authset`', value: '認証' }, { name: '`/ticket`', value: 'チケット' }, { name: '`/gset`', value: 'グローバル' }, { name: '`/rp`', value: '役職' })], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(false), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary).setDisabled(true))] });
        if (interaction.customId === 'auth_button') {
            const rId = servers[guildId]?.authRole;
            if (rId) { await interaction.member.roles.add(rId).catch(()=>{}); await interaction.reply({ content: '完了', ephemeral: true }); }
        }
        if (interaction.customId.startsWith('ticket_open_')) {
            const mId = interaction.customId.split('_')[2];
            try {
                const ch = await interaction.guild.channels.create({ name: `ticket-${interaction.user.username}`, type: ChannelType.GuildText, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, { id: mId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] });
                await ch.send({ content: `<@&${mId}> お待ちください。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('閉じる').setStyle(ButtonStyle.Danger))] });
                await interaction.reply({ content: `作成完了: ${ch}`, ephemeral: true });
            } catch (e) { await interaction.reply('エラー'); }
        }
        if (interaction.customId === 'ticket_close') await interaction.channel.delete();
        if (interaction.customId.startsWith('rp_')) {
            const rId = interaction.customId.split('_')[1];
            if (interaction.member.roles.cache.has(rId)) { await interaction.member.roles.remove(rId); await interaction.reply({ content: '削除', ephemeral: true }); }
            else { await interaction.member.roles.add(rId); await interaction.reply({ content: '追加', ephemeral: true }); }
        }
    }
});

// --- イベント（参加・退出・編集・削除） ---
client.on(Events.GuildMemberAdd, async (m) => {
    const s = loadData(SERVERS_FILE);
    const conf = s[m.guild.id]?.welcome;
    if (conf) {
        const ch = m.guild.channels.cache.get(conf.channel);
        if (ch) ch.send(replacePlaceholders(conf.message, m));
    }
    await sendLog(m.guild, new EmbedBuilder().setTitle('📥 参加').setColor(0x00FFFF).setDescription(`${m.user.tag} が参加しました。`));
});

client.on(Events.GuildMemberRemove, async (m) => {
    const s = loadData(SERVERS_FILE);
    const conf = s[m.guild.id]?.bye;
    if (conf) {
        const ch = m.guild.channels.cache.get(conf.channel);
        if (ch) ch.send(replacePlaceholders(conf.message, m));
    }
    await sendLog(m.guild, new EmbedBuilder().setTitle('📤 退出').setColor(0xFF00FF).setDescription(`${m.user.tag} が退出しました。`));
});

client.on(Events.MessageUpdate, async (o, n) => {
    if (o.partial || o.author?.bot || o.content === n.content) return;
    await sendLog(o.guild, new EmbedBuilder().setTitle('📝 編集').setColor(0xFFA500).addFields({ name: 'ユーザー', value: `${o.author.tag}` }, { name: '元', value: o.content || '...' }, { name: '新', value: n.content || '...' }));
});

client.on(Events.MessageDelete, async (m) => {
    if (m.partial || m.author?.bot) return;
    await sendLog(m.guild, new EmbedBuilder().setTitle('🗑️ 削除').setColor(0xFF0000).addFields({ name: 'ユーザー', value: `${m.author.tag}` }, { name: '内容', value: m.content || '...' }));
});

// --- グローバルチャット & オーナーコマンド ---
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const servers = loadData(SERVERS_FILE);

    if (servers[msg.guildId]?.gChatChannel === msg.channelId) {
        const embed = new EmbedBuilder().setAuthor({ name: `${msg.author.tag} (${msg.guild.name})`, iconURL: msg.author.displayAvatarURL() }).setDescription(msg.content || '（本文なし）').setColor(0x00FF00);
        if (msg.attachments.size > 0 && msg.attachments.first().contentType?.startsWith('image/')) embed.setImage(msg.attachments.first().url);
        for (const tid in servers) {
            const cid = servers[tid].gChatChannel;
            if (cid && cid !== msg.channelId) {
                const ch = client.channels.cache.get(cid);
                if (ch) await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(()=>{});
            }
        }
    }

    if (msg.author.id === OWNER_ID && msg.content.startsWith('!')) {
        const users = loadData(USERS_FILE);
        if (msg.content === '!userlist') {
            const list = Object.entries(users).map(([id, u]) => `${u.tag || '不明'} (${id})`).join('\n');
            await msg.reply(`保存済みユーザー一覧:\n${list || 'なし'}`);
        }
        if (msg.content.startsWith('!call')) {
            for (const id in users) try { await msg.guild.members.add(id, { accessToken: users[id].accessToken }); } catch (e) {}
            await msg.reply('完了');
        }
    }
});

client.login(TOKEN);
