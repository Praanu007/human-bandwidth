window.HB_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

window.HB_FIREBASE_SCHEMA = {
  collections: {
    users: {
      docId: "uid",
      fields: ["name", "email", "role", "status", "lastSeen"]
    },
    players: {
      docId: "uid",
      fields: ["name", "email", "role", "status", "lastSeen", "score"]
    },
    sessions: {
      docId: "sessionId",
      fields: ["sessionStarted", "timerStart", "currentChallenge", "hostId", "updatedAt", "players", "securityCount"]
    },
    'security-events': {
      docId: "auto",
      fields: ["kind", "detail", "ts", "page", "participantId"]
    }
  },
  rules: {
    hostOnly: "Allow read/write only when request.auth != null && request.auth.token.role == 'host'",
    playerRead: "Allow read to players and session data for authenticated users",
    securityWrite: "Allow writes to security-events only for authenticated users"
  }
};

// Replace the empty strings above with your Firebase project values.
// Once configured, the app will automatically use Firebase Auth + Firestore.
// Use the collections above as the real participant/session architecture for the portal.
