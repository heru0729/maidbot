const axios = require('axios');
const fs = require('fs');
const path = require('path');

function setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET) {
    const REDIRECT_URI = process.env.REDIRECT_URI;
    const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json'); // 追加

    app.get('/auth', async (req, res) => {
        const code = req.query.code;

        if (!code) {
            return res.sendFile(path.join(__dirname, 'auth.html'));
        }

        try {
            // 1. アクセストークンの取得
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

            const { access_token, refresh_token } = tokenResponse.data;

            // 2. ユーザー情報の取得
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            const users = loadData(USERS_FILE);
            const userData = userResponse.data;
            const userId = userData.id;

            // ユーザー情報を保存
            users[userId] = {
                tag: `${userData.username}#${userData.discriminator || '0'}`,
                accessToken: access_token,
                refreshToken: refresh_token
            };
            saveData(USERS_FILE, users);

            // --- 3. 【重要】ロール付与の自動実行 ---
            const servers = loadData(SERVERS_FILE);
            
            // 連携ボタンが押されたサーバー（ギルド）を特定してロールを付与
            // ※OAuth2の state パラメータを使わない簡易版として、全サーバー設定を確認
            for (const guildId in servers) {
                const roleId = servers[guildId].authRole;
                if (roleId) {
                    try {
                        // Discord API でロールを付与 (PUT メソッド)
                        await axios.put(
                            `https://discord.com/api/guilds/${guildId}/members/${userId}/roles/${roleId}`,
                            {},
                            { headers: { Authorization: `Bot ${process.env.TOKEN}` } }
                        );
                        console.log(`Role assigned: ${roleId} to ${userId} in ${guildId}`);
                    } catch (e) {
                        console.error(`Failed to assign role in ${guildId}:`, e.response?.data || e.message);
                    }
                }
            }

            res.sendFile(path.join(__dirname, 'auth.html'));

        } catch (error) {
            console.error('OAuth2 Error:', error.response?.data || error.message);
            res.status(500).send('認証エラーが発生しました。');
        }
    });

    app.get('/login', (req, res) => {
        const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
        res.redirect(url);
    });
}

module.exports = setupAuth;
