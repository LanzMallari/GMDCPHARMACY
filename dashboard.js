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
let unsubscribeProducts = null;
let currentUserData = null;
let currentSortOrder = 'desc';
let reportChart = null;
let currentDiscount = 0;
let selectedProductForStock = null;

// ===== CONSTANTS FOR EXCHANGE POLICY =====
const EXCHANGE_WINDOW_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

// ===== FLAGS TO PREVENT DOUBLE PROCESSING =====
let isProcessingPayment = false;
let isProcessingExchange = false;

// ===== EXCHANGE POLICY FUNCTIONS =====
function isWithinExchangeWindow(saleDate) {
    if (!saleDate) return false;
    
    const saleTimestamp = saleDate.toDate ? saleDate.toDate() : new Date(saleDate);
    const now = new Date();
    const hoursDiff = (now - saleTimestamp) / MS_PER_HOUR;
    
    return hoursDiff <= EXCHANGE_WINDOW_HOURS;
}

function getTimeRemaining(saleDate) {
    if (!saleDate) return "Expired";
    
    const saleTimestamp = saleDate.toDate ? saleDate.toDate() : new Date(saleDate);
    const now = new Date();
    const hoursDiff = (now - saleTimestamp) / MS_PER_HOUR;
    const hoursRemaining = EXCHANGE_WINDOW_HOURS - hoursDiff;
    
    if (hoursRemaining <= 0) return "Expired";
    if (hoursRemaining < 1) {
        const minutes = Math.floor(hoursRemaining * 60);
        return `${minutes} minute${minutes > 1 ? 's' : ''} remaining`;
    }
    return `${Math.floor(hoursRemaining)} hour${Math.floor(hoursRemaining) > 1 ? 's' : ''} remaining`;
}

// Fetch and display user data
async function fetchUserData(userId) {
    try {
        const docRef = doc(db, "users", userId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            currentUserData = docSnap.data();
            const fullName = `${currentUserData.firstName || ''} ${currentUserData.lastName || ''}`.trim();
            updateUserDisplay(fullName, currentUserData.email);
        } else {
            const user = auth.currentUser;
            if (user) {
                updateUserDisplay(user.email?.split('@')[0] || 'User', user.email);
            }
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
        const user = auth.currentUser;
        if (user) {
            updateUserDisplay(user.email?.split('@')[0] || 'User', user.email);
        }
    }
}

function updateUserDisplay(fullName, email) {
    const fNameElement = document.getElementById('loggedUserFName');
    const lNameElement = document.getElementById('loggedUserLName');
    const emailElement = document.getElementById('loggedUserEmail');
    const sidebarNameElement = document.getElementById('sidebarUserName');
    const sidebarEmailElement = document.getElementById('sidebarUserEmail');
    const welcomeNameElement = document.getElementById('welcomeUserName');
    const userAvatarElement = document.querySelector('.user-avatar i');
    
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    if (fNameElement) fNameElement.textContent = firstName;
    if (lNameElement) lNameElement.textContent = lastName || 'N/A';
    if (emailElement) emailElement.textContent = email || 'N/A';
    
    if (sidebarNameElement) {
        sidebarNameElement.textContent = fullName || 'User';
    }
    if (sidebarEmailElement) {
        sidebarEmailElement.textContent = email || '';
    }
    
    if (welcomeNameElement) {
        welcomeNameElement.textContent = firstName || 'User';
    }
    
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

fetchUserData(loggedInUserId);

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

function checkDayChange() {
    const lastVisit = localStorage.getItem('lastVisitDate');
    const today = new Date().toDateString();
    
    if (lastVisit !== today) {
        const todaySalesEl = document.getElementById('todaySales');
        if (todaySalesEl) {
            todaySalesEl.textContent = '₱0.00';
        }
        localStorage.setItem('lastVisitDate', today);
    }
}

checkDayChange();
setInterval(checkDayChange, 60000);

// Burger button functionality
const burgerBtn = document.getElementById('burgerBtn');
const sidebar = document.querySelector('.sidebar');

if (burgerBtn) {
    burgerBtn.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        
        const icon = burgerBtn.querySelector('i');
        if (sidebar.classList.contains('active')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
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

window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
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
        
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        const selectedTab = document.getElementById(`${tabId}-tab`);
        if (selectedTab) {
            selectedTab.classList.add('active');
        }
        
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

// Utility Functions
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

function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Search functionality
const posSearch = document.getElementById('posSearch');
if (posSearch) {
    posSearch.addEventListener('input', debounce(() => {
        filterPOSProducts();
    }, 300));
}

const posCategoryFilter = document.getElementById('posCategoryFilter');
if (posCategoryFilter) {
    posCategoryFilter.addEventListener('change', () => {
        filterPOSProducts();
    });
}

const inventorySearch = document.getElementById('inventorySearch');
if (inventorySearch) {
    inventorySearch.addEventListener('input', debounce((e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        filterInventory(searchTerm);
    }, 300));
}

// Filter POS Products
function filterPOSProducts() {
    const searchTerm = document.getElementById('posSearch')?.value.toLowerCase().trim() || '';
    const categoryFilter = document.getElementById('posCategoryFilter')?.value || '';
    
    const productsGrid = document.getElementById('productsGrid');
    if (!productsGrid) return;
    
    let filteredProducts = products;
    let filterCount = 0;
    
    // Apply category filter
    if (categoryFilter) {
        filteredProducts = filteredProducts.filter(p => 
            p.category?.toLowerCase() === categoryFilter.toLowerCase()
        );
        filterCount++;
    }
    
    // Apply search filter
    if (searchTerm) {
        filteredProducts = filteredProducts.filter(p => 
            p.name?.toLowerCase().includes(searchTerm) || 
            p.code?.toLowerCase().includes(searchTerm)
        );
        filterCount++;
    }
    
    // Update the filter icon class
    const categorySelect = document.getElementById('posCategoryFilter');
    if (categorySelect) {
        if (categoryFilter) {
            categorySelect.classList.add('has-value');
        } else {
            categorySelect.classList.remove('has-value');
        }
    }
    
    // Show filter summary
    const filterSummary = document.getElementById('filterSummary') || createFilterSummary();
    if (filterCount > 0) {
        filterSummary.innerHTML = `
            <i class="fas fa-filter"></i> 
            Showing ${filteredProducts.length} of ${products.length} products
            ${categoryFilter ? `• Category: ${categorySelect.options[categorySelect.selectedIndex]?.text.split('(')[0].trim() || ''}` : ''}
            ${searchTerm ? `• Search: "${searchTerm}"` : ''}
            <button class="clear-filters-btn" onclick="clearPOSFilters()">
                <i class="fas fa-times"></i> Clear
            </button>
        `;
        filterSummary.style.display = 'flex';
    } else {
        filterSummary.style.display = 'none';
    }
    
    displayProducts(filteredProducts);
}

// Create filter summary element
function createFilterSummary() {
    const summary = document.createElement('div');
    summary.id = 'filterSummary';
    summary.className = 'filter-summary';
    const posHeader = document.querySelector('.pos-header');
    if (posHeader) {
        posHeader.appendChild(summary);
    }
    return summary;
}

// Clear all filters
function clearPOSFilters() {
    const searchInput = document.getElementById('posSearch');
    const categorySelect = document.getElementById('posCategoryFilter');
    
    if (searchInput) searchInput.value = '';
    if (categorySelect) {
        categorySelect.value = '';
        categorySelect.classList.remove('has-value');
    }
    
    filterPOSProducts();
}

// Make clearPOSFilters globally available
window.clearPOSFilters = clearPOSFilters;

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
        const discountStatus = product.discountable === false ? 'non-discountable' : '';
        
        const productCard = document.createElement('div');
        productCard.className = `product-card ${isOutOfStock ? 'out-of-stock' : ''} ${discountStatus}`;
        productCard.dataset.productId = product.id;
        
        let discountBadge = '';
        if (product.discountable === false) {
            discountBadge = '<span class="non-discount-badge"><i class="fas fa-ban"></i> No Discount</span>';
        }
        
        productCard.innerHTML = `
            <div class="product-image">
                <i class="fas fa-pills"></i>
            </div>
            <h4>${product.name || 'Unnamed'}</h4>
            <p class="product-price">₱${(product.price || 0).toFixed(2)}</p>
            <p class="product-stock ${isOutOfStock ? 'text-danger' : ''}">Stock: ${product.stock || 0}</p>
            ${discountBadge}
            ${isOutOfStock ? '<span class="out-of-stock-label">OUT OF STOCK</span>' : ''}
            <button class="add-to-cart" ${isOutOfStock ? 'disabled' : ''} 
                    data-id="${product.id}">
                ${isOutOfStock ? 'Unavailable' : 'Add to Cart'}
            </button>
        `;
        productsGrid.appendChild(productCard);
    });
    
    document.querySelectorAll('.add-to-cart:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => addToCart(btn.dataset.id));
    });
}

function filterInventory(searchTerm) {
    const categoryFilter = document.getElementById('categoryFilter')?.value || '';
    const stockFilter = document.getElementById('stockFilter')?.value || '';
    const rows = document.querySelectorAll('#inventoryTableBody tr');
    
    rows.forEach(row => {
        let showRow = true;
        
        if (searchTerm) {
            const text = row.textContent.toLowerCase();
            if (!text.includes(searchTerm.toLowerCase())) {
                showRow = false;
            }
        }
        
        if (showRow && categoryFilter) {
            const category = row.querySelector('td:nth-child(3)')?.textContent || '';
            if (category.toLowerCase() !== categoryFilter.toLowerCase()) {
                showRow = false;
            }
        }
        
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

async function loadDashboardStats() {
    try {
        const productsSnapshot = await getDocs(collection(db, "products"));
        const totalProductsEl = document.getElementById('totalProducts');
        if (totalProductsEl) totalProductsEl.textContent = productsSnapshot.size;
        
        let lowStock = 0;
        productsSnapshot.forEach(doc => {
            const stock = doc.data().stock;
            if (stock > 0 && stock < 10) lowStock++;
        });
        
        const lowStockEl = document.getElementById('lowStockCount');
        if (lowStockEl) lowStockEl.textContent = lowStock;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(today)),
            where("date", "<", Timestamp.fromDate(tomorrow))
        );
        const salesSnapshot = await getDocs(salesQuery);
        
        const exchangesQuery = query(
            collection(db, "exchanges"),
            where("date", ">=", Timestamp.fromDate(today)),
            where("date", "<", Timestamp.fromDate(tomorrow))
        );
        const exchangesSnapshot = await getDocs(exchangesQuery);
        
        let totalSales = 0;
        
        salesSnapshot.forEach(doc => {
            totalSales += doc.data().total || 0;
        });
        
        exchangesSnapshot.forEach(doc => {
            const exchange = doc.data();
            totalSales += exchange.priceDifference || 0;
        });
        
        const todaySalesEl = document.getElementById('todaySales');
        if (todaySalesEl) todaySalesEl.textContent = `₱${totalSales.toFixed(2)}`;
        
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        
        // Get expiring count from batches
        const batchesSnapshot = await getDocs(collection(db, "batches"));
        let expiringCount = 0;
        batchesSnapshot.forEach(doc => {
            const batch = doc.data();
            if (batch.expiryDate && batch.quantity > 0) {
                const expiryDate = batch.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
                if (expiryDate <= thirtyDaysFromNow) {
                    expiringCount++;
                }
            }
        });
        
        const expiringEl = document.getElementById('expiringCount');
        if (expiringEl) expiringEl.textContent = expiringCount;
        
        const statCards = document.querySelectorAll('.stat-card');
        if (statCards.length >= 4) {
            statCards[1].style.cursor = 'pointer';
            statCards[1].onclick = () => openLowStockModal();
            
            statCards[2].style.cursor = 'pointer';
            statCards[2].onclick = () => openTodaySalesModal();
        }
        
        await loadRecentActivities();
        
    } catch (error) {
        console.error("Error loading dashboard stats:", error);
    }
}

async function loadRecentActivities() {
    try {
        const activitiesList = document.getElementById('recentActivities');
        if (!activitiesList) return;
        
        activitiesList.innerHTML = '<div class="loading">Loading activities...</div>';
        
        const salesQuery = query(
            collection(db, "sales"),
            orderBy("date", "desc"),
            limit(5)
        );
        const salesSnapshot = await getDocs(salesQuery);
        
        const exchangesQuery = query(
            collection(db, "exchanges"),
            orderBy("date", "desc"),
            limit(5)
        );
        const exchangesSnapshot = await getDocs(exchangesQuery);
        
        const productsQuery = query(
            collection(db, "products"),
            orderBy("lastUpdated", "desc"),
            limit(5)
        );
        const productsSnapshot = await getDocs(productsQuery);
        
        const activitiesQuery = query(
            collection(db, "activities"),
            orderBy("timestamp", "desc"),
            limit(10)
        );
        const activitiesSnapshot = await getDocs(activitiesQuery);
        
        let activities = [];
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            activities.push({
                type: 'sale',
                description: `New sale: ${sale.invoiceNumber || '#' + doc.id.slice(-6)} - ₱${(sale.total || 0).toFixed(2)}`,
                timestamp: sale.date,
                icon: 'fa-shopping-cart'
            });
        });
        
        exchangesSnapshot.forEach(doc => {
            const exchange = doc.data();
            const diffText = exchange.priceDifference > 0 ? 
                `+₱${exchange.priceDifference.toFixed(2)}` : 
                exchange.priceDifference < 0 ? 
                `-₱${Math.abs(exchange.priceDifference).toFixed(2)}` : 
                '₱0.00';
            
            activities.push({
                type: 'exchange',
                description: `Exchange: ${exchange.originalProduct} → ${exchange.newProduct} x${exchange.quantity} (${diffText})`,
                timestamp: exchange.date,
                icon: 'fa-exchange-alt'
            });
        });
        
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
        
        activitiesSnapshot.forEach(doc => {
            const activity = doc.data();
            activities.push({
                type: activity.type || 'info',
                description: activity.description || 'System activity',
                timestamp: activity.timestamp,
                icon: getActivityIcon(activity.type)
            });
        });
        
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
        'exchange': 'fa-exchange-alt',
        'stock': 'fa-boxes',
        'product': 'fa-pills',
        'user': 'fa-user',
        'info': 'fa-info-circle'
    };
    return icons[type] || 'fa-info-circle';
}

// ========== DASHBOARD MODAL FUNCTIONS ==========

