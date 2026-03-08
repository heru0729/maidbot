const axios = require('axios');
const fs = require('fs');
const path = require('path');

// main.jsから呼び出される関数
function setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET) {
    const REDIRECT_URI = process.env.REDIRECT_URI;

    // 認証ページ（UI）の表示
    app.get('/auth', (req, res) => {
        res.sendFile(path.join(__dirname, 'auth.html'));
    });

    // ログインURLへのリダイレクト
    app.get('/login', (req, res) => {
        const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
        res.redirect(url);
    });

    // 認証後の処理 (コールバック)
    app.get('/callback', async (req, res) => {
        const code = req.query.code;
        if (!code) return res.status(400).send('No code provided');

        try {
            // トークン取得
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

            const { access_token, refresh_token } = tokenResponse.data;

            // ユーザー情報取得
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            const users = loadData(USERS_FILE);
            const userData = userResponse.data;

            // 名前(username)とIDを紐づけて保存
            users[userData.id] = {
                tag: `${userData.username}#${userData.discriminator || '0'}`, // 名前を保存
                accessToken: access_token,
                refreshToken: refresh_token
            };
            
            saveData(USERS_FILE, users);

            // 最後にauth.htmlを表示
            res.sendFile(path.join(__dirname, 'auth.html'));

        } catch (error) {
            console.error('OAuth2 Error:', error.response?.data || error.message);
            res.status(500).send('認証エラーが発生しました。');
        }
    });
}

module.exports = setupAuth;
