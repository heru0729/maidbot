const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, Events, ChannelType, PermissionFlagsBits, Collection } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const setupAuth = require('./auth.js');
const handleAdminCommands = require('./admin.js');

const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message]
});

const TOKEN = process.env.TOKEN; 
const OWNER_IDS = process.env.OWNER_ID ? process.env.OWNER_ID.split(',').map(id => id.trim()) : [];
const CLIENT_ID = process.env.CLIENT_ID; 
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

function loadData(f) {
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function saveData(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 4)); }

function replacePlaceholders(t, m) {
    if (!t) return "";
    return t.replace(/{user}/g, `<@${m.id}>`)
            .replace(/{server}/g, m.guild.name)
            .replace(/{members}/g, m.guild.memberCount.toString());
}

async function sendLog(guild, embed) {
    const s = loadData(SERVERS_FILE);
    const cid = s[guild.id]?.logChannel;
    if (cid) {
        const ch = guild.channels.cache.get(cid);
        if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
    }
}

function createMainSetRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('set_menu_log').setLabel('ログ設定').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_menu_msg').setLabel('入退室通知').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_menu_ng').setLabel('NGワード').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('set_menu_lock').setLabel('ロック状態').setStyle(ButtonStyle.Danger)
    );
}

function createLogConfigRow(c) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('log_toggle_edit').setLabel(`編集: ${c.edit ? 'ON' : 'OFF'}`).setStyle(c.edit ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_delete').setLabel(`削除: ${c.delete ? 'ON' : 'OFF'}`).setStyle(c.delete ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_join').setLabel(`入室: ${c.join ? 'ON' : 'OFF'}`).setStyle(c.join ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('log_toggle_leave').setLabel(`退出: ${c.leave ? 'ON' : 'OFF'}`).setStyle(c.leave ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary)
    );
}

setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET);
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Web Server Ready'));

