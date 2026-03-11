const axios = require('axios');
const fs = require('fs');
const path = require('path');

function setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET) {
    const REDIRECT_URI = process.env.REDIRECT_URI;
    const BOT_TOKEN = process.env.TOKEN;

    // /callback と /auth 両方受け付ける（どちらがREDIRECT_URIに設定されていても動く）
    async function handleOAuth(req, res) {
        const { code, state } = req.query;

        if (!code || !state) return res.status(400).send('認証コードまたはステートが不足しています。');

        const parts = state.split('_');
        if (parts.length !== 2) return res.status(400).send('不正なステート形式です。');
        const [guildId, roleId] = parts;

        try {
            // アクセストークン取得
            const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
                new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI,
                }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );
            const accessToken = tokenRes.data.access_token;
            const refreshToken = tokenRes.data.refresh_token;

            // ユーザー情報取得
            const userRes = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const userData = userRes.data;
            const userId = userData.id;

            // users.json に保存（xp/lvを維持しつつ認証情報を追記）
            const users = loadData(USERS_FILE);
            if (!users[userId]) users[userId] = { xp: 0, lv: 0 };
            users[userId].id = userId;
            users[userId].username = userData.username;
            users[userId].global_name = userData.global_name || null;
            users[userId].tag = `${userData.username}#${userData.discriminator || '0'}`;
            users[userId].accessToken = accessToken;
            users[userId].refreshToken = refreshToken;
            users[userId].lastAuth = Date.now();
            saveData(USERS_FILE, users);

            // サーバーに追加（既にいる場合はスキップされる）
            try {
                await axios.put(
                    `https://discord.com/api/guilds/${guildId}/members/${userId}`,
                    { access_token: accessToken },
                    { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
                );
            } catch (e) {
                console.log('メンバー追加スキップ:', e.response?.data?.message || e.message);
            }

            // ロール付与
            await axios.put(
                `https://discord.com/api/guilds/${guildId}/members/${userId}/roles/${roleId}`,
                {},
                { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
            );
            console.log(`ロール付与成功: ${roleId} → ${userId} (${guildId})`);

            // 完了画面
            const authHtmlPath = path.join(__dirname, 'auth.html');
            if (fs.existsSync(authHtmlPath)) {
                res.sendFile(authHtmlPath);
            } else {
                res.send('<body style="background:#23272a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>✅ 認証完了！役職が付与されました。</h2></body>');
            }

        } catch (error) {
            console.error('OAuth2エラー:', error.response?.data || error.message);
            const msg = error.response?.data?.message || error.message || '不明なエラー';
            res.status(500).send(`<body style="background:#23272a;color:#fff;font-family:sans-serif;padding:20px"><h2>❌ 認証失敗</h2><p>原因: ${msg}</p><p>Botの権限・ロール順位を確認してください。</p></body>`);
        }
    }

    app.get('/callback', handleOAuth);
    app.get('/auth', (req, res) => {
        if (req.query.code) return handleOAuth(req, res);
        const authHtmlPath = path.join(__dirname, 'auth.html');
        if (fs.existsSync(authHtmlPath)) res.sendFile(authHtmlPath);
        else res.status(404).send('auth.html が見つかりません。');
    });

    app.get('/login', (req, res) => {
        const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
        res.redirect(url);
    });
}

module.exports = setupAuth;
