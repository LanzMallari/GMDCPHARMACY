import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
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
    limit
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
const auth = getAuth();
const db = getFirestore();

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

// Cart array
let cart = [];
let products = [];
let filteredProducts = [];
let unsubscribeProducts = null; // For real-time listener
let currentUserData = null; // Store user data globally
let currentSortOrder = 'desc'; // 'desc' for newest first, 'asc' for oldest first
let reportChart = null; // For chart instance
let currentDiscount = 0; // 0 = no discount, 20 = senior/PWD discount

// Fetch and display user data
async function fetchUserData(userId) {
    try {
        const docRef = doc(db, "users", userId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            currentUserData = docSnap.data();
            const fullName = `${currentUserData.firstName || ''} ${currentUserData.lastName || ''}`.trim();
            
            // Update all user name elements
            updateUserDisplay(fullName, currentUserData.email);
        } else {
            // If user data doesn't exist, use email from auth
            const user = auth.currentUser;
            if (user) {
                updateUserDisplay(user.email?.split('@')[0] || 'User', user.email);
            }
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
        // Fallback to auth user
        const user = auth.currentUser;
        if (user) {
            updateUserDisplay(user.email?.split('@')[0] || 'User', user.email);
        }
    }
}

// Update user display in all places
function updateUserDisplay(fullName, email) {
    // Update dashboard elements if they exist
    const fNameElement = document.getElementById('loggedUserFName');
    const lNameElement = document.getElementById('loggedUserLName');
    const emailElement = document.getElementById('loggedUserEmail');
    const sidebarNameElement = document.getElementById('sidebarUserName');
    const sidebarEmailElement = document.getElementById('sidebarUserEmail');
    const welcomeNameElement = document.getElementById('welcomeUserName');
    const userAvatarElement = document.querySelector('.user-avatar i');
    
    // Split full name into first and last if needed
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    if (fNameElement) fNameElement.textContent = firstName;
    if (lNameElement) lNameElement.textContent = lastName || 'N/A';
    if (emailElement) emailElement.textContent = email || 'N/A';
    
    // Update sidebar info
    if (sidebarNameElement) {
        sidebarNameElement.textContent = fullName || 'User';
    }
    if (sidebarEmailElement) {
        sidebarEmailElement.textContent = email || '';
    }
    
    // Update welcome message
    if (welcomeNameElement) {
        welcomeNameElement.textContent = firstName || 'User';
    }
    
    // Update avatar with user initial
    if (userAvatarElement) {
        const initial = (firstName.charAt(0) || 'U').toUpperCase();
        userAvatarElement.style.display = 'none';
        const avatarContainer = document.querySelector('.user-avatar');
        if (avatarContainer && !document.querySelector('.user-initial')) {
            const initialDiv = document.createElement('div');
            initialDiv.className = 'user-initial';
            initialDiv.textContent = initial;
            avatarContainer.appendChild(initialDiv);
        }
    }
}

// Load user data
fetchUserData(loggedInUserId);

// Update date and time
function updateDateTime() {
    const dateTimeElement = document.getElementById('currentDateTime');
    if (dateTimeElement) {
        const now = new Date();
        const dateTimeString = now.toLocaleString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
        dateTimeElement.textContent = dateTimeString;
    }
}
setInterval(updateDateTime, 1000);
updateDateTime();

// Check if day has changed for sales reset
function checkDayChange() {
    const lastVisit = localStorage.getItem('lastVisitDate');
    const today = new Date().toDateString();
    
    if (lastVisit !== today) {
        // Day has changed, reset today's sales display
        const todaySalesEl = document.getElementById('todaySales');
        if (todaySalesEl) {
            todaySalesEl.textContent = '₱0.00';
        }
        localStorage.setItem('lastVisitDate', today);
    }
}

// Call on load
checkDayChange();

// Check every minute for day change
setInterval(checkDayChange, 60000);

// Burger button functionality for sidebar toggle
const burgerBtn = document.getElementById('burgerBtn');
const sidebar = document.querySelector('.sidebar');
const mainContent = document.querySelector('.main-content');

if (burgerBtn) {
    burgerBtn.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        
        // Change icon based on sidebar state
        const icon = burgerBtn.querySelector('i');
        if (sidebar.classList.contains('active')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
            
            // Add overlay for mobile
            if (window.innerWidth <= 768) {
                createSidebarOverlay();
            }
        } else {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
            removeSidebarOverlay();
        }
    });
}

// Create overlay for mobile
function createSidebarOverlay() {
    if (!document.querySelector('.sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
        
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('active');
            const icon = burgerBtn.querySelector('i');
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
            removeSidebarOverlay();
        });
    }
}

function removeSidebarOverlay() {
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
        overlay.remove();
    }
}

// Close sidebar when clicking on nav items (mobile)
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('active');
            const icon = burgerBtn.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
            removeSidebarOverlay();
        }
    });
});

// Handle window resize
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        // On desktop, remove overlay and reset sidebar
        removeSidebarOverlay();
        sidebar.classList.remove('active');
        const icon = burgerBtn?.querySelector('i');
        if (icon) {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    }
});

// Tab Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabId = item.getAttribute('data-tab');
        
        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        // Show selected tab
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        const selectedTab = document.getElementById(`${tabId}-tab`);
        if (selectedTab) {
            selectedTab.classList.add('active');
        }
        
        // Load tab-specific data
        if (tabId === 'inventory') {
            loadInventory();
        }
        if (tabId === 'pos') {
            loadProducts();
        }
        if (tabId === 'dashboard') {
            if (unsubscribeProducts) {
                unsubscribeProducts();
                unsubscribeProducts = null;
            }
            loadDashboardStats();
        }
        if (tabId === 'sales') {
            if (unsubscribeProducts) {
                unsubscribeProducts();
                unsubscribeProducts = null;
            }
            loadSalesHistory(currentSortOrder);
        }
        if (tabId === 'reports') {
            if (unsubscribeProducts) {
                unsubscribeProducts();
                unsubscribeProducts = null;
            }
            loadReportsTab();
        }
    });
});

// Search functionality for POS
const posSearch = document.getElementById('posSearch');
if (posSearch) {
    posSearch.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        filterProducts(searchTerm);
    });
}

// Search functionality for Inventory
const inventorySearch = document.getElementById('inventorySearch');
if (inventorySearch) {
    inventorySearch.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        filterInventory(searchTerm);
    });
}

// Filter products in POS
function filterProducts(searchTerm) {
    const productsGrid = document.getElementById('productsGrid');
    if (!productsGrid) return;
    
    productsGrid.innerHTML = '';
    
    const productsToShow = searchTerm ? 
        products.filter(p => 
            p.name?.toLowerCase().includes(searchTerm) || 
            p.code?.toLowerCase().includes(searchTerm) ||
            p.category?.toLowerCase().includes(searchTerm)
        ) : products;
    
    if (productsToShow.length === 0) {
        productsGrid.innerHTML = '<p class="no-data">No products match your search</p>';
        return;
    }
    
    productsToShow.forEach(product => {
        const isOutOfStock = product.stock <= 0;
        
        const productCard = document.createElement('div');
        productCard.className = `product-card ${isOutOfStock ? 'out-of-stock' : ''}`;
        productCard.dataset.productId = product.id;
        productCard.innerHTML = `
            <div class="product-image">
                <i class="fas fa-pills"></i>
            </div>
            <h4>${product.name || 'Unnamed'}</h4>
            <p class="product-price">₱${(product.price || 0).toFixed(2)}</p>
            <p class="product-stock ${isOutOfStock ? 'text-danger' : ''}">Stock: ${product.stock || 0}</p>
            ${isOutOfStock ? '<span class="out-of-stock-label">OUT OF STOCK</span>' : ''}
            <button class="add-to-cart" ${isOutOfStock ? 'disabled' : ''} 
                    data-id="${product.id}">
                ${isOutOfStock ? 'Unavailable' : 'Add to Cart'}
            </button>
        `;
        productsGrid.appendChild(productCard);
    });
    
    // Add event listeners to add-to-cart buttons
    document.querySelectorAll('.add-to-cart:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => addToCart(btn.dataset.id));
    });
}

// Filter inventory with category and stock filters
function filterInventory(searchTerm) {
    const categoryFilter = document.getElementById('categoryFilter')?.value || '';
    const stockFilter = document.getElementById('stockFilter')?.value || '';
    const rows = document.querySelectorAll('#inventoryTableBody tr');
    
    rows.forEach(row => {
        let showRow = true;
        
        // Text search filter
        if (searchTerm) {
            const text = row.textContent.toLowerCase();
            if (!text.includes(searchTerm.toLowerCase())) {
                showRow = false;
            }
        }
        
        // Category filter
        if (showRow && categoryFilter) {
            const category = row.querySelector('td:nth-child(3)')?.textContent || '';
            if (category.toLowerCase() !== categoryFilter.toLowerCase()) {
                showRow = false;
            }
        }
        
        // Stock filter
        if (showRow && stockFilter) {
            const stockText = row.querySelector('td:nth-child(5)')?.textContent || '';
            const stockValue = parseInt(stockText) || 0;
            
            if (stockFilter === 'low') {
                if (stockValue >= 10 || stockValue === 0) showRow = false;
            } else if (stockFilter === 'out') {
                if (stockValue !== 0) showRow = false;
            }
        }
        
        row.style.display = showRow ? '' : 'none';
    });
}

// Load Dashboard Stats
async function loadDashboardStats() {
    try {
        // Get total products
        const productsSnapshot = await getDocs(collection(db, "products"));
        const totalProductsEl = document.getElementById('totalProducts');
        if (totalProductsEl) totalProductsEl.textContent = productsSnapshot.size;
        
        // Get low stock count (stock < 10)
        let lowStock = 0;
        productsSnapshot.forEach(doc => {
            const stock = doc.data().stock;
            if (stock > 0 && stock < 10) lowStock++;
        });
        
        const lowStockEl = document.getElementById('lowStockCount');
        if (lowStockEl) lowStockEl.textContent = lowStock;
        
        // Get today's sales (automatically resets each day)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(today))
        );
        const salesSnapshot = await getDocs(salesQuery);
        let todayTotal = 0;
        salesSnapshot.forEach(doc => {
            todayTotal += doc.data().total || 0;
        });
        const todaySalesEl = document.getElementById('todaySales');
        if (todaySalesEl) todaySalesEl.textContent = `₱${todayTotal.toFixed(2)}`;
        
        // Get expiring soon count (within 30 days)
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        let expiringCount = 0;
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            if (product.expiryDate) {
                const expiryDate = product.expiryDate.toDate();
                if (expiryDate <= thirtyDaysFromNow) expiringCount++;
            }
        });
        const expiringEl = document.getElementById('expiringCount');
        if (expiringEl) expiringEl.textContent = expiringCount;
        
        // Get return count for today
        const returnQuery = query(
            collection(db, "returns"),
            where("date", ">=", Timestamp.fromDate(today))
        );
        const returnSnapshot = await getDocs(returnQuery);
        const returnCount = returnSnapshot.size;
        
        // Make stat cards clickable
        const statCards = document.querySelectorAll('.stat-card');
        if (statCards.length >= 4) {
            // Low Stock card (second card)
            statCards[1].style.cursor = 'pointer';
            statCards[1].onclick = () => openLowStockModal();
            
            // Today's Sales card (third card)
            statCards[2].style.cursor = 'pointer';
            statCards[2].onclick = () => openTodaySalesModal();
            
            // Add hover effect
            statCards[1].addEventListener('mouseenter', function() {
                this.style.transform = 'translateY(-5px)';
                this.style.boxShadow = '0 8px 20px rgba(0,0,0,0.15)';
            });
            statCards[1].addEventListener('mouseleave', function() {
                this.style.transform = '';
                this.style.boxShadow = '';
            });
            
            statCards[2].addEventListener('mouseenter', function() {
                this.style.transform = 'translateY(-5px)';
                this.style.boxShadow = '0 8px 20px rgba(0,0,0,0.15)';
            });
            statCards[2].addEventListener('mouseleave', function() {
                this.style.transform = '';
                this.style.boxShadow = '';
            });
        }
        
        // Load recent activities
        await loadRecentActivities();
        
    } catch (error) {
        console.error("Error loading dashboard stats:", error);
    }
}