async function openLowStockModal() {
    try {
        const modal = document.getElementById('lowStockModal');
        const modalBody = document.getElementById('lowStockModalBody');
        
        if (!modal || !modalBody) {
            console.error("Modal elements not found");
            return;
        }
        
        modalBody.innerHTML = `
            <div class="modal-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading low stock products...</p>
            </div>
        `;
        modal.style.display = 'block';
        
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
            const discountStatus = product.discountable === false ? 
                '<span class="non-discount-badge-small"><i class="fas fa-ban"></i> No Discount</span>' : '';
            
            html += `
                <div class="modal-item">
                    <div class="modal-item-info">
                        <div class="modal-item-name">
                            <strong>${product.name || 'Unnamed'}</strong>
                            ${product.code ? `<span class="item-code">${product.code}</span>` : ''}
                            ${discountStatus}
                        </div>
                        <div class="modal-item-details">
                            <span class="item-category"><i class="fas fa-tag"></i> ${product.category || 'N/A'}</span>
                            <span class="item-price"><i class="fas fa-dollar-sign"></i> ₱${(product.price || 0).toFixed(2)}</span>
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
                <button class="btn-primary" onclick="document.querySelector('[data-tab=\"inventory\"]').click(); closeModal('lowStockModal');">
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

async function openTodaySalesModal() {
    try {
        const modal = document.getElementById('todaySalesModal');
        const modalBody = document.getElementById('todaySalesModalBody');
        
        if (!modal || !modalBody) {
            console.error("Modal elements not found");
            return;
        }
        
        modalBody.innerHTML = `
            <div class="modal-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading today's sales...</p>
            </div>
        `;
        modal.style.display = 'block';
        
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
        
        const exchangesQuery = query(
            collection(db, "exchanges"),
            where("date", ">=", Timestamp.fromDate(today)),
            where("date", "<", Timestamp.fromDate(tomorrow)),
            orderBy("date", "desc")
        );
        
        const [salesSnapshot, exchangesSnapshot] = await Promise.all([
            getDocs(salesQuery),
            getDocs(exchangesQuery)
        ]);
        
        if (salesSnapshot.empty && exchangesSnapshot.empty) {
            modalBody.innerHTML = `
                <div class="modal-empty">
                    <i class="fas fa-shopping-cart" style="font-size: 48px; color: #3498db;"></i>
                    <p>No sales or exchanges today yet!</p>
                    <p style="font-size: 14px; color: #7f8c8d; margin-top: 10px;">Start selling to see transactions here.</p>
                </div>
            `;
            return;
        }
        
        let totalSales = 0;
        let totalItems = 0;
        let totalExchangeAdjustments = 0;
        const transactions = [];
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            totalSales += sale.total || 0;
            
            let itemsCount = 0;
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    itemsCount += item.quantity || 0;
                });
            }
            totalItems += itemsCount;
            
            transactions.push({
                id: doc.id,
                type: 'sale',
                invoice: sale.invoiceNumber,
                date: sale.date,
                amount: sale.total,
                cashierName: sale.cashierName,
                paymentMethod: sale.paymentMethod,
                itemsCount
            });
        });
        
        exchangesSnapshot.forEach(doc => {
            const exchange = doc.data();
            totalExchangeAdjustments += exchange.priceDifference || 0;
            
            transactions.push({
                id: doc.id,
                type: 'exchange',
                exchangeId: exchange.exchangeId,
                date: exchange.date,
                amount: exchange.priceDifference,
                originalProduct: exchange.originalProduct,
                newProduct: exchange.newProduct,
                quantity: exchange.quantity,
                cashierName: exchange.cashierName,
                reason: exchange.reason
            });
        });
        
        transactions.sort((a, b) => {
            const dateA = a.date?.toDate?.() || new Date(a.date);
            const dateB = b.date?.toDate?.() || new Date(b.date);
            return dateB - dateA;
        });
        
        const netSales = totalSales + totalExchangeAdjustments;
        
        let html = `
            <div class="modal-stats-summary">
                <div class="modal-stat">
                    <span class="modal-stat-label">Transactions:</span>
                    <span class="modal-stat-value">${transactions.length}</span>
                </div>
                <div class="modal-stat">
                    <span class="modal-stat-label">Items Sold:</span>
                    <span class="modal-stat-value">${totalItems}</span>
                </div>
                <div class="modal-stat highlight">
                    <span class="modal-stat-label">Gross Sales:</span>
                    <span class="modal-stat-value">₱${totalSales.toFixed(2)}</span>
                </div>
                ${totalExchangeAdjustments !== 0 ? `
                <div class="modal-stat ${totalExchangeAdjustments > 0 ? 'positive' : 'negative'}">
                    <span class="modal-stat-label">Exchange Adjustments:</span>
                    <span class="modal-stat-value" style="color: ${totalExchangeAdjustments > 0 ? '#27ae60' : '#e74c3c'}">
                        ${totalExchangeAdjustments > 0 ? '+' : ''}₱${totalExchangeAdjustments.toFixed(2)}
                    </span>
                </div>
                <div class="modal-stat total">
                    <span class="modal-stat-label">Net Sales:</span>
                    <span class="modal-stat-value">₱${netSales.toFixed(2)}</span>
                </div>
                ` : ''}
            </div>
            <div class="modal-items-container">
        `;
        
        transactions.forEach(trans => {
            if (trans.type === 'sale') {
                const transDate = trans.date?.toDate ? trans.date.toDate() : new Date();
                const timeStr = transDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const withinWindow = isWithinExchangeWindow(trans.date);
                
                html += `
                    <div class="modal-item sale-item" onclick="viewSaleDetailsModal('${trans.id}')">
                        <div class="modal-item-info">
                            <div class="modal-item-name">
                                <strong>${trans.invoice || '#' + trans.id.slice(-8).toUpperCase()}</strong>
                                <span class="sale-time">${timeStr}</span>
                                <span class="sale-badge">SALE</span>
                            </div>
                            <div class="modal-item-details">
                                <span><i class="fas fa-user"></i> ${trans.cashierName || 'Unknown'}</span>
                                <span><i class="fas fa-credit-card"></i> ${trans.paymentMethod || 'Cash'}</span>
                                <span><i class="fas fa-box"></i> ${trans.itemsCount} items</span>
                            </div>
                        </div>
                        <div class="modal-item-amount">
                            <span class="sale-amount">₱${(trans.amount || 0).toFixed(2)}</span>
                        </div>
                    </div>
                `;
            } else {
                const transDate = trans.date?.toDate ? trans.date.toDate() : new Date();
                const timeStr = transDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const amountClass = trans.amount > 0 ? 'positive' : (trans.amount < 0 ? 'negative' : '');
                const amountPrefix = trans.amount > 0 ? '+' : (trans.amount < 0 ? '' : '');
                
                html += `
                    <div class="modal-item exchange-item">
                        <div class="modal-item-info">
                            <div class="modal-item-name">
                                <strong>Exchange #${trans.exchangeId}</strong>
                                <span class="sale-time">${timeStr}</span>
                                <span class="exchange-badge-small"><i class="fas fa-exchange-alt"></i> EXCHANGE</span>
                            </div>
                            <div class="modal-item-details">
                                <span><i class="fas fa-user"></i> ${trans.cashierName || 'Unknown'}</span>
                                <span><i class="fas fa-undo-alt"></i> ${trans.originalProduct} → ${trans.newProduct}</span>
                                <span><i class="fas fa-box"></i> Qty: ${trans.quantity}</span>
                                <span class="exchange-reason">Reason: ${trans.reason}</span>
                            </div>
                        </div>
                        <div class="modal-item-amount">
                            <span class="sale-amount ${amountClass}">${amountPrefix}₱${Math.abs(trans.amount || 0).toFixed(2)}</span>
                        </div>
                    </div>
                `;
            }
        });
        
        html += `</div>`;
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

async function viewSaleDetailsModal(saleId) {
    try {
        const modal = document.getElementById('saleDetailsModal');
        const panelBody = document.getElementById('salePanelBody');
        
        if (!modal || !panelBody) return;
        
        panelBody.innerHTML = `
            <div class="modal-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading sale details...</p>
            </div>
        `;
        modal.style.display = 'block';
        
        const saleRef = doc(db, "sales", saleId);
        const [saleDoc, exchangesSnapshot] = await Promise.all([
            getDoc(saleRef),
            getDocs(query(collection(db, "exchanges"), where("originalSaleId", "==", saleId)))
        ]);
        
        if (!saleDoc.exists()) {
            panelBody.innerHTML = '<div class="modal-error">Sale not found</div>';
            return;
        }
        
        const sale = saleDoc.data();
        const exchanges = [];
        exchangesSnapshot.forEach(doc => exchanges.push(doc.data()));
        
        const exchangedQuantities = new Map();
        exchanges.forEach(ex => {
            const key = ex.originalProductId;
            exchangedQuantities.set(key, (exchangedQuantities.get(key) || 0) + ex.quantity);
        });
        
        const saleDate = sale.date?.toDate ? sale.date.toDate() : new Date();
        const formattedDate = saleDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit'
        });
        
        let itemsHtml = '';
        sale.items.forEach(item => {
            const exchangedQty = exchangedQuantities.get(item.productId) || 0;
            const remainingQty = item.quantity - exchangedQty;
            const isPartiallyExchanged = exchangedQty > 0 && exchangedQty < item.quantity;
            const isFullyExchanged = exchangedQty >= item.quantity;
            
            itemsHtml += `
                <div class="item-row ${isFullyExchanged ? 'fully-exchanged' : ''} ${isPartiallyExchanged ? 'partially-exchanged' : ''}">
                    <div class="item-info">
                        <div class="item-name">${item.name}</div>
                        <div class="item-meta">
                            <span>Code: ${item.code || 'N/A'}</span>
                            <span class="item-qty">Original Qty: ${item.quantity}</span>
                            ${exchangedQty > 0 ? `
                                <span class="exchanged-qty">Exchanged: ${exchangedQty}</span>
                            ` : ''}
                            ${remainingQty > 0 && exchangedQty > 0 ? `
                                <span class="remaining-qty">Remaining: ${remainingQty}</span>
                            ` : ''}
                        </div>
                    </div>
                    <div class="item-price">
                        ₱${(item.price * item.quantity).toFixed(2)}
                    </div>
                </div>`;
        });
        
        panelBody.innerHTML = `
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
            
            <div class="items-card">
                <div class="items-header">
                    <i class="fas fa-shopping-cart"></i>
                    <h3>Items Purchased</h3>
                </div>
                <div class="item-list">
                    ${itemsHtml}
                </div>
            </div>
            
            <div class="summary-card">
                <div class="summary-row">
                    <span class="summary-label">Subtotal:</span>
                    <span class="summary-value">₱${sale.subtotal.toFixed(2)}</span>
                </div>
                ${sale.discountPercentage > 0 ? `
                <div class="summary-row">
                    <span class="summary-label">Discount (${sale.discountPercentage}%):</span>
                    <span class="summary-value discount">-₱${sale.discountAmount.toFixed(2)}</span>
                </div>
                ` : ''}
                <div class="summary-row total-row">
                    <span class="total-label">Total Amount:</span>
                    <span class="total-value">₱${sale.total.toFixed(2)}</span>
                </div>
            </div>
            
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
                        <div class="value cash">₱${sale.amountTendered.toFixed(2)}</div>
                    </div>
                    <div class="payment-item">
                        <div class="label">Change</div>
                        <div class="value change">₱${sale.change.toFixed(2)}</div>
                    </div>
                </div>
            </div>`;
        
        if (exchanges.length > 0) {
            panelBody.innerHTML += `
                <div class="exchange-card">
                    <div class="exchange-header">
                        <i class="fas fa-exchange-alt"></i>
                        <h3>Exchange History</h3>
                    </div>`;
            
            exchanges.forEach(ex => {
                const diffClass = ex.priceDifference > 0 ? 'positive' : (ex.priceDifference < 0 ? 'negative' : '');
                const diffPrefix = ex.priceDifference > 0 ? '+' : '';
                
                panelBody.innerHTML += `
                    <div class="exchange-item">
                        <div class="exchange-row">
                            <span class="exchange-product">${ex.originalProduct} → ${ex.newProduct}</span>
                            <span class="exchange-qty">x${ex.quantity}</span>
                        </div>
                        <div class="exchange-diff ${diffClass}">
                            Price Difference: ${diffPrefix}₱${ex.priceDifference.toFixed(2)}
                        </div>
                        <div class="exchange-reason">
                            Reason: ${ex.reason || 'Not specified'}
                        </div>
                        <small>${formatDate(ex.date)}</small>
                    </div>`;
            });
            
            panelBody.innerHTML += `</div>`;
        }
        
        panelBody.innerHTML += `
            <div class="panel-actions">
                <button class="panel-btn print" onclick="printReceipt('${saleId}')">
                    <i class="fas fa-print"></i> Print
                </button>
                <button class="panel-btn close-btn" onclick="closeSalePanel()">
                    <i class="fas fa-times"></i> Close
                </button>
            </div>
            <div class="panel-footer">
                <i class="fas fa-check-circle"></i> 
                Transaction completed
            </div>`;
        
    } catch (error) {
        console.error("Error viewing sale details:", error);
        document.getElementById('salePanelBody').innerHTML = `
            <div class="modal-error">
                <i class="fas fa-exclamation-circle"></i>
                <p>Error loading sale details</p>
            </div>
        `;
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

window.openLowStockModal = openLowStockModal;
window.openTodaySalesModal = openTodaySalesModal;
window.viewSaleDetailsModal = viewSaleDetailsModal;
window.closeModal = closeModal;
window.editProduct = editProduct;

// ========== BATCH MANAGEMENT FUNCTIONS ==========

async function loadInventory() {
    try {
        console.log("Loading inventory...");
        const productsSnapshot = await getDocs(collection(db, "products"));
        const tableBody = document.getElementById('inventoryTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        if (productsSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="8" class="no-data">No products found</td></tr>';
            return;
        }
        
        // Calculate today and 30 days from now
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        
        let expiringCount = 0;
        
        productsSnapshot.forEach(doc => {
            const product = { id: doc.id, ...doc.data() };
            
            const stockClass = product.stock === 0 ? 'out-of-stock' : (product.stock < 10 ? 'low-stock' : '');
            const stockStatus = product.stock === 0 ? 'Out of Stock' : product.stock;
            const discountStatus = product.discountable === false ? 
                '<span class="non-discount-badge-table"><i class="fas fa-ban"></i> No Discount</span>' : 
                '<span class="discount-badge-table"><i class="fas fa-tag"></i> Discountable</span>';
            
            // Calculate soon to expire quantity
            let soonToExpireQty = 0;
            let expiryDisplay = '<span class="no-expiry">—</span>';
            
            // Check if product has expiry date
            if (product.expiryDate) {
                let expiryDate;
                if (product.expiryDate.toDate) {
                    expiryDate = product.expiryDate.toDate();
                } else {
                    expiryDate = new Date(product.expiryDate);
                }
                
                expiryDate.setHours(0, 0, 0, 0);
                
                // Calculate days until expiry
                const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                
                // Check if expiring within 30 days
                if (expiryDate <= thirtyDaysFromNow) {
                    soonToExpireQty = product.stock || 0;
                    expiringCount++;
                    
                    let status = '';
                    let title = '';
                    
                    if (expiryDate < today) {
                        status = 'expired';
                        title = `EXPIRED (${Math.abs(daysUntilExpiry)} days ago)`;
                    } else if (daysUntilExpiry <= 7) {
                        status = 'expiring-critical';
                        title = `Expires in ${daysUntilExpiry} days (CRITICAL)`;
                    } else {
                        status = 'expiring-soon';
                        title = `Expires in ${daysUntilExpiry} days`;
                    }
                    
                    expiryDisplay = `<span class="expiry-badge ${status}" title="${title}">
                        <i class="fas fa-clock"></i> ${soonToExpireQty}
                    </span>`;
                } else {
                    expiryDisplay = `<span class="no-expiry" title="Expires in ${daysUntilExpiry} days">—</span>`;
                }
            }
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${product.code || 'N/A'}</td>
                <td>${product.name || 'N/A'} ${discountStatus}</td>
                <td>${product.category || 'N/A'}</td>
                <td>₱${(product.price || 0).toFixed(2)}</td>
                <td class="${stockClass}">${stockStatus}</td>
                <td>${expiryDisplay}</td>
                <td>
                    <button class="btn-icon edit-product" title="Edit Product" data-id="${product.id}"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon delete-product" title="Delete Product" data-id="${product.id}"><i class="fas fa-trash"></i></button>
                    <button class="btn-icon view-batches" title="View Batches" data-id="${product.id}"><i class="fas fa-layer-group"></i></button>
                </td>
            `;
            tableBody.appendChild(row);
        });
        
        // Update dashboard expiring count
        const expiringEl = document.getElementById('expiringCount');
        if (expiringEl) expiringEl.textContent = expiringCount;
        
        document.querySelectorAll('.edit-product').forEach(btn => {
            btn.addEventListener('click', () => editProduct(btn.dataset.id));
        });
        
        document.querySelectorAll('.delete-product').forEach(btn => {
            btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
        });
        
        document.querySelectorAll('.view-batches').forEach(btn => {
            btn.addEventListener('click', () => viewProductBatches(btn.dataset.id));
        });
        
        addMobileDataLabels();
        setupInventoryFilters();
        
    } catch (error) {
        console.error("Error loading inventory:", error);
    }
}
async function viewProductBatches(productId) {
    try {
        const productRef = doc(db, "products", productId);
        const productDoc = await getDoc(productRef);
        
        if (!productDoc.exists()) {
            showNotification('Product not found', 'error');
            return;
        }
        
        const product = productDoc.data();
        
        const batchesQuery = query(
            collection(db, "batches"),
            where("productId", "==", productId),
            orderBy("expiryDate", "asc")
        );
        
        const batchesSnapshot = await getDocs(batchesQuery);
        
        const modal = document.getElementById('batchModal');
        const modalBody = document.getElementById('batchModalBody');
        
        if (!modal || !modalBody) return;
        
        let html = `
            <div class="batch-header">
                <h3><i class="fas fa-layer-group"></i> ${product.name} - Batches</h3>
                <button class="btn-primary" onclick="openAddBatchModal('${productId}', '${product.name}')">
                    <i class="fas fa-plus"></i> Add Batch
                </button>
            </div>
            <div class="product-info-summary">
                <p><strong>Total Stock:</strong> ${product.stock || 0}</p>
                <p><strong>Price:</strong> ₱${(product.price || 0).toFixed(2)}</p>
                <p><strong>Category:</strong> ${product.category || 'N/A'}</p>
            </div>
        `;
        
        if (batchesSnapshot.empty) {
            html += '<p class="no-data">No batches found for this product. Click "Add Batch" to create one.</p>';
        } else {
            html += '<div class="batch-list">';
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            batchesSnapshot.forEach(batchDoc => {
                const batch = batchDoc.data();
                const batchId = batchDoc.id;
                
                let expiryDate = batch.expiryDate ? batch.expiryDate.toDate() : null;
                let statusClass = '';
                let statusText = '';
                let daysUntil = '';
                
                if (expiryDate) {
                    expiryDate.setHours(0, 0, 0, 0);
                    const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                    
                    if (daysUntilExpiry < 0) {
                        statusClass = 'expired';
                        statusText = 'EXPIRED';
                        daysUntil = `${Math.abs(daysUntilExpiry)} days ago`;
                    } else if (daysUntilExpiry <= 7) {
                        statusClass = 'expiring-critical';
                        statusText = 'CRITICAL';
                        daysUntil = `${daysUntilExpiry} days left`;
                    } else if (daysUntilExpiry <= 30) {
                        statusClass = 'expiring-soon';
                        statusText = 'EXPIRING SOON';
                        daysUntil = `${daysUntilExpiry} days left`;
                    } else {
                        statusClass = 'good';
                        statusText = 'GOOD';
                        daysUntil = `${daysUntilExpiry} days left`;
                    }
                }
                
                html += `
                    <div class="batch-item ${statusClass}">
                        <div class="batch-header-row">
                            <span class="batch-number"><i class="fas fa-tag"></i> ${batch.batchNumber || 'N/A'}</span>
                            <span class="batch-status ${statusClass}">${statusText}</span>
                        </div>
                        <div class="batch-details">
                            <div class="batch-detail">
                                <i class="fas fa-boxes"></i>
                                <span><strong>Quantity:</strong> ${batch.quantity || 0}</span>
                            </div>
                            <div class="batch-detail">
                                <i class="fas fa-calendar-alt"></i>
                                <span><strong>Expiry:</strong> ${expiryDate ? expiryDate.toLocaleDateString() : 'No expiry'} ${daysUntil ? `(${daysUntil})` : ''}</span>
                            </div>
                            ${batch.notes ? `
                            <div class="batch-detail">
                                <i class="fas fa-sticky-note"></i>
                                <span><strong>Notes:</strong> ${batch.notes}</span>
                            </div>
                            ` : ''}
                        </div>
                        <div class="batch-actions">
                            <button class="btn-icon" onclick="deleteBatch('${batchId}', '${productId}')" title="Delete Batch">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        modalBody.innerHTML = html;
        modal.style.display = 'block';
        
    } catch (error) {
        console.error("Error viewing batches:", error);
        showNotification('Error loading batches', 'error');
    }
}
function openAddBatchModal(productId, productName) {
    const modal = document.getElementById('addBatchModal');
    const modalBody = document.getElementById('addBatchModalBody');
    
    if (!modal || !modalBody) return;
    
    modalBody.innerHTML = `
        <div class="batch-header">
            <h3>Add New Batch for ${productName}</h3>
        </div>
        <form id="batchForm" onsubmit="event.preventDefault(); saveBatch('${productId}');">
            <div class="form-group">
                <label>Batch Number <span class="required">*</span></label>
                <input type="text" id="batchNumber" class="form-control" required placeholder="e.g., BATCH-2024-001">
            </div>
            <div class="form-group">
                <label>Quantity <span class="required">*</span></label>
                <input type="number" id="batchQuantity" class="form-control" min="1" required>
            </div>
            <div class="form-group">
                <label>Expiry Date <span class="required">*</span></label>
                <input type="date" id="batchExpiry" class="form-control" required>
            </div>
            <div class="form-group">
                <label>Manufactured Date</label>
                <input type="date" id="batchManufactured" class="form-control">
            </div>
            <div class="form-group">
                <label>Supplier</label>
                <input type="text" id="batchSupplier" class="form-control">
            </div>
            <div class="form-group">
                <label>Cost Price</label>
                <input type="number" id="batchCost" class="form-control" step="0.01">
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-primary">Add Batch</button>
                <button type="button" class="btn-secondary" onclick="closeModal('addBatchModal')">Cancel</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'block';
}

async function saveBatch(productId) {
    try {
        const batchNumber = document.getElementById('batchNumber').value;
        const quantity = parseInt(document.getElementById('batchQuantity').value);
        const expiryDate = document.getElementById('batchExpiry').value;
        const manufacturedDate = document.getElementById('batchManufactured').value;
        const supplier = document.getElementById('batchSupplier').value;
        const cost = parseFloat(document.getElementById('batchCost').value) || 0;
        
        if (!batchNumber || !quantity || !expiryDate) {
            showNotification('Please fill in all required fields', 'error');
            return;
        }
        
        // Get current product to update total stock
        const productRef = doc(db, "products", productId);
        const productDoc = await getDoc(productRef);
        
        if (!productDoc.exists()) {
            showNotification('Product not found', 'error');
            return;
        }
        
        const currentStock = productDoc.data().stock || 0;
        const newTotalStock = currentStock + quantity;
        
        // Create batch data
        const batchData = {
            productId: productId,
            batchNumber: batchNumber,
            quantity: quantity,
            expiryDate: Timestamp.fromDate(new Date(expiryDate)),
            manufacturedDate: manufacturedDate ? Timestamp.fromDate(new Date(manufacturedDate)) : null,
            supplier: supplier || null,
            cost: cost || null,
            createdAt: Timestamp.now(),
            createdBy: loggedInUserId
        };
        
        // Add batch to Firestore
        await addDoc(collection(db, "batches"), batchData);
        
        // Update product total stock
        await updateDoc(productRef, {
            stock: newTotalStock,
            lastUpdated: Timestamp.now()
        });
        
        // Log activity
        await addDoc(collection(db, "activities"), {
            type: 'stock',
            description: `Added batch ${batchNumber} with ${quantity} units to ${productDoc.data().name}`,
            timestamp: Timestamp.now(),
            userId: loggedInUserId
        });
        
        showNotification('Batch added successfully!', 'success');
        
        // Close modal and refresh views
        closeModal('addBatchModal');
        
        // Refresh inventory if visible
        const inventoryTab = document.getElementById('inventory-tab');
        if (inventoryTab && inventoryTab.classList.contains('active')) {
            loadInventory();
        }
        
        // Refresh batches view if open
        viewProductBatches(productId);
        
    } catch (error) {
        console.error("Error saving batch:", error);
        showNotification('Error saving batch: ' + error.message, 'error');
    }
}

// ===== BATCH DEDUCTION FUNCTIONS (FIFO) =====

async function deductFromBatches(productId, quantityToDeduct) {
    try {
        // Get all batches for this product with quantity > 0, sorted by expiry date (FIFO - oldest first)
        const batchesQuery = query(
            collection(db, "batches"),
            where("productId", "==", productId),
            where("quantity", ">", 0),
            orderBy("expiryDate", "asc")
        );
        
        const batchesSnapshot = await getDocs(batchesQuery);
        
        if (batchesSnapshot.empty) {
            console.log(`No batches found for product ${productId}`);
            return false;
        }
        
        let remainingToDeduct = quantityToDeduct;
        const batchUpdates = [];
        
        for (const batchDoc of batchesSnapshot.docs) {
            if (remainingToDeduct <= 0) break;
            
            const batch = batchDoc.data();
            const batchId = batchDoc.id;
            const availableInBatch = batch.quantity;
            
            const deductFromThisBatch = Math.min(availableInBatch, remainingToDeduct);
            const newBatchQuantity = availableInBatch - deductFromThisBatch;
            
            // Update this batch
            batchUpdates.push(
                updateDoc(doc(db, "batches", batchId), {
                    quantity: newBatchQuantity,
                    lastUpdated: Timestamp.now()
                })
            );
            
            remainingToDeduct -= deductFromThisBatch;
        }
        
        // Execute all batch updates
        await Promise.all(batchUpdates);
        
        if (remainingToDeduct > 0) {
            console.warn(`Could not fully deduct ${quantityToDeduct} units. Remaining: ${remainingToDeduct}`);
        }
        
        return true;
    } catch (error) {
        console.error("Error deducting from batches:", error);
        throw error;
    }
}

// ===== PRODUCT FUNCTIONS =====

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

async function editProduct(productId) {
    try {
        const productRef = doc(db, "products", productId);
        const productDoc = await getDoc(productRef);
        
        if (!productDoc.exists()) {
            showNotification('Product not found', 'error');
            return;
        }
        
        const product = productDoc.data();
        
        document.getElementById('productCode').value = product.code || '';
        document.getElementById('productName').value = product.name || '';
        document.getElementById('productCategory').value = product.category || '';
        document.getElementById('productPrice').value = product.price || 0;
        document.getElementById('productStock').value = product.stock || 0;
        
        // Set discountable radio buttons
        const discountableYes = document.getElementById('discountableYes');
        const discountableNo = document.getElementById('discountableNo');
        
        if (discountableYes && discountableNo) {
            if (product.discountable === false) {
                discountableNo.checked = true;
            } else {
                discountableYes.checked = true;
            }
        }
        
        // Don't show expiry date in product form anymore - it's managed by batches
        document.getElementById('productExpiry').value = '';
        document.getElementById('productExpiry').disabled = true;
        document.getElementById('productExpiry').placeholder = 'Use batch system for expiry';
        
        document.getElementById('productDescription').value = product.description || '';
        
        document.querySelector('#productModal .modal-header h2').textContent = 'Edit Product';
        const submitBtn = document.querySelector('#productForm button[type="submit"]');
        submitBtn.textContent = 'Update Product';
        
        document.getElementById('productForm').dataset.editId = productId;
        
        const modal = document.getElementById('productModal');
        if (modal) {
            modal.style.display = 'block';
        }
        
    } catch (error) {
        console.error("Error loading product for edit:", error);
        showNotification('Error loading product', 'error');
    }
}

async function deleteProduct(productId) {
    if (confirm('Are you sure you want to delete this product?')) {
        try {
            // First, check if there are any batches for this product
            const batchesQuery = query(
                collection(db, "batches"),
                where("productId", "==", productId)
            );
            const batchesSnapshot = await getDocs(batchesQuery);
            
            if (!batchesSnapshot.empty) {
                if (!confirm('This product has batches. Deleting it will also delete all batches. Continue?')) {
                    return;
                }
                
                // Delete all batches
                const batch = writeBatch(db);
                batchesSnapshot.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
            }
            
            const productRef = doc(db, "products", productId);
            const productDoc = await getDoc(productRef);
            const productName = productDoc.exists() ? productDoc.data().name : 'Product';
            
            await deleteDoc(productRef);
            
            await addDoc(collection(db, "activities"), {
                type: 'product',
                description: `${productName} was deleted`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
            
            showNotification('Product deleted successfully', 'success');
            loadInventory();
            
        } catch (error) {
            console.error("Error deleting product:", error);
            showNotification('Error deleting product', 'error');
        }
    }
}

function loadProducts() {
    try {
        const productsGrid = document.getElementById('productsGrid');
        if (!productsGrid) return;
        
        productsGrid.innerHTML = '<div class="loading">Loading products...</div>';
        
        if (unsubscribeProducts) {
            unsubscribeProducts();
        }
        
        const productsRef = collection(db, "products");
        
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
            
            // Clear search and filter inputs
            const posSearch = document.getElementById('posSearch');
            const posCategoryFilter = document.getElementById('posCategoryFilter');
            if (posSearch) posSearch.value = '';
            if (posCategoryFilter) {
                posCategoryFilter.value = '';
                posCategoryFilter.classList.remove('has-value');
            }
            
            // Hide filter summary
            const filterSummary = document.getElementById('filterSummary');
            if (filterSummary) {
                filterSummary.style.display = 'none';
            }
            
            displayProducts(products);
            updateCartDisplay();
            
        }, (error) => {
            console.error("Error in real-time listener:", error);
            productsGrid.innerHTML = '<p class="error">Error loading products</p>';
        });
        
    } catch (error) {
        console.error("Error setting up products listener:", error);
    }
}

function displayProducts(productsToShow) {
    const productsGrid = document.getElementById('productsGrid');
    if (!productsGrid) return;
    
    productsGrid.innerHTML = '';
    
    productsToShow.forEach(product => {
        const isOutOfStock = product.stock <= 0;
        const discountStatus = product.discountable === false ? 'non-discountable' : '';
        
        const productCard = document.createElement('div');
        productCard.className = `product-card ${isOutOfStock ? 'out-of-stock' : ''} ${discountStatus}`;
        productCard.dataset.productId = product.id;
        
        let discountBadge = '';
        if (product.discountable === false) {
            discountBadge = '<span class="non-discount-badge"><i class="fas fa-ban"></i> No Discount</span>';
        }
        
        productCard.innerHTML = `
            <div class="product-image">
                <i class="fas fa-pills"></i>
            </div>
            <h4>${product.name || 'Unnamed'}</h4>
            <p class="product-price">₱${(product.price || 0).toFixed(2)}</p>
            <p class="product-stock ${isOutOfStock ? 'text-danger' : ''}">Stock: ${product.stock || 0}</p>
            ${discountBadge}
            ${isOutOfStock ? '<span class="out-of-stock-label">OUT OF STOCK</span>' : ''}
            <button class="add-to-cart" ${isOutOfStock ? 'disabled' : ''} 
                    data-id="${product.id}">
                ${isOutOfStock ? 'Unavailable' : 'Add to Cart'}
            </button>
        `;
        productsGrid.appendChild(productCard);
    });
    
    document.querySelectorAll('.add-to-cart:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => addToCart(btn.dataset.id));
    });
    
    if (window.innerWidth <= 768) {
        fixMobilePOSScroll();
    }
}

function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    
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
            stock: product.stock,
            discountable: product.discountable !== false
        });
        showNotification(`${product.name} added to cart`, 'success');
    }
    
    updateCartDisplay();
}

