async function LoadDataBase(conn, m) {
  try {
    if (typeof global.db.users   !== 'object') global.db.users   = {};
    if (typeof global.db.groups  !== 'object') global.db.groups  = {};
    if (typeof global.db.settings !== 'object') global.db.settings = {};

    // ===== Default Settings Echo-X 1.5 =====
    const defaultSettings = {
      bljpm:           [],
      owner:           [],
      list:            {},
      delayJaser:      4000,
      blacklistJpm:    [],
      namaSaveContact: "Customer",
      jedaPushkontak:  2000,
      autojpm: {
        enabled:   false,
        message:   "Halo ini pesan otomatis dari Echo-X",
        media:     null,
        interval:  60,
        lastRun:   0,
        blacklist: []
      },
      autojpmswgc: {
        enabled:   false,
        message:   "Halo ini story otomatis dari Echo-X",
        media:     null,
        interval:  60,
        lastRun:   0,
        blacklist: []
      },
      autoJoinGC: {
        enabled: false
      }
    };

    for (let key in defaultSettings) {
      if (!(key in global.db.settings)) {
        global.db.settings[key] = defaultSettings[key];
      }
    }

    // Pastikan sub-object autojpm selalu lengkap
    const defJpm = { enabled: false, message: "Halo", media: null, interval: 60, lastRun: 0, blacklist: [] };
    for (let k in defJpm) {
      if (!(k in global.db.settings.autojpm)) global.db.settings.autojpm[k] = defJpm[k];
    }
    const defSwgc = { enabled: false, message: "Halo", media: null, interval: 60, lastRun: 0, blacklist: [] };
    for (let k in defSwgc) {
      if (!(k in global.db.settings.autojpmswgc)) global.db.settings.autojpmswgc[k] = defSwgc[k];
    }
    if (!global.db.settings.autoJoinGC) global.db.settings.autoJoinGC = { enabled: false };

    if (typeof global.db.users[m.sender] !== 'object') global.db.users[m.sender] = {};
    const defaultUser = { premium: false };
    for (let key in defaultUser) {
      if (!(key in global.db.users[m.sender])) global.db.users[m.sender][key] = defaultUser[key];
    }

    if (m.isGroup) {
      if (typeof global.db.groups[m.chat] !== 'object') global.db.groups[m.chat] = {};
      const defaultGroup = { antilink: false, antilink2: false, autopromosi: false, welcome: false };
      for (let key in defaultGroup) {
        if (!(key in global.db.groups[m.chat])) global.db.groups[m.chat][key] = defaultGroup[key];
      }
    }
  } catch (e) {
    throw e;
  }
}

module.exports = LoadDataBase;
