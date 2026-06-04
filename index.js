require("./lib/function.js");
require("./config.js");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  jidDecode, 
  downloadContentFromMessage,
  generateWAMessageFromContent,
  generateWAMessage
} = require("@whiskeysockets/baileys");

const chalk = require("chalk");
const Pino = require("pino");
const fs = require("fs");
const crypto = require("crypto");
const DataBase = require("./lib/database.js");
const database = new DataBase();
global.groupMetadataCache = new Map()
const serialize = require("./lib/serialize");
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require("./lib/sticker.js");

if (!fs.existsSync('./sampah')) fs.mkdirSync('./sampah', { recursive: true });

global.generateWAMessageFromContent = generateWAMessageFromContent;
global.generateWAMessage            = generateWAMessage;

const loadDb = async () => {
  const load = await database.read() || {};
  global.db = {
    users: load.users || {},
    groups: load.groups || {},
    settings: load.settings || {}
  };
  await database.write(global.db);
  setInterval(() => database.write(global.db), 2000);
};

loadDb();

async function StartBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: Pino({ level: "silent" }),
    browser: Browsers.iOS("Safari"),
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false, 
    cachedGroupMetadata: async (jid) => {
        if (!global.groupMetadataCache.has(jid)) {
            const metadata = await sock.groupMetadata(jid).catch((err) => {});
            await global.groupMetadataCache.set(jid, metadata);
            return metadata;
        }
        return global.groupMetadataCache.get(jid);
    }
  });

  if (!sock.authState.creds.registered) {
    console.log(chalk.white(`• Request Pairing Code To Number ${global.pairingNumber.trim()}`));
    setTimeout(async () => {
      const code = await sock.requestPairingCode(global.pairingNumber.trim(), "AAAAAAAA");
      console.log(chalk.white(`• Kode Pairing: ${code}`));
    }, 4000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    const m = await serialize(sock, msg);
    if (m.isBaileys) return
    require("./message.js")(sock, m);
  });

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("Reconnecting...");
        StartBot();
      } else {
        console.log("Connection Closed");
      }
    }
    if (connection === "open") {
      console.log("Bot online!");
     
      setInterval(async () => {
        try {
          if (global.kirimAutoJpm)  await global.kirimAutoJpm(sock);
          if (global.kirimAutoSwgc) await global.kirimAutoSwgc(sock);
        } catch (e) {
          console.error("[Auto Interval]", e.message);
        }
      }, 60000);
    }
  });
  
  sock.ev.on("group-participants.update", async (update) => {
  const { id, participants, action, author } = update;
  const groupMetadata = await sock.groupMetadata(id);
  global.groupMetadataCache.set(id, groupMetadata);
  })
  
  sock.downloadMediaMessage = async (m, type, filename = "") => {
    if (!m || !(m.url || m.directPath)) return Buffer.alloc(0);
    const stream = await downloadContentFromMessage(m, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    if (filename) await fs.promises.writeFile(filename, buffer);
    return filename && fs.existsSync(filename) ? filename : buffer;
 };

  sock.decodeJid = jid => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};
      return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
    }
    return jid;
  };
  
 sock.sendSticker = async (jid, path, quoted, options = {}) => {
    let buff = Buffer.isBuffer(path)
        ? path
        : /^data:.*?\/.*?;base64,/i.test(path)
        ? Buffer.from(path.split(",")[1], "base64")
        : /^https?:\/\//.test(path)
        ? await (await getBuffer(path))
        : fs.existsSync(path)
        ? fs.readFileSync(path)
        : Buffer.alloc(0);
    const buffer = (options.packname || options.author)
        ? await writeExifImg(buff, options)
        : await imageToWebp(buff);
    const tmpPath = `./sampah/${crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.webp`
    fs.writeFileSync(tmpPath, buffer);
    await sock.sendMessage(jid, { sticker: { url: tmpPath }, ...options }, { quoted });
    fs.unlinkSync(tmpPath);
    return buffer;
 };
 
 sock.sendAlbum = async function (jid, content, quoted) {
    const array = content.albumMessage;

    const album = await generateWAMessageFromContent(
        jid,
        {
            messageContextInfo: { messageSecret: crypto.randomBytes(32) },
            albumMessage: {
                expectedImageCount: array.filter(a => a.image).length,
                expectedVideoCount: array.filter(a => a.video).length,
            },
        },
        {
            userJid: quoted.sender,
            quoted: quoted,
            upload: sock.waUploadToServer,
        },
    );

    await sock.relayMessage(jid, album.message, {
        messageId: album.key.id,
    });

    for (let item of array) {
        const img = await generateWAMessage(jid, item, {
            upload: sock.waUploadToServer,
        });

        img.message.messageContextInfo = {
            messageSecret: crypto.randomBytes(32),
            messageAssociation: {
                associationType: 1,
                parentMessageKey: album.key,
            },
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            forwardingScore: 99999,
            isForwarded: true,
            mentionedJid: [jid],
            starred: true,
            labels: ["Y", "Important"],
            isHighlighted: true,
            businessMessageForwardInfo: {
                businessOwnerJid: jid,
            },
            dataSharingContext: {
                showMmDisclosure: true,
            },
        };

        img.message.disappearingMode = {
            initiator: 3,
            trigger: 4,
            initiatorDeviceJid: jid,
            initiatedByExternalService: true,
            initiatedByUserDevice: true,
            initiatedBySystem: true,
            initiatedByServer: true,
            initiatedByAdmin: true,
            initiatedByUser: true,
            initiatedByApp: true,
            initiatedByBot: true,
            initiatedByMe: true,
        };

        await sock.relayMessage(jid, img.message, {
            messageId: img.key.id,
            quoted: {
                key: {
                    remoteJid: album.key.remoteJid,
                    id: album.key.id,
                    fromMe: true,
                    participant:
                        generateMessageID().split("@")[0] +
                        "@s.whatsapp.net",
                },
                message: album.message,
            },
        });
    }

    return album;
 };  

  return sock;
}

StartBot();