// Load Recent Activities
async function loadRecentActivities() {
    try {
        const activitiesList = document.getElementById('recentActivities');
        if (!activitiesList) return;
        
        activitiesList.innerHTML = '<div class="loading">Loading activities...</div>';
        
        // Get recent sales (last 5)
        const salesQuery = query(
            collection(db, "sales"),
            orderBy("date", "desc"),
            limit(5)
        );
        const salesSnapshot = await getDocs(salesQuery);
        
        // Get recent returns (last 5)
        const returnsQuery = query(
            collection(db, "returns"),
            orderBy("date", "desc"),
            limit(5)
        );
        const returnsSnapshot = await getDocs(returnsQuery);
        
        // Get recent product updates (last 5)
        const productsQuery = query(
            collection(db, "products"),
            orderBy("lastUpdated", "desc"),
            limit(5)
        );
        const productsSnapshot = await getDocs(productsQuery);
        
        // Get recent stock changes from activities collection
        const activitiesQuery = query(
            collection(db, "activities"),
            orderBy("timestamp", "desc"),
            limit(10)
        );
        const activitiesSnapshot = await getDocs(activitiesQuery);
        
        let activities = [];
        
        // Add sales activities
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            activities.push({
                type: 'sale',
                description: `New sale: ${sale.invoiceNumber || '#' + doc.id.slice(-6)} - ₱${(sale.total || 0).toFixed(2)}`,
                timestamp: sale.date,
                icon: 'fa-shopping-cart'
            });
        });
        
        // Add return activities
        returnsSnapshot.forEach(doc => {
            const returnData = doc.data();
            activities.push({
                type: 'return',
                description: `Return: ${returnData.productName} x${returnData.quantity} - ₱${(returnData.amount || 0).toFixed(2)} refunded (${returnData.returnId})`,
                timestamp: returnData.date,
                icon: 'fa-undo'
            });
        });
        
        // Add product activities from products collection
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            if (product.createdAt && product.createdAt.toDate() > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
                activities.push({
                    type: 'product',
                    description: `New product added: ${product.name || 'Unnamed'}`,
                    timestamp: product.createdAt,
                    icon: 'fa-pills'
                });
            }
        });
        
        // Add activities from activities collection
        activitiesSnapshot.forEach(doc => {
            const activity = doc.data();
            activities.push({
                type: activity.type || 'info',
                description: activity.description || 'System activity',
                timestamp: activity.timestamp,
                icon: getActivityIcon(activity.type)
            });
        });
        
        // Sort by timestamp (newest first) and take top 10
        activities.sort((a, b) => {
            const timeA = a.timestamp?.toDate?.() || new Date(a.timestamp);
            const timeB = b.timestamp?.toDate?.() || new Date(b.timestamp);
            return timeB - timeA;
        });
        
        activities = activities.slice(0, 10);
        
        activitiesList.innerHTML = '';
        
        if (activities.length === 0) {
            activitiesList.innerHTML = '<p class="no-data">No recent activities</p>';
            return;
        }
        
        activities.forEach(activity => {
            const activityElement = document.createElement('div');
            activityElement.className = 'activity-item';
            
            const timestamp = activity.timestamp?.toDate?.() || new Date(activity.timestamp);
            const timeAgo = getTimeAgo(timestamp);
            
            activityElement.innerHTML = `
                <div class="activity-icon"><i class="fas ${activity.icon || 'fa-info-circle'}"></i></div>
                <div class="activity-details">
                    <p>${activity.description}</p>
                    <small>${timeAgo}</small>
                </div>
            `;
            activitiesList.appendChild(activityElement);
        });
        
    } catch (error) {
        console.error("Error loading activities:", error);
        const activitiesList = document.getElementById('recentActivities');
        if (activitiesList) {
            activitiesList.innerHTML = '<p class="error">Error loading activities</p>';
        }
    }
}

// Helper function to get time ago string
function getTimeAgo(timestamp) {
    const now = new Date();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return timestamp.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getActivityIcon(type) {
    const icons = {
        'sale': 'fa-shopping-cart',
        'return': 'fa-undo',
        'stock': 'fa-boxes',
        'product': 'fa-pills',
        'user': 'fa-user',
        'info': 'fa-info-circle'
    };
    return icons[type] || 'fa-info-circle';
}

// ========== DASHBOARD MODAL FUNCTIONS ==========

// Open Low Stock Modal
async function openLowStockModal() {
    try {
        const modal = document.getElementById('lowStockModal');
        const modalBody = document.getElementById('lowStockModalBody');
        
        if (!modal || !modalBody) {
            console.error("Modal elements not found");
            return;
        }
        
        // Show loading
        modalBody.innerHTML = `
            <div class="modal-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading low stock products...</p>
            </div>
        `;
        modal.style.display = 'block';
        
        // Get all products with low stock (stock > 0 and stock < 10)
        const productsSnapshot = await getDocs(collection(db, "products"));
        const lowStockProducts = [];
        
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            if (product.stock > 0 && product.stock < 10) {
                lowStockProducts.push({
                    id: doc.id,
                    ...product
                });
            }
        });
        
        // Sort by stock (lowest first)
        lowStockProducts.sort((a, b) => a.stock - b.stock);
        
        if (lowStockProducts.length === 0) {
            modalBody.innerHTML = `
                <div class="modal-empty">
                    <i class="fas fa-check-circle" style="font-size: 48px; color: #27ae60;"></i>
                    <p>No low stock products found!</p>
                    <p style="font-size: 14px; color: #7f8c8d; margin-top: 10px;">All products have sufficient stock levels.</p>
                </div>
            `;
            return;
        }
        
        // Build the modal content
        let html = `
            <div class="modal-stats-summary">
                <div class="modal-stat">
                    <span class="modal-stat-label">Total Low Stock:</span>
                    <span class="modal-stat-value">${lowStockProducts.length}</span>
                </div>
                <div class="modal-stat">
                    <span class="modal-stat-label">Critical (Stock < 5):</span>
                    <span class="modal-stat-value critical">${lowStockProducts.filter(p => p.stock < 5).length}</span>
                </div>
            </div>
            <div class="modal-items-container">
        `;
        
        lowStockProducts.forEach(product => {
            const stockClass = product.stock < 5 ? 'critical-stock' : 'warning-stock';
            const expiryClass = product.expiryDate ? (new Date(product.expiryDate.toDate()) < new Date() ? 'expired' : '') : '';
            
            html += `
                <div class="modal-item">
                    <div class="modal-item-info">
                        <div class="modal-item-name">
                            <strong>${product.name || 'Unnamed'}</strong>
                            ${product.code ? `<span class="item-code">${product.code}</span>` : ''}
                        </div>
                        <div class="modal-item-details">
                            <span class="item-category"><i class="fas fa-tag"></i> ${product.category || 'N/A'}</span>
                            <span class="item-price"><i class="fas fa-dollar-sign"></i> ₱${(product.price || 0).toFixed(2)}</span>
                            <span class="item-expiry ${expiryClass}"><i class="fas fa-calendar-alt"></i> ${product.expiryDate ? formatDate(product.expiryDate) : 'No expiry'}</span>
                        </div>
                    </div>
                    <div class="modal-item-stock ${stockClass}">
                        <span class="stock-badge">Stock: ${product.stock}</span>
                        <button class="btn-icon-small" onclick="editProduct('${product.id}')" title="Restock">
                            <i class="fas fa-plus-circle"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        
        html += `
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="window.location.href='#'; document.querySelector('[data-tab=\"inventory\"]').click();">
                    <i class="fas fa-pills"></i> Go to Inventory
                </button>
            </div>
        `;
        
        modalBody.innerHTML = html;
        
    } catch (error) {
        console.error("Error opening low stock modal:", error);
        const modalBody = document.getElementById('lowStockModalBody');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="modal-error">
                    <i class="fas fa-exclamation-circle" style="font-size: 48px; color: #e74c3c;"></i>
                    <p>Error loading low stock products</p>
                    <p style="font-size: 14px; color: #7f8c8d; margin-top: 10px;">${error.message}</p>
                </div>
            `;
        }
    }
}

// Open Today's Sales Modal
async function openTodaySalesModal() {
    try {
        const modal = document.getElementById('todaySalesModal');
        const modalBody = document.getElementById('todaySalesModalBody');
        
        if (!modal || !modalBody) {
            console.error("Modal elements not found");
            return;
        }
        
        // Show loading
        modalBody.innerHTML = `
            <div class="modal-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading today's sales...</p>
            </div>
        `;
        modal.style.display = 'block';
        
        // Get today's sales
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(today)),
            where("date", "<", Timestamp.fromDate(tomorrow)),
            orderBy("date", "desc")
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
        if (salesSnapshot.empty) {
            modalBody.innerHTML = `
                <div class="modal-empty">
                    <i class="fas fa-shopping-cart" style="font-size: 48px; color: #3498db;"></i>
                    <p>No sales today yet!</p>
                    <p style="font-size: 14px; color: #7f8c8d; margin-top: 10px;">Start selling to see transactions here.</p>
                </div>
            `;
            return;
        }
        
        // Calculate totals
        let totalSales = 0;
        let totalItems = 0;
        const sales = [];
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            totalSales += sale.total || 0;
            
            let itemsCount = 0;
            if (sale.items && Array.isArray(sale.items)) {
                itemsCount = sale.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
            }
            totalItems += itemsCount;
            
            sales.push({
                id: doc.id,
                ...sale,
                itemsCount
            });
        });
        
        // Build the modal content
        let html = `
            <div class="modal-stats-summary">
                <div class="modal-stat">
                    <span class="modal-stat-label">Total Transactions:</span>
                    <span class="modal-stat-value">${sales.length}</span>
                </div>
                <div class="modal-stat">
                    <span class="modal-stat-label">Total Items Sold:</span>
                    <span class="modal-stat-value">${totalItems}</span>
                </div>
                <div class="modal-stat highlight">
                    <span class="modal-stat-label">Total Sales:</span>
                    <span class="modal-stat-value">₱${totalSales.toFixed(2)}</span>
                </div>
            </div>
            <div class="modal-items-container">
        `;
        
        sales.forEach(sale => {
            const saleDate = sale.date?.toDate ? sale.date.toDate() : new Date();
            const timeStr = saleDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            const itemsPreview = sale.items ? sale.items.slice(0, 2).map(item => 
                `${item.name} x${item.quantity}`
            ).join(', ') : '';
            
            const moreItems = sale.items && sale.items.length > 2 ? ` +${sale.items.length - 2} more` : '';
            
            html += `
                <div class="modal-item sale-item" onclick="viewSaleDetails('${sale.id}')">
                    <div class="modal-item-info">
                        <div class="modal-item-name">
                            <strong>${sale.invoiceNumber || '#' + sale.id.slice(-8).toUpperCase()}</strong>
                            <span class="sale-time">${timeStr}</span>
                        </div>
                        <div class="modal-item-details">
                            <span class="item-cashier"><i class="fas fa-user"></i> ${sale.cashierName || 'Unknown'}</span>
                            <span class="item-payment"><i class="fas fa-credit-card"></i> ${sale.paymentMethod || 'Cash'}</span>
                            <span class="item-items"><i class="fas fa-box"></i> ${itemsPreview}${moreItems}</span>
                        </div>
                    </div>
                    <div class="modal-item-amount">
                        <span class="sale-amount">₱${(sale.total || 0).toFixed(2)}</span>
                        <button class="btn-icon-small" onclick="event.stopPropagation(); viewSaleDetails('${sale.id}')" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        
        html += `
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="window.location.href='#'; document.querySelector('[data-tab=\"sales\"]').click();">
                    <i class="fas fa-chart-line"></i> View All Sales
                </button>
            </div>
        `;
        
        modalBody.innerHTML = html;
        
    } catch (error) {
        console.error("Error opening today's sales modal:", error);
        const modalBody = document.getElementById('todaySalesModalBody');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="modal-error">
                    <i class="fas fa-exclamation-circle" style="font-size: 48px; color: #e74c3c;"></i>
                    <p>Error loading today's sales</p>
                    <p style="font-size: 14px; color: #7f8c8d; margin-top: 10px;">${error.message}</p>
                </div>
            `;
        }
    }
}

// Close modal function
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// Make functions globally available
window.openLowStockModal = openLowStockModal;
window.openTodaySalesModal = openTodaySalesModal;
window.closeModal = closeModal;
window.editProduct = editProduct;

// Load Inventory
async function loadInventory() {
    try {
        const productsSnapshot = await getDocs(collection(db, "products"));
        const tableBody = document.getElementById('inventoryTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        if (productsSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="7" class="no-data">No products found</td></tr>';
            return;
        }
        
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            const stockClass = product.stock === 0 ? 'out-of-stock' : (product.stock < 10 ? 'low-stock' : '');
            const stockStatus = product.stock === 0 ? 'Out of Stock' : product.stock;
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${product.code || 'N/A'}</td>
                <td>${product.name || 'N/A'}</td>
                <td>${product.category || 'N/A'}</td>
                <td>₱${(product.price || 0).toFixed(2)}</td>
                <td class="${stockClass}">${stockStatus}</td>
                <td>${product.expiryDate ? formatDate(product.expiryDate) : 'N/A'}</td>
                <td>
                    <button class="btn-icon edit-product" title="Edit Product" data-id="${doc.id}"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon delete-product" title="Delete Product" data-id="${doc.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(row);
        });
        
        // Add event listeners to edit and delete buttons
        document.querySelectorAll('.edit-product').forEach(btn => {
            btn.addEventListener('click', () => editProduct(btn.dataset.id));
        });
        
        document.querySelectorAll('.delete-product').forEach(btn => {
            btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
        });
        
        // Add mobile data labels
        addMobileDataLabels();
        
        // Add event listeners for filters
        setupInventoryFilters();
        
    } catch (error) {
        console.error("Error loading inventory:", error);
    }
}

