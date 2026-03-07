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
const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env;

const DATA_DIR = path.join(__dirname, "data");
const GUILDS_FILE = path.join(DATA_DIR, "guilds.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const loadJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return d; } };
const saveJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const COLORS = { PRIMARY: 0x5865F2, SUCCESS: 0x57F287, DANGER: 0xED4245, PANEL: 0x2B2D31 };

client.once('ready', async (c) => {
    console.log(`🚀 System Online: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [
        // ヘルプ
        new SlashCommandBuilder().setName('help').setDescription('コマンド一覧と使い方を表示'),
        // おみくじ
        new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占う'),
        // グローバルチャット
        new SlashCommandBuilder().setName('gchat-set').setDescription('【管理】グローバルチャット設定').addChannelOption(o => o.setName('channel').setDescription('送信先チャンネル').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('gchat-off').setDescription('【管理】グローバルチャット解除').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        // 役職パネル
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル操作')
            .addSubcommand(s => {
                s.setName('create').setDescription('新規作成').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true));
                for (let i = 1; i <= 10; i++) {
                    s.addRoleOption(o => o.setName(`role${i}`).setDescription(`ロール ${i}`))
                     .addStringOption(o => o.setName(`emoji${i}`).setDescription(`絵文字 ${i}`));
                }
                return s;
            })
            .addSubcommand(s => s.setName('delete').setDescription('パネル削除').addStringOption(o => o.setName('id').setDescription('メッセージID').setRequired(true)))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        // 認証
        new SlashCommandBuilder().setName('authset').setDescription('認証パネルを設置').addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        // ログ・警告
        new SlashCommandBuilder().setName('log').setDescription('警告・ログ送信先設定').addChannelOption(o => o.setName('channel').setDescription('警告ログの送信先').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        // 入退室
        new SlashCommandBuilder().setName('welcome').setDescription('入室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}=メンション, {member}=人数, {server}=サーバー名').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder().setName('bye').setDescription('退室設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}=名前, {member}=人数, {server}=サーバー名').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(cmd => cmd.toJSON());

    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    } catch (e) { console.error(e); }
});

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
        const embed = new EmbedBuilder()
            .setTitle('📖 ボットの使い方')
            .addFields(
                { name: '🌟 一般', value: '`/omikuji`: 今日の運勢\n`/help`: このメニュー' },
                { name: '🛡️ 管理・認証', value: '`/authset`: 認証パネル設置\n`/log`: 警告ログ設定\n`/rp create`: 役職パネル作成' },
                { name: '🌐 グローバルチャット', value: '`/gchat-set`: チャンネルを繋ぐ\n`/gchat-off`: 解除' },
                { name: '🚪 入退室設定', value: '`/welcome` / `/bye`: メッセージ設定\n利用可能タグ: `{user}`, `{member}`, `{server}`' }
            )
            .setColor(COLORS.PRIMARY);
        return i.reply({ embeds: [embed] });
    }

    if (commandName === 'omikuji') {
        const res = ["大吉 🌟", "中吉 ✨", "小吉 ✅", "吉 💠", "末吉 🍃", "凶 💀"][Math.floor(Math.random() * 6)];
        return i.reply({ embeds: [new EmbedBuilder().setTitle('⛩️ おみくじ').setDescription(`結果: **${res}**`).setColor(COLORS.PRIMARY)] });
    }

    if (commandName === 'rp') {
        if (options.getSubcommand() === 'create') {
            const title = options.getString('title');
            const embed = new EmbedBuilder().setTitle(`📌 ${title}`).setDescription("ボタンで役職を付け替えできます。").setColor(COLORS.PANEL);
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
            await i.reply({ content: "✅ 作成しました。", flags: [MessageFlags.Ephemeral] });
            return channel.send({ embeds: [embed], components: rows });
        }
        if (options.getSubcommand() === 'delete') {
            const msg = await channel.messages.fetch(options.getString('id')).catch(() => null);
            if (msg) { await msg.delete(); return i.reply({ content: "🗑️ 削除しました。", flags: [MessageFlags.Ephemeral] }); }
            return i.reply({ content: "❌ メッセージが見つかりません。", flags: [MessageFlags.Ephemeral] });
        }
    }

    if (commandName === 'gchat-set') { guildsData[guild.id].gChatChannel = options.getChannel('channel').id; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "🌐 設定しました。" }); }
    if (commandName === 'gchat-off') { delete guildsData[guild.id].gChatChannel; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "🌐 解除しました。" }); }
    if (commandName === 'log') { guildsData[guild.id].logChannel = options.getChannel('channel').id; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "✅ 保存完了。" }); }
    if (commandName === 'authset') {
        const role = options.getRole('role'); guildsData[guild.id].roleId = role.id; saveJSON(GUILDS_FILE, guildsData);
        const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`;
        return i.reply({ embeds: [new EmbedBuilder().setTitle("🛡️ 認証パネル").setDescription(`<@&${role.id}> を付与します。`).setColor(COLORS.PANEL)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("認証開始").setURL(url).setStyle(ButtonStyle.Link))] });
    }
    if (commandName === 'welcome' || commandName === 'bye') { guildsData[guild.id][commandName] = { channel: options.getChannel('channel').id, message: options.getString('message') }; saveJSON(GUILDS_FILE, guildsData); return i.reply({ content: "✅ 保存完了。" }); }
});

client.on('messageCreate', async m => {
    if (m.author.bot || !m.guild) return;
    const gData = loadJSON(GUILDS_FILE, {});
    if (gData[m.guild.id]?.gChatChannel === m.channel.id) {
        const emb = new EmbedBuilder().setAuthor({ name: m.author.tag, iconURL: m.author.displayAvatarURL() }).setDescription(m.content || "内容なし").setFooter({ text: `From: ${m.guild.name}` }).setColor(COLORS.PRIMARY);
        for (const id in gData) { if (gData[id].gChatChannel && gData[id].gChatChannel !== m.channel.id) { const ch = await client.channels.fetch(gData[id].gChatChannel).catch(() => null); if (ch) ch.send({ embeds: [emb] }); } }
    }
});

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

app.get('/callback', async (req, res) => {
    const { code, state } = req.query; if (!code || !state) return res.send("Error");
    try {
        const t = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({client_id:CLIENT_ID, client_secret:CLIENT_SECRET, grant_type:'authorization_code', code, redirect_uri:REDIRECT_URI}), {headers:{'Content-Type':'application/x-www-form-urlencoded'}});
        const u = await axios.get('https://discord.com/api/users/@me', {headers:{Authorization:`Bearer ${t.data.access_token}`}});
        const rId = loadJSON(GUILDS_FILE, {})[state]?.roleId;
        if (rId) await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${u.data.id}`, {access_token:t.data.access_token, roles:[rId]}, {headers:{Authorization:`Bot ${TOKEN}`}});
        res.send("<body style='background:#2B2D31;color:#57F287;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;'><h1>✅ 認証成功</h1></body>");
    } catch (e) { res.send("Auth Error"); }
});

app.listen(PORT, () => console.log(`Run on ${PORT}`));
client.login(TOKEN);
