import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBtIJiYe64RWM2QUGdBawYr5aS0RxghakQ",
  authDomain: "safeher-ai-1922d.firebaseapp.com",
  projectId: "safeher-ai-1922d",
  messagingSenderId: "150680870648",
  appId: "1:150680870648:web:1ba94aa1f3447b1204e50d"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber
};