// Setup inventory filters
function setupInventoryFilters() {
    const categoryFilter = document.getElementById('categoryFilter');
    const stockFilter = document.getElementById('stockFilter');
    const searchInput = document.getElementById('inventorySearch');
    
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => {
            filterInventory(searchInput?.value || '');
        });
    }
    
    if (stockFilter) {
        stockFilter.addEventListener('change', () => {
            filterInventory(searchInput?.value || '');
        });
    }
}

// Edit Product function
async function editProduct(productId) {
    try {
        // Get product data
        const productRef = doc(db, "products", productId);
        const productDoc = await getDoc(productRef);
        
        if (!productDoc.exists()) {
            showNotification('Product not found', 'error');
            return;
        }
        
        const product = productDoc.data();
        
        // Populate modal with product data
        document.getElementById('productCode').value = product.code || '';
        document.getElementById('productName').value = product.name || '';
        document.getElementById('productCategory').value = product.category || '';
        document.getElementById('productPrice').value = product.price || 0;
        document.getElementById('productStock').value = product.stock || 0;
        
        // Format date for input
        if (product.expiryDate) {
            const expiryDate = product.expiryDate.toDate();
            const formattedDate = expiryDate.toISOString().split('T')[0];
            document.getElementById('productExpiry').value = formattedDate;
        }
        
        document.getElementById('productDescription').value = product.description || '';
        
        // Change modal title and button
        document.querySelector('#productModal .modal-header h2').textContent = 'Edit Product';
        const submitBtn = document.querySelector('#productForm button[type="submit"]');
        submitBtn.textContent = 'Update Product';
        
        // Store product ID for update
        document.getElementById('productForm').dataset.editId = productId;
        
        // Show modal
        const modal = document.getElementById('productModal');
        if (modal) {
            modal.style.display = 'block';
        }
        
    } catch (error) {
        console.error("Error loading product for edit:", error);
        showNotification('Error loading product', 'error');
    }
}

// Delete Product function
async function deleteProduct(productId) {
    if (confirm('Are you sure you want to delete this product?')) {
        try {
            // Get product name before deleting
            const productRef = doc(db, "products", productId);
            const productDoc = await getDoc(productRef);
            const productName = productDoc.exists() ? productDoc.data().name : 'Product';
            
            await deleteDoc(productRef);
            
            // Add activity
            await addDoc(collection(db, "activities"), {
                type: 'product',
                description: `${productName} was deleted`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
            
            showNotification('Product deleted successfully', 'success');
            loadInventory(); // Reload inventory
            
        } catch (error) {
            console.error("Error deleting product:", error);
            showNotification('Error deleting product', 'error');
        }
    }
}

// Load Products for POS with real-time updates
function loadProducts() {
    try {
        const productsGrid = document.getElementById('productsGrid');
        if (!productsGrid) return;
        
        // Show loading state
        productsGrid.innerHTML = '<div class="loading">Loading products...</div>';
        
        // Unsubscribe from previous listener if exists
        if (unsubscribeProducts) {
            unsubscribeProducts();
        }
        
        const productsRef = collection(db, "products");
        
        // Set up real-time listener for products
        unsubscribeProducts = onSnapshot(productsRef, (snapshot) => {
            products = [];
            
            if (snapshot.empty) {
                productsGrid.innerHTML = '<p class="no-data">No products available</p>';
                return;
            }
            
            snapshot.forEach(doc => {
                const product = { id: doc.id, ...doc.data() };
                products.push(product);
            });
            
            // Clear search input and show all products
            const posSearch = document.getElementById('posSearch');
            if (posSearch) {
                posSearch.value = '';
            }
            
            // Display all products
            displayProducts(products);
            
            // Update cart display to reflect current stock
            updateCartDisplay();
            
        }, (error) => {
            console.error("Error in real-time listener:", error);
            productsGrid.innerHTML = '<p class="error">Error loading products</p>';
        });
        
    } catch (error) {
        console.error("Error setting up products listener:", error);
    }
}

// Display products in grid
function displayProducts(productsToShow) {
    const productsGrid = document.getElementById('productsGrid');
    if (!productsGrid) return;
    
    productsGrid.innerHTML = '';
    
    productsToShow.forEach(product => {
        const isOutOfStock = product.stock <= 0;
        
        const productCard = document.createElement('div');
        productCard.className = `product-card ${isOutOfStock ? 'out-of-stock' : ''}`;
        productCard.dataset.productId = product.id;
        productCard.innerHTML = `
            <div class="product-image">
                <i class="fas fa-pills"></i>
            </div>
            <h4>${product.name || 'Unnamed'}</h4>
            <p class="product-price">₱${(product.price || 0).toFixed(2)}</p>
            <p class="product-stock ${isOutOfStock ? 'text-danger' : ''}">Stock: ${product.stock || 0}</p>
            ${isOutOfStock ? '<span class="out-of-stock-label">OUT OF STOCK</span>' : ''}
            <button class="add-to-cart" ${isOutOfStock ? 'disabled' : ''} 
                    data-id="${product.id}">
                ${isOutOfStock ? 'Unavailable' : 'Add to Cart'}
            </button>
        `;
        productsGrid.appendChild(productCard);
    });
    
    // Add event listeners to add-to-cart buttons
    document.querySelectorAll('.add-to-cart:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => addToCart(btn.dataset.id));
    });
    
    // Apply mobile scroll fix if on mobile
    if (window.innerWidth <= 768) {
        fixMobilePOSScroll();
    }
}

// Add to Cart with stock validation
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    
    // Check if product exists and has stock
    if (!product) {
        showNotification('Product not found', 'error');
        return;
    }
    
    if (product.stock <= 0) {
        showNotification('This product is out of stock!', 'error');
        return;
    }
    
    const existingItem = cart.find(item => item.id === productId);
    
    if (existingItem) {
        // Check if adding one more would exceed available stock
        if (existingItem.quantity + 1 > product.stock) {
            showNotification(`Only ${product.stock} item(s) available in stock!`, 'error');
            return;
        }
        existingItem.quantity++;
        showNotification(`Added another ${product.name} to cart`, 'success');
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1,
            stock: product.stock
        });
        showNotification(`${product.name} added to cart`, 'success');
    }
    
    updateCartDisplay();
}

// Update Cart Display with Discount
function updateCartDisplay() {
    const cartItems = document.getElementById('cartItems');
    const subtotalEl = document.getElementById('subtotal');
    const discountEl = document.getElementById('discount');
    const discountAmountEl = document.getElementById('discountAmount');
    const grandTotalEl = document.getElementById('grandTotal');
    
    if (!cartItems) return;
    
    cartItems.innerHTML = '';
    let subtotal = 0;
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="empty-cart">Cart is empty</p>';
        if (subtotalEl) subtotalEl.textContent = '₱0.00';
        if (discountEl) discountEl.textContent = '₱0.00';
        if (discountAmountEl) discountAmountEl.textContent = '₱0.00';
        if (grandTotalEl) grandTotalEl.textContent = '₱0.00';
        return;
    }
    
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        
        // Find current product stock
        const product = products.find(p => p.id === item.id);
        const currentStock = product ? product.stock : 0;
        
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        cartItem.innerHTML = `
            <div class="cart-item-info">
                <h4>${item.name}</h4>
                <p>₱${item.price.toFixed(2)} x ${item.quantity}</p>
                <small class="${item.quantity > currentStock ? 'text-danger' : ''}">
                    Available: ${currentStock}
                </small>
            </div>
            <div class="cart-item-actions">
                <span>₱${itemTotal.toFixed(2)}</span>
                <button class="quantity-btn decrease-qty" data-index="${index}">
                    <i class="fas fa-minus"></i>
                </button>
                <span class="quantity">${item.quantity}</span>
                <button class="quantity-btn increase-qty" data-index="${index}" 
                    ${item.quantity >= currentStock ? 'disabled' : ''}>
                    <i class="fas fa-plus"></i>
                </button>
                <button class="remove-item" data-index="${index}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        cartItems.appendChild(cartItem);
    });
    
    // Add event listeners for quantity buttons
    document.querySelectorAll('.decrease-qty').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            decreaseQuantity(index);
        });
    });
    
    document.querySelectorAll('.increase-qty').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            increaseQuantity(index);
        });
    });
    
    document.querySelectorAll('.remove-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            cart.splice(index, 1);
            updateCartDisplay();
        });
    });
    
    // Calculate discount
    const discountPercentage = currentDiscount;
    const discountAmount = subtotal * (discountPercentage / 100);
    const grandTotal = subtotal - discountAmount;
    
    if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toFixed(2)}`;
    if (discountEl) discountEl.textContent = `${discountPercentage}%`;
    if (discountAmountEl) discountAmountEl.textContent = `-₱${discountAmount.toFixed(2)}`;
    if (grandTotalEl) grandTotalEl.textContent = `₱${grandTotal.toFixed(2)}`;
}

// Decrease quantity
function decreaseQuantity(index) {
    if (cart[index].quantity > 1) {
        cart[index].quantity--;
    } else {
        cart.splice(index, 1);
    }
    updateCartDisplay();
}

