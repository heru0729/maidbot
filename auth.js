const axios = require('axios');
const fs = require('fs');
const path = require('path');

function setupAuth(app, loadData, saveData, USERS_FILE, CLIENT_ID, CLIENT_SECRET) {

    const REDIRECT_URI = process.env.REDIRECT_URI;
    const BOT_TOKEN = process.env.TOKEN;
    const SERVERS_FILE = path.join(__dirname, 'data', 'servers.json');

    app.get('/auth', async (req, res) => {

        const code = req.query.code;
        const state = req.query.state;

        if (!code) {
            return res.sendFile(path.join(__dirname, 'auth.html'));
        }

        if (!state) {
            return res.status(400).send('state missing');
        }

        const stateParts = state.split('_');

        if (stateParts.length !== 2) {
            return res.status(400).send('invalid state');
        }

        const guildId = stateParts[0];
        const roleId = stateParts[1];

        try {

            const tokenResponse = await axios.post(
                'https://discord.com/api/oauth2/token',
                new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: REDIRECT_URI
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            const access_token = tokenResponse.data.access_token;
            const refresh_token = tokenResponse.data.refresh_token;

            const userResponse = await axios.get(
                'https://discord.com/api/users/@me',
                {
                    headers: {
                        Authorization: `Bearer ${access_token}`
                    }
                }
            );

            const userData = userResponse.data;
            const userId = userData.id;

            const users = loadData(USERS_FILE);

            if (!users[userId]) {
                users[userId] = {
                    xp: 0,
                    lv: 0
                };
            }

            users[userId].id = userId;
            users[userId].username = userData.username;
            users[userId].global_name = userData.global_name;
            users[userId].tag = `${userData.username}#${userData.discriminator || '0'}`;
            users[userId].accessToken = access_token;
            users[userId].refreshToken = refresh_token;

            saveData(USERS_FILE, users);

            const servers = loadData(SERVERS_FILE);

            if (!servers[guildId]) {
                return res.status(400).send('server not registered');
            }

            try {

                await axios.put(
                    `https://discord.com/api/guilds/${guildId}/members/${userId}`,
                    {
                        access_token: access_token
                    },
                    {
                        headers: {
                            Authorization: `Bot ${BOT_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

            } catch (err) {
                console.log('Member add skipped or failed:', err.response?.data || err.message);
            }

            try {

                await axios.put(
                    `https://discord.com/api/guilds/${guildId}/members/${userId}/roles/${roleId}`,
                    {},
                    {
                        headers: {
                            Authorization: `Bot ${BOT_TOKEN}`
                        }
                    }
                );

                console.log(`Role assigned: ${roleId} to ${userId} in ${guildId}`);

            } catch (err) {

                console.error(
                    `Failed to assign role in ${guildId}:`,
                    err.response?.data || err.message
                );
            }

            res.sendFile(path.join(__dirname, 'auth.html'));

        } catch (error) {

            console.error(
                'OAuth2 Error:',
                error.response?.data || error.message
            );

            res.status(500).send('認証エラーが発生しました。');

        }

    });

    app.get('/login', (req, res) => {

        const url =
            `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}` +
            `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
            `&response_type=code` +
            `&scope=identify%20guilds.join`;

        res.redirect(url);

    });

}

module.exports = setupAuth;
