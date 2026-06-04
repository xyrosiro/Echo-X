require("./config.js");
require("./lib/fakeq.js");
const chalk  = require("chalk");
const fs     = require("fs");
const util   = require("util");
const crypto = require("crypto");
const { exec, execSync } = require("child_process");
const {
  prepareWAMessageMedia,
  generateWAMessageFromContent,
  generateWAMessageContent,
  generateWAMessage
} = require("@whiskeysockets/baileys");

global.uploadImageBuffer = require("./lib/tourl.js").uploadImageBuffer;
global.CatBox   = require("./lib/tourl.js");
global.tiktok   = require("./lib/tiktok.js");
global.igdl     = require("./lib/igdl.js");
const loadDb    = require("./lib/load_database.js");

const parseDuration = (str) => {
  if (!str) return null;
  const match = str.match(/^(\d+)\s*(jam|menit|detik|j|m|d|h|min|sec|s)?$/i);
  if (!match) return null;
  const val  = parseInt(match[1]);
  const unit = (match[2] || "menit").toLowerCase();
  if (["jam","j","h"].includes(unit))           return val * 60;
  if (["menit","m","min"].includes(unit))        return val;
  if (["detik","d","s","sec"].includes(unit))    return Math.ceil(val / 60);
  return val;
};
global.parseDuration = parseDuration;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

global.kirimAutoJpm = async (sock, force = false) => {
  const setting = global.db.settings.autojpm;
  if (!setting.enabled && !force) return { success: 0, fail: 0, skipped: true };
  const now = Date.now();
  if (!force && (now - setting.lastRun) < setting.interval * 60000)
    return { success: 0, fail: 0, skipped: true };

  const groups   = await sock.groupFetchAllParticipating();
  const groupIds = Object.keys(groups).filter(id => !setting.blacklist.includes(id));
  let success = 0, fail = 0;

  for (let id of groupIds) {
    try {
      if (setting.media) {
        const md = setting.media;
        if (md.type === "image") {
          await sock.sendMessage(id, {
            image: Buffer.from(md.data, "base64"),
            caption: setting.message,
            mimetype: md.mimetype
          });
        } else if (md.type === "video") {
          await sock.sendMessage(id, {
            video: Buffer.from(md.data, "base64"),
            caption: setting.message,
            mimetype: md.mimetype
          });
        }
      } else {
        await sock.sendMessage(id, { text: setting.message });
      }
      success++;
    } catch (e) { fail++; }
    await sleep(2000);
  }
  global.db.settings.autojpm.lastRun = now;
  console.log(`[AutoJPM] Sukses: ${success}, Gagal: ${fail}`);
  return { success, fail, skipped: false };
};

global.kirimAutoSwgc = async (sock, force = false) => {
  const setting = global.db.settings.autojpmswgc;
  if (!setting.enabled && !force) return { success: 0, fail: 0, skipped: true };
  const now = Date.now();
  if (!force && (now - setting.lastRun) < setting.interval * 60000)
    return { success: 0, fail: 0, skipped: true };

  let mediaUrl  = null;
  let mediaType = null;
  if (setting.media && setting.media.data) {
    const buffer = Buffer.from(setting.media.data, "base64");
    const mime   = setting.media.mimetype;
    if (/image/.test(mime)) {
      mediaUrl  = await global.UploadMedia(buffer, "image.jpg", "image").catch(() => null);
      mediaType = "image";
    } else if (/video/.test(mime)) {
      mediaUrl  = await global.UploadMedia(buffer, "video.mp4", "video").catch(() => null);
      mediaType = "video";
    }
  }

  const groups   = await sock.groupFetchAllParticipating();
  const blacklist = setting.blacklist || [];
  const targets  = Object.keys(groups).filter(id => !blacklist.includes(id));
  const bgColors = ["#FF5733","#33FF57","#3357FF","#F033FF","#FF33F0","#33FFF0","#F0FF33","#FF8333","#8333FF","#33FF83"];
  let success = 0, failed = 0;

  for (const jid of targets) {
    try {
      let content;
      if (mediaUrl && mediaType === "image") {
        content = { image: { url: mediaUrl }, caption: setting.message || undefined };
      } else if (mediaUrl && mediaType === "video") {
        content = { video: { url: mediaUrl }, caption: setting.message || undefined, gifPlayback: false };
      } else {
        content = {
          text: setting.message,
          backgroundColor: bgColors[Math.floor(Math.random() * bgColors.length)],
          font: Math.floor(Math.random() * 7) + 1
        };
      }
      const inside = await generateWAMessageContent(content, {
        upload: sock.waUploadToServer,
        logger: sock.logger
      });
      const messageSecret = crypto.randomBytes(32);
      const msg = await generateWAMessageFromContent(jid, {
        messageContextInfo: { messageSecret },
        groupStatusMessageV2: {
          message: { ...inside, messageContextInfo: { messageSecret } }
        }
      }, { userJid: sock.user.id });
      await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
      success++;
      await sleep(2000);
    } catch (err) {
      console.error(`[AutoSwgc] Gagal ke ${jid}:`, err.message);
      failed++;
    }
  }
  global.db.settings.autojpmswgc.lastRun = now;
  console.log(`[AutoSwgc] Sukses: ${success}, Gagal: ${failed}`);
  return { success, fail: failed, skipped: false };
};

if (!global.UploadMedia) {
  global.UploadMedia = async (buffer, filename, type) => {
    try {
      const { uploadImageBuffer } = require("./lib/tourl.js");
      return await uploadImageBuffer(buffer);
    } catch { return null; }
  };
}

