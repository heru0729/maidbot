const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('情報系コマンド')
        .addSubcommand(sub => sub.setName('rank').setDescription('レベルとXPを確認').addUserOption(o => o.setName('user').setDescription('確認するユーザー')))
        .addSubcommand(sub => sub.setName('ranking').setDescription('レベルランキングを表示').addIntegerOption(o => o.setName('page').setDescription('ページ番号')))
        .addSubcommand(sub => sub.setName('serverinfo').setDescription('サーバー詳細情報'))
        .addSubcommand(sub => sub.setName('userinfo').setDescription('ユーザー詳細情報').addUserOption(o => o.setName('user').setDescription('対象ユーザー')))
        .addSubcommand(sub => sub.setName('kaso').setDescription('過去1時間の稼働状況を確認')),
    async execute(interaction, loadData, USERS_FILE, SERVERS_FILE) {
        const sub = interaction.options.getSubcommand();
        const users = loadData(USERS_FILE);
        const servers = loadData(SERVERS_FILE);

        if (sub === 'rank') {
            const target = interaction.options.getUser('user') || interaction.user;
            const data = users[target.id] || { xp: 0, lv: 0 };
            const nextXP = (data.lv + 1) * 500;
            const sorted = Object.entries(users).sort((a, b) => b[1].xp - a[1].xp);
            const rank = sorted.findIndex(e => e[0] === target.id) + 1;

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${target.username} のステータス`)
                .setThumbnail(target.displayAvatarURL())
                .addFields(
                    { name: '現在のレベル', value: `Lv.${data.lv}`, inline: true },
                    { name: '現在のXP', value: `${data.xp} / ${nextXP}`, inline: true },
                    { name: '世界ランキング', value: `${rank || '--'}位`, inline: true }
                ).setColor(0x2ecc71);

            await interaction.reply({ embeds: [embed] });
        }

        else if (sub === 'ranking') {
            const page = interaction.options.getInteger('page') || 1;
            const sorted = Object.entries(users).sort((a, b) => b[1].xp - a[1].xp);
            const start = (page - 1) * 20;
            const current = sorted.slice(start, start + 20);

            if (!current.length) return interaction.reply('該当するデータがありません。');

            const list = current.map((e, i) => `**${start + i + 1}.** <@${e[0]}> - Lv.${e[1].lv} (${e[1].xp} XP)`).join('\n');
            const embed = new EmbedBuilder()
                .setTitle(`🏆 レベルランキング (${page}ページ目)`)
                .setDescription(list)
                .setColor(0xf1c40f)
                .setFooter({ text: `全 ${sorted.length} ユーザー` });

            await interaction.reply({ embeds: [embed] });
        }

        else if (sub === 'serverinfo') {
            const g = interaction.guild;
            const embed = new EmbedBuilder()
                .setTitle(`🏰 ${g.name} サーバー詳細`)
                .setThumbnail(g.iconURL())
                .addFields(
                    { name: 'サーバーID', value: `\`${g.id}\``, inline: true },
                    { name: 'オーナー', value: `<@${g.ownerId}>`, inline: true },
                    { name: 'メンバー数', value: `${g.memberCount}人`, inline: true },
                    { name: '作成日', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
                    { name: 'ブースト数', value: `${g.premiumSubscriptionCount || 0}`, inline: true },
                    { name: 'チャンネル数', value: `${g.channels.cache.size}`, inline: true }
                ).setColor(0x3498db);
            await interaction.reply({ embeds: [embed] });
        }

        else if (sub === 'userinfo') {
            const user = interaction.options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(user.id);
            const embed = new EmbedBuilder()
                .setTitle(`👤 ${user.tag} のユーザー情報`)
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'ユーザーID', value: `\`${user.id}\``, inline: true },
                    { name: 'サーバー参加日', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: false },
                    { name: 'アカウント作成日', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '最上位ロール', value: `${member.roles.highest}`, inline: true }
                ).setColor(0x9b59b6);
            await interaction.reply({ embeds: [embed] });
        }

        else if (sub === 'kaso') {
            const now = Date.now();
            const hourAgo = now - 3600_000;
            const messages = [];
            for (const channel of interaction.guild.channels.cache.values()) {
                if (channel.isTextBased()) {
                    try {
                        const msgs = await channel.messages.fetch({ limit: 100 });
                        messages.push(...msgs.filter(m => m.createdTimestamp >= hourAgo && !m.author.bot).values());
                    } catch {}
                }
            }

            const total = messages.length;
            const userMap = {};
            const channelMap = {};
            for (const m of messages) {
                userMap[m.author.tag] = (userMap[m.author.tag] || 0) + 1;
                const cname = `#${m.channel.name}`;
                channelMap[cname] = (channelMap[cname] || 0) + 1;
            }

            const sortedUsers = Object.entries(userMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
            const sortedChs = Object.entries(channelMap).sort((a,b)=>b[1]-a[1]).slice(0,3);

            let status = '🧊 極寒（過疎）';
            if (total >= 50) status = '✅ 良好（活発）';
            else if (total >= 10) status = '⚠️ 微妙（静か）';

            const embed = new EmbedBuilder()
                .setTitle('📊 過去1時間のサーバー稼働調査')
                .setColor(0x000000)
                .addFields(
                    { name: '📈 総メッセージ数', value: `${total} 件` },
                    { name: '🧐 判定結果', value: status },
                    { name: '👤 活発なユーザー TOP3', value: sortedUsers.map(u => `${u[0]} (${u[1]}回)`).join('\n') || 'なし' },
                    { name: '📺 活発なチャンネル TOP3', value: sortedChs.map(c => `${c[0]} (${c[1]}回)`).join('\n') || 'なし' }
                ).setFooter({ text: `直近60分間 / Bot除外 • ${new Date().toLocaleString()}` });

            await interaction.reply({ embeds: [embed] });
        }
    }
};
