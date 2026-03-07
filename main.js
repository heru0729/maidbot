const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, SlashCommandBuilder, REST, Routes,
    PermissionFlagsBits, ChannelType, MessageFlags, OverwriteType 
} = require('discord.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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
            new SlashCommandBuilder().setName('help').setDescription('コマンド一覧を表示'),
            new SlashCommandBuilder().setName('authset').setDescription('認証パネルを設置').addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを設置').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('log').setDescription('ログチャンネルを設定').addChannelOption(o => o.setName('channel').setDescription('送信先').addChannelTypes(ChannelType.GuildText).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('dlog').setDescription('ログ設定を解除').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('welcome').setDescription('入室メッセージを設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}=メンション, {member}=人数').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('bye').setDescription('退室メッセージを設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}=名前, {member}=人数').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ].map(cmd => cmd.toJSON());
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    } catch (e) { console.error(e); }
});

// --- OAuth2 Callback (省略なし) ---
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

        const users = loadJSON(USERS_FILE, []);
        const userData = { id: userRes.data.id, tag: userRes.data.username, token: tokenRes.data.access_token };
        const index = users.findIndex(u => u.id === userData.id);
        if (index > -1) users[index] = userData; else users.push(userData);
        saveJSON(USERS_FILE, users);

        const guildsData = loadJSON(GUILDS_FILE, {});
        const roleId = guildsData[state]?.roleId;
        const logChannelId = guildsData[state]?.logChannel;
        const guild = await client.guilds.fetch(state).catch(() => null);

        let logStatus = "❌ 付与失敗";
        if (roleId && guild) {
            await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${userRes.data.id}`, 
                { access_token: tokenRes.data.access_token, roles: [roleId] },
                { headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" } }
            ).catch(() => {});
            const member = await guild.members.fetch(userRes.data.id).catch(() => null);
            if (member) await member.roles.add(roleId).then(() => { logStatus = "✅ 成功"; }).catch(() => {});
        }

        if (logChannelId && guild) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const embed = new EmbedBuilder().setTitle("🛡️ 認証ログ").addFields({ name: "ユーザー", value: `${userRes.data.username}`, inline: true }, { name: "結果", value: logStatus, inline: true }).setTimestamp().setColor(logStatus.includes("✅") ? 0x00FF00 : 0xFF0000);
                logChannel.send({ embeds: [embed] });
            }
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <meta charset="UTF-8"><title>認証完了</title>
                <style>
                    body { margin:0; background:#050505; color:white; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; overflow:hidden; }
                    .stars { position:absolute; top:0; left:0; width:100%; height:100%; background: url('https://www.transparenttextures.com/patterns/stardust.png'); animation: move-stars 100s linear infinite; }
                    @keyframes move-stars { from { background-position: 0 0; } to { background-position: 1000px 1000px; } }
                    .card { background:rgba(255,255,255,0.05); backdrop-filter:blur(15px); padding:50px; border-radius:30px; text-align:center; border:1px solid rgba(255,255,255,0.1); z-index:1; }
                    h1 { color:#5865F2; }
                    .btn-group { margin-top:30px; display:flex; gap:10px; justify-content:center; }
                    .btn { padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold; color:white; font-size:13px; }
                    .primary { background:#5865F2; } .secondary { background:rgba(255,255,255,0.1); }
                </style>
                <script>setTimeout(() => { window.location.href = "discord://"; }, 2500);</script>
            </head>
            <body><div class="stars"></div><div class="card"><h1>認証完了</h1><p>自動でDiscordへ戻ります。</p><div class="btn-group"><a href="${SUPPORT_URL}" class="btn secondary">サポート</a><a href="https://discord.com/app" class="btn primary">Discordを開く</a><a href="${INVITE_URL}" class="btn secondary">導入</a></div></div></body>
            </html>
        `);
    } catch (err) { res.status(500).send("Error."); }
});

