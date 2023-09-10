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
const CHANNELS = ['general', 'bots']
// System prompt (sets the tone for the conversation)
const SYSTEM_PROMPT = 'You are a skillful assistant that \
goes straight to the point and with an occasional touch of sarcasm.';

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
function isMessageForBot(client, message) {
    // Direct mention
    if (message.mentions.has(client.user.id))
        return true;

    // Get the member count for the guild from our Map
    let memberCount = 0;
    if (message.channel.type === ChannelType.GuildText) {
        //console.log("Debug: message.guild.id: ", message.guild.id);  // Debug line
        memberCount = guildMemberCounts.get(message.guild.id) || 0;
    }
    else
    if (message.channel.type === ChannelType.DM) {
        memberCount = 2;
    }

    // Do nothing if there are more than 2 members in the channel
    if (memberCount > 2)
        return false;

    // Ignore if the user is mentioning themselves
    if (message.mentions.has(message.author.id))
        return false;

    return true;
}

//==================================================================
client.on('messageCreate', async (message) => {
    // Debugging: Print the entire map
    console.log('Debug: guildMemberCounts', [...guildMemberCounts]);

    // Ignore messages from bots
    if (message.author.bot) return;

    // Ignore messages that are not in the list of channels
    if (!CHANNELS.includes(message.channel.name)) return;
    
    // Ignore messages that don't start with the ignore prefix
    // unless they mention this bot
    if (message.content.startsWith(IGNORE_PREFIX) &&
        !message.mentions.has(client.user.id)) return;

    // Ignore messages that are not for the bot
    if (!isMessageForBot(client, message)) return;

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
        content: SYSTEM_PROMPT,
    });

    // Fetch the last 10 messages
    let prevMessages = await message.channel.messages.fetch({ limit: 10 });
    // Reverse the messages so they are in chronological order
    prevMessages.reverse();
    prevMessages.forEach((msg) => {
        // Ignore messages from bots, except this one
        if (msg.author.bot && msg.author.id !== client.user.id) return;

        if (!isMessageForBot(client, msg)) return;
        
        let contentNoMentionPrefix = msg.content;
        // Remove the mention prefix if it exists
        if (contentNoMentionPrefix.startsWith(`<@!${client.user.id}>`)) {
            contentNoMentionPrefix = contentNoMentionPrefix.substring(`<@!${client.user.id}>`.length);
        }
    
        // Ignore messages that start with the ignore prefix
        if (contentNoMentionPrefix.startsWith(IGNORE_PREFIX)) return;

        // Clean up the username, because OpenAI doesn't like special characters
        const cleanUsername = msg.author.username.replace(/\s+/g, '_').replace(/[^\w\s]/gi, '');

        // Determine the role for this message
        const role = (msg.author.id === client.user.id) ? 'assistant' : 'user';
        // Add the message to the conversation array
        conversation.push({
            role: role,
            name: cleanUsername,
            content: contentNoMentionPrefix,
        });
    });

    //console.log('Conversation:', conversation);

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

    // Finally, send the response, splitting it into chunks if necessary
    const responseMessage = response.choices[0].message.content;
    const chunkSize = 2000; // Discord message character limit
    for (let i = 0; i < responseMessage.length; i += chunkSize) {
        const chunk = responseMessage.substring(i, i + chunkSize);
        await message.reply(chunk);
    }
});

//==================================================================
// Login to Discord with the bot token
client.login(process.env.DISCORD_TOKEN);
