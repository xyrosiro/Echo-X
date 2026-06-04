require("../config.js");
const {
  extractMessageContent,
  jidNormalizedUser,
  proto,
  delay,
  getContentType,
  areJidsSameUser,
  generateWAMessage
} = require("@whiskeysockets/baileys");

const serialize = async (conn, m) => {
  if (!m) return m;
  const { WebMessageInfo } = proto;
  if (m.key) {
    m.id = m.key.id;
    m.chat = /@s.whatsapp.net/.test(m.key.remoteJid) ? await conn.toLid(m.key.remoteJid) : m.key.remoteJid
    m.isBaileys = m.id
      ? (
          m.id.startsWith("3EB0") ||
          m.id.startsWith("B1E") ||
          m.id.startsWith("BAE") ||
          m.id.startsWith("3F8") ||
          m.id.length < 32 || m.id.length == 18
        )
      : false;
    m.fromMe = m.key.fromMe;
    m.botNumber = conn.user.lid.split(":")[0]+"@lid"
    let ownerNum = await conn.toLid(global.owner+"@s.whatsapp.net")    
    m.isChannel = m.chat.endsWith("@newsletter");
    m.isGroup = m.chat.endsWith("@g.us");
    let sender = await conn.decodeJid(
      m.fromMe ? conn.user.id : (m.participant || m.key.participant || m.chat)
    );
    m.sender = /@s.whatsapp.net/.test(sender) ? await conn.toLid(sender) : sender
    m.isOwner = m.sender == m.botNumber || m.sender == ownerNum
    if (m.isGroup) m.participant = m.key.participant && /@s.whatsapp.net/.test(m.key.participant) ? await conn.toLid(m.key.participant) : m.key.participant
  }
  if (m.message) {
    m.mtype = await getContentType(m.message);
    m.prefix = ".";
    const content = m.message[m.mtype];
    m.msg =
      m.mtype === "viewOnceMessage"
        ? m.message[m.mtype].message[
            getContentType(m.message[m.mtype].message)
          ]
        : content;
    m.body =
      m?.message?.conversation ||
      m?.msg?.caption ||
      m?.msg?.text ||
      (m.mtype === "extendedTextMessage" && m.msg.text) ||
      (m.mtype === "buttonsResponseMessage" && m.msg.selectedButtonId) ||
      (m.mtype === "interactiveResponseMessage" &&
        JSON.parse(m.msg.nativeFlowResponseMessage.paramsJson)?.id) ||
      (m.mtype === "templateButtonReplyMessage" && m.msg.selectedId) ||
      (m.mtype === "listResponseMessage" &&
        m.msg.singleSelectReply?.selectedRowId) ||
      "";
    const quotedMessage = (m.quoted = m.msg?.contextInfo?.quotedMessage || null);
    m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
    if (quotedMessage) {
      let qType = getContentType(quotedMessage);
      m.quoted = quotedMessage[qType];
      if (qType === "productMessage") {
        qType = getContentType(m.quoted);
        m.quoted = m.quoted[qType];
      }
      if (typeof m.quoted === "string") m.quoted = { text: m.quoted };
      if (m.quoted) {
        m.quoted.key = {
          remoteJid: m.msg.contextInfo.remoteJid || m.from,
          participant: m.msg.contextInfo.participant && /@s.whatsapp.net/.test(m.msg.contextInfo.participant) ? await conn.toLid(m.msg.contextInfo.participant) : m.msg.contextInfo.participant,
          fromMe: areJidsSameUser(
            jidNormalizedUser(m.msg.contextInfo.participant),
            jidNormalizedUser(conn.user.id)
          ),
          id: m.msg.contextInfo.stanzaId
        };
        m.quoted.mtype = qType;
        m.quoted.chat = /@s.whatsapp.net/.test(m.quoted.key.remoteJid) ? await conn.toLid(m.quoted.key.remoteJid) : m.quoted.key.remoteJid;
        m.quoted.id = m.quoted.key.id;
        m.quoted.isBaileys = m.quoted.id
          ? (
              m.quoted.id.startsWith("3EB0") ||
              m.quoted.id.startsWith("B1E") ||
              m.quoted.id.startsWith("3F8") ||
              m.quoted.id.startsWith("BAE") ||
              m.quoted.id.length < 32
            )
          : false;
        m.quoted.sender = await conn.decodeJid(m.quoted.key.participant);
        m.quoted.fromMe = m.quoted.sender === conn.user.id;
        m.quoted.text =
          m.quoted.text ||
          m.quoted.caption ||
          m.quoted.conversation ||
          m.quoted.contentText ||
          m.quoted.selectedDisplayText ||
          m.quoted.title ||
          "";
        m.quoted.mentionedJid = m.msg.contextInfo?.mentionedJid || [];
        const fakeObj = (m.quoted.fakeObj = WebMessageInfo.fromObject({
          key: m.quoted.key,
          message: quotedMessage,
          ...(m.isGroup ? { participant: m.quoted.sender } : {})
        }));
        m.quoted.download = (saveToFile = false) =>
          conn.downloadMediaMessage(
            m.quoted,
            m.quoted.mtype.replace(/message/i, ""),
            saveToFile
          );
      }
    }
  }
  if (m.msg?.url) {
    m.download = (saveToFile = false) =>
      conn.downloadMediaMessage(
        m.msg,
        m.mtype.replace(/message/i, ""),
        saveToFile
      );
  }
  m.text = m.body;
  m.reply = async (text, options = {}) => {
    const chatId = options.chat || m.chat;
    const quoted = options.quoted || m;
    const mentions = [...text.matchAll(/@(\d{0,19})/g)].map(
      v => v[1] + "@lid"
    );
    return conn.sendMessage(
      chatId,
      { text, mentions, ...options },
      { quoted }
    );
  };
  m.react = async (emoji) => {
    return conn.sendMessage(m.chat, {
      react: {
        text: emoji,
        key: m.key
      }
    });
  };
  return m;
};

module.exports = serialize