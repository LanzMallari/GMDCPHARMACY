import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { getFirestore, setDoc, doc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

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
const auth = getAuth();
const db = getFirestore();

function showMessage(message, divId, isSuccess = true) {
    var messageDiv = document.getElementById(divId);
    messageDiv.style.display = "block";
    messageDiv.innerHTML = message;
    messageDiv.className = isSuccess ? 'message success-message' : 'message error-message';
    messageDiv.style.opacity = 1;
    setTimeout(function () {
        messageDiv.style.opacity = 0;
        messageDiv.style.display = 'none';
    }, 5000);
}

// Sign Up functionality
const signUp = document.getElementById('submitSignUp');
if (signUp) {
    signUp.addEventListener('click', (event) => {
        event.preventDefault();
        const email = document.getElementById('rEmail').value;
        const password = document.getElementById('rPassword').value;
        const firstName = document.getElementById('fName').value;
        const lastName = document.getElementById('lName').value;

        createUserWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                const user = userCredential.user;
                const userData = {
                    email: email,
                    firstName: firstName,
                    lastName: lastName
                };
                
                const docRef = doc(db, "users", user.uid);
                setDoc(docRef, userData)
                    .then(() => {
                        showMessage('Account Created Successfully', 'signUpMessage', true);
                        setTimeout(() => {
                            window.location.href = 'index.html';
                        }, 2000);
                    })
                    .catch((error) => {
                        console.error("error writing document", error);
                        showMessage('Error creating account', 'signUpMessage', false);
                    });
            })
            .catch((error) => {
                const errorCode = error.code;
                if (errorCode == 'auth/email-already-in-use') {
                    showMessage('Email Address Already Exists !!!', 'signUpMessage', false);
                } else {
                    showMessage('Unable to create User', 'signUpMessage', false);
                }
            });
    });
}

// Sign In functionality
const signIn = document.getElementById('submitSignIn');
if (signIn) {
    signIn.addEventListener('click', (event) => {
        event.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                showMessage('Login is successful', 'signInMessage', true);
                const user = userCredential.user;
                localStorage.setItem('loggedInUserId', user.uid);
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1500);
            })
            .catch((error) => {
                const errorCode = error.code;
                if (errorCode === 'auth/invalid-credential') {
                    showMessage('Incorrect Email or Password', 'signInMessage', false);
                } else {
                    showMessage('Account does not Exist', 'signInMessage', false);
                }
            });
    });
}