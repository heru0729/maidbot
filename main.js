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
const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, OWNER_ID } = process.env;

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

// 全インテンツ有効化
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ] 
});

client.once('ready', async (c) => {
    console.log(`✅ Online: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        const commands = [
            new SlashCommandBuilder().setName('help').setDescription('コマンド一覧'),
            new SlashCommandBuilder().setName('authset').setDescription('認証パネル設置').addRoleOption(o => o.setName('role').setDescription('付与ロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('log').setDescription('ログチャンネル設定').addChannelOption(o => o.setName('channel').setDescription('送信先').addChannelTypes(ChannelType.GuildText).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('dlog').setDescription('ログチャンネル解除').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('welcome').setDescription('入室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('内容').setRequired(true)),
            new SlashCommandBuilder().setName('bye').setDescription('退室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('内容').setRequired(true))
        ].map(cmd => cmd.toJSON());
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    } catch (e) { console.error(e); }
});

// OAuth2 認証コールバック
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Bad Request");
    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });

        // ユーザーデータ保存
        const users = loadJSON(USERS_FILE, []);
        const userData = { id: userRes.data.id, tag: userRes.data.username, token: tokenRes.data.access_token };
        const index = users.findIndex(u => u.id === userData.id);
        if (index > -1) users[index] = userData; else users.push(userData);
        saveJSON(USERS_FILE, users);

        const guildsData = loadJSON(GUILDS_FILE, {});
        const roleId = guildsData[state]?.roleId;
        const logChannelId = guildsData[state]?.logChannel;
        const guild = client.guilds.cache.get(state) || await client.guilds.fetch(state);

        let logStatus = "❌ 付与失敗（権限不足またはサーバー未参加）";

        if (roleId && guild) {
            // API経由で参加＆ロール付与
            await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${userRes.data.id}`, 
                { access_token: tokenRes.data.access_token, roles: [roleId] },
                { headers: { Authorization: `Bot ${TOKEN}` } }
            ).catch(() => {});

            // 直接ロール付与（既にいる場合）
            try {
                const member = await guild.members.fetch(userRes.data.id).catch(() => null);
                if (member) {
                    await member.roles.add(roleId);
                    logStatus = "✅ 成功";
                }
            } catch (e) { console.error(e); }
        }

        // ログ送信
        if (logChannelId && guild) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle("🛡️ 認証ログ")
                    .addFields(
                        { name: "ユーザー", value: `${userRes.data.username} (\`${userRes.data.id}\`)`, inline: false },
                        { name: "結果", value: logStatus, inline: false }
                    )
                    .setTimestamp().setColor(logStatus.includes("✅") ? 0x00FF00 : 0xFF0000);
                logChannel.send({ embeds: [logEmbed] });
            }
        }

        res.send(`<html><body style="background:#090a0f;color:white;text-align:center;padding:50px;font-family:sans-serif;"><h1>認証が完了しました</h1><p>Discordへ戻ってください。</p></body></html>`);
    } catch (err) { res.status(500).send("Error."); }
});

// 管理用メッセージコマンド
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const isOwner = message.author.id === String(OWNER_ID).trim();

    // !call: 全ユーザー復元
    if (message.content === '!call' && isOwner) {
        const users = loadJSON(USERS_FILE, []);
        const roleId = loadJSON(GUILDS_FILE, {})[message.guild.id]?.roleId;
        await message.reply(`🔄 復元開始: **${users.length}名**`);
        let s = 0; let f = 0;
        for (const u of users) {
            try {
                await axios.put(`https://discord.com/api/v10/guilds/${message.guild.id}/members/${u.id}`, { access_token: u.token, roles: roleId ? [roleId] : [] }, { headers: { Authorization: `Bot ${TOKEN}` } });
                s++;
            } catch (e) { f++; }
            await new Promise(r => setTimeout(r, 500));
        }
        await message.channel.send(`✅ 完了 (成功: ${s} / 失敗: ${f})`);
    }

    // !userlist: リスト表示
    if (message.content === '!userlist' && isOwner) {
        const users = loadJSON(USERS_FILE, []);
        const listText = users.map(u => `${u.tag} | ${u.id}`).join('\n') || "なし";
        const embed = new EmbedBuilder().setTitle(`認証済みリスト (${users.length}名)`).setDescription(`\`\`\`\n${listText.substring(0, 1900)}\n\`\`\``).setColor(0x5865F2);
        await message.channel.send({ embeds: [embed] });
    }
});

// スラッシュコマンド処理
client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;
    const { commandName, options, guild } = i;

    const guildsData = loadJSON(GUILDS_FILE, {});
    if (!guildsData[guild.id]) guildsData[guild.id] = {};

    if (commandName === 'log') {
        const channel = options.getChannel('channel');
        guildsData[guild.id].logChannel = channel.id;
        saveJSON(GUILDS_FILE, guildsData);
        return i.reply({ content: `✅ ログを <#${channel.id}> に設定しました。`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'dlog') {
        delete guildsData[guild.id].logChannel;
        saveJSON(GUILDS_FILE, guildsData);
        return i.reply({ content: `🗑️ ログ設定を解除しました。`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'authset') {
        const role = options.getRole('role');
        guildsData[guild.id].roleId = role.id;
        saveJSON(GUILDS_FILE, guildsData);
        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("認証").setURL(authUrl).setStyle(ButtonStyle.Link));
        await i.reply({ content: 'パネルを設置しました。', flags: [MessageFlags.Ephemeral] });
        await i.channel.send({ embeds: [new EmbedBuilder().setTitle("🛡️ メンバー認証").setDescription(`下のボタンから認証を完了させてください。\n\n付与ロール: <@&${role.id}>`).setColor(0x2F3136)], components: [row] });
    }

    if (commandName === 'welcome' || commandName === 'bye') {
        guildsData[guild.id][commandName] = { channel: options.getChannel('channel').id, message: options.getString('message') };
        saveJSON(GUILDS_FILE, guildsData);
        await i.reply({ content: `設定を保存しました。`, flags: [MessageFlags.Ephemeral] });
    }
    
    if (commandName === 'help') {
        const embed = new EmbedBuilder().setTitle("コマンド一覧").addFields(
            { name: "/authset", value: "認証パネルを設置" },
            { name: "/log", value: "ログチャンネルを設定" },
            { name: "/dlog", value: "ログを解除" },
            { name: "/welcome / /bye", value: "入退室通知を設定" }
        ).setColor(0x5865F2);
        i.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    }
});

// 入退室イベント
client.on('guildMemberAdd', async m => {
    const c = loadJSON(GUILDS_FILE, {})[m.guild.id]?.welcome;
    if (c) { const ch = await m.guild.channels.fetch(c.channel).catch(() => null); if (ch) ch.send(c.message.replace('{user}', `<@${m.id}>`).replace('{member}', m.guild.memberCount)); }
});

client.on('guildMemberRemove', async m => {
    const c = loadJSON(GUILDS_FILE, {})[m.guild.id]?.bye;
    if (c) { const ch = await m.guild.channels.fetch(c.channel).catch(() => null); if (ch) ch.send(c.message.replace('{user}', `**${m.user.username}**`).replace('{member}', m.guild.memberCount)); }
});

app.listen(PORT, () => console.log(`Online: ${PORT}`));
client.login(TOKEN);
