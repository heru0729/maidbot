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
                { name: '`/authset`', value: '認証パネルを作成し、完了時にロールを付与します。' },
                { name: '`/log`', value: 'ログ送信先を設定します。' },
                { name: '`/welcome`', value: '参加通知メッセージを設定します。' },
                { name: '`/bye`', value: '退出通知メッセージを設定します。' },
                { name: '`/gset`', value: '指定したチャンネルをグローバルチャットとして同期します。' },
                { name: '`/gdel`', value: 'グローバルチャットを解除します。' },
                { name: '--- パネル作成 ---', value: '\u200B' },
                { name: '`/ticket`', value: 'メンションロール付きのチケットパネルを作成します。' },
                { name: '`/rp create`', value: '役職選択パネルを作成します。' },
                { name: '`/rp delete`', value: 'パネルを削除します。' }
            );
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} が起動しました。`);

    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('利用可能なコマンドをページ形式で表示します'),
        new SlashCommandBuilder().setName('authset').setDescription('認証パネルを作成')
            .addStringOption(opt => opt.setName('title').setDescription('パネルのタイトル').setRequired(true))
            .addStringOption(opt => opt.setName('description').setDescription('パネルの説明文').setRequired(true))
            .addStringOption(opt => opt.setName('button').setDescription('ボタンの文字').setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('付与するロール').setRequired(true)),
        new SlashCommandBuilder().setName('welcome').setDescription('入室通知の設定').addStringOption(opt => opt.setName('message').setDescription('{user}{server}{members}が使用可能').setRequired(true)),
        new SlashCommandBuilder().setName('bye').setDescription('退室通知の設定').addStringOption(opt => opt.setName('message').setDescription('{user}{server}{members}が使用可能').setRequired(true)),
        new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成')
            .addStringOption(opt => opt.setName('title').setDescription('タイトル').setRequired(true))
            .addStringOption(opt => opt.setName('description').setDescription('説明').setRequired(true))
            .addStringOption(opt => opt.setName('button').setDescription('ボタン名').setRequired(true))
            .addRoleOption(opt => opt.setName('mention-role').setDescription('通知する管理者ロール').setRequired(true)),
        new SlashCommandBuilder().setName('rp').setDescription('リアクションロール設定')
            .addSubcommand(sub => sub.setName('create').setDescription('パネル作成').addStringOption(opt => opt.setName('setup').setDescription('絵文字,役職ID(最大20組) 例: 🍎,12345 🍌,67890').setRequired(true)))
            .addSubcommand(sub => sub.setName('delete').setDescription('パネルに返信して実行')),
        new SlashCommandBuilder().setName('log').setDescription('ログ送信先を設定').addChannelOption(opt => opt.setName('channel').setDescription('ログチャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gset').setDescription('グローバルチャットを開始').addChannelOption(opt => opt.setName('channel').setDescription('使用するチャンネル').setRequired(true)),
        new SlashCommandBuilder().setName('gdel').setDescription('グローバルチャチャットを解除'),
        new SlashCommandBuilder().setName('omikuji').setDescription('運勢を表示')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('スラッシュコマンドを登録しました。');
    } catch (error) {
        console.error(error);
    }
});

// ログ管理ロジック (構造維持)
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (oldMsg.partial || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    const embed = new EmbedBuilder().setTitle('📝 メッセージ編集').setColor(0xFFA500)
        .addFields({ name: 'ユーザー', value: `${oldMsg.author.tag}` }, { name: '元', value: oldMsg.content || 'なし' }, { name: '新', value: newMsg.content || 'なし' });
    await sendLog(oldMsg.guild, embed);
});

client.on(Events.MessageDelete, async (message) => {
    if (message.partial || message.author?.bot) return;
    const embed = new EmbedBuilder().setTitle('🗑️ メッセージ削除').setColor(0xFF0000)
        .addFields({ name: 'ユーザー', value: `${message.author.tag}` }, { name: '内容', value: message.content || 'なし' });
    await sendLog(message.guild, embed);
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

        if (commandName === 'authset') {
            const role = options.getRole('role');
            servers[guildId].authRole = role.id;
            saveData(SERVERS_FILE, servers);
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x43B581);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('auth_button').setLabel(options.getString('button')).setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'gset') {
            const channel = options.getChannel('channel');
            servers[guildId].gChatChannel = channel.id;
            saveData(SERVERS_FILE, servers);
            await interaction.reply(`グローバルチャットを <#${channel.id}> に設定しました。`);
        }

        if (commandName === 'gdel') { delete servers[guildId].gChatChannel; saveData(SERVERS_FILE, servers); await interaction.reply('解除完了'); }
        if (commandName === 'log') { servers[guildId].logChannel = options.getChannel('channel').id; saveData(SERVERS_FILE, servers); await interaction.reply('ログ設定完了'); }
        if (commandName === 'welcome') { servers[guildId].welcomeMessage = options.getString('message'); saveData(SERVERS_FILE, servers); await interaction.reply('設定完了'); }
        if (commandName === 'bye') { servers[guildId].byeMessage = options.getString('message'); saveData(SERVERS_FILE, servers); await interaction.reply('設定完了'); }
        if (commandName === 'omikuji') { await interaction.reply(`運勢は **${['大吉','中吉','小吉','吉','末吉','凶','大凶'][Math.floor(Math.random()*7)]}** です！`); }
        if (commandName === 'ticket') {
            const embed = new EmbedBuilder().setTitle(options.getString('title')).setDescription(options.getString('description')).setColor(0x5865F2);
            const mentionRoleId = options.getRole('mention-role').id;
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_open_${mentionRoleId}`).setLabel(options.getString('button')).setStyle(ButtonStyle.Primary));
            await interaction.reply({ embeds: [embed], components: [row] });
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
        if (interaction.customId === 'help_prev') await interaction.update({ embeds: [createHelpEmbed(1)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary))] });
        if (interaction.customId === 'help_next') await interaction.update({ embeds: [createHelpEmbed(2)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_prev').setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(false), new ButtonBuilder().setCustomId('help_next').setLabel('次へ').setStyle(ButtonStyle.Primary).setDisabled(true))] });

        if (interaction.customId === 'auth_button') {
            const rId = servers[guildId]?.authRole;
            if (rId) {
                await interaction.member.roles.add(rId).catch(() => {});
                await interaction.reply({ content: '認証完了', ephemeral: true });
                await sendLog(interaction.guild, new EmbedBuilder().setTitle('✅ 認証完了').setDescription(`${interaction.user.tag} にロールを付与しました。`).setColor(0x43B581));
            }
        }

        if (interaction.customId.startsWith('ticket_open_')) {
            const mentionRoleId = interaction.customId.split('_')[2];
            try {
                const ticketChannel = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: mentionRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ],
                });
                const embed = new EmbedBuilder().setTitle('チケット').setDescription(`お問い合わせ内容をご記入ください。`).setColor(0x5865F2);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger));
                await ticketChannel.send({ content: `<@&${mentionRoleId}> ${interaction.user}さん！ チケット作成ありがとうございます！\n管理者が来るまでお待ち下さい...`, embeds: [embed], components: [row] });
                await interaction.reply({ content: `チケットを作成しました: ${ticketChannel}`, ephemeral: true });
            } catch (e) { await interaction.reply({ content: 'エラー', ephemeral: true }); }
        }
        if (interaction.customId === 'ticket_close') await interaction.channel.delete();
        if (interaction.customId.startsWith('rp_')) {
            const rId = interaction.customId.split('_')[1];
            if (interaction.member.roles.cache.has(rId)) { await interaction.member.roles.remove(rId); await interaction.reply({ content: '削除', ephemeral: true }); }
            else { await interaction.member.roles.add(rId); await interaction.reply({ content: '追加', ephemeral: true }); }
        }
    }
});

// --- メッセージイベント (グローバルチャット & オーナーコマンド) ---
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // --- グローバルチャット処理 ---
    const servers = loadData(SERVERS_FILE);
    const guildId = message.guildId;
    if (servers[guildId]?.gChatChannel === message.channelId) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${message.author.tag} (${message.guild.name})`, iconURL: message.author.displayAvatarURL() })
            .setDescription(message.content || '（本文なし）')
            .setColor(0x00FF00)
            .setTimestamp();

        // 画像があればEmbedに追加
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment.contentType?.startsWith('image/')) embed.setImage(attachment.url);
        }

        // 全サーバーのグローバルチャットチャンネルに転送
        for (const targetGuildId in servers) {
            const channelId = servers[targetGuildId].gChatChannel;
            if (!channelId) continue;

            const channel = client.channels.cache.get(channelId);
            if (channel) {
                // 自分が送信したチャンネルには送らない（無限ループ防止）
                if (channel.id === message.channelId) continue;
                await channel.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }

    // --- オーナー専用コマンド (!call, !userlist, !serverlist) ---
    if (message.author.id !== OWNER_ID || !message.content.startsWith('!')) return;
    if (message.content === '!userlist') await message.reply(`トークン数: ${Object.keys(loadData(USERS_FILE)).length}`);
    if (message.content === '!serverlist') await message.reply(`導入サーバー:\n${client.guilds.cache.map(g => g.name).join('\n') || 'なし'}`);
    if (message.content.startsWith('!call')) {
        const users = loadData(USERS_FILE);
        for (const id in users) try { await message.guild.members.add(id, { accessToken: users[id].accessToken }); } catch (e) {}
        await message.reply('招待処理完了');
    }
});

client.login(TOKEN);
