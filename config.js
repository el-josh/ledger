/* ---------------------------------------------------------------------------
   Ledger — sync configuration
   ---------------------------------------------------------------------------
   To turn on "Sign in with Google" and cross-device sync, paste your Firebase
   web-app config below (Firebase console -> Project settings -> "Your apps" ->
   SDK setup and configuration -> Config). Full step-by-step in README.md.

   These values are NOT secrets — Firebase web API keys are meant to ship in
   client code. Access is protected by Firebase Auth + the Firestore security
   rules in firestore.rules (each user can only touch their own document).

   Until real values are filled in (while apiKey still contains "YOUR_"), the
   app runs exactly as before: fully local in this browser, and no sign-in
   button is shown.
--------------------------------------------------------------------------- */
window.LEDGER_CONFIG = {
  firebase: {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  }
};