client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} ログイン完了`);
    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('コマンド一覧を表示'),
        new SlashCommandBuilder().setName('set').setDescription('サーバーの各種設定を一括管理'),
        new SlashCommandBuilder().setName('log').setDescription('ログ送信先設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)),
        new SlashCommandBuilder().setName('welcome').setDescription('入室通知設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}, {server}, {members}が使えます').setRequired(true)),
        new SlashCommandBuilder().setName('bye').setDescription('退室通知設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)).addStringOption(o => o.setName('message').setDescription('{user}, {server}, {members}が使えます').setRequired(true)),
        new SlashCommandBuilder().setName('authset').setDescription('Web連携認証パネル作成').addStringOption(o => o.setName('title').setDescription('題名').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o => o.setName('button').setDescription('ボタン名').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('付与ロール').setRequired(true)),
        new SlashCommandBuilder().setName('ticket').setDescription('お問合せパネル作成').addStringOption(o => o.setName('title').setDescription('題名').setRequired(true)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true)).addStringOption(o => o.setName('button').setDescription('ボタン名').setRequired(true)).addRoleOption(o => o.setName('mention-role').setDescription('通知先ロール').setRequired(true)),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャット設定').addChannelOption(o => o.setName('channel').setDescription('送信先').setRequired(true)),
        new SlashCommandBuilder().setName('gdel').setDescription('グローバルチャット解除'),
        new SlashCommandBuilder().setName('ngword').setDescription('NGワード設定').addSubcommand(s => s.setName('create').setDescription('追加').addStringOption(o => o.setName('word').setDescription('ワード').setRequired(true))).addSubcommand(s => s.setName('delete').setDescription('削除').addStringOption(o => o.setName('word').setDescription('ワード').setRequired(true))).addSubcommand(s => s.setName('list').setDescription('一覧')),
        new SlashCommandBuilder().setName('chatlock').setDescription('チャット一時ロック').addIntegerOption(o => o.setName('seconds').setDescription('ロック秒数').setRequired(true)),
        new SlashCommandBuilder().setName('omikuji').setDescription('おみくじ'),
        new SlashCommandBuilder().setName('kaso').setDescription('サーバーの活動状況調査'),
        new SlashCommandBuilder().setName('rp').setDescription('役職パネル管理').addSubcommand(sub => {
            sub.setName('create').setDescription('役職パネル作成').addStringOption(o => o.setName('title').setDescription('パネルの題名').setRequired(true)).addStringOption(o => o.setName('description').setDescription('パネルの説明文').setRequired(true));
            for (let i = 1; i <= 10; i++) {
                sub.addRoleOption(o => o.setName(`role${i}`).setDescription(`ロール ${i}`)).addStringOption(o => o.setName(`emoji${i}`).setDescription(`絵文字 ${i}`));
            }
            return sub;
        }).addSubcommand(sub => sub.setName('delete').setDescription('パネル削除ボタン表示'))
    ].map(c => c.toJSON());
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
});

client.on(Events.InteractionCreate, async (i) => {
    const s = loadData(SERVERS_FILE); 
    const gid = i.guildId;
    if (!s[gid]) s[gid] = { logConfig: { edit: true, delete: true, join: true, leave: true }, ngwords: [], locked: false };
    
    if (i.isChatInputCommand()) {
        const { commandName, options: o } = i;

        if (commandName === 'set') {
            const embed = new EmbedBuilder()
                .setTitle('⚙️ サーバー管理パネル')
                .setDescription('下のボタンから各項目の設定を確認・変更できます。')
                .setColor(0x5865F2);
            await i.reply({ embeds: [embed], components: [createMainSetRow()], ephemeral: true });
        }

        if (commandName === 'help') {
            const embed1 = new EmbedBuilder().setTitle('コマンド一覧').setColor(0x7289DA).addFields(
                { name: '🛠 管理機能', value: '`/set`: 設定の一括管理\n`/log`: ログ送信先設定\n`/welcome`: 入室通知設定\n`/bye`: 退室通知設定\n`/ngword`: NGワード設定\n`/chatlock`: チャット制限\n`/kaso`: 過疎調査' }
            );
            const embed2 = new EmbedBuilder().setTitle('コマンド一覧').setColor(0x7289DA).addFields(
                { name: '👤 認証 & パネル', value: '`/authset`: 認証パネル作成\n`/ticket`: 問い合わせ受付\n`/rp create`: 役職パネル作成\n`/rp delete`: パネル削除' },
                { name: '🌐 交流', value: '`/gset`: グローバルチャット\n`/gdel`: チャット解除\n`/omikuji`: おみくじ' }
            );
            await i.reply({ embeds: [embed1, embed2], ephemeral: true }); 
        }
        if (commandName === 'log') { s[gid].logChannel = o.getChannel('channel').id; saveData(SERVERS_FILE, s); await i.reply('ログ送信先を設定しました。'); }
        if (commandName === 'authset') {
            s[gid].authRole = o.getRole('role').id; saveData(SERVERS_FILE, s);
            const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(o.getString('button')).setStyle(ButtonStyle.Link).setURL(authUrl));
            await i.reply({ embeds: [new EmbedBuilder().setTitle(o.getString('title')).setDescription(o.getString('description')).setColor(0x43B581)], components: [row] });
        }
        if (commandName === 'chatlock') {
            const sec = o.getInteger('seconds');
            s[gid].locked = true; saveData(SERVERS_FILE, s);
            setTimeout(() => { const d = loadData(SERVERS_FILE); if(d[gid]) d[gid].locked = false; saveData(SERVERS_FILE, d); }, sec * 1000);
            await i.reply(`チャットを ${sec} 秒間ロックしました。`);
        }
        if (commandName === 'ngword') {
            const sub = o.getSubcommand(); const word = o.getString('word');
            if (sub === 'create') { s[gid].ngwords.push(word); await i.reply(`追加: ${word}`); }
            else if (sub === 'delete') { s[gid].ngwords = s[gid].ngwords.filter(w => w !== word); await i.reply(`削除: ${word}`); }
            else if (sub === 'list') await i.reply(`NGリスト: ${s[gid].ngwords.join(', ') || 'なし'}`);
            saveData(SERVERS_FILE, s);
        }
        if (commandName === 'rp' && o.getSubcommand() === 'create') {
            const row = new ActionRowBuilder();
            for (let j = 1; j <= 10; j++) {
                const role = o.getRole(`role${j}`); const emoji = o.getString(`emoji${j}`);
                if (role && emoji) row.addComponents(new ButtonBuilder().setCustomId(`rp_${role.id}`).setLabel(`${emoji} ${role.name}`).setStyle(ButtonStyle.Primary));
            }
            await i.reply({ embeds: [new EmbedBuilder().setTitle(o.getString('title')).setDescription(o.getString('description'))], components: [row] });
        }
        if (commandName === 'rp' && o.getSubcommand() === 'delete') {
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rp_panel_delete').setLabel('このパネルを削除').setStyle(ButtonStyle.Danger));
            await i.reply({ content: '削除ボタン', components: [row], ephemeral: true });
        }
        if (commandName === 'welcome') { s[gid].welcome = { channel: o.getChannel('channel').id, message: o.getString('message') }; saveData(SERVERS_FILE, s); await i.reply('入室通知を設定しました。'); }
        if (commandName === 'bye') { s[gid].bye = { channel: o.getChannel('channel').id, message: o.getString('message') }; saveData(SERVERS_FILE, s); await i.reply('退室通知を設定しました。'); }
        if (commandName === 'ticket') {
            const mid = o.getRole('mention-role').id;
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_open_${mid}`).setLabel(o.getString('button')).setStyle(ButtonStyle.Primary));
            await i.reply({ embeds: [new EmbedBuilder().setTitle(o.getString('title')).setDescription(o.getString('description'))], components: [row] });
        }
        if (commandName === 'gset') { s[gid].gChatChannel = o.getChannel('channel').id; saveData(SERVERS_FILE, s); await i.reply('グローバルチャット設定完了。'); }
        if (commandName === 'gdel') { delete s[gid].gChatChannel; saveData(SERVERS_FILE, s); await i.reply('グローバルチャット解除。'); }
        if (commandName === 'omikuji') await i.reply(`運勢：**${['大吉','中吉','小吉','吉','末吉','凶','大凶'][Math.floor(Math.random()*7)]}**`);
        
        if (commandName === 'kaso') {
            await i.deferReply();
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            const guild = i.guild;
            let totalCount = 0;
            const userStats = new Collection();
            const channelStats = [];
            const textChannels = guild.channels.cache.filter(c => c.isTextBased());

            for (const [id, channel] of textChannels) {
                try {
                    const messages = await channel.messages.fetch({ limit: 100 });
                    const recent = messages.filter(m => m.createdTimestamp > oneHourAgo && !m.author.bot);
                    if (recent.size > 0) {
                        totalCount += recent.size;
                        channelStats.push({ name: channel.name, count: recent.size });
                        recent.forEach(m => {
                            const current = userStats.get(m.author.id) || { name: m.author.username, count: 0 };
                            userStats.set(m.author.id, { name: current.name, count: current.count + 1 });
                        });
                    }
                } catch (err) { continue; }
            }

            const sortedUsers = [...userStats.values()].sort((a, b) => b.count - a.count).slice(0, 3);
            const sortedChannels = channelStats.sort((a, b) => b.count - a.count).slice(0, 3);

            let conclusion = "🧊 **極寒（過疎）**";
            let color = 0x3498db;
            if (totalCount >= 100) { conclusion = "🔥 **激熱（超活発）**"; color = 0xff4500; }
            else if (totalCount >= 30) { conclusion = "✅ **良好（活発）**"; color = 0x2ecc71; }
            else if (totalCount >= 5) { conclusion = "⚠️ **微妙（静か）**"; color = 0xf1c40f; }

            const embed = new EmbedBuilder()
                .setTitle(`📊 過去1時間のサーバー稼働調査`)
                .setColor(color)
                .addFields(
                    { name: '📈 総メッセージ数', value: `**${totalCount}** 件`, inline: false },
                    { name: '🧐 判定結果', value: conclusion, inline: false },
                    { name: '👤 活発なユーザー TOP3', value: sortedUsers.map((u, i) => `${i+1}. ${u.name} (${u.count}回)`).join('\n') || 'データなし', inline: true },
                    { name: '📺 活発なチャンネル TOP3', value: sortedChannels.map((c, i) => `${i+1}. #${c.name} (${c.count}回)`).join('\n') || 'データなし', inline: true }
                )
                .setFooter({ text: '直近60分間 / Bot除外' }).setTimestamp();
            await i.editReply({ embeds: [embed] });
        }
    }
    if (i.isButton()) {
        // メニュー切り替えロジック
        if (i.customId === 'set_back_main') {
            await i.update({ embeds: [new EmbedBuilder().setTitle('⚙️ サーバー管理パネル').setDescription('下のボタンから各項目の設定を確認・変更できます。').setColor(0x5865F2)], components: [createMainSetRow()] });
        }
        if (i.customId === 'set_menu_log') {
            await i.update({ content: '🔔 **ログ通知項目の設定**', embeds: [], components: [createLogConfigRow(s[gid].logConfig)] });
        }
        if (i.customId === 'set_menu_msg') {
            const wStatus = s[gid].welcome ? `✅ 有効 (<#${s[gid].welcome.channel}>)` : '❌ 未設定';
            const bStatus = s[gid].bye ? `✅ 有効 (<#${s[gid].bye.channel}>)` : '❌ 未設定';
            await i.update({ content: `👋 **入退室通知状況**\n入室: ${wStatus}\n退室: ${bStatus}\n\n※変更は /welcome または /bye コマンドを使用してください。`, embeds: [], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }
        if (i.customId === 'set_menu_ng') {
            const list = s[gid].ngwords.join(', ') || 'なし';
            await i.update({ content: `🚫 **現在のNGワードリスト**\n${list}\n\n※追加・削除は /ngword コ manuallyを使用してください。`, embeds: [], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('set_back_main').setLabel('戻る').setStyle(ButtonStyle.Secondary))] });
        }
        if (i.customId === 'set_menu_lock') {
            s[gid].locked = !s[gid].locked;
            saveData(SERVERS_FILE, s);
            await i.update({ content: `🔒 **チャットロック状態:** ${s[gid].locked ? '🔴 ロック中' : '🟢 通常'}`, embeds: [], components: [createMainSetRow()] });
        }

        // 既存のログ切り替え
        if (i.customId.startsWith('log_toggle_')) {
            const key = i.customId.replace('log_toggle_', '');
            s[gid].logConfig[key] = !s[gid].logConfig[key];
            saveData(SERVERS_FILE, s); await i.update({ components: [createLogConfigRow(s[gid].logConfig)] });
        }
        if (i.customId === 'rp_panel_delete') await i.message.delete();
        if (i.customId.startsWith('rp_')) {
            const rid = i.customId.split('_')[1];
            try {
                if (i.member.roles.cache.has(rid)) { await i.member.roles.remove(rid); await i.reply({ content: '外しました。', ephemeral: true }); }
                else { await i.member.roles.add(rid); await i.reply({ content: '付与しました。', ephemeral: true }); }
            } catch (e) { await i.reply({ content: '❌ エラー', ephemeral: true }); }
        }
        if (i.customId.startsWith('ticket_open_')) {
            const mid = i.customId.split('_')[2];
            const ch = await i.guild.channels.create({ 
                name: `ticket-${i.user.username}`, type: ChannelType.GuildText, 
                permissionOverwrites: [
                    { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, 
                    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, 
                    { id: mid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ] 
            });
            await ch.send({ content: `<@&${mid}> <@${i.user.id}> さんが開きました。`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('閉じる').setStyle(ButtonStyle.Danger))] });
            await i.reply({ content: `作成: ${ch}`, ephemeral: true });
        }
        if (i.customId === 'ticket_close') await i.channel.delete();
    }
});

