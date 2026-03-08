const axios = require('axios');
const fs = require('fs');
const path = require('path');

function setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET) {
    // 環境変数の REDIRECT_URI が https://.../auth になっている前提
    const REDIRECT_URI = process.env.REDIRECT_URI;

    // 認証ページ表示 兼 コールバック処理
    app.get('/auth', async (req, res) => {
        const code = req.query.code;

        // パラメータに code がない場合は、最初のアクセス（UI表示）とみなす
        if (!code) {
            return res.sendFile(path.join(__dirname, 'auth.html'));
        }

        // code がある場合は Discord から戻ってきた時の処理
        try {
            // トークン取得
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI, // ここが https://.../auth と一致している必要がある
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

            const { access_token, refresh_token } = tokenResponse.data;

            // ユーザー情報取得
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            const users = loadData(USERS_FILE);
            const userData = userResponse.data;

            // データを保存
            users[userData.id] = {
                tag: `${userData.username}#${userData.discriminator || '0'}`,
                accessToken: access_token,
                refreshToken: refresh_token
            };
            
            saveData(USERS_FILE, users);

            // 成功後に auth.html を表示（あるいは完了メッセージ）
            res.sendFile(path.join(__dirname, 'auth.html'));

        } catch (error) {
            console.error('OAuth2 Error:', error.response?.data || error.message);
            res.status(500).send('認証エラーが発生しました。');
        }
    });

    // ログインURLへのリダイレクト用（auth.html内のボタンから呼び出す用）
    app.get('/login', (req, res) => {
        const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
        res.redirect(url);
    });
}

module.exports = setupAuth;
