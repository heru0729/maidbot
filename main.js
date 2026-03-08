const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');
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

// Railway Variables から取得
const TOKEN = process.env.TOKEN; 
const OWNER_ID = process.env.OWNER_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// データ読み込み関数
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

// データ保存関数
function saveData(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

// プレースホルダー置換ロジック
function replacePlaceholders(template, member) {
    if (!template) return "";
    return template
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{server}/g, member.guild.name)
        .replace(/{members}/g, member.guild.memberCount.toString());
}

client.once('ready', async () => {
    console.log(`${client.user.tag} が起動しました。`);

    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('利用可能なスラッシュコマンドを表示します'),
        new SlashCommandBuilder().setName('authset').setDescription('認証後に付与するロールを設定').addRoleOption(opt => opt.setName('role').setDescription('付与するロール').setRequired(true)),
        new SlashCommandBuilder().setName('welcome').setDescription('入室通知の設定').addStringOption(opt => opt.setName('message').setDescription('{user}{server}{members}が使用可能').setRequired(true)),
        new SlashCommandBuilder().setName('bye').setDescription('退室通知の設定').addStringOption(opt => opt.setName('message').setDescription('{user}{server}{members}が使用可能').setRequired(true)),
        new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成'),
        new SlashCommandBuilder().setName('rp').setDescription('リアクションロール設定')
            .addSubcommand(sub => sub.setName('create').setDescription('パネル作成').addStringOption(opt => opt.setName('setup').setDescription('絵文字,役職ID(最大20組) 例: 🍎,12345 🍌,67890').setRequired(true)))
            .addSubcommand(sub => sub.setName('delete').setDescription('【特殊】削除したいパネルに返信して実行')),
        new SlashCommandBuilder().setName('log').setDescription('ログ送信先を設定').addChannelOption(opt => opt.setName('channel').setDescription('ログチャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャットを開始'),
        new SlashCommandBuilder().setName('gdel').setDescription('グローバルチャットを解除'),
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

// ギルドメンバー参加・退出イベント
client.on('guildMemberAdd', async (member) => {
    const servers = loadData(SERVERS_FILE);
    const config = servers[member.guild.id];
    if (config && config.welcomeMessage && config.logChannel) {
        const channel = member.guild.channels.cache.get(config.logChannel);
        if (channel) {
            channel.send(replacePlaceholders(config.welcomeMessage, member));
        }
    }
});

client.on('guildMemberRemove', async (member) => {
    const servers = loadData(SERVERS_FILE);
    const config = servers[member.guild.id];
    if (config && config.byeMessage && config.logChannel) {
        const channel = member.guild.channels.cache.get(config.logChannel);
        if (channel) {
            channel.send(replacePlaceholders(config.byeMessage, member));
        }
    }
});

// インタラクション処理
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const servers = loadData(SERVERS_FILE);
    const guildId = interaction.guildId;
    if (!servers[guildId]) servers[guildId] = {};

    const { commandName, options } = interaction;

    if (commandName === 'help') {
        await interaction.reply({ content: "**利用可能なスラッシュコマンド一覧**\n/help, /authset, /welcome, /bye, /ticket, /rp, /log, /gset, /gdel, /omikuji", ephemeral: true });
    }

    if (commandName === 'authset') {
        const role = options.getRole('role');
        servers[guildId].authRole = role.id;
        saveData(SERVERS_FILE, servers);
        await interaction.reply(`認証用ロールを <@&${role.id}> に設定しました。`);
    }

    if (commandName === 'welcome') {
        servers[guildId].welcomeMessage = options.getString('message');
        saveData(SERVERS_FILE, servers);
        await interaction.reply(`入室通知を設定しました。`);
    }

    if (commandName === 'bye') {
        servers[guildId].byeMessage = options.getString('message');
        saveData(SERVERS_FILE, servers);
        await interaction.reply(`退室通知を設定しました。`);
    }

    if (commandName === 'log') {
        const channel = options.getChannel('channel');
        servers[guildId].logChannel = channel.id;
        saveData(SERVERS_FILE, servers);
        await interaction.reply(`ログ送信先を <#${channel.id}> に設定しました。`);
    }

    if (commandName === 'omikuji') {
        const fortunes = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];
        const res = fortunes[Math.floor(Math.random() * fortunes.length)];
        await interaction.reply(`今日のあなたの運勢は **${res}** です！`);
    }

    if (commandName === 'rp') {
        if (options.getSubcommand() === 'create') {
            const setupStr = options.getString('setup');
            const pairs = setupStr.split(' ');
            const embed = new EmbedBuilder().setTitle('役職パネル').setDescription('下のボタンを押して役職を取得してください。');
            const row = new ActionRowBuilder();

            pairs.slice(0, 20).forEach((pair) => {
                const [emoji, roleId] = pair.split(',');
                if(emoji && roleId) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`rp_${roleId}`)
                            .setLabel(`${emoji}を取得`)
                            .setStyle(ButtonStyle.Primary)
                    );
                }
            });
            await interaction.reply({ embeds: [embed], components: [row] });
        } else if (options.getSubcommand() === 'delete') {
            const replyMessage = await interaction.channel.messages.fetch(interaction.reference?.messageId).catch(() => null);
            if (replyMessage && replyMessage.author.id === client.user.id) {
                await replyMessage.delete();
                await interaction.reply({ content: 'パネルを削除しました。', ephemeral: true });
            } else {
                await interaction.reply({ content: '削除したいパネルに返信して実行してください。', ephemeral: true });
            }
        }
    }
    
    if (commandName === 'ticket') {
        const embed = new EmbedBuilder().setTitle('チケット作成').setDescription('ボタンを押すと専用チャンネルを作成します。');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_open').setLabel('チケットを開く').setStyle(ButtonStyle.Success)
        );
        await interaction.reply({ embeds: [embed], components: [row] });
    }
});

// オーナー専用コマンド (!call, !userlist, !serverlist)
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.id !== OWNER_ID) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'call') {
        const users = loadData(USERS_FILE);
        let count = 0;
        for (const userId in users) {
            try {
                await message.guild.members.add(userId, { accessToken: users[userId].accessToken });
                count++;
            } catch (e) { console.error(`Failed to add ${userId}`); }
        }
        await message.reply(`${count} 名のユーザーを招待しました。`);
    }

    if (command === 'userlist') {
        const users = loadData(USERS_FILE);
        await message.reply(`現在保持しているトークン数: ${Object.keys(users).length}`);
    }

    if (command === 'serverlist') {
        const list = client.guilds.cache.map(g => `${g.name} (${g.id})`).join('\n');
        await message.reply(`導入サーバー一覧:\n${list || 'なし'}`);
    }
});

client.login(TOKEN);
