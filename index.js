//==================================================================
/// Created by Davide Pasca - 2023/09/11
//==================================================================

require('dotenv/config')
const { Client } = require('discord.js')
const { ChannelType } = require('discord.js');
const { OpenAI } = require('openai')

const client = new Client({
    intents: ['Guilds', 'GuildMembers', 'GuildMessages', 'MessageContent']
});

// Prefix to ignore messages
const IGNORE_PREFIX = '!'
// Channels to listen to
const CHANNELS = ['general', 'test0', 'test1', 'test2', 'test3']
// System prompt (sets the tone for the conversation)
const SYSTEM_PROMPT_CHARACTER =
'You are a skillful highly logical assistant that \
goes straight to the point, with a tiny bit of occasional sarcasm.';
const SYSTEM_PROMPT_FIXED_FORMAT =
'You are operating in a forum, where multiple users can interact with you. \
Most messages will include a header (metadata) at the start with the format \
$$HEADER_BEGIN$$ CURTIME:<timestamp>, FROM:<username>, TO:<username>, $$HEADER_END$$ \
Additional fields may be present in the header for added context. \
Never generate the header yourself. \
Given the context, you should determine if you need to reply to a message. \
You should also determine if a message should have a direct mention to a user, \
to resolve any ambiguity, like when other users are involved in the discussion. \
When mentioning a user, use its plain name, do not use metadata format outside of the header. \
If you don\'t wish to reply to a message, just produce empty content. \
';

// Initialize the OpenAI API, using the API key from the .env file
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

//==================================================================
// All this is to keep track of the number of members, so that we can
//  deduce if the bot is alone with 1 user and doesn't need a mention

// Initialize a Map to hold guild IDs and their respective member counts
const guildMemberCounts = new Map();

// Fetch initial member counts when the bot is ready
client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Your member-fetching logic here
    client.guilds.cache.forEach(async guild => {
        try {
            await guild.members.fetch();
            //const memberCount = guild.members.cache.filter(member => !member.user.bot).size;
            const memberCount = guild.members.cache.size;
            console.log(`Fetched ${memberCount} members for guild ${guild.name}`);
            guildMemberCounts.set(guild.id, memberCount);
        } catch (error) {
            console.error(`Failed to fetch members for guild ${guild.name}: ${error}`);
        }
    });
});

// Update the member count when a new member joins a guild
client.on('guildMemberAdd', member => {
    if (!member.user.bot) {
        const currentCount = guildMemberCounts.get(member.guild.id) || 0;
        guildMemberCounts.set(member.guild.id, currentCount + 1);
    }
});

// Update the member count when a member leaves a guild
client.on('guildMemberRemove', member => {
    if (!member.user.bot) {
        const currentCount = guildMemberCounts.get(member.guild.id) || 0;
        guildMemberCounts.set(member.guild.id, Math.max(0, currentCount - 1));
    }
});

//==================================================================
function doCleanUsername(username) {
    // Clean up the username, because OpenAI doesn't like special characters
    return username.replace(/\s+/g, '_').replace(/[^\w\s]/gi, '');
}

//==================================================================
client.on('messageCreate', async (message) => {
    // Debugging: Print the entire map
    console.log('Debug: guildMemberCounts', [...guildMemberCounts]);

    // Ignore messages from bots
    if (message.author.bot) return;

    // Ignore messages that are not in the list of channels
    if (!CHANNELS.includes(message.channel.name)) return;

    // Ignore messages that start with the ignore prefix
    // unless they mention this bot
    if (message.content.startsWith(IGNORE_PREFIX) &&
        !message.mentions.has(client.user.id)) return;

    // Simulate typing
    await message.channel.sendTyping();
    const sendTypingInterval = setInterval(async () => {
        message.channel.sendTyping();
    }, 5000);

    // Create the conversation
    let conversation = [];
    // Add the initial message
    conversation.push({
        role: 'system',
        content: SYSTEM_PROMPT_CHARACTER + '\n' + SYSTEM_PROMPT_FIXED_FORMAT,
    });

    // Variable to hold the ID of the last user who sent a message
    let lastUserId = null;

    // Fetch the last 10 messages
    let prevMessages = await message.channel.messages.fetch({ limit: 10 });
    // Reverse the messages so they are in chronological order
    prevMessages.reverse();
    prevMessages.forEach((msg) => {
        // Update the last user ID
        lastUserId = msg.author.id;

        // Ignore messages from bots, except this one
        if (msg.author.bot && msg.author.id !== client.user.id) return;

        // Get the current UTC time in ISO 8601 format
        let timestampField = msg.createdAt.toISOString();
        let fromField = doCleanUsername(msg.author.username);

        // Determine the "to" field if it's obvious
        let toField = '';
        let contentNoMentionPrefix = msg.content;
        // Remove the mention prefix if it exists
        if (contentNoMentionPrefix.startsWith(`<@!${client.user.id}>`)) {
            contentNoMentionPrefix = contentNoMentionPrefix.substring(`<@!${client.user.id}>`.length);
            toField = doCleanUsername(client.user.username);
        }

        // Ignore messages that start with the ignore prefix
        if (contentNoMentionPrefix.startsWith(IGNORE_PREFIX)) return;

        // Integrate the timestamp into the message content
        let finalContent = '$$HEADER_BEGIN$$';
        finalContent += ` CURTIME:${timestampField},`;
        finalContent += ` FROM:${fromField},`;
        if (toField !== '') {
            finalContent += ` TO:${toField},`;
        }
        finalContent += ' $$HEADER_END$$';

        finalContent += ' ' + contentNoMentionPrefix;

        // Add the message to the conversation array
        conversation.push({
            role: (msg.author.id === client.user.id) ? 'assistant' : 'user',
            //name: cleanUsername,
            content: finalContent,
        });
    });

    console.log('Conversation:', conversation);

    // Respond to the message
    const response = await openai.chat.completions.create({
        model: 'gpt-4',
        //engine: 'gpt-3.5-turbo',
        messages: conversation,
    }).catch((err) => {
        console.error('OpenAI API Error:\n', err)
    });

    // Stop simulating typing
    clearInterval(sendTypingInterval);

    // If there is no response, send an error message
    if (!response) {
        message.reply('Can\'t produce a response. Please try again later.');
        return;
    }

    console.log('Response:', response);
    console.log('Response content:', response.choices[0].message.content);

    // Remove the $$HEADER$$ and $$END_HEADER$$ tags and anything in between
    // because the model may have generated them
    let cleanResponseMsg =
        response.choices[0].message.content.replace(/\$\$HEADER\$\$.*\$\$END_HEADER\$\$/g, '');


    const chunkSize = 2000; // Discord message character limit

    // Maybe some day, if we implement long delays for replies
    const shouldMentionUser = false;

    for (let i = 0; i < cleanResponseMsg.length; i += chunkSize) {
        const chunk = cleanResponseMsg.substring(i, i + chunkSize);
        const replyText = shouldMentionUser ? `<@${message.author.id}> ${chunk}` : chunk;
        await message.channel.send(replyText);
    }
});

//==================================================================
// Login to Discord with the bot token
client.login(process.env.DISCORD_TOKEN);

