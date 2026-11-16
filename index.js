const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

// ⚙️ බොට්ගේ විස්තර
const API_BASE = "https://api-nomo.zone.id/api/gemini?q=";

// 🧠 මතකය තබාගැනීම සඳහා (User States)
const userStates = new Map(); // 'CHOOSING', 'GF', 'BF'

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // අපි qrcode-terminal පාවිච්චි කරන නිසා මෙතන false තියන්න
        auth: state,
        browser: ["Mac OS", "Safari", "17.2.1"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // 📌 QR Code එක Logs වල පෙන්වීම
        if (qr) {
            console.log('\n========================================');
            console.log('📌 පහත QR Code එක WhatsApp එකෙන් Scan කරන්න:');
            console.log('========================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 3000); // තත්පර 3කින් නැවත සම්බන්ධ වීම
            }
        } else if (connection === 'open') {
            console.log('\n========================================');
            console.log('✅ 𝗔𝗜 𝗚𝗙 / 𝗕𝗙 𝗕𝗢𝗧 💘 සාර්ථකව WhatsApp එකට සම්බන්ධ වුණා!');
            console.log('👑 𝗯𝗼𝘁 𝗼𝘄𝗮𝗻𝗲𝗿 : 𝗦𝗜𝗧𝗛𝗨𝗪𝗔 💖');
            console.log('========================================\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        if (sender.endsWith('@g.us')) return; // Group මැසේජ් මගහරී (Inbox පමණි)

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const textLower = text.trim().toLowerCase();
        let pushName = msg.pushName || "සුදු";

        try {
            // 1️⃣ මුල් වතාවට එන කෙනෙක් නම්
            if (!userStates.has(sender)) {
                userStates.set(sender, 'CHOOSING');

                const welcomeText = 
                    `*✦ 𝗔𝗜 𝗚𝗙 / 𝗕𝗙 𝗕𝗢𝗧 💘* \n\n` +
                    `හායි *${pushName}*! මාව ඔයාගේ චැට් එකට සාදරයෙන් පිළිගන්නවා. 💖\n\n` +
                    `ඔයාට මගෙන් කතා කරන්න ඕන කා විදිහටද?\n` +
                    `👉 Reply කරන්න *'GF'* කියලා (Girlfriend කෙනෙක් වගේ)\n` +
                    `👉 Reply කරන්න *'BF'* කියලා (Boyfriend කෙනෙක් වගේ)\n\n` +
                    `*© ᴏᴡɴᴇʀ : 𝗦𝗜𝗧𝗛𝗨𝗪𝗔 💖*`;

                await sock.sendMessage(sender, { text: welcomeText }, { quoted: msg });
                return;
            }

            const currentState = userStates.get(sender);

            // 2️⃣ User තවමත් GF හෝ BF තෝරමින් සිටී නම්
            if (currentState === 'CHOOSING') {
                if (textLower.includes('gf') || textLower.includes('ගර්ල්ප්‍රෙන්ඩ්') || textLower.includes('ගර්ල්')) {
                    userStates.set(sender, 'GF');
                    await sock.sendMessage(sender, { 
                        text: `🥰 අම්මෝ හරි *${pushName}* බබා! අද ඉඳන් මම ඔයාගේ ආදරණීය *Girlfriend* වෙලා ඔයාත් එක්ක ඉන්නවා. ❤️\n\nදැන් මට කියන්නකෝ සුදු, මොකද කරන්නේ? 🙈` 
                    }, { quoted: msg });
                    return;
                } else if (textLower.includes('bf') || textLower.includes('බෝයිප්‍රෙන්ඩ්') || textLower.includes('බෝයි')) {
                    userStates.set(sender, 'BF');
                    await sock.sendMessage(sender, { 
                        text: `💪 මගේ රත්තරන් කොල්ලා *${pushName}*! අද ඉඳන් මම ඔයාගේ ළඟින්ම ඉන්න ඔයාගේ ආදරණීය *Boyfriend* කෙනා. 🫂\n\nකියන්න ඉතින් මගෙ පණ, මොකද කරන්නේ? ✨` 
                    }, { quoted: msg });
                    return;
                } else {
                    await sock.sendMessage(sender, { text: `⚠️ කරුණාකර නිවැරදිව *'GF'* හෝ *'BF'* ලෙස සඳහන් කරන්න ${pushName} සුදු! 🥺` }, { quoted: msg });
                    return;
                }
            }

            // 3️⃣ සාමාන්‍ය චැට් එක (GF හෝ BF ලෙස තෝරා අවසන්)
            await sock.sendPresenceUpdate('composing', sender);

            let personaPrompt = "";
            if (currentState === 'GF') {
                personaPrompt = `You are a very loving, caring, romantic, and sweet Sri Lankan Girlfriend chatting with your partner named ${pushName}. Chat naturally in casual Singlish/Sinhala mixed with English, using lovely romantic emojis (❤️, 🥺, 😘, 🥰, ✨, 🙈). Call him "baba", "sudu", "patiyo", or "mage pan". Keep it short, warm, and loving: `;
            } else {
                personaPrompt = `You are a very caring, protective, romantic, and sweet Sri Lankan Boyfriend chatting with your partner named ${pushName}. Chat naturally in casual Singlish/Sinhala mixed with English, using lovely romantic emojis (💪, ❤️, 🫂, ✨, 🥰, 😘). Call him/her "sudu", "baba", or "manike". Keep it short, warm, and supportive: `;
            }

            const fullQuery = `${personaPrompt} Partner says: "${text}"`;
            const encodedQuery = encodeURIComponent(fullQuery);
            const apiUrl = `${API_BASE}${encodedQuery}`;

            const response = await axios.get(apiUrl);
            let replyText = response.data.reply || response.data.response || response.data.answer || `මගෙ පණ ${pushName}, මට පොඩි නෙට්වර්ක් අව්වක් වගේ. ආයෙත් කියන්නකෝ මේක! 🥺❤️`;

            await delay(1200);
            await sock.sendMessage(sender, { text: replyText }, { quoted: msg });
            await sock.sendPresenceUpdate('paused', sender);

        } catch (error) {
            console.error("AI Error:", error.message);
            await sock.sendMessage(sender, { text: `අයියෝ සුදු ${pushName}, පොඩි දෝෂයක් වුණා. ආයෙත් මැසේජ් එකක් දාන්නකෝ! 🥺❤️` }, { quoted: msg });
        }
    });
}

startBot();