client.on(Events.MessageUpdate, async (o, n) => {
    const s = loadData(SERVERS_FILE); if (!s[o.guildId]?.logConfig?.edit || (o.author && o.author.bot) || o.content === n.content) return;
    await sendLog(o.guild, new EmbedBuilder().setTitle('📝 編集').setColor(0xFFA500).addFields({ name: 'ユーザー', value: o.author?.tag || '不明' }, { name: '元', value: o.content || 'なし' }, { name: '新', value: n.content || 'なし' }));
});

client.on(Events.MessageDelete, async (m) => {
    const s = loadData(SERVERS_FILE); if (!s[m.guildId]?.logConfig?.delete || (m.author && m.author.bot)) return;
    await sendLog(m.guild, new EmbedBuilder().setTitle('🗑️ 削除').setColor(0xFF0000).addFields({ name: 'ユーザー', value: m.author?.tag || '不明' }, { name: '内容', value: m.content || '画像等' }));
});

client.on(Events.GuildMemberAdd, async (m) => {
    const s = loadData(SERVERS_FILE); const c = s[m.guild.id];
    if (c?.logConfig?.join) await sendLog(m.guild, new EmbedBuilder().setTitle('📥 参加').setColor(0x00FFFF).setDescription(`${m.user.tag} 参加`));
    if (c?.welcome) { const ch = m.guild.channels.cache.get(c.welcome.channel); if (ch) ch.send(replacePlaceholders(c.welcome.message, m)); }
});

