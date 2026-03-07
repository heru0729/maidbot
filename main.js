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

// RailwayのVariables（環境変数）から読み込み
const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env;

// データの永続化用（RailwayのVolume: /app/data にマウント推奨）
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

// UIデザイン用の共通カラー
const COLORS = { PRIMARY: 0x5865F2, SUCCESS: 0x57F287, DANGER: 0xED4245, PANEL: 0x2B2D31 };

// --- スラッシュコマンド登録 ---
client.once('ready', async (c) => {
    console.log(`🚀 System Online: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commands = [
        new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占う'),
        new SlashCommandBuilder().setName('gchat-set').setDescription('【管理者】グローバルチャット送信先を設定').addChannelOption(o => o.setName('channel').setDescription('チャンネルを選択').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('gchat-off').setDescription('【管理者】グローバルチャットを解除').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル操作')
            .addSubcommand(s => s.setName('create').setDescription('新規パネル作成').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('setup').setDescription('@ロール1 絵文字1 @ロール2 絵文字2 ...').setRequired(true)))
            .addSubcommand(s => s.setName('delete').setDescription('パネルをメッセージIDで削除').addStringOption(o => o.setName('id').setDescription('メッセージID').setRequired(true)))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('authset').setDescription('認証パネルを設置').addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('log').setDescription('警告・ログ送信先設定').addChannelOption(o => o.setName('channel').setDescription('警告ログの送信先').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('welcome').setDescription('入室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}=メンション, {member}=人数, {server}=サーバー名').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('bye').setDescription('退室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}=名前, {member}=人数, {server}=サーバー名').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(cmd => cmd.toJSON());
    
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    } catch (e) { console.error("Command Register Error:", e); }
});

// --- インタラクション (コマンド & ボタン) ---
client.on('interactionCreate', async i => {
    const guildsData = loadJSON(GUILDS_FILE, {});
    if (i.guild && !guildsData[i.guild.id]) guildsData[i.guild.id] = {};

    // 役職パネルのボタン処理
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

    // おみくじ
    if (commandName === 'omikuji') {
        const res = ["大吉 🌟", "中吉 ✨", "小吉 ✅", "吉 💠", "末吉 🍃", "凶 💀"][Math.floor(Math.random() * 6)];
        const embed = new EmbedBuilder()
            .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
            .setTitle('⛩️ 本日の運勢')
            .setDescription(`あなたを引き当てた結果は... **${res}** です！`)
            .setColor(COLORS.PRIMARY).setTimestamp();
        return i.reply({ embeds: [embed] });
    }

    // 役職パネル (rp)
    if (commandName === 'rp') {
        const sub = options.getSubcommand();
        if (sub === 'create') {
            const title = options.getString('title');
            const setup = options.getString('setup').split(/\s+/);
            const embed = new EmbedBuilder().setTitle(`📌 ${title}`).setDescription("ボタンを押して役職を付け替えできます。").setColor(COLORS.PANEL).setFooter({ text: guild.name, iconURL: guild.iconURL() });
            
            const rows = [];
            let currentRow = new ActionRowBuilder();
            for (let j = 0; j < setup.length; j += 2) {
                const roleId = setup[j].replace(/[<@&>]/g, '');
                const emoji = setup[j+1] || "🔹";
                const role = guild.roles.cache.get(roleId);
                if (!role) continue;
                currentRow.addComponents(new ButtonBuilder().setCustomId(`rp_${roleId}`).setLabel(role.name).setEmoji(emoji).setStyle(ButtonStyle.Secondary));
                if (currentRow.components.length === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); }
            }
            if (currentRow.components.length > 0) rows.push(currentRow);
            await i.reply({ content: "✅ パネルを作成しました。", flags: [MessageFlags.Ephemeral] });
            return channel.send({ embeds: [embed], components: rows });
        }
        if (sub === 'delete') {
            const msg = await channel.messages.fetch(options.getString('id')).catch(() => null);
            if (msg) { await msg.delete(); return i.reply({ content: "🗑️ 削除しました。", flags: [MessageFlags.Ephemeral] }); }
            return i.reply({ content: "❌ メッセージが見つかりません。", flags: [MessageFlags.Ephemeral] });
        }
    }

    // グローバルチャット
    if (commandName === 'gchat-set') {
        guildsData[guild.id].gChatChannel = options.getChannel('channel').id;
        saveJSON(GUILDS_FILE, guildsData);
        return i.reply({ content: "🌐 グローバルチャットの送信先に設定しました。", flags: [MessageFlags.Ephemeral] });
    }
    if (commandName === 'gchat-off') {
        delete guildsData[guild.id].gChatChannel;
        saveJSON(GUILDS_FILE, guildsData);
        return i.reply({ content: "🌐 グローバルチャットを解除しました。", flags: [MessageFlags.Ephemeral] });
    }

    // 認証設定 (OAuth2)
    if (commandName === 'authset') {
        const role = options.getRole('role');
        guildsData[guild.id].roleId = role.id;
        saveJSON(GUILDS_FILE, guildsData);
        const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`;
        const embed = new EmbedBuilder()
            .setTitle('🛡️ メンバー認証')
            .setDescription(`サーバーの全機能を利用するには認証が必要です。\n\n**付与される役職:** <@&${role.id}>`)
            .setThumbnail(guild.iconURL()).setColor(COLORS.PANEL);
        await i.reply({ content: "✅ 認証パネルを設置しました。", flags: [MessageFlags.Ephemeral] });
        return channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('認証を開始する').setURL(url).setStyle(ButtonStyle.Link))] });
    }

    // 各種ログ・入退室
    if (commandName === 'log') {
        guildsData[guild.id].logChannel = options.getChannel('channel').id;
        saveJSON(GUILDS_FILE, guildsData);
        return i.reply({ content: "✅ ログ・警告の送信先を設定しました。", flags: [MessageFlags.Ephemeral] });
    }
    if (commandName === 'welcome' || commandName === 'bye') {
        guildsData[guild.id][commandName] = { channel: options.getChannel('channel').id, message: options.getString('message') };
        saveJSON(GUILDS_FILE, guildsData);
        return i.reply({ content: "✅ 設定を保存しました。", flags: [MessageFlags.Ephemeral] });
    }
});

