const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, SlashCommandBuilder, REST, Routes,
    PermissionFlagsBits, ChannelType, MessageFlags 
} = require('discord.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, SUPPORT_URL, INVITE_URL } = process.env;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const GUILDS_FILE = path.join(DATA_DIR, "guilds.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const loadJSON = (file, defaultValue) => {
    try {
        if (!fs.existsSync(file)) return defaultValue;
        const data = fs.readFileSync(file, "utf-8");
        return data.trim() ? JSON.parse(data) : defaultValue;
    } catch (err) { return defaultValue; }
};

const saveJSON = (file, data) => {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (err) {}
};

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ] 
});

const commands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Botの使い方を表示します'),
    new SlashCommandBuilder()
        .setName('authset')
        .setDescription('【管理者専用】認証パネルを設置します')
        .addRoleOption(opt => opt.setName('role').setDescription('認証完了後に付与するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('【管理者専用】入室メッセージを設定します')
        .addChannelOption(opt => opt.setName('channel').setDescription('送信先チャンネル').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('{user}でメンション, {member}で人数').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('bye')
        .setDescription('【管理者専用】退室メッセージを設定します')
        .addChannelOption(opt => opt.setName('channel').setDescription('送信先チャンネル').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('{user}で名前, {member}で人数').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async (c) => {
    console.log(`✅ [Bot] Online: ${c.user.tag}`);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ [System] スラッシュコマンド同期完了');
    } catch (error) {
        console.error('❌ [System] 同期エラー:', error);
    }
});

app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("Code missing.");

    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });

        const users = loadJSON(USERS_FILE, []);
        const userData = { id: userRes.data.id, token: tokenRes.data.access_token };

        const index = users.findIndex(u => u.id === userData.id);
        if (index > -1) users[index] = userData; else users.push(userData);
        saveJSON(USERS_FILE, users);

        if (state) {
            const guilds = loadJSON(GUILDS_FILE, {});
            const roleId = guilds[state]?.roleId;
            await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${userRes.data.id}`, 
                { access_token: tokenRes.data.access_token, ...(roleId ? { roles: [roleId] } : {}) },
                { headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" } }
            ).catch(() => {});
        }

        res.send(`
            <body style="background: radial-gradient(circle at center, #1b2735 0%, #090a0f 100%); color: white; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; margin: 0;">
                <div style="text-align: center; border: 2px solid #5865F2; padding: 40px; border-radius: 15px; background: rgba(0, 0, 0, 0.7); box-shadow: 0 0 30px rgba(88, 101, 242, 0.5);">
                    <h1 style="color: #5865F2;">✅ 認証完了</h1>
                    <p style="font-size: 1.1em;">ゲートウェイが承認されました。<br>Discordに戻ってください。</p>
                </div>
            </body>
        `);
    } catch (err) { res.status(500).send("Auth Error."); }
});

client.on('guildMemberAdd', async member => {
    const config = loadJSON(GUILDS_FILE, {})[member.guild.id]?.welcome;
    if (!config) return;
    const channel = await member.guild.channels.fetch(config.channel).catch(() => null);
    if (channel) {
        const content = config.message.replace('{user}', `<@${member.id}>`).replace('{member}', member.guild.memberCount);
        channel.send(content).catch(() => {});
    }
});

client.on('guildMemberRemove', async member => {
    const config = loadJSON(GUILDS_FILE, {})[member.guild.id]?.bye;
    if (!config) return;
    const channel = await member.guild.channels.fetch(config.channel).catch(() => null);
    if (channel) {
        const content = config.message.replace('{user}', `**${member.user.username}**`).replace('{member}', member.guild.memberCount);
        channel.send(content).catch(() => {});
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, guild, channel } = interaction;

    if (commandName === 'help') {
        const hEmbed = new EmbedBuilder()
            .setTitle("📖 MaidBot 利用ガイド")
            .setDescription("当サーバーのBot機能案内です。")
            .addFields(
                { name: "🔒 メンバー認証", value: "パネルのボタンから認証を行うとロールが付与されます。" },
                { name: "⚙️ 管理設定", value: "`/authset` : パネル設置\n`/welcome` : 入室挨拶設定\n`/bye` : 退室挨拶設定" },
                { name: "📝 変数", value: "`{user}` : 名前/メンション\n`{member}` : サーバー人数" }
            ).setColor(0x5865F2);
        return interaction.reply({ embeds: [hEmbed], flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'authset') {
        const role = options.getRole('role');
        const guildsData = loadJSON(GUILDS_FILE, {});
        guildsData[guild.id] = { ...guildsData[guild.id], roleId: role.id };
        saveJSON(GUILDS_FILE, guildsData);

        const aEmbed = new EmbedBuilder()
            .setTitle("🛡️ メンバー認証")
            .setDescription(`下のボタンから認証を完了させてください。\n付与ロール: ${role}`)
            .setColor(0x5865F2);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("認証を開始")
                .setURL(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`)
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel("サポートサーバー")
                .setURL(SUPPORT_URL || "https://discord.gg/")
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel("Botを導入")
                .setURL(INVITE_URL || `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`)
                .setStyle(ButtonStyle.Link)
        );

        await interaction.reply({ content: '✅ パネルを配置しました。', flags: [MessageFlags.Ephemeral] });
        await channel.send({ embeds: [aEmbed], components: [row] });
    }

    if (commandName === 'welcome' || commandName === 'bye') {
        const targetChan = options.getChannel('channel');
        const msgStr = options.getString('message');
        const guildsData = loadJSON(GUILDS_FILE, {});
        if (!guildsData[guild.id]) guildsData[guild.id] = {};
        guildsData[guild.id][commandName] = { channel: targetChan.id, message: msgStr };
        saveJSON(GUILDS_FILE, guildsData);
        await interaction.reply({ content: `✅ ${commandName === 'welcome' ? '入室' : '退室'}設定を保存しました。`, flags: [MessageFlags.Ephemeral] });
    }
});

app.listen(PORT, () => console.log(`🚀 [Server] Port: ${PORT}`));
client.login(TOKEN);
