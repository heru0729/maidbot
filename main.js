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
const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, OWNER_ID } = process.env;

const DATA_DIR = path.join(__dirname, "data");
const GUILDS_FILE = path.join(DATA_DIR, "guilds.json");
const AUTH_USERS_FILE = path.join(DATA_DIR, "auth_users.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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

// --- スラッシュコマンド登録 ---
client.once('ready', async (c) => {
    console.log(`🚀 System Online: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('コマンド一覧と使い方を表示します'),
        new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占います'),
        new SlashCommandBuilder().setName('check').setDescription('【運営】ユーザーの安全性を調査します').addUserOption(o => o.setName('user').setDescription('調査対象のユーザー').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
        new SlashCommandBuilder().setName('gchat-set').setDescription('【管理】グローバルチャットの送信先を設定します').addChannelOption(o => o.setName('channel').setDescription('送信先チャンネル').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('gchat-off').setDescription('【管理】グローバルチャットを解除します').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('authset').setDescription('【管理】認証パネルを設置します').addRoleOption(o => o.setName('role').setDescription('認証後に付与するロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('log').setDescription('【管理】警告・ログ送信先を設定します').addChannelOption(o => o.setName('channel').setDescription('ログ送信先チャンネル').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('welcome').setDescription('【管理】入室メッセージを設定します').addChannelOption(o => o.setName('channel').setDescription('送信先チャンネル').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}, {member}, {server} が使用可能').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('bye').setDescription('【管理】退室メッセージを設定します').addChannelOption(o => o.setName('channel').setDescription('送信先チャンネル').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}, {member}, {server} が使用可能').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル操作')
            .addSubcommand(s => {
                s.setName('create').setDescription('新規パネル作成')
                 .addStringOption(o => o.setName('title').setDescription('パネルのタイトル').setRequired(true))
                 .addStringOption(o => o.setName('description').setDescription('パネルの説明文').setRequired(true));
                for (let j = 1; j <= 10; j++) {
                    s.addRoleOption(o => o.setName(`role${j}`).setDescription(`ロール ${j} を選択`))
                     .addStringOption(o => o.setName(`emoji${j}`).setDescription(`絵文字 ${j} を入力`));
                }
                return s;
            })
            .addSubcommand(s => s.setName('delete').setDescription('パネルをメッセージIDで削除').addStringOption(o => o.setName('id').setDescription('メッセージID').setRequired(true)))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(cmd => cmd.toJSON());

    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    } catch (e) { console.error("Register Error:", e); }
});

// --- インタラクション処理 ---
client.on('interactionCreate', async i => {
    const guildsData = loadJSON(GUILDS_FILE, {});
    if (i.guild && !guildsData[i.guild.id]) guildsData[i.guild.id] = {};

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

    if (commandName === 'help') {
        const embed = new EmbedBuilder().setTitle('📖 ヘルプメニュー').addFields(
            { name: '管理コマンド', value: '`/rp create`, `/authset`, `/log`, `/welcome`, `/bye`, `/check`' },
            { name: '一般コマンド', value: '`/omikuji`, `/help`' },
        ).setColor(COLORS.PRIMARY);
        return i.reply({ embeds: [embed] });
    }

    if (commandName === 'check') {
        const target = options.getMember('user') || options.getUser('user');
        const createdAt = target.user ? target.user.createdTimestamp : target.createdTimestamp;
        const accountAge = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
        
        let status = { label: "安全 ✅", color: COLORS.SUCCESS, reason: "問題なし" };
        if (accountAge < 7) status = { label: "警戒 🔴", color: COLORS.DANGER, reason: "作成7日以内" };
        else if (accountAge < 30) status = { label: "要注意 ⚠️", color: COLORS.WARNING, reason: "作成1ヶ月以内" };

        const authData = loadJSON(AUTH_USERS_FILE, {});
        const targetName = (target.user?.username || target.username).toLowerCase();
        const possibleMain = Object.values(authData).find(u => u.id !== target.id && (targetName.includes(u.username.toLowerCase()) || u.username.toLowerCase().includes(targetName)));

        const embed = new EmbedBuilder().setTitle(`🔍 調査: ${target.user?.tag || target.tag}`)
            .addFields(
                { name: '判定', value: `**[ ${status.label} ]**\n${status.reason}` },
                { name: '作成日', value: `<t:${Math.floor(createdAt/1000)}:D> (<t:${Math.floor(createdAt/1000)}:R>)` },
                { name: '本垢候補', value: possibleMain ? `<@${possibleMain.id}>` : "不明" }
            ).setColor(status.color);
        return i.reply({ embeds: [embed] });
    }

    if (commandName === 'rp' && options.getSubcommand() === 'create') {
        const title = options.getString('title');
        const desc = options.getString('description');
        const embed = new EmbedBuilder().setTitle(`📌 ${title}`).setDescription(desc).setColor(COLORS.PANEL);
        const rows = [];
        let currentRow = new ActionRowBuilder();
        for (let j = 1; j <= 10; j++) {
            const role = options.getRole(`role${j}`);
            const emoji = options.getString(`emoji${j}`) || "🔹";
            if (!role) continue;
            currentRow.addComponents(new ButtonBuilder().setCustomId(`rp_${role.id}`).setLabel(role.name).setEmoji(emoji).setStyle(ButtonStyle.Secondary));
            if (currentRow.components.length === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); }
        }
        if (currentRow.components.length > 0) rows.push(currentRow);
        await i.reply({ content: "✅ パネルを作成しました。", flags: [MessageFlags.Ephemeral] });
        return channel.send({ embeds: [embed], components: rows });
    }

    if (commandName === 'omikuji') {
        const res = ["大吉 🌟", "中吉 ✨", "小吉 ✅", "吉 💠", "末吉 🍃", "凶 💀"][Math.floor(Math.random() * 6)];
        return i.reply({ embeds: [new EmbedBuilder().setTitle('⛩️ おみくじ').setDescription(`結果: **${res}**`).setColor(COLORS.PRIMARY)] });
    }
    if (commandName === 'gchat-set') { guildsData[guild.id].gChatChannel = options.getChannel('channel').id; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "🌐 設定完了" }); }
    if (commandName === 'authset') {
        const role = options.getRole('role'); guildsData[guild.id].roleId = role.id; saveJSON(GUILDS_FILE, guildsData);
        const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`;
        return i.reply({ embeds:[new EmbedBuilder().setTitle("🛡️ 認証").setDescription(`<@&${role.id}> を付与します。`).setColor(COLORS.PANEL)], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("認証開始").setURL(url).setStyle(ButtonStyle.Link))] });
    }
    if (commandName === 'log') { guildsData[guild.id].logChannel = options.getChannel('channel').id; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "✅ ログ設定完了" }); }
    if (commandName === 'welcome' || commandName === 'bye') { guildsData[guild.id][commandName] = { channel: options.getChannel('channel').id, message: options.getString('message') }; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "✅ 設定完了" }); }
});

