import { auth, db, doc, getDoc, collection, addDoc, Timestamp } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signOut,
    fetchSignInMethodsForEmail,
    sendPasswordResetEmail 
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";

// Rate limiting variables
let lastAuthRequest = 0;
const AUTH_REQUEST_DELAY = 3000; // 3 seconds between requests
let authRequestCount = 0;
let lastRequestReset = Date.now();
const MAX_REQUESTS_PER_MINUTE = 5; // Maximum 5 requests per minute

// ==================== BACK BUTTON / CACHE FIX ====================
// This must come FIRST before any redirects

// Function to check auth status and handle redirects
function handleAuthRedirect() {
    const loggedInUserId = localStorage.getItem('loggedInUserId');
    const currentPath = window.location.pathname;
    const isAuthPage = currentPath.includes('index.html') || currentPath.includes('signup.html') || currentPath === '/' || currentPath.endsWith('/');
    
    console.log("Auth check:", { loggedInUserId, currentPath, isAuthPage });
    
    // If user is logged in and on auth page, redirect to dashboard
    if (loggedInUserId && isAuthPage) {
        console.log("User is logged in but on auth page, redirecting to dashboard");
        window.location.href = 'dashboard.html';
        return true;
    }
    // If user is not logged in and on protected page, redirect to login
    else if (!loggedInUserId && !isAuthPage) {
        console.log("User is not logged in but on protected page, redirecting to login");
        window.location.href = 'index.html';
        return true;
    }
    return false;
}

// Handle pageshow event (back/forward cache)
window.addEventListener('pageshow', function(event) {
    // If the page is loaded from cache (bfcache)
    if (event.persisted) {
        console.log("Page loaded from back/forward cache");
        handleAuthRedirect();
    }
});

// Also check on initial page load
document.addEventListener('DOMContentLoaded', function() {
    handleAuthRedirect();
});

// ==================== SESSION KEEP-ALIVE ====================
let tokenRefreshInterval = null;
let activityCheckInterval = null;
let lastActivity = Date.now();

// Function to refresh Firebase token
async function refreshAuthToken() {
    try {
        const user = auth?.currentUser;
        if (user) {
            // Force token refresh
            await user.getIdToken(true);
            console.log("Auth token refreshed at", new Date().toLocaleTimeString());
            lastActivity = Date.now();
        }
    } catch (error) {
        console.error("Error refreshing token:", error);
        
        // If refresh fails due to expired token, redirect to login
        if (error.code === 'auth/user-token-expired') {
            console.log("Token expired, redirecting to login...");
            localStorage.removeItem('loggedInUserId');
            window.location.href = 'index.html';
        }
    }
}

// Initialize session keep-alive
function initSessionKeepAlive() {
    // Clear any existing intervals
    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
    }
    if (activityCheckInterval) {
        clearInterval(activityCheckInterval);
    }

    const loggedInUserId = localStorage.getItem('loggedInUserId');
    if (!loggedInUserId) return;

    // Update last activity on user interaction
    const updateLastActivity = () => {
        lastActivity = Date.now();
    };

    // Add activity listeners
    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
    activityEvents.forEach(event => {
        window.addEventListener(event, updateLastActivity);
    });

    // Refresh token every 45 minutes (Firebase tokens expire after 1 hour)
    tokenRefreshInterval = setInterval(refreshAuthToken, 45 * 60 * 1000);

    // Initial token refresh
    refreshAuthToken();
    
    console.log("Session keep-alive initialized");
}

// Stop session keep-alive (call on logout)
function stopSessionKeepAlive() {
    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
        tokenRefreshInterval = null;
    }
    if (activityCheckInterval) {
        clearInterval(activityCheckInterval);
        activityCheckInterval = null;
    }
}

// ==================== RATE LIMITING FUNCTIONS ====================
function checkRateLimit() {
    const now = Date.now();
    
    // Reset counter every minute
    if (now - lastRequestReset > 60000) {
        authRequestCount = 0;
        lastRequestReset = now;
    }
    
    // Check if too many requests
    if (authRequestCount >= MAX_REQUESTS_PER_MINUTE) {
        throw new Error('Too many authentication attempts. Please wait a minute and try again.');
    }
    
    // Check time between requests
    if (now - lastAuthRequest < AUTH_REQUEST_DELAY) {
        const waitTime = Math.ceil((AUTH_REQUEST_DELAY - (now - lastAuthRequest)) / 1000);
        throw new Error(`Please wait ${waitTime} second(s) before trying again.`);
    }
    
    lastAuthRequest = now;
    authRequestCount++;
}

// ==================== MESSAGE FUNCTION ====================
function showMessage(message, isSuccess = false) {
    const messageDiv = document.getElementById('message');
    if (!messageDiv) return;
    
    messageDiv.style.display = 'block';
    messageDiv.textContent = message;
    messageDiv.style.backgroundColor = isSuccess ? '#27ae60' : '#e74c3c';
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}

