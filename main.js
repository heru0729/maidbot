const { 
Client,
GatewayIntentBits,
Partials,
REST,
Routes,
SlashCommandBuilder,
EmbedBuilder,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
PermissionsBitField
} = require("discord.js")

const express = require("express")

const TOKEN = process.env.TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const OWNER_ID = process.env.OWNER_ID
const PORT = process.env.PORT || 3000

const client = new Client({
intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers
],
partials:[Partials.Message,Partials.Channel]
})

const logSettings = new Map()
const globalChatChannels = new Map()
const rolePanels = new Map()
const ticketPanels = new Map()

const commands = [

new SlashCommandBuilder()
.setName("rp")
.setDescription("ロールパネル")
.addSubcommand(s=>
s.setName("create")
.setDescription("作成")
.addStringOption(o=>o.setName("title").setDescription("タイトル").setRequired(true))
.addStringOption(o=>o.setName("description").setDescription("説明").setRequired(true))
.addStringOption(o=>o.setName("roles").setDescription("ロール 絵文字 ロール 絵文字").setRequired(true))
)
.addSubcommand(s=>
s.setName("delete")
.setDescription("削除")
),

new SlashCommandBuilder()
.setName("ticket")
.setDescription("チケットパネル作成")
.addStringOption(o=>o.setName("title").setDescription("タイトル").setRequired(true))
.addStringOption(o=>o.setName("description").setDescription("説明").setRequired(true))
.addStringOption(o=>o.setName("button").setDescription("ボタン内容").setRequired(true)),

new SlashCommandBuilder()
.setName("log")
.setDescription("ログ設定")
.addChannelOption(o=>o.setName("channel").setDescription("チャンネル").setRequired(true)),

new SlashCommandBuilder()
.setName("gset")
.setDescription("グローバルチャット設定")
.addChannelOption(o=>o.setName("channel").setDescription("チャンネル").setRequired(true)),

new SlashCommandBuilder()
.setName("gdel")
.setDescription("グローバルチャット解除")

].map(c=>c.toJSON())

const rest = new REST({version:"10"}).setToken(TOKEN)

async function registerCommands(){
await rest.put(
Routes.applicationCommands(CLIENT_ID),
{body:commands}
)
}

client.on("ready",()=>{
console.log(`BOT READY ${client.user.tag}`)
})

client.on("interactionCreate",async interaction=>{

if(!interaction.isChatInputCommand() && !interaction.isButton()) return

if(interaction.isChatInputCommand()){

if(interaction.commandName==="rp"){

const sub = interaction.options.getSubcommand()

if(sub==="create"){

const title = interaction.options.getString("title")
const description = interaction.options.getString("description")
const rolesText = interaction.options.getString("roles")

const parts = rolesText.split(" ")

const row = new ActionRowBuilder()

for(let i=0;i<parts.length;i+=2){

const roleName = parts[i]
const emoji = parts[i+1]

const role = interaction.guild.roles.cache.find(r=>r.name===roleName)

if(!role) continue

const button = new ButtonBuilder()
.setCustomId(`role_${role.id}`)
.setLabel(role.name)
.setEmoji(emoji)
.setStyle(ButtonStyle.Secondary)

row.addComponents(button)

}

const embed = new EmbedBuilder()
.setTitle(title)
.setDescription(description)

const msg = await interaction.channel.send({
embeds:[embed],
components:[row]
})

rolePanels.set(msg.id,true)

await interaction.reply({content:"作成しました",ephemeral:true})

}

if(sub==="delete"){

if(!interaction.channel) return

const messages = await interaction.channel.messages.fetch({limit:10})

for(const m of messages.values()){

if(rolePanels.has(m.id)){
await m.delete()
rolePanels.delete(m.id)
await interaction.reply({content:"削除しました",ephemeral:true})
return
}

}

await interaction.reply({content:"パネル不明",ephemeral:true})

}

}

if(interaction.commandName==="ticket"){

const title = interaction.options.getString("title")
const description = interaction.options.getString("description")
const buttonText = interaction.options.getString("button")

const embed = new EmbedBuilder()
.setTitle(title)
.setDescription(description)

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("ticket_create")
.setLabel(buttonText)
.setStyle(ButtonStyle.Primary)
)

const msg = await interaction.channel.send({
embeds:[embed],
components:[row]
})

ticketPanels.set(msg.id,true)

await interaction.reply({content:"チケットパネル作成",ephemeral:true})

}

if(interaction.commandName==="log"){

const ch = interaction.options.getChannel("channel")

logSettings.set(interaction.guild.id,ch.id)

await interaction.reply({content:"ログ設定完了",ephemeral:true})

}

if(interaction.commandName==="gset"){

const ch = interaction.options.getChannel("channel")

globalChatChannels.set(interaction.guild.id,ch.id)

await interaction.reply({content:"グローバルチャット設定",ephemeral:true})

}

if(interaction.commandName==="gdel"){

globalChatChannels.delete(interaction.guild.id)

await interaction.reply({content:"解除しました",ephemeral:true})

}

}

if(interaction.isButton()){

if(interaction.customId.startsWith("role_")){

const roleId = interaction.customId.replace("role_","")

const role = interaction.guild.roles.cache.get(roleId)

if(!role) return

if(interaction.member.roles.cache.has(role.id)){
await interaction.member.roles.remove(role)
await interaction.reply({content:"ロール削除",ephemeral:true})
}else{
await interaction.member.roles.add(role)
await interaction.reply({content:"ロール追加",ephemeral:true})
}

}

if(interaction.customId==="ticket_create"){

const channel = await interaction.guild.channels.create({
name:`ticket-${interaction.user.username}`,
type:0,
permissionOverwrites:[
{
id:interaction.guild.id,
deny:[PermissionsBitField.Flags.ViewChannel]
},
{
id:interaction.user.id,
allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]
}
]
})

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("ticket_delete")
.setLabel("削除")
.setStyle(ButtonStyle.Danger)
)

await channel.send({
content:`${interaction.user}`,
components:[row]
})

await interaction.reply({content:"チケット作成",ephemeral:true})

}

if(interaction.customId==="ticket_delete"){

await interaction.channel.delete()

}

}

})

client.on("messageCreate",async msg=>{

if(msg.author.bot) return

if(globalChatChannels.has(msg.guild.id)){

const chId = globalChatChannels.get(msg.guild.id)

if(msg.channel.id===chId){

for(const [gid,channelId] of globalChatChannels){

if(gid===msg.guild.id) continue

const guild = client.guilds.cache.get(gid)

if(!guild) continue

const ch = guild.channels.cache.get(channelId)

if(!ch) continue

ch.send(`🌐 ${msg.author.username}@${msg.guild.name}\n${msg.content}`)

}

}

}

if(logSettings.has(msg.guild.id)){

const logCh = msg.guild.channels.cache.get(logSettings.get(msg.guild.id))

if(logCh){
logCh.send(`📝 ${msg.author.tag}: ${msg.content}`)
}

}

})

client.on("messageDelete",msg=>{

if(!msg.guild) return

if(logSettings.has(msg.guild.id)){

const logCh = msg.guild.channels.cache.get(logSettings.get(msg.guild.id))

if(logCh){
logCh.send(`🗑 削除: ${msg.author?.tag} ${msg.content}`)
}

}

})

const app = express()

app.get("/",(req,res)=>{
res.send("BOT RUNNING")
})

app.listen(PORT,()=>{
console.log("WEB OK")
})

registerCommands()

client.login(TOKEN)
