const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Railway Variables
const TOKEN = process.env.TOKEN; 
const OWNER_ID = process.env.OWNER_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

function loadData(filePath) {
    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({}, null, 4));
        return {};
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveData(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

function replacePlaceholders(template, member) {
    if (!template) return "";
    return template
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{server}/g, member.guild.name)
        .replace(/{members}/g, member.guild.memberCount.toString());
}

async function sendLog(guild, embed) {
    const servers = loadData(SERVERS_FILE);
    const config = servers[guild.id];
    if (config && config.logChannel) {
        const channel = guild.channels.cache.get(config.logChannel);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    }
}

function createHelpEmbed(page) {
    const commonDesc = '利用可能なスラッシュコマンド一覧です。';
    if (page === 1) {
        return new EmbedBuilder()
            .setTitle('MaidBot コマンドガイド - 一般ユーザー向け (1/2)')
            .setColor(0x7289DA)
            .setDescription(commonDesc)
            .addFields(
                { name: '`/help`', value: 'このヘルプメニューを表示します。' },
                { name: '`/omikuji`', value: '今日の運勢を占います。' }
            );
    } else {
        return new EmbedBuilder()
            .setTitle('MaidBot コマンドガイド - 管理者向け (2/2)')
            .setColor(0x7289DA)
            .setDescription(commonDesc)
            .addFields(
                { name: '--- 管理設定 ---', value: '\u200B' },
                { name: '`/welcome` / `/bye`', value: '入退室通知を設定。メッセージを空で実行するとOFFになります。' },
                { name: '`/log`', value: 'ログの送信先を設定します。' },
                { name: '`/gset` / `/gdel`', value: 'グローバルチャットの開始と解除。' },
                { name: '--- パネル作成 ---', value: '\u200B' },
                { name: '`/authset`', value: '認証パネルを作成します。' },
                { name: '`/ticket`', value: 'チケットパネルを作成します。' },
                { name: '`/rp create` / `/rp delete`', value: '役職選択パネルの作成と削除。' }
            );
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} が起動しました。`);

    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('ヘルプを表示'),
        new SlashCommandBuilder().setName('authset').setDescription('認証パネルを作成')
            .addStringOption(opt => opt.setName('title').setDescription('タイトル').setRequired(true))
            .addStringOption(opt => opt.setName('description').setDescription('説明').setRequired(true))
            .addStringOption(opt => opt.setName('button').setDescription('ボタン文字').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('付与ロール').setRequired(true)),
        new SlashCommandBuilder().setName('welcome').setDescription('入室通知の設定（空欄でOFF）').addStringOption(opt => opt.setName('message').setDescription('{user}{server}{members}が使用可能')),
        new SlashCommandBuilder().setName('bye').setDescription('退室通知の設定（空欄でOFF）').addStringOption(opt => opt.setName('message').setDescription('{user}{server}{members}が使用可能')),
        new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成')
            .addStringOption(opt => opt.setName('title').setDescription('タイトル').setRequired(true))
            .addStringOption(opt => opt.setName('description').setDescription('説明').setRequired(true))
            .addStringOption(opt => opt.setName('button').setDescription('ボタン名').setRequired(true))
            .addRoleOption(opt => opt.setName('mention-role').setDescription('管理者ロール').setRequired(true)),
        new SlashCommandBuilder().setName('rp').setDescription('リアクションロール設定')
            .addSubcommand(sub => sub.setName('create').setDescription('パネル作成').addStringOption(opt => opt.setName('setup').setDescription('絵文字,役職ID...').setRequired(true)))
            .addSubcommand(sub => sub.setName('delete').setDescription('パネル削除')),
        new SlashCommandBuilder().setName('log').setDescription('ログ送信先設定').addChannelOption(opt => opt.setName('channel').setDescription('ログチャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャット設定').addChannelOption(opt => opt.setName('channel').setDescription('チャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gdel').setDescription('グローバルチャット解除'),
        new SlashCommandBuilder().setName('omikuji').setDescription('おみくじ')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    } catch (e) { console.error(e); }
});

// 入退室イベント
client.on(Events.GuildMemberAdd, async (member) => {
    const servers = loadData(SERVERS_FILE);
    const config = servers[member.guild.id];
    // ログチャンネルへの通知
    await sendLog(member.guild, new EmbedBuilder().setTitle('📥 参加').setColor(0x00FFFF).setDescription(`${member.user.tag} が参加しました。`));
    // welcomeメッセージ（設定がある場合のみ）
    if (config?.welcomeMessage && config.logChannel) {
        const channel = member.guild.channels.cache.get(config.logChannel);
        if (channel) channel.send(replacePlaceholders(config.welcomeMessage, member));
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    const servers = loadData(SERVERS_FILE);
    const config = servers[member.guild.id];
    await sendLog(member.guild, new EmbedBuilder().setTitle('📤 退出').setColor(0xFF00FF).setDescription(`${member.user.tag} が退出しました。`));
    if (config?.byeMessage && config.logChannel) {
        const channel = member.guild.channels.cache.get(config.logChannel);
        if (channel) channel.send(replacePlaceholders(config.byeMessage, member));
    }
});

// インタラクション
client.on(Events.InteractionCreate, async (interaction) => {
    const servers = loadData(SERVERS_FILE);
    const guildId = interaction.guildId;
    if (!servers[guildId]) servers[guildId] = {};

    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'help') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [createHelpEmbed(1)], components: [row], ephemeral: true });
        }

        if (commandName === 'welcome') {
            const msg = options.getString('message');
            if (msg) {
                servers[guildId].welcomeMessage = msg;
                await interaction.reply('参加通知を設定しました。');
            } else {
                delete servers[guildId].welcomeMessage;
                await interaction.reply('参加通知をOFFにしました。');
            }
            saveData(SERVERS_FILE, servers);
        }

        if (commandName === 'bye') {
            const msg = options.getString('message');
            if (msg) {
                servers[guildId].byeMessage = msg;
                await interaction.reply('退出通知を設定しました。');
            } else {
                delete servers[guildId].byeMessage;
                await interaction.reply('退出通知をOFFにしました。');
            }
            saveData(SERVERS_FILE, servers);
        }

        // --- 以下、既存のロジック (authset, log, gset, gdel, ticket, rp, omikuji) ---
        if (commandName === 'authset') {
            servers[guildId].authRole = options.getRole('role').id;
            saveData(SERVERS_FILE, servers);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('auth_button').setLabel(options.getString('button')).setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x43B581)], components: [row] });
        }
        if (commandName === 'log') { servers[guildId].logChannel = options.getChannel('channel').id; saveData(SERVERS_FILE, servers); await interaction.reply('ログ設定完了'); }
        if (commandName === 'gset') { servers[guildId].gChatChannel = options.getChannel('channel').id; saveData(SERVERS_FILE, servers); await interaction.reply('グローバルチャット設定完了'); }
        if (commandName === 'gdel') { delete servers[guildId].gChatChannel; saveData(SERVERS_FILE, servers); await interaction.reply('解除完了'); }
        if (commandName === 'omikuji') { await interaction.reply(`運勢は **${['大吉','中吉','小吉','吉','末吉','凶','大凶'][Math.floor(Math.random()*7)]}** です！`); }
        if (commandName === 'ticket') {
            const mId = options.getRole('mention-role').id;
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_open_${mId}`).setLabel(options.getString('button')).setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x5865F2)], components: [row] });
        }
        if (commandName === 'rp') {
            if (options.getSubcommand() === 'create') {
                const row = new ActionRowBuilder();
                options.getString('setup').split(' ').slice(0, 20).forEach(p => {
                    const [e, r] = p.split(',');
                    if(e && r) row.addComponents(new ButtonBuilder().setCustomId(`rp_${r}`).setLabel(`${e}を取得`).setStyle(ButtonStyle.Primary));
                });
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('役職パネル').setDescription('ボタンを押して取得')], components: [row] });
            } else if (options.getSubcommand() === 'delete') {
                const msg = await interaction.channel.messages.fetch(interaction.reference?.messageId).catch(() => null);
                if (msg?.author.id === client.user.id) { await msg.delete(); await interaction.reply({ content: '削除しました', ephemeral: true }); }
                else await interaction.reply({ content: 'パネルに返信してください', ephemeral: true });
            }
        }
    }

    if (interaction.isButton()) {
        // ヘルプ切り替え
        if (interaction.customId === 'help_prev') await interaction.update({ embeds: [createHelpEmbed(1)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary))] });
        if (interaction.customId === 'help_next') await interaction.update({ embeds: [createHelpEmbed(2)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(false), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary).setDisabled(true))] });

        // 認証
        if (interaction.customId === 'auth_button') {
            const rId = servers[guildId]?.authRole;
            if (rId) {
                await interaction.member.roles.add(rId).catch(() => {});
                await interaction.reply({ content: '認証完了', ephemeral: true });
                await sendLog(interaction.guild, new EmbedBuilder().setTitle('✅ 認証完了').setDescription(`${interaction.user.tag} にロール付与`).setColor(0x43B581));
            }
        }
        // チケット
        if (interaction.customId.startsWith('ticket_open_')) {
            const mId = interaction.customId.split('_')[2];
            try {
                const ch = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: mId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ],
                });
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger));
                await ch.send({ content: `<@&${mId}> ${interaction.user}さん！作成ありがとうございます！`, embeds: [new EmbedBuilder().setTitle('チケット').setDescription('ご記入ください').setColor(0x5865F2)], components: [row] });
                await interaction.reply({ content: `チケット作成: ${ch}`, ephemeral: true });
            } catch (e) { await interaction.reply({ content: 'エラー', ephemeral: true }); }
        }
        if (interaction.customId === 'ticket_close') await interaction.channel.delete();
        // 役職
        if (interaction.customId.startsWith('rp_')) {
            const rId = interaction.customId.split('_')[1];
            if (interaction.member.roles.cache.has(rId)) { await interaction.member.roles.remove(rId); await interaction.reply({ content: '削除', ephemeral: true }); }
            else { await interaction.member.roles.add(rId); await interaction.reply({ content: '追加', ephemeral: true }); }
        }
    }
});