module.exports = async (sock, m) => {
  await loadDb(sock, m);

  const isCmd  = m?.body?.startsWith(prefix);
  const quoted = m.quoted ? m.quoted : m;
  const mime   = quoted?.msg?.mimetype || quoted?.mimetype || null;
  const args   = m?.body?.trim().split(/ +/).slice(1) || [];
  const qmsg   = m.quoted || m;
  const text   = args.join(" ");
  const command = isCmd
    ? m.body.slice(prefix.length).trim().split(" ").shift().toLowerCase()
    : "";
  const cmd      = prefix + command;
  const isOwner  = m.isOwner;
  const db       = global.db;

  const metadata = m.isGroup
    ? (global.groupMetadataCache.get(m.chat) || await sock.groupMetadata(m.chat).then(r => {
        global.groupMetadataCache.set(m.chat, r); return r;
      }).catch(() => ({})))
    : {};

  const admins = metadata?.participants
    ? metadata.participants.filter(p => p.admin !== null).map(p => p.id)
    : [];
  m.isAdmin    = m.isGroup && admins.includes(m.sender);
  m.isBotAdmin = m.isGroup && admins.includes(m.botNumber);

  const qtext = {
    key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net" },
    message: { extendedTextMessage: { text: `By ${global.ownername}` } }
  };

  if (isCmd) {
    console.log(
      chalk.white("• Sender  :"), chalk.blue(m.chat),
      "\n" + chalk.white("• Group   :"), chalk.blue(m.isGroup ? metadata.subject : "Private"),
      "\n" + chalk.white("• Command :"), chalk.blue(cmd),
      "\n"
    );
  }

  if (isCmd && global.botMode === "self" && !isOwner) return;

  const rowsMenu = [
  { title: "⭐ All Menu",   id: ".allmenu",   description: "Semua list menu" },
  { title: "🚀 Auto Menu",  id: ".automenu",  description: "List auto menu" },
  { title: "🏢 Group Menu", id: ".groupmenu", description: "List group menu" },
  { title: "📢 Jpm Menu",   id: ".jpmmenu",   description: "List jpm menu" },
  { title: "📤 Push Menu",  id: ".pushmenu",  description: "List pushkontak menu" },
  { title: "🧩 Tools Menu", id: ".toolsmenu", description: "List tools menu" },
  { title: "🕊️ Owner Menu", id: ".ownermenu", description: "List owner menu" }
];

global.textAutomenu = `  ┌──────
  ├─── ▢ Automenu
  ├─ autoswgrup
  ├─ setswgrup
  ├─ swgrup
  ├─ swgrupall
  ├─ autojpm
  ├─ setjpm
  ├─ bljpm
  └`;

global.textGroupmenu = `  ┌──────
  ├─── ▢ Groupmenu
  ├─ joinallgrup
  ├─ outallgrup
  ├─ listgc
  ├─ swgrup
  └`;

global.textJpmmenu = `  ┌──────
  ├─── ▢ Jpm/Broadcast
  ├─ jpm
  ├─ jpmht
  ├─ autojpm
  ├─ setjpm
  ├─ jedajpm
  ├─ bljpm
  ├─ delbl
  └`;

global.textPushmenu = `  ┌──────
  ├─── ▢ Pushmenu
  ├─ pushkontak
  ├─ stoppush
  ├─ setjedapush
  └`;

global.textToolsmenu = `  ┌──────
  ├─── ▢ Toolsmenu
  ├─ tourl
  ├─ cekidch
  ├─ sticker
  ├─ ttdl
  ├─ igdl
  ├─ npmdl
  └`;

global.textOwnermenu = `  ┌──────
  ├─── ▢ Ownermenu
  ├─ self
  ├─ public
  ├─ backupsc
  ├─ resetsc
  ├─ payment
  ├─ done
  ├─ proses
  └`;

switch (command) {

  case "menu":
  case "automenu":
  case "groupmenu":
  case "jpmmenu":
  case "pushmenu":
  case "toolsmenu":
  case "ownermenu":
  case "allmenu": {
    await m.react("🔄");

    const os    = require("os");
    const used  = (process.memoryUsage().rss / 1024 / 1024 / 1024).toFixed(2);
    const total = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const start = process.hrtime.bigint();
    const end   = process.hrtime.bigint();
    const speed = Number(end - start) / 1e6;

    let teks = `
  Hii @${m.sender.split("@")[0]} 👋
    
  *▢ Name* : ${global.botName} 
  *▢ Version* : ${global.versionBot}
  *▢ Series* : The One That Got Away
  *▢ Type* : Case
  *▢ Speed* : ${speed}ms
  *▢ Runtime* : ${runtime(process.uptime())}
  *▢ Ram* : ${used}GB/${total}GB
  
${global.textAutomenu}
`;

    global.imageMenu = global.imageMenu
      ? global.imageMenu
      : await prepareWAMessageMedia({ image: { url: global.thumbnail } }, { upload: sock.waUploadToServer });

    if (command === "automenu")  teks = `
${global.textAutomenu}
`;
    if (command === "groupmenu") teks = `
${global.textGroupmenu}
`;
    if (command === "jpmmenu")   teks = `
${global.textJpmmenu}
`;
    if (command === "pushmenu")  teks = `
${global.textPushmenu}
`;
    if (command === "toolsmenu") teks = `
${global.textToolsmenu}
`;
    if (command === "ownermenu") teks = `
${global.textOwnermenu}
`;
    if (command === "allmenu")   teks += `
${global.textAutomenu}

${global.textGroupmenu}

${global.textJpmmenu}

${global.textPushmenu}

${global.textToolsmenu}

${global.textOwnermenu}
`;

    let msg = await generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: {
              ...global.imageMenu,
              hasMediaAttachment: true
            },
            body: {
              text: teks
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: JSON.stringify({
                    title: "List Menu",
                    sections: [
                      {
                        title: `© Powered By ${global.ownername}`,
                        highlight_label: "Recommended",
                        rows: rowsMenu
                      }
                    ]
                  })
                },
                {
                  name: "single_select",
                  buttonParamsJson: JSON.stringify({
                    title: "List Menu",
                    sections: [
                      {
                        title: `© Powered By ${global.ownername}`,
                        highlight_label: "Recommended",
                        rows: rowsMenu
                      }
                    ]
                  })
                },
                {
                  name: "cta_url",
                  buttonParamsJson: JSON.stringify({
                    display_text: "Contact Developer",
                    url: global.linkOwner,
                    merchant_url: global.linkOwner
                  })
                }
              ],
              messageParamsJson: JSON.stringify({
                limited_time_offer: {
                  text: `${global.botName} - ${global.versionBot}`,
                  url: global.linkOwner,
                  copy_code: "1",
                  expiration_time: 0
                },
                bottom_sheet: {
                  in_thread_buttons_limit: 2,
                  divider_indices: [1, 2, 3, 4, 5, 999],
                  list_title: `Powered by @XyroSiro`,
                  button_title: "List Menu"
                },
                tap_target_configuration: {
                  title: "1",
                  description: "bomboclard",
                  canonical_url: global.linkOwner,
                  domain: "shop.example.com",
                  button_index: 0
                }
              })
            },
            contextInfo: {
              mentionedJid: [m.sender]
            }
          }
        }
      }
    }, {
      userJid: m.sender,
      quoted: global.qtext
    });

    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });

    if (command === "menu") {
      await sock.sendMessage(m.chat, {
        audio: { url: "https://files.catbox.moe/h2g6e9.m4a" },
        mimetype: "audio/mpeg",
        ptt: false
      });
    }

    await m.react("✅").catch(() => {});
    break;
  }

  case "delbl":
  case "delbljpm": {
    if (!isOwner) return m.reply(mess.owner);
    if (db.settings.bljpm.length < 1) return m.reply("Tidak ada data blacklist grup.");

    const groups = await sock.groupFetchAllParticipating();
    const Data   = Object.values(groups);
    let rows     = [{ title: "🗑️ Hapus Semua", description: "Hapus semua grup dari blacklist", id: `.delbl-response all` }];

    for (let id of db.settings.bljpm) {
      let grup = Data.find(g => g.id === id);
      let name = grup ? (grup.subject || "Unknown") : "Unknown";
      rows.push({ title: name, description: `ID Grup - ${id}`, id: `.delbl-response ${id}|${name}` });
    }

    let msg = await generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: { text: `Pilih Grup Untuk Dihapus Dari Blacklist\n\nTotal: ${db.settings.bljpm.length}` },
            nativeFlowMessage: {
              buttons: [{
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  title: "Daftar Blacklist",
                  sections: [{ title: "Blacklist Terdaftar", rows }]
                })
              }]
            }
          }
        }
      }
    }, { userJid: m.sender, quoted: m });

    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
  }
  break;

  case "delbl-response": {
    if (!isOwner) return;
    if (!text) return;
    if (text === "all") {
      db.settings.bljpm = [];
      return m.reply("✅ Semua data blacklist berhasil dihapus.");
    }
    if (text.includes("|")) {
      const [id, grupName] = text.split("|");
      if (!db.settings.bljpm.includes(id)) return m.reply(`Grup *${grupName}* tidak ada dalam blacklist.`);
      db.settings.bljpm = db.settings.bljpm.filter(g => g !== id);
      return m.reply(`✅ Grup *${grupName}* berhasil dihapus dari blacklist.`);
    }
  }
  break;

  case "setjeda":
  case "setjedapush": {
    if (!isOwner) return m.reply(mess.owner);
    if (!args[0]) return m.reply(
      `Masukkan jeda push!\n\nContoh: ${cmd} 5000\n1000 = 1 detik\n\nJeda saat ini: ${global.jedaPushkontak} ms`
    );
    let delay = parseInt(args[0]);
    if (isNaN(delay) || delay < 0) return m.reply("Jeda harus berupa angka (ms) yang valid!");
    try {
      let settingPath = "./config.js";
      let fileTxt = fs.readFileSync(settingPath, "utf8");
      let updated = fileTxt.replace(/global\.jedaPushkontak\s*=\s*\d+/, `global.jedaPushkontak = ${delay}`);
      fs.writeFileSync(settingPath, updated);
      global.jedaPushkontak = delay;
    } catch (err) {
      console.error(err);
      return m.reply("Gagal mengubah jeda push ❌");
    }
    return m.reply(`Jeda pushkontak berhasil diubah menjadi *${delay} ms* ✅`);
  }
  break;

  case "bljpm":
  case "bl": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) {
      let rows = [];
      const a    = await sock.groupFetchAllParticipating();
      const Data = Object.values(a);
      if (Data.length < 1) return m.reply("Tidak ada grup chat.");
      for (let u of Data) {
        rows.push({ title: u.subject || "Unknown", description: `ID - ${u.id}`, id: `.bljpm ${u.id}|${u.subject || "Unknown"}` });
      }
      return sock.sendMessage(m.chat, {
        buttons: [{
          buttonId: "action",
          buttonText: { displayText: "Pilih Grup" },
          type: 4,
          nativeFlowInfo: {
            name: "single_select",
            paramsJson: JSON.stringify({ title: "Pilih Grup", sections: [{ title: "Pilih Salah Satu Grup Chat", rows }] })
          }
        }],
        headerType: 1,
        viewOnce: true,
        text: `\nPilih Salah Satu Grup Chat\n`
      }, { quoted: m });
    }
    let [id, name] = text.split("|");
    if (!id || !name) return;
    if (db.settings.bljpm.includes(id)) return m.reply(`Grup *${name}* sudah terdaftar dalam Blacklist Jpm!`);
    db.settings.bljpm.push(id);
    return m.reply(`✅ Grup *${name}* berhasil ditambahkan ke Blacklist Jpm.`);
  }
  break;

  case "jpm":
  case "jasher":
  case "jpm":
  case "jaser": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text && !/image/.test(mime)) return m.reply(`*Contoh:* ${cmd} pesannya\nBisa dengan foto juga\n\nAtur jeda: .jedajaser 1000ms`);

    let mediaBuffer = null;
    if (/image/.test(mime)) {
      mediaBuffer = m.quoted ? await m.quoted.download() : await m.download();
    }

    const allGroups   = await sock.groupFetchAllParticipating();
    const groupIds    = Object.keys(allGroups);
    const blacklist   = db.settings.bljpm || [];
    const targetGroups = groupIds.filter(id => !blacklist.includes(id));
    const delay       = db.settings.delayJaser || 4000;

    if (targetGroups.length === 0) return m.reply("❌ Tidak ada grup target.");

    await m.reply(`🚀 Broadcast ke ${targetGroups.length} grup...\nJeda: ${delay}ms`);

    let success = 0, fail = 0;
    for (const jid of targetGroups) {
      try {
        if (mediaBuffer) {
          await sock.sendMessage(jid, { image: mediaBuffer, caption: text || "" });
        } else {
          await sock.sendMessage(jid, { text });
        }
        success++;
      } catch (err) { fail++; }
      await sleep(delay);
    }
    m.reply(`✅ Jaser selesai!\n✅ Berhasil: ${success}\n❌ Gagal: ${fail}\n🚫 Blacklist: ${groupIds.length - targetGroups.length}`);
  }
  break;

  case "jpmht":
  case "jaserht":
  case "jasherht":
  case "hidetagjaser": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text && !/image/.test(mime)) return m.reply(`*Contoh:* ${cmd} pesan hidetag\nAtau kirim gambar dengan caption ${cmd}`);

    let mediaBuffer = null;
    if (/image/.test(mime)) {
      mediaBuffer = m.quoted ? await m.quoted.download() : await m.download();
    }

    const allGroups    = await sock.groupFetchAllParticipating();
    const groupIds     = Object.keys(allGroups);
    const blacklist    = db.settings.bljpm || [];
    const targetGroups = groupIds.filter(id => !blacklist.includes(id));
    const delay        = db.settings.delayJaser || 4000;

    if (targetGroups.length === 0) return m.reply("❌ Tidak ada grup target.");

    await m.reply(`🚀 Hidetag ke ${targetGroups.length} grup...\nJeda: ${delay}ms`);

    let success = 0, fail = 0;
    for (const jid of targetGroups) {
      try {
        const meta         = await sock.groupMetadata(jid).catch(() => ({ participants: [] }));
        const participants = meta.participants.map(p => p.id);
        if (mediaBuffer) {
          await sock.sendMessage(jid, { image: mediaBuffer, caption: text || "", mentions: participants });
        } else {
          await sock.sendMessage(jid, { text, mentions: participants });
        }
        success++;
      } catch (err) { fail++; }
      await sleep(delay);
    }
    m.reply(`✅ Hidetag Jaser selesai!\n✅ Berhasil: ${success}\n❌ Gagal: ${fail}\n🚫 Blacklist: ${groupIds.length - targetGroups.length}`);
  }
  break;

  case "jedajaser": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) {
      const cur = db.settings.delayJaser || 4000;
      return m.reply(`⏱️ *Jeda saat ini:* ${cur}ms (${cur/1000} detik)\n\n*Cara ubah:*\n${cmd} 5000ms\n\nMinimal 1000ms`);
    }
    const match = text.match(/^(\d+)\s*ms$/i);
    if (!match) return m.reply(`❌ Format salah!\n*Contoh:* ${cmd} 5000ms\nMinimal: 1000ms`);
    let delay = parseInt(match[1]);
    if (delay < 1000) return m.reply("❌ Jeda minimal 1000ms.");
    db.settings.delayJaser = delay;
    m.reply(`✅ Jeda jaser diubah ke *${delay}ms* (${delay/1000} detik).`);
  }
  break;
  
  case "swgrupall": {
    if (!isOwner) return m.reply(mess.owner);

    let storyText   = "";
    let mediaBuffer = null;
    let mediaType   = null;

    if (/image/.test(mime)) {
      mediaBuffer = m.quoted ? await m.quoted.download() : await m.download();
      mediaType   = "image";
      storyText   = text;
    } else if (/video/.test(mime)) {
      mediaBuffer = m.quoted ? await m.quoted.download() : await m.download();
      mediaType   = "video";
      storyText   = text;
    } else {
      storyText = text;
    }

    if (!storyText && !mediaBuffer) return m.reply("❌ Masukkan teks atau kirim GAMBAR/VIDEO dengan caption .swgrupall");

    await m.reply("⏳ Mengirim story ke SEMUA grup...");

    const groups   = await sock.groupFetchAllParticipating();
    const groupIds = Object.keys(groups);
    if (groupIds.length === 0) return m.reply("❌ Bot tidak ada di grup manapun.");

    const bgColors = ["#FF5733","#33FF57","#3357FF","#F033FF","#FF33F0","#33FFF0","#F0FF33","#FF8333","#8333FF","#33FF83"];
    let success = 0, failed = 0;

    let mediaUrl = null;
    if (mediaBuffer) {
      const ext = mediaType === "image" ? "image.jpg" : "video.mp4";
      mediaUrl  = await global.UploadMedia(mediaBuffer, ext, mediaType).catch(() => null);
      if (!mediaUrl) return m.reply("❌ Gagal upload media ke server hosting.");
    }

    for (const jid of groupIds) {
      try {
        let content;
        if (mediaUrl && mediaType === "image") {
          content = { image: { url: mediaUrl }, caption: storyText || undefined };
        } else if (mediaUrl && mediaType === "video") {
          content = { video: { url: mediaUrl }, caption: storyText || undefined, gifPlayback: false };
        } else {
          content = {
            text: storyText,
            backgroundColor: bgColors[Math.floor(Math.random() * bgColors.length)],
            font: Math.floor(Math.random() * 7) + 1
          };
        }

        const inside = await generateWAMessageContent(content, {
          upload: sock.waUploadToServer,
          logger: sock.logger
        });
        const messageSecret = crypto.randomBytes(32);
        const msg = await generateWAMessageFromContent(jid, {
          messageContextInfo: { messageSecret },
          groupStatusMessageV2: {
            message: { ...inside, messageContextInfo: { messageSecret } }
          }
        }, { userJid: m.sender });

        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
        success++;
        await sleep(2000);
      } catch (err) {
        console.error(`[swgrupall] Gagal ke ${jid}:`, err.message);
        failed++;
      }
    }
    m.reply(`✅ Story selesai!\n📊 Total: ${groupIds.length}\n✅ Berhasil: ${success}\n❌ Gagal: ${failed}`);
  }
  break;

  case "swgrup": {
    if (!isOwner) return m.reply(mess.owner);
    if (!m.isGroup) return m.reply(mess.group);

    let storyText   = "";
    let mediaBuffer = null;
    let mediaType   = null;

    if (/image/.test(mime)) {
      mediaBuffer = m.quoted ? await m.quoted.download() : await m.download();
      mediaType   = "image";
      storyText   = text;
    } else if (/video/.test(mime)) {
      mediaBuffer = m.quoted ? await m.quoted.download() : await m.download();
      mediaType   = "video";
      storyText   = text;
    } else {
      storyText = text;
    }

    if (!storyText && !mediaBuffer) return m.reply("❌ Masukkan teks atau kirim GAMBAR/VIDEO dengan caption .swgrup");

    await m.reply("⏳ Mengirim story ke grup ini...");

    const bgColors = ["#FF5733","#33FF57","#3357FF","#F033FF","#FF33F0","#33FFF0","#F0FF33","#FF8333","#8333FF","#33FF83"];
    const jid      = m.chat;

    try {
      let content;
      let mediaUrl = null;
      if (mediaBuffer) {
        const ext = mediaType === "image" ? "image.jpg" : "video.mp4";
        mediaUrl  = await global.UploadMedia(mediaBuffer, ext, mediaType).catch(() => null);
        if (!mediaUrl) return m.reply("❌ Gagal upload media.");
      }

      if (mediaUrl && mediaType === "image") {
        content = { image: { url: mediaUrl }, caption: storyText || undefined };
      } else if (mediaUrl && mediaType === "video") {
        content = { video: { url: mediaUrl }, caption: storyText || undefined, gifPlayback: false };
      } else {
        content = {
          text: storyText,
          backgroundColor: bgColors[Math.floor(Math.random() * bgColors.length)],
          font: Math.floor(Math.random() * 7) + 1
        };
      }

      const inside = await generateWAMessageContent(content, {
        upload: sock.waUploadToServer,
        logger: sock.logger
      });
      const messageSecret = crypto.randomBytes(32);
      const msg = await generateWAMessageFromContent(jid, {
        messageContextInfo: { messageSecret },
        groupStatusMessageV2: {
          message: { ...inside, messageContextInfo: { messageSecret } }
        }
      }, { userJid: m.sender });

      await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
      m.reply(`✅ Story berhasil dikirim ke grup ini.`);
    } catch (err) {
      console.error("[swgrup] Error:", err.message);
      m.reply("❌ Gagal kirim story: " + err.message);
    }
  }
  break;

  case "autoswgrup": {
    if (!isOwner) return m.reply(mess.owner);
    const sub = args[0]?.toLowerCase();
    if (sub === "on") {
      db.settings.autojpmswgc.enabled = true;
      m.reply("✅ Auto story grup diaktifkan");
    } else if (sub === "off") {
      db.settings.autojpmswgc.enabled = false;
      m.reply("✅ Auto story grup dimatikan");
    } else if (sub === "status") {
      const s    = db.settings.autojpmswgc;
      const last = s.lastRun ? new Date(s.lastRun).toLocaleString("id-ID") : "Belum pernah";
      const next = s.enabled && s.lastRun ? new Date(s.lastRun + s.interval * 60000).toLocaleString("id-ID") : "-";
      const mi   = s.media ? (s.media.type === "image" ? "Gambar ✅" : "Video ✅") : "Tidak ada";
      m.reply(`*Status Auto Story Grup*\n\nEnabled: ${s.enabled ? "✅" : "❌"}\nPesan: ${s.message}\nMedia: ${mi}\nInterval: ${s.interval} menit\nTerakhir: ${last}\nBerikutnya: ${next}`);
    } else {
      m.reply(`*Penggunaan Auto Story Grup*\n\n• ${cmd} on\n• ${cmd} off\n• ${cmd} status`);
    }
  }
  break;

  case "setswgrup": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`*Contoh:* ${cmd} 1jam|Halo semua\n\nKirim dengan GAMBAR atau VIDEO untuk menyertakan media.\nFormat interval: 1jam, 30menit, 120detik`);

    const pipeIndex = text.indexOf("|");
    if (pipeIndex === -1) return m.reply("Gunakan format: interval|pesan\nContoh: 1jam|Halo semua");

    const intervalStr = text.substring(0, pipeIndex).trim();
    const newMsg      = text.substring(pipeIndex + 1).trim();
    if (!newMsg) return m.reply("Masukkan teks pesan!");

    let interval = db.settings.autojpmswgc.interval;
    if (intervalStr) {
      const parsed = parseDuration(intervalStr);
      if (!parsed) return m.reply("Format interval salah. Contoh: 1jam, 30menit");
      interval = parsed;
    }

    let media = null;
    if (/image/.test(mime)) {
      const buffer = m.quoted ? await m.quoted.download() : await m.download();
      if (buffer) media = { type: "image", data: buffer.toString("base64"), mimetype: mime };
    } else if (/video/.test(mime)) {
      const buffer = m.quoted ? await m.quoted.download() : await m.download();
      if (buffer) media = { type: "video", data: buffer.toString("base64"), mimetype: mime };
    }

    db.settings.autojpmswgc.message  = newMsg;
    db.settings.autojpmswgc.media    = media;
    db.settings.autojpmswgc.interval = interval;

    let reply = `✅ Setting auto story grup diperbarui!\nPesan: "${newMsg.substring(0, 80)}"\nInterval: ${interval} menit`;
    if (media) reply += `\nMedia: ${media.type} ✅`;
    else reply += "\n(Tanpa media)";
    m.reply(reply);
  }
  break;
  
  case "autojpm": {
    if (!isOwner) return m.reply(mess.owner);
    const sub = args[0]?.toLowerCase();
    if (sub === "on") {
      db.settings.autojpm.enabled = true;
      m.reply("✅ Autojpm diaktifkan");
    } else if (sub === "off") {
      db.settings.autojpm.enabled = false;
      m.reply("✅ Autojpm dimatikan");
    } else if (sub === "status") {
      const s    = db.settings.autojpm;
      const last = s.lastRun ? new Date(s.lastRun).toLocaleString("id-ID") : "Belum pernah";
      const next = s.enabled && s.lastRun ? new Date(s.lastRun + s.interval * 60000).toLocaleString("id-ID") : "-";
      m.reply(`*Status Autojpm*\n\nEnabled: ${s.enabled ? "✅" : "❌"}\nPesan: ${s.message}\nMedia: ${s.media ? "✅" : "❌"}\nInterval: ${s.interval} menit\nBlacklist: ${s.blacklist.length} grup\nTerakhir: ${last}\nBerikutnya: ${next}`);
    } else {
      m.reply(`*Penggunaan Autojpm*\n\n• ${cmd} on\n• ${cmd} off\n• ${cmd} status`);
    }
  }
  break;

  case "setjpm": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`*Contoh:* ${cmd} Halo semuanya|1jam\n\nKirim dengan media (gambar/video) untuk menyertakan media.`);

    let [newMsg, intervalStr] = text.split("|").map(s => s.trim());
    if (!newMsg) return m.reply("Masukkan teks pesan!");

    let interval = db.settings.autojpm.interval;
    if (intervalStr) {
      const parsed = parseDuration(intervalStr);
      if (!parsed) return m.reply("Format interval salah. Contoh: 1jam, 30menit");
      interval = parsed;
    }

    let media = null;
    if (/image|video/.test(mime)) {
      const buffer = m.quoted ? await m.quoted.download() : await m.download();
      if (buffer) {
        media = {
          type: mime.includes("image") ? "image" : "video",
          data: buffer.toString("base64"),
          mimetype: mime
        };
      }
    }

    db.settings.autojpm.message  = newMsg;
    db.settings.autojpm.media    = media;
    db.settings.autojpm.interval = interval;

    let reply = `✅ Setting autojpm diperbarui!\nPesan: "${newMsg}"\nInterval: ${interval} menit`;
    if (media) reply += `\nMedia: ${media.type} ✅`;
    else reply += "\n(Tanpa media)";
    m.reply(reply);
  }
  break;

  case "listgc": {
    if (!isOwner) return m.reply(mess.owner);
    const groups = await sock.groupFetchAllParticipating();
    let teks = `📌 *Daftar Grup Bot* (${Object.keys(groups).length} grup)\n\n`;
    let no   = 1;
    for (let id in groups) {
      teks += `${no}. ${groups[id].subject}\n   ID: ${id}\n\n`;
      no++;
    }
    m.reply(teks.trim());
  }
  break;

  case "joinallgrup": {
    if (!isOwner) return m.reply(mess.owner);
    const sub = args[0]?.toLowerCase();

    if (!sub) {
      let content = text;
      if (m.quoted && m.quoted.text) content = m.quoted.text;
      if (!content) {
        return m.reply(
          `*Cara penggunaan:*\n1. Reply pesan berisi link grup WA\n2. Langsung ketik: ${cmd} https://chat.whatsapp.com/kode1\n\n*Contoh:*\n${cmd} https://chat.whatsapp.com/abc123 https://chat.whatsapp.com/xyz789`
        );
      }
      const inviteRegex = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]{22})/gi;
      const matches     = [...content.matchAll(inviteRegex)];
      if (matches.length === 0) return m.reply("❌ Tidak ditemukan link grup WA yang valid.");
      const inviteCodes = matches.map(x => x[1]);
      global.pendingJoinLinks = inviteCodes;
      m.reply(`🔗 *Ditemukan ${inviteCodes.length} link grup*\n${inviteCodes.map((c, i) => `${i+1}. chat.whatsapp.com/${c}`).join("\n")}\n\nKetik: ${prefix}joinallgrup semua\nUntuk membatalkan: ${prefix}joinallgrup batal`);
    }
    else if (sub === "semua") {
      if (!global.pendingJoinLinks) return m.reply("❌ Tidak ada link yang tertunda. Ulangi perintah.");
      const links = global.pendingJoinLinks;
      await m.reply(`🔄 Memproses join ke ${links.length} grup...`);
      let success = 0, fail = 0, failedLinks = [];
      for (const code of links) {
        try {
          await sock.groupAcceptInvite(code);
          success++;
          await m.reply(`✅ Berhasil join: ${code}`);
        } catch (err) {
          fail++;
          failedLinks.push(code);
          await m.reply(`❌ Gagal join ${code}: ${err.message || "Error"}`);
        }
        await sleep(3000);
      }
      let resultMsg = `📊 *Hasil Join Grup*\n✅ Sukses: ${success}\n❌ Gagal: ${fail}`;
      if (failedLinks.length) resultMsg += `\n\nGagal:\n${failedLinks.map(c => `- ${c}`).join("\n")}`;
      await m.reply(resultMsg);
      delete global.pendingJoinLinks;
    }
    else if (sub === "batal") {
      delete global.pendingJoinLinks;
      m.reply("❌ Aksi dibatalkan.");
    }
    else {
      m.reply(`*Penggunaan joinallgrup:*\n• ${cmd} [link/link2/...]\n• ${cmd} semua (setelah input link)\n• ${cmd} batal`);
    }
  }
  break;

  // ========== OUT ALL GRUP ==========
  case "outallgrup": {
    if (!isOwner) return m.reply(mess.owner);
    const sub = args[0]?.toLowerCase();

    if (sub === "semua") {
      const groups = await sock.groupFetchAllParticipating();
      const total  = Object.keys(groups).length;
      m.reply(`⚠️ Akan keluar dari SEMUA grup (${total} grup).\n\nKetik: ${prefix}outallgrup semua-confirm\nBatalkan: ${prefix}outallgrup batal`);
    }
    else if (sub === "semua-confirm") {
      await m.reply("🚪 Mengeluarkan bot dari semua grup...");
      const groups = await sock.groupFetchAllParticipating();
      let success = 0, fail = 0;
      for (const [jid, meta] of Object.entries(groups)) {
        try {
          await sock.groupLeave(jid);
          success++;
          await m.reply(`✅ Keluar: ${meta.subject}`);
        } catch {
          fail++;
          await m.reply(`❌ Gagal: ${meta.subject}`);
        }
        await sleep(2000);
      }
      m.reply(`📊 Selesai\n✅ Berhasil: ${success}\n❌ Gagal: ${fail}`);
    }
    else if (sub === "tertutup") {
      await m.reply("🔍 Mendeteksi grup tertutup...");
      const groups      = await sock.groupFetchAllParticipating();
      const closedGroups = [];
      for (const [jid, meta] of Object.entries(groups)) {
        try { await sock.groupInviteCode(jid); } catch { closedGroups.push({ jid, subject: meta.subject }); }
        await sleep(1000);
      }
      if (closedGroups.length === 0) return m.reply("✅ Tidak ada grup tertutup.");
      global.closedGroupsList = closedGroups;
      let info = `⚠️ Ditemukan *${closedGroups.length} grup tertutup*:\n`;
      closedGroups.slice(0, 10).forEach((g, i) => info += `${i+1}. ${g.subject}\n`);
      if (closedGroups.length > 10) info += `...dan ${closedGroups.length - 10} lainnya.\n`;
      info += `\nKetik: ${prefix}outallgrup tertutup-confirm\nBatalkan: ${prefix}outallgrup batal`;
      m.reply(info);
    }
    else if (sub === "tertutup-confirm") {
      if (!global.closedGroupsList) return m.reply("❌ Tidak ada data. Jalankan .outallgrup tertutup dulu.");
      await m.reply(`🚪 Keluar dari ${global.closedGroupsList.length} grup tertutup...`);
      let success = 0, fail = 0;
      for (const g of global.closedGroupsList) {
        try {
          await sock.groupLeave(g.jid);
          success++;
          await m.reply(`✅ Keluar: ${g.subject}`);
        } catch {
          fail++;
          await m.reply(`❌ Gagal: ${g.subject}`);
        }
        await sleep(2000);
      }
      delete global.closedGroupsList;
      m.reply(`📊 Selesai\n✅ Berhasil: ${success}\n❌ Gagal: ${fail}`);
    }
    else if (sub === "batal") {
      delete global.closedGroupsList;
      delete global.pendingOutAll;
      m.reply("❌ Aksi dibatalkan.");
    }
    else {
      m.reply(`*Penggunaan outallgrup:*\n• ${cmd} semua — keluar semua grup\n• ${cmd} tertutup — keluar dari grup tertutup (no invite link)\n• ${cmd} batal — batalkan`);
    }
  }
  break;

  case "backupsc":
  case "bck":
  case "backup": {
    if (!isOwner) return m.reply(mess.owner);
    try {
      const tmpDir = "./sampah";
      if (fs.existsSync(tmpDir)) {
        const files = fs.readdirSync(tmpDir).filter(f => f !== "X");
        for (let file of files) fs.unlinkSync(`${tmpDir}/${file}`);
      }
      await m.reply("📦 Backup Script Bot, tunggu sebentar...");

      const name    = `${global.botName}-${global.versionBot}`;
      const exclude = ["node_modules","skyzopedia","session","package-lock.json","yarn.lock",".npm",".cache",".git","sampah"];
      const allItems = fs.readdirSync(".", { withFileTypes: true });
      const filesToZip = [];
      allItems.forEach(item => {
        if (!exclude.includes(item.name)) filesToZip.push(item.name);
      });

      if (!filesToZip.length) return m.reply("Tidak ada file yang dapat di-backup.");
      const excludeArgs = exclude.map(e => `-x "${e}/*"`).join(" ");
      execSync(`zip -r ${name}.zip ${filesToZip.join(" ")} ${excludeArgs}`);

      await sock.sendMessage(m.sender, {
        document: fs.readFileSync(`./${name}.zip`),
        fileName: `${name}.zip`,
        mimetype: "application/zip",
        caption:  `Backup ${global.botName} ${global.versionBot}`
      }, { quoted: m });

      fs.unlinkSync(`./${name}.zip`);
      if (m.chat !== m.sender) m.reply("✅ Script Bot berhasil dikirim ke Private Chat.");
    } catch (err) {
      console.error("Backup Error:", err);
      m.reply("❌ Terjadi kesalahan saat backup: " + err.message);
    }
  }
  break;

  case "resetsc": {
    if (!isOwner) return m.reply(mess.owner);
    const sub = args[0]?.toLowerCase();

    if (sub === "confirm") {
      try {
        const defaultDb = {
          users: {},
          groups: {},
          settings: {
            bljpm: [], owner: [], list: {},
            namaSaveContact: "Customer",
            jedaPushkontak: 2000,
            blacklistJpm: [],
            delayJaser: 4000,
            autojpm: { enabled: false, message: "Halo ini pesan otomatis", media: null, interval: 60, lastRun: 0, blacklist: [] },
            autojpmswgc: { enabled: false, message: "Halo ini story otomatis", media: null, interval: 60, lastRun: 0, blacklist: [] },
            autoJoinGC: { enabled: false }
          }
        };
        global.db = defaultDb;
        const DataBase = require("./lib/database.js");
        const dbFile   = new DataBase();
        await dbFile.write(global.db);
        await m.reply("✅ *Database berhasil direset ke default!*");
      } catch (err) {
        console.error("Reset DB error:", err);
        m.reply(`❌ Gagal reset database: ${err.message}`);
      }
    }
    else if (sub === "cancel") {
      m.reply("❌ Reset database dibatalkan.");
    }
    else {
      m.reply(`⚠️ *PERINGATAN!*\n\nPerintah ini akan MENGHAPUS semua data:\n• Data user (premium, dll)\n• Data grup (antilink, welcome, dll)\n• Pengaturan autojpm, pushkontak, dll\n\n*Konfirmasi:* ${prefix}resetsc confirm\n*Batal:* ${prefix}resetsc cancel`);
    }
  }
  break;

  case "payment":
  case "pay":
  case "dana":
  case "ovo":
  case "gopay":
  case "qris": {
    if (!isOwner) return m.reply(mess.owner);

    // QRIS — kirim gambar
    if (command === "qris" || command === "payment" || command === "pay") {
      if (!global.qris) return m.reply("❌ QRIS belum disetel di config.js");
      return sock.sendMessage(m.chat, {
        image: { url: global.qris },
        caption: "Scan QRIS untuk melakukan pembayaran."
      }, { quoted: m });
    }

    // E-Wallet — payment_key_info button
    let wallet = {};
    if (command === "dana")  wallet = { name: "DANA",  key: global.dana  };
    if (command === "ovo")   wallet = { name: "OVO",   key: global.ovo   };
    if (command === "gopay") wallet = { name: "GoPay", key: global.gopay };

    if (!wallet.name || !wallet.key) return m.reply("❌ E-wallet belum disetel di config.js");

    await sock.relayMessage(
      m.chat,
      {
        interactiveMessage: {
          body: { text: "" },
          nativeFlowMessage: {
            buttons: [
              {
                name: "payment_key_info",
                buttonParamsJson: JSON.stringify({
                  currency: "IDR",
                  total_amount: { value: 0, offset: 100 },
                  reference_id: `${wallet.name}-${Date.now()}`,
                  type: "digital-goods",
                  order: {
                    status: "pending",
                    subtotal: { value: 0, offset: 100 },
                    order_type: "ORDER",
                    items: [
                      {
                        name: `Pembayaran ${wallet.name}`,
                        amount: { value: 0, offset: 100 },
                        quantity: 1,
                        sale_amount: { value: 0, offset: 100 }
                      }
                    ]
                  },
                  payment_settings: [
                    {
                      type: "payment_key",
                      payment_key: {
                        type: "IDPAYMENTACCOUNT",
                        key: wallet.key,
                        name: wallet.name,
                        institution_name: wallet.name,
                        full_name_on_account: global.ownername,
                        account_type: "ewallet"
                      }
                    }
                  ],
                  share_payment_status: false,
                  referral: "chat_attachment"
                })
              }
            ]
          }
        }
      },
      {
        additionalNodes: [
          { tag: "biz", attrs: { native_flow_name: "payment_key_info" } }
        ],
        userJid: m.chat
      }
    );
  }
  break;

  case "done":
  case "proses": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`*Contoh:* ${cmd} Nama Barang`);

    const status = command === "done" ? "Done ✅" : "Proses 🔄";
    const tanggal = new Date().toLocaleDateString("id-ID", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
    const pesan = `𝗧𝗲𝗿𝗶𝗺𝗮𝗸𝗮𝘀𝗶𝗵 𝗧𝗲𝗹𝗮𝗵 𝗢𝗿𝗱𝗲𝗿 ✅\n📦 ${text}\n📃 Status : ${status}\n📆 ${tanggal}\n\n~${global.botName} ${global.versionBot}`;
    await sock.sendMessage(m.chat, { text: pesan }, { quoted: m });
  }
  break;

  case "stalkch":
  case "sch":
  case "idch":
  case "cekidch": {
    if (!text) return m.reply(`*Contoh:* ${cmd} link/id channel`);
    if (!text.includes("https://whatsapp.com/channel/") && !text.includes("@newsletter"))
      return m.reply("Link atau id channel tidak valid");

    let result = text.trim(), opsi = "jid";
    if (text.includes("https://whatsapp.com/channel/")) {
      result = text.split("https://whatsapp.com/channel/")[1];
      opsi   = "invite";
    }

    const res  = await sock.newsletterMetadata(opsi, result);
    const teks =
      `*Channel Information 🌍*\n\n` +
      `- Nama: ${res.name}\n` +
      `- Total Pengikut: ${toRupiah(res.subscribers)}\n` +
      `- ID: ${res.id}\n` +
      `- Link: https://whatsapp.com/channel/${res.invite}`;

    const msg = generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: { text: teks },
            nativeFlowMessage: {
              buttons: [{ name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "Copy Channel ID", copy_code: res.id }) }]
            }
          }
        }
      }
    }, { userJid: m.sender, quoted: m });

    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
  }
  break;

  case "pushkontak":
  case "puskontak": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`*Contoh:* ${cmd} isi pesan`);

    global.textpushkontak = text;
    const groups = await sock.groupFetchAllParticipating();
    if (!groups || Object.keys(groups).length === 0)
      return m.reply("❌ Bot tidak tergabung di grup manapun.");

    global.dataAllGrup = groups;
    const rows = Object.values(groups).map(g => ({
      title: g.subject || "Tanpa Nama",
      description: `👥 ${g.participants.length} member`,
      id: `.pushkontak-response ${g.id}`
    }));

    await sock.sendMessage(m.chat, {
      text: `📢 *PUSH KONTAK*\n\nSilahkan pilih grup target:\nPesan: ${text}`,
      viewOnce: true,
      buttons: [{
        buttonId: "select_gc",
        buttonText: { displayText: "📂 Pilih Grup" },
        type: 4,
        nativeFlowInfo: {
          name: "single_select",
          paramsJson: JSON.stringify({ title: "Daftar Grup", sections: [{ title: "Pilih Target Grup", rows }] })
        }
      }],
      headerType: 1
    }, { quoted: m });
  }
  break;

  case "pushkontak-response": {
    if (!isOwner) return;
    if (!global.textpushkontak || !global.dataAllGrup)
      return m.reply("❌ Data pushkontak tidak ditemukan\nSilahkan ulangi dengan *.pushkontak pesan*");

    const groupId   = text;
    const groupData = global.dataAllGrup[groupId];
    if (!groupData) return m.reply("❌ Grup tidak ditemukan.");

    const messageText = global.textpushkontak;
    const members     = groupData.participants.map(v => v.id).filter(jid => jid && jid !== m.botNumber);
    global.statusPushkontak = true;

    await m.reply(`🚀 *Memulai Pushkontak*\n\n📌 Grup : *${groupData.subject}*\n👥 Total : *${members.length} member*`);

    let success = 0;
    for (const jid of members) {
      try {
        if (!global.statusPushkontak) break;
        await sock.sendMessage(jid, { text: messageText }, { quoted: qtext });
        success++;
        await sleep(global.jedaPushkontak || 10000);
      } catch (e) { console.log("Gagal push ke:", jid); }
    }

    delete global.textpushkontak;
    delete global.dataAllGrup;
    global.statusPushkontak = false;
    m.reply(`✅ *Pushkontak Selesai*\n\n📤 Berhasil ke *${success}/${members.length} member*`);
  }
  break;

  case "stoppush": {
    if (!isOwner) return m.reply(mess.owner);
    if (!global.statusPushkontak) return m.reply("Tidak ada pushkontak yang sedang berjalan!");
    global.statusPushkontak = false;
    m.reply("✅ Berhasil menghentikan pushkontak.");
  }
  break;

  case "sticker":
  case "stiker":
  case "sgif":
  case "s": {
    if (!/image|video/.test(mime)) return m.reply(`*ex:* ${cmd} dengan kirim atau reply image`);
    if (/video/.test(mime)) {
      if ((qmsg).seconds > 15) return m.reply("Durasi video maksimal 15 detik!");
    }
    try {
      const media = m.quoted ? await m.quoted.download() : await m.download();
      await sock.sendSticker(m.chat, media, m, { packname: global.ownername });
    } catch (err) {
      console.log(err);
      return m.reply("Error! gagal convert gambar to sticker.");
    }
  }
  break;

  case "tourl": {
    if (!/image/.test(mime)) return m.reply(`*ex:* ${cmd} dengan kirim atau reply image`);
    try {
      const buffer     = m.quoted ? await m.quoted.download() : await m.download();
      const directLink = await uploadImageBuffer(buffer);
      let msg = generateWAMessageFromContent(m.chat, {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              body: { text: `✅ Foto berhasil diupload!\n\nURL: ${directLink}` },
              nativeFlowMessage: {
                buttons: [{ name: "cta_copy", buttonParamsJson: `{"display_text":"Copy URL","copy_code":"${directLink}"}` }]
              }
            }
          }
        }
      }, { userJid: m.sender, quoted: m });
      await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
    } catch (err) {
      console.error("Tourl Error:", err);
      m.reply("Terjadi kesalahan saat mengubah media menjadi URL.");
    }
  }
  break;

  case "igdl":
  case "instagram":
  case "ig": {
    if (!text) return m.reply(`*ex:* ${cmd} https://www.instagram.com/reel/xxx`);
    if (!/instagram\.com/.test(text)) return m.reply(`*ex:* ${cmd} https://www.instagram.com/reel/xxx`);
    try {
      await m.reply("Downloading instagram, tunggu sebentar...");
      const data = await fetchJson(`https://skyzopedia-api.vercel.app/download/instagram?apikey=skyy&url=${text}`).then(res => res.result);
      if (!data[0]?.url_download) return m.reply("Error! data Instagram tidak ditemukan.");
      const album = [];
      for (let i of data) {
        if (/Video/.test(i.kualitas)) {
          await sock.sendMessage(m.chat, { video: { url: i.url_download }, caption: "Instagram Downloader ✅", mimetype: "video/mp4" }, { quoted: m });
        } else {
          album.push({ image: { url: i.url_download }, caption: "Instagram Downloader ✅" });
        }
      }
      if (album.length > 1) await sock.sendAlbum(m.chat, { albumMessage: album }, m);
    } catch (err) {
      console.log(err);
      m.reply("Terjadi kesalahan saat mengambil data Instagram.");
    }
  }
  break;

  case "tt":
  case "tiktok":
  case "ttdl": {
    if (!text) return m.reply(`*ex:* ${cmd} https://vt.tiktok.com/xxx/`);
    if (!text.startsWith("https://")) return m.reply(`*ex:* ${cmd} https://vt.tiktok.com/xxx/`);
    const res = await tiktok(`${text}`);
    if (!res.data) return m.reply("Error! data result tidak ditemukan.");
    await m.reply("Mendownload data link tiktok...");
    if (res.data.images && res.data.images.length !== 0) {
      let album = [];
      for (let i of res.data.images) album.push({ image: { url: i }, caption: "Tiktok Slide Downloader ✅" });
      await sock.sendMessage(m.chat, { album }, { quoted: m });
    } else {
      await sock.sendMessage(m.chat, { video: { url: res.data.hdplay || res.data.play }, caption: "Tiktok Downloader ✅" }, { quoted: m });
    }
    if (res.data.music) {
      await sock.sendMessage(m.chat, { audio: { url: res.data.music }, mimetype: "audio/mpeg", ptt: false }, { quoted: m });
    }
  }
  break;
  
  case "npmdl":
  case "npminstall": {
  if (!isOwner) return m.reply(mess.owner);
  if (!text) return m.reply(`*Contoh:* ${cmd} axios\nBisa multiple: ${cmd} axios chalk fs`);

  const packages = text.trim().split(" ").filter(p => p);
  await m.reply(`📦 Menginstall ${packages.length} package...\n${packages.map(p => `• ${p}`).join("\n")}`);

  exec(`npm install ${packages.join(" ")}`, (err, stdout, stderr) => {
    if (err) return m.reply(`❌ Gagal install:\n${stderr || err.message}`);
    m.reply(`✅ Berhasil install:\n${packages.map(p => `• ${p}`).join("\n")}\n\n${stdout.slice(0, 500)}`);
  });
}
break;

  case "self": {
    if (!isOwner) return;
    if (global.botMode === "self") return m.reply("Bot sudah dalam mode *Self* ✅");
    global.botMode = "self";
    await m.react("🔒");
    m.reply("🔒 *Bot berhasil diubah ke mode Self*");
  }
  break;

  case "public": {
    if (!isOwner) return;
    if (global.botMode === "public") return m.reply("Bot sudah dalam mode *Public* ✅");
    global.botMode = "public";
    await m.react("🌐");
    m.reply("🌐 *Bot berhasil diubah ke mode Public*");
  }
  break;
  
  default:
    if (m.body.toLowerCase().startsWith("xx ")) {
      if (!isOwner) return;
      try {
        const r = await eval(`(async()=>{${text}})()`);
        sock.sendMessage(m.chat, { text: util.format(typeof r === "string" ? r : util.inspect(r)) }, { quoted: m });
      } catch (e) {
        sock.sendMessage(m.chat, { text: util.format(e) }, { quoted: m });
      }
    }

    if (m.body.toLowerCase().startsWith("x ")) {
      if (!isOwner) return;
      try {
        let r = await eval(text);
        sock.sendMessage(m.chat, { text: util.format(typeof r === "string" ? r : util.inspect(r)) }, { quoted: m });
      } catch (e) {
        sock.sendMessage(m.chat, { text: util.format(e) }, { quoted: m });
      }
    }

    if (m.body.startsWith("$ ")) {
      if (!isOwner) return;
      exec(m.body.slice(2), (e, out) =>
        sock.sendMessage(m.chat, { text: util.format(e ? e : out) }, { quoted: m })
      );
    }
  }

  if (global.db.settings.autoJoinGC?.enabled && m.body) {
    const inviteRegex = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]{22})/i;
    const match       = m.body.match(inviteRegex);
    if (match && match[1]) {
      const inviteCode = match[1];
      try {
        await sock.groupAcceptInvite(inviteCode);
        console.log(`[AUTOJOIN] ✅ Join grup: ${inviteCode} (dari: ${m.chat})`);
      } catch (e) {
        console.log(`[AUTOJOIN] ❌ Gagal ${inviteCode}: ${e.message}`);
      }
      await sleep(2000);
    }
  }
};

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  delete require.cache[file];
  require(file);
});
