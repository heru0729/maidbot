const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * OAuth2認証のルーティングと処理を設定する
 * @param {import('express').Express} app 
 * @param {Function} loadData 
 * @param {Function} saveData 
 * @param {string} USERS_FILE 
 * @param {string} CLIENT_ID 
 * @param {string} CLIENT_SECRET 
 */
function setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET) {
    
    // Discordからのコールバックを受け取るエンドポイント
    app.get('/callback', async (req, res) => {
        const { code, state } = req.query;

        // 1. バリデーション
        if (!code || !state) {
            return res.status(400).send('エラー: 認証コードまたはステートが不足しています。');
        }

        // stateからguildIdとroleIdを抽出
        const [guildId, roleId] = state.split('_');

        if (!guildId || !roleId) {
            return res.status(400).send('エラー: 不正なステート形式です。');
        }

        try {
            // 2. アクセストークンの取得
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.REDIRECT_URI,
            }).toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const accessToken = tokenResponse.data.access_token;

            // 3. ユーザー情報の取得 (@me)
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            const userData = userResponse.data;
            const userId = userData.id;

            // 4. ユーザーデータの保存 (users.jsonの更新)
            const users = loadData(USERS_FILE);
            if (!users[userId]) {
                users[userId] = { xp: 0, lv: 0 };
            }
            users[userId].lastAuth = Date.now();
            users[userId].username = userData.username;
            saveData(USERS_FILE, users);

            // 5. ギルドへのメンバー追加、または既存メンバーへのロール付与
            // Botに「メンバーの管理」権限と「サーバーへの参加（guilds.join）」スコープが必要
            await axios.put(`https://discord.com/api/guilds/${guildId}/members/${userId}`, {
                access_token: accessToken,
                roles: [roleId]
            }, {
                headers: {
                    Authorization: `Bot ${process.env.TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            // 6. 成功時：指定された auth.html を返却する
            // path.joinでプロジェクトルートやpublicフォルダ等、適切なパスを指定してください
            const authHtmlPath = path.join(__dirname, 'auth.html'); 
            
            if (fs.existsSync(authHtmlPath)) {
                res.sendFile(authHtmlPath);
            } else {
                // ファイルが見つからない場合のフォールバック（デバッグ用）
                res.send('<h1>✅認証完了</h1><p>役職が付与されました。この画面を閉じてください。</p>');
            }

        } catch (error) {
            console.error('OAuth2 処理エラー:', error.response?.data || error.message);
            
            const errorMsg = error.response?.data?.message || '不明なエラー';
            res.status(500).send(`
                <body style="background:#000; color:white; padding:20px; font-family:sans-serif;">
                    <h2>認証プロセスに失敗しました</h2>
                    <p>原因: ${errorMsg}</p>
                    <p>Botの権限設定、またはロールの順位を確認してください。</p>
                </body>
            `);
        }
    });

    // auth.htmlを直接ブラウザで確認したい場合などの静的配信設定（任意）
    app.get('/auth', (req, res) => {
        const authHtmlPath = path.join(__dirname, 'auth.html');
        if (fs.existsSync(authHtmlPath)) {
            res.sendFile(authHtmlPath);
        } else {
            res.status(404).send('auth.html が見つかりません。');
        }
    });
}

module.exports = setupAuth;
