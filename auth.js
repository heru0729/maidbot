const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 環境変数を取得
const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, TOKEN } = process.env;

module.exports = (app, loadJSON, saveJSON, AUTH_USERS_FILE, GUILDS_FILE) => {
    
    app.get('/callback', async (req, res) => {
        const { code, state } = req.query;
        
        // 1. 必要なデータが揃っているか確認
        if (!code || !state) {
            return res.status(400).send("認証エラー: code または state が不足しています。");
        }

        try {
            // 2. Discord APIに「合言葉(code)」を渡して「アクセストークン」を貰う
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const accessToken = tokenResponse.data.access_token;

            // 3. アクセストークンを使って「誰が認証したか」を確認
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            const user = userResponse.data;

            // 4. 連携済みユーザーリストに保存（!userlist用）
            const authData = loadJSON(AUTH_USERS_FILE, {});
            authData[user.id] = { id: user.id, username: user.username };
            saveJSON(AUTH_USERS_FILE, authData);

            // 5. 役職(ロール)の付与を実行
            const guildsData = loadJSON(GUILDS_FILE, {});
            const roleId = guildsData[state]?.roleId;

            if (roleId) {
                await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${user.id}`, {
                    access_token: accessToken,
                    roles: [roleId]
                }, {
                    headers: { Authorization: `Bot ${TOKEN}` }
                });
            }

            // 6. デザインされたHTMLファイルを読み込んで表示
            let html = fs.readFileSync(path.join(__dirname, 'auth.html'), 'utf8');
            
            // HTML内の変数を実際の値に書き換える
            html = html.replace(/{{CLIENT_ID}}/g, CLIENT_ID);
            
            res.send(html);

        } catch (error) {
            console.error("Auth Callback Error:", error.response?.data || error.message);
            res.status(500).send("認証プロセスでエラーが発生しました。");
        }
    });
};
