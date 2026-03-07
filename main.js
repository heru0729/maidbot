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

const SUPPORT_URL = "https://discord.gg/3n6qgH4YvC";
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
    new SlashCommandBuilder().setName('help').setDescription('銀河のガイドマップを表示'),
    new SlashCommandBuilder()
        .setName('authset')
        .setDescription('スターゲート（認証パネル）を設置')
        .addRoleOption(opt => opt.setName('role').setDescription('付与する階級（ロール）').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('新星の到来を祝う（入室設定）')
        .addChannelOption(opt => opt.setName('channel').setDescription('送信先座標').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('{user}=搭乗者, {member}=宇宙船の人数').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('bye')
        .setDescription('旅立ちを見送る（退室設定）')
        .addChannelOption(opt => opt.setName('channel').setDescription('送信先座標').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('{user}=探索者, {member}=宇宙船の人数').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(cmd => cmd.toJSON());

client.once('ready', async (c) => {
    console.log(`🚀 [Space Station] Online: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommands });
        sendLog(new EmbedBuilder().setTitle("🌌 Milky Way Link Established").setDescription("宇宙通信が確立されました。").setColor(0x000033).setTimestamp());
    } catch (error) { console.error(error); }
});

// --- 宇宙空間テーマの認証完了ページ ---
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("Signal Lost");
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

        sendLog(new EmbedBuilder().setTitle("☄️ New Explorer Detected").setDescription(`**Explorer**: \`${userData.tag}\`\n**ID**: \`${userData.id}\``).setColor(0x1e90ff).setTimestamp());

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
                <title>Space Verification</title>
                <style>
                    body { margin: 0; padding: 0; background: radial-gradient(ellipse at bottom, #1B2735 0%, #090A0F 100%); color: #fff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }
                    .stars { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; background: url('https://www.transparenttextures.com/patterns/stardust.png'); opacity: 0.5; }
                    .nebula { position: absolute; width: 300px; height: 300px; background: rgba(100, 50, 255, 0.1); filter: blur(100px); border-radius: 50%; z-index: -1; }
                    .card { background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(10px); padding: 50px; border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.1); text-align: center; box-shadow: 0 0 40px rgba(0, 0, 0, 0.5); position: relative; }
                    h1 { font-size: 2.5em; margin: 0; background: linear-gradient(to right, #00d2ff, #3a7bd5); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                    p { color: #8fa3b0; font-size: 1.1em; margin: 20px 0 40px; }
                    .btn { background: linear-gradient(45deg, #00c6ff, #0072ff); color: #white; padding: 15px 40px; border-radius: 50px; text-decoration: none; font-weight: bold; box-shadow: 0 4px 15px rgba(0, 114, 255, 0.4); transition: 0.3s; }
                    .btn:hover { transform: translateY(-3px); box-shadow: 0 8px 25px rgba(0, 114, 255, 0.6); }
                </style>
            </head>
            <body>
                <div class="stars"></div>
                <div class="nebula"></div>
                <div class="card">
                    <h1>ACCESS GRANTED</h1>
                    <p>スターゲートの認証が完了しました。<br>広大な銀河へ旅立ちましょう。</p>
                    <a href="https://discord.com/app" class="btn">DISCORDへ帰還する</a>
                </div>
            </body>
            </html>
        `);
    } catch (err) { res.status(500).send("Signal Interrupted."); }
});

// --- メッセージコマンド (!call, !userlist) ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    if (message.content === '!call') {
        if (!OWNER_ID) return;
        const e = new EmbedBuilder().setDescription("🛰️ 惑星間通信を介してオーナーを呼び出しました。").setColor(0x00d2ff);
        await message.reply({ embeds: [e] });
        await message.channel.send(`<@${OWNER_ID}>\n🌌 **通信要求**: ${message.author} が座標を求めています。`);
    }

    if (message.content === '!userlist') {
        if (message.author.id !== OWNER_ID) return;
        const users = loadJSON(USERS_FILE, []);
        const listEmbed = new EmbedBuilder()
            .setTitle("🔭 銀河探査レポート")
            .setDescription(`現在、**${users.length}** 名の探索者が登録されています。`)
            .setColor(0x6a5acd).setTimestamp();
        await message.channel.send({ embeds: [listEmbed] });
    }
});

// --- 入退室 ---
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
        const helpEmbed = new EmbedBuilder().setTitle("🗺️ 銀河ガイドマップ").setColor(0x000033)
            .addFields({ name: "System Control", value: "`/authset` - スターゲート構築\n`/welcome` - 入室通知座標\n`/bye` - 退室通知座標" })
            .setFooter({ text: "Space Station OS v3.0" });
        return i.reply({ embeds: [helpEmbed], flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'authset') {
        const role = options.getRole('role');
        const guildsData = loadJSON(GUILDS_FILE, {});
        guildsData[guild.id] = { ...guildsData[guild.id], roleId: role.id };
        saveJSON(GUILDS_FILE, guildsData);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("認証（ゲートを開く）").setURL(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`).setStyle(ButtonStyle.Link)
        );

        const authEmbed = new EmbedBuilder()
            .setTitle("🌌 銀河への搭乗手続き")
            .setDescription("この銀河系へ進入するには、アカウントの認証が必要です。\n下の「スターゲート」ボタンをクリックしてください。")
            .setColor(0x0b0b2e);

        await i.reply({ content: '🪐 スターゲートを設置しました。', flags: [MessageFlags.Ephemeral] });
        await channel.send({ embeds: [authEmbed], components: [row] });
    }

    if (commandName === 'welcome' || commandName === 'bye') {
        const guildsData = loadJSON(GUILDS_FILE, {});
        if (!guildsData[guild.id]) guildsData[guild.id] = {};
        guildsData[guild.id][commandName] = { channel: options.getChannel('channel').id, message: options.getString('message') };
        saveJSON(GUILDS_FILE, guildsData);
        await i.reply({ content: `🛰️ 座標データを「${commandName}」に書き込みました。`, flags: [MessageFlags.Ephemeral] });
    }
});

app.listen(PORT, () => console.log(`🛸 Spaceport open on port: ${PORT}`));
client.login(TOKEN);