client.on(Events.GuildMemberRemove, async (m) => {
    const s = loadData(SERVERS_FILE); const c = s[m.guild.id];
    if (c?.logConfig?.leave) await sendLog(m.guild, new EmbedBuilder().setTitle('📤 退出').setColor(0xFF00FF).setDescription(`${m.user.tag} 退出`));
    if (c?.bye) { const ch = m.guild.channels.cache.get(c.bye.channel); if (ch) ch.send(replacePlaceholders(c.bye.message, m)); }
});

client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.guild) return;
    const s = loadData(SERVERS_FILE);
    const gid = msg.guildId;
    if (OWNER_IDS.includes(msg.author.id) && msg.content.startsWith('!')) {
        return await handleAdminCommands(msg, client, OWNER_IDS, loadData, saveData, USERS_FILE);
    }
    if (!msg.member.permissions.has(PermissionFlagsBits.Administrator)) {
        if (s[gid]?.locked || s[gid]?.ngwords?.some(w => msg.content.includes(w))) {
            return msg.delete().catch(() => {});
        }
    }
    if (s[gid]?.gChatChannel === msg.channelId) {
        const emb = new EmbedBuilder().setAuthor({ name: `${msg.author.tag} (${msg.guild.name})`, iconURL: msg.author.displayAvatarURL() }).setDescription(msg.content || '画像').setColor(0x00FF00);
        if (msg.attachments.size > 0 && msg.attachments.first().contentType?.startsWith('image/')) emb.setImage(msg.attachments.first().url);
        for (const tid in s) {
            const cid = s[tid].gChatChannel;
            if (cid && cid !== msg.channelId) {
                const ch = client.channels.cache.get(cid);
                if (ch) await ch.send({ embeds: [emb], allowedMentions: { parse: [] } }).catch(() => {});
            }
        }
    }
});

client.login(TOKEN);
