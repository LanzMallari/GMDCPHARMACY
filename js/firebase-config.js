import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    collection, 
    addDoc, 
    getDocs, 
    query, 
    where, 
    orderBy, 
    updateDoc,
    deleteDoc,
    onSnapshot,
    Timestamp,
    limit,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBC2clVV47BUQt_9cdkVFE6ZY-L6WOXTxA",
    authDomain: "gmdcpharmacy.firebaseapp.com",
    projectId: "gmdcpharmacy",
    storageBucket: "gmdcpharmacy.firebasestorage.app",
    messagingSenderId: "361255445616",
    appId: "1:361255445616:web:36d9a9cb07ad091839c0b5",
    measurementId: "G-02ZNC5K9FQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db, doc, getDoc, collection, addDoc, getDocs, query, where, orderBy, updateDoc, deleteDoc, onSnapshot, Timestamp, limit, writeBatch };