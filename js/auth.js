import { auth, db, doc, getDoc, collection, addDoc, Timestamp } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";

// Check authentication status
const loggedInUserId = localStorage.getItem('loggedInUserId');

// Redirect if not logged in (except for auth pages)
const currentPath = window.location.pathname;
const isAuthPage = currentPath.includes('index.html') || currentPath.includes('signup.html') || currentPath === '/' || currentPath.endsWith('/');

if (!loggedInUserId && !isAuthPage) {
    window.location.href = 'index.html';
}

// Login form handler
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const messageDiv = document.getElementById('message');

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            localStorage.setItem('loggedInUserId', user.uid);
            
            messageDiv.style.display = 'block';
            messageDiv.textContent = 'Login successful! Redirecting...';
            messageDiv.style.backgroundColor = '#27ae60';
            
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1500);
        } catch (error) {
            messageDiv.style.display = 'block';
            messageDiv.textContent = 'Error: ' + error.message;
            messageDiv.style.backgroundColor = '#e74c3c';
        }
    });
}

// Signup form handler
const signupForm = document.getElementById('signupForm');
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const firstName = document.getElementById('firstName').value;
        const lastName = document.getElementById('lastName').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const messageDiv = document.getElementById('message');

        if (password !== confirmPassword) {
            messageDiv.style.display = 'block';
            messageDiv.textContent = 'Passwords do not match!';
            messageDiv.style.backgroundColor = '#e74c3c';
            return;
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            await addDoc(collection(db, "users"), {
                uid: user.uid,
                firstName,
                lastName,
                email,
                createdAt: Timestamp.now()
            });
            
            await addDoc(collection(db, "activities"), {
                type: 'user',
                description: `New user registered: ${firstName} ${lastName}`,
                timestamp: Timestamp.now(),
                userId: user.uid
            });
            
            messageDiv.style.display = 'block';
            messageDiv.textContent = 'Account created successfully! Redirecting to login...';
            messageDiv.style.backgroundColor = '#27ae60';
            
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
        } catch (error) {
            messageDiv.style.display = 'block';
            messageDiv.textContent = 'Error: ' + error.message;
            messageDiv.style.backgroundColor = '#e74c3c';
        }
    });
}

// Logout function
const logoutButton = document.getElementById('logout');
if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        try {
            await signOut(auth);
            localStorage.removeItem('loggedInUserId');
            window.location.href = 'index.html';
        } catch (error) {
            console.error("Error signing out:", error);
        }
    });
}

// Fetch user data for display
export async function fetchUserData(userId) {
    try {
        const docRef = doc(db, "users", userId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            const user = auth.currentUser;
            if (user) {
                return {
                    email: user.email,
                    firstName: user.email?.split('@')[0] || 'User',
                    lastName: ''
                };
            }
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
        return null;
    }
}