// ==================== LOGIN FORM HANDLER ====================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const loginButton = loginForm.querySelector('button[type="submit"]');
        
        // Disable button to prevent double submission
        loginButton.disabled = true;
        loginButton.textContent = 'Signing in...';

        try {
            // Check rate limit
            checkRateLimit();
            
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            // Store user ID
            localStorage.setItem('loggedInUserId', user.uid);
            
            // Update last login
            try {
                const userRef = doc(db, "users", user.uid);
                await setDoc(userRef, {
                    lastLogin: Timestamp.now()
                }, { merge: true });
            } catch (error) {
                console.log("Error updating last login:", error);
            }
            
            showMessage('Login successful! Redirecting...', true);
            
            // Initialize session keep-alive after successful login
            initSessionKeepAlive();
            
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1500);
            
        } catch (error) {
            console.error('Login error:', error);
            
            let errorMessage = 'Login failed. Please try again.';
            
            switch (error.code) {
                case 'auth/invalid-credential':
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                    errorMessage = 'Invalid email or password.';
                    break;
                case 'auth/too-many-requests':
                    errorMessage = 'Too many failed login attempts. Please try again later.';
                    break;
                case 'auth/user-disabled':
                    errorMessage = 'This account has been disabled.';
                    break;
                default:
                    errorMessage = error.message;
            }
            
            showMessage(errorMessage);
            
            // Re-enable button
            loginButton.disabled = false;
            loginButton.textContent = 'Sign In';
        }
    });
}

// ==================== SIGNUP FORM HANDLER ====================
const signupForm = document.getElementById('signupForm');
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const firstName = document.getElementById('firstName').value;
        const lastName = document.getElementById('lastName').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const signupButton = signupForm.querySelector('button[type="submit"]');

        // Validate passwords
        if (password !== confirmPassword) {
            showMessage('Passwords do not match!');
            return;
        }

        if (password.length < 6) {
            showMessage('Password must be at least 6 characters long.');
            return;
        }

        // Disable button to prevent double submission
        signupButton.disabled = true;
        signupButton.textContent = 'Creating account...';

        try {
            // Check rate limit
            checkRateLimit();
            
            // Check if email already exists
            const methods = await fetchSignInMethodsForEmail(auth, email);
            if (methods && methods.length > 0) {
                showMessage('Email already registered. Please sign in instead.');
                signupButton.disabled = false;
                signupButton.textContent = 'Sign Up';
                return;
            }
            
            // Create user
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            // Store user data in Firestore
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                firstName,
                lastName,
                email,
                createdAt: Timestamp.now(),
                lastLogin: Timestamp.now()
            });
            
            // Log activity
            try {
                await addDoc(collection(db, "activities"), {
                    type: 'user',
                    description: `New user registered: ${firstName} ${lastName}`,
                    timestamp: Timestamp.now(),
                    userId: user.uid
                });
            } catch (error) {
                console.log("Error logging activity:", error);
            }
            
            showMessage('Account created successfully! Redirecting to login...', true);
            
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
            
        } catch (error) {
            console.error('Signup error:', error);
            
            let errorMessage = 'Error creating account. Please try again.';
            
            switch (error.code) {
                case 'auth/email-already-in-use':
                    errorMessage = 'Email already in use. Please use a different email.';
                    break;
                case 'auth/weak-password':
                    errorMessage = 'Password should be at least 6 characters.';
                    break;
                case 'auth/invalid-email':
                    errorMessage = 'Please enter a valid email address.';
                    break;
                case 'auth/too-many-requests':
                    errorMessage = 'Too many attempts. Please try again later.';
                    break;
                default:
                    errorMessage = error.message;
            }
            
            showMessage(errorMessage);
            
            // Re-enable button
            signupButton.disabled = false;
            signupButton.textContent = 'Sign Up';
        }
    });
}

// ==================== FORGOT PASSWORD ====================
window.forgotPassword = async function() {
    const email = prompt('Please enter your email address:');
    if (!email) return;
    
    try {
        await sendPasswordResetEmail(auth, email);
        showMessage('Password reset email sent! Check your inbox.', true);
    } catch (error) {
        console.error('Password reset error:', error);
        
        let errorMessage = 'Error sending reset email.';
        
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage = 'No account found with this email.';
                break;
            case 'auth/too-many-requests':
                errorMessage = 'Too many requests. Please try again later.';
                break;
            default:
                errorMessage = error.message;
        }
        
        showMessage(errorMessage);
    }
};

// ==================== LOGOUT FUNCTION ====================
const logoutButton = document.getElementById('logout');
if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        try {
            await signOut(auth);
            localStorage.removeItem('loggedInUserId');
            stopSessionKeepAlive(); // Stop session keep-alive on logout
            window.location.href = 'index.html';
        } catch (error) {
            console.error("Error signing out:", error);
            showMessage('Error signing out. Please try again.');
        }
    });
}

// ==================== FETCH USER DATA ====================
export async function fetchUserData(userId) {
    try {
        const docRef = doc(db, "users", userId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            // If user document doesn't exist in Firestore but user is authenticated
            const user = auth.currentUser;
            if (user && user.uid === userId) {
                // Create a basic user document
                const userData = {
                    uid: userId,
                    email: user.email,
                    firstName: user.email?.split('@')[0] || 'User',
                    lastName: '',
                    createdAt: Timestamp.now(),
                    lastLogin: Timestamp.now()
                };
                
                try {
                    await setDoc(doc(db, "users", userId), userData);
                } catch (error) {
                    console.log("Error creating user document:", error);
                }
                
                return userData;
            }
            return null;
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
        return null;
    }
}

// ==================== INITIALIZE SESSION KEEP-ALIVE ON PAGE LOAD ====================
// Check if user is logged in and initialize session keep-alive
const loggedInUserId = localStorage.getItem('loggedInUserId');
const currentPath = window.location.pathname;
const isAuthPage = currentPath.includes('index.html') || currentPath.includes('signup.html') || currentPath === '/' || currentPath.endsWith('/');

if (loggedInUserId && !isAuthPage) {
    initSessionKeepAlive();
}

// ==================== CLEANUP ON PAGE UNLOAD ====================
window.addEventListener('beforeunload', () => {
    stopSessionKeepAlive();
});