// Increase quantity with stock validation
function increaseQuantity(index) {
    const item = cart[index];
    const product = products.find(p => p.id === item.id);
    
    if (!product) {
        showNotification('Product not found', 'error');
        return;
    }
    
    if (item.quantity + 1 > product.stock) {
        showNotification(`Cannot add more. Only ${product.stock} items available!`, 'error');
        return;
    }
    
    item.quantity++;
    updateCartDisplay();
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.querySelector('.notification-toast');
    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'notification-toast';
        document.body.appendChild(notification);
    }
    
    notification.textContent = message;
    notification.className = `notification-toast ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// Clear Cart
const clearCartBtn = document.getElementById('clearCartBtn');
if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
        if (cart.length > 0) {
            if (confirm('Are you sure you want to clear the cart?')) {
                cart = [];
                updateCartDisplay();
                showNotification('Cart cleared', 'info');
            }
        }
    });
}

// Checkout Button
const checkoutBtn = document.getElementById('checkoutBtn');
if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
        if (cart.length === 0) {
            showNotification('Cart is empty!', 'error');
            return;
        }
        
        // Validate stock before opening checkout modal
        let hasStockIssue = false;
        for (const item of cart) {
            const product = products.find(p => p.id === item.id);
            if (!product || product.stock < item.quantity) {
                hasStockIssue = true;
                showNotification(`Insufficient stock for ${item.name}!`, 'error');
                break;
            }
        }
        
        if (!hasStockIssue) {
            const modal = document.getElementById('checkoutModal');
            if (modal) {
                modal.style.display = 'block';
                updateCheckoutModal();
            }
        }
    });
}

// Update Checkout Modal with product names and discount
function updateCheckoutModal() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutSubtotal = document.getElementById('checkoutSubtotal');
    const checkoutDiscount = document.getElementById('checkoutDiscount');
    const checkoutDiscountAmount = document.getElementById('checkoutDiscountAmount');
    const checkoutTotal = document.getElementById('checkoutTotal');
    
    if (!checkoutItems || !checkoutTotal) return;
    
    let subtotal = 0;
    checkoutItems.innerHTML = '';
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checkout-item';
        itemDiv.innerHTML = `
            <div class="checkout-product-info">
                <span class="product-name">${item.name}</span>
                <span class="product-detail">₱${item.price.toFixed(2)} x ${item.quantity}</span>
            </div>
            <span class="product-total">₱${itemTotal.toFixed(2)}</span>
        `;
        checkoutItems.appendChild(itemDiv);
    });
    
    // Calculate discount
    const discountPercentage = currentDiscount;
    const discountAmount = subtotal * (discountPercentage / 100);
    const grandTotal = subtotal - discountAmount;
    
    if (checkoutSubtotal) checkoutSubtotal.textContent = `₱${subtotal.toFixed(2)}`;
    if (checkoutDiscount) checkoutDiscount.textContent = `${discountPercentage}%`;
    if (checkoutDiscountAmount) checkoutDiscountAmount.textContent = `-₱${discountAmount.toFixed(2)}`;
    if (checkoutTotal) checkoutTotal.textContent = `₱${grandTotal.toFixed(2)}`;
    
    // Update amount tendered calculation
    updateChangeAmount();
}

// Calculate change
function updateChangeAmount() {
    const amountTendered = document.getElementById('amountTendered');
    const checkoutTotal = document.getElementById('checkoutTotal');
    const changeAmount = document.getElementById('changeAmount');
    
    if (amountTendered && checkoutTotal && changeAmount) {
        const amount = parseFloat(amountTendered.value) || 0;
        const total = parseFloat(checkoutTotal.textContent.replace('₱', ''));
        const change = amount - total;
        changeAmount.textContent = `₱${change >= 0 ? change.toFixed(2) : '0.00'}`;
    }
}

const amountTendered = document.getElementById('amountTendered');
if (amountTendered) {
    amountTendered.addEventListener('input', updateChangeAmount);
}

// Discount dropdown change handler
const discountSelect = document.getElementById('discountSelect');
if (discountSelect) {
    discountSelect.addEventListener('change', (e) => {
        currentDiscount = parseInt(e.target.value) || 0;
        updateCartDisplay();
        if (document.getElementById('checkoutModal').style.display === 'block') {
            updateCheckoutModal();
        }
    });
}

// Process Payment with discount
const processPaymentBtn = document.getElementById('processPaymentBtn');
if (processPaymentBtn) {
    processPaymentBtn.addEventListener('click', async () => {
        const paymentMethod = document.getElementById('paymentMethod');
        const amountTendered = document.getElementById('amountTendered');
        const checkoutTotal = document.getElementById('checkoutTotal');
        
        if (!paymentMethod || !amountTendered || !checkoutTotal) return;
        
        const method = paymentMethod.value;
        const amount = parseFloat(amountTendered.value) || 0;
        const total = parseFloat(checkoutTotal.textContent.replace('₱', ''));
        
        if (amount < total) {
            showNotification('Insufficient amount!', 'error');
            return;
        }
        
        // Double-check stock before processing payment
        let stockValid = true;
        for (const item of cart) {
            const productRef = doc(db, "products", item.id);
            const productDoc = await getDoc(productRef);
            
            if (!productDoc.exists()) {
                showNotification(`Product ${item.name} no longer exists!`, 'error');
                stockValid = false;
                break;
            }
            
            const currentStock = productDoc.data().stock;
            if (currentStock < item.quantity) {
                showNotification(`Insufficient stock for ${item.name}. Only ${currentStock} available!`, 'error');
                stockValid = false;
                break;
            }
        }
        
        if (!stockValid) {
            return;
        }
        
        try {
            // Generate invoice number
            const invoiceNumber = await generateInvoiceNumber();
            
            // Get cashier name
            const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
            
            // Calculate subtotal and discount
            const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const discountPercentage = currentDiscount;
            const discountAmount = subtotal * (discountPercentage / 100);
            const totalAmount = subtotal - discountAmount;
            
            // Create sale record
            const saleData = {
                invoiceNumber: invoiceNumber,
                items: cart.map(item => ({
                    productId: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    subtotal: item.price * item.quantity
                })),
                subtotal: subtotal,
                discountPercentage: discountPercentage,
                discountAmount: discountAmount,
                total: totalAmount,
                paymentMethod: method,
                amountTendered: amount,
                change: amount - totalAmount,
                date: Timestamp.now(),
                cashierId: loggedInUserId,
                cashierName: cashierName,
                returns: []
            };
            
            await addDoc(collection(db, "sales"), saleData);
            
            // Update product stock
            for (const item of cart) {
                const productRef = doc(db, "products", item.id);
                const productDoc = await getDoc(productRef);
                if (productDoc.exists()) {
                    const currentStock = productDoc.data().stock;
                    const newStock = currentStock - item.quantity;
                    
                    await updateDoc(productRef, {
                        stock: newStock,
                        lastUpdated: Timestamp.now()
                    });
                    
                    // Add stock update activity
                    await addDoc(collection(db, "activities"), {
                        type: 'stock',
                        description: `${item.name} stock updated: ${currentStock} → ${newStock}`,
                        timestamp: Timestamp.now(),
                        userId: loggedInUserId
                    });
                    
                    // If stock becomes 0, log it
                    if (newStock === 0) {
                        await addDoc(collection(db, "activities"), {
                            type: 'stock',
                            description: `${item.name} is now out of stock`,
                            timestamp: Timestamp.now(),
                            userId: loggedInUserId
                        });
                    }
                }
            }
            
            // Add sale activity
            let discountText = discountPercentage > 0 ? ` (${discountPercentage}% discount applied)` : '';
            await addDoc(collection(db, "activities"), {
                type: 'sale',
                description: `Sale #${invoiceNumber}: ${cart.length} items for ₱${totalAmount.toFixed(2)}${discountText}`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
            
            showNotification(`Payment successful! Invoice #${invoiceNumber}`, 'success');
            
            // Clear cart and close modal
            cart = [];
            currentDiscount = 0; // Reset discount
            if (discountSelect) discountSelect.value = '0';
            updateCartDisplay();
            
            const modal = document.getElementById('checkoutModal');
            if (modal) {
                modal.style.display = 'none';
            }
            
            // Reset amount tendered
            if (amountTendered) {
                amountTendered.value = '';
            }
            
            const changeAmount = document.getElementById('changeAmount');
            if (changeAmount) {
                changeAmount.textContent = '₱0.00';
            }
            
            // Refresh dashboard stats if on dashboard tab
            const dashboardTab = document.getElementById('dashboard-tab');
            if (dashboardTab && dashboardTab.classList.contains('active')) {
                loadDashboardStats();
            }
            
            // Refresh sales history if on sales tab
            const salesTab = document.getElementById('sales-tab');
            if (salesTab && salesTab.classList.contains('active')) {
                loadSalesHistory(currentSortOrder);
            }
            
        } catch (error) {
            console.error("Error processing payment:", error);
            showNotification('Error processing payment. Please try again.', 'error');
        }
    });
}

// Generate Invoice Number
async function generateInvoiceNumber() {
    try {
        const today = new Date();
        const year = today.getFullYear().toString().slice(-2);
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        
        // Get today's sales count
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startOfDay)),
            where("date", "<=", Timestamp.fromDate(endOfDay))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        const count = salesSnapshot.size + 1;
        
        // Format: INV-YYMMDD-XXXX (where XXXX is sequential number)
        const invoiceNumber = `INV-${year}${month}${day}-${count.toString().padStart(4, '0')}`;
        
        return invoiceNumber;
    } catch (error) {
        console.error("Error generating invoice number:", error);
        // Fallback to timestamp-based invoice
        return `INV-${Date.now()}`;
    }
}

// Generate Return ID
async function generateReturnId() {
    try {
        const today = new Date();
        const year = today.getFullYear().toString().slice(-2);
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        
        // Get today's returns count
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        
        const returnsQuery = query(
            collection(db, "returns"),
            where("date", ">=", Timestamp.fromDate(startOfDay)),
            where("date", "<=", Timestamp.fromDate(endOfDay))
        );
        
        const returnsSnapshot = await getDocs(returnsQuery);
        const count = returnsSnapshot.size + 1;
        
        // Format: RTV-YYMMDD-XXXX (where XXXX is sequential number)
        const returnId = `RTV-${year}${month}${day}-${count.toString().padStart(4, '0')}`;
        
        return returnId;
    } catch (error) {
        console.error("Error generating return ID:", error);
        // Fallback to timestamp-based return ID
        return `RTV-${Date.now()}`;
    }
}

// Toggle sort order
function toggleSortOrder() {
    currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
    loadSalesHistory(currentSortOrder);
    
    // Update sort button icon
    const sortIcon = document.querySelector('#sortSalesBtn i');
    if (sortIcon) {
        sortIcon.className = currentSortOrder === 'desc' ? 'fas fa-sort-amount-down' : 'fas fa-sort-amount-up';
    }
}

