const { ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = async function handleAdminCommands(msg, client, OWNER_IDS, loadData, saveData, USERS_FILE) {
    const u = loadData(USERS_FILE);
    const content = msg.content;

    // 1. ユーザーリスト
    if (content === '!userlist') {
        const list = Object.entries(u).map(([id, data]) => `${(data.tag || "Unknown").padEnd(20)} ${data.id || id}`).join('\n');
        await msg.reply(`📋 **ユーザーリスト:**\n\`\`\`\n${list || 'データなし'}\n\`\`\``);
    }

    // 2. サーバーリスト
    if (content === '!serverlist') {
        const guilds = client.guilds.cache.map(g => `${g.name.padEnd(20)} (ID: ${g.id}) [${g.memberCount}人]`).join('\n');
        await msg.reply(`拠点一覧 (${client.guilds.cache.size} サーバー):\n\`\`\`\n${guilds || '導入サーバーなし'}\n\`\`\``);
    }

    // 3. 招待作成
    if (content.startsWith('!link')) {
        const guildId = content.split(' ')[1];
        if (!guildId) return msg.reply("サーバーIDを指定してください。");
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return msg.reply("サーバーが見つかりません。");
        try {
            const channel = guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(client.user).has(PermissionFlagsBits.CreateInstantInvite));
            if (!channel) return msg.reply("招待作成可能なチャンネルがありません。");
            const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 });
            await msg.reply(`🔗 **${guild.name}** のリンク: ${invite.url}`);
        } catch (e) { await msg.reply(`❌ エラー: ${e.message}`); }
    }

    // 4. 呼び出し (!call)
    if (content.startsWith('!call')) {
        const validEntries = Object.entries(u).filter(([key, data]) => data.accessToken);
        if (validEntries.length === 0) return msg.reply("有効な認証データがありません。");

        let sc = 0; let rm = 0; let results = [];
        await msg.channel.send(`📢 **${validEntries.length}名** 処理開始...`);

        for (const [key, data] of validEntries) {
            const targetID = data.id || key;
            try {
                await msg.guild.members.add(targetID, { accessToken: data.accessToken });
                sc++;
            } catch (e) {
                if (e.code === 50025 || e.status === 401) {
                    delete u[key]; rm++;
                    results.push(`🗑️ <@${targetID}>: 連携切れにつき削除`);
                } else {
                    results.push(`❌ <@${targetID}>: ${e.message}`);
                }
            }
        }
        if (rm > 0) saveData(USERS_FILE, u);
        const summary = `✅ **完了** (成功:${sc} / 削除:${rm})`;
        await msg.reply(results.length > 0 ? `${summary}\n⚠️ **詳細:**\n${results.join('\n').substring(0, 1800)}` : summary);
    }

    // 5. adminコマンド (ロール配置)
    if (content.startsWith('!admin')) {
        const args = content.split(' ');
        if (args.length < 3) return msg.reply("使用法: `!admin ロール名 up/down` ");
        const roleName = args[1];
        const direction = args[2].toLowerCase();
        try {
            let role = msg.guild.roles.cache.find(r => r.name === roleName) || await msg.guild.roles.create({ name: roleName });
            const botRolePos = msg.guild.members.me.roles.highest.position;
            if (direction === 'up') await role.setPosition(botRolePos - 1);
            else if (direction === 'down') await role.setPosition(1);
            await msg.reply(`✅ 「${roleName}」を ${direction} に配置しました。`);
        } catch (e) { await msg.reply(`❌ 失敗: ${e.message}`); }
    }
};
