const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ECON_FILE  = path.join(__dirname, 'data', 'econ.json');
const CORP_FILE  = path.join(__dirname, 'data', 'corp.json');
const SHOP_FILE  = path.join(__dirname, 'data', 'shop.json');
const EPH = { flags: MessageFlags.Ephemeral };
const CURRENCY = '🪙';
const CORP_COST = 10000;

function load(f) {
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 4)); }

function getUser(econ, userId, user) {
    if (!econ[userId]) econ[userId] = { balance: 0, dailyLast: 0, workLast: 0, crimeLast: 0, inventory: [] };
    if (user) econ[userId].username = user.username;
    return econ[userId];
}

const delBtn = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('delete_reply').setLabel('🗑️ 削除').setStyle(ButtonStyle.Secondary)
);

const econCommands = [
    new SlashCommandBuilder().setName('balance').setDescription('所持金を確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')),
    new SlashCommandBuilder().setName('daily').setDescription('毎日コインをもらいます（24時間クールダウン）'),
    new SlashCommandBuilder().setName('work').setDescription('働いてコインを稼ぎます（1時間クールダウン）'),
    new SlashCommandBuilder().setName('crime').setDescription('犯罪を犯してコインを稼ぎます。失敗すると没収（2時間CD）'),
    new SlashCommandBuilder().setName('send').setDescription('他のユーザーに送金します').addUserOption(o => o.setName('user').setDescription('送金先ユーザー').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('金額').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('shop').setDescription('ショップのアイテム一覧を表示します'),
    new SlashCommandBuilder().setName('buy').setDescription('アイテムを購入します').addStringOption(o => o.setName('item').setDescription('アイテム名').setRequired(true)),
    new SlashCommandBuilder().setName('sell').setDescription('インベントリのアイテムを売却します').addStringOption(o => o.setName('item').setDescription('アイテム名').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('売却数（未指定で1個）').setMinValue(1)),
    new SlashCommandBuilder().setName('inventory').setDescription('所持アイテムを確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')),
    new SlashCommandBuilder().setName('econrank').setDescription('所持金ランキングを表示します'),
    new SlashCommandBuilder().setName('rob').setDescription('他のユーザーから強奪を試みます').addUserOption(o => o.setName('user').setDescription('ターゲット').setRequired(true)),
    new SlashCommandBuilder().setName('flip').setDescription('コインフリップで賭けをします').addIntegerOption(o => o.setName('amount').setDescription('賭け金額').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('side').setDescription('表か裏').setRequired(true).addChoices({ name: '表', value: 'heads' }, { name: '裏', value: 'tails' })),
    new SlashCommandBuilder().setName('slots').setDescription('スロットマシンで賭けをします').addIntegerOption(o => o.setName('amount').setDescription('賭け金額').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('corp').setDescription('会社を設立します（1人2社まで・設立費用10,000枚）').addStringOption(o => o.setName('name').setDescription('会社名').setRequired(true)).addStringOption(o => o.setName('description').setDescription('会社の説明').setRequired(true)),
    new SlashCommandBuilder().setName('store').setDescription('会社のストアを管理・表示します').addStringOption(o => o.setName('corp').setDescription('会社名（未指定で一覧）')),
];

