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

// 環境変数
const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, OWNER_ID, LOG_CHANNEL_ID } = process.env;

const SUPPORT_URL = "https://discord.gg/3n6qgH4YvC";
const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&integration_type=0&scope=bot`;

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
        .addStringOption(opt => opt.setName('message').setDescription('{user}=メンション, {member}=人数').setRequired(true)),
    new SlashCommandBuilder()
        .setName('bye')
        .setDescription('退室メッセージ設定')
        .addChannelOption(opt => opt.setName('channel').setDescription('送信先').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('{user}=名前, {member}=人数').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async (c) => {
    console.log(`✅ Online: ${c.user.tag}`);
    console.log(`👑 Owner ID: ${OWNER_ID}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommands });
    } catch (error) { console.error(error); }
});

// 認証完了画面 (宇宙背景)
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
                <style>
                    body { margin:0; background:#090a0f; color:white; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; overflow:hidden; }
                    .stars { position:absolute; width:100%; height:100%; background:url('https://www.transparenttextures.com/patterns/stardust.png'); opacity:0.4; }
                    .card { background:rgba(255,255,255,0.05); backdrop-filter:blur(8px); padding:40px; border-radius:15px; text-align:center; border:1px solid rgba(255,255,255,0.1); z-index:1; }
                    h1 { font-size:24px; margin-bottom:10px; color:#00d2ff; }
                    .btn-group { display:flex; gap:10px; margin-top:20px; justify-content:center; }
                    .btn { padding:10px 20px; border-radius:5px; text-decoration:none; font-weight:bold; font-size:14px; transition:0.2s; }
                    .primary { background:#5865f2; color:white; }
                    .secondary { background:rgba(255,255,255,0.1); color:white; }
                </style>
            </head>
            <body>
                <div class="stars"></div>
                <div class="card">
                    <h1>認証が完了しました</h1>
                    <p>この画面を閉じて、Discordへお戻りください。</p>
                    <div class="btn-group">
                        <a href="https://discord.com/app" class="btn primary">Discordを開く</a>
                        <a href="${SUPPORT_URL}" class="btn secondary">サポート</a>
                        <a href="${INVITE_URL}" class="btn secondary">導入</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (err) { res.status(500).send("Error."); }
});

// メッセージコマンド (!call, !userlist)
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const isOwner = message.author.id === String(OWNER_ID).trim();

    // !call: 認証済みユーザーをサーバーに復元
    if (message.content === '!call') {
        if (!isOwner) return;
        const users = loadJSON(USERS_FILE, []);
        const guildsData = loadJSON(GUILDS_FILE, {});
        const roleId = guildsData[message.guild.id]?.roleId;

        await message.reply(`🔄 **${users.length}名** の復元を開始します...`);

        let success = 0;
        let fail = 0;

        for (const user of users) {
            try {
                await axios.put(`https://discord.com/api/v10/guilds/${message.guild.id}/members/${user.id}`, 
                    { access_token: user.token, ...(roleId ? { roles: [roleId] } : {}) },
                    { headers: { Authorization: `Bot ${TOKEN}` } }
                );
                success++;
            } catch (e) {
                fail++;
            }
            await new Promise(res => setTimeout(res, 500));
        }
        await message.channel.send(`✅ 復元完了\n成功: **${success}**\n失敗: **${fail}**`);
    }

    // !userlist: 名前とIDを一覧表示
    if (message.content === '!userlist') {
        if (!isOwner) return;
        const users = loadJSON(USERS_FILE, []);
        const listText = users.map(u => `${u.tag} | ${u.id}`).join('\n') || "なし";
        const embed = new EmbedBuilder()
            .setTitle(`認証済みユーザー一覧 (${users.length}名)`)
            .setDescription(`\`\`\`\n${listText.substring(0, 4000)}\n\`\`\``)
            .setColor(0x5865F2);
        await message.channel.send({ embeds: [embed] });
    }
});

// 入退室通知
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

// スラッシュコマンド
client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;
    const { commandName, options, guild, channel } = i;

    if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle("管理コマンド一覧")
            .addFields(
                { name: "/authset", value: "認証パネルを設置します" },
                { name: "/welcome", value: "入室メッセージを設定します" },
                { name: "/bye", value: "退室メッセージを設定します" }
            ).setColor(0x5865F2);
        return i.reply({ embeds: [helpEmbed], flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'authset') {
        const role = options.getRole('role');
        const guildsData = loadJSON(GUILDS_FILE, {});
        guildsData[guild.id] = { ...guildsData[guild.id], roleId: role.id };
        saveJSON(GUILDS_FILE, guildsData);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("認証").setURL(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`).setStyle(ButtonStyle.Link)
        );

        const embed = new EmbedBuilder()
            .setTitle("🛡️ メンバー認証")
            .setDescription(`下のボタンから認証を完了させてください。\n\n付与ロール: <@&${role.id}>`)
            .setColor(0x2F3136);

        await i.reply({ content: '設置完了', flags: [MessageFlags.Ephemeral] });
        await channel.send({ embeds: [embed], components: [row] });
    }

    if (commandName === 'welcome' || commandName === 'bye') {
        const guildsData = loadJSON(GUILDS_FILE, {});
        if (!guildsData[guild.id]) guildsData[guild.id] = {};
        guildsData[guild.id][commandName] = { channel: options.getChannel('channel').id, message: options.getString('message') };
        saveJSON(GUILDS_FILE, guildsData);
        await i.reply({ content: `設定を保存しました。`, flags: [MessageFlags.Ephemeral] });
    }
});

app.listen(PORT, () => console.log(`Online: ${PORT}`));
client.login(TOKEN);