function updateCartDisplay() {
    const cartItems = document.getElementById('cartItems');
    const subtotalEl = document.getElementById('subtotal');
    const grandTotalEl = document.getElementById('grandTotal');
    
    if (!cartItems) return;
    
    cartItems.innerHTML = '';
    let subtotal = 0;
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="empty-cart">Cart is empty</p>';
        if (subtotalEl) subtotalEl.textContent = '₱0.00';
        if (grandTotalEl) grandTotalEl.textContent = '₱0.00';
        return;
    }
    
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        
        const product = products.find(p => p.id === item.id);
        const currentStock = product ? product.stock : 0;
        const discountable = item.discountable !== false;
        
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        
        let discountableBadge = '';
        if (!discountable) {
            discountableBadge = '<span class="non-discount-badge-small"><i class="fas fa-ban"></i> No Discount</span>';
        }
        
        cartItem.innerHTML = `
            <div class="cart-item-info">
                <h4>${item.name} ${discountableBadge}</h4>
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
    
    const discountPercentage = currentDiscount;
    
    let discountableSubtotal = 0;
    let nonDiscountableSubtotal = 0;
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        if (item.discountable !== false) {
            discountableSubtotal += itemTotal;
        } else {
            nonDiscountableSubtotal += itemTotal;
        }
    });
    
    const discountAmount = discountableSubtotal * (discountPercentage / 100);
    const grandTotal = discountableSubtotal + nonDiscountableSubtotal - discountAmount;
    
    if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toFixed(2)}`;
    if (grandTotalEl) grandTotalEl.textContent = `₱${grandTotal.toFixed(2)}`;
    
    window.cartDiscountBreakdown = {
        discountableSubtotal,
        nonDiscountableSubtotal,
        discountAmount,
        discountPercentage
    };
}

function decreaseQuantity(index) {
    if (cart[index].quantity > 1) {
        cart[index].quantity--;
    } else {
        cart.splice(index, 1);
    }
    updateCartDisplay();
}

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