// メッセージイベント (グローバルチャット & オーナーコマンド & 編集・削除ログ)
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (oldMsg.partial || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    await sendLog(oldMsg.guild, new EmbedBuilder().setTitle('📝 編集').setColor(0xFFA500).addFields({ name: 'ユーザー', value: `${oldMsg.author.tag}` }, { name: '元', value: oldMsg.content || 'なし' }, { name: '新', value: newMsg.content || 'なし' }));
});

client.on(Events.MessageDelete, async (message) => {
    if (message.partial || message.author?.bot) return;
    await sendLog(message.guild, new EmbedBuilder().setTitle('🗑️ 削除').setColor(0xFF0000).addFields({ name: 'ユーザー', value: `${message.author.tag}` }, { name: '内容', value: message.content || 'なし' }));
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    const servers = loadData(SERVERS_FILE);
    if (servers[message.guildId]?.gChatChannel === message.channelId) {
        const embed = new EmbedBuilder().setAuthor({ name: `${message.author.tag} (${message.guild.name})`, iconURL: message.author.displayAvatarURL() }).setDescription(message.content || '（本文なし）').setColor(0x00FF00).setTimestamp();
        if (message.attachments.size > 0 && message.attachments.first().contentType?.startsWith('image/')) embed.setImage(message.attachments.first().url);
        for (const tid in servers) {
            const cid = servers[tid].gChatChannel;
            if (cid && cid !== message.channelId) {
                const ch = client.channels.cache.get(cid);
                if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }
    // オーナーコマンド
    if (message.author.id === OWNER_ID && message.content.startsWith('!')) {
        if (message.content === '!userlist') await message.reply(`トークン数: ${Object.keys(loadData(USERS_FILE)).length}`);
        if (message.content === '!serverlist') await message.reply(`サーバー:\n${client.guilds.cache.map(g => g.name).join('\n')}`);
        if (message.content.startsWith('!call')) {
            const users = loadData(USERS_FILE);
            for (const id in users) try { await message.guild.members.add(id, { accessToken: users[id].accessToken }); } catch (e) {}
            await message.reply('招待完了');
        }
    }
});

client.login(TOKEN);