// Load Sales History with sorting
async function loadSalesHistory(sortOrder = 'desc') {
    try {
        const salesQuery = query(
            collection(db, "sales"),
            orderBy("date", sortOrder)
        );
        const salesSnapshot = await getDocs(salesQuery);
        
        const tableBody = document.getElementById('salesTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        if (salesSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="7" class="no-data">No sales found</td></tr>';
            return;
        }
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            const hasReturns = sale.returns && sale.returns.length > 0;
            const returnBadge = hasReturns ? '<span class="return-badge">Has Returns</span>' : '';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><span class="invoice-badge">${sale.invoiceNumber || `#${doc.id.slice(-8).toUpperCase()}`}</span> ${returnBadge}</td>
                <td>${formatDate(sale.date)}</td>
                <td>
                    <div class="items-list">
                        ${sale.items?.map(item => `
                            <div class="item-name">${item.name} x${item.quantity}</div>
                        `).join('') || 'No items'}
                    </div>
                </td>
                <td>₱${(sale.total || 0).toFixed(2)}</td>
                <td><span class="payment-method">${sale.paymentMethod || 'N/A'}</span></td>
                <td><span class="cashier-name">${sale.cashierName || 'Unknown'}</span></td>
                <td>
                    <button class="btn-icon view-sale" title="View Details" data-id="${doc.id}"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon print-sale" title="Print Receipt" data-id="${doc.id}"><i class="fas fa-print"></i></button>
                    <button class="btn-icon return-sale" title="Return Items" data-id="${doc.id}"><i class="fas fa-undo"></i></button>
                </td>
            `;
            tableBody.appendChild(row);
        });
        
        // Add event listeners to view, print, and return buttons
        document.querySelectorAll('.view-sale').forEach(btn => {
            btn.addEventListener('click', () => viewSaleDetails(btn.dataset.id));
        });
        
        document.querySelectorAll('.print-sale').forEach(btn => {
            btn.addEventListener('click', () => printReceipt(btn.dataset.id));
        });
        
        document.querySelectorAll('.return-sale').forEach(btn => {
            btn.addEventListener('click', () => openReturnModal(btn.dataset.id));
        });
        
        // Add mobile data labels
        addMobileDataLabels();
        
    } catch (error) {
        console.error("Error loading sales history:", error);
    }
}

// Filter sales by date
const salesDateFilter = document.getElementById('salesDateFilter');
if (salesDateFilter) {
    salesDateFilter.addEventListener('change', async (e) => {
        const selectedDate = e.target.value;
        if (!selectedDate) {
            loadSalesHistory(currentSortOrder);
            return;
        }
        
        try {
            const startDate = new Date(selectedDate);
            startDate.setHours(0, 0, 0, 0);
            
            const endDate = new Date(selectedDate);
            endDate.setHours(23, 59, 59, 999);
            
            const salesQuery = query(
                collection(db, "sales"),
                where("date", ">=", Timestamp.fromDate(startDate)),
                where("date", "<=", Timestamp.fromDate(endDate)),
                orderBy("date", currentSortOrder)
            );
            
            const salesSnapshot = await getDocs(salesQuery);
            
            const tableBody = document.getElementById('salesTableBody');
            if (!tableBody) return;
            
            tableBody.innerHTML = '';
            
            if (salesSnapshot.empty) {
                tableBody.innerHTML = '<tr><td colspan="7" class="no-data">No sales found for this date</td></tr>';
                return;
            }
            
            salesSnapshot.forEach(doc => {
                const sale = doc.data();
                const hasReturns = sale.returns && sale.returns.length > 0;
                const returnBadge = hasReturns ? '<span class="return-badge">Has Returns</span>' : '';
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><span class="invoice-badge">${sale.invoiceNumber || `#${doc.id.slice(-8).toUpperCase()}`}</span> ${returnBadge}</td>
                    <td>${formatDate(sale.date)}</td>
                    <td>
                        <div class="items-list">
                            ${sale.items?.map(item => `
                                <div class="item-name">${item.name} x${item.quantity}</div>
                            `).join('') || 'No items'}
                        </div>
                    </td>
                    <td>₱${(sale.total || 0).toFixed(2)}</td>
                    <td><span class="payment-method">${sale.paymentMethod || 'N/A'}</span></td>
                    <td><span class="cashier-name">${sale.cashierName || 'Unknown'}</span></td>
                    <td>
                        <button class="btn-icon view-sale" title="View Details" data-id="${doc.id}"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon print-sale" title="Print Receipt" data-id="${doc.id}"><i class="fas fa-print"></i></button>
                        <button class="btn-icon return-sale" title="Return Items" data-id="${doc.id}"><i class="fas fa-undo"></i></button>
                    </td>
                `;
                tableBody.appendChild(row);
            });
            
            // Add mobile data labels
            addMobileDataLabels();
            
        } catch (error) {
            console.error("Error filtering sales:", error);
        }
    });
}

// Sort button event listener
const sortBtn = document.getElementById('sortSalesBtn');
if (sortBtn) {
    sortBtn.addEventListener('click', toggleSortOrder);
}

// View Sale Details function
async function viewSaleDetails(saleId) {
    try {
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showNotification('Sale not found', 'error');
            return;
        }
        
        const sale = saleDoc.data();
        
        // Format items list for display
        let details = `
SALE DETAILS
════════════════════════
Invoice: ${sale.invoiceNumber}
Date: ${formatDate(sale.date)}
Cashier: ${sale.cashierName}
Payment: ${sale.paymentMethod}
Discount: ${sale.discountPercentage || 0}%
════════════════════════
ITEMS:
`;
        
        sale.items.forEach(item => {
            details += `${item.name} - ₱${item.price.toFixed(2)} x ${item.quantity} = ₱${(item.price * item.quantity).toFixed(2)}\n`;
        });
        
        details += `════════════════════════
Subtotal: ₱${sale.subtotal.toFixed(2)}
Discount (${sale.discountPercentage || 0}%): -₱${(sale.discountAmount || 0).toFixed(2)}
Total: ₱${sale.total.toFixed(2)}
Amount Tendered: ₱${sale.amountTendered.toFixed(2)}
Change: ₱${sale.change.toFixed(2)}`;
        
        // Add return history if any
        if (sale.returns && sale.returns.length > 0) {
            details += `\n════════════════════════
RETURNS:`;
            sale.returns.forEach(ret => {
                details += `\n${ret.productName} x${ret.quantity} - ₱${ret.amount.toFixed(2)} (${ret.date ? formatDate(ret.date) : 'N/A'})`;
            });
        }
        
        alert(details);
        
    } catch (error) {
        console.error("Error viewing sale details:", error);
        showNotification('Error loading sale details', 'error');
    }
}

// Print Receipt function
function printReceipt(saleId) {
    showNotification('Print feature coming soon', 'info');
    console.log('Print receipt for sale:', saleId);
}

// ========== VOID/RETURN FUNCTIONALITY ==========

// Void button in POS
const voidButton = document.getElementById('voidButton');
if (voidButton) {
    voidButton.addEventListener('click', () => {
        openReturnModal();
    });
}

// Open Return Modal
async function openReturnModal(saleId = null) {
    try {
        let returnModal = document.getElementById('returnModal');
        if (!returnModal) {
            console.error("Return modal not found");
            return;
        }
        
        // Clear previous data
        document.getElementById('returnSearch').value = '';
        document.getElementById('returnSearchResults').innerHTML = '';
        document.getElementById('selectedReturnInfo').style.display = 'none';
        
        // Update sale info based on whether we have a specific sale ID
        const saleInfoDiv = document.getElementById('returnSaleInfo');
        if (saleId) {
            const saleRef = doc(db, "sales", saleId);
            const saleDoc = await getDoc(saleRef);
            
            if (saleDoc.exists()) {
                const sale = saleDoc.data();
                saleInfoDiv.innerHTML = `
                    <h3>Return for Sale #${sale.invoiceNumber}</h3>
                    <p>Date: ${formatDate(sale.date)}</p>
                    <p>Cashier: ${sale.cashierName}</p>
                    <p>Total: ₱${sale.total.toFixed(2)}</p>
                `;
                returnModal.dataset.saleId = saleId;
            }
        } else {
            saleInfoDiv.innerHTML = '<h3>Search for a sale to process return</h3>';
            returnModal.dataset.saleId = '';
        }
        
        // Show modal
        returnModal.style.display = 'block';
        
    } catch (error) {
        console.error("Error opening return modal:", error);
        showNotification('Error opening return form', 'error');
    }
}

// Search for sales and products
const returnSearch = document.getElementById('returnSearch');
if (returnSearch) {
    returnSearch.addEventListener('input', debounce(async (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        if (searchTerm.length < 2) {
            document.getElementById('returnSearchResults').innerHTML = '';
            return;
        }
        
        await searchSalesForReturn(searchTerm);
    }, 300));
}

// Debounce function to limit search calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Search sales for return
async function searchSalesForReturn(searchTerm) {
    try {
        const resultsDiv = document.getElementById('returnSearchResults');
        resultsDiv.innerHTML = '<div class="loading">Searching...</div>';
        
        // Search by invoice number (exact match)
        const invoiceQuery = query(
            collection(db, "sales"),
            where("invoiceNumber", ">=", searchTerm.toUpperCase()),
            where("invoiceNumber", "<=", searchTerm.toUpperCase() + '\uf8ff'),
            limit(10)
        );
        
        // Search by product name in items
        const allSalesQuery = query(
            collection(db, "sales"),
            orderBy("date", "desc"),
            limit(50)
        );
        
        const invoiceSnapshot = await getDocs(invoiceQuery);
        const allSalesSnapshot = await getDocs(allSalesQuery);
        
        let results = [];
        
        // Add invoice matches
        invoiceSnapshot.forEach(doc => {
            const sale = doc.data();
            results.push({
                id: doc.id,
                type: 'sale',
                invoice: sale.invoiceNumber,
                date: sale.date,
                total: sale.total,
                items: sale.items
            });
        });
        
        // Search in items for product name
        allSalesSnapshot.forEach(doc => {
            const sale = doc.data();
            // Check if already added
            if (results.some(r => r.id === doc.id)) return;
            
            // Search in items
            const matchingItems = sale.items.filter(item => 
                item.name.toLowerCase().includes(searchTerm)
            );
            
            if (matchingItems.length > 0) {
                results.push({
                    id: doc.id,
                    type: 'product',
                    invoice: sale.invoiceNumber,
                    date: sale.date,
                    total: sale.total,
                    items: matchingItems,
                    allItems: sale.items
                });
            }
        });
        
        // Limit to 10 results
        results = results.slice(0, 10);
        
        displaySearchResults(results);
        
    } catch (error) {
        console.error("Error searching sales:", error);
        document.getElementById('returnSearchResults').innerHTML = '<p class="error">Error searching</p>';
    }
}

// Display search results
function displaySearchResults(results) {
    const resultsDiv = document.getElementById('returnSearchResults');
    
    if (results.length === 0) {
        resultsDiv.innerHTML = '<p class="no-data">No matching sales found</p>';
        return;
    }
    
    resultsDiv.innerHTML = '';
    
    results.forEach(result => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'search-result-item';
        
        if (result.type === 'sale') {
            // Show entire sale
            resultDiv.innerHTML = `
                <span class="invoice-badge">${result.invoice}</span>
                <div class="product-info">
                    <div class="product-name">Sale with ${result.items.length} items</div>
                    <div class="product-details">${formatDate(result.date)} - ₱${result.total.toFixed(2)}</div>
                </div>
            `;
            resultDiv.addEventListener('click', () => selectSaleForReturn(result.id));
        } else {
            // Show specific product
            const product = result.items[0];
            resultDiv.innerHTML = `
                <span class="invoice-badge">${result.invoice}</span>
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-details">Qty: ${product.quantity} - ₱${product.price.toFixed(2)} each</div>
                </div>
            `;
            resultDiv.addEventListener('click', () => selectProductForReturn(result.id, product.productId, product.name, product.price, product.quantity));
        }
        
        resultsDiv.appendChild(resultDiv);
    });
}

// Select entire sale for return
async function selectSaleForReturn(saleId) {
    try {
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showNotification('Sale not found', 'error');
            return;
        }
        
        const sale = saleDoc.data();
        
        // Store sale data
        const returnModal = document.getElementById('returnModal');
        returnModal.dataset.saleId = saleId;
        
        // Update sale info
        document.getElementById('returnSaleInfo').innerHTML = `
            <h3>Return for Sale #${sale.invoiceNumber}</h3>
            <p>Date: ${formatDate(sale.date)}</p>
            <p>Cashier: ${sale.cashierName}</p>
            <p>Total: ₱${sale.total.toFixed(2)}</p>
        `;
        
        // Show product selection
        const resultsDiv = document.getElementById('returnSearchResults');
        resultsDiv.innerHTML = '<h4>Select a product to return:</h4>';
        
        sale.items.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'search-result-item';
            itemDiv.innerHTML = `
                <span class="product-name">${item.name}</span>
                <span class="product-details">Qty: ${item.quantity} - ₱${item.price.toFixed(2)}</span>
            `;
            itemDiv.addEventListener('click', () => selectProductForReturn(saleId, item.productId, item.name, item.price, item.quantity));
            resultsDiv.appendChild(itemDiv);
        });
        
    } catch (error) {
        console.error("Error selecting sale:", error);
        showNotification('Error selecting sale', 'error');
    }
}

// Select specific product for return
function selectProductForReturn(saleId, productId, productName, price, maxQuantity) {
    const selectedInfo = document.getElementById('selectedReturnInfo');
    
    document.getElementById('returnInvoice').textContent = saleId.slice(-8).toUpperCase();
    document.getElementById('returnProductName').textContent = productName;
    document.getElementById('returnPrice').textContent = price.toFixed(2);
    document.getElementById('returnAvailableQty').textContent = maxQuantity;
    
    const returnQuantity = document.getElementById('returnQuantity');
    returnQuantity.max = maxQuantity;
    returnQuantity.value = 1;
    
    // Store data in dataset
    selectedInfo.dataset.saleId = saleId;
    selectedInfo.dataset.productId = productId;
    selectedInfo.dataset.productName = productName;
    selectedInfo.dataset.price = price;
    selectedInfo.dataset.maxQuantity = maxQuantity;
    
    // Clear search results
    document.getElementById('returnSearchResults').innerHTML = '';
    document.getElementById('returnSearch').value = '';
    
    // Show selected info
    selectedInfo.style.display = 'block';
}

// Process Return
async function processReturn() {
    try {
        const selectedInfo = document.getElementById('selectedReturnInfo');
        const saleId = selectedInfo.dataset.saleId;
        const productId = selectedInfo.dataset.productId;
        const productName = selectedInfo.dataset.productName;
        const price = parseFloat(selectedInfo.dataset.price);
        const returnQuantity = parseInt(document.getElementById('returnQuantity').value);
        const returnReason = document.getElementById('returnReason').value;
        const maxQuantity = parseInt(selectedInfo.dataset.maxQuantity);
        
        // Validate return quantity
        if (returnQuantity < 1 || returnQuantity > maxQuantity) {
            showNotification(`Invalid quantity. Max allowed: ${maxQuantity}`, 'error');
            return;
        }
        
        const returnAmount = price * returnQuantity;
        const returnTotal = returnAmount; // No tax now
        
        // Get sale reference
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showNotification('Sale not found', 'error');
            return;
        }
        
        const sale = saleDoc.data();
        
        // Generate return ID
        const returnId = await generateReturnId();
        
        // Get cashier name
        const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
        
        // Create return record
        const returnData = {
            returnId: returnId,
            originalSaleId: saleId,
            originalInvoiceNumber: sale.invoiceNumber,
            productId: productId,
            productName: productName,
            price: price,
            quantity: returnQuantity,
            amount: returnAmount,
            reason: returnReason,
            date: Timestamp.now(),
            cashierId: loggedInUserId,
            cashierName: cashierName,
            status: 'completed'
        };
        
        await addDoc(collection(db, "returns"), returnData);
        
        // Update product stock (add back the returned quantity)
        const productRef = doc(db, "products", productId);
        const productDoc = await getDoc(productRef);
        
        if (productDoc.exists()) {
            const currentStock = productDoc.data().stock;
            const newStock = currentStock + returnQuantity;
            
            await updateDoc(productRef, {
                stock: newStock,
                lastUpdated: Timestamp.now()
            });
            
            // Add stock update activity
            await addDoc(collection(db, "activities"), {
                type: 'stock',
                description: `Return: ${returnQuantity} ${productName} added back to stock`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
        }
        
        // Update sale record to mark as having returns
        const saleReturns = sale.returns || [];
        saleReturns.push({
            returnId: returnId,
            productId: productId,
            productName: productName,
            quantity: returnQuantity,
            amount: returnAmount,
            date: Timestamp.now()
        });
        
        await updateDoc(saleRef, {
            returns: saleReturns,
            total: sale.total - returnAmount,
            subtotal: sale.subtotal - returnAmount,
            lastUpdated: Timestamp.now()
        });
        
        // Add return activity
        await addDoc(collection(db, "activities"), {
            type: 'return',
            description: `Return #${returnId}: ${returnQuantity} x ${productName} - ₱${returnAmount.toFixed(2)} refunded`,
            timestamp: Timestamp.now(),
            userId: loggedInUserId
        });
        
        showNotification(`Return processed successfully! Return ID: ${returnId}`, 'success');
        
        // Close modal
        document.getElementById('returnModal').style.display = 'none';
        
        // Refresh data
        loadDashboardStats();
        loadSalesHistory(currentSortOrder);
        loadInventory();
        
    } catch (error) {
        console.error("Error processing return:", error);
        showNotification('Error processing return', 'error');
    }
}

// Process Return button event listener
const processReturnBtn = document.getElementById('processReturnBtn');
if (processReturnBtn) {
    processReturnBtn.addEventListener('click', (e) => {
        e.preventDefault();
        processReturn();
    });
}

// ========== PDF REPORT GENERATION FUNCTIONS ==========

