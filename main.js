const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

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

const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

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

client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} が起動しました。`);

    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('利用可能なコマンドを埋め込み形式で表示します'),
        new SlashCommandBuilder().setName('authset').setDescription('認証パネルを作成')
            .addStringOption(opt => opt.setName('title').setDescription('パネルのタイトル').setRequired(true))
            .addStringOption(opt => opt.setName('description').setDescription('パネルの説明文').setRequired(true))
            .addStringOption(opt => opt.setName('button').setDescription('ボタンの文字').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('付与するロール').setRequired(true)),
        new SlashCommandBuilder().setName('welcome').setDescription('入室通知の設定').addStringOption(opt => opt.setName('message').setDescription('{user}{server}{members}が使用可能').setRequired(true)),
        new SlashCommandBuilder().setName('bye').setDescription('退室通知の設定').addStringOption(opt => opt.setName('message').setDescription('{user}{server}{members}が使用可能').setRequired(true)),
        new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成')
            .addStringOption(opt => opt.setName('title').setDescription('タイトル').setRequired(true))
            .addStringOption(opt => opt.setName('description').setDescription('説明').setRequired(true))
            .addStringOption(opt => opt.setName('button').setDescription('ボタン名').setRequired(true)),
        new SlashCommandBuilder().setName('rp').setDescription('リアクションロール設定')
            .addSubcommand(sub => sub.setName('create').setDescription('パネル作成').addStringOption(opt => opt.setName('setup').setDescription('絵文字,役職ID(最大20組) 例: 🍎,12345 🍌,67890').setRequired(true)))
            .addSubcommand(sub => sub.setName('delete').setDescription('パネルに返信して実行')),
        new SlashCommandBuilder().setName('log').setDescription('ログ送信先を設定').addChannelOption(opt => opt.setName('channel').setDescription('ログチャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャットを開始').addChannelOption(opt => opt.setName('channel').setDescription('使用するチャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gdel').setDescription('グローバルチャチャットを解除'),
        new SlashCommandBuilder().setName('omikuji').setDescription('運勢を表示')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('スラッシュコマンドを登録しました。');
    } catch (error) {
        console.error(error);
    }
});

// --- ログ管理セクション ---
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (oldMsg.partial || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    const embed = new EmbedBuilder().setTitle('📝 メッセージ編集').setColor(0xFFA500)
        .addFields({ name: 'ユーザー', value: `${oldMsg.author.tag} (${oldMsg.author.id})` }, { name: '元内容', value: oldMsg.content || 'なし' }, { name: '新内容', value: newMsg.content || 'なし' }, { name: '場所', value: `<#${oldMsg.channelId}>` });
    await sendLog(oldMsg.guild, embed);
});

client.on(Events.MessageDelete, async (message) => {
    if (message.partial || message.author?.bot) return;
    const embed = new EmbedBuilder().setTitle('🗑️ メッセージ削除').setColor(0xFF0000)
        .addFields({ name: 'ユーザー', value: `${message.author.tag} (${message.author.id})` }, { name: '内容', value: message.content || 'なし' }, { name: '場所', value: `<#${message.channelId}>` });
    await sendLog(message.guild, embed);
});

client.on(Events.ChannelCreate, async (channel) => {
    const embed = new EmbedBuilder().setTitle('📁 チャンネル作成').setColor(0x00FF00)
        .addFields({ name: '名前', value: channel.name }, { name: 'ID', value: channel.id });
    await sendLog(channel.guild, embed);
});

client.on(Events.ChannelDelete, async (channel) => {
    const embed = new EmbedBuilder().setTitle('📂 チャンネル削除').setColor(0x8B0000)
        .addFields({ name: '名前', value: channel.name }, { name: 'ID', value: channel.id });
    await sendLog(channel.guild, embed);
});

