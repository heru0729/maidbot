const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rp')
        .setDescription('セルフ役職付与パネルを管理')
        .addSubcommand(sub => sub
            .setName('create')
            .setDescription('セルフ役職パネルを作成')
            .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('説明').setRequired(true))
            .addRoleOption(o => o.setName('role1').setDescription('役職1'))
            .addStringOption(o => o.setName('emoji1').setDescription('絵文字1'))
            .addRoleOption(o => o.setName('role2').setDescription('役職2'))
            .addStringOption(o => o.setName('emoji2').setDescription('絵文字2'))
            .addRoleOption(o => o.setName('role3').setDescription('役職3'))
            .addStringOption(o => o.setName('emoji3').setDescription('絵文字3'))
            .addRoleOption(o => o.setName('role4').setDescription('役職4'))
            .addStringOption(o => o.setName('emoji4').setDescription('絵文字4'))
            .addRoleOption(o => o.setName('role5').setDescription('役職5'))
            .addStringOption(o => o.setName('emoji5').setDescription('絵文字5'))
            .addRoleOption(o => o.setName('role6').setDescription('役職6'))
            .addStringOption(o => o.setName('emoji6').setDescription('絵文字6'))
            .addRoleOption(o => o.setName('role7').setDescription('役職7'))
            .addStringOption(o => o.setName('emoji7').setDescription('絵文字7'))
            .addRoleOption(o => o.setName('role8').setDescription('役職8'))
            .addStringOption(o => o.setName('emoji8').setDescription('絵文字8'))
            .addRoleOption(o => o.setName('role9').setDescription('役職9'))
            .addStringOption(o => o.setName('emoji9').setDescription('絵文字9'))
            .addRoleOption(o => o.setName('role10').setDescription('役職10'))
            .addStringOption(o => o.setName('emoji10').setDescription('絵文字10'))
        )
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('パネルから役職を削除するボタンを追加')
        ),
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'create') {
            const embed = new EmbedBuilder()
                .setTitle(interaction.options.getString('title'))
                .setDescription(interaction.options.getString('description'))
                .setColor(0x34495e);

            const row = new ActionRowBuilder();
            let count = 0;
            for (let i = 1; i <= 10; i++) {
                const role = interaction.options.getRole(`role${i}`);
                const emoji = interaction.options.getString(`emoji${i}`);
                if (role) {
                    row.addComponents(new ButtonBuilder()
                        .setCustomId(`rp_${role.id}`)
                        .setLabel(role.name)
                        .setEmoji(emoji || '🏷️')
                        .setStyle(ButtonStyle.Secondary)
                    );
                    count++;
                }
            }

            if (count === 0) {
                return interaction.reply({ content: '最低1つの役職を指定してください。', ephemeral: true });
            }

            await interaction.reply({ embeds: [embed], components: [row] });
        }

        else if (sub === 'delete') {
            await interaction.reply({ content: 'パネルから役職を削除するボタンを追加しました（後続処理はボタンイベントで実装）。', ephemeral: true });
        }
    }
};
