const fs = require("fs");

global.pairingNumber = "628"
global.owner = "628"
global.ownername = "Xsiro"
global.linkOwner = "https://t.me/XyroSiro"
global.prefix = "."
global.botName = "Echo-X"
global.versionBot = "v2.0"
global.thumbnail = "https://img2.pixhost.to/images/8336/733488642_image.jpg"
global.jedaPushkontak = 10000
global.botMode = "self"

global.gopay = "08"   
global.dana = "08"   
global.ovo = "08"  
global.qris = "https://img2.pixhost.to/images/6667/707640847_image.jpg"   

global.mess = {
  owner: "Fitur ini hanya bisa digunakan oleh *Owner Bot*.",
  premium: "Fitur ini hanya bisa digunakan oleh *User Premium*.",
  group: "Fitur ini hanya dapat digunakan di dalam grup.",
  private: "Fitur ini hanya dapat digunakan di private chat.",
  admin: "Fitur ini hanya bisa digunakan oleh admin grup.",
  botadmin: "Fitur ini hanya dapat digunakan jika bot adalah admin grup.",
}

let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  delete require.cache[file]
  require(file)
})