// --- オーナー限定メッセージコマンド ---
client.on('messageCreate', async m => {
    if (m.author.bot) return;

    const gData = loadJSON(GUILDS_FILE, {});
    if (m.guild && gData[m.guild.id]?.gChatChannel === m.channel.id && !m.content.startsWith('!')) {
        const emb = new EmbedBuilder().setAuthor({ name: m.author.tag, iconURL: m.author.displayAvatarURL() }).setDescription(m.content).setFooter({ text: `From: ${m.guild.name}` }).setColor(COLORS.PRIMARY);
        for (const id in gData) { if (gData[id].gChatChannel && gData[id].gChatChannel !== m.channel.id) { const ch = await client.channels.fetch(gData[id].gChatChannel).catch(() => null); if (ch) ch.send({ embeds: [emb] }); } }
    }

    if (!m.content.startsWith('!') || m.author.id !== OWNER_ID) return;

    if (m.content === '!userlist') {
        const authData = loadJSON(AUTH_USERS_FILE, {});
        const users = Object.values(authData);
        
        if (users.length === 0) return m.reply("連携済みのユーザーはいません。");

        const list = users.map(u => `・**${u.username}** (ID: \`${u.id}\`)`).join('\n');
        
        // メッセージが長すぎるとDiscordで送れないため、分割して送信
        const header = `📊 **連携済みユーザー一覧 (計 ${users.length}名)**\n\n`;
        if (header.length + list.length > 2000) {
            return m.reply("ユーザー数が多すぎるため、コンソールを確認するかファイルを分割してください。");
        }
        
        return m.reply(header + list);
    }
    
    };
    if (m.content === '!serverlist') {
        const list = client.guilds.cache.map(g => `${g.name} (${g.id}) - ${g.memberCount}人`).join('\n');
        return m.reply(`サーバー一覧:\n${list.slice(0, 1900)}`);
    }
    if (m.content.startsWith('!call ')) {
        const text = m.content.slice(6);
        client.guilds.cache.forEach(g => {
            const ch = g.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(g.members.me).has(PermissionFlagsBits.SendMessages));
            if (ch) ch.send(`📢 **オーナーからのお知らせ**\n${text}`).catch(() => {});
        });
        return m.reply("✅ 全サーバーへ送信しました。");
    }
});

