const request = require('request-promise');
const {createEventAdapter} = require('@slack/events-api');
const {WebClient} = require('@slack/web-api');
const Discord = require('discord.js');
const secrets = require('./secrets');

const slackClient = new WebClient(secrets.slack.clientToken);
const slackEvents = createEventAdapter(secrets.slack.signingSecret);
const discordWebHook = new Discord.WebhookClient(secrets.discord.webhook.id, secrets.discord.webhook.token);
const discordClient = new Discord.Client();
const LOG_ONLY = false;
const port = process.env.PORT || 3000;
const slackUserCache = {};

slackEvents.on('message', OnSlackMessage);
slackEvents.on('error', console.error);

discordClient.on('ready', () => console.log('Logged into discord'));
discordClient.on('message', onDiscordMessage);

async function onDiscordMessage(message) {
    try {
        if (message.author.bot === true)
            return;
        if (message.channel.name !== 'general')
            return;

        const payload = {
            "channel": "#general",
            "username": message.author.username,
            "text": message.cleanContent,
            "icon_url": message.author.avatarURL
        };
        console.log(`Discord -  @${message.author.username}: ${message.cleanContent}`);
        if (LOG_ONLY) return;
        await request({
            url: secrets.slack.webhook,
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            json: payload
        });

    } catch (e) {
        console.error(e)
    }

}

async function OnSlackMessage(event) {
    try {
        if (event.subtype)
            return;

        const user = await getSlackProfile(event.user);
        const name = user.profile.display_name_normalized;
        const avatar = user.profile.image_192;
        const message = await normaliseSlackMessage(event.text);

        console.log(`Slack -  ${event.channel} @${name}: ${message}`);
        if (event.channel !== secrets.slack.generalId)
            return;

        if (LOG_ONLY) return;
        await discordWebHook.send(message, {
            username: name,
            avatarURL: avatar
        });
    } catch (e) {
        console.error(e)
    }
}

async function getSlackProfile(id) {
    if (slackUserCache[id])
        return slackUserCache[id];
    const user = await slackClient.users.profile.get({user: id});
    slackUserCache[id] = user;
    return user;
}

async function normaliseSlackMessage(slackMessage) {

    const channelRegex = /<#(?:.+?)\|([a-z0-9_-]{1,})>/g;
    const usernameRegex = /<@(.+?)>/g;

    // channel names can't contain [&<>]
    let cleanText = slackMessage.replace(channelRegex, "#$1");

    const userMatches = [];
    let match;
    while ((match = usernameRegex.exec(cleanText)) != null) {
        userMatches.push(match);
    }
    // Matches is array of ["<@userid>", "userid"]
    // We want to map to array of {match: ["<@userid>", "userid"], name: "user name"}

    const matchPromises = [];
    for (const userMatch of userMatches) {
        matchPromises.push(resolveSlackUserReplacement(userMatch));
    }
    const userReplacements = await Promise.all(matchPromises);
    for (const replacement of userReplacements) {
        cleanText = cleanText.replace(replacement.match[0], `@${replacement.username}`);
    }

    // /g is important.
    cleanText = cleanText.replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
    return cleanText;
}

async function resolveSlackUserReplacement(match) {
    const user = await getSlackProfile(match[1]);
    return {
        match: match,
        username: user.profile.display_name_normalized
    };
}


(async () => {
    try {
        const server = await slackEvents.start(port);
        console.log(`Listening for slack events on ${server.address().port}`);
        await discordClient.login(secrets.discord.clientToken);
        console.log('connected to discord');
    } catch (e) {
        console.error(e)
    }
})();



