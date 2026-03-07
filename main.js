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
} = require("discord.js");
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ── 設定読み込み ──────────────────────────────────────────────
console.log("BOT starting...");

function loadDataTxt(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    result[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return result;
}

let config;
try {
  if (fs.existsSync("./data.txt")) {
    config = loadDataTxt("./data.txt");
    console.log("CONFIG loaded (data.txt)");
  } else {
    config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
    console.log("CONFIG loaded (config.json)");
  }
} catch (err) {
  console.error("設定ファイルの読み込みに失敗しました:", err.message);
  process.exit(1);
}

const { TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, PORT, OWNER_ID } = config;
console.log("OWNER_ID:", OWNER_ID);

// ── users.json ヘルパー ───────────────────────────────────────
const USERS_FILE = path.join(__dirname, "data", "users.json");

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch { return []; }
}

function saveUser(id, token) {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx !== -1) users[idx].token = token;
  else users.push({ id, token });
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
  console.log(`[users.json] 保存完了 uid=${id}`);
}

// ── guilds.json: サーバーごとのロールID保存 ──────────────────
// { "GUILD_ID": "ROLE_ID", ... }
const GUILDS_FILE = path.join(__dirname, "data", "guilds.json");

function loadGuilds() {
  try {
    if (!fs.existsSync(GUILDS_FILE)) return {};
    return JSON.parse(fs.readFileSync(GUILDS_FILE, "utf8"));
  } catch { return {}; }
}

function saveGuildRole(guildId, roleId) {
  const guilds = loadGuilds();
  guilds[guildId] = roleId;
  fs.mkdirSync(path.dirname(GUILDS_FILE), { recursive: true });
  fs.writeFileSync(GUILDS_FILE, JSON.stringify(guilds, null, 2), "utf8");
  console.log(`[guilds.json] 保存完了 guild=${guildId} role=${roleId}`);
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
  console.log(`BOT login: ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("スラッシュコマンド登録完了");
  } catch (err) {
    console.error("スラッシュコマンド登録失敗:", err.message);
  }
});

// ── スラッシュコマンド & セレクトメニュー処理 ─────────────────
client.on("interactionCreate", async (interaction) => {

  // /authset → ロール選択メニューを ephemeral で表示
  if (interaction.isChatInputCommand() && interaction.commandName === "authset") {
    const selectMenu = new RoleSelectMenuBuilder()
      .setCustomId("authset_role_select")
      .setPlaceholder("付与するロールを選択（任意）")
      .setMinValues(0)
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      content: "認証パネルに設定するロールを選択してください。\nロールなしで送信する場合はそのまま送信ボタンを押してください。",
      components: [row],
      ephemeral: true,
    });
    return;
  }

  // ロール選択後の処理
  if (interaction.isRoleSelectMenu() && interaction.customId === "authset_role_select") {
    const role = interaction.roles.first() ?? null;

    if (role) {
      saveGuildRole(interaction.guild.id, role.id);
    }

    const authUrl = `https://discord.com/api/oauth2/authorize?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "identify guilds.join",
    })}`;

    const embed = new EmbedBuilder()
      .setTitle("🔐 サーバー認証")
      .setDescription(
        "下のボタンを押して認証を完了してください。\n認証後、管理者がサーバーへ追加します。" +
        (role ? `\n\n認証後のロール: ${role}` : "")
      )
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("認証する")
        .setStyle(ButtonStyle.Link)
        .setURL(authUrl)
        .setEmoji("🔗")
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.update({ content: "✅ 認証パネルを送信しました。", components: [] });
    console.log(`[/authset] guild=${interaction.guild.id} role=${role?.id ?? "なし"}`);
    return;
  }

  // /help
  if (interaction.isChatInputCommand() && interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📖 コマンド一覧")
      .setColor(0x5865f2)
      .addFields({
        name: "コマンド",
        value: "`/authset` - 認証パネルを送信",
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
});

// ── テキストコマンド処理 ──────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const cmd = message.content.trim();

  // ── !userlist: OWNER_IDのみ ───────────────────────────────
  if (cmd === "!userlist") {
    if (message.author.id !== OWNER_ID) return;

    const users = loadUsers();
    if (users.length === 0) {
      return message.reply("📋 認証済みユーザーはいません。");
    }

    const lines = [];
    for (const user of users) {
      try {
        const u = await client.users.fetch(user.id);
        lines.push(`• ${u.tag} (${user.id})`);
      } catch {
        lines.push(`• 不明 (${user.id})`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 認証済みユーザー一覧 (${users.length} 人)`)
      .setDescription(lines.join("\n"))
      .setColor(0x5865f2);

    return message.reply({ embeds: [embed] });
  }

  // ── !call: OWNER_IDのみ ───────────────────────────────────
  if (cmd === "!call") {
    if (message.author.id !== OWNER_ID) return;

    const users = loadUsers();
    if (users.length === 0) {
      return message.reply("❌ `data/users.json` にユーザーがいません。");
    }

    const guildId = message.guild.id;

    // /authset で設定したロールIDを取得
    const guilds = loadGuilds();
    const roleId = guilds[guildId] ?? null;

    const status = await message.reply(
      `⏳ ${users.length} 人をサーバーへ追加中...${roleId ? ` (ロール: <@&${roleId}>)` : ""}`
    );

    let success = 0;
    let already = 0;
    let failed = 0;

    for (const user of users) {
      try {
        const res = await axios.put(
          `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
          {
            access_token: user.token,
            ...(roleId ? { roles: [roleId] } : {}),
          },
          {
            headers: {
              Authorization: `Bot ${TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        if (res.status === 201) {
          success++;
        } else if (res.status === 204) {
          // 既にメンバーの場合、ロールだけ付与
          if (roleId) {
            await axios.put(
              `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}/roles/${roleId}`,
              {},
              { headers: { Authorization: `Bot ${TOKEN}` } }
            );
          }
          already++;
        }
      } catch (err) {
        console.error(`[!call] ❌ uid=${user.id}`, err.response?.data ?? err.message);
        failed++;
      }
    }

    await status.edit(
      `✅ **!call 完了**\n` +
      `> 新規追加: **${success}** 人\n` +
      `> 既にメンバー: **${already}** 人\n` +
      `> 失敗: **${failed}** 人`
    );
    return;
  }
});

// ── OAuth2 コールバックサーバー ───────────────────────────────
const app = express();

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("認証コードがありません");

  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) {
      console.error("[callback] access_token 取得失敗:", tokenRes.data);
      return res.status(500).send("access_token の取得に失敗しました");
    }

    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const userId = userRes.data.id;
    const username = userRes.data.username;
    console.log(`[callback] 認証完了: ${username} (${userId})`);

    saveUser(userId, accessToken);

    res.send(`
      <!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <title>認証完了</title>
        <style>
          body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #36393f; color: #fff; }
          .box { text-align: center; background: #2f3136; padding: 40px; border-radius: 12px; }
          h2 { color: #57f287; }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>✅ 認証完了</h2>
          <p><strong>${username}</strong> さんの認証が完了しました。</p>
          <p>このページは閉じて構いません。</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("[callback] エラー:", err.response?.data ?? err.message);
    res.status(500).send("認証処理中にエラーが発生しました");
  }
});

const listenPort = PORT || 3000;
app.listen(listenPort, () => {
  console.log(`OAuth server start (port: ${listenPort})`);
});

client.login(TOKEN);