app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) return res.send("Error: Missing code or state");
    
    try {
        // アクセストークンの取得
        const t = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // ユーザー情報の取得
        const u = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${t.data.access_token}` }
        });

        // 認証ユーザーデータを保存（!userlist用）
        const authData = loadJSON(AUTH_USERS_FILE, {});
        authData[u.data.id] = { id: u.data.id, username: u.data.username };
        saveJSON(AUTH_USERS_FILE, authData);

        // ギルド設定から付与するロールIDを取得
        const guildsData = loadJSON(GUILDS_FILE, {});
        const rId = guildsData[state]?.roleId;

        if (rId) {
            // サーバーにメンバーを追加、または既存メンバーにロールを付与
            await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${u.data.id}`, {
                access_token: t.data.access_token,
                roles: [rId]
            }, {
                headers: { Authorization: `Bot ${TOKEN}` }
            });
        }

        // 成功時のHTMLレスポンス
        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { margin: 0; background: #0b0e14; color: white; font-family: sans-serif; overflow: hidden; display: flex; justify-content: center; align-items: center; height: 100vh; }
                .stars { position: absolute; width: 200%; height: 200%; background: url('https://www.transparenttextures.com/patterns/stardust.png'); animation: move 100s linear infinite; z-index: -1; opacity: 0.5; }
                @keyframes move { from { transform: translate(0, 0); } to { transform: translate(-50%, -50%); } }
                .card { background: rgba(43, 45, 49, 0.9); padding: 50px; border-radius: 20px; text-align: center; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
                h1 { color: #57F287; font-size: 2.5em; }
                .btn-group { display: flex; gap: 10px; justify-content: center; margin-top: 25px; }
                .btn { padding: 12px 25px; border-radius: 8px; text-decoration: none; color: white; font-weight: bold; transition: 0.3s; }
                .primary { background: #5865F2; } .secondary { background: #4e5058; }
                .btn:hover { opacity: 0.8; transform: scale(1.05); }
            </style>
        </head>
        <body>
            <div class="stars"></div>
            <div class="card">
                <h1>✅ 認証成功</h1>
                <p>サーバーへの参加・役職付与が完了しました。</p>
                <div class="btn-group">
                    <a href="https://discord.gg/SUPPORT" class="btn secondary">サポートサーバー</a>
                    <a href="https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands" class="btn primary">ボットを導入</a>
                </div>
            </div>
        </body>
        </html>
        `);
    } catch (e) {
        console.error("Auth Callback Error:", e.response?.data || e.message);
        res.send("認証エラーが発生しました。もう一度やり直してください。");
    }
});

client.on('guildMemberAdd', async m => {
    const conf = loadJSON(GUILDS_FILE, {})[m.guild.id]; if (!conf) return;
    if (conf.logChannel && (Date.now() - m.user.createdTimestamp) < 7*24*60*60*1000) {
        const l = await m.guild.channels.fetch(conf.logChannel).catch(() => null);
        if (l) l.send({ embeds: [new EmbedBuilder().setTitle("⚠️ サブ垢警告").setDescription(`**${m.user.tag}**\n作成: <t:${Math.floor(m.user.createdTimestamp/1000)}:R>`).setColor(COLORS.DANGER)] });
    }
    if (conf.welcome) { const c = await m.guild.channels.fetch(conf.welcome.channel).catch(() => null); if (c) c.send(conf.welcome.message.replace('{user}', `<@${m.id}>`).replace('{member}', m.guild.memberCount).replace('{server}', m.guild.name)); }
});

client.on('guildMemberRemove', async m => {
    const cnf = loadJSON(GUILDS_FILE, {})[m.guild.id]?.bye;
    if (cnf) { const c = await m.guild.channels.fetch(cnf.channel).catch(() => null); if (c) c.send(cnf.message.replace('{user}', `**${m.user.username}**`).replace('{member}', m.guild.memberCount).replace('{server}', m.guild.name)); }
});

app.listen(PORT, () => console.log(`Active on ${PORT}`));
client.login(TOKEN);