function showNotification(message, type = 'info') {
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

const checkoutBtn = document.getElementById('checkoutBtn');
if (checkoutBtn) {
    checkoutBtn.addEventListener('click', throttle(() => {
        if (cart.length === 0) {
            showNotification('Cart is empty!', 'error');
            return;
        }
        
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
    }, 1000));
}

function updateCheckoutModal() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutSubtotal = document.getElementById('checkoutSubtotal');
    const checkoutDiscount = document.getElementById('checkoutDiscount');
    const checkoutDiscountAmount = document.getElementById('checkoutDiscountAmount');
    const checkoutTotal = document.getElementById('checkoutTotal');
    
    if (!checkoutItems || !checkoutTotal) return;
    
    let discountableSubtotal = 0;
    let nonDiscountableSubtotal = 0;
    checkoutItems.innerHTML = '';
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        if (item.discountable !== false) {
            discountableSubtotal += itemTotal;
        } else {
            nonDiscountableSubtotal += itemTotal;
        }
        
        const discountableBadge = item.discountable === false ? 
            '<span class="non-discount-badge-small">🚫 No Discount</span>' : '';
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checkout-item';
        itemDiv.innerHTML = `
            <div class="checkout-product-info">
                <span class="product-name">${item.name}</span>
                <span class="product-detail">₱${item.price.toFixed(2)} x ${item.quantity}</span>
                ${discountableBadge}
            </div>
            <span class="product-total">₱${itemTotal.toFixed(2)}</span>
        `;
        checkoutItems.appendChild(itemDiv);
    });
    
    const discountPercentage = currentDiscount;
    const discountAmount = discountableSubtotal * (discountPercentage / 100);
    const subtotal = discountableSubtotal + nonDiscountableSubtotal;
    const grandTotal = subtotal - discountAmount;
    
    if (checkoutSubtotal) checkoutSubtotal.textContent = `₱${subtotal.toFixed(2)}`;
    if (checkoutDiscount) checkoutDiscount.textContent = discountPercentage > 0 ? `${discountPercentage}%` : '0%';
    if (checkoutDiscountAmount) checkoutDiscountAmount.textContent = `-₱${discountAmount.toFixed(2)}`;
    if (checkoutTotal) checkoutTotal.textContent = `₱${grandTotal.toFixed(2)}`;
    
    const discountNote = document.getElementById('discountNote');
    if (!discountNote) {
        const note = document.createElement('p');
        note.id = 'discountNote';
        note.className = 'discount-note';
        note.innerHTML = discountPercentage > 0 ? 
            `<i class="fas fa-info-circle"></i> Discount only applied to eligible items (₱${discountableSubtotal.toFixed(2)} of ₱${subtotal.toFixed(2)})` :
            '';
        checkoutItems.parentNode.insertBefore(note, checkoutItems.nextSibling);
    } else {
        discountNote.innerHTML = discountPercentage > 0 ? 
            `<i class="fas fa-info-circle"></i> Discount only applied to eligible items (₱${discountableSubtotal.toFixed(2)} of ₱${subtotal.toFixed(2)})` :
            '';
    }
    
    updateChangeAmount();
}

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

