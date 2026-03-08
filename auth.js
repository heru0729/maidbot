const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

// Railway Variables から「その他4個」を取得
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const PORT = process.env.PORT || 3000;

const USERS_FILE = path.join(__dirname, 'data', 'users.json');

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 4));
}

app.get('/login', (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.join`;
    res.redirect(url);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('No code provided');

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
            headers: { authorization: `Bearer ${access_token}` }
        });

        const users = loadUsers();
        users[userResponse.data.id] = {
            username: userResponse.data.username,
            accessToken: access_token,
            refreshToken: refresh_token
        };
        saveUsers(users);

        res.sendFile(path.join(__dirname, 'auth.html'));
    } catch (error) {
        console.error(error);
        res.send('認証エラーが発生しました。');
    }
});

app.listen(PORT, () => console.log(`Auth server running on port ${PORT}`));
