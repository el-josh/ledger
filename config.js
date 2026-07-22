/* ---------------------------------------------------------------------------
   Ledger — sync configuration
   ---------------------------------------------------------------------------
   Firebase web-app config that powers "Sign in with Google" and cross-device
   sync. These values are NOT secrets — Firebase web API keys are meant to ship
   in client code. Access is protected by Firebase Auth + the Firestore security
   rules in firestore.rules (each user can only touch their own document).

   Setup steps are in README.md → "Cross-device sync".
--------------------------------------------------------------------------- */
window.LEDGER_CONFIG = {
  firebase: {
    apiKey: "AIzaSyAOJ8vAsK2USIgd99WrthQNFuyoxz1fvZM",
    authDomain: "ledger-e351b.firebaseapp.com",
    projectId: "ledger-e351b",
    storageBucket: "ledger-e351b.firebasestorage.app",
    messagingSenderId: "667314385281",
    appId: "1:667314385281:web:15ca5b202f688f6d097880",
    measurementId: "G-5942BTQ9S3"
  }
};