const processPaymentBtn = document.getElementById('processPaymentBtn');
if (processPaymentBtn) {
    processPaymentBtn.addEventListener('click', async function(e) {
        e.preventDefault();
        
        if (isProcessingPayment) {
            showNotification('Payment is already being processed...', 'info');
            return;
        }
        
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
        
        isProcessingPayment = true;
        const originalText = processPaymentBtn.textContent;
        processPaymentBtn.disabled = true;
        processPaymentBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        
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
            isProcessingPayment = false;
            processPaymentBtn.disabled = false;
            processPaymentBtn.textContent = originalText;
            return;
        }
        
        try {
            const invoiceNumber = await generateInvoiceNumber();
            const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
            
            let discountableSubtotal = 0;
            let nonDiscountableSubtotal = 0;
            
            cart.forEach(item => {
                const itemTotal = item.price * item.quantity;
                if (item.discountable !== false) {
                    discountableSubtotal += itemTotal;
                } else {
                    nonDiscountableSubtotal += itemTotal;
                }
            });
            
            const discountPercentage = currentDiscount;
            const discountAmount = discountableSubtotal * (discountPercentage / 100);
            const subtotal = discountableSubtotal + nonDiscountableSubtotal;
            const totalAmount = subtotal - discountAmount;
            
            const saleData = {
                invoiceNumber: invoiceNumber,
                items: cart.map(item => ({
                    productId: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    subtotal: item.price * item.quantity,
                    discountable: item.discountable !== false
                })),
                subtotal: subtotal,
                discountableSubtotal: discountableSubtotal,
                nonDiscountableSubtotal: nonDiscountableSubtotal,
                discountPercentage: discountPercentage,
                discountAmount: discountAmount,
                total: totalAmount,
                paymentMethod: method,
                amountTendered: amount,
                change: amount - totalAmount,
                date: Timestamp.now(),
                cashierId: loggedInUserId,
                cashierName: cashierName,
                exchanges: []
            };
            
            await addDoc(collection(db, "sales"), saleData);
            
            // Update stock using batch system (FIFO)
            for (const item of cart) {
                const productRef = doc(db, "products", item.id);
                const productDoc = await getDoc(productRef);
                if (productDoc.exists()) {
                    const currentStock = productDoc.data().stock;
                    const newStock = currentStock - item.quantity;
                    
                    // Update product total stock
                    await updateDoc(productRef, {
                        stock: newStock,
                        lastUpdated: Timestamp.now()
                    });
                    
                    // Deduct from batches (FIFO)
                    await deductFromBatches(item.id, item.quantity);
                    
                    await addDoc(collection(db, "activities"), {
                        type: 'stock',
                        description: `${item.name} stock updated: ${currentStock} → ${newStock}`,
                        timestamp: Timestamp.now(),
                        userId: loggedInUserId
                    });
                    
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
            
            let discountText = discountPercentage > 0 ? ` (${discountPercentage}% discount applied to eligible items)` : '';
            await addDoc(collection(db, "activities"), {
                type: 'sale',
                description: `Sale #${invoiceNumber}: ${cart.length} items for ₱${totalAmount.toFixed(2)}${discountText}`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
            
            showNotification(`Payment successful! Invoice #${invoiceNumber}`, 'success');
            
            cart = [];
            currentDiscount = 0;
            if (discountSelect) discountSelect.value = '0';
            updateCartDisplay();
            
            const modal = document.getElementById('checkoutModal');
            if (modal) {
                modal.style.display = 'none';
            }
            
            if (amountTendered) {
                amountTendered.value = '';
            }
            
            const changeAmount = document.getElementById('changeAmount');
            if (changeAmount) {
                changeAmount.textContent = '₱0.00';
            }
            
            const dashboardTab = document.getElementById('dashboard-tab');
            if (dashboardTab && dashboardTab.classList.contains('active')) {
                loadDashboardStats();
            }
            
            const salesTab = document.getElementById('sales-tab');
            if (salesTab && salesTab.classList.contains('active')) {
                loadSalesHistory(currentSortOrder);
            }
            
        } catch (error) {
            console.error("Error processing payment:", error);
            showNotification('Error processing payment. Please try again.', 'error');
        } finally {
            isProcessingPayment = false;
            processPaymentBtn.disabled = false;
            processPaymentBtn.textContent = originalText;
        }
    });
}

async function generateInvoiceNumber() {
    try {
        const today = new Date();
        const year = today.getFullYear().toString().slice(-2);
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startOfDay)),
            where("date", "<=", Timestamp.fromDate(endOfDay))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        const count = salesSnapshot.size + 1;
        
        const invoiceNumber = `INV-${year}${month}${day}-${count.toString().padStart(4, '0')}`;
        return invoiceNumber;
    } catch (error) {
        console.error("Error generating invoice number:", error);
        return `INV-${Date.now()}`;
    }
}

async function generateExchangeId() {
    try {
        const today = new Date();
        const year = today.getFullYear().toString().slice(-2);
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        
        const exchangesQuery = query(
            collection(db, "exchanges"),
            where("date", ">=", Timestamp.fromDate(startOfDay)),
            where("date", "<=", Timestamp.fromDate(endOfDay))
        );
        
        const exchangesSnapshot = await getDocs(exchangesQuery);
        const count = exchangesSnapshot.size + 1;
        
        return `EXC-${year}${month}${day}-${count.toString().padStart(4, '0')}`;
    } catch (error) {
        console.error("Error generating exchange ID:", error);
        return `EXC-${Date.now()}`;
    }
}

function toggleSortOrder() {
    currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
    loadSalesHistory(currentSortOrder);
    
    const sortIcon = document.querySelector('#sortSalesBtn i');
    if (sortIcon) {
        sortIcon.className = currentSortOrder === 'desc' ? 'fas fa-sort-amount-down' : 'fas fa-sort-amount-up';
    }
}

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
            const hasExchanges = sale.exchanges && sale.exchanges.length > 0;
            const withinWindow = isWithinExchangeWindow(sale.date);
            const exchangeBadge = hasExchanges ? 
                '<span class="exchange-badge"><i class="fas fa-exchange-alt"></i> Exchanged</span>' : 
                (withinWindow ? 
                    '<span class="exchange-eligible"><i class="fas fa-clock"></i> Exchange Eligible</span>' : 
                    '<span class="exchange-expired"><i class="fas fa-lock"></i> Exchange Window Closed</span>');
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><span class="invoice-badge">${sale.invoiceNumber || `#${doc.id.slice(-8).toUpperCase()}`}</span> ${exchangeBadge}</td>
                <td>${formatDate(sale.date)}</td>
                <td>
                    <div class="items-list">
                        ${sale.items?.map(item => `
                            <div class="item-name">${item.name} x${item.quantity} ${item.discountable === false ? '🚫' : ''}</div>
                        `).join('') || 'No items'}
                    </div>
                </td>
                <td>₱${(sale.total || 0).toFixed(2)}</td>
                <td><span class="payment-method">${sale.paymentMethod || 'N/A'}</span></td>
                <td><span class="cashier-name">${sale.cashierName || 'Unknown'}</span></td>
                <td>
                    <button class="btn-icon view-sale" title="View Details" data-id="${doc.id}"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon print-sale" title="Print Receipt" data-id="${doc.id}"><i class="fas fa-print"></i></button>
                    ${withinWindow ? 
                        `<button class="btn-icon exchange-sale" title="Exchange Product" data-id="${doc.id}"><i class="fas fa-exchange-alt"></i></button>` : 
                        `<button class="btn-icon exchange-disabled" disabled title="Exchange not available (24h policy)"><i class="fas fa-lock"></i></button>`}
                </td>
            `;
            tableBody.appendChild(row);
        });
        
        document.querySelectorAll('.view-sale').forEach(btn => {
            btn.addEventListener('click', () => viewSaleDetails(btn.dataset.id));
        });
        
        document.querySelectorAll('.print-sale').forEach(btn => {
            btn.addEventListener('click', () => printReceipt(btn.dataset.id));
        });
        
        document.querySelectorAll('.exchange-sale').forEach(btn => {
            btn.addEventListener('click', () => openExchangeModal(btn.dataset.id));
        });
        
        addMobileDataLabels();
        
    } catch (error) {
        console.error("Error loading sales history:", error);
    }
}

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
                const hasExchanges = sale.exchanges && sale.exchanges.length > 0;
                const withinWindow = isWithinExchangeWindow(sale.date);
                const exchangeBadge = hasExchanges ? 
                    '<span class="exchange-badge"><i class="fas fa-exchange-alt"></i> Exchanged</span>' : 
                    (withinWindow ? 
                        '<span class="exchange-eligible"><i class="fas fa-clock"></i> Exchange Eligible</span>' : 
                        '<span class="exchange-expired"><i class="fas fa-lock"></i> Exchange Window Closed</span>');
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><span class="invoice-badge">${sale.invoiceNumber || `#${doc.id.slice(-8).toUpperCase()}`}</span> ${exchangeBadge}</td>
                    <td>${formatDate(sale.date)}</td>
                    <td>
                        <div class="items-list">
                            ${sale.items?.map(item => `
                                <div class="item-name">${item.name} x${item.quantity} ${item.discountable === false ? '🚫' : ''}</div>
                            `).join('') || 'No items'}
                        </div>
                    </td>
                    <td>₱${(sale.total || 0).toFixed(2)}</td>
                    <td><span class="payment-method">${sale.paymentMethod || 'N/A'}</span></td>
                    <td><span class="cashier-name">${sale.cashierName || 'Unknown'}</span></td>
                    <td>
                        <button class="btn-icon view-sale" title="View Details" data-id="${doc.id}"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon print-sale" title="Print Receipt" data-id="${doc.id}"><i class="fas fa-print"></i></button>
                        ${withinWindow ? 
                            `<button class="btn-icon exchange-sale" title="Exchange Product" data-id="${doc.id}"><i class="fas fa-exchange-alt"></i></button>` : 
                            `<button class="btn-icon exchange-disabled" disabled title="Exchange not available (24h policy)"><i class="fas fa-lock"></i></button>`}
                    </td>
                `;
                tableBody.appendChild(row);
            });
            
            addMobileDataLabels();
            
        } catch (error) {
            console.error("Error filtering sales:", error);
        }
    });
}

const sortBtn = document.getElementById('sortSalesBtn');
if (sortBtn) {
    sortBtn.addEventListener('click', toggleSortOrder);
}

async function viewSaleDetails(saleId) {
    try {
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showNotification('Sale not found', 'error');
            return;
        }
        
        const sale = saleDoc.data();
        
        let details = `
SALE DETAILS
════════════════════════
Invoice: ${sale.invoiceNumber}
Date: ${formatDate(sale.date)}
Cashier: ${sale.cashierName}
Payment: ${sale.paymentMethod}
Discount: ${sale.discountPercentage || 0}% (applied to eligible items)
════════════════════════
ITEMS:
`;
        
        sale.items.forEach(item => {
            const discountMarker = item.discountable === false ? ' [NO DISCOUNT]' : '';
            details += `${item.name}${discountMarker} - ₱${item.price.toFixed(2)} x ${item.quantity} = ₱${(item.price * item.quantity).toFixed(2)}\n`;
        });
        
        details += `════════════════════════
Subtotal: ₱${sale.subtotal.toFixed(2)}
Discountable Subtotal: ₱${sale.discountableSubtotal?.toFixed(2) || '0.00'}
Non-Discountable Subtotal: ₱${sale.nonDiscountableSubtotal?.toFixed(2) || '0.00'}
Discount (${sale.discountPercentage || 0}%): -₱${(sale.discountAmount || 0).toFixed(2)}
Total: ₱${sale.total.toFixed(2)}
Amount Tendered: ₱${sale.amountTendered.toFixed(2)}
Change: ₱${sale.change.toFixed(2)}`;
        
        if (sale.exchanges && sale.exchanges.length > 0) {
            details += `\n════════════════════════
EXCHANGES:`;
            sale.exchanges.forEach(ex => {
                details += `\n${ex.originalProduct} x${ex.quantity} → ${ex.newProduct} (${ex.priceDifference >= 0 ? '+' : '-'}₱${Math.abs(ex.priceDifference).toFixed(2)})`;
            });
        }
        
        alert(details);
        
    } catch (error) {
        console.error("Error viewing sale details:", error);
        showNotification('Error loading sale details', 'error');
    }
}

function printReceipt(saleId) {
    showNotification('Print feature coming soon', 'info');
    console.log('Print receipt for sale:', saleId);
}

// ========== EXCHANGE FUNCTIONALITY ==========

const exchangeButton = document.getElementById('exchangeButton');
if (exchangeButton) {
    exchangeButton.addEventListener('click', () => {
        openExchangeModal();
    });
}

async function openExchangeModal(saleId = null) {
    try {
        let exchangeModal = document.getElementById('exchangeModal');
        if (!exchangeModal) {
            console.error("Exchange modal not found");
            return;
        }
        
        document.getElementById('exchangeSearch').value = '';
        document.getElementById('exchangeSearchResults').innerHTML = '';
        document.getElementById('selectedExchangeInfo').style.display = 'none';
        
        const newProductSelect = document.getElementById('newProductSelect');
        if (newProductSelect) {
            newProductSelect.innerHTML = '<option value="">-- Select replacement product --</option>';
        }
        
        await loadNewProducts();
        
        const saleInfoDiv = document.getElementById('exchangeSaleInfo');
        if (saleId) {
            const saleRef = doc(db, "sales", saleId);
            const saleDoc = await getDoc(saleRef);
            
            if (saleDoc.exists()) {
                const sale = saleDoc.data();
                const withinWindow = isWithinExchangeWindow(sale.date);
                const timeRemaining = getTimeRemaining(sale.date);
                
                saleInfoDiv.innerHTML = `
                    <h3>Exchange for Sale #${sale.invoiceNumber}</h3>
                    <p>Date: ${formatDate(sale.date)}</p>
                    <p>Cashier: ${sale.cashierName}</p>
                    <p>Total: ₱${sale.total.toFixed(2)}</p>
                    <p class="${withinWindow ? 'text-success' : 'text-danger'}">
                        <i class="fas ${withinWindow ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
                        ${withinWindow ? `Exchange available - ${timeRemaining}` : 'Exchange window expired (24 hours passed)'}
                    </p>
                `;
                
                if (!withinWindow) {
                    showNotification('This transaction is outside the 24-hour exchange window', 'error');
                    exchangeModal.style.display = 'none';
                    return;
                }
                
                exchangeModal.dataset.saleId = saleId;
            }
        } else {
            saleInfoDiv.innerHTML = '<h3>Search for a sale to process exchange</h3><p class="policy-note"><i class="fas fa-clock"></i> Note: Exchanges only allowed within 24 hours of purchase</p>';
            exchangeModal.dataset.saleId = '';
        }
        
        exchangeModal.style.display = 'block';
        
    } catch (error) {
        console.error("Error opening exchange modal:", error);
        showNotification('Error opening exchange form', 'error');
    }
}

async function loadNewProducts() {
    try {
        const productsSnapshot = await getDocs(collection(db, "products"));
        const select = document.getElementById('newProductSelect');
        if (!select) return;
        
        select.innerHTML = '<option value="">-- Select replacement product --</option>';
        
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            if (product.stock > 0) {
                const discountStatus = product.discountable === false ? ' (No Discount)' : '';
                const option = document.createElement('option');
                option.value = doc.id;
                option.dataset.price = product.price || 0;
                option.dataset.name = product.name || 'Unnamed';
                option.dataset.stock = product.stock || 0;
                option.dataset.discountable = product.discountable !== false;
                option.textContent = `${product.name}${discountStatus} - ₱${(product.price || 0).toFixed(2)} (Stock: ${product.stock})`;
                select.appendChild(option);
            }
        });
    } catch (error) {
        console.error("Error loading new products:", error);
    }
}

const exchangeSearch = document.getElementById('exchangeSearch');
if (exchangeSearch) {
    exchangeSearch.addEventListener('input', debounce(async (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        if (searchTerm.length < 2) {
            document.getElementById('exchangeSearchResults').innerHTML = '';
            return;
        }
        
        try {
            const resultsDiv = document.getElementById('exchangeSearchResults');
            resultsDiv.innerHTML = '<div class="loading">Searching...</div>';
            
            const invoiceQuery = query(
                collection(db, "sales"),
                where("invoiceNumber", ">=", searchTerm.toUpperCase()),
                where("invoiceNumber", "<=", searchTerm.toUpperCase() + '\uf8ff'),
                limit(20)
            );
            
            const invoiceSnapshot = await getDocs(invoiceQuery);
            let results = [];
            
            invoiceSnapshot.forEach(doc => {
                const sale = doc.data();
                const withinWindow = isWithinExchangeWindow(sale.date);
                
                if (withinWindow) {
                    results.push({
                        id: doc.id,
                        invoice: sale.invoiceNumber,
                        date: sale.date,
                        total: sale.total,
                        items: sale.items,
                        timeRemaining: getTimeRemaining(sale.date)
                    });
                }
            });
            
            results.sort((a, b) => {
                const dateA = a.date?.toDate?.() || new Date(a.date);
                const dateB = b.date?.toDate?.() || new Date(b.date);
                return dateB - dateA;
            });
            
            results = results.slice(0, 10);
            
            if (results.length === 0) {
                resultsDiv.innerHTML = '<p class="no-data">No eligible sales found within 24-hour exchange window</p>';
                return;
            }
            
            resultsDiv.innerHTML = '';
            
            results.forEach(result => {
                const resultDiv = document.createElement('div');
                resultDiv.className = 'search-result-item';
                
                resultDiv.innerHTML = `
                    <span class="invoice-badge">${result.invoice}</span>
                    <div class="product-info">
                        <div class="product-name">Sale with ${result.items.length} items</div>
                        <div class="product-details">
                            ${formatDate(result.date)} - ₱${result.total.toFixed(2)}
                            <span class="text-success"><i class="fas fa-clock"></i> ${result.timeRemaining}</span>
                        </div>
                    </div>
                `;
                
                resultDiv.addEventListener('click', () => selectSaleForExchange(result.id));
                resultsDiv.appendChild(resultDiv);
            });
            
        } catch (error) {
            console.error("Error searching sales:", error);
            document.getElementById('exchangeSearchResults').innerHTML = '<p class="error">Error searching</p>';
        }
    }, 300));
}

async function selectSaleForExchange(saleId) {
    try {
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showNotification('Sale not found', 'error');
            return;
        }
        
        const sale = saleDoc.data();
        
        if (!isWithinExchangeWindow(sale.date)) {
            showNotification('This transaction is outside the 24-hour exchange window', 'error');
            return;
        }
        
        const exchangeModal = document.getElementById('exchangeModal');
        exchangeModal.dataset.saleId = saleId;
        
        document.getElementById('exchangeSaleInfo').innerHTML = `
            <h3>Exchange for Sale #${sale.invoiceNumber}</h3>
            <p>Date: ${formatDate(sale.date)}</p>
            <p>Cashier: ${sale.cashierName}</p>
            <p>Total: ₱${sale.total.toFixed(2)}</p>
            <p class="text-success"><i class="fas fa-check-circle"></i> Eligible for exchange (within 24 hours)</p>
        `;
        
        const resultsDiv = document.getElementById('exchangeSearchResults');
        resultsDiv.innerHTML = '<h4>Select a product to exchange:</h4>';
        
        const exchangesSnapshot = await getDocs(query(collection(db, "exchanges"), where("originalSaleId", "==", saleId)));
        const exchangedQuantities = new Map();
        exchangesSnapshot.forEach(doc => {
            const ex = doc.data();
            const key = ex.originalProductId;
            exchangedQuantities.set(key, (exchangedQuantities.get(key) || 0) + ex.quantity);
        });
        
        sale.items.forEach(item => {
            const exchangedQty = exchangedQuantities.get(item.productId) || 0;
            const availableQty = item.quantity - exchangedQty;
            const discountStatus = item.discountable === false ? ' (No Discount)' : '';
            
            if (availableQty > 0) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'search-result-item';
                itemDiv.innerHTML = `
                    <span class="product-name">${item.name}${discountStatus}</span>
                    <span class="product-details">
                        Original: ${item.quantity} | 
                        Exchanged: ${exchangedQty} | 
                        Available: <strong>${availableQty}</strong> - ₱${item.price.toFixed(2)} each
                    </span>
                `;
                itemDiv.addEventListener('click', () => selectProductForExchange(
                    saleId, 
                    item.productId, 
                    item.name, 
                    item.price, 
                    availableQty,
                    item.discountable !== false
                ));
                resultsDiv.appendChild(itemDiv);
            }
        });
        
    } catch (error) {
        console.error("Error selecting sale:", error);
        showNotification('Error selecting sale', 'error');
    }
}

function selectProductForExchange(saleId, productId, productName, price, availableQty, discountable = true) {
    const selectedInfo = document.getElementById('selectedExchangeInfo');
    
    document.getElementById('exchangeInvoice').textContent = saleId.slice(-8).toUpperCase();
    document.getElementById('exchangeProductName').textContent = productName;
    document.getElementById('exchangePrice').textContent = price.toFixed(2);
    document.getElementById('exchangeAvailableQty').textContent = availableQty;
    
    const exchangeQuantity = document.getElementById('exchangeQuantity');
    exchangeQuantity.max = availableQty;
    exchangeQuantity.value = 1;
    exchangeQuantity.min = 1;
    
    selectedInfo.dataset.saleId = saleId;
    selectedInfo.dataset.productId = productId;
    selectedInfo.dataset.productName = productName;
    selectedInfo.dataset.price = price;
    selectedInfo.dataset.maxQuantity = availableQty;
    selectedInfo.dataset.discountable = discountable;
    
    document.getElementById('exchangeSearchResults').innerHTML = '';
    document.getElementById('exchangeSearch').value = '';
    
    selectedInfo.style.display = 'block';
    
    const newProductSelect = document.getElementById('newProductSelect');
    newProductSelect.addEventListener('change', calculatePriceDifference);
    exchangeQuantity.addEventListener('input', calculatePriceDifference);
    
    document.getElementById('priceDifference').style.display = 'none';
}

function calculatePriceDifference() {
    const newProductSelect = document.getElementById('newProductSelect');
    const exchangeQuantity = document.getElementById('exchangeQuantity');
    const selectedInfo = document.getElementById('selectedExchangeInfo');
    
    if (!newProductSelect.value || !exchangeQuantity.value) {
        document.getElementById('priceDifference').style.display = 'none';
        return;
    }
    
    const originalPrice = parseFloat(selectedInfo.dataset.price);
    const originalQty = parseInt(exchangeQuantity.value);
    const originalTotal = originalPrice * originalQty;
    
    const selectedOption = newProductSelect.options[newProductSelect.selectedIndex];
    const newPrice = parseFloat(selectedOption.dataset.price);
    const newStock = parseInt(selectedOption.dataset.stock);
    const exchangeQty = parseInt(exchangeQuantity.value);
    
    if (exchangeQty > newStock) {
        showNotification(`Only ${newStock} items available in stock`, 'error');
        exchangeQuantity.value = newStock;
        return;
    }
    
    const newTotal = newPrice * exchangeQty;
    const difference = newTotal - originalTotal;
    
    const priceDiffDiv = document.getElementById('priceDifference');
    const diffAmountSpan = document.getElementById('diffAmount');
    const diffNoteSpan = document.getElementById('diffNote');
    
    priceDiffDiv.style.display = 'block';
    
    if (difference > 0) {
        diffAmountSpan.innerHTML = `+₱${difference.toFixed(2)} (Customer pays extra)`;
        diffAmountSpan.style.color = '#e74c3c';
        diffNoteSpan.textContent = 'Customer needs to pay the difference';
    } else if (difference < 0) {
        diffAmountSpan.innerHTML = `-₱${Math.abs(difference).toFixed(2)} (Refund to customer)`;
        diffAmountSpan.style.color = '#27ae60';
        diffNoteSpan.textContent = 'Store refunds the difference';
    } else {
        diffAmountSpan.innerHTML = `₱0.00 (Even exchange)`;
        diffAmountSpan.style.color = '#3498db';
        diffNoteSpan.textContent = 'No price difference';
    }
}

const processExchangeBtn = document.getElementById('processExchangeBtn');
if (processExchangeBtn) {
    processExchangeBtn.addEventListener('click', async function(e) {
        e.preventDefault();
        
        if (isProcessingExchange) {
            showNotification('Exchange is already being processed...', 'info');
            return;
        }
        
        const selectedInfo = document.getElementById('selectedExchangeInfo');
        const saleId = selectedInfo.dataset.saleId;
        const originalProductId = selectedInfo.dataset.productId;
        const originalProductName = selectedInfo.dataset.productName;
        const originalPrice = parseFloat(selectedInfo.dataset.price);
        const exchangeQuantity = parseInt(document.getElementById('exchangeQuantity').value);
        const exchangeReason = document.getElementById('exchangeReason').value;
        const maxQuantity = parseInt(selectedInfo.dataset.maxQuantity);
        const originalDiscountable = selectedInfo.dataset.discountable === 'true';
        
        const newProductSelect = document.getElementById('newProductSelect');
        if (!newProductSelect.value) {
            showNotification('Please select a replacement product', 'error');
            return;
        }
        
        const selectedOption = newProductSelect.options[newProductSelect.selectedIndex];
        const newProductId = newProductSelect.value;
        const newProductName = selectedOption.dataset.name;
        const newPrice = parseFloat(selectedOption.dataset.price);
        const newStock = parseInt(selectedOption.dataset.stock);
        const newDiscountable = selectedOption.dataset.discountable === 'true';
        
        if (exchangeQuantity < 1 || exchangeQuantity > maxQuantity) {
            showNotification(`Invalid quantity. Max allowed: ${maxQuantity}`, 'error');
            return;
        }
        
        if (exchangeQuantity > newStock) {
            showNotification(`Insufficient stock for replacement product. Only ${newStock} available.`, 'error');
            return;
        }
        
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showNotification('Sale not found', 'error');
            return;
        }
        
        const sale = saleDoc.data();
        if (!isWithinExchangeWindow(sale.date)) {
            showNotification('This transaction is outside the 24-hour exchange window', 'error');
            return;
        }
        
        isProcessingExchange = true;
        const originalText = processExchangeBtn.textContent;
        processExchangeBtn.disabled = true;
        processExchangeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        
        try {
            const originalTotal = originalPrice * exchangeQuantity;
            const newTotal = newPrice * exchangeQuantity;
            const priceDifference = newTotal - originalTotal;
            
            const exchangeId = await generateExchangeId();
            const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
            
            const exchangeData = {
                exchangeId: exchangeId,
                originalSaleId: saleId,
                originalInvoiceNumber: sale.invoiceNumber,
                originalProductId: originalProductId,
                originalProduct: originalProductName,
                originalPrice: originalPrice,
                originalDiscountable: originalDiscountable,
                newProductId: newProductId,
                newProduct: newProductName,
                newPrice: newPrice,
                newDiscountable: newDiscountable,
                quantity: exchangeQuantity,
                originalTotal: originalTotal,
                newTotal: newTotal,
                priceDifference: priceDifference,
                reason: exchangeReason,
                date: Timestamp.now(),
                cashierId: loggedInUserId,
                cashierName: cashierName,
                status: 'completed'
            };
            
            await addDoc(collection(db, "exchanges"), exchangeData);
            
            const originalProductRef = doc(db, "products", originalProductId);
            const originalProductDoc = await getDoc(originalProductRef);
            
            if (originalProductDoc.exists()) {
                const currentStock = originalProductDoc.data().stock;
                const newStock = currentStock + exchangeQuantity;
                
                await updateDoc(originalProductRef, {
                    stock: newStock,
                    lastUpdated: Timestamp.now()
                });
            }
            
            const newProductRef = doc(db, "products", newProductId);
            const newProductDoc = await getDoc(newProductRef);
            
            if (newProductDoc.exists()) {
                const currentStock = newProductDoc.data().stock;
                const updatedStock = currentStock - exchangeQuantity;
                
                await updateDoc(newProductRef, {
                    stock: updatedStock,
                    lastUpdated: Timestamp.now()
                });
            }
            
            const saleExchanges = sale.exchanges || [];
            saleExchanges.push({
                exchangeId: exchangeId,
                originalProductId: originalProductId,
                originalProduct: originalProductName,
                newProductId: newProductId,
                newProduct: newProductName,
                quantity: exchangeQuantity,
                priceDifference: priceDifference,
                date: Timestamp.now()
            });
            
            await updateDoc(saleRef, {
                exchanges: saleExchanges,
                lastUpdated: Timestamp.now()
            });
            
            const diffText = priceDifference > 0 ? 
                `+₱${priceDifference.toFixed(2)}` : 
                priceDifference < 0 ? 
                `-₱${Math.abs(priceDifference).toFixed(2)}` : 
                '₱0.00';
            
            await addDoc(collection(db, "activities"), {
                type: 'exchange',
                description: `Exchange #${exchangeId}: ${exchangeQuantity} x ${originalProductName} → ${newProductName} (${diffText})`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
            
            if (priceDifference > 0) {
                showNotification(`Exchange processed! Customer pays additional ₱${priceDifference.toFixed(2)}`, 'success');
            } else if (priceDifference < 0) {
                showNotification(`Exchange processed! Refund ₱${Math.abs(priceDifference).toFixed(2)} to customer`, 'success');
            } else {
                showNotification('Exchange processed! Even exchange completed.', 'success');
            }
            
            generateExchangeReceipt(exchangeData);
            
            document.getElementById('exchangeModal').style.display = 'none';
            
            await Promise.all([
                loadDashboardStats(),
                loadSalesHistory(currentSortOrder),
                loadInventory(),
                loadReportsTab()
            ]);
            
        } catch (error) {
            console.error("Error processing exchange:", error);
            showNotification('Error processing exchange', 'error');
        } finally {
            isProcessingExchange = false;
            processExchangeBtn.disabled = false;
            processExchangeBtn.textContent = originalText;
        }
    });
}

function generateExchangeReceipt(exchangeData) {
    const originalDiscountNote = exchangeData.originalDiscountable ? '' : ' (Non-discountable)';
    const newDiscountNote = exchangeData.newDiscountable ? '' : ' (Non-discountable)';
    
    const receipt = `
╔════════════════════════════════╗
║     GMDC BOTICA PHARMACY       ║
║       EXCHANGE RECEIPT          ║
╠════════════════════════════════╣
║ Exchange ID: ${exchangeData.exchangeId}
║ Date: ${formatDate(new Date())}
║ Cashier: ${exchangeData.cashierName}
╠════════════════════════════════╣
║ EXCHANGE DETAILS:              ║
║ Returned: ${exchangeData.originalProduct}${originalDiscountNote}
║   Qty: ${exchangeData.quantity} × ₱${exchangeData.originalPrice.toFixed(2)}
║   Total: ₱${exchangeData.originalTotal.toFixed(2)}
║                                ║
║ Received: ${exchangeData.newProduct}${newDiscountNote}
║   Qty: ${exchangeData.quantity} × ₱${exchangeData.newPrice.toFixed(2)}
║   Total: ₱${exchangeData.newTotal.toFixed(2)}
╠════════════════════════════════╣
║ PRICE DIFFERENCE:              ║
${exchangeData.priceDifference > 0 ? 
`║   Customer pays: +₱${exchangeData.priceDifference.toFixed(2)}` : 
exchangeData.priceDifference < 0 ? 
`║   Refund to customer: ₱${Math.abs(exchangeData.priceDifference).toFixed(2)}` : 
'║   Even exchange - No payment'}
╠════════════════════════════════╣
║ Reason: ${exchangeData.reason}
╠════════════════════════════════╣
║       24-HOUR EXCHANGE         ║
║         POLICY APPLIED          ║
╚════════════════════════════════╝
    `;
    
    console.log(receipt);
    showNotification('Exchange receipt generated', 'success');
}