// --- グローバルチャット転送 ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const guildsData = loadJSON(GUILDS_FILE, {});
    if (guildsData[message.guild.id]?.gChatChannel === message.channel.id) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setDescription(message.content || "内容なし")
            .setFooter({ text: `送信元: ${message.guild.name}` }).setTimestamp().setColor(COLORS.PRIMARY);
        
        for (const id in guildsData) {
            const targetChId = guildsData[id].gChatChannel;
            if (targetChId && targetChId !== message.channel.id) {
                const targetCh = await client.channels.fetch(targetChId).catch(() => null);
                if (targetCh) targetCh.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }
});

// --- サブ垢警告 & 入退室イベント ({server}対応) ---
client.on('guildMemberAdd', async m => {
    const guildsData = loadJSON(GUILDS_FILE, {});
    const config = guildsData[m.guild.id];
    if (!config) return;

    // サブ垢検知 (7日以内)
    const ageDays = (Date.now() - m.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (config.logChannel && ageDays < 7) {
        const logCh = await m.guild.channels.fetch(config.logChannel).catch(() => null);
        if (logCh) {
            const embed = new EmbedBuilder()
                .setTitle("⚠️ セキュリティ警告")
                .setDescription(`**ユーザー:** ${m.user.tag}\n**作成日:** <t:${Math.floor(m.user.createdTimestamp/1000)}:D> (<t:${Math.floor(m.user.createdTimestamp/1000)}:R>)\n**注意:** 作成から7日以内の新規アカウントです。`)
                .setColor(COLORS.DANGER).setTimestamp();
            logCh.send({ embeds: [embed] });
        }
    }

    if (config.welcome) {
        const ch = await m.guild.channels.fetch(config.welcome.channel).catch(() => null);
        if (ch) ch.send(config.welcome.message.replace('{user}', `<@${m.id}>`).replace('{member}', m.guild.memberCount).replace('{server}', m.guild.name));
    }
});

client.on('guildMemberRemove', async m => {
    const config = loadJSON(GUILDS_FILE, {})[m.guild.id]?.bye;
    if (config) {
        const ch = await m.guild.channels.fetch(config.channel).catch(() => null);
        if (ch) ch.send(config.message.replace('{user}', `**${m.user.username}**`).replace('{member}', m.guild.memberCount).replace('{server}', m.guild.name));
    }
});

// --- 認証後リッチ画面 (Express) ---
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

        const guildsData = loadJSON(GUILDS_FILE, {});
        const roleId = guildsData[state]?.roleId;
        if (roleId) {
            await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${userRes.data.id}`, 
                { access_token: tokenRes.data.access_token, roles: [roleId] },
                { headers: { Authorization: `Bot ${TOKEN}` } }
            ).catch(e => console.error("Role Grant Error:", e));
        }

        res.send(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>認証完了</title>
            <style>
                body { margin: 0; background: #0f0f12; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; }
                .card { background: #2b2d31; padding: 40px; border-radius: 20px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                h1 { color: #57f287; margin: 0 0 10px; }
                p { color: #b5bac1; }
                .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #5865F2; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>✅ 認証成功</h1>
                <p>アカウントの確認が完了しました。<br>Discordへ戻ってください。</p>
                <a href="https://discord.com/app" class="btn">Discordを開く</a>
            </div>
        </body>
        </html>
        `);
    } catch (err) { res.status(500).send("Verification Error"); }
});

app.listen(PORT, () => console.log(`🌍 Server Running on port ${PORT}`));
client.login(TOKEN);
