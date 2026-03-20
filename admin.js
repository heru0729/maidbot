const { PermissionFlagsBits, EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');

function buildMembersEmbed(members, page, guildName) {
    const PAGE_SIZE = 10;
    const totalPages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    const current = members.slice(start, start + PAGE_SIZE);
    const lines = current.map((m, i) => {
        const pos = start + i + 1;
        const isAdmin = m.permissions.has(PermissionFlagsBits.Administrator) ? '👑 管理者' : '一般';
        const isBot = m.user.bot ? ' 🤖' : '';
        return `**${pos}.** ${m.user.tag}${isBot}\nID: \`${m.user.id}\` | ${isAdmin}`;
    }).join('\n\n');
    const embed = new EmbedBuilder()
        .setTitle(`👥 ${guildName} のメンバー一覧`)
        .setDescription(lines || 'メンバーなし')
        .setColor(0x5865f2)
        .setFooter({ text: `ページ ${safePage} / ${totalPages}　全 ${members.length} 人` });
    return { embed, safePage, totalPages };
}

function buildMembersRow(guildId, page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin_members_${guildId}_${page - 1}`).setLabel('◀ 前へ').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId(`admin_members_${guildId}_${page + 1}`).setLabel('次へ ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
    );
}

function buildMainMenu() {
    const embed = new EmbedBuilder()
        .setTitle('🛠️ オーナーメニュー')
        .setDescription('カテゴリを選択してください。')
        .setColor(0x5865f2);
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('amenu_server').setLabel('🏰 サーバー管理').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('amenu_perm').setLabel('🔑 権限管理').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('amenu_econ').setLabel('💰 エコノミー管理').setStyle(ButtonStyle.Success)
    );
    return { embeds: [embed], components: [row1] };
}

function buildServerMenu() {
    const embed = new EmbedBuilder().setTitle('🏰 サーバー管理').setColor(0x5865f2);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('amenu_link').setLabel('🔗 招待リンク生成').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('amenu_members').setLabel('👥 メンバー一覧').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('amenu_channels').setLabel('📋 チャンネル一覧').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('amenu_serverlist').setLabel('🏰 サーバー一覧').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('amenu_userlist').setLabel('👤 認証ユーザー一覧').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('amenu_msg').setLabel('📨 メッセージ送信').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('amenu_log').setLabel('📜 ログ取得').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('amenu_back').setLabel('← 戻る').setStyle(ButtonStyle.Danger)
    );
    return { embeds: [embed], components: [row, row2] };
}

function buildPermMenu() {
    const embed = new EmbedBuilder().setTitle('🔑 権限管理').setColor(0xe67e22);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('amenu_admin').setLabel('👑 管理者ロール付与').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('amenu_admin_del').setLabel('🗑️ 管理者ロール削除').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('amenu_back').setLabel('← 戻る').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

function buildEconMenu() {
    const embed = new EmbedBuilder().setTitle('💰 エコノミー管理').setColor(0x2ecc71);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('amenu_give').setLabel('💰 コイン付与').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('amenu_crash').setLabel('📉 強制下落').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('amenu_resetprice').setLabel('🔄 価格リセット').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('amenu_resetcoins').setLabel('🪙 発行量変更').setStyle(ButtonStyle.Primary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('amenu_resetall').setLabel('🗑️ 全経済リセット').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('amenu_back').setLabel('← 戻る').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row, row2] };
}

async function handleAdminCommands(msg, client, OWNER_IDS, loadData, saveData, USERS_FILE) {
    if (!OWNER_IDS.includes(msg.author.id)) return;

    const args = msg.content.slice(1).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command !== 'menu') return;

    const menuMsg = await msg.reply(buildMainMenu());

    const collector = menuMsg.createMessageComponentCollector({ time: 300000 });

    collector.on('collect', async (interaction) => {
        if (!OWNER_IDS.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ 権限がありません。', flags: MessageFlags.Ephemeral });
        }

        const id = interaction.customId;
        const fs = require('fs'), path = require('path');

        // ===== ナビゲーション =====
        if (id === 'amenu_back') return interaction.update(buildMainMenu());
        if (id === 'amenu_server') return interaction.update(buildServerMenu());
        if (id === 'amenu_perm') return interaction.update(buildPermMenu());
        if (id === 'amenu_econ') return interaction.update(buildEconMenu());

        // ===== サーバー管理 =====
        if (id === 'amenu_serverlist') {
            const guilds = client.guilds.cache.map(g => `・**${g.name}** (\`${g.id}\`) | 👤 ${g.memberCount}人`).join('\n');
            const embed = new EmbedBuilder().setTitle('🏰 導入サーバー一覧').setDescription(guilds.slice(0, 4000) || 'なし').setColor(0x5865f2);
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (id === 'amenu_userlist') {
            const userData = loadData(USERS_FILE);
            const entries = Object.entries(userData).filter(([, d]) => d.accessToken);
            if (entries.length === 0) return interaction.reply({ content: 'OAuth2認証済みユーザーはいません。', flags: MessageFlags.Ephemeral });
            const list = entries.map(([keyId, d]) => `・**${d.username || '不明'}** (${d.id || keyId})`).join('\n');
            const embed = new EmbedBuilder().setTitle(`👤 OAuth2認証済みユーザー (${entries.length}人)`).setDescription(list.slice(0, 4000)).setColor(0x2ecc71);
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (id === 'amenu_link') {
            const modal = new ModalBuilder().setCustomId('amodal_link').setTitle('招待リンク生成');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('サーバーID').setStyle(TextInputStyle.Short).setRequired(true)));
            return interaction.showModal(modal);
        }

        if (id === 'amenu_members') {
            const modal = new ModalBuilder().setCustomId('amodal_members').setTitle('メンバー一覧');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('サーバーID').setStyle(TextInputStyle.Short).setRequired(true)));
            return interaction.showModal(modal);
        }

        if (id === 'amenu_channels') {
            const modal = new ModalBuilder().setCustomId('amodal_channels').setTitle('チャンネル一覧');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('サーバーID').setStyle(TextInputStyle.Short).setRequired(true)));
            return interaction.showModal(modal);
        }

        if (id === 'amenu_msg') {
            const modal = new ModalBuilder().setCustomId('amodal_msg').setTitle('メッセージ送信');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('サーバーID').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('チャンネルID').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('メッセージ内容').setStyle(TextInputStyle.Paragraph).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (id === 'amenu_log') {
            const modal = new ModalBuilder().setCustomId('amodal_log').setTitle('ログ取得');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('サーバーID').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('チャンネルID').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        // ===== 権限管理 =====
        if (id === 'amenu_admin') {
            const modal = new ModalBuilder().setCustomId('amodal_admin').setTitle('管理者ロール付与');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('サーバーID').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role_name').setLabel('ロール名').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('position').setLabel('位置調整 (up / down)').setStyle(TextInputStyle.Short).setValue('up').setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (id === 'amenu_admin_del') {
            const modal = new ModalBuilder().setCustomId('amodal_admin_del').setTitle('管理者ロール削除');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('サーバーID').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role_name').setLabel('ロール名').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        // ===== エコノミー管理 =====
        if (id === 'amenu_give') {
            const modal = new ModalBuilder().setCustomId('amodal_give').setTitle('コイン付与');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_id').setLabel('ユーザーID').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('金額（数字 or infinity）').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (id === 'amenu_crash') {
            const modal = new ModalBuilder().setCustomId('amodal_crash').setTitle('強制下落');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('target').setLabel('対象（stock / crypto / all）').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('percent').setLabel('下落率（1〜99）').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('銘柄名（省略で全対象）').setStyle(TextInputStyle.Short).setRequired(false))
            );
            return interaction.showModal(modal);
        }

        if (id === 'amenu_resetprice') {
            const modal = new ModalBuilder().setCustomId('amodal_resetprice').setTitle('価格リセット');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('target').setLabel('対象（stock / crypto）').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('銘柄名').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price').setLabel('新価格').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (id === 'amenu_resetall') {
            const embed = new EmbedBuilder().setTitle('⚠️ 全経済リセット確認').setColor(0xff4757)
                .setDescription('以下のデータが**すべて削除**されます：\n• 全ユーザーの残高・インベントリ\n• 全会社データ（株式含む）\n• 全仮想通貨データ\n• オークション・融資・取引データ\n\n**この操作は取り消せません。**');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('amenu_resetall_confirm').setLabel('✅ リセット実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('amenu_econ').setLabel('❌ キャンセル').setStyle(ButtonStyle.Secondary)
            );
            return interaction.update({ embeds: [embed], components: [row] });
        }

        if (id === 'amenu_resetall_confirm') {
            const fs = require('fs'), path = require('path');
            const dataDir = path.join(__dirname, 'data');
            const files = ['econ.json', 'corp.json', 'crypto.json', 'auctions.json', 'loans.json', 'trades.json'];
            const results = [];
            for (const file of files) {
                const p = path.join(dataDir, file);
                if (fs.existsSync(p)) {
                    fs.writeFileSync(p, JSON.stringify({}, null, 4));
                    results.push(`✅ ${file}`);
                } else {
                    results.push(`⏭️ ${file}（存在しない）`);
                }
            }
            const embed = new EmbedBuilder().setTitle('🗑️ 全経済リセット完了').setColor(0x2ecc71)
                .setDescription(results.join('\n')).setTimestamp();
            return interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('amenu_econ').setLabel('← 戻る').setStyle(ButtonStyle.Secondary))] });
        }

        if (id === 'amenu_resetcoins') {
            const modal = new ModalBuilder().setCustomId('amodal_resetcoins').setTitle('発行量変更');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('supply').setLabel('発行量（省略で1億）').setStyle(TextInputStyle.Short).setValue('100000000').setRequired(false)));
            return interaction.showModal(modal);
        }

        // ===== モーダル送信処理 =====
        if (!interaction.isModalSubmit()) return;
        const cid = interaction.customId;
        const f = (key) => interaction.fields.getTextInputValue(key);

        if (cid === 'amodal_link') {
            const guild = client.guilds.cache.get(f('guild_id'));
            if (!guild) return interaction.reply({ content: '❌ サーバーが見つかりません。', flags: MessageFlags.Ephemeral });
            try {
                const channel = guild.channels.cache.find(c => (c.type === 0 || c.type === 5) && guild.members.me.permissionsIn(c).has(PermissionFlagsBits.CreateInstantInvite));
                if (!channel) return interaction.reply({ content: '❌ 招待作成権限のあるチャンネルが見つかりません。', flags: MessageFlags.Ephemeral });
                const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true });
                return interaction.reply({ content: `🔗 **${guild.name}** の招待リンク:\n${invite.url}`, flags: MessageFlags.Ephemeral });
            } catch (e) { return interaction.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral }); }
        }

        if (cid === 'amodal_members') {
            const guild = client.guilds.cache.get(f('guild_id'));
            if (!guild) return interaction.reply({ content: '❌ サーバーが見つかりません。', flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const members = await guild.members.fetch();
                const sorted = [...members.values()].sort((a, b) => a.user.bot !== b.user.bot ? (a.user.bot ? 1 : -1) : a.user.tag.localeCompare(b.user.tag));
                const { embed, safePage, totalPages } = buildMembersEmbed(sorted, 1, guild.name);
                const components = totalPages > 1 ? [buildMembersRow(f('guild_id'), safePage, totalPages)] : [];
                const reply = await interaction.editReply({ embeds: [embed], components });
                if (totalPages > 1) {
                    const c2 = reply.createMessageComponentCollector();
                    c2.on('collect', async btn => {
                        const newPage = parseInt(btn.customId.split('_').pop());
                        const { embed: e2, safePage: sp, totalPages: tp } = buildMembersEmbed(sorted, newPage, guild.name);
                        await btn.update({ embeds: [e2], components: [buildMembersRow(f('guild_id'), sp, tp)] });
                    });
                }
            } catch (e) { await interaction.editReply(`❌ ${e.message}`); }
        }

        if (cid === 'amodal_channels') {
            const guild = client.guilds.cache.get(f('guild_id'));
            if (!guild) return interaction.reply({ content: '❌ サーバーが見つかりません。', flags: MessageFlags.Ephemeral });
            const typeLabel = (t) => ({ 0: '💬', 2: '🔊', 4: '📁', 5: '📢', 13: '🎙️', 15: '📋' }[t] || '❓');
            const cats = guild.channels.cache.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
            const noCat = guild.channels.cache.filter(c => c.type !== 4 && !c.parentId).sort((a, b) => a.position - b.position);
            const buildSec = (channels) => [...channels.values()].map(c => `${typeLabel(c.type)} **${c.name}** \`${c.id}\``).join('\n');
            let text = noCat.size > 0 ? `**📂 カテゴリなし**\n${buildSec(noCat)}\n` : '';
            for (const [, cat] of cats) {
                const children = guild.channels.cache.filter(c => c.parentId === cat.id).sort((a, b) => a.position - b.position);
                text += `**📁 ${cat.name}**\n${buildSec(children) || '(なし)'}\n`;
            }
            const embed = new EmbedBuilder().setTitle(`📋 ${guild.name} のチャンネル一覧`).setDescription(text.slice(0, 4000) || 'なし').setColor(0x3498db);
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (cid === 'amodal_msg') {
            const guild = client.guilds.cache.get(f('guild_id'));
            if (!guild) return interaction.reply({ content: '❌ サーバーが見つかりません。', flags: MessageFlags.Ephemeral });
            const channel = guild.channels.cache.get(f('channel_id'));
            if (!channel) return interaction.reply({ content: '❌ チャンネルが見つかりません。', flags: MessageFlags.Ephemeral });
            try {
                await channel.send(f('text'));
                return interaction.reply({ content: `✅ **${guild.name}** / **#${channel.name}** に送信しました。`, flags: MessageFlags.Ephemeral });
            } catch (e) { return interaction.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral }); }
        }

        if (cid === 'amodal_log') {
            const guild = client.guilds.cache.get(f('guild_id'));
            if (!guild) return interaction.reply({ content: '❌ サーバーが見つかりません。', flags: MessageFlags.Ephemeral });
            const channel = guild.channels.cache.get(f('channel_id'));
            if (!channel) return interaction.reply({ content: '❌ チャンネルが見つかりません。', flags: MessageFlags.Ephemeral });
            try {
                const messages = await channel.messages.fetch({ limit: 20 });
                const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                const lines = sorted.map(m => {
                    const time = new Date(m.createdTimestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                    const content = m.content || (m.attachments.size > 0 ? `[添付]` : '[内容なし]');
                    return `**[${time}] ${m.author.tag}**\n${content.slice(0, 200)}`;
                }).join('\n\n');
                const embed = new EmbedBuilder().setTitle(`📜 #${channel.name} の直近ログ`).setDescription(lines.slice(0, 4000) || '(なし)').setColor(0x95a5a6).setFooter({ text: `直近 ${sorted.length} 件` });
                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            } catch (e) { return interaction.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral }); }
        }

        if (cid === 'amodal_admin') {
            const guild = client.guilds.cache.get(f('guild_id'));
            if (!guild) return interaction.reply({ content: '❌ サーバーが見つかりません。', flags: MessageFlags.Ephemeral });
            const botMember = guild.members.me;
            const log = [];
            try {
                if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Botに「ロールの管理」権限がありません。');
                let role = guild.roles.cache.find(r => r.name === f('role_name'));
                if (!role) { role = await guild.roles.create({ name: f('role_name'), permissions: [PermissionFlagsBits.Administrator], reason: 'Admin Command' }); log.push(`✅ ロール作成`); }
                else { log.push(`ℹ️ 既存ロールを使用`); }
                if (f('position') === 'up') await role.setPosition(botMember.roles.highest.position - 1).catch(() => {});
                const member = await guild.members.fetch(interaction.user.id).catch(() => null);
                if (!member) throw new Error('あなたがサーバーにいません。');
                await member.roles.add(role);
                log.push('✅ ロール付与完了');
                return interaction.reply({ content: log.join('\n'), flags: MessageFlags.Ephemeral });
            } catch (e) { return interaction.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral }); }
        }

        if (cid === 'amodal_admin_del') {
            const guild = client.guilds.cache.get(f('guild_id'));
            if (!guild) return interaction.reply({ content: '❌ サーバーが見つかりません。', flags: MessageFlags.Ephemeral });
            try {
                const role = guild.roles.cache.find(r => r.name === f('role_name'));
                if (!role) return interaction.reply({ content: '❌ ロールが見つかりません。', flags: MessageFlags.Ephemeral });
                await role.delete();
                return interaction.reply({ content: `✅ ロール「${f('role_name')}」を削除しました。`, flags: MessageFlags.Ephemeral });
            } catch (e) { return interaction.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral }); }
        }

        if (cid === 'amodal_give') {
            const userId = f('user_id'), amtInput = f('amount').toLowerCase();
            const econPath = path.join(__dirname, 'data', 'econ.json');
            const econ = fs.existsSync(econPath) ? JSON.parse(fs.readFileSync(econPath, 'utf8')) : {};
            if (!econ[userId]) econ[userId] = { balance: 0 };
            const isInfinity = amtInput === 'infinity';
            const amount = isInfinity ? 999999999999 : parseInt(amtInput) || 0;
            if (!isInfinity && amount <= 0) return interaction.reply({ content: '❌ 有効な金額を入力してください。', flags: MessageFlags.Ephemeral });
            econ[userId].balance = isInfinity ? 999999999999 : (econ[userId].balance || 0) + amount;
            fs.writeFileSync(econPath, JSON.stringify(econ, null, 4));
            return interaction.reply({ content: isInfinity ? `✅ \`${userId}\` に無限コイン（999,999,999,999 🪙）を付与しました。` : `✅ \`${userId}\` に **${amount.toLocaleString()}** 🪙 を付与しました。`, flags: MessageFlags.Ephemeral });
        }

        if (cid === 'amodal_crash') {
            const target = f('target').toLowerCase();
            const percent = parseInt(f('percent')) || 0;
            const name = f('name')?.toLowerCase() || null;
            if (!['stock', 'crypto', 'all'].includes(target)) return interaction.reply({ content: '❌ stock / crypto / all のいずれかを入力してください。', flags: MessageFlags.Ephemeral });
            if (percent <= 0 || percent >= 100) return interaction.reply({ content: '❌ 下落率は1〜99で入力してください。', flags: MessageFlags.Ephemeral });
            const ratio = 1 - percent / 100;
            const r3 = x => Math.round(x * 1000) / 1000;
            const results = [];
            if (target === 'stock' || target === 'all') {
                const corpPath = path.join(__dirname, 'data', 'corp.json');
                if (fs.existsSync(corpPath)) {
                    const corpData = JSON.parse(fs.readFileSync(corpPath, 'utf8'));
                    let changed = false;
                    for (const c of Object.values(corpData)) {
                        if (!c.stock || (name && c.name.toLowerCase() !== name)) continue;
                        const before = c.stock.price;
                        c.stock.price = r3(Math.max(0.001, before * ratio));
                        if (!c.stock.history) c.stock.history = [];
                        c.stock.history.push(c.stock.price);
                        if (c.stock.ohlc) c.stock.ohlc.push({ o: before, h: before, l: c.stock.price, c: c.stock.price, t: Date.now() });
                        results.push(`📉 **${c.name}** 株: ${before} → **${c.stock.price}** 🪙`);
                        changed = true;
                    }
                    if (changed) fs.writeFileSync(corpPath, JSON.stringify(corpData, null, 4));
                }
            }
            if (target === 'crypto' || target === 'all') {
                const cryptoPath = path.join(__dirname, 'data', 'crypto.json');
                if (fs.existsSync(cryptoPath)) {
                    const cryptoData = JSON.parse(fs.readFileSync(cryptoPath, 'utf8'));
                    let changed = false;
                    for (const c of Object.values(cryptoData)) {
                        if (name && c.name.toLowerCase() !== name && c.symbol.toLowerCase() !== name) continue;
                        const before = c.price;
                        c.price = r3(Math.max(0.001, before * ratio));
                        if (!c.history) c.history = [];
                        c.history.push(c.price);
                        if (c.ohlc) c.ohlc.push({ o: before, h: before, l: c.price, c: c.price, t: Date.now() });
                        results.push(`📉 **${c.name} (${c.symbol})**: ${before} → **${c.price}** 🪙`);
                        changed = true;
                    }
                    if (changed) fs.writeFileSync(cryptoPath, JSON.stringify(cryptoData, null, 4));
                }
            }
            if (results.length === 0) return interaction.reply({ content: '❌ 対象が見つかりませんでした。', flags: MessageFlags.Ephemeral });
            const embed = new EmbedBuilder().setTitle(`💥 強制下落 -${percent}%`).setDescription(results.join('\n')).setColor(0xff4757).setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (cid === 'amodal_resetprice') {
            const target = f('target').toLowerCase();
            const name = f('name').toLowerCase();
            const price = Math.round(parseFloat(f('price')) * 1000) / 1000;
            if (!['stock', 'crypto'].includes(target) || !name || price <= 0) return interaction.reply({ content: '❌ 入力内容を確認してください。', flags: MessageFlags.Ephemeral });
            if (target === 'stock') {
                const corpPath = path.join(__dirname, 'data', 'corp.json');
                const corpData = JSON.parse(fs.readFileSync(corpPath, 'utf8'));
                const c = Object.values(corpData).find(c => c.name.toLowerCase() === name && c.stock);
                if (!c) return interaction.reply({ content: `❌ 株式「${name}」が見つかりません。`, flags: MessageFlags.Ephemeral });
                c.stock.price = price; c.stock.history = [price]; c.stock.ohlc = [{ o: price, h: price, l: price, c: price, t: Date.now() }];
                fs.writeFileSync(corpPath, JSON.stringify(corpData, null, 4));
                return interaction.reply({ content: `✅ **${c.name}** 株価を **${price}** 🪙 にリセットしました。`, flags: MessageFlags.Ephemeral });
            }
            if (target === 'crypto') {
                const cryptoPath = path.join(__dirname, 'data', 'crypto.json');
                const cryptoData = JSON.parse(fs.readFileSync(cryptoPath, 'utf8'));
                const c = Object.values(cryptoData).find(c => c.name.toLowerCase() === name || c.symbol.toLowerCase() === name);
                if (!c) return interaction.reply({ content: `❌ 仮想通貨「${name}」が見つかりません。`, flags: MessageFlags.Ephemeral });
                c.price = price; c.history = [price]; c.ohlc = [{ o: price, h: price, l: price, c: price, t: Date.now() }];
                fs.writeFileSync(cryptoPath, JSON.stringify(cryptoData, null, 4));
                return interaction.reply({ content: `✅ **${c.name} (${c.symbol})** を **${price}** 🪙 にリセットしました。`, flags: MessageFlags.Ephemeral });
            }
        }

        if (cid === 'amodal_resetcoins') {
            const newSupply = parseInt(f('supply')) || 100000000;
            const cryptoPath = path.join(__dirname, 'data', 'crypto.json');
            if (!fs.existsSync(cryptoPath)) return interaction.reply({ content: '❌ crypto.jsonが見つかりません。', flags: MessageFlags.Ephemeral });
            const cryptoData = JSON.parse(fs.readFileSync(cryptoPath, 'utf8'));
            const coins = Object.values(cryptoData);
            if (coins.length === 0) return interaction.reply({ content: '❌ 仮想通貨がありません。', flags: MessageFlags.Ephemeral });
            const results = [];
            for (const c of coins) {
                const soldAmount = c.totalSupply - c.availableSupply;
                c.totalSupply = newSupply;
                c.availableSupply = Math.max(0, newSupply - soldAmount);
                results.push(`• **${c.name} (${c.symbol})**: → **${newSupply.toLocaleString()}** 枚`);
            }
            fs.writeFileSync(cryptoPath, JSON.stringify(cryptoData, null, 4));
            const embed = new EmbedBuilder().setTitle('🔄 発行量変更完了').setDescription(results.join('\n')).setColor(0x3498db).setFooter({ text: `新発行量: ${newSupply.toLocaleString()} 枚` }).setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    });
}

module.exports = handleAdminCommands;