// ========== PDF REPORT GENERATION FUNCTIONS ==========

async function downloadSalesPDF() {
    try {
        showNotification('Generating PDF report...', 'info');
        
        const tableBody = document.getElementById('salesTableBody');
        const rows = tableBody.querySelectorAll('tr');
        
        if (rows.length === 0 || (rows.length === 1 && rows[0].querySelector('.no-data'))) {
            showNotification('No sales data to export', 'error');
            return;
        }
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });
        
        doc.setFontSize(18);
        doc.setTextColor(44, 62, 80);
        doc.text('GMDC BOTICA - Sales History Report', 14, 15);
        
        doc.setFontSize(10);
        doc.setTextColor(127, 140, 141);
        const now = new Date();
        doc.text(`Generated on: ${formatDateForPDF(now)}`, 14, 22);
        
        const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
        doc.text(`Generated by: ${cashierName}`, 14, 27);
        
        const tableColumn = ["Invoice #", "Date", "Items", "Total (₱)", "Payment Method", "Cashier"];
        const tableRows = [];
        
        let grandTotal = 0;
        let transactionCount = 0;
        
        rows.forEach(row => {
            if (row.querySelector('.no-data')) return;
            
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return;
            
            const invoice = cells[0]?.textContent?.replace(/Exchange Eligible|Exchange Window Closed|Exchanged/g, '').trim() || 'N/A';
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
        
        doc.setFontSize(12);
        doc.setTextColor(52, 152, 219);
        doc.text(`Summary: ${transactionCount} transactions | Total Sales: ₱${grandTotal.toFixed(2)}`, 14, 35);
        
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
        
        const fileName = `sales_report_${formatDateForFileName(now)}.pdf`;
        doc.save(fileName);
        
        showNotification('PDF report downloaded successfully!', 'success');
        
    } catch (error) {
        console.error("Error generating PDF:", error);
        showNotification('Error generating PDF report', 'error');
    }
}

async function downloadReportPDF() {
    try {
        showNotification('Generating comprehensive PDF report...', 'info');
        
        const selectedMonth = parseInt(document.getElementById('reportMonth')?.value || new Date().getMonth());
        const selectedYear = parseInt(document.getElementById('reportYear')?.value || new Date().getFullYear());
        const period = document.getElementById('reportPeriod')?.value || 'daily';
        
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                            'July', 'August', 'September', 'October', 'November', 'December'];
        
        const chartCanvas = document.getElementById('reportChart');
        if (!chartCanvas) {
            showNotification('No chart data to export', 'error');
            return;
        }
        
        const reportStats = document.getElementById('reportStats');
        const statsCards = reportStats.querySelectorAll('.stat-card');
        let totalSales = 0;
        let transactions = 0;
        let averageSale = 0;
        
        if (statsCards.length >= 3) {
            totalSales = parseFloat(statsCards[0]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
            transactions = parseInt(statsCards[1]?.querySelector('p')?.textContent || 0);
            averageSale = parseFloat(statsCards[2]?.querySelector('p')?.textContent?.replace('₱', '') || 0);
        }
        
        const productSalesData = await getProductSalesData(selectedMonth, selectedYear);
        const salesData = await getDetailedSalesData(selectedMonth, selectedYear);
        const exchangeData = await getExchangeData(selectedMonth, selectedYear);
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        let yPos = 15;
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 14;
        
        doc.setFontSize(22);
        doc.setTextColor(44, 62, 80);
        doc.setFont('helvetica', 'bold');
        doc.text('GMDC BOTICA PHARMACY', pageWidth / 2, yPos, { align: 'center' });
        yPos += 8;
        
        doc.setFontSize(18);
        doc.setTextColor(52, 152, 219);
        doc.text('Comprehensive Sales Report', pageWidth / 2, yPos, { align: 'center' });
        yPos += 8;
        
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.setFont('helvetica', 'normal');
        doc.text(`${monthNames[selectedMonth]} ${selectedYear} - ${period.charAt(0).toUpperCase() + period.slice(1)} Analysis`, pageWidth / 2, yPos, { align: 'center' });
        yPos += 10;
        
        doc.setDrawColor(52, 152, 219);
        doc.setLineWidth(0.5);
        doc.line(margin, yPos - 2, pageWidth - margin, yPos - 2);
        yPos += 5;
        
        doc.setFontSize(10);
        doc.setTextColor(127, 140, 141);
        const now = new Date();
        doc.text(`Generated on: ${formatDateForPDF(now)}`, margin, yPos);
        yPos += 5;
        
        const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
        doc.text(`Generated by: ${cashierName}`, margin, yPos);
        yPos += 5;
        
        const reportPeriod = document.getElementById('reportPeriod')?.options[document.getElementById('reportPeriod')?.selectedIndex]?.text || 'Daily';
        doc.text(`Report Period: ${reportPeriod}`, margin, yPos);
        yPos += 10;
        
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.setFont('helvetica', 'bold');
        doc.text('Executive Summary', margin, yPos);
        yPos += 7;
        
        doc.setFillColor(248, 249, 250);
        doc.setDrawColor(222, 226, 230);
        doc.roundedRect(margin, yPos - 2, pageWidth - (margin * 2), 40, 3, 3, 'FD');
        
        doc.setFontSize(11);
        doc.setTextColor(44, 62, 80);
        doc.setFont('helvetica', 'normal');
        doc.text(`Gross Sales: ₱${(totalSales + (exchangeData.totalExchangeAdjustments > 0 ? exchangeData.totalExchangeAdjustments : 0)).toFixed(2)}`, margin + 5, yPos + 5);
        doc.text(`Exchange Adjustments: ${exchangeData.totalExchangeAdjustments >= 0 ? '+' : ''}₱${exchangeData.totalExchangeAdjustments.toFixed(2)}`, margin + 5, yPos + 12);
        doc.text(`Net Sales: ₱${(totalSales + exchangeData.totalExchangeAdjustments).toFixed(2)}`, margin + 5, yPos + 19);
        doc.text(`Number of Transactions: ${transactions}`, margin + 5, yPos + 26);
        doc.text(`Average Sale per Transaction: ₱${averageSale.toFixed(2)}`, margin + 5, yPos + 33);
        yPos += 45;
        
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.setFont('helvetica', 'bold');
        doc.text('Sales Visualization', margin, yPos);
        yPos += 7;
        
        try {
            const chartImage = chartCanvas.toDataURL('image/png');
            doc.addImage(chartImage, 'PNG', margin, yPos, pageWidth - (margin * 2), 70);
            yPos += 75;
        } catch (error) {
            console.error("Error adding chart to PDF:", error);
            doc.setFontSize(11);
            doc.setTextColor(127, 140, 141);
            doc.text('Chart data could not be loaded', margin, yPos + 10);
            yPos += 20;
        }
        
        if (exchangeData.count > 0) {
            doc.setFontSize(14);
            doc.setTextColor(44, 62, 80);
            doc.setFont('helvetica', 'bold');
            doc.text('Exchange Summary', margin, yPos);
            yPos += 7;
            
            doc.setFontSize(11);
            doc.setTextColor(44, 62, 80);
            doc.text(`Total Exchanges: ${exchangeData.count}`, margin, yPos);
            yPos += 5;
            doc.text(`Total Items Exchanged: ${exchangeData.totalItems}`, margin, yPos);
            yPos += 5;
            doc.text(`Net Exchange Adjustment: ${exchangeData.totalExchangeAdjustments >= 0 ? '+' : ''}₱${exchangeData.totalExchangeAdjustments.toFixed(2)}`, margin, yPos);
            yPos += 10;
        }
        
        if (salesData.labels && salesData.labels.length > 0) {
            doc.setFontSize(14);
            doc.setTextColor(44, 62, 80);
            doc.setFont('helvetica', 'bold');
            doc.text('Period Breakdown', margin, yPos);
            yPos += 7;
            
            const breakdownColumn = ["Date/Period", "Sales (₱)", "Transactions", "Average"];
            const breakdownRows = [];
            
            for (let i = 0; i < salesData.labels.length; i++) {
                const label = salesData.labels[i];
                const saleAmount = salesData.data[i] || 0;
                const transactionCount = salesData.transactionCounts[i] || 0;
                const avg = transactionCount > 0 ? saleAmount / transactionCount : 0;
                
                breakdownRows.push([
                    label,
                    saleAmount.toFixed(2),
                    transactionCount.toString(),
                    avg.toFixed(2)
                ]);
            }
            
            doc.autoTable({
                head: [breakdownColumn],
                body: breakdownRows,
                startY: yPos,
                theme: 'striped',
                headStyles: {
                    fillColor: [52, 152, 219],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    fontSize: 10
                },
                bodyStyles: {
                    fontSize: 9
                },
                columnStyles: {
                    0: { cellWidth: 40 },
                    1: { cellWidth: 40, halign: 'right' },
                    2: { cellWidth: 30, halign: 'center' },
                    3: { cellWidth: 40, halign: 'right' }
                },
                margin: { left: margin, right: margin }
            });
            
            yPos = doc.lastAutoTable.finalY + 10;
        }
        
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }
        
        if (productSalesData.length > 0) {
            doc.setFontSize(16);
            doc.setTextColor(44, 62, 80);
            doc.setFont('helvetica', 'bold');
            doc.text('Product Sales Breakdown', margin, yPos);
            yPos += 7;
            
            const totalItemsSold = productSalesData.reduce((sum, p) => sum + p.quantity, 0);
            const totalRevenue = productSalesData.reduce((sum, p) => sum + p.revenue, 0);
            
            doc.setFontSize(10);
            doc.setTextColor(127, 140, 141);
            doc.text(`Total Items Sold: ${totalItemsSold} pcs | Total Revenue: ₱${totalRevenue.toFixed(2)}`, margin, yPos);
            yPos += 7;
            
            const productTableColumn = ["Product Name", "Qty Sold", "Revenue (₱)", "% of Total"];
            const productTableRows = [];
            
            productSalesData.forEach(product => {
                const percentage = totalRevenue > 0 ? ((product.revenue / totalRevenue) * 100).toFixed(1) : 0;
                productTableRows.push([
                    product.name,
                    product.quantity.toString(),
                    product.revenue.toFixed(2),
                    percentage + '%'
                ]);
            });
            
            doc.setFontSize(9);
            doc.setTextColor(52, 152, 219);
            doc.text(`Top 3 Products by Revenue:`, margin, yPos);
            yPos += 5;
            
            const topProducts = [...productSalesData].sort((a, b) => b.revenue - a.revenue).slice(0, 3);
            topProducts.forEach((product, index) => {
                doc.setFontSize(9);
                doc.setTextColor(44, 62, 80);
                doc.text(`${index + 1}. ${product.name} - ${product.quantity} pcs (₱${product.revenue.toFixed(2)})`, margin + 5, yPos);
                yPos += 4;
            });
            
            yPos += 3;
            
            doc.autoTable({
                head: [productTableColumn],
                body: productTableRows,
                startY: yPos,
                theme: 'striped',
                headStyles: {
                    fillColor: [52, 152, 219],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    fontSize: 10
                },
                bodyStyles: {
                    fontSize: 9
                },
                columnStyles: {
                    0: { cellWidth: 70 },
                    1: { cellWidth: 25, halign: 'center' },
                    2: { cellWidth: 35, halign: 'right' },
                    3: { cellWidth: 25, halign: 'center' }
                },
                margin: { left: margin, right: margin }
            });
            
            yPos = doc.lastAutoTable.finalY + 10;
        }
        
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            
            doc.setDrawColor(52, 152, 219);
            doc.setLineWidth(0.5);
            doc.line(margin, doc.internal.pageSize.height - 15, pageWidth - margin, doc.internal.pageSize.height - 15);
            
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(
                `Page ${i} of ${pageCount}`,
                pageWidth - margin,
                doc.internal.pageSize.height - 10,
                { align: 'right' }
            );
            doc.text(
                'GMDC BOTICA Pharmacy Management System',
                margin,
                doc.internal.pageSize.height - 10
            );
            
            doc.text(
                `Report generated on ${formatDateForPDF(now)}`,
                pageWidth / 2,
                doc.internal.pageSize.height - 5,
                { align: 'center' }
            );
        }
        
        const fileName = `comprehensive_report_${monthNames[selectedMonth]}_${selectedYear}_${formatDateForFileName(now)}.pdf`;
        doc.save(fileName);
        
        showNotification('Comprehensive PDF report downloaded successfully!', 'success');
        
    } catch (error) {
        console.error("Error generating report PDF:", error);
        showNotification('Error generating PDF report: ' + error.message, 'error');
    }
}

async function getExchangeData(selectedMonth, selectedYear) {
    try {
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const exchangesQuery = query(
            collection(db, "exchanges"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const exchangesSnapshot = await getDocs(exchangesQuery);
        
        let totalExchangeAdjustments = 0;
        let totalItems = 0;
        let count = 0;
        
        exchangesSnapshot.forEach(doc => {
            const exchange = doc.data();
            totalExchangeAdjustments += exchange.priceDifference || 0;
            totalItems += exchange.quantity || 0;
            count++;
        });
        
        return {
            count,
            totalItems,
            totalExchangeAdjustments
        };
    } catch (error) {
        console.error("Error getting exchange data:", error);
        return {
            count: 0,
            totalItems: 0,
            totalExchangeAdjustments: 0
        };
    }
}

async function getDetailedSalesData(selectedMonth, selectedYear) {
    try {
        const period = document.getElementById('reportPeriod')?.value || 'daily';
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate)),
            orderBy("date", "asc")
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        const labels = [];
        const data = [];
        const transactionCounts = [];
        
        if (period === 'daily') {
            const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
            const dailyData = new Array(daysInMonth).fill(0);
            const dailyCount = new Array(daysInMonth).fill(0);
            
            salesSnapshot.forEach(doc => {
                const sale = doc.data();
                const saleDate = sale.date.toDate();
                const day = saleDate.getDate() - 1;
                if (day >= 0 && day < daysInMonth) {
                    dailyData[day] += sale.total || 0;
                    dailyCount[day]++;
                }
            });
            
            for (let i = 1; i <= daysInMonth; i++) {
                labels.push(`Day ${i}`);
            }
            data.push(...dailyData);
            transactionCounts.push(...dailyCount);
        } else if (period === 'weekly') {
            const weeksInMonth = 5;
            const weeklyData = new Array(weeksInMonth).fill(0);
            const weeklyCount = new Array(weeksInMonth).fill(0);
            
            salesSnapshot.forEach(doc => {
                const sale = doc.data();
                const saleDate = sale.date.toDate();
                const dayOfMonth = saleDate.getDate();
                const weekIndex = Math.floor((dayOfMonth - 1) / 7);
                if (weekIndex < weeksInMonth) {
                    weeklyData[weekIndex] += sale.total || 0;
                    weeklyCount[weekIndex]++;
                }
            });
            
            for (let i = 0; i < weeksInMonth; i++) {
                labels.push(`Week ${i + 1}`);
            }
            data.push(...weeklyData);
            transactionCounts.push(...weeklyCount);
        }
        
        return { labels, data, transactionCounts };
    } catch (error) {
        console.error("Error getting detailed sales data:", error);
        return { labels: [], data: [], transactionCounts: [] };
    }
}

