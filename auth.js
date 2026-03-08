const axios = require('axios');
const fs = require('fs');
const path = require('path');

function setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET) {
    // 環境変数の REDIRECT_URI は https://maidbot-production-ae10.up.railway.app/auth を想定
    const REDIRECT_URI = process.env.REDIRECT_URI;

    // メインの認証・コールバック処理
    app.get('/auth', async (req, res) => {
        const code = req.query.code;

        // 1. 認可コードがない場合（通常のアクセス）はそのままHTMLを表示
        if (!code) {
            return res.sendFile(path.join(__dirname, 'auth.html'));
        }

        // 2. 認可コードがある場合（Discordからの戻り）はデータ保存処理を実行
        try {
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

            const { access_token, refresh_token } = tokenResponse.data;

            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            const users = loadData(USERS_FILE);
            const userData = userResponse.data;

            // ユーザー情報を保存
            users[userData.id] = {
                tag: `${userData.username}#${userData.discriminator || '0'}`,
                accessToken: access_token,
                refreshToken: refresh_token
            };
            
            saveData(USERS_FILE, users);

            // 処理完了後、提示された綺麗な auth.html を表示
            res.sendFile(path.join(__dirname, 'auth.html'));

        } catch (error) {
            console.error('OAuth2 Error:', error.response?.data || error.message);
            res.status(500).send('認証エラーが発生しました。Developer PortalのRedirect URI設定が /auth になっているか確認してください。');
        }
    });

    // ログインURLへのリダイレクト（必要であれば）
    app.get('/login', (req, res) => {
        const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
        res.redirect(url);
    });
}

module.exports = setupAuth;