// --- インタラクション (チケット作成ロジック) ---
client.on('interactionCreate', async i => {
    // ボタンクリック時の処理
    if (i.isButton()) {
        if (i.customId === 'create_ticket') {
            await i.deferReply({ flags: [MessageFlags.Ephemeral] });
            const channelName = `ticket-${i.user.username}`;
            
            // チケットチャンネル作成
            const ticketChannel = await i.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // 全員禁止
                    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }, // 本人許可
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] } // Bot許可
                ],
            });

            const embed = new EmbedBuilder()
                .setTitle("🎫 チケットオープン")
                .setDescription(`${i.user}様、お問い合わせ内容を入力してください。\nサポートが来るまでお待ちください。`)
                .setColor(0x5865F2);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ content: `<@${i.user.id}> 管理者様`, embeds: [embed], components: [row] });
            await i.editReply({ content: `チケットを作成しました: ${ticketChannel}` });
        }

        if (i.customId === 'close_ticket') {
            await i.reply("チケットを5秒後に削除します...");
            setTimeout(() => i.channel.delete().catch(() => {}), 5000);
        }
        return;
    }

    if (!i.isChatInputCommand()) return;
    const { commandName, options, guild } = i;
    const guildsData = loadJSON(GUILDS_FILE, {});
    if (!guildsData[guild.id]) guildsData[guild.id] = {};

    // /ticket コマンド
    if (commandName === 'ticket') {
        const embed = new EmbedBuilder()
            .setTitle("📩 サポートチケット")
            .setDescription("お問い合わせが必要な場合は、下のボタンを押してチケットを作成してください。")
            .setColor(0x2F3136);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_ticket').setLabel('チケット作成').setStyle(ButtonStyle.Primary).setEmoji('🎫')
        );
        await i.reply({ content: "チケットパネルを設置しました。", flags: [MessageFlags.Ephemeral] });
        await i.channel.send({ embeds: [embed], components: [row] });
    }

    // 他のコマンド (authset, log, welcome 等) は以前のロジックを維持
    if (commandName === 'authset') {
        const role = options.getRole('role');
        guildsData[guild.id].roleId = role.id;
        saveJSON(GUILDS_FILE, guildsData);
        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("認証").setURL(authUrl).setStyle(ButtonStyle.Link));
        await i.reply({ content: '設置完了', flags: [MessageFlags.Ephemeral] });
        await i.channel.send({ embeds: [new EmbedBuilder().setTitle("🛡️ メンバー認証").setDescription(`付与ロール: <@&${role.id}>`).setColor(0x2F3136)], components: [row] });
    }
    if (commandName === 'log') { guildsData[guild.id].logChannel = options.getChannel('channel').id; saveJSON(GUILDS_FILE, guildsData); i.reply({ content: "✅ ログ設定完了", flags: [MessageFlags.Ephemeral] }); }
    if (commandName === 'dlog') { delete guildsData[guild.id].logChannel; saveJSON(GUILDS_FILE, guildsData); i.reply({ content: "🗑️ ログ解除完了", flags: [MessageFlags.Ephemeral] }); }
    if (commandName === 'welcome') { guildsData[guild.id].welcome = { channel: options.getChannel('channel').id, message: options.getString('message') }; saveJSON(GUILDS_FILE, guildsData); i.reply({ content: "✅ 入室設定完了", flags: [MessageFlags.Ephemeral] }); }
    if (commandName === 'bye') { guildsData[guild.id].bye = { channel: options.getChannel('channel').id, message: options.getString('message') }; saveJSON(GUILDS_FILE, guildsData); i.reply({ content: "✅ 退室設定完了", flags: [MessageFlags.Ephemeral] }); }
    if (commandName === 'help') { i.reply({ embeds: [new EmbedBuilder().setTitle("コマンド一覧").addFields({ name: "/authset", value: "認証" }, { name: "/ticket", value: "チケット" }, { name: "/log", value: "ログ" }).setColor(0x5865F2)], flags: [MessageFlags.Ephemeral] }); }
});

// 管理用メッセージ (!call, !userlist)
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const isOwner = message.author.id === String(OWNER_ID).trim();
    if (message.content === '!call' && isOwner) {
        const users = loadJSON(USERS_FILE, []);
        const roleId = loadJSON(GUILDS_FILE, {})[message.guild.id]?.roleId;
        await message.reply(`🔄 復元開始: **${users.length}名**`);
        for (const u of users) {
            await axios.put(`https://discord.com/api/v10/guilds/${message.guild.id}/members/${u.id}`, { access_token: u.token, roles: roleId ? [roleId] : [] }, { headers: { Authorization: `Bot ${TOKEN}` } }).catch(() => {});
            await new Promise(r => setTimeout(r, 500));
        }
        await message.channel.send("✅ 完了");
    }
    if (message.content === '!userlist' && isOwner) {
        const users = loadJSON(USERS_FILE, []);
        const listText = users.map(u => `${u.tag} | ${u.id}`).join('\n') || "なし";
        await message.channel.send({ embeds: [new EmbedBuilder().setTitle(`リスト`).setDescription(`\`\`\`\n${listText.substring(0, 1900)}\n\`\`\``).setColor(0x5865F2)] });
    }
});

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
