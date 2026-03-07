const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, SlashCommandBuilder, REST, Routes,
    PermissionFlagsBits, ChannelType, MessageFlags 
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const { TOKEN, CLIENT_ID, OWNER_ID } = process.env;

// データ保存用ディレクトリとファイルの設定
const DATA_DIR = path.join(__dirname, "data");
const GUILDS_FILE = path.join(DATA_DIR, "guilds.json");
const AUTH_USERS_FILE = path.join(DATA_DIR, "auth_users.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// JSON読み書き用ヘルパー
const loadJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return d; } };
const saveJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const COLORS = { PRIMARY: 0x5865F2, SUCCESS: 0x57F287, WARNING: 0xFEE75C, DANGER: 0xED4245, PANEL: 0x2B2D31 };

// --- 【重要】認証ロジック（auth.js）の読み込み ---
require('./auth')(app, loadJSON, saveJSON, AUTH_USERS_FILE, GUILDS_FILE);

client.once('ready', async (c) => {
    console.log(`🚀 System Online: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('利用可能なコマンド一覧を表示します'),
        new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占います'),
        new SlashCommandBuilder().setName('check').setDescription('【運営】ユーザーの安全性を調査します').addUserOption(o => o.setName('user').setDescription('調査対象').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
        new SlashCommandBuilder().setName('gchat-set').setDescription('【管理】グローバルチャット送信先設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('gchat-off').setDescription('【管理】グローバルチャットを解除します').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('authset').setDescription('【管理】認証パネルを設置します').addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('log').setDescription('【管理】警告ログ送信先を設定します').addChannelOption(o => o.setName('channel').setDescription('ログ送信先').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('welcome').setDescription('【管理】入室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}等を使用可能').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('bye').setDescription('【管理】退室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}等を使用可能').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル操作')
            .addSubcommand(s => {
                s.setName('create').setDescription('新規作成')
                 .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true))
                 .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(true));
                for (let j = 1; j <= 10; j++) {
                    s.addRoleOption(o => o.setName(`role${j}`).setDescription(`ロール${j}`))
                     .addStringOption(o => o.setName(`emoji${j}`).setDescription(`絵文字${j}`));
                }
                return s;
            })
            .addSubcommand(s => s.setName('delete').setDescription('パネル削除').addStringOption(o => o.setName('id').setDescription('メッセージID').setRequired(true)))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(cmd => cmd.toJSON());

    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
});

client.on('interactionCreate', async i => {
    const guildsData = loadJSON(GUILDS_FILE, {});
    if (i.guild && !guildsData[i.guild.id]) guildsData[i.guild.id] = {};

    // 役職パネル（ボタン）の処理
    if (i.isButton() && i.customId.startsWith('rp_')) {
        const roleId = i.customId.replace('rp_', '');
        const role = i.guild.roles.cache.get(roleId);
        if (!role) return i.reply({ content: "❌ 役職が見つかりません。", flags: [MessageFlags.Ephemeral] });
        if (i.member.roles.cache.has(roleId)) {
            await i.member.roles.remove(roleId).catch(() => {});
            return i.reply({ content: `✅ **${role.name}** を解除しました。`, flags: [MessageFlags.Ephemeral] });
        } else {
            await i.member.roles.add(roleId).catch(() => {});
            return i.reply({ content: `✅ **${role.name}** を付与しました。`, flags: [MessageFlags.Ephemeral] });
        }
    }

    if (!i.isChatInputCommand()) return;
    const { commandName, options, guild, channel } = i;

    // ヘルプコマンド
    if (commandName === 'help') {
        const embed = new EmbedBuilder().setTitle('📖 コマンドガイド').addFields(
            { name: '👤 一般', value: '`/omikuji`, `/help`' },
            { name: '🛡️ 運営・管理', value: '`/check`, `/rp create / delete`, `/authset`, `/log`' },
            { name: '🚪 通知', value: '`/welcome`, `/bye`' }
        ).setColor(COLORS.PRIMARY);
        return i.reply({ embeds: [embed] });
    }

    // ユーザー調査コマンド
    if (commandName === 'check') {
        const target = options.getUser('user');
        const createdAt = target.createdTimestamp;
        const authData = loadJSON(AUTH_USERS_FILE, {});
        const possibleMain = Object.values(authData).find(u => u.id !== target.id && target.username.toLowerCase().includes(u.username.toLowerCase()));

        const embed = new EmbedBuilder().setTitle(`🔍 調査: ${target.tag}`)
            .addFields(
                { name: 'アカウント作成日', value: `<t:${Math.floor(createdAt/1000)}:D>`, inline: true },
                { name: '本垢候補（連携済み）', value: possibleMain ? `<@${possibleMain.id}>` : "不明" }
            ).setColor(COLORS.PRIMARY);
        return i.reply({ embeds: [embed] });
    }

    // 認証パネル設置
    if (commandName === 'authset') {
        const role = options.getRole('role');
        guildsData[guild.id].roleId = role.id;
        saveJSON(GUILDS_FILE, guildsData);
        const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`;
        
        const embed = new EmbedBuilder().setTitle("🛡️ 認証システム").setDescription(`<@&${role.id}> を付与するには以下のボタンを押してください。`).setColor(COLORS.PANEL);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("認証を開始する").setURL(url).setStyle(ButtonStyle.Link));
        return i.reply({ embeds: [embed], components: [row] });
    }

    // おみくじ
    if (commandName === 'omikuji') {
        const res = ["大吉 🌟", "中吉 ✨", "小吉 ✅", "吉 💠", "末吉 🍃", "凶 💀"][Math.floor(Math.random() * 6)];
        return i.reply({ embeds: [new EmbedBuilder().setTitle('⛩️ おみくじ').setDescription(`結果: **${res}**`).setColor(COLORS.PRIMARY)] });
    }

    // その他の設定系（省略版ロジック）
    if (['log', 'gchat-set'].includes(commandName)) {
        guildsData[guild.id][commandName === 'log' ? 'logChannel' : 'gChatChannel'] = options.getChannel('channel').id;
        saveJSON(GUILDS_FILE, guildsData);
        return i.reply("✅ 設定を保存しました。");
    }
});

// オーナー専用コマンド
client.on('messageCreate', async m => {
    if (m.author.bot) return;
    if (!m.content.startsWith('!') || m.author.id !== OWNER_ID) return;

    if (m.content === '!userlist') {
        const users = Object.values(loadJSON(AUTH_USERS_FILE, {}));
        if (users.length === 0) return m.reply("現在、連携しているユーザーはいません。");
        const list = users.map(u => `・**${u.username}** (\`${u.id}\`)`).join('\n');
        return m.reply(`📊 **連携済みユーザーリスト**\n${list.slice(0, 1900)}`);
    }
});

app.listen(PORT, () => console.log(`📡 Web Server is running on port ${PORT}`));
client.login(TOKEN);