async function getProductSalesData(selectedMonth, selectedYear) {
    try {
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
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

function formatDateForFileName(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}`;
}

// ========== REPORTS FUNCTIONALITY ==========

async function loadReportsTab() {
    try {
        console.log("Loading reports tab...");
        
        populateYearDropdown();
        
        const today = new Date();
        document.getElementById('reportMonth').value = today.getMonth().toString();
        
        const reportPeriod = document.getElementById('reportPeriod');
        if (reportPeriod) {
            const newReportPeriod = reportPeriod.cloneNode(true);
            reportPeriod.parentNode.replaceChild(newReportPeriod, reportPeriod);
            newReportPeriod.addEventListener('change', () => {
                generateReport();
            });
        }
        
        const reportMonth = document.getElementById('reportMonth');
        if (reportMonth) {
            const newReportMonth = reportMonth.cloneNode(true);
            reportMonth.parentNode.replaceChild(newReportMonth, reportMonth);
            newReportMonth.addEventListener('change', () => {
                generateReport();
            });
        }
        
        const reportYear = document.getElementById('reportYear');
        if (reportYear) {
            const newReportYear = reportYear.cloneNode(true);
            reportYear.parentNode.replaceChild(newReportYear, reportYear);
            newReportYear.addEventListener('change', () => {
                generateReport();
            });
        }
        
        const generateBtn = document.getElementById('generateReportBtn');
        if (generateBtn) {
            const newGenerateBtn = generateBtn.cloneNode(true);
            generateBtn.parentNode.replaceChild(newGenerateBtn, generateBtn);
            newGenerateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                generateReport();
            });
        }
        
        setTimeout(() => {
            generateReport();
        }, 500);
        
    } catch (error) {
        console.error("Error loading reports tab:", error);
        showNotification('Error loading reports', 'error');
    }
}

function populateYearDropdown() {
    const yearSelect = document.getElementById('reportYear');
    if (!yearSelect) return;
    
    const currentYear = new Date().getFullYear();
    
    yearSelect.innerHTML = '';
    
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
        
        reportContent.innerHTML = '<div class="loading">Generating report...</div>';
        if (reportSummary) {
            reportSummary.innerHTML = '';
        }
        
        const selectedMonth = parseInt(document.getElementById('reportMonth')?.value || new Date().getMonth());
        const selectedYear = parseInt(document.getElementById('reportYear')?.value || new Date().getFullYear());
        const period = document.getElementById('reportPeriod')?.value || 'daily';
        
        console.log(`Generating ${period} report for ${selectedMonth + 1}/${selectedYear}`);
        
        let labels = [];
        let data = [];
        let totalSales = 0;
        let totalTransactions = 0;
        let averageSale = 0;
        
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
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
        
        switch(period) {
            case 'daily':
                const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
                const dailyData = new Array(daysInMonth).fill(0);
                const dailyCount = new Array(daysInMonth).fill(0);
                
                sales.forEach(sale => {
                    const saleDate = sale.date.toDate();
                    const day = saleDate.getDate() - 1;
                    if (day >= 0 && day < daysInMonth) {
                        dailyData[day] += sale.total || 0;
                        dailyCount[day]++;
                    }
                });
                
                labels = [];
                for (let i = 1; i <= daysInMonth; i++) {
                    labels.push(`${i}`);
                }
                data = dailyData;
                totalSales = dailyData.reduce((sum, val) => sum + val, 0);
                totalTransactions = dailyCount.reduce((sum, val) => sum + val, 0);
                break;
                
            case 'weekly':
                const weeksInMonth = 5;
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
        
        displayReport(period, labels, data, totalSales, totalTransactions, averageSale, selectedMonth, selectedYear);
        
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

async function loadProductSalesBreakdown(selectedMonth, selectedYear) {
    try {
        const productSalesContainer = document.getElementById('productSalesBreakdown');
        if (!productSalesContainer) return;
        
        const startDate = new Date(selectedYear, selectedMonth, 1);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(selectedYear, selectedMonth + 1, 1);
        endDate.setHours(0, 0, 0, 0);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startDate)),
            where("date", "<", Timestamp.fromDate(endDate))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        
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
                            revenue: 0
                        };
                    }
                    productSales[productName].quantity += item.quantity || 0;
                    productSales[productName].revenue += (item.price * item.quantity) || 0;
                    totalItemsSold += item.quantity || 0;
                });
            }
        });
        
        const netProductSales = Object.entries(productSales).map(([name, data]) => ({
            name: name,
            quantity: data.quantity,
            revenue: data.revenue
        }));
        
        netProductSales.sort((a, b) => b.quantity - a.quantity);
        
        displayProductSalesBreakdown(netProductSales, totalItemsSold);
        
    } catch (error) {
        console.error("Error loading product sales breakdown:", error);
        const productSalesContainer = document.getElementById('productSalesBreakdown');
        if (productSalesContainer) {
            productSalesContainer.innerHTML = '<p class="error">Error loading product sales</p>';
        }
    }
}

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

function displayReport(period, labels, data, totalSales, totalTransactions, averageSale, selectedMonth, selectedYear) {
    const reportContent = document.getElementById('reportStats');
    const reportSummary = document.getElementById('reportSummary');
    const chartCanvas = document.getElementById('reportChart');
    
    if (!reportContent || !chartCanvas) return;
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
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
    
    if (reportSummary) {
        reportSummary.innerHTML = `
            <div class="report-period-info">
                <h3>Report Period: ${monthNames[selectedMonth]} ${selectedYear}</h3>
                <p>Showing ${period} sales data for the selected period.</p>
            </div>
        `;
    }
    
    if (window.reportChartInstance) {
        window.reportChartInstance.destroy();
    }
    
    const ctx = chartCanvas.getContext('2d');
    
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
    
    try {
        window.reportChartInstance = new Chart(ctx, chartConfig);
        console.log("Chart created successfully");
    } catch (error) {
        console.error("Error creating chart:", error);
    }
}

// ===== PRODUCT MODAL =====
const productModal = document.getElementById('productModal');
const addProductBtn = document.getElementById('addProductBtn');
const productCloseBtn = document.querySelector('#productModal .close');

// Keep only this close button handler for the product modal
if (productCloseBtn && productModal) {
    productCloseBtn.addEventListener('click', () => {
        productModal.style.display = 'none';
    });
}

if (productModal) {
    window.addEventListener('click', (e) => {
        if (e.target === productModal) {
            productModal.style.display = 'none';
        }
    });
}

// Product Type Selection Modal Logic
const productTypeModal = document.getElementById('productTypeModal');
const selectExistingBtn = document.getElementById('selectExistingProduct');
const addNewBtn = document.getElementById('addNewProduct');
const existingProductSearch = document.getElementById('existingProductSearch');
const existingProductResults = document.getElementById('existingProductResults');
const selectedProductInfo = document.getElementById('selectedProductInfo');
const confirmAddStockBtn = document.getElementById('confirmAddStockBtn');

// Show product type modal when Add Product button is clicked
if (addProductBtn) {
    addProductBtn.addEventListener('click', () => {
        productTypeModal.style.display = 'block';
    });
}

// Handle Add New Product selection
if (addNewBtn) {
    addNewBtn.addEventListener('click', () => {
        // Close the type modal
        productTypeModal.style.display = 'none';
        
        // Reset and show the add product form
        document.getElementById('productForm').reset();
        document.getElementById('productForm').dataset.editId = '';
        
        const discountableYes = document.getElementById('discountableYes');
        if (discountableYes) {
            discountableYes.checked = true;
        }
        
        // Enable expiry date field for new products (but it will be used for batch creation)
        document.getElementById('productExpiry').disabled = false;
        document.getElementById('productExpiry').placeholder = 'Optional - will be used for first batch';
        
        document.querySelector('#productModal .modal-header h2').textContent = 'Add New Product';
        const submitBtn = document.querySelector('#productForm button[type="submit"]');
        submitBtn.textContent = 'Add Product';
        
        productModal.style.display = 'block';
    });
}

// Handle Add Existing Product selection
if (selectExistingBtn) {
    selectExistingBtn.addEventListener('click', () => {
        productTypeModal.style.display = 'none';
        document.getElementById('addExistingProductModal').style.display = 'block';
        
        // Clear previous selections
        existingProductSearch.value = '';
        existingProductResults.innerHTML = '';
        selectedProductInfo.style.display = 'none';
        selectedProductForStock = null;
    });
}

// Search for existing products
if (existingProductSearch) {
    existingProductSearch.addEventListener('input', debounce(async (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        
        if (searchTerm.length < 2) {
            existingProductResults.innerHTML = '';
            return;
        }
        
        existingProductResults.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
        
        try {
            const productsRef = collection(db, "products");
            const productsSnapshot = await getDocs(productsRef);
            
            const results = [];
            productsSnapshot.forEach(doc => {
                const product = { id: doc.id, ...doc.data() };
                if (product.name?.toLowerCase().includes(searchTerm) || 
                    product.code?.toLowerCase().includes(searchTerm)) {
                    results.push(product);
                }
            });
            
            if (results.length === 0) {
                existingProductResults.innerHTML = '<div style="text-align: center; padding: 20px; color: #7f8c8d;">No products found</div>';
                return;
            }
            
            existingProductResults.innerHTML = '';
            results.slice(0, 10).forEach(product => {
                const resultDiv = document.createElement('div');
                resultDiv.className = 'product-result-item';
                resultDiv.dataset.productId = product.id;
                
                // Create the result item with your HTML structure
                resultDiv.innerHTML = `
                    <div class="product-result-name">${product.name}</div>
                    <div class="product-result-details">
                        <span class="product-result-code">Code: ${product.code || 'N/A'}</span>
                        <span>Stock: ${product.stock || 0}</span>
                        <span>Price: ₱${(product.price || 0).toFixed(2)}</span>
                    </div>
                `;
                
                resultDiv.addEventListener('click', () => selectProductForStock(product));
                existingProductResults.appendChild(resultDiv);
            });
            
        } catch (error) {
            console.error("Error searching products:", error);
            existingProductResults.innerHTML = '<div style="text-align: center; padding: 20px; color: #e74c3c;">Error searching products</div>';
        }
    }, 300));
}

function selectProductForStock(product) {
    selectedProductForStock = product;
    
    // Remove selected class and reset background from all results
    document.querySelectorAll('.product-result-item').forEach(item => {
        item.classList.remove('selected');
        item.style.backgroundColor = '';
    });
    
    // Add selected class to clicked item
    const selectedElement = Array.from(document.querySelectorAll('.product-result-item')).find(
        el => el.dataset.productId === product.id
    );
    if (selectedElement) {
        selectedElement.classList.add('selected');
        selectedElement.style.backgroundColor = '#d4e6f1';
        selectedElement.style.borderLeft = '3px solid #3498db';
    }
    
    // Update the selected product info
    document.getElementById('selectedProductName').textContent = product.name;
    document.getElementById('selectedCurrentStock').textContent = product.stock || 0;
    document.getElementById('selectedProductPrice').textContent = (product.price || 0).toFixed(2);
    
    // Clear and enable stock and expiry fields
    document.getElementById('addStockQuantity').value = 1;
    document.getElementById('addStockQuantity').disabled = false;
    
    document.getElementById('newExpiryDate').value = '';
    document.getElementById('newExpiryDate').disabled = false;
    
    // Show the selected product info section
    selectedProductInfo.style.display = 'block';
    
    // Clear search results
    existingProductResults.innerHTML = '';
    
    // Clear search input
    existingProductSearch.value = '';
}

// Confirm add stock - UPDATED to create batches
if (confirmAddStockBtn) {
    confirmAddStockBtn.addEventListener('click', async () => {
        if (!selectedProductForStock) {
            showNotification('Please select a product', 'error');
            return;
        }
        
        const quantity = parseInt(document.getElementById('addStockQuantity').value);
        const newExpiry = document.getElementById('newExpiryDate').value;
        
        if (!quantity || quantity < 1) {
            showNotification('Please enter a valid quantity', 'error');
            return;
        }
        
        try {
            const productRef = doc(db, "products", selectedProductForStock.id);
            const currentStock = selectedProductForStock.stock || 0;
            const newStock = currentStock + quantity;
            
            // Update product total stock (REMOVED expiryDate from here)
            await updateDoc(productRef, {
                stock: newStock,
                lastUpdated: Timestamp.now()
            });
            
            // If expiry date is provided, create a batch
            if (newExpiry) {
                const batchData = {
                    productId: selectedProductForStock.id,
                    batchNumber: `BATCH-${Date.now()}`,
                    quantity: quantity,
                    expiryDate: Timestamp.fromDate(new Date(newExpiry)),
                    createdAt: Timestamp.now(),
                    createdBy: loggedInUserId
                };
                
                await addDoc(collection(db, "batches"), batchData);
                
                // Add activity log with batch info
                await addDoc(collection(db, "activities"), {
                    type: 'stock',
                    description: `Added batch with ${quantity} units (expires ${new Date(newExpiry).toLocaleDateString()}) to ${selectedProductForStock.name}. New stock: ${newStock}`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
            } else {
                // Add activity log without batch
                await addDoc(collection(db, "activities"), {
                    type: 'stock',
                    description: `Added ${quantity} units to ${selectedProductForStock.name}. New stock: ${newStock}`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
            }
            
            showNotification(`Successfully added ${quantity} units to ${selectedProductForStock.name}`, 'success');
            
            // Close modal and reset
            document.getElementById('addExistingProductModal').style.display = 'none';
            selectedProductInfo.style.display = 'none';
            existingProductSearch.value = '';
            existingProductResults.innerHTML = '';
            selectedProductForStock = null;
            
            // Refresh inventory if visible
            const inventoryTab = document.getElementById('inventory-tab');
            if (inventoryTab && inventoryTab.classList.contains('active')) {
                loadInventory();
            }
            
        } catch (error) {
            console.error("Error adding stock:", error);
            showNotification('Error adding stock: ' + error.message, 'error');
        }
    });
}

// Close modal function
window.closeModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

const productForm = document.getElementById('productForm');
if (productForm) {
    productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const editId = productForm.dataset.editId;
        
        try {
            const discountableYes = document.getElementById('discountableYes');
            const discountableNo = document.getElementById('discountableNo');
            const discountable = discountableYes && discountableYes.checked ? true : false;
            
            // Get expiry date if provided (for initial batch)
            const expiryDateInput = document.getElementById('productExpiry')?.value;
            
            const productData = {
                code: document.getElementById('productCode')?.value || '',
                name: document.getElementById('productName')?.value || '',
                category: document.getElementById('productCategory')?.value || '',
                price: parseFloat(document.getElementById('productPrice')?.value) || 0,
                stock: parseInt(document.getElementById('productStock')?.value) || 0,
                discountable: discountable,
                // Don't store expiry date in product
                description: document.getElementById('productDescription')?.value || '',
                lastUpdated: Timestamp.now()
            };
            
            if (editId) {
                const productRef = doc(db, "products", editId);
                await updateDoc(productRef, productData);
                
                await addDoc(collection(db, "activities"), {
                    type: 'product',
                    description: `Product updated: ${productData.name}${!discountable ? ' (Non-discountable)' : ''}`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
                
                showNotification('Product updated successfully!', 'success');
            } else {
                productData.createdAt = Timestamp.now();
                const productRef = await addDoc(collection(db, "products"), productData);
                
                // If expiry date is provided for a new product, create an initial batch
                if (expiryDateInput && productData.stock > 0) {
                    const batchData = {
                        productId: productRef.id,
                        batchNumber: `BATCH-${Date.now()}`,
                        quantity: productData.stock,
                        expiryDate: Timestamp.fromDate(new Date(expiryDateInput)),
                        createdAt: Timestamp.now(),
                        createdBy: loggedInUserId
                    };
                    
                    await addDoc(collection(db, "batches"), batchData);
                }
                
                await addDoc(collection(db, "activities"), {
                    type: 'product',
                    description: `New product added: ${productData.name}${!discountable ? ' (Non-discountable)' : ''}`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
                
                showNotification('Product added successfully!', 'success');
            }
            
            // Close the modal
            const productModal = document.getElementById('productModal');
            if (productModal) {
                productModal.style.display = 'none';
            }
            
            productForm.reset();
            productForm.dataset.editId = '';
            
            const discountableYesReset = document.getElementById('discountableYes');
            if (discountableYesReset) {
                discountableYesReset.checked = true;
            }
            
            // Refresh the inventory view
            loadInventory();
            
        } catch (error) {
            console.error("Error saving product:", error);
            showNotification('Error saving product. Please try again.', 'error');
        }
    });
}

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

function addMobileDataLabels() {
    const inventoryRows = document.querySelectorAll('#inventoryTableBody tr');
    inventoryRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const labels = ['Product Code', 'Product Name', 'Category', 'Price', 'Stock', 'Expiry Date', 'Actions'];
        cells.forEach((cell, index) => {
            cell.setAttribute('data-label', labels[index]);
        });
    });

    const salesRows = document.querySelectorAll('#salesTableBody tr');
    salesRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const labels = ['Invoice #', 'Date', 'Items', 'Total', 'Payment', 'Cashier', 'Actions'];
        cells.forEach((cell, index) => {
            cell.setAttribute('data-label', labels[index]);
        });
        
        if (cells[2]) {
            const itemsContent = cells[2].innerHTML;
            cells[2].setAttribute('data-label', 'Items');
            cells[2].innerHTML = itemsContent;
        }
    });
}

function fixMobilePOSScroll() {
    const productsSection = document.querySelector('.products-section');
    const productsGrid = document.getElementById('productsGrid');
    
    if (productsSection && productsGrid) {
        const windowHeight = window.innerHeight;
        const headerHeight = document.querySelector('.mobile-header')?.offsetHeight || 60;
        const welcomeMessage = document.querySelector('.welcome-message')?.offsetHeight || 0;
        const posHeader = document.querySelector('.pos-header')?.offsetHeight || 60;
        
        const availableHeight = windowHeight - headerHeight - welcomeMessage - posHeader - 100;
        productsGrid.style.maxHeight = `${availableHeight}px`;
        productsGrid.style.overflowY = 'auto';
        productsGrid.style.overflowX = 'hidden';
    }
}

// Add CSS styles (only one instance)
const style = document.createElement('style');
style.textContent = `
    .non-discount-badge {
        display: inline-block;
        background: #95a5a6;
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-top: 5px;
    }
    
    .non-discount-badge i {
        margin-right: 3px;
        font-size: 8px;
    }
    
    .non-discount-badge-small {
        display: inline-block;
        background: #95a5a6;
        color: white;
        font-size: 9px;
        padding: 2px 5px;
        border-radius: 8px;
        margin-left: 5px;
    }
    
    .non-discount-badge-small i {
        margin-right: 2px;
        font-size: 7px;
    }
    
    .non-discount-badge-table {
        display: inline-block;
        background: #95a5a6;
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-left: 8px;
    }
    
    .discount-badge-table {
        display: inline-block;
        background: #27ae60;
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-left: 8px;
    }
    
    .discount-note {
        background: #e8f4fd;
        padding: 10px;
        border-radius: 5px;
        font-size: 12px;
        color: #3498db;
        margin: 10px 0;
    }
    
    .discount-note i {
        margin-right: 5px;
    }
    
    .product-card.non-discountable {
        border-left: 3px solid #95a5a6;
    }
    
    .exchange-eligible {
        color: #27ae60;
        font-size: 11px;
        margin-left: 8px;
        padding: 2px 6px;
        background: #e8f8f5;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    
    .exchange-expired {
        color: #e74c3c;
        font-size: 11px;
        margin-left: 8px;
        padding: 2px 6px;
        background: #fde9e9;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    
    .exchange-badge {
        color: #9b59b6;
        font-size: 11px;
        margin-left: 8px;
        padding: 2px 6px;
        background: #f3e6ff;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    
    .exchange-badge-small {
        color: #9b59b6;
        font-size: 10px;
        margin-left: 8px;
        padding: 2px 5px;
        background: #f3e6ff;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        gap: 3px;
    }
    
    .exchange-btn {
        color: #9b59b6 !important;
    }
    
    .exchange-btn:hover {
        background: #f3e6ff !important;
    }
    
    .exchange-disabled {
        color: #bdc3c7 !important;
        cursor: not-allowed !important;
        opacity: 0.5;
    }
    
    .exchange-disabled:hover::after {
        content: attr(title);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background: #2c3e50;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        margin-bottom: 5px;
        z-index: 1000;
    }
    
    .policy-note {
        background: #e8f4fd;
        padding: 8px 12px;
        border-radius: 8px;
        color: #3498db;
        font-size: 13px;
        margin: 10px 0;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .policy-note i {
        font-size: 16px;
    }
    
    .price-difference {
        background: #f8f9fa;
        padding: 15px;
        border-radius: 8px;
        margin: 15px 0;
        border-left: 3px solid #3498db;
    }
    
    .price-difference p {
        margin: 5px 0;
    }
    
    #diffAmount {
        font-size: 18px;
        font-weight: bold;
    }
    
    .diff-note {
        font-size: 12px;
        color: #7f8c8d;
        font-style: italic;
    }
    
    .text-success {
        color: #27ae60;
    }
    
    .text-danger {
        color: #e74c3c;
    }
    
    .exchanged-qty {
        background: #9b59b6;
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        margin-left: 8px;
    }
    
    .exchange-card {
        background: #f3e6ff;
        border-radius: 16px;
        padding: 20px;
        margin-top: 20px;
        border: 1px solid #d9b3ff;
    }
    
    .exchange-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 15px;
    }
    
    .exchange-header i {
        color: #9b59b6;
        font-size: 18px;
    }
    
    .exchange-header h3 {
        margin: 0;
        color: #9b59b6;
        font-size: 16px;
        font-weight: 600;
    }
    
    .exchange-item {
        background: white;
        border-radius: 12px;
        padding: 12px;
        margin-bottom: 10px;
    }
    
    .exchange-item:last-child {
        margin-bottom: 0;
    }
    
    .exchange-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }
    
    .exchange-product {
        font-weight: 600;
        color: #2c3e50;
    }
    
    .exchange-qty {
        background: #e8d5ff;
        color: #9b59b6;
        padding: 2px 8px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
    }
    
    .exchange-diff {
        font-size: 13px;
        font-weight: 500;
        margin: 5px 0;
    }
    
    .exchange-diff.positive {
        color: #27ae60;
    }
    
    .exchange-diff.negative {
        color: #e74c3c;
    }
    
    .exchange-reason {
        font-size: 12px;
        color: #7f8c8d;
        background: #f8f9fa;
        padding: 8px;
        border-radius: 8px;
        margin: 5px 0;
    }
    
    .positive {
        color: #27ae60;
    }
    
    .negative {
        color: #e74c3c;
    }
    
    .sale-badge {
        background: #3498db;
        color: white;
        font-size: 10px;
        padding: 2px 5px;
        border-radius: 10px;
        margin-left: 8px;
        display: inline-flex;
        align-items: center;
        gap: 3px;
    }
    
    .exchange-item {
        border-left: 3px solid #9b59b6;
    }

    /* Filter Summary Styles */
    .filter-summary {
        display: none;
        align-items: center;
        gap: 10px;
        margin-top: 10px;
        padding: 8px 15px;
        background: #e8f4fd;
        border-radius: 20px;
        font-size: 13px;
        color: #3498db;
        flex-wrap: wrap;
    }

    .filter-summary i {
        font-size: 12px;
    }

    .clear-filters-btn {
        background: none;
        border: none;
        color: #e74c3c;
        cursor: pointer;
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 15px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: all 0.3s ease;
        width: auto;
        margin: 0;
        box-shadow: none;
    }

    .clear-filters-btn:hover {
        background: #fee;
        color: #c0392b;
    }

    .clear-filters-btn i {
        font-size: 10px;
    }

    /* Batch Management Styles */
    .batch-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 10px;
        border-bottom: 2px solid #3498db;
    }

    .product-info-summary {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 15px;
        border-radius: 8px;
        margin-bottom: 20px;
    }

    .product-info-summary p {
        margin: 5px 0;
    }

    .batch-list {
        max-height: 400px;
        overflow-y: auto;
        padding-right: 5px;
    }

    .batch-item {
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 10px;
        position: relative;
        transition: all 0.3s ease;
    }

    .batch-item:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    .batch-item.expired {
        border-left: 4px solid #e74c3c;
        background: #fdf3f2;
    }

    .batch-item.expiring-critical {
        border-left: 4px solid #e74c3c;
        background: #fdf3f2;
    }

    .batch-item.expiring-soon {
        border-left: 4px solid #f39c12;
        background: #fef9e7;
    }

    .batch-item.good {
        border-left: 4px solid #27ae60;
    }

    .batch-header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding-bottom: 5px;
        border-bottom: 1px dashed #e0e0e0;
    }

    .batch-number {
        font-size: 16px;
        font-weight: 600;
        color: #2c3e50;
    }

    .batch-number i {
        color: #9b59b6;
        margin-right: 5px;
    }

    .batch-status {
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 600;
    }

    .batch-status.expired,
    .batch-status.expiring-critical {
        background: #e74c3c;
        color: white;
    }

    .batch-status.expiring-soon {
        background: #f39c12;
        color: white;
    }

    .batch-status.good {
        background: #27ae60;
        color: white;
    }

    .batch-details {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 10px;
        font-size: 13px;
    }

    .batch-detail {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #34495e;
    }

    .batch-detail i {
        width: 20px;
        color: #9b59b6;
    }

    .batch-actions {
        position: absolute;
        top: 15px;
        right: 15px;
        display: flex;
        gap: 5px;
    }

    .required {
        color: #e74c3c;
        margin-left: 3px;
    }

    .form-actions {
        display: flex;
        gap: 10px;
        margin-top: 20px;
    }

    .form-actions button {
        flex: 1;
    }

    /* Expiry Badge Styles */
    .expiry-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
    }

    .expiry-badge.expired {
        background: #e74c3c;
        color: white;
    }

    .expiry-badge.expiring-critical {
        background: #e74c3c;
        color: white;
    }

    .expiry-badge.expiring-soon {
        background: #f39c12;
        color: white;
    }

    .expiry-badge i {
        font-size: 10px;
    }

    .no-expiry {
        color: #95a5a6;
        font-size: 12px;
        font-style: italic;
    }
