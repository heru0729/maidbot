const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');

// 環境変数
const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, TOKEN } = process.env;

// JSONファイルパス
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');

// JSONロード関数
function loadJSON(filePath, defaultValue) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch {
        return defaultValue;
    }
}

// JSON保存関数
function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

// Expressアプリを返す関数
module.exports = (app) => {
    app.get('/callback', async (req, res) => {
        const { code, state } = req.query;
        if (!code || !state) return res.status(400).send("認証エラー: code または state が不足しています。");

        try {
            // Discordからアクセストークン取得
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

            const accessToken = tokenResponse.data.access_token;

            // Discordユーザー情報取得
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const user = userResponse.data;

            // users.jsonに保存
            const usersData = loadJSON(USERS_FILE, {});
            usersData[user.id] = { id: user.id, username: user.username };
            saveJSON(USERS_FILE, usersData);

            // サーバーのロール付与
            const serversData = loadJSON(SERVERS_FILE, {});
            const roleId = serversData[state]?.roleId;
            if (roleId) {
                await axios.put(`https://discord.com/api/v10/guilds/${state}/members/${user.id}`, {
                    access_token: accessToken,
                    roles: [roleId]
                }, {
                    headers: { Authorization: `Bot ${TOKEN}` }
                });
            }

            // 認証完了ページ表示
            let html = fs.readFileSync(path.join(__dirname, 'auth.html'), 'utf8');
            res.send(html);

        } catch (error) {
            console.error("Auth Callback Error:", error.response?.data || error.message);
            res.status(500).send("認証プロセスでエラーが発生しました。");
        }
    });
};