// Download Sales History as PDF
async function downloadSalesPDF() {
    try {
        showNotification('Generating PDF report...', 'info');
        
        // Get the current filtered sales data
        const tableBody = document.getElementById('salesTableBody');
        const rows = tableBody.querySelectorAll('tr');
        
        if (rows.length === 0 || (rows.length === 1 && rows[0].querySelector('.no-data'))) {
            showNotification('No sales data to export', 'error');
            return;
        }
        
        // Create new PDF document
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });
        
        // Add header
        doc.setFontSize(18);
        doc.setTextColor(44, 62, 80);
        doc.text('GMDC BOTICA - Sales History Report', 14, 15);
        
        // Add date and time
        doc.setFontSize(10);
        doc.setTextColor(127, 140, 141);
        const now = new Date();
        doc.text(`Generated on: ${formatDateForPDF(now)}`, 14, 22);
        
        // Get cashier name
        const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
        doc.text(`Generated by: ${cashierName}`, 14, 27);
        
        // Prepare table data
        const tableColumn = ["Invoice #", "Date", "Items", "Total (₱)", "Payment Method", "Cashier"];
        const tableRows = [];
        
        let grandTotal = 0;
        let transactionCount = 0;
        
        rows.forEach(row => {
            if (row.querySelector('.no-data')) return;
            
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return;
            
            const invoice = cells[0]?.textContent?.replace(/Has Returns/g, '').trim() || 'N/A';
            const date = cells[1]?.textContent || 'N/A';
            const items = cells[2]?.textContent?.replace(/\s+/g, ' ').trim() || 'No items';
            const totalText = cells[3]?.textContent || '₱0.00';
            const total = parseFloat(totalText.replace('₱', '')) || 0;
            const payment = cells[4]?.textContent || 'N/A';
            const cashier = cells[5]?.textContent || 'Unknown';
            
            grandTotal += total;
            transactionCount++;
            
            tableRows.push([
                invoice,
                date,
                items.substring(0, 30) + (items.length > 30 ? '...' : ''),
                total.toFixed(2),
                payment,
                cashier
            ]);
        });
        
        // Add summary
        doc.setFontSize(12);
        doc.setTextColor(52, 152, 219);
        doc.text(`Summary: ${transactionCount} transactions | Total Sales: ₱${grandTotal.toFixed(2)}`, 14, 35);
        
        // Add table using autoTable
        doc.autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: 40,
            theme: 'striped',
            headStyles: {
                fillColor: [52, 152, 219],
                textColor: [255, 255, 255],
                fontStyle: 'bold'
            },
            alternateRowStyles: {
                fillColor: [245, 246, 250]
            },
            columnStyles: {
                0: { cellWidth: 30 },
                1: { cellWidth: 35 },
                2: { cellWidth: 60 },
                3: { cellWidth: 25, halign: 'right' },
                4: { cellWidth: 30 },
                5: { cellWidth: 30 }
            },
            margin: { top: 40 }
        });
        
        // Add footer
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(
                `Page ${i} of ${pageCount}`,
                doc.internal.pageSize.width - 20,
                doc.internal.pageSize.height - 10
            );
            doc.text(
                'GMDC BOTICA Pharmacy Management System',
                14,
                doc.internal.pageSize.height - 10
            );
        }
        
        // Save PDF
        const fileName = `sales_report_${formatDateForFileName(now)}.pdf`;
        doc.save(fileName);
        
        showNotification('PDF report downloaded successfully!', 'success');
        
    } catch (error) {
        console.error("Error generating PDF:", error);
        showNotification('Error generating PDF report', 'error');
    }
}

// Download Reports Tab PDF (Enhanced with Product Sales Breakdown)
async function downloadReportPDF() {
    try {
        showNotification('Generating comprehensive PDF report...', 'info');
        
        const selectedMonth = parseInt(document.getElementById('reportMonth')?.value || new Date().getMonth());
        const selectedYear = parseInt(document.getElementById('reportYear')?.value || new Date().getFullYear());
        const period = document.getElementById('reportPeriod')?.value || 'daily';
        
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                            'July', 'August', 'September', 'October', 'November', 'December'];
        
        // Get chart as image
        const chartCanvas = document.getElementById('reportChart');
        if (!chartCanvas) {
            showNotification('No chart data to export', 'error');
            return;
        }
        
        // Get stats
        const statsCards = document.querySelectorAll('#reportStats .stat-card');
        let totalSales = 0;
        let transactions = 0;
        let averageSale = 0;
        
        if (statsCards.length >= 3) {
            totalSales = parseFloat(statsCards[0]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
            transactions = parseInt(statsCards[1]?.querySelector('p')?.textContent || 0);
            averageSale = parseFloat(statsCards[2]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
        }
        
        // Get product sales breakdown data
        const productSalesData = await getProductSalesData(selectedMonth, selectedYear);
        
        // Create new PDF document (portrait for better product list display)
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        let yPos = 15;
        
        // Add header
        doc.setFontSize(20);
        doc.setTextColor(44, 62, 80);
        doc.text('GMDC BOTICA - Comprehensive Sales Report', 14, yPos);
        yPos += 8;
        
        // Add report info
        doc.setFontSize(14);
        doc.setTextColor(52, 152, 219);
        doc.text(`${monthNames[selectedMonth]} ${selectedYear} - ${period.charAt(0).toUpperCase() + period.slice(1)} Report`, 14, yPos);
        yPos += 7;
        
        // Add date and time
        doc.setFontSize(10);
        doc.setTextColor(127, 140, 141);
        const now = new Date();
        doc.text(`Generated on: ${formatDateForPDF(now)}`, 14, yPos);
        yPos += 5;
        
        // Get cashier name
        const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
        doc.text(`Generated by: ${cashierName}`, 14, yPos);
        yPos += 10;
        
        // Add summary stats
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.text('Summary Statistics', 14, yPos);
        yPos += 7;
        
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text(`Total Sales: ₱${totalSales.toFixed(2)}`, 20, yPos);
        yPos += 6;
        doc.text(`Number of Transactions: ${transactions}`, 20, yPos);
        yPos += 6;
        doc.text(`Average Sale: ₱${averageSale.toFixed(2)}`, 20, yPos);
        yPos += 10;
        
        // Add chart as image
        try {
            const chartImage = chartCanvas.toDataURL('image/png');
            doc.addImage(chartImage, 'PNG', 14, yPos, 180, 80);
            yPos += 85;
        } catch (error) {
            console.error("Error adding chart to PDF:", error);
            yPos += 10;
        }
        
        // Add Product Sales Breakdown
        if (productSalesData.length > 0) {
            doc.setFontSize(14);
            doc.setTextColor(44, 62, 80);
            doc.text('Product Sales Breakdown', 14, yPos);
            yPos += 7;
            
            // Prepare product sales table
            const productTableColumn = ["Product Name", "Qty Sold", "Revenue (₱)", "% of Total"];
            const productTableRows = [];
            
            let totalItemsSold = 0;
            productSalesData.forEach(p => {
                totalItemsSold += p.quantity;
            });
            
            productSalesData.forEach(product => {
                const percentage = totalItemsSold > 0 ? ((product.quantity / totalItemsSold) * 100).toFixed(1) : 0;
                productTableRows.push([
                    product.name,
                    product.quantity.toString(),
                    product.revenue.toFixed(2),
                    percentage + '%'
                ]);
            });
            
            doc.autoTable({
                head: [productTableColumn],
                body: productTableRows,
                startY: yPos,
                theme: 'striped',
                headStyles: {
                    fillColor: [52, 152, 219],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold'
                },
                columnStyles: {
                    0: { cellWidth: 70 },
                    1: { cellWidth: 30, halign: 'center' },
                    2: { cellWidth: 40, halign: 'right' },
                    3: { cellWidth: 30, halign: 'center' }
                }
            });
            
            // Update yPos after table
            yPos = doc.lastAutoTable.finalY + 10;
        }
        
        // Add footer
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(
                `Page ${i} of ${pageCount}`,
                doc.internal.pageSize.width - 20,
                doc.internal.pageSize.height - 10
            );
            doc.text(
                'GMDC BOTICA Pharmacy Management System',
                14,
                doc.internal.pageSize.height - 10
            );
        }
        
        // Save PDF
        const fileName = `comprehensive_report_${monthNames[selectedMonth]}_${selectedYear}_${formatDateForFileName(now)}.pdf`;
        doc.save(fileName);
        
        showNotification('Comprehensive PDF report downloaded successfully!', 'success');
        
    } catch (error) {
        console.error("Error generating report PDF:", error);
        showNotification('Error generating PDF report', 'error');
    }
}

// Helper function to get product sales data for PDF
async function getProductSalesData(selectedMonth, selectedYear) {
    try {
        // Create date range for selected month
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        // Get all sales for the selected month
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
        // Aggregate product sales
        const productSales = {};
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const productName = item.name || 'Unknown Product';
                    if (!productSales[productName]) {
                        productSales[productName] = {
                            quantity: 0,
                            revenue: 0
                        };
                    }
                    productSales[productName].quantity += item.quantity || 0;
                    productSales[productName].revenue += (item.price * item.quantity) || 0;
                });
            }
        });
        
        // Convert to array and sort by quantity sold
        const productSalesArray = Object.entries(productSales).map(([name, data]) => ({
            name,
            quantity: data.quantity,
            revenue: data.revenue
        }));
        
        productSalesArray.sort((a, b) => b.quantity - a.quantity);
        
        return productSalesArray;
        
    } catch (error) {
        console.error("Error getting product sales data:", error);
        return [];
    }
}