`;

document.head.appendChild(style);

// PDF buttons
document.addEventListener('DOMContentLoaded', () => {
    const downloadPDFBtn = document.getElementById('downloadPDFBtn');
    if (downloadPDFBtn) {
        downloadPDFBtn.addEventListener('click', (e) => {
            e.preventDefault();
            downloadSalesPDF();
        });
    }
    
    const downloadReportPDFBtn = document.getElementById('downloadReportPDFBtn');
    if (downloadReportPDFBtn) {
        downloadReportPDFBtn.addEventListener('click', (e) => {
            e.preventDefault();
            downloadReportPDF();
        });
    }

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

    const exchangeButton = document.getElementById('exchangeButton');
    if (exchangeButton) {
        exchangeButton.addEventListener('click', () => {
            openExchangeModal();
        });
    }
});

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
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

    const discountSelect = document.getElementById('discountSelect');
    if (discountSelect) {
        discountSelect.addEventListener('change', (e) => {
            currentDiscount = parseInt(e.target.value) || 0;
            updateCartDisplay();
        });
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
        addMobileDataLabels();
        fixMobilePOSScroll();
    }
});

document.querySelectorAll('.nav-item[data-tab="pos"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(() => {
            if (window.innerWidth <= 768) {
                fixMobilePOSScroll();
            }
        }, 100);
    });
});

document.querySelectorAll('.nav-item[data-tab="dashboard"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(() => {
            loadRecentActivities();
        }, 100);
    });
});

document.querySelectorAll('.nav-item[data-tab="reports"]').forEach(item => {
    item.addEventListener('click', () => {
        setTimeout(() => {
            loadReportsTab();
        }, 100);
    });
});

window.openSalePanel = async function(saleId) {
    try {
        const modal = document.getElementById('saleDetailsModal');
        const panelBody = document.getElementById('salePanelBody');
        
        if (!modal || !panelBody) {
            console.error("Panel elements not found");
            return;
        }
        
        panelBody.innerHTML = `
            <div style="text-align: center; padding: 50px;">
                <i class="fas fa-spinner fa-spin" style="font-size: 40px; color: #3498db;"></i>
                <p style="margin-top: 20px; color: #7f8c8d;">Loading sale details...</p>
            </div>
        `;
        modal.style.display = 'block';
        
        if (!saleId || saleId === 'demo') {
            showSampleSalePanel();
            return;
        }
        
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            showSampleSalePanel();
            return;
        }
        
        const sale = saleDoc.data();
        
        const saleDate = sale.date?.toDate ? sale.date.toDate() : new Date();
        const formattedDate = saleDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit'
        });
        
        panelBody.innerHTML = buildSalePanelHTML(sale, formattedDate);
        
    } catch (error) {
        console.error("Error opening sale panel:", error);
        showSampleSalePanel();
    }
}

window.closeSalePanel = function() {
    const modal = document.getElementById('saleDetailsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function buildSalePanelHTML(sale, formattedDate) {
    const subtotal = sale.subtotal || 0;
    const discountableSubtotal = sale.discountableSubtotal || 0;
    const nonDiscountableSubtotal = sale.nonDiscountableSubtotal || 0;
    const discountPercentage = sale.discountPercentage || 0;
    const discountAmount = sale.discountAmount || 0;
    const total = sale.total || 0;
    const amountTendered = sale.amountTendered || 0;
    const change = sale.change || 0;
    
    const itemsHtml = sale.items ? sale.items.map(item => {
        const discountMarker = item.discountable === false ? 
            '<span class="non-discount-badge-small">🚫 No Discount</span>' : '';
        return `
        <div class="item-row">
            <div class="item-info">
                <div class="item-name">${item.name} ${discountMarker}</div>
                <div class="item-meta">
                    <span>Code: ${item.code || 'N/A'}</span>
                    <span class="item-qty">Qty: ${item.quantity}</span>
                </div>
            </div>
            <div class="item-price">₱${(item.price * item.quantity).toFixed(2)}</div>
        </div>
    `}).join('') : '<p style="text-align: center; color: #7f8c8d;">No items found</p>';
    
    return `
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
        
        <div class="items-card">
            <div class="items-header">
                <i class="fas fa-shopping-cart"></i>
                <h3>Items Purchased</h3>
            </div>
            <div class="item-list">
                ${itemsHtml}
            </div>
        </div>
        
        <div class="summary-card">
            <div class="summary-row">
                <span class="summary-label">Subtotal:</span>
                <span class="summary-value">₱${subtotal.toFixed(2)}</span>
            </div>
            ${discountPercentage > 0 ? `
            <div class="summary-row">
                <span class="summary-label">Discountable Amount:</span>
                <span class="summary-value">₱${discountableSubtotal.toFixed(2)}</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">Discount (${discountPercentage}%):</span>
                <span class="summary-value discount">-₱${discountAmount.toFixed(2)}</span>
            </div>
            ` : ''}
            <div class="summary-row total-row">
                <span class="total-label">Total Amount:</span>
                <span class="total-value">₱${total.toFixed(2)}</span>
            </div>
        </div>
        
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
        
        <div class="panel-footer">
            <i class="fas fa-check-circle" style="color: #27ae60;"></i>
            Transaction completed successfully
        </div>
    `;
}

function showSampleSalePanel() {
    const panelBody = document.getElementById('salePanelBody');
    panelBody.innerHTML = `
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
                        <div class="item-name">Paracetamol 500mg <span class="non-discount-badge-small">🚫 No Discount</span></div>
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
        
        <div class="summary-card">
            <div class="summary-row">
                <span class="summary-label">Subtotal:</span>
                <span class="summary-value">₱383.00</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">Discountable Amount:</span>
                <span class="summary-value">₱353.00</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">Discount (20%):</span>
                <span class="summary-value discount">-₱70.60</span>
            </div>
            <div class="summary-row total-row">
                <span class="total-label">Total Amount:</span>
                <span class="total-value">₱312.40</span>
            </div>
        </div>
        
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
                    <div class="value change">₱187.60</div>
                </div>
            </div>
        </div>
        
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
        
        <div class="panel-footer">
            <i class="fas fa-check-circle" style="color: #27ae60;"></i>
            Transaction completed successfully
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.view-sale, .btn-icon.view-sale').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const saleId = this.dataset.id;
            openSalePanel(saleId || 'demo');
        });
    });
});

window.onclick = function(event) {
    const modal = document.getElementById('saleDetailsModal');
    if (event.target === modal) {
        closeSalePanel();
    }
}// MIGRATION FUNCTION - Run this ONCE to convert existing products to batches
async function migrateExpiryDatesToBatches() {
    try {
        console.log("Starting migration: Converting product expiry dates to batches...");
        
        const productsSnapshot = await getDocs(collection(db, "products"));
        let migratedCount = 0;
        
        for (const doc of productsSnapshot.docs) {
            const product = doc.data();
            
            // If product has expiry date and stock, create a batch
            if (product.expiryDate && product.stock > 0) {
                console.log(`Migrating ${product.name} - Stock: ${product.stock}`);
                
                // Create a batch for this product
                const batchData = {
                    productId: doc.id,
                    batchNumber: `MIGRATED-${Date.now()}-${migratedCount}`,
                    quantity: product.stock,
                    expiryDate: product.expiryDate,
                    createdAt: Timestamp.now(),
                    createdBy: loggedInUserId || 'system',
                    notes: 'Migrated from product expiry date'
                };
                
                await addDoc(collection(db, "batches"), batchData);
                migratedCount++;
            }
        }
        
        console.log(`Migration complete! Created ${migratedCount} batches.`);
        alert(`Migration complete! Created ${migratedCount} batches. Refresh the page to see your inventory.`);
        
        // Refresh inventory
        loadInventory();
        
    } catch (error) {
        console.error("Error during migration:", error);
        alert("Error during migration: " + error.message);
    }
}

// Make it available globally
window.migrateExpiryDatesToBatches = migrateExpiryDatesToBatches;