const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const SERVERS_FILE = path.join(__dirname, '..', 'data', 'servers.json');

function loadData(f) {
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}

function saveData(f, d) {
    fs.writeFileSync(f, JSON.stringify(d, null, 4));
}

function createMainSetRows(s) {
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('set_menu_log').setLabel('ログ詳細設定').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('set_menu_kaso').setLabel('調査除外設定').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('set_lv_toggle').setLabel(`レベル機能: ${s.leveling !== false ? 'ON' : 'OFF'}`).setStyle(s.leveling !== false ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('set_menu_lock').setLabel('一括ロック切替').setStyle(ButtonStyle.Danger)
        );
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('set_menu_welcome').setLabel('入室通知設定').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('set_menu_bye').setLabel('退室通知設定').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('set_menu_ngword').setLabel('NGワード管理').setStyle(ButtonStyle.Danger)
        );
    return [row1, row2];
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set')
        .setDescription('サーバー管理用設定パネルを開きます')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const servers = loadData(SERVERS_FILE);
        const gid = interaction.guildId;

        if (!servers[gid]) {
            servers[gid] = { 
                logConfig: { edit: true, delete: true, join: true, leave: true },
                ngwords: [],
                locked: false,
                kasoIgnoreChannels: [],
                leveling: true,
                welcome: null,
                bye: null
            };
            saveData(SERVERS_FILE, servers);
        }

        await interaction.reply({
            content: '⚙️ **サーバー管理設定パネル**\n下のボタンから各機能の設定を行ってください。',
            components: createMainSetRows(servers[gid]),
            ephemeral: true
        });
    },

    async handleButton(interaction) {
        const servers = loadData(SERVERS_FILE);
        const gid = interaction.guildId;
        if (!servers[gid]) return;

        const s = servers[gid];
        const cid = interaction.customId;

        // --- メインボタン ---
        if (cid === 'set_lv_toggle') {
            s.leveling = !s.leveling;
            saveData(SERVERS_FILE, servers);
            await interaction.update({ components: createMainSetRows(s) });
        }

        if (cid === 'set_menu_log') {
            await interaction.update({ components: [createLogConfigRow(s.logConfig)] });
        }

        if (cid === 'set_back_main') {
            await interaction.update({ components: createMainSetRows(s) });
        }

        // チャットロック切替
        if (cid === 'set_menu_lock') {
            s.locked = !s.locked;
            saveData(SERVERS_FILE, servers);
            const everyone = interaction.guild.roles.everyone;
            await interaction.guild.channels.cache.forEach(ch => {
                ch.permissionOverwrites.edit(everyone, { SendMessages: s.locked });
            });
            await interaction.reply({ content: `チャンネルを ${s.locked ? 'ロック' : '解除'} しました。`, ephemeral: true });
        }

        // 入室通知設定
        if (cid === 'set_menu_welcome') {
            await interaction.reply({ content: '入室通知メッセージを送信してください（例: {user} が参加しました）', ephemeral: true });
            const filter = m => m.author.id === interaction.user.id;
            const collector = interaction.channel.createMessageCollector({ filter, max: 1, time: 60000 });
            collector.on('collect', async m => {
                s.welcome = { message: m.content };
                saveData(SERVERS_FILE, servers);
                await interaction.followUp({ content: '入室通知を設定しました。', ephemeral: true });
            });
        }

        // 退室通知設定
        if (cid === 'set_menu_bye') {
            await interaction.reply({ content: '退室通知メッセージを送信してください（例: {user} が退出しました）', ephemeral: true });
            const filter = m => m.author.id === interaction.user.id;
            const collector = interaction.channel.createMessageCollector({ filter, max: 1, time: 60000 });
            collector.on('collect', async m => {
                s.bye = { message: m.content };
                saveData(SERVERS_FILE, servers);
                await interaction.followUp({ content: '退室通知を設定しました。', ephemeral: true });
            });
        }

        // NGワード管理
        if (cid === 'set_menu_ngword') {
            const embed = new EmbedBuilder()
                .setTitle('NGワード管理')
                .setDescription('以下の形式で操作できます:\n`追加: 単語`\n`削除: 単語`\n`一覧`\n例: `追加: だめな言葉`')
                .setColor(0xe74c3c);
            await interaction.reply({ embeds: [embed], ephemeral: true });

            const filter = m => m.author.id === interaction.user.id;
            const collector = interaction.channel.createMessageCollector({ filter, time: 60000 });
            collector.on('collect', async m => {
                const msg = m.content.trim();
                if (msg.startsWith('追加:')) {
                    const word = msg.slice(3).trim();
                    if (!s.ngwords.includes(word)) s.ngwords.push(word);
                    await interaction.followUp({ content: `「${word}」をNGワードに追加しました。`, ephemeral: true });
                } else if (msg.startsWith('削除:')) {
                    const word = msg.slice(3).trim();
                    s.ngwords = s.ngwords.filter(w => w !== word);
                    await interaction.followUp({ content: `「${word}」をNGワードから削除しました。`, ephemeral: true });
                } else if (msg === '一覧') {
                    await interaction.followUp({ content: `現在のNGワード: ${s.ngwords.join(', ') || 'なし'}`, ephemeral: true });
                }
                saveData(SERVERS_FILE, servers);
            });
        }

        // --- ログ設定トグル ---
        if (cid.startsWith('log_toggle_')) {
            const key = cid.replace('log_toggle_', '');
            s.logConfig[key] = !s.logConfig[key];
            saveData(SERVERS_FILE, servers);
            await interaction.update({ components: [createLogConfigRow(s.logConfig)] });
        }
    }
};