// Helper function to format date for PDF
function formatDateForPDF(date) {
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Helper function to format date for filename
function formatDateForFileName(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}`;
}

// ========== REPORTS FUNCTIONALITY ==========

// Load Reports Tab
async function loadReportsTab() {
    try {
        console.log("Loading reports tab...");
        
        // Populate year dropdown
        populateYearDropdown();
        
        // Set current month as default
        const today = new Date();
        document.getElementById('reportMonth').value = today.getMonth().toString();
        
        // Set up report period selector
        const reportPeriod = document.getElementById('reportPeriod');
        if (reportPeriod) {
            // Remove existing listeners
            const newReportPeriod = reportPeriod.cloneNode(true);
            reportPeriod.parentNode.replaceChild(newReportPeriod, reportPeriod);
            
            newReportPeriod.addEventListener('change', () => {
                generateReport();
            });
        }
        
        // Set up month selector
        const reportMonth = document.getElementById('reportMonth');
        if (reportMonth) {
            const newReportMonth = reportMonth.cloneNode(true);
            reportMonth.parentNode.replaceChild(newReportMonth, reportMonth);
            
            newReportMonth.addEventListener('change', () => {
                generateReport();
            });
        }
        
        // Set up year selector
        const reportYear = document.getElementById('reportYear');
        if (reportYear) {
            const newReportYear = reportYear.cloneNode(true);
            reportYear.parentNode.replaceChild(newReportYear, reportYear);
            
            newReportYear.addEventListener('change', () => {
                generateReport();
            });
        }
        
        // Set up generate report button
        const generateBtn = document.getElementById('generateReportBtn');
        if (generateBtn) {
            const newGenerateBtn = generateBtn.cloneNode(true);
            generateBtn.parentNode.replaceChild(newGenerateBtn, generateBtn);
            
            newGenerateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                generateReport();
            });
        }
        
        // Generate report with current selections
        setTimeout(() => {
            generateReport();
        }, 500);
        
    } catch (error) {
        console.error("Error loading reports tab:", error);
        showNotification('Error loading reports', 'error');
    }
}

// Populate year dropdown (last 5 years to next year)
function populateYearDropdown() {
    const yearSelect = document.getElementById('reportYear');
    if (!yearSelect) return;
    
    const currentYear = new Date().getFullYear();
    
    // Clear existing options
    yearSelect.innerHTML = '';
    
    // Add last 5 years and next year
    for (let i = currentYear - 5; i <= currentYear + 1; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        if (i === currentYear) {
            option.selected = true;
        }
        yearSelect.appendChild(option);
    }
}

// Generate Report based on selected month and year
async function generateReport() {
    try {
        console.log("Generating report...");
        
        const reportContent = document.getElementById('reportStats');
        const reportSummary = document.getElementById('reportSummary');
        const chartCanvas = document.getElementById('reportChart');
        
        if (!reportContent || !chartCanvas) {
            console.error("Report elements not found");
            return;
        }
        
        // Show loading state
        reportContent.innerHTML = '<div class="loading">Generating report...</div>';
        if (reportSummary) {
            reportSummary.innerHTML = '';
        }
        
        // Get selected values
        const selectedMonth = parseInt(document.getElementById('reportMonth')?.value || new Date().getMonth());
        const selectedYear = parseInt(document.getElementById('reportYear')?.value || new Date().getFullYear());
        const period = document.getElementById('reportPeriod')?.value || 'daily';
        
        console.log(`Generating ${period} report for ${selectedMonth + 1}/${selectedYear}`);
        
        let labels = [];
        let data = [];
        let totalSales = 0;
        let totalTransactions = 0;
        let averageSale = 0;
        
        // Create date range for selected month
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        // Get sales for the selected month
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate)),
            orderBy("date", "asc")
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        console.log(`Found ${salesSnapshot.size} sales for this period`);
        
        const sales = [];
        salesSnapshot.forEach(doc => {
            sales.push({ id: doc.id, ...doc.data() });
        });
        
        // Process data based on period
        switch(period) {
            case 'daily':
                // Group by day of month
                const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
                const dailyData = new Array(daysInMonth).fill(0);
                const dailyCount = new Array(daysInMonth).fill(0);
                
                sales.forEach(sale => {
                    const saleDate = sale.date.toDate();
                    const day = saleDate.getDate() - 1; // 0-based index
                    if (day >= 0 && day < daysInMonth) {
                        dailyData[day] += sale.total || 0;
                        dailyCount[day]++;
                    }
                });
                
                // Create labels (1, 2, 3...)
                labels = [];
                for (let i = 1; i <= daysInMonth; i++) {
                    labels.push(`${i}`);
                }
                data = dailyData;
                totalSales = dailyData.reduce((sum, val) => sum + val, 0);
                totalTransactions = dailyCount.reduce((sum, val) => sum + val, 0);
                break;
                
            case 'weekly':
                // Group by week
                const weeksInMonth = 5; // Max weeks in a month
                const weeklyData = new Array(weeksInMonth).fill(0);
                const weeklyCount = new Array(weeksInMonth).fill(0);
                
                sales.forEach(sale => {
                    const saleDate = sale.date.toDate();
                    const dayOfMonth = saleDate.getDate();
                    const weekIndex = Math.floor((dayOfMonth - 1) / 7);
                    if (weekIndex < weeksInMonth) {
                        weeklyData[weekIndex] += sale.total || 0;
                        weeklyCount[weekIndex]++;
                    }
                });
                
                labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
                data = weeklyData;
                totalSales = weeklyData.reduce((sum, val) => sum + val, 0);
                totalTransactions = weeklyCount.reduce((sum, val) => sum + val, 0);
                break;
                
            case 'monthly':
                // Show last 6 months including selected month
                labels = [];
                data = [];
                const monthlyData = [];
                const monthlyCount = [];
                
                for (let i = 5; i >= 0; i--) {
                    const monthDate = new Date(selectedYear, selectedMonth - i, 1);
                    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
                    monthStart.setHours(0, 0, 0, 0);
                    
                    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
                    monthEnd.setHours(0, 0, 0, 0);
                    
                    // Get sales for this month
                    const monthSalesQuery = query(
                        collection(db, "sales"),
                        where("date", ">=", Timestamp.fromDate(monthStart)),
                        where("date", "<", Timestamp.fromDate(monthEnd))
                    );
                    
                    const monthSalesSnapshot = await getDocs(monthSalesQuery);
                    let monthTotal = 0;
                    let monthCount = 0;
                    
                    monthSalesSnapshot.forEach(doc => {
                        const sale = doc.data();
                        monthTotal += sale.total || 0;
                        monthCount++;
                    });
                    
                    labels.push(monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
                    data.push(monthTotal);
                    monthlyData.push(monthTotal);
                    monthlyCount.push(monthCount);
                }
                
                totalSales = monthlyData.reduce((sum, val) => sum + val, 0);
                totalTransactions = monthlyCount.reduce((sum, val) => sum + val, 0);
                break;
        }
        
        averageSale = totalTransactions > 0 ? totalSales / totalTransactions : 0;
        
        // Display report
        displayFixedReport(period, labels, data, totalSales, totalTransactions, averageSale, selectedMonth, selectedYear);
        
        // Now get product sales breakdown
        await loadProductSalesBreakdown(selectedMonth, selectedYear);
        
    } catch (error) {
        console.error("Error generating report:", error);
        const reportContent = document.getElementById('reportStats');
        if (reportContent) {
            reportContent.innerHTML = '<p class="error">Error generating report. Please try again.</p>';
        }
        showNotification('Error generating report', 'error');
    }
}

// Load Product Sales Breakdown
async function loadProductSalesBreakdown(selectedMonth, selectedYear) {
    try {
        const productSalesContainer = document.getElementById('productSalesBreakdown');
        if (!productSalesContainer) return;
        
        // Create date range for selected month
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        // Get all sales for the selected month
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
        // Aggregate product sales
        const productSales = {};
        let totalItemsSold = 0;
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const productName = item.name || 'Unknown Product';
                    if (!productSales[productName]) {
                        productSales[productName] = {
                            quantity: 0,
                            revenue: 0,
                            productId: item.productId || 'unknown'
                        };
                    }
                    productSales[productName].quantity += item.quantity || 0;
                    productSales[productName].revenue += (item.price * item.quantity) || 0;
                    totalItemsSold += item.quantity || 0;
                });
            }
        });
        
        // Convert to array and sort by quantity sold (descending)
        const productSalesArray = Object.entries(productSales).map(([name, data]) => ({
            name,
            quantity: data.quantity,
            revenue: data.revenue
        }));
        
        productSalesArray.sort((a, b) => b.quantity - a.quantity);
        
        // Display product sales breakdown
        displayProductSalesBreakdown(productSalesArray, totalItemsSold);
        
    } catch (error) {
        console.error("Error loading product sales breakdown:", error);
        const productSalesContainer = document.getElementById('productSalesBreakdown');
        if (productSalesContainer) {
            productSalesContainer.innerHTML = '<p class="error">Error loading product sales</p>';
        }
    }
}

// Display Product Sales Breakdown
function displayProductSalesBreakdown(productSales, totalItemsSold) {
    const container = document.getElementById('productSalesBreakdown');
    if (!container) return;
    
    if (productSales.length === 0) {
        container.innerHTML = '<p class="no-data">No product sales data for this period</p>';
        return;
    }
    
    let html = `
        <div class="product-sales-header">
            <h3><i class="fas fa-chart-pie"></i> Product Sales Breakdown</h3>
            <p>Total Items Sold: ${totalItemsSold}</p>
        </div>
        <div class="product-sales-table-container">
            <table class="product-sales-table">
                <thead>
                    <tr>
                        <th>Product Name</th>
                        <th>Quantity Sold</th>
                        <th>Revenue (₱)</th>
                        <th>% of Total</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    productSales.forEach(product => {
        const percentage = totalItemsSold > 0 ? ((product.quantity / totalItemsSold) * 100).toFixed(1) : 0;
        html += `
            <tr>
                <td>${product.name}</td>
                <td><strong>${product.quantity}</strong> pcs</td>
                <td>₱${product.revenue.toFixed(2)}</td>
                <td>${percentage}%</td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = html;
}

// Display report with chart
function displayFixedReport(period, labels, data, totalSales, totalTransactions, averageSale, selectedMonth, selectedYear) {
    const reportContent = document.getElementById('reportStats');
    const reportSummary = document.getElementById('reportSummary');
    const chartCanvas = document.getElementById('reportChart');
    
    if (!reportContent || !chartCanvas) return;
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    // Update stats
    reportContent.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-chart-line"></i>
                </div>
                <div class="stat-info">
                    <h3>Total Sales</h3>
                    <p>₱${totalSales.toFixed(2)}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-receipt"></i>
                </div>
                <div class="stat-info">
                    <h3>Transactions</h3>
                    <p>${totalTransactions}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-calculator"></i>
                </div>
                <div class="stat-info">
                    <h3>Average Sale</h3>
                    <p>₱${averageSale.toFixed(2)}</p>
                </div>
            </div>
        </div>
    `;
    
    // Add summary
    if (reportSummary) {
        reportSummary.innerHTML = `
            <div class="report-period-info">
                <h3>Report Period: ${monthNames[selectedMonth]} ${selectedYear}</h3>
                <p>Showing ${period} sales data for the selected period.</p>
            </div>
        `;
    }
    
    // Destroy previous chart if exists
    if (window.reportChartInstance) {
        window.reportChartInstance.destroy();
    }
    
    // Create new chart
    const ctx = chartCanvas.getContext('2d');
    
    // Chart configuration
    const chartConfig = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: period === 'daily' ? 'Daily Sales' : (period === 'weekly' ? 'Weekly Sales' : 'Monthly Sales'),
                data: data,
                backgroundColor: 'rgba(52, 152, 219, 0.7)',
                borderColor: 'rgba(52, 152, 219, 1)',
                borderWidth: 2,
                borderRadius: 5,
                barPercentage: 0.7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `${monthNames[selectedMonth]} ${selectedYear} - ${period.charAt(0).toUpperCase() + period.slice(1)} Sales Report`,
                    font: {
                        size: 16,
                        weight: 'bold'
                    }
                },
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += '₱' + context.parsed.y.toFixed(2);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₱' + value.toFixed(2);
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    };
    
    // Create new chart instance
    try {
        window.reportChartInstance = new Chart(ctx, chartConfig);
        console.log("Chart created successfully");
    } catch (error) {
        console.error("Error creating chart:", error);
    }
}

// Add Product Modal
const modal = document.getElementById('productModal');
const addProductBtn = document.getElementById('addProductBtn');
const closeBtn = document.querySelector('.close');

if (addProductBtn && modal) {
    addProductBtn.addEventListener('click', () => {
        // Reset form for new product
        document.getElementById('productForm').reset();
        document.getElementById('productForm').dataset.editId = '';
        document.querySelector('#productModal .modal-header h2').textContent = 'Add New Product';
        const submitBtn = document.querySelector('#productForm button[type="submit"]');
        submitBtn.textContent = 'Add Product';
        
        modal.style.display = 'block';
    });
}

if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
}

if (modal) {
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// Close modal buttons for checkout
const closeModalBtns = document.querySelectorAll('.modal .close');
closeModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const modal = btn.closest('.modal');
        if (modal) {
            modal.style.display = 'none';
        }
    });
});

// Close dashboard modals
const closeLowStockModal = document.querySelector('#lowStockModal .close');
if (closeLowStockModal) {
    closeLowStockModal.addEventListener('click', () => {
        document.getElementById('lowStockModal').style.display = 'none';
    });
}

const closeTodaySalesModal = document.querySelector('#todaySalesModal .close');
if (closeTodaySalesModal) {
    closeTodaySalesModal.addEventListener('click', () => {
        document.getElementById('todaySalesModal').style.display = 'none';
    });
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    const lowStockModal = document.getElementById('lowStockModal');
    const todaySalesModal = document.getElementById('todaySalesModal');
    
    if (e.target === lowStockModal) {
        lowStockModal.style.display = 'none';
    }
    if (e.target === todaySalesModal) {
        todaySalesModal.style.display = 'none';
    }
});

// Add Product Form Submit
const productForm = document.getElementById('productForm');
if (productForm) {
    productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const editId = productForm.dataset.editId;
        
        try {
            const productData = {
                code: document.getElementById('productCode')?.value || '',
                name: document.getElementById('productName')?.value || '',
                category: document.getElementById('productCategory')?.value || '',
                price: parseFloat(document.getElementById('productPrice')?.value) || 0,
                stock: parseInt(document.getElementById('productStock')?.value) || 0,
                expiryDate: Timestamp.fromDate(new Date(document.getElementById('productExpiry')?.value || Date.now())),
                description: document.getElementById('productDescription')?.value || '',
                lastUpdated: Timestamp.now()
            };
            
            if (editId) {
                // Update existing product
                const productRef = doc(db, "products", editId);
                await updateDoc(productRef, productData);
                
                // Add activity
                await addDoc(collection(db, "activities"), {
                    type: 'product',
                    description: `Product updated: ${productData.name}`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
                
                showNotification('Product updated successfully!', 'success');
            } else {
                // Add new product
                productData.createdAt = Timestamp.now();
                await addDoc(collection(db, "products"), productData);
                
                // Add activity
                await addDoc(collection(db, "activities"), {
                    type: 'product',
                    description: `New product added: ${productData.name}`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
                
                showNotification('Product added successfully!', 'success');
            }
            
            if (modal) {
                modal.style.display = 'none';
            }
            
            productForm.reset();
            productForm.dataset.editId = '';
            
            // Refresh inventory
            loadInventory();
            
        } catch (error) {
            console.error("Error saving product:", error);
            showNotification('Error saving product. Please try again.', 'error');
        }
    });
}

// Helper function to format date
function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    try {
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return 'Invalid Date';
    }
}

// Logout functionality
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

// Add mobile data labels function
function addMobileDataLabels() {
    // For inventory table
    const inventoryRows = document.querySelectorAll('#inventoryTableBody tr');
    inventoryRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const labels = ['Product Code', 'Product Name', 'Category', 'Price', 'Stock', 'Expiry Date', 'Actions'];
        cells.forEach((cell, index) => {
            cell.setAttribute('data-label', labels[index]);
        });
    });

    // For sales table
    const salesRows = document.querySelectorAll('#salesTableBody tr');
    salesRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const labels = ['Invoice #', 'Date', 'Items', 'Total', 'Payment', 'Cashier', 'Actions'];
        cells.forEach((cell, index) => {
            cell.setAttribute('data-label', labels[index]);
        });
        
        // Special handling for items column to preserve HTML
        if (cells[2]) {
            const itemsContent = cells[2].innerHTML;
            cells[2].setAttribute('data-label', 'Items');
            cells[2].innerHTML = itemsContent;
        }
    });
}

