const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Railway Variables
const TOKEN = process.env.TOKEN; 
const OWNER_ID = process.env.OWNER_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// --- データ管理用関数 ---
function loadData(filePath) {
    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({}, null, 4));
        return {};
    }
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

// --- ウェブサーバー（認証処理） ---
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('認証コードがありません。');

    try {
        const redirectUri = `https://${req.get('host')}/callback`;
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            scope: 'identify guilds.join',
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const users = loadData(USERS_FILE);
        users[userResponse.data.id] = { accessToken: access_token };
        saveData(USERS_FILE, users);

        res.send('<h1>認証成功！</h1>このタブを閉じて大丈夫です。');
    } catch (error) {
        console.error('OAuth2 Error:', error.response?.data || error.message);
        res.status(500).send('認証エラーが発生しました。');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Web Server started on port ${PORT}`));

// --- ヘルプパネル生成 ---
function createHelpEmbed(page) {
    const commonDesc = '利用可能なスラッシュコマンド一覧です。';
    if (page === 1) {
        return new EmbedBuilder()
            .setTitle('MaidBot ガイド - 一般 (1/2)')
            .setColor(0x7289DA)
            .setDescription(commonDesc)
            .addFields(
                { name: '`/help`', value: 'ヘルプを表示。' },
                { name: '`/omikuji`', value: '運勢を占う。' }
            );
    } else {
        return new EmbedBuilder()
            .setTitle('MaidBot ガイド - 管理者 (2/2)')
            .setColor(0x7289DA)
            .setDescription(commonDesc)
            .addFields(
                { name: '`/welcome` / `/bye`', value: '入退室通知。空欄でOFF。' },
                { name: '`/log`', value: 'ログ送信先設定。' },
                { name: '`/authset`', value: '認証パネル作成。' },
                { name: '`/ticket`', value: 'チケットパネル作成。' },
                { name: '`/gset` / `/gdel`', value: 'グローバルチャット設定/解除。' },
                { name: '`/rp create` / `/rp delete`', value: '役職パネル作成/削除。' }
            );
    }
}

// --- ボット起動・コマンド登録 ---
client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} 起動完了`);
    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('ヘルプを表示'),
        new SlashCommandBuilder().setName('authset').setDescription('認証パネルを作成')
            .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('説明').setRequired(true))
            .addStringOption(o => o.setName('button').setDescription('ボタン文字').setRequired(true))
            .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true)),
        new SlashCommandBuilder().setName('welcome').setDescription('入室通知（空欄でOFF）')
            .addStringOption(o => o.setName('message').setDescription('{user}{server}{members}が使用可能')),
        new SlashCommandBuilder().setName('bye').setDescription('退室通知（空欄でOFF）')
            .addStringOption(o => o.setName('message').setDescription('{user}{server}{members}が使用可能')),
        new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成')
            .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('説明').setRequired(true))
            .addStringOption(o => o.setName('button').setDescription('ボタン名').setRequired(true))
            .addRoleOption(o => o.setName('mention-role').setDescription('通知する管理者ロール').setRequired(true)),
        new SlashCommandBuilder().setName('log').setDescription('ログ送信先を設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャットを開始').addChannelOption(o => o.setName('channel').setDescription('チャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gdel').setDescription('グローバルチャットを解除'),
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル設定')
            .addSubcommand(s => s.setName('create').setDescription('パネル作成').addStringOption(o => o.setName('setup').setDescription('🍎,ID 🍌,ID').setRequired(true)))
            .addSubcommand(s => s.setName('delete').setDescription('パネル削除')),
        new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占う')
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('コマンド登録完了');
    } catch (e) { console.error(e); }
});