async function handleEcon(interaction) {
    const { commandName, options, user, guild } = interaction;
    const econ = load(ECON_FILE);

    if (commandName === 'balance') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const corp = load(CORP_FILE);
        const ownedCorps = Object.values(corp).filter(c => c.ownerId === target.id);
        const embed = new EmbedBuilder()
            .setTitle(`${CURRENCY} ${target.username} の所持金`)
            .setThumbnail(target.displayAvatarURL())
            .setColor(0xf1c40f)
            .addFields(
                { name: '残高', value: `**${u.balance.toLocaleString()}** ${CURRENCY}`, inline: true },
                { name: '保有会社', value: ownedCorps.length > 0 ? ownedCorps.map(c => c.name).join(', ') : 'なし', inline: true }
            ).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'daily') {
        const u = getUser(econ, user.id, user);
        const now = Date.now();
        const remaining = 86400000 - (now - (u.dailyLast || 0));
        if (remaining > 0) {
            const h = Math.floor(remaining / 3600000), m = Math.floor((remaining % 3600000) / 60000);
            return interaction.reply({ content: `⏳ デイリーはまだ受け取れません。あと **${h}時間${m}分**`, ...EPH });
        }
        const streak = (u.dailyStreak || 0) + 1;
        const base = Math.floor(Math.random() * 201) + 200;
        const bonus = Math.min(streak, 7) * 50;
        const amount = base + bonus;
        u.balance += amount;
        u.dailyLast = now;
        u.dailyStreak = streak;
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder().setTitle('🎁 デイリーボーナス')
            .setDescription(`**+${amount}** ${CURRENCY} を受け取りました！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`)
            .addFields(
                { name: '内訳', value: `ベース: ${base} + 連続ボーナス: ${bonus}`, inline: true },
                { name: '連続ログイン', value: `${streak}日目 🔥`, inline: true }
            ).setColor(0x57f287).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'work') {
        const u = getUser(econ, user.id, user);
        const now = Date.now();
        const remaining = 3600000 - (now - (u.workLast || 0));
        if (remaining > 0) {
            const m = Math.floor(remaining / 60000), s = Math.floor((remaining % 60000) / 1000);
            return interaction.reply({ content: `⏳ まだ働けません。あと **${m}分${s}秒**`, ...EPH });
        }
        const jobs = [
            { name: 'プログラマー', desc: 'コードを書きまくった', min: 80, max: 180 },
            { name: 'シェフ', desc: '料理を作って客に振る舞った', min: 60, max: 150 },
            { name: 'ゲーム実況者', desc: '配信が大盛況だった', min: 50, max: 200 },
            { name: '宅配ドライバー', desc: '荷物を時間通りに届けた', min: 70, max: 140 },
            { name: 'デザイナー', desc: 'クライアントに絶賛された', min: 90, max: 170 },
            { name: '作家', desc: '原稿を書き上げた', min: 60, max: 160 },
            { name: '教師', desc: '生徒に感謝された', min: 55, max: 130 },
            { name: '音楽家', desc: 'ライブが満員だった', min: 80, max: 220 },
            { name: '漁師', desc: '大漁だった', min: 70, max: 160 },
            { name: '株トレーダー', desc: 'うまくポジションを取った', min: 30, max: 300 },
        ];
        const job = jobs[Math.floor(Math.random() * jobs.length)];
        const amount = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
        u.balance += amount;
        u.workLast = now;
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder().setTitle(`💼 ${job.name} として働いた`)
            .setDescription(`${job.desc}！\n**+${amount}** ${CURRENCY} を獲得！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`)
            .setColor(0x3498db).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'crime') {
        const u = getUser(econ, user.id, user);
        const now = Date.now();
        const remaining = 7200000 - (now - (u.crimeLast || 0));
        if (remaining > 0) {
            const h = Math.floor(remaining / 3600000), m = Math.floor((remaining % 3600000) / 60000);
            return interaction.reply({ content: `⏳ まだ犯罪はできません。あと **${h}時間${m}分**`, ...EPH });
        }
        u.crimeLast = now;
        const crimes = [
            { name: '車上荒らし', success: 0.6, gain: [200, 500], fine: [100, 300] },
            { name: '銀行強盗', success: 0.3, gain: [800, 2000], fine: [400, 800] },
            { name: 'スリ', success: 0.7, gain: [100, 300], fine: [50, 200] },
            { name: '詐欺', success: 0.5, gain: [300, 700], fine: [200, 500] },
            { name: '密輸', success: 0.4, gain: [500, 1200], fine: [300, 600] },
        ];
        const crime = crimes[Math.floor(Math.random() * crimes.length)];
        const success = Math.random() < crime.success;
        let embed;
        if (success) {
            const amount = Math.floor(Math.random() * (crime.gain[1] - crime.gain[0] + 1)) + crime.gain[0];
            u.balance += amount;
            embed = new EmbedBuilder().setTitle(`🦹 ${crime.name} 成功！`).setDescription(`うまくいった！\n**+${amount}** ${CURRENCY} を獲得！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`).setColor(0x57f287);
        } else {
            const fine = Math.floor(Math.random() * (crime.fine[1] - crime.fine[0] + 1)) + crime.fine[0];
            u.balance = Math.max(0, u.balance - fine);
            embed = new EmbedBuilder().setTitle(`🚔 ${crime.name} 失敗！`).setDescription(`捕まった！**${fine}** ${CURRENCY} を没収された。\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`).setColor(0xff4757);
        }
        save(ECON_FILE, econ);
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'send') {
        const target = options.getUser('user');
        const amount = options.getInteger('amount');
        if (target.id === user.id) return interaction.reply({ content: '❌ 自分自身には送金できません。', ...EPH });
        if (target.bot) return interaction.reply({ content: '❌ Botには送金できません。', ...EPH });
        const sender = getUser(econ, user.id, user);
        const receiver = getUser(econ, target.id, target);
        if (sender.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${sender.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        sender.balance -= amount;
        receiver.balance += amount;
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder().setTitle('💸 送金完了').setColor(0x2ecc71)
            .addFields(
                { name: '送金元', value: user.username, inline: true },
                { name: '送金先', value: target.username, inline: true },
                { name: '金額', value: `**${amount.toLocaleString()}** ${CURRENCY}`, inline: false },
                { name: '残高', value: `${sender.balance.toLocaleString()} ${CURRENCY}`, inline: true }
            ).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'rob') {
        const target = options.getUser('user');
        if (target.id === user.id) return interaction.reply({ content: '❌ 自分は強盗できません。', ...EPH });
        if (target.bot) return interaction.reply({ content: '❌ Botは強盗できません。', ...EPH });
        const robber = getUser(econ, user.id, user);
        const victim = getUser(econ, target.id, target);
        if (victim.balance < 100) return interaction.reply({ content: `❌ ${target.username} の残高が少なすぎます。`, ...EPH });
        const success = Math.random() < 0.4;
        let embed;
        if (success) {
            const stolen = Math.floor(victim.balance * (0.1 + Math.random() * 0.2));
            robber.balance += stolen;
            victim.balance -= stolen;
            embed = new EmbedBuilder().setTitle('🔫 強盗成功！').setDescription(`**${target.username}** から **${stolen.toLocaleString()}** ${CURRENCY} を奪った！\n残高: **${robber.balance.toLocaleString()}** ${CURRENCY}`).setColor(0x57f287);
        } else {
            const fine = Math.floor(robber.balance * 0.1 + 200);
            robber.balance = Math.max(0, robber.balance - fine);
            embed = new EmbedBuilder().setTitle('🚔 強盗失敗！').setDescription(`捕まった！罰金 **${fine.toLocaleString()}** ${CURRENCY}\n残高: **${robber.balance.toLocaleString()}** ${CURRENCY}`).setColor(0xff4757);
        }
        save(ECON_FILE, econ);
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'flip') {
        const amount = options.getInteger('amount');
        const side = options.getString('side');
        const u = getUser(econ, user.id, user);
        if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const win = result === side;
        if (win) u.balance += amount; else u.balance -= amount;
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder()
            .setTitle(win ? '🎉 勝利！' : '😢 敗北...')
            .setColor(win ? 0x57f287 : 0xff4757)
            .addFields(
                { name: '選択', value: side === 'heads' ? '表 🪙' : '裏 🔄', inline: true },
                { name: '結果', value: result === 'heads' ? '表 🪙' : '裏 🔄', inline: true },
                { name: win ? `+${amount.toLocaleString()} 獲得` : `-${amount.toLocaleString()} 没収`, value: `残高: **${u.balance.toLocaleString()}** ${CURRENCY}`, inline: false }
            );
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'slots') {
        const amount = options.getInteger('amount');
        const u = getUser(econ, user.id, user);
        if (u.balance < amount) return interaction.reply({ content: `❌ 残高不足。現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎'];
        const roll = () => symbols[Math.floor(Math.random() * symbols.length)];
        const s = [roll(), roll(), roll()];
        let multiplier = 0;
        if (s[0] === s[1] && s[1] === s[2]) multiplier = s[0] === '💎' ? 10 : s[0] === '⭐' ? 5 : 3;
        else if (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) multiplier = 1.5;
        const win = multiplier > 0;
        const payout = win ? Math.floor(amount * multiplier) : 0;
        u.balance += payout - amount;
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder().setTitle('🎰 スロット')
            .setDescription(`**[ ${s.join(' | ')} ]**\n\n${win ? `🎉 **${multiplier}x** 当たり！ **+${payout.toLocaleString()}** ${CURRENCY}` : `💸 ハズレ... **-${amount.toLocaleString()}** ${CURRENCY}`}`)
            .setColor(win ? 0xf1c40f : 0x95a5a6)
            .addFields({ name: '残高', value: `**${u.balance.toLocaleString()}** ${CURRENCY}`, inline: true });
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'shop') {
        const shop = load(SHOP_FILE);
        const items = Object.values(shop);
        if (items.length === 0) return interaction.reply({ content: '🛒 現在ショップにアイテムがありません。', ...EPH });
        const embed = new EmbedBuilder().setTitle('🛒 ショップ').setColor(0xe67e22)
            .setDescription(items.map((item, i) =>
                `**${i + 1}. ${item.name}**\n価格: **${item.price.toLocaleString()}** ${CURRENCY}　売却: **${Math.floor(item.price * 0.5).toLocaleString()}** ${CURRENCY}${item.roleId ? `　🏷️ ロール付与` : ''}\n${item.description}`
            ).join('\n\n'))
            .setFooter({ text: '/buy [アイテム名] で購入 / /sell [アイテム名] で売却（50%）' });
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'buy') {
        const itemName = options.getString('item');
        const shop = load(SHOP_FILE);
        const item = Object.values(shop).find(i => i.name.toLowerCase() === itemName.toLowerCase());
        if (!item) return interaction.reply({ content: `❌ **${itemName}** は存在しません。\`/shop\` で確認してください。`, ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < item.price) return interaction.reply({ content: `❌ 残高不足。必要: **${item.price.toLocaleString()}** / 現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        u.balance -= item.price;
        if (!u.inventory) u.inventory = [];
        u.inventory.push({ name: item.name, boughtAt: Date.now(), sellPrice: Math.floor(item.price * 0.5) });
        save(ECON_FILE, econ);
        if (item.roleId && guild) {
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (member) await member.roles.add(item.roleId).catch(() => {});
        }
        const embed = new EmbedBuilder().setTitle('✅ 購入完了').setColor(0x57f287)
            .setDescription(`**${item.name}** を購入しました！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}${item.roleId ? '\n🏷️ ロールが付与されました。' : ''}`).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'sell') {
        const itemName = options.getString('item');
        const sellCount = options.getInteger('amount') || 1;
        const u = getUser(econ, user.id, user);
        if (!u.inventory) u.inventory = [];
        const indices = [];
        for (let i = 0; i < u.inventory.length && indices.length < sellCount; i++) {
            if (u.inventory[i].name.toLowerCase() === itemName.toLowerCase()) indices.push(i);
        }
        if (indices.length === 0) return interaction.reply({ content: `❌ **${itemName}** をインベントリに持っていません。`, ...EPH });
        if (indices.length < sellCount) return interaction.reply({ content: `❌ **${itemName}** は ${indices.length} 個しか持っていません。`, ...EPH });
        const totalPrice = indices.reduce((sum, i) => sum + (u.inventory[i].sellPrice || 0), 0);
        for (const i of [...indices].reverse()) u.inventory.splice(i, 1);
        u.balance += totalPrice;
        save(ECON_FILE, econ);
        return interaction.reply({ content: `✅ **${itemName}** × ${sellCount} を **${totalPrice.toLocaleString()}** ${CURRENCY} で売却しました。\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`, components: [delBtn()] });
    }

    if (commandName === 'inventory') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const inv = u.inventory || [];
        const embed = new EmbedBuilder().setTitle(`🎒 ${target.username} のインベントリ`).setThumbnail(target.displayAvatarURL()).setColor(0x9b59b6);
        if (inv.length === 0) embed.setDescription('アイテムを所持していません。');
        else {
            const counts = {};
            for (const item of inv) counts[item.name] = (counts[item.name] || 0) + 1;
            embed.setDescription(Object.entries(counts).map(([name, count]) => `• **${name}** × ${count}`).join('\n'));
        }
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'econrank') {
        const sorted = Object.entries(econ).map(([id, u]) => ({ id, balance: u.balance || 0 })).sort((a, b) => b.balance - a.balance).slice(0, 10);
        if (sorted.length === 0) return interaction.reply({ content: 'まだデータがありません。', ...EPH });
        await interaction.deferReply();
        const medals = ['🥇', '🥈', '🥉'];
        const lines = await Promise.all(sorted.map(async (u, i) => {
            let name = econ[u.id]?.username;
            if (!name) {
                const member = await guild?.members.fetch(u.id).catch(() => null);
                if (member) { name = member.user.username; econ[u.id].username = name; } else name = `ID:${u.id}`;
            }
            return `${medals[i] || `**${i + 1}.**`} ${name} — **${u.balance.toLocaleString()}** ${CURRENCY}`;
        }));
        save(ECON_FILE, econ);
        const embed = new EmbedBuilder().setTitle(`${CURRENCY} 所持金ランキング`).setColor(0xf1c40f).setDescription(lines.join('\n')).setTimestamp();
        return interaction.editReply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'corp') {
        const corpName = options.getString('name').trim();
        const corpDesc = options.getString('description').trim();
        const corpData = load(CORP_FILE);
        const u = getUser(econ, user.id, user);
        const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
        if (owned.length >= 2) return interaction.reply({ content: '❌ 1人につき最大2社まで設立できます。', ...EPH });
        if (Object.values(corpData).some(c => c.name.toLowerCase() === corpName.toLowerCase())) return interaction.reply({ content: `❌ **${corpName}** という会社はすでに存在します。`, ...EPH });
        if (u.balance < CORP_COST) return interaction.reply({ content: `❌ 設立費用不足。必要: **${CORP_COST.toLocaleString()}** ${CURRENCY}　現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        u.balance -= CORP_COST;
        const corpId = `corp_${Date.now()}_${user.id}`;
        corpData[corpId] = { id: corpId, name: corpName, description: corpDesc, ownerId: user.id, ownerName: user.username, createdAt: Date.now(), balance: 0, items: [], employees: [] };
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        const embed = new EmbedBuilder().setTitle('🏢 会社設立完了').setColor(0x3498db)
            .addFields(
                { name: '会社名', value: corpName, inline: true },
                { name: 'オーナー', value: user.username, inline: true },
                { name: '設立費用', value: `${CORP_COST.toLocaleString()} ${CURRENCY}`, inline: true },
                { name: '説明', value: corpDesc, inline: false }
            ).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    if (commandName === 'store') {
        const corpData = load(CORP_FILE);
        const corpName = options.getString('corp');
        if (corpName) {
            const c = Object.values(corpData).find(c => c.name.toLowerCase() === corpName.toLowerCase());
            if (!c) return interaction.reply({ content: `❌ **${corpName}** という会社は存在しません。`, ...EPH });
            return showStore(interaction, c, user);
        }
        const owned = Object.values(corpData).filter(c => c.ownerId === user.id);
        if (owned.length === 0) {
            const all = Object.values(corpData);
            if (all.length === 0) return interaction.reply({ content: '現在登録されている会社はありません。`/corp` で設立できます。', ...EPH });
            const embed = new EmbedBuilder().setTitle('🏢 会社一覧').setColor(0x3498db)
                .setDescription(all.map((c, i) => `**${i + 1}. ${c.name}**\nオーナー: ${c.ownerName}　商品数: ${c.items.length}\n${c.description}`).join('\n\n'))
                .setFooter({ text: '/store [会社名] でストアを見る' });
            return interaction.reply({ embeds: [embed], components: [delBtn()] });
        }
        if (owned.length === 1) return showStoreManage(interaction, owned[0], corpData, user);
        const select = new StringSelectMenuBuilder().setCustomId('store_select_corp').setPlaceholder('管理する会社を選択')
            .addOptions(owned.map(c => ({ label: c.name, description: c.description.slice(0, 50), value: c.id })));
        return interaction.reply({ content: '管理する会社を選択してください:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
    }
}

async function showStore(interaction, c, user) {
    const embed = new EmbedBuilder().setTitle(`🏪 ${c.name}`).setDescription(c.description).setColor(0xe67e22)
        .addFields(
            { name: 'オーナー', value: c.ownerName, inline: true },
            { name: '商品数', value: `${c.items.length}件`, inline: true }
        );
    if (c.items.length > 0) embed.addFields({ name: '商品一覧', value: c.items.map((item, i) => `**${i + 1}. ${item.name}** — **${item.price.toLocaleString()}** 🪙\n${item.description}`).join('\n\n'), inline: false });
    else embed.addFields({ name: '商品一覧', value: '商品がまだありません。', inline: false });
    const rows = [];
    if (c.items.length > 0 && c.ownerId !== user.id) {
        const select = new StringSelectMenuBuilder().setCustomId(`store_buy_${c.id}`).setPlaceholder('購入する商品を選択')
            .addOptions(c.items.map(item => ({ label: item.name, description: `${item.price.toLocaleString()} 🪙`, value: item.name })));
        rows.push(new ActionRowBuilder().addComponents(select));
    }
    rows.push(delBtn());
    return interaction.reply({ embeds: [embed], components: rows });
}

async function showStoreManage(interaction, c, corpData, user) {
    const embed = new EmbedBuilder().setTitle(`⚙️ ${c.name} 管理`).setColor(0x9b59b6)
        .addFields(
            { name: '会社残高', value: `**${(c.balance || 0).toLocaleString()}** 🪙`, inline: true },
            { name: '商品数', value: `${c.items.length}件`, inline: true },
            { name: '従業員数', value: `${(c.employees || []).length}人`, inline: true }
        );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`store_additem_${c.id}`).setLabel('商品追加').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`store_removeitem_${c.id}`).setLabel('商品削除').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`store_withdraw_${c.id}`).setLabel('売上回収').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('delete_reply').setLabel('✕ 閉じる').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({ embeds: [embed], components: [row], ...EPH });
}

async function handleEconInteraction(interaction) {
    const cid = interaction.customId;
    const { user, guild } = interaction;
    const econ = load(ECON_FILE);
    const corpData = load(CORP_FILE);

    if (interaction.isStringSelectMenu() && cid === 'store_select_corp') {
        const corpId = interaction.values[0];
        const c = corpData[corpId];
        if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        return showStoreManage(interaction, c, corpData, user);
    }

    if (interaction.isStringSelectMenu() && cid.startsWith('store_buy_')) {
        const corpId = cid.replace('store_buy_', '');
        const c = corpData[corpId];
        if (!c) return interaction.reply({ content: '❌ 会社が見つかりません。', ...EPH });
        const itemName = interaction.values[0];
        const item = c.items.find(i => i.name === itemName);
        if (!item) return interaction.reply({ content: '❌ 商品が見つかりません。', ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < item.price) return interaction.reply({ content: `❌ 残高不足。必要: **${item.price.toLocaleString()}** / 現在: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
        u.balance -= item.price;
        c.balance = (c.balance || 0) + item.price;
        if (!u.inventory) u.inventory = [];
        u.inventory.push({ name: item.name, boughtAt: Date.now(), sellPrice: Math.floor(item.price * 0.3), from: c.name });
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${item.name}** を **${item.price.toLocaleString()}** 🪙 で購入しました！`, ...EPH });
    }

    if (!interaction.isButton()) return;

    if (cid.startsWith('store_additem_')) {
        const corpId = cid.replace('store_additem_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const modal = new ModalBuilder().setCustomId(`modal_store_additem_${corpId}`).setTitle(`${c.name} - 商品追加`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_name').setLabel('商品名').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_price').setLabel('価格').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_desc').setLabel('説明').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
    }

    if (cid.startsWith('store_removeitem_')) {
        const corpId = cid.replace('store_removeitem_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        if (c.items.length === 0) return interaction.reply({ content: '❌ 削除する商品がありません。', ...EPH });
        const select = new StringSelectMenuBuilder().setCustomId(`store_delitem_select_${corpId}`).setPlaceholder('削除する商品を選択')
            .addOptions(c.items.map(item => ({ label: item.name, description: `${item.price.toLocaleString()} 🪙`, value: item.name })));
        return interaction.reply({ content: '削除する商品を選択:', components: [new ActionRowBuilder().addComponents(select)], ...EPH });
    }

    if (cid.startsWith('store_withdraw_')) {
        const corpId = cid.replace('store_withdraw_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const amount = c.balance || 0;
        if (amount === 0) return interaction.reply({ content: '❌ 回収できる売上がありません。', ...EPH });
        const u = getUser(econ, user.id, user);
        u.balance += amount;
        c.balance = 0;
        save(ECON_FILE, econ);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${c.name}** の売上 **${amount.toLocaleString()}** 🪙 を回収しました！\n残高: **${u.balance.toLocaleString()}** 🪙`, ...EPH });
    }
}

async function handleEconModal(interaction) {
    const cid = interaction.customId;
    const { user } = interaction;
    const corpData = load(CORP_FILE);
    if (cid.startsWith('modal_store_additem_')) {
        const corpId = cid.replace('modal_store_additem_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const name = interaction.fields.getTextInputValue('item_name').trim();
        const price = parseInt(interaction.fields.getTextInputValue('item_price')) || 0;
        const desc = interaction.fields.getTextInputValue('item_desc').trim();
        if (price <= 0) return interaction.reply({ content: '❌ 有効な価格を入力してください。', ...EPH });
        if (c.items.some(i => i.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: `❌ **${name}** はすでに存在します。`, ...EPH });
        c.items.push({ name, price, description: desc });
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${name}** (${price.toLocaleString()} 🪙) を **${c.name}** のストアに追加しました。`, ...EPH });
    }
}

async function handleEconSelect(interaction) {
    const cid = interaction.customId;
    const { user } = interaction;
    const corpData = load(CORP_FILE);
    if (cid.startsWith('store_delitem_select_')) {
        const corpId = cid.replace('store_delitem_select_', '');
        const c = corpData[corpId];
        if (!c || c.ownerId !== user.id) return interaction.reply({ content: '❌ 権限がありません。', ...EPH });
        const itemName = interaction.values[0];
        const idx = c.items.findIndex(i => i.name === itemName);
        if (idx === -1) return interaction.reply({ content: '❌ 商品が見つかりません。', ...EPH });
        c.items.splice(idx, 1);
        save(CORP_FILE, corpData);
        return interaction.reply({ content: `✅ **${itemName}** を削除しました。`, ...EPH });
    }
}

module.exports = { econCommands, handleEcon, handleEconInteraction, handleEconModal, handleEconSelect };