// Fix mobile POS scroll
function fixMobilePOSScroll() {
    const productsSection = document.querySelector('.products-section');
    const productsGrid = document.getElementById('productsGrid');
    
    if (productsSection && productsGrid) {
        // Calculate available height
        const windowHeight = window.innerHeight;
        const headerHeight = document.querySelector('.mobile-header')?.offsetHeight || 60;
        const welcomeMessage = document.querySelector('.welcome-message')?.offsetHeight || 0;
        const posHeader = document.querySelector('.pos-header')?.offsetHeight || 60;
        
        // Set fixed height for products grid with scroll
        const availableHeight = windowHeight - headerHeight - welcomeMessage - posHeader - 100; // Extra padding
        productsGrid.style.maxHeight = `${availableHeight}px`;
        productsGrid.style.overflowY = 'auto';
        productsGrid.style.overflowX = 'hidden';
    }
}

// Add event listeners for PDF buttons
document.addEventListener('DOMContentLoaded', () => {
    // Download Sales PDF button
    const downloadPDFBtn = document.getElementById('downloadPDFBtn');
    if (downloadPDFBtn) {
        downloadPDFBtn.addEventListener('click', (e) => {
            e.preventDefault();
            downloadSalesPDF();
        });
    }
    
    // Download Report PDF button
    const downloadReportPDFBtn = document.getElementById('downloadReportPDFBtn');
    if (downloadReportPDFBtn) {
        downloadReportPDFBtn.addEventListener('click', (e) => {
            e.preventDefault();
            downloadReportPDF();
        });
    }

    // Add close button listeners for dashboard modals
    const lowStockCloseBtn = document.querySelector('#lowStockModal .close');
    if (lowStockCloseBtn) {
        lowStockCloseBtn.addEventListener('click', () => {
            document.getElementById('lowStockModal').style.display = 'none';
        });
    }
    
    const todaySalesCloseBtn = document.querySelector('#todaySalesModal .close');
    if (todaySalesCloseBtn) {
        todaySalesCloseBtn.addEventListener('click', () => {
            document.getElementById('todaySalesModal').style.display = 'none';
        });
    }
});

// Initialize dashboard on load
document.addEventListener('DOMContentLoaded', () => {
    // Load default tab
    const defaultTab = document.querySelector('.nav-item.active');
    if (defaultTab) {
        const tabId = defaultTab.getAttribute('data-tab');
        if (tabId === 'dashboard') loadDashboardStats();
        if (tabId === 'inventory') {
            loadInventory();
            setTimeout(() => setupInventoryFilters(), 500);
        }
        if (tabId === 'pos') loadProducts();
        if (tabId === 'sales') loadSalesHistory('desc');
        if (tabId === 'reports') loadReportsTab();
    }

    // Initialize discount select
    const discountSelect = document.getElementById('discountSelect');
    if (discountSelect) {
        discountSelect.addEventListener('change', (e) => {
            currentDiscount = parseInt(e.target.value) || 0;
            updateCartDisplay();
        });
    }
});

// Add window resize listener to handle orientation changes and scrolling
window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
        addMobileDataLabels();
        fixMobilePOSScroll();
    }
});

// Add scroll fix when POS tab becomes active
document.querySelectorAll('.nav-item[data-tab="pos"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(() => {
            if (window.innerWidth <= 768) {
                fixMobilePOSScroll();
            }
        }, 100); // Small delay to ensure content is loaded
    });
});

// Add scroll fix when dashboard tab becomes active
document.querySelectorAll('.nav-item[data-tab="dashboard"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(() => {
            loadRecentActivities();
        }, 100);
    });
});

// Add reports tab loader
document.querySelectorAll('.nav-item[data-tab="reports"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(() => {
            loadReportsTab();
        }, 100);
    });
});

// Function to open sale details panel
window.openSalePanel = async function(saleId) {
    try {
        const modal = document.getElementById('saleDetailsModal');
        const panelBody = document.getElementById('salePanelBody');
        
        if (!modal || !panelBody) {
            console.error("Panel elements not found");
            return;
        }
        
        // Show loading
        panelBody.innerHTML = `
            <div style="text-align: center; padding: 50px;">
                <i class="fas fa-spinner fa-spin" style="font-size: 40px; color: #3498db;"></i>
                <p style="margin-top: 20px; color: #7f8c8d;">Loading sale details...</p>
            </div>
        `;
        modal.style.display = 'block';
        
        // For demo, show sample data
        if (!saleId || saleId === 'demo') {
            showSampleSalePanel();
            return;
        }
        
        // Try to get real data
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showSampleSalePanel();
            return;
        }
        
        const sale = saleDoc.data();
        
        // Format date
        const saleDate = sale.date?.toDate ? sale.date.toDate() : new Date();
        const formattedDate = saleDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit'
        });
        
        // Build panel HTML
        panelBody.innerHTML = buildSalePanelHTML(sale, formattedDate);
        
    } catch (error) {
        console.error("Error opening sale panel:", error);
        showSampleSalePanel();
    }
}

// Function to close panel
window.closeSalePanel = function() {
    const modal = document.getElementById('saleDetailsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Build panel HTML from sale data
function buildSalePanelHTML(sale, formattedDate) {
    const subtotal = sale.subtotal || 0;
    const discountPercentage = sale.discountPercentage || 0;
    const discountAmount = sale.discountAmount || 0;
    const total = sale.total || 0;
    const amountTendered = sale.amountTendered || 0;
    const change = sale.change || 0;
    
    const itemsHtml = sale.items ? sale.items.map(item => `
        <div class="item-row">
            <div class="item-info">
                <div class="item-name">${item.name}</div>
                <div class="item-meta">
                    <span>Code: ${item.code || 'N/A'}</span>
                    <span class="item-qty">Qty: ${item.quantity}</span>
                </div>
            </div>
            <div class="item-price">₱${(item.price * item.quantity).toFixed(2)}</div>
        </div>
    `).join('') : '<p style="text-align: center; color: #7f8c8d;">No items found</p>';
    
    return `
        <!-- Invoice Card -->
        <div class="invoice-card">
            <div class="invoice-header">
                <div class="invoice-number">
                    ${sale.invoiceNumber || 'N/A'}
                    <span>${sale.paymentMethod || 'Cash'}</span>
                </div>
                <div class="payment-badge">PAID</div>
            </div>
            <div class="invoice-details">
                <div class="detail-row">
                    <i class="fas fa-calendar-alt"></i>
                    <strong>Date:</strong>
                    <span>${formattedDate}</span>
                </div>
                <div class="detail-row">
                    <i class="fas fa-user"></i>
                    <strong>Cashier:</strong>
                    <span>${sale.cashierName || 'Unknown'}</span>
                </div>
                <div class="detail-row">
                    <i class="fas fa-id-card"></i>
                    <strong>Cashier ID:</strong>
                    <span>${sale.cashierId ? sale.cashierId.slice(-8) : 'N/A'}</span>
                </div>
            </div>
        </div>
        
        <!-- Items Card -->
        <div class="items-card">
            <div class="items-header">
                <i class="fas fa-shopping-cart"></i>
                <h3>Items Purchased</h3>
            </div>
            <div class="item-list">
                ${itemsHtml}
            </div>
        </div>
        
        <!-- Summary Card -->
        <div class="summary-card">
            <div class="summary-row">
                <span class="summary-label">Subtotal:</span>
                <span class="summary-value">₱${subtotal.toFixed(2)}</span>
            </div>
            ${discountPercentage > 0 ? `
            <div class="summary-row">
                <span class="summary-label">Discount (${discountPercentage}%):</span>
                <span class="summary-value" style="color: #e74c3c;">-₱${discountAmount.toFixed(2)}</span>
            </div>
            ` : ''}
            <div class="summary-row total-row">
                <span class="total-label">Total Amount:</span>
                <span class="total-value">₱${total.toFixed(2)}</span>
            </div>
        </div>
        
        <!-- Payment Card -->
        <div class="payment-card">
            <div class="payment-header">
                <i class="fas fa-credit-card"></i>
                <h3>Payment Details</h3>
            </div>
            <div class="payment-grid">
                <div class="payment-item">
                    <div class="label">Method</div>
                    <div class="value">${sale.paymentMethod || 'Cash'}</div>
                </div>
                <div class="payment-item">
                    <div class="label">Tendered</div>
                    <div class="value cash">₱${amountTendered.toFixed(2)}</div>
                </div>
                <div class="payment-item">
                    <div class="label">Change</div>
                    <div class="value change">₱${change.toFixed(2)}</div>
                </div>
            </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="panel-actions">
            <button class="panel-btn print" onclick="alert('Print feature coming soon!')">
                <i class="fas fa-print"></i> Print
            </button>
            <button class="panel-btn pdf" onclick="alert('PDF download coming soon!')">
                <i class="fas fa-file-pdf"></i> PDF
            </button>
            <button class="panel-btn close-btn" onclick="closeSalePanel()">
                <i class="fas fa-times"></i> Close
            </button>
        </div>
        
        <!-- Footer -->
        <div class="panel-footer">
            <i class="fas fa-check-circle" style="color: #27ae60;"></i>
            Transaction completed successfully
        </div>
    `;
}

// Show sample panel
function showSampleSalePanel() {
    const panelBody = document.getElementById('salePanelBody');
    panelBody.innerHTML = `
        <!-- Invoice Card -->
        <div class="invoice-card">
            <div class="invoice-header">
                <div class="invoice-number">
                    INV-260214-0042
                    <span>Cash</span>
                </div>
                <div class="payment-badge">PAID</div>
            </div>
            <div class="invoice-details">
                <div class="detail-row">
                    <i class="fas fa-calendar-alt"></i>
                    <strong>Date:</strong>
                    <span>February 14, 2026 • 03:45 PM</span>
                </div>
                <div class="detail-row">
                    <i class="fas fa-user"></i>
                    <strong>Cashier:</strong>
                    <span>Maria Santos</span>
                </div>
                <div class="detail-row">
                    <i class="fas fa-id-card"></i>
                    <strong>Cashier ID:</strong>
                    <span>USR-12345</span>
                </div>
            </div>
        </div>
        
        <!-- Items Card -->
        <div class="items-card">
            <div class="items-header">
                <i class="fas fa-shopping-cart"></i>
                <h3>Items Purchased</h3>
            </div>
            <div class="item-list">
                <div class="item-row">
                    <div class="item-info">
                        <div class="item-name">Amoxicillin 500mg</div>
                        <div class="item-meta">
                            <span>Code: AMX-500</span>
                            <span class="item-qty">Qty: 2</span>
                        </div>
                    </div>
                    <div class="item-price">₱153.00</div>
                </div>
                <div class="item-row">
                    <div class="item-info">
                        <div class="item-name">Paracetamol 500mg</div>
                        <div class="item-meta">
                            <span>Code: PAR-500</span>
                            <span class="item-qty">Qty: 3</span>
                        </div>
                    </div>
                    <div class="item-price">₱30.00</div>
                </div>
                <div class="item-row">
                    <div class="item-info">
                        <div class="item-name">Vitamin C 1000mg</div>
                        <div class="item-meta">
                            <span>Code: VIT-C1000</span>
                            <span class="item-qty">Qty: 1</span>
                        </div>
                    </div>
                    <div class="item-price">₱200.00</div>
                </div>
            </div>
        </div>
        
        <!-- Summary Card -->
        <div class="summary-card">
            <div class="summary-row">
                <span class="summary-label">Subtotal:</span>
                <span class="summary-value">₱383.00</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">Discount (20%):</span>
                <span class="summary-value" style="color: #e74c3c;">-₱76.60</span>
            </div>
            <div class="summary-row total-row">
                <span class="total-label">Total Amount:</span>
                <span class="total-value">₱306.40</span>
            </div>
        </div>
        
        <!-- Payment Card -->
        <div class="payment-card">
            <div class="payment-header">
                <i class="fas fa-credit-card"></i>
                <h3>Payment Details</h3>
            </div>
            <div class="payment-grid">
                <div class="payment-item">
                    <div class="label">Method</div>
                    <div class="value">Cash</div>
                </div>
                <div class="payment-item">
                    <div class="label">Tendered</div>
                    <div class="value cash">₱500.00</div>
                </div>
                <div class="payment-item">
                    <div class="label">Change</div>
                    <div class="value change">₱193.60</div>
                </div>
            </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="panel-actions">
            <button class="panel-btn print" onclick="alert('Print feature coming soon!')">
                <i class="fas fa-print"></i> Print
            </button>
            <button class="panel-btn pdf" onclick="alert('PDF download coming soon!')">
                <i class="fas fa-file-pdf"></i> PDF
            </button>
            <button class="panel-btn close-btn" onclick="closeSalePanel()">
                <i class="fas fa-times"></i> Close
            </button>
        </div>
        
        <!-- Footer -->
        <div class="panel-footer">
            <i class="fas fa-check-circle" style="color: #27ae60;"></i>
            Transaction completed successfully
        </div>
    `;
}

// Update your view buttons to use the panel
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.view-sale, .btn-icon.view-sale').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const saleId = this.dataset.id;
            openSalePanel(saleId || 'demo');
        });
    });
});

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('saleDetailsModal');
    if (event.target === modal) {
        closeSalePanel();
    }
}