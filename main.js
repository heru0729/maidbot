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

const COLORS = { PRIMARY: 0x5865F2, SUCCESS: 0x57F287, DANGER: 0xED4245, PANEL: 0x2B2D31 };

client.once('ready', async (c) => {
    console.log(`🚀 System Online: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('コマンド一覧'),
        new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占う'),
        new SlashCommandBuilder().setName('gchat-set').setDescription('グローバルチャット設定').addChannelOption(o => o.setName('channel').setRequired(true).setDescription('チャンネル')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('gchat-off').setDescription('グローバルチャット解除').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル操作')
            .addSubcommand(s => {
                s.setName('create').setDescription('新規作成')
                 .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true))
                 .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(true));
                for (let i = 1; i <= 10; i++) {
                    s.addRoleOption(o => o.setName(`role${i}`).setDescription(`ロール ${i}`))
                     .addStringOption(o => o.setName(`emoji${i}`).setDescription(`絵文字 ${i}`));
                }
                return s;
            })
            .addSubcommand(s => s.setName('delete').setDescription('削除').addStringOption(o => o.setName('id').setRequired(true).setDescription('ID')))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('authset').setDescription('認証パネル設置').addRoleOption(o => o.setName('role').setRequired(true).setDescription('付与ロール')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('log').setDescription('警告ログ設定').addChannelOption(o => o.setName('channel').setRequired(true).setDescription('送信先')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('welcome').setDescription('入室設定').addChannelOption(o => o.setName('channel').setRequired(true)).addStringOption(o => o.setName('message').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('bye').setDescription('退室設定').addChannelOption(o => o.setName('channel').setRequired(true)).addStringOption(o => o.setName('message').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(cmd => cmd.toJSON());

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
});

client.on('interactionCreate', async i => {
    const guildsData = loadJSON(GUILDS_FILE, {});
    if (i.guild && !guildsData[i.guild.id]) guildsData[i.guild.id] = {};

    if (i.isButton() && i.customId.startsWith('rp_')) {
        const roleId = i.customId.replace('rp_', '');
        const role = i.guild.roles.cache.get(roleId);
        if (!role) return i.reply({ content: "❌ 役職不明", flags: [MessageFlags.Ephemeral] });
        if (i.member.roles.cache.has(roleId)) {
            await i.member.roles.remove(roleId).catch(() => {});
            return i.reply({ content: `✅ **${role.name}** を解除`, flags: [MessageFlags.Ephemeral] });
        } else {
            await i.member.roles.add(roleId).catch(() => {});
            return i.reply({ content: `✅ **${role.name}** を付与`, flags: [MessageFlags.Ephemeral] });
        }
    }

    if (!i.isChatInputCommand()) return;
    const { commandName, options, guild, channel } = i;

    if (commandName === 'help') {
        const embed = new EmbedBuilder().setTitle('📖 ヘルプ').addFields(
            { name: '管理', value: '`/rp create`, `/authset`, `/log`, `/welcome`, `/bye`' },
            { name: 'その他', value: '`/omikuji`, `/help`' },
            { name: 'オーナー専用(!)', value: '`!call`, `!userlist`, `!serverlist`' }
        ).setColor(COLORS.PRIMARY);
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
        await i.reply({ content: "✅ 作成完了", flags: [MessageFlags.Ephemeral] });
        return channel.send({ embeds: [embed], components: rows });
    }

    // 他のコマンド(omikuji, authset等)は以前と同様に実装
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
    if (commandName === 'log') { guildsData[guild.id].logChannel = options.getChannel('channel').id; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "✅ 保存" }); }
    if (commandName === 'welcome' || commandName === 'bye') { guildsData[guild.id][commandName] = { channel: options.getChannel('channel').id, message: options.getString('message') }; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "✅ 保存" }); }
});

// --- 管理用メッセージコマンド (!call, !userlist, !serverlist) ---
client.on('messageCreate', async m => {
    if (m.author.bot || !m.content.startsWith('!')) return;
    
    // グローバルチャット転送
    const gData = loadJSON(GUILDS_FILE, {});
    if (m.guild && gData[m.guild.id]?.gChatChannel === m.channel.id && !m.content.startsWith('!')) {
        const emb = new EmbedBuilder().setAuthor({ name: m.author.tag, iconURL: m.author.displayAvatarURL() }).setDescription(m.content).setFooter({ text: `From: ${m.guild.name}` }).setColor(COLORS.PRIMARY);
        for (const id in gData) { if (gData[id].gChatChannel && gData[id].gChatChannel !== m.channel.id) { const ch = await client.channels.fetch(gData[id].gChatChannel).catch(() => null); if (ch) ch.send({ embeds: [emb] }); } }
        return;
    }

    // オーナー限定コマンド
    if (m.author.id !== OWNER_ID) return;

    if (m.content === '!userlist') {
        const total = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        return m.reply(`📊 総ユーザー数: **${total}** 名`);
    }
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

// --- 認証後画面 (宇宙背景アニメーション) ---
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) return res.send("Error");
    try {
        const t = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({client_id:CLIENT_ID, client_secret:CLIENT_SECRET, grant_type:'authorization_code', code, redirect_uri:REDIRECT_URI}), {headers:{'Content-Type':'application/x-www-form-urlencoded'}});
        const u = await axios.get('https://discord.com/api/users/@me', {headers:{Authorization:`Bearer ${t.data.access_token}`}});
        const rId = loadJSON(GUILDS_FILE, {})[state]?.roleId;
        if (rId) await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${u.data.id}`, {access_token:t.data.access_token, roles:[rId]}, {headers:{Authorization:`Bot ${TOKEN}`}});
        
        // リッチな宇宙背景UI
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
                    <a href="https://discord.gg/YOUR_SUPPORT_LINK" class="btn secondary">サポートサーバー</a>
                    <a href="https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands" class="btn primary">ボットを導入</a>
                </div>
            </div>
        </body>
        </html>
        `);
    } catch (e) { res.send("Auth Error"); }
});

// 入退室・サブ垢警告などは以前のコードを維持
client.on('guildMemberAdd', async m => {
    const conf = loadJSON(GUILDS_FILE, {})[m.guild.id]; if (!conf) return;
    if (conf.logChannel && (Date.now() - m.user.createdTimestamp) < 7*24*60*60*1000) {
        const l = await m.guild.channels.fetch(conf.logChannel).catch(() => null);
        if (l) l.send({ embeds: [new EmbedBuilder().setTitle("⚠️ 新規アカウント警告").setDescription(`**${m.user.tag}**\n作成: <t:${Math.floor(m.user.createdTimestamp/1000)}:R>`).setColor(COLORS.DANGER)] });
    }
    if (conf.welcome) { const c = await m.guild.channels.fetch(conf.welcome.channel).catch(() => null); if (c) c.send(conf.welcome.message.replace('{user}', `<@${m.id}>`).replace('{member}', m.guild.memberCount).replace('{server}', m.guild.name)); }
});

client.on('guildMemberRemove', async m => {
    const cnf = loadJSON(GUILDS_FILE, {})[m.guild.id]?.bye;
    if (cnf) { const c = await m.guild.channels.fetch(cnf.channel).catch(() => null); if (c) c.send(cnf.message.replace('{user}', `**${m.user.username}**`).replace('{member}', m.guild.memberCount).replace('{server}', m.guild.name)); }
});

app.listen(PORT, () => console.log(`Active on ${PORT}`));
client.login(TOKEN);
