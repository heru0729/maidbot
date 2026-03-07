\const {
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
  MessageFlags, // 警告対応
} = require("discord.js");
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ── 設定読み込み (Railwayの環境変数から取得) ──────────────────
console.log("BOT starting...");

// Railwayの「Variables」に設定した値を使用。不足時はエラーを出す。
const config = {
  TOKEN: process.env.TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  CLIENT_SECRET: process.env.CLIENT_SECRET,
  REDIRECT_URI: process.env.REDIRECT_URI,
  OWNER_ID: process.env.OWNER_ID,
  PORT: process.env.PORT || 3000
};

if (!config.TOKEN || !config.CLIENT_ID || !config.OWNER_ID) {
  console.error("❌ 必須な環境変数が不足しています (TOKEN, CLIENT_ID, OWNER_IDを確認してください)");
  process.exit(1);
}

const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, PORT, OWNER_ID } = config;
console.log("Authorized OWNER_ID:", OWNER_ID);

// ── データ管理 (JSON) ───────────────────────────────────────
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
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (err) { console.error("Save Error:", err.message); }
}

// ── スラッシュコマンド定義 ────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("authset")
    .setDescription("認証パネルをこのチャンネルに送信します")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("コマンド一覧を表示します"),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ── Discord BOT ───────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once("clientReady", async () => {
  console.log(`✅ BOT login: ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("スラッシュコマンド登録完了");
  } catch (err) {
    console.error("登録失敗:", err.message);
  }
});

// ── インタラクション処理 ────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "authset") {
    const selectMenu = new RoleSelectMenuBuilder()
      .setCustomId("authset_role_select")
      .setPlaceholder("付与するロールを選択（任意）")
      .setMinValues(0)
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.reply({
      content: "認証パネルに設定するロールを選択してください。",
      components: [row],
      flags: [MessageFlags.Ephemeral], // 警告対応
    });
    return;
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === "authset_role_select") {
    const role = interaction.roles.first() ?? null;
    if (role) {
      const guilds = loadJSON(GUILDS_FILE, {});
      guilds[interaction.guild.id] = role.id;
      saveJSON(GUILDS_FILE, guilds);
    }

    const authUrl = `https://discord.com/api/oauth2/authorize?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "identify guilds.join",
    })}`;

    const embed = new EmbedBuilder()
      .setTitle("🔐 サーバー認証")
      .setDescription(`下のボタンを押して認証を完了してください。${role ? `\n\n付与ロール: ${role}` : ""}`)
      .setColor(0x5865f2);

    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("認証する").setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji("🔗")
    );

    await interaction.channel.send({ embeds: [embed], components: [btnRow] });
    await interaction.update({ content: "✅ 認証パネルを送信しました。", components: [] });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📖 コマンド一覧")
      .addFields({ name: "管理者", value: "`/authset` - パネル設置\n`!call` - 復元実行\n`!userlist` - ユーザー確認" })
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  }
});

// ── テキストコマンド (!userlist, !call) ────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.id !== OWNER_ID || message.author.bot) return;

  const users = loadJSON(USERS_FILE, []);

  if (message.content === "!userlist") {
    const lines = users.length === 0 ? ["認証ユーザーなし"] : users.map(u => `• <@${u.id}> (${u.id})`);
    const embed = new EmbedBuilder().setTitle(`📋 ユーザー一覧 (${users.length}人)`).setDescription(lines.join("\n")).setColor(0x5865f2);
    return message.reply({ embeds: [embed] });
  }

  if (message.content === "!call") {
    const roleId = loadJSON(GUILDS_FILE, {})[message.guild.id];
    const status = await message.reply(`⏳ ${users.length}人を追加中...`);

    let s = 0, a = 0, f = 0;
    for (const user of users) {
      try {
        const res = await axios.put(`https://discord.com/api/v10/guilds/${message.guild.id}/members/${user.id}`,
          { access_token: user.token, ...(roleId ? { roles: [roleId] } : {}) },
          { headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" } }
        );
        res.status === 201 ? s++ : a++;
      } catch { f++; }
    }
    await status.edit(`✅ 完了: 追加 ${s}人 / 既存 ${a}人 / 失敗 ${f}人`);
  }
});

// ── OAuth2 Callback ──
const app = express();
app.get("/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No Code.");
  try {
    const tRes = await axios.post("https://discord.com/api/oauth2/token", new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI
    }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

    const uRes = await axios.get("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${tRes.data.access_token}` } });
    
    const users = loadJSON(USERS_FILE, []);
    const idx = users.findIndex(u => u.id === uRes.data.id);
    const data = { id: uRes.data.id, token: tRes.data.access_token };
    if (idx !== -1) users[idx] = data; else users.push(data);
    saveJSON(USERS_FILE, users);

    res.send("<body style='background:#36393f;color:white;text-align:center;padding-top:100px;font-family:sans-serif;'><h2>✅ 認証完了</h2><p>Discordに戻ってください。</p></body>");
  } catch (err) { res.status(500).send("Auth Error."); }
});

app.listen(PORT, () => console.log(`OAuth server running on ${PORT}`));
client.login(TOKEN);