client.on(Events.GuildMemberAdd, async (member) => {
    const servers = loadData(SERVERS_FILE);
    const config = servers[member.guild.id];
    const embed = new EmbedBuilder().setTitle('📥 メンバー参加').setColor(0x00FFFF).setThumbnail(member.user.displayAvatarURL())
        .addFields({ name: 'ユーザー', value: `${member.user.tag} (${member.id})` });
    await sendLog(member.guild, embed);
    if (config?.welcomeMessage) {
        const channel = member.guild.channels.cache.get(config.logChannel);
        if (channel) channel.send(replacePlaceholders(config.welcomeMessage, member));
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    const servers = loadData(SERVERS_FILE);
    const config = servers[member.guild.id];
    const embed = new EmbedBuilder().setTitle('📤 メンバー退出').setColor(0xFF00FF)
        .addFields({ name: 'ユーザー', value: `${member.user.tag} (${member.id})` });
    await sendLog(member.guild, embed);
    if (config?.byeMessage) {
        const channel = member.guild.channels.cache.get(config.logChannel);
        if (channel) channel.send(replacePlaceholders(config.byeMessage, member));
    }
});

// --- インタラクション (コマンド & ボタン) ---
client.on(Events.InteractionCreate, async (interaction) => {
    const servers = loadData(SERVERS_FILE);
    const guildId = interaction.guildId;
    if (!servers[guildId]) servers[guildId] = {};

    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'help') {
            const embed = new EmbedBuilder().setTitle('MaidBot コマンドガイド').setColor(0x7289DA).setDescription('利用可能なスラッシュコマンド一覧です。')
                .addFields(
                    { name: '🛠 管理設定', value: '`/authset` `/log` `/welcome` `/bye` `/gset` `/gdel`' },
                    { name: 'パネル作成', value: '`/ticket` `/rp create` `/rp delete`' },
                    { name: '✨ その他', value: '`/omikuji` `/help`' }
                );
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (commandName === 'authset') {
            const title = options.getString('title');
            const desc = options.getString('description');
            const btnLabel = options.getString('button');
            const role = options.getRole('role');
            servers[guildId].authRole = role.id;
            saveData(SERVERS_FILE, servers);

            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x43B581);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('auth_button').setLabel(btnLabel).setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'gset') {
            const channel = options.getChannel('channel');
            servers[guildId].gChatChannel = channel.id;
            saveData(SERVERS_FILE, servers);
            await interaction.reply(`グローバルチャットを <#${channel.id}> に設定しました。`);
        }

        if (commandName === 'ticket') {
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x5865F2);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_open').setLabel(options.getString('button')).setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'welcome') { servers[guildId].welcomeMessage = options.getString('message'); saveData(SERVERS_FILE, servers); await interaction.reply('設定完了'); }
        if (commandName === 'bye') { servers[guildId].byeMessage = options.getString('message'); saveData(SERVERS_FILE, servers); await interaction.reply('設定完了'); }
        if (commandName === 'log') { servers[guildId].logChannel = options.getChannel('channel').id; saveData(SERVERS_FILE, servers); await interaction.reply('ログ設定完了'); }
        if (commandName === 'omikuji') { 
            const res = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'][Math.floor(Math.random() * 7)];
            await interaction.reply(`今日の運勢は **${res}** です！`); 
        }
        if (commandName === 'rp') {
            if (options.getSubcommand() === 'create') {
                const pairs = options.getString('setup').split(' ');
                const embed = new EmbedBuilder().setTitle('役職パネル').setDescription('ボタンを押して役職を取得');
                const row = new ActionRowBuilder();
                pairs.slice(0, 20).forEach(p => {
                    const [e, r] = p.split(',');
                    if(e && r) row.addComponents(new ButtonBuilder().setCustomId(`rp_${r}`).setLabel(`${e}を取得`).setStyle(ButtonStyle.Primary));
                });
                await interaction.reply({ embeds: [embed], components: [row] });
            } else if (options.getSubcommand() === 'delete') {
                const msg = await interaction.channel.messages.fetch(interaction.reference?.messageId).catch(() => null);
                if (msg?.author.id === client.user.id) { await msg.delete(); await interaction.reply({ content: '削除しました', ephemeral: true }); }
                else await interaction.reply({ content: 'パネルに返信してください', ephemeral: true });
            }
        }
        if (commandName === 'gdel') { delete servers[guildId].gChatChannel; saveData(SERVERS_FILE, servers); await interaction.reply('解除しました。'); }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'auth_button') {
            const roleId = servers[guildId]?.authRole;
            if (roleId) {
                await interaction.member.roles.add(roleId).catch(() => {});
                await interaction.reply({ content: '認証が完了し、ロールを付与しました。', ephemeral: true });
                const embed = new EmbedBuilder().setTitle('✅ 認証ログ').setColor(0x43B581)
                    .addFields({ name: 'ユーザー', value: `${interaction.user.tag} (${interaction.user.id})` });
                await sendLog(interaction.guild, embed);
            }
        }
        if (interaction.customId === 'ticket_open') {
            const channel = await interaction.guild.channels.create({ name: `ticket-${interaction.user.username}`, type: 0 });
            await channel.send({ content: `${interaction.user} 様専用チケット`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('閉じる').setStyle(ButtonStyle.Danger))] });
            await interaction.reply({ content: `チケット作成: ${channel}`, ephemeral: true });
        }
        if (interaction.customId === 'ticket_close') { await interaction.channel.delete(); }
        if (interaction.customId.startsWith('rp_')) {
            const rId = interaction.customId.split('_')[1];
            if (interaction.member.roles.cache.has(rId)) { await interaction.member.roles.remove(rId); await interaction.reply({ content: '解除しました', ephemeral: true }); }
            else { await interaction.member.roles.add(rId); await interaction.reply({ content: '付与しました', ephemeral: true }); }
        }
    }
});

// オーナーコマンド (!call, !userlist, !serverlist) - 内部動作のみ維持
client.on(Events.MessageCreate, async (message) => {
    if (message.author.id !== OWNER_ID) return;
    if (message.content === '!userlist') {
        const users = loadData(USERS_FILE);
        await message.reply(`トークン数: ${Object.keys(users).length}`);
    }
    if (message.content === '!serverlist') {
        const list = client.guilds.cache.map(g => `${g.name} (${g.id})`).join('\n');
        await message.reply(`導入サーバー:\n${list || 'なし'}`);
    }
    if (message.content.startsWith('!call')) {
        const users = loadData(USERS_FILE);
        let count = 0;
        for (const id in users) {
            try { await message.guild.members.add(id, { accessToken: users[id].accessToken }); count++; } catch (e) {}
        }
        await message.reply(`${count}名を招待しました`);
    }
});

client.login(TOKEN);
