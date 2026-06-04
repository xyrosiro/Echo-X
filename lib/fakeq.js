require("./function.js");
require("../config.js");
const fs = require("fs");

(async () => {

global.qtext = {
  key: {
    remoteJid: "status@broadcast",
    participant: "0@s.whatsapp.net",
  },
  message: {
    extendedTextMessage: {
      text: `Powered by ${ownername}`,
    },
  },
};
  
  
})();


let file = require.resolve(__filename) 
fs.watchFile(file, () => {
fs.unwatchFile(file)
delete require.cache[file]
require(file)
})