// js/firebase-init.js — Firebase starten (Auth + Firestore met lokale cache) en beschikbaar maken als window.FB
//
// Dit is een ES-module. Module-scripts worden uitgevoerd vóór DOMContentLoaded, dus window.FB is
// beschikbaar zodra de rest van de app start.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification,
  signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, query, where, onSnapshot, getDocs, getDoc, setDoc, updateDoc, deleteDoc, writeBatch,
  arrayUnion, arrayRemove, deleteField, increment
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAaGSSf1ynj0gJokIaz8zMnA2sOSSlEefk',
  authDomain: 'kasboek-d2c28.firebaseapp.com',
  projectId: 'kasboek-d2c28',
  storageBucket: 'kasboek-d2c28.firebasestorage.app',
  messagingSenderId: '1031927697583',
  appId: '1:1031927697583:web:c14bbc497484170f60445a'
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Lokale cache in IndexedDB: gegevens staan direct klaar bij het openen van de app, wijzigingen zijn
// meteen zichtbaar en worden op de achtergrond naar de server gestuurd (ook na een herstart of offline).
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (err) {
  console.warn('Lokale cache niet beschikbaar, terugval op geheugen-cache.', err);
  db = initializeFirestore(app, {});
}

window.FB = {
  app, auth, db,
  // auth
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification,
  signOut, updateProfile,
  // firestore
  collection, doc, query, where, onSnapshot, getDocs, getDoc, setDoc, updateDoc, deleteDoc, writeBatch,
  arrayUnion, arrayRemove, deleteField, increment
};