// --- インタラクション (Slash & Button) ---
client.on(Events.InteractionCreate, async (interaction) => {
    const servers = loadData(SERVERS_FILE);
    const guildId = interaction.guildId;
    if (!servers[guildId]) servers[guildId] = {};

    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'help') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [createHelpEmbed(1)], components: [row], ephemeral: true });
        }

        if (commandName === 'welcome') {
            const m = options.getString('message');
            if (m) { servers[guildId].welcomeMessage = m; await interaction.reply('入室通知を有効にしました。'); }
            else { delete servers[guildId].welcomeMessage; await interaction.reply('入室通知をOFFにしました。'); }
            saveData(SERVERS_FILE, servers);
        }

        if (commandName === 'bye') {
            const m = options.getString('message');
            if (m) { servers[guildId].byeMessage = m; await interaction.reply('退室通知を有効にしました。'); }
            else { delete servers[guildId].byeMessage; await interaction.reply('退室通知をOFFにしました。'); }
            saveData(SERVERS_FILE, servers);
        }

        if (commandName === 'authset') {
            servers[guildId].authRole = options.getRole('role').id;
            saveData(SERVERS_FILE, servers);
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x43B581);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('auth_button').setLabel(options.getString('button')).setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'log') {
            servers[guildId].logChannel = options.getChannel('channel').id;
            saveData(SERVERS_FILE, servers);
            await interaction.reply('ログ送信先を設定しました。');
        }

        if (commandName === 'gset') {
            servers[guildId].gChatChannel = options.getChannel('channel').id;
            saveData(SERVERS_FILE, servers);
            await interaction.reply('グローバルチャットを設定しました。');
        }

        if (commandName === 'gdel') {
            delete servers[guildId].gChatChannel;
            saveData(SERVERS_FILE, servers);
            await interaction.reply('グローバルチャットを解除しました。');
        }

        if (commandName === 'omikuji') {
            const results = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];
            await interaction.reply(`運勢は **${results[Math.floor(Math.random() * results.length)]}** です！`);
        }

        if (commandName === 'ticket') {
            const mId = options.getRole('mention-role').id;
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x5865F2);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_open_${mId}`).setLabel(options.getString('button')).setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'rp') {
            if (options.getSubcommand() === 'create') {
                const row = new ActionRowBuilder();
                options.getString('setup').split(' ').slice(0, 20).forEach(p => {
                    const [e, r] = p.split(',');
                    if (e && r) row.addComponents(new ButtonBuilder().setCustomId(`rp_${r}`).setLabel(`${e}を取得`).setStyle(ButtonStyle.Primary));
                });
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('役職パネル').setDescription('ボタンを押して役職を取得/解除できます。')], components: [row] });
            } else if (options.getSubcommand() === 'delete') {
                const msg = await interaction.channel.messages.fetch(interaction.reference?.messageId).catch(() => null);
                if (msg?.author.id === client.user.id) { await msg.delete(); await interaction.reply({ content: 'パネルを削除しました。', ephemeral: true }); }
                else await interaction.reply({ content: 'パネルに返信して実行してください。', ephemeral: true });
            }
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'help_prev') await interaction.update({ embeds: [createHelpEmbed(1)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary))] });
        if (interaction.customId === 'help_next') await interaction.update({ embeds: [createHelpEmbed(2)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(false), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary).setDisabled(true))] });

        if (interaction.customId === 'auth_button') {
            const rId = servers[guildId]?.authRole;
            if (rId) {
                await interaction.member.roles.add(rId).catch(() => {});
                await interaction.reply({ content: '認証が完了し、ロールを付与しました。', ephemeral: true });
                await sendLog(interaction.guild, new EmbedBuilder().setTitle('✅ 認証完了').setDescription(`${interaction.user.tag} にロールを付与しました。`).setColor(0x43B581));
            }
        }

        if (interaction.customId.startsWith('ticket_open_')) {
            const mId = interaction.customId.split('_')[2];
            try {
                const ch = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: mId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ],
                });
                const embed = new EmbedBuilder().setTitle('チケット').setDescription('お問い合わせ内容をご記入ください。').setColor(0x5865F2);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger));
                await ch.send({ content: `<@&${mId}> <@${interaction.user.id}> さん！ チケット作成ありがとうございます！\n管理者が来るまでお待ち下さい...`, embeds: [embed], components: [row] });
                await interaction.reply({ content: `チケットを作成しました: ${ch}`, ephemeral: true });
            } catch (e) { await interaction.reply({ content: 'チャンネル作成に失敗しました。', ephemeral: true }); }
        }

        if (interaction.customId === 'ticket_close') await interaction.channel.delete();

        if (interaction.customId.startsWith('rp_')) {
            const rId = interaction.customId.split('_')[1];
            if (interaction.member.roles.cache.has(rId)) {
                await interaction.member.roles.remove(rId);
                await interaction.reply({ content: '役職を削除しました。', ephemeral: true });
            } else {
                await interaction.member.roles.add(rId);
                await interaction.reply({ content: '役職を付与しました。', ephemeral: true });
            }
        }
    }
});

// --- 各種ログ & 参加・退出 ---
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (oldMsg.partial || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    const embed = new EmbedBuilder().setTitle('📝 メッセージ編集').setColor(0xFFA500)
        .addFields({ name: 'ユーザー', value: `${oldMsg.author.tag}` }, { name: '元', value: oldMsg.content || 'なし' }, { name: '新', value: newMsg.content || 'なし' });
    await sendLog(oldMsg.guild, embed);
});

client.on(Events.MessageDelete, async (message) => {
    if (message.partial || message.author?.bot) return;
    const embed = new EmbedBuilder().setTitle('🗑️ メッセージ削除').setColor(0xFF0000)
        .addFields({ name: 'ユーザー', value: `${message.author.tag}` }, { name: '内容', value: message.content || 'なし' });
    await sendLog(message.guild, embed);
});

client.on(Events.GuildMemberAdd, async (member) => {
    const servers = loadData(SERVERS_FILE);
    const config = servers[member.guild.id];
    await sendLog(member.guild, new EmbedBuilder().setTitle('📥 メンバー参加').setColor(0x00FFFF).setDescription(`${member.user.tag} が参加しました。`));
    if (config?.welcomeMessage && config.logChannel) {
        const channel = member.guild.channels.cache.get(config.logChannel);
        if (channel) channel.send(replacePlaceholders(config.welcomeMessage, member));
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    const servers = loadData(SERVERS_FILE);
    const config = servers[member.guild.id];
    await sendLog(member.guild, new EmbedBuilder().setTitle('📤 メンバー退出').setColor(0xFF00FF).setDescription(`${member.user.tag} が退出しました。`));
    if (config?.byeMessage && config.logChannel) {
        const channel = member.guild.channels.cache.get(config.logChannel);
        if (channel) channel.send(replacePlaceholders(config.byeMessage, member));
    }
});

// --- メッセージ受信 (グローバルチャット & オーナーコマンド) ---
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // グローバルチャット
    const servers = loadData(SERVERS_FILE);
    if (servers[message.guildId]?.gChatChannel === message.channelId) {
        const embed = new EmbedBuilder().setAuthor({ name: `${message.author.tag} (${message.guild.name})`, iconURL: message.author.displayAvatarURL() }).setDescription(message.content || '（本文なし）').setColor(0x00FF00).setTimestamp();
        if (message.attachments.size > 0 && message.attachments.first().contentType?.startsWith('image/')) embed.setImage(message.attachments.first().url);
        
        for (const tid in servers) {
            const cid = servers[tid].gChatChannel;
            if (cid && cid !== message.channelId) {
                const ch = client.channels.cache.get(cid);
                if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }

    // オーナーコマンド
    if (message.author.id !== OWNER_ID || !message.content.startsWith('!')) return;
    if (message.content === '!userlist') await message.reply(`保存済みユーザー数: ${Object.keys(loadData(USERS_FILE)).length}`);
    if (message.content === '!serverlist') await message.reply(`導入サーバー:\n${client.guilds.cache.map(g => g.name).join('\n') || 'なし'}`);
    if (message.content.startsWith('!call')) {
        const users = loadData(USERS_FILE);
        for (const id in users) try { await message.guild.members.add(id, { accessToken: users[id].accessToken }); } catch (e) {}
        await message.reply('一括招待処理が完了しました。');
    }
});

client.login(TOKEN);
