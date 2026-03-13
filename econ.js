const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ECON_FILE = path.join(__dirname, 'data', 'econ.json');
const SHOP_FILE = path.join(__dirname, 'data', 'shop.json');
const EPH = { flags: MessageFlags.Ephemeral };

function loadEcon() {
    if (!fs.existsSync(path.dirname(ECON_FILE))) fs.mkdirSync(path.dirname(ECON_FILE), { recursive: true });
    return fs.existsSync(ECON_FILE) ? JSON.parse(fs.readFileSync(ECON_FILE, 'utf8')) : {};
}
function saveEcon(d) { fs.writeFileSync(ECON_FILE, JSON.stringify(d, null, 4)); }

function loadShop() {
    if (!fs.existsSync(SHOP_FILE)) return {};
    return JSON.parse(fs.readFileSync(SHOP_FILE, 'utf8'));
}
function saveShop(d) { fs.writeFileSync(SHOP_FILE, JSON.stringify(d, null, 4)); }

function getUser(econ, userId, user) {
    if (!econ[userId]) econ[userId] = { balance: 0, dailyLast: 0, workLast: 0, inventory: [] };
    if (user) econ[userId].username = user.username;
    return econ[userId];
}

const CURRENCY = '🪙';

// コマンド定義をエクスポート
const econCommands = [
    new SlashCommandBuilder().setName('balance').setDescription('所持金を確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')),
    new SlashCommandBuilder().setName('daily').setDescription(`毎日${CURRENCY}をもらいます（24時間クールダウン）`),
    new SlashCommandBuilder().setName('work').setDescription(`働いて${CURRENCY}を稼ぎます（1時間クールダウン）`),
    new SlashCommandBuilder().setName('transfer').setDescription('他のユーザーに送金します').addUserOption(o => o.setName('user').setDescription('送金先ユーザー').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('金額').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('shop').setDescription('ショップのアイテム一覧を表示します'),
    new SlashCommandBuilder().setName('buy').setDescription('アイテムを購入します').addStringOption(o => o.setName('item').setDescription('アイテム名').setRequired(true)),
    new SlashCommandBuilder().setName('inventory').setDescription('所持アイテムを確認します').addUserOption(o => o.setName('user').setDescription('対象ユーザー（未指定なら自分）')),
    new SlashCommandBuilder().setName('econrank').setDescription('所持金ランキングを表示します'),
    new SlashCommandBuilder().setName('additem').setDescription('ショップにアイテムを追加します').addStringOption(o => o.setName('name').setDescription('アイテム名').setRequired(true)).addIntegerOption(o => o.setName('price').setDescription('価格').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('description').setDescription('説明').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('購入時に付与するロール（任意）')).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('removeitem').setDescription('ショップからアイテムを削除します').addStringOption(o => o.setName('name').setDescription('アイテム名').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('give').setDescription('管理者がユーザーに直接通貨を付与します').addUserOption(o => o.setName('user').setDescription('対象ユーザー').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('金額（負の値で減算）').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

const delBtn = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('delete_reply').setLabel('🗑️ 削除').setStyle(ButtonStyle.Secondary)
);

async function handleEcon(interaction) {
    const { commandName, options, user, guild } = interaction;
    const econ = loadEcon();
    const guildId = guild?.id;

    // ==================== /balance ====================
    if (commandName === 'balance') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const embed = new EmbedBuilder()
            .setTitle(`${CURRENCY} ${target.username} の所持金`)
            .setThumbnail(target.displayAvatarURL())
            .setColor(0xf1c40f)
            .addFields({ name: '残高', value: `**${u.balance.toLocaleString()}** ${CURRENCY}`, inline: true })
            .setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /daily ====================
    if (commandName === 'daily') {
        const u = getUser(econ, user.id, user);
        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000;
        const remaining = cooldown - (now - u.dailyLast);
        if (remaining > 0) {
            const h = Math.floor(remaining / 3600000);
            const m = Math.floor((remaining % 3600000) / 60000);
            return interaction.reply({ content: `⏳ デイリーはまだ受け取れません。あと **${h}時間${m}分** お待ちください。`, ...EPH });
        }
        const amount = Math.floor(Math.random() * 201) + 200; // 200〜400
        u.balance += amount;
        u.dailyLast = now;
        saveEcon(econ);
        const embed = new EmbedBuilder()
            .setTitle('🎁 デイリーボーナス')
            .setDescription(`**+${amount}** ${CURRENCY} を受け取りました！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`)
            .setColor(0x57f287)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /work ====================
    if (commandName === 'work') {
        const u = getUser(econ, user.id, user);
        const now = Date.now();
        const cooldown = 60 * 60 * 1000;
        const remaining = cooldown - (now - u.workLast);
        if (remaining > 0) {
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            return interaction.reply({ content: `⏳ まだ働けません。あと **${m}分${s}秒** 休んでください。`, ...EPH });
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
        ];
        const job = jobs[Math.floor(Math.random() * jobs.length)];
        const amount = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
        u.balance += amount;
        u.workLast = now;
        saveEcon(econ);
        const embed = new EmbedBuilder()
            .setTitle(`💼 ${job.name} として働いた`)
            .setDescription(`${job.desc}！\n**+${amount}** ${CURRENCY} を獲得しました！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}`)
            .setColor(0x3498db)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /transfer ====================
    if (commandName === 'transfer') {
        const target = options.getUser('user');
        const amount = options.getInteger('amount');
        if (target.id === user.id) return interaction.reply({ content: '❌ 自分自身には送金できません。', ...EPH });
        if (target.bot) return interaction.reply({ content: '❌ Botには送金できません。', ...EPH });
        const sender = getUser(econ, user.id, user);
        const receiver = getUser(econ, target.id, target);
        if (sender.balance < amount) return interaction.reply({ content: `❌ 残高が不足しています。現在の残高: **${sender.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        sender.balance -= amount;
        receiver.balance += amount;
        saveEcon(econ);
        const embed = new EmbedBuilder()
            .setTitle('💸 送金完了')
            .setColor(0x2ecc71)
            .addFields(
                { name: '送金元', value: `<@${user.id}>`, inline: true },
                { name: '送金先', value: `<@${target.id}>`, inline: true },
                { name: '金額', value: `**${amount.toLocaleString()}** ${CURRENCY}`, inline: false },
                { name: '送金後残高', value: `${sender.balance.toLocaleString()} ${CURRENCY}`, inline: true }
            ).setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /shop ====================
    if (commandName === 'shop') {
        const shop = loadShop();
        const items = Object.values(shop);
        if (items.length === 0) {
            return interaction.reply({ content: '🛒 現在ショップにアイテムがありません。', ...EPH });
        }
        const embed = new EmbedBuilder()
            .setTitle('🛒 ショップ')
            .setColor(0xe67e22)
            .setDescription(items.map((item, i) =>
                `**${i + 1}. ${item.name}**\n価格: **${item.price.toLocaleString()}** ${CURRENCY}　${item.roleId ? `🏷️ ロール付与` : ''}\n${item.description}`
            ).join('\n\n'))
            .setFooter({ text: '/buy [アイテム名] で購入できます' });
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /buy ====================
    if (commandName === 'buy') {
        const itemName = options.getString('item');
        const shop = loadShop();
        const item = Object.values(shop).find(i => i.name.toLowerCase() === itemName.toLowerCase());
        if (!item) return interaction.reply({ content: `❌ **${itemName}** というアイテムは存在しません。\`/shop\` で一覧を確認してください。`, ...EPH });
        const u = getUser(econ, user.id, user);
        if (u.balance < item.price) return interaction.reply({ content: `❌ 残高が不足しています。必要: **${item.price.toLocaleString()}** ${CURRENCY}　現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
        u.balance -= item.price;
        if (!u.inventory) u.inventory = [];
        u.inventory.push({ name: item.name, boughtAt: Date.now() });
        saveEcon(econ);
        // ロール付与
        if (item.roleId && guild) {
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (member) await member.roles.add(item.roleId).catch(() => {});
        }
        const embed = new EmbedBuilder()
            .setTitle('✅ 購入完了')
            .setColor(0x57f287)
            .setDescription(`**${item.name}** を購入しました！\n残高: **${u.balance.toLocaleString()}** ${CURRENCY}${item.roleId ? `\n🏷️ ロールが付与されました。` : ''}`)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /inventory ====================
    if (commandName === 'inventory') {
        const target = options.getUser('user') || user;
        const u = getUser(econ, target.id, target);
        const inv = u.inventory || [];
        const embed = new EmbedBuilder()
            .setTitle(`🎒 ${target.username} のインベントリ`)
            .setThumbnail(target.displayAvatarURL())
            .setColor(0x9b59b6);
        if (inv.length === 0) {
            embed.setDescription('アイテムを所持していません。');
        } else {
            const counts = {};
            for (const item of inv) counts[item.name] = (counts[item.name] || 0) + 1;
            embed.setDescription(Object.entries(counts).map(([name, count]) => `• **${name}** × ${count}`).join('\n'));
        }
        return interaction.reply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /econrank ====================
    if (commandName === 'econrank') {
        const sorted = Object.entries(econ)
            .map(([id, u]) => ({ id, balance: u.balance || 0 }))
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 10);
        if (sorted.length === 0) return interaction.reply({ content: 'まだデータがありません。', ...EPH });
        await interaction.deferReply();
        const medals = ['🥇', '🥈', '🥉'];
        const lines = await Promise.all(sorted.map(async (u, i) => {
            let name = econ[u.id]?.username;
            if (!name) {
                const member = await guild?.members.fetch(u.id).catch(() => null);
                name = member?.user.username || `ID:${u.id}`;
            }
            return `${medals[i] || `**${i + 1}.**`} ${name} — **${u.balance.toLocaleString()}** ${CURRENCY}`;
        }));
        const embed = new EmbedBuilder()
            .setTitle(`${CURRENCY} 所持金ランキング`)
            .setColor(0xf1c40f)
            .setDescription(lines.join('\n'))
            .setTimestamp();
        return interaction.editReply({ embeds: [embed], components: [delBtn()] });
    }

    // ==================== /additem ====================
    if (commandName === 'additem') {
        const name = options.getString('name');
        const price = options.getInteger('price');
        const description = options.getString('description');
        const role = options.getRole('role');
        const shop = loadShop();
        const key = name.toLowerCase().replace(/\s+/g, '_');
        shop[key] = { name, price, description, roleId: role?.id || null };
        saveShop(shop);
        return interaction.reply({ content: `✅ **${name}** をショップに追加しました。価格: **${price.toLocaleString()}** ${CURRENCY}`, ...EPH });
    }

    // ==================== /removeitem ====================
    if (commandName === 'removeitem') {
        const name = options.getString('name');
        const shop = loadShop();
        const key = Object.keys(shop).find(k => shop[k].name.toLowerCase() === name.toLowerCase());
        if (!key) return interaction.reply({ content: `❌ **${name}** というアイテムは存在しません。`, ...EPH });
        const itemName = shop[key].name;
        delete shop[key];
        saveShop(shop);
        return interaction.reply({ content: `✅ **${itemName}** をショップから削除しました。`, ...EPH });
    }

    // ==================== /give ====================
    if (commandName === 'give') {
        const target = options.getUser('user');
        const amount = options.getInteger('amount');
        const u = getUser(econ, target.id, target);
        u.balance = Math.max(0, u.balance + amount);
        saveEcon(econ);
        const sign = amount >= 0 ? '+' : '';
        return interaction.reply({ content: `✅ <@${target.id}> の残高を **${sign}${amount.toLocaleString()}** ${CURRENCY} 変更しました。現在: **${u.balance.toLocaleString()}** ${CURRENCY}`, ...EPH });
    }
}

module.exports = { econCommands, handleEcon };
