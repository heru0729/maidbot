const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gset')
        .setDescription('グローバルチャット送信先チャンネルを設定します')
        .addChannelOption(o => o.setName('channel').setDescription('送信先チャンネル').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const servers = loadData(SERVERS_FILE);
        const guildId = interaction.guildId;
        const channel = interaction.options.getChannel('channel');
        if (!servers[guildId]) servers[guildId] = {};
        servers[guildId].gChatChannel = channel.id;
        saveData(SERVERS_FILE, servers);

        const embed = new EmbedBuilder()
            .setTitle('🌐 グローバルチャット設定')
            .setDescription(`送信先を <#${channel.id}> に設定しました。`)
            .setColor(0x00ff00);

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

module.exports.deleteCommand = {
    data: new SlashCommandBuilder()
        .setName('gdel')
        .setDescription('グローバルチャットの設定を解除します')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const servers = loadData(SERVERS_FILE);
        const guildId = interaction.guildId;
        if (servers[guildId]?.gChatChannel) delete servers[guildId].gChatChannel;
        saveData(SERVERS_FILE, servers);

        const embed = new EmbedBuilder()
            .setTitle('🌐 グローバルチャット設定解除')
            .setDescription('設定を解除しました。')
            .setColor(0xff0000);

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
