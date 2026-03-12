import { db, collection, addDoc, getDocs, getDoc, query, where, orderBy, updateDoc, doc, Timestamp, onSnapshot, writeBatch } from './firebase-config.js';
import { fetchUserData } from './auth.js';

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

// Global variables
let cart = [];
let products = [];
let currentDiscount = 0;
let currentDiscountType = 'none';
let isProcessingPayment = false;
let unsubscribeProducts = null;
let sellExpiringFirst = true;

// Cache for stock items to reduce Firestore reads
let stockItemsCache = null;
let lastStockFetch = 0;
const STOCK_CACHE_DURATION = 30000; // 30 seconds

// Notification state
let notificationBadge = null;
let notificationPopup = null;
let notificationInterval = null;
let lastPopupDismissed = 0;
const NOTIFICATION_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const POPUP_DISMISS_DURATION = 60 * 60 * 1000; // 1 hour before showing popup again

// Discount rates
const DISCOUNT_RATES = {
    seniorPWD: 20,
    yakap: 30 // Updated to 30%
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializePOS();
    setupEventListeners();
    initializeNotifications();
});

async function initializePOS() {
    await loadUserData();
    updateDateTime();
    await loadProducts();
    setupSidebar();
    setupSellExpiringToggle();
    setupDiscountOptions();
}

async function loadUserData() {
    const userData = await fetchUserData(loggedInUserId);
    if (userData) {
        const fullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email?.split('@')[0] || 'User';
        document.getElementById('sidebarUserName').textContent = fullName;
        document.getElementById('sidebarUserEmail').textContent = userData.email || '';
        document.getElementById('welcomeUserName').textContent = fullName.split(' ')[0] || 'User';
    }
}

function updateDateTime() {
    const dateTimeElement = document.getElementById('currentDateTime');
    if (dateTimeElement) {
        const now = new Date();
        dateTimeElement.textContent = now.toLocaleString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
    }
}
setInterval(updateDateTime, 1000);

function setupSidebar() {
    const burgerBtn = document.getElementById('burgerBtn');
    const sidebar = document.querySelector('.sidebar');

    if (burgerBtn) {
        burgerBtn.addEventListener('click', () => {
            sidebar.classList.toggle('active');
            const icon = burgerBtn.querySelector('i');
            icon.classList.toggle('fa-bars');
            icon.classList.toggle('fa-times');
            
            if (sidebar.classList.contains('active') && window.innerWidth <= 768) {
                createOverlay();
            } else {
                removeOverlay();
            }
        });
    }
}

function createOverlay() {
    if (!document.querySelector('.sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 99;';
        document.body.appendChild(overlay);
        
        overlay.addEventListener('click', () => {
            document.querySelector('.sidebar').classList.remove('active');
            document.getElementById('burgerBtn').querySelector('i').classList.remove('fa-times');
            document.getElementById('burgerBtn').querySelector('i').classList.add('fa-bars');
            overlay.remove();
        });
    }
}

function removeOverlay() {
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.remove();
}

// ==================== NOTIFICATION SYSTEM ====================

function initializeNotifications() {
    createNotificationElements();
    checkNotifications();
    
    if (notificationInterval) {
        clearInterval(notificationInterval);
    }
    notificationInterval = setInterval(checkNotifications, NOTIFICATION_CHECK_INTERVAL);
}

function createNotificationElements() {
    const notificationContainer = document.querySelector('.notification');
    if (!notificationContainer) return;
    
    // Redesign notification logo
    notificationContainer.innerHTML = `
        <div class="notification-wrapper" style="position: relative; cursor: pointer;">
            <div class="notification-icon" style="width: 45px; height: 45px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
                <i class="fas fa-bell" style="color: white; font-size: 20px;"></i>
            </div>
            <span class="badge" style="position: absolute; top: -8px; right: -8px; background: #e74c3c; color: white; font-size: 12px; padding: 4px 8px; border-radius: 20px; min-width: 24px; text-align: center; font-weight: 600; border: 2px solid white; display: none; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">0</span>
        </div>
    `;
    
    notificationBadge = notificationContainer.querySelector('.badge');
    
    // Add hover effect
    const notificationIcon = notificationContainer.querySelector('.notification-icon');
    notificationIcon.addEventListener('mouseenter', () => {
        notificationIcon.style.transform = 'scale(1.05)';
        notificationIcon.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
    });
    
    notificationIcon.addEventListener('mouseleave', () => {
        notificationIcon.style.transform = 'scale(1)';
        notificationIcon.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.3)';
    });
    
    // Create notification popup
    if (!document.getElementById('notificationPopup')) {
        const popup = document.createElement('div');
        popup.id = 'notificationPopup';
        popup.className = 'notification-popup';
        popup.style.cssText = `
            position: absolute;
            top: 60px;
            right: 0;
            width: 420px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
            z-index: 1000;
            display: none;
            animation: slideDown 0.3s ease;
            border: 1px solid rgba(0,0,0,0.05);
            overflow: hidden;
        `;
        
        popup.innerHTML = `
            <div class="notification-popup-header" style="padding: 20px; border-bottom: 1px solid #eef2f6; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; background: rgba(255,255,255,0.2); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-bell" style="color: white; font-size: 18px;"></i>
                        </div>
                        <div>
                            <h3 style="margin: 0; font-size: 16px; color: white; font-weight: 600;">Notifications</h3>
                            <p style="margin: 2px 0 0; font-size: 12px; color: rgba(255,255,255,0.7);">Stay updated with alerts</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="notification-refresh-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 36px; height: 36px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
                            <i class="fas fa-sync-alt" style="font-size: 14px;"></i>
                        </button>
                        <button class="notification-close-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 36px; height: 36px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
                            <i class="fas fa-times" style="font-size: 14px;"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="notification-popup-body" id="notificationPopupBody" style="padding: 15px; max-height: 400px; overflow-y: auto;">
                <div class="loading" style="text-align: center; padding: 40px; color: #7f8c8d;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 32px; margin-bottom: 15px; color: #667eea;"></i>
                    <p style="font-size: 14px;">Loading notifications...</p>
                </div>
            </div>
            <div class="notification-popup-footer" style="padding: 15px 20px; border-top: 1px solid #eef2f6; background: #f8fafc;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="far fa-clock" style="color: #95a5a6; font-size: 12px;"></i>
                        <span style="color: #7f8c8d; font-size: 12px;">Last checked: <span id="lastNotificationCheck">Never</span></span>
                    </div>
                    <button class="view-all-notifications" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s;">
                        <i class="fas fa-eye"></i> View All
                    </button>
                </div>
            </div>
        `;
        
        notificationContainer.style.position = 'relative';
        notificationContainer.appendChild(popup);
        
        // Add animation keyframes
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from {
                    transform: translateY(-10px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            
            .notification-item {
                transition: all 0.2s ease;
                border: 1px solid transparent;
                margin-bottom: 8px;
            }
            
            .notification-item:hover {
                transform: translateX(-3px);
                border-color: rgba(0,0,0,0.05);
                box-shadow: 0 4px 12px rgba(0,0,0,0.05);
            }
            
            .notification-refresh-btn:hover, .notification-close-btn:hover {
                background: rgba(255,255,255,0.3) !important;
                transform: rotate(90deg);
            }
            
            .view-all-notifications:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            }
            
            #notificationPopupBody::-webkit-scrollbar {
                width: 6px;
            }
            
            #notificationPopupBody::-webkit-scrollbar-track {
                background: #f1f1f1;
                border-radius: 10px;
            }
            
            #notificationPopupBody::-webkit-scrollbar-thumb {
                background: #cbd5e0;
                border-radius: 10px;
            }
            
            #notificationPopupBody::-webkit-scrollbar-thumb:hover {
                background: #a0aec0;
            }
            
            @keyframes pulse {
                0% {
                    box-shadow: 0 0 0 2px #fff, 0 0 0 4px #e74c3c;
                }
                50% {
                    box-shadow: 0 0 0 2px #fff, 0 0 0 8px #e74c3c;
                }
                100% {
                    box-shadow: 0 0 0 2px #fff, 0 0 0 4px #e74c3c;
                }
            }
        `;
        document.head.appendChild(style);
        
        // Toggle popup on click
        notificationContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleNotificationPopup();
        });
        
        // Close button
        popup.querySelector('.notification-close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            hideNotificationPopup();
            lastPopupDismissed = Date.now();
        });
        
        // Refresh button
        popup.querySelector('.notification-refresh-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            checkNotifications(true);
        });
        
        // View all button
        popup.querySelector('.view-all-notifications').addEventListener('click', (e) => {
            e.stopPropagation();
            window.location.href = 'reports.html';
        });
        
        // Close popup when clicking outside
        document.addEventListener('click', (e) => {
            if (!popup.contains(e.target) && !notificationContainer.contains(e.target)) {
                hideNotificationPopup();
            }
        });
    }
    
    notificationPopup = document.getElementById('notificationPopup');
}

function toggleNotificationPopup() {
    if (!notificationPopup) return;
    
    if (notificationPopup.style.display === 'none' || notificationPopup.style.display === '') {
        notificationPopup.style.display = 'block';
        loadNotificationDetails();
    } else {
        notificationPopup.style.display = 'none';
    }
}

function hideNotificationPopup() {
    if (notificationPopup) {
        notificationPopup.style.display = 'none';
    }
}

function showNotificationPopup() {
    if (!notificationPopup) return;
    
    const now = Date.now();
    if (now - lastPopupDismissed < POPUP_DISMISS_DURATION) {
        return;
    }
    
    notificationPopup.style.display = 'block';
    loadNotificationDetails();
    
    setTimeout(() => {
        if (notificationPopup && notificationPopup.style.display === 'block') {
            notificationPopup.style.display = 'none';
        }
    }, 10000);
}

async function checkNotifications(forceRefresh = false) {
    try {
        const [productsSnapshot, stockItemsSnapshot] = await Promise.all([
            getDocs(collection(db, "products")),
            getDocs(collection(db, "stock_items"))
        ]);
        
        const productsMap = new Map();
        productsSnapshot.forEach(doc => {
            productsMap.set(doc.id, doc.data());
        });
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const threeDaysFromNow = new Date(today);
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
        
        const sevenDaysFromNow = new Date(today);
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        
        let expiringUrgent = 0;
        let expiringWarning = 0;
        let lowStockCount = 0;
        
        const expiringProducts = [];
        const lowStockProducts = [];
        
        // Helper function for low stock threshold
        function getLowStockThreshold(category) {
            const categoryLower = (category || '').toLowerCase();
            if (categoryLower === 'rx' || categoryLower === 'rx medicine') return 50;
            if (categoryLower === 'over the counter' || categoryLower === 'otc') return 30;
            if (categoryLower === 'food' || categoryLower === 'foods') return 5;
            if (categoryLower === 'general merchandise' || categoryLower === 'merchandise') return 2;
            return 10;
        }
        
        function isLowStock(stock, category) {
            if (stock === 0) return false;
            const threshold = getLowStockThreshold(category);
            return stock < threshold;
        }
        
        // Process stock items for expiry
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            if (item.expiryDate && item.status === 'available') {
                const expiryDate = item.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
                
                let productName = item.productName || 'Unknown';
                if (item.productId && productsMap.has(item.productId)) {
                    const product = productsMap.get(item.productId);
                    productName = product.brand || product.name || productName;
                }
                
                if (expiryDate <= threeDaysFromNow) {
                    expiringUrgent++;
                    expiringProducts.push({
                        name: productName,
                        serial: item.serialNumber,
                        expiryDate: expiryDate,
                        type: 'urgent',
                        daysLeft: Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24))
                    });
                } else if (expiryDate <= sevenDaysFromNow) {
                    expiringWarning++;
                    expiringProducts.push({
                        name: productName,
                        serial: item.serialNumber,
                        expiryDate: expiryDate,
                        type: 'warning',
                        daysLeft: Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24))
                    });
                }
            }
        });
        
        // Create available stock map for low stock check
        const availableStockMap = new Map();
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            if (item.status === 'available' && item.productId) {
                availableStockMap.set(item.productId, (availableStockMap.get(item.productId) || 0) + 1);
            }
        });
        
        // Check for low stock
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            const productId = doc.id;
            const actualStock = availableStockMap.get(productId) || 0;
            
            if (actualStock > 0 && isLowStock(actualStock, product.category)) {
                lowStockCount++;
                const productName = product.brand || product.name || 'Unknown';
                const threshold = getLowStockThreshold(product.category);
                lowStockProducts.push({
                    name: productName,
                    stock: actualStock,
                    threshold: threshold
                });
            }
        });
        
        // Sort notifications
        expiringProducts.sort((a, b) => {
            if (a.type === 'urgent' && b.type !== 'urgent') return -1;
            if (a.type !== 'urgent' && b.type === 'urgent') return 1;
            return a.daysLeft - b.daysLeft;
        });
        
        lowStockProducts.sort((a, b) => (a.stock / a.threshold) - (b.stock / b.threshold));
        
        const totalNotifications = expiringUrgent + expiringWarning + lowStockCount;
        
        // Update notification badge
        if (notificationBadge) {
            notificationBadge.textContent = totalNotifications;
            notificationBadge.style.display = totalNotifications > 0 ? 'inline' : 'none';
            
            if (expiringUrgent > 0) {
                notificationBadge.style.background = '#e74c3c';
                notificationBadge.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px #e74c3c';
                notificationBadge.style.animation = 'pulse 2s infinite';
            } else if (expiringWarning > 0 || lowStockCount > 0) {
                notificationBadge.style.background = '#f39c12';
                notificationBadge.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px #f39c12';
            }
        }
        
        // Store notification data
        window.notificationData = {
            expiringUrgent,
            expiringWarning,
            lowStockCount,
            expiringProducts,
            lowStockProducts,
            lastCheck: new Date()
        };
        
        const lastCheckSpan = document.getElementById('lastNotificationCheck');
        if (lastCheckSpan) {
            lastCheckSpan.textContent = formatTimeAgo(new Date());
        }
        
        if (totalNotifications > 0) {
            showNotificationPopup();
        }
        
    } catch (error) {
        console.error("Error checking notifications:", error);
    }
}

function formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

function formatExpiryDate(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays < 0) return 'Expired';
    return `in ${diffDays} days`;
}

async function loadNotificationDetails() {
    const popupBody = document.getElementById('notificationPopupBody');
    if (!popupBody) return;
    
    if (!window.notificationData) {
        await checkNotifications(true);
    }
    
    const data = window.notificationData || {
        expiringUrgent: 0,
        expiringWarning: 0,
        lowStockCount: 0,
        expiringProducts: [],
        lowStockProducts: []
    };
    
    let html = '';
    
    if (data.expiringUrgent === 0 && data.expiringWarning === 0 && data.lowStockCount === 0) {
        html = `
            <div class="no-notifications" style="text-align: center; padding: 60px 20px;">
                <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                    <i class="fas fa-check-circle" style="font-size: 40px; color: #0284c7;"></i>
                </div>
                <h4 style="margin: 0 0 10px; color: #2c3e50; font-size: 18px;">All Clear!</h4>
                <p style="margin: 0; color: #7f8c8d; font-size: 14px;">No notifications at this time.</p>
            </div>
        `;
    } else {
        // Urgent expiring items
        if (data.expiringProducts.filter(p => p.type === 'urgent').length > 0) {
            html += `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 5px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 8px; height: 8px; background: #e74c3c; border-radius: 50%;"></div>
                            <h4 style="margin: 0; font-size: 14px; color: #e74c3c; font-weight: 600;">URGENT - Expiring Soon</h4>
                        </div>
                        <span style="background: #fdf3f2; color: #e74c3c; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;">${data.expiringProducts.filter(p => p.type === 'urgent').length} items</span>
                    </div>
            `;
            
            data.expiringProducts
                .filter(p => p.type === 'urgent')
                .forEach(product => {
                    const expiryText = formatExpiryDate(product.expiryDate);
                    html += `
                        <div class="notification-item urgent" style="background: #fdf3f2; border-left: 4px solid #e74c3c; border-radius: 10px; padding: 15px; margin-bottom: 8px; cursor: pointer;" onclick="window.location.href='inventory.html'">
                            <div style="display: flex; align-items: flex-start; gap: 12px;">
                                <div style="width: 36px; height: 36px; background: rgba(231, 76, 60, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                    <i class="fas fa-exclamation-triangle" style="color: #e74c3c; font-size: 16px;"></i>
                                </div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">${product.name}</div>
                                    <div style="font-size: 12px; color: #7f8c8d; display: flex; gap: 15px; flex-wrap: wrap;">
                                        <span><i class="fas fa-barcode"></i> ${product.serial || 'N/A'}</span>
                                        <span><i class="far fa-clock"></i> Expires ${expiryText}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                });
            
            html += `</div>`;
        }
        
        // Warning expiring items
        if (data.expiringProducts.filter(p => p.type === 'warning').length > 0) {
            html += `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 5px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 8px; height: 8px; background: #f39c12; border-radius: 50%;"></div>
                            <h4 style="margin: 0; font-size: 14px; color: #f39c12; font-weight: 600;">Expiring Soon</h4>
                        </div>
                        <span style="background: #fef9e7; color: #f39c12; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;">${data.expiringProducts.filter(p => p.type === 'warning').length} items</span>
                    </div>
            `;
            
            data.expiringProducts
                .filter(p => p.type === 'warning')
                .forEach(product => {
                    const expiryText = formatExpiryDate(product.expiryDate);
                    html += `
                        <div class="notification-item warning" style="background: #fef9e7; border-left: 4px solid #f39c12; border-radius: 10px; padding: 15px; margin-bottom: 8px; cursor: pointer;" onclick="window.location.href='inventory.html'">
                            <div style="display: flex; align-items: flex-start; gap: 12px;">
                                <div style="width: 36px; height: 36px; background: rgba(243, 156, 18, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                    <i class="fas fa-clock" style="color: #f39c12; font-size: 16px;"></i>
                                </div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">${product.name}</div>
                                    <div style="font-size: 12px; color: #7f8c8d; display: flex; gap: 15px; flex-wrap: wrap;">
                                        <span><i class="fas fa-barcode"></i> ${product.serial || 'N/A'}</span>
                                        <span><i class="far fa-clock"></i> Expires ${expiryText}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                });
            
            html += `</div>`;
        }
        
        // Low stock items
        if (data.lowStockProducts.length > 0) {
            html += `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 5px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 8px; height: 8px; background: #3498db; border-radius: 50%;"></div>
                            <h4 style="margin: 0; font-size: 14px; color: #3498db; font-weight: 600;">Low Stock Alert</h4>
                        </div>
                        <span style="background: #e8f4fd; color: #3498db; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;">${data.lowStockProducts.length} items</span>
                    </div>
            `;
            
            data.lowStockProducts.forEach(product => {
                const percentRemaining = Math.round((product.stock / product.threshold) * 100);
                const barColor = percentRemaining < 20 ? '#e74c3c' : (percentRemaining < 50 ? '#f39c12' : '#3498db');
                
                html += `
                    <div class="notification-item low-stock" style="background: #e8f4fd; border-left: 4px solid #3498db; border-radius: 10px; padding: 15px; margin-bottom: 8px; cursor: pointer;" onclick="window.location.href='inventory.html'">
                        <div style="display: flex; align-items: flex-start; gap: 12px;">
                            <div style="width: 36px; height: 36px; background: rgba(52, 152, 219, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas fa-boxes" style="color: #3498db; font-size: 16px;"></i>
                            </div>
                            <div style="flex: 1;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                    <span style="font-weight: 600; color: #2c3e50;">${product.name}</span>
                                    <span style="background: ${barColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600;">${percentRemaining}%</span>
                                </div>
                                <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 8px;">
                                    Stock: ${product.stock} / ${product.threshold} units
                                </div>
                                <div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;">
                                    <div style="width: ${percentRemaining}%; height: 100%; background: ${barColor}; border-radius: 3px; transition: width 0.3s ease;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            html += `</div>`;
        }
    }
    
    popupBody.innerHTML = html;
}

// ==================== DISCOUNT OPTIONS SETUP ====================

function setupDiscountOptions() {
    const discountContainer = document.querySelector('.discount-container');
    if (!discountContainer) return;
    
    const discountHTML = `
        <div class="discount-options">
            <label class="discount-option">
                <input type="radio" name="discountType" value="none" checked>
                <span class="discount-option-label">No Discount</span>
            </label>
            <label class="discount-option">
                <input type="radio" name="discountType" value="seniorPWD">
                <span class="discount-option-label">
                    <i class="fas fa-id-card"></i> Senior / PWD (20%)
                </span>
            </label>
            <label class="discount-option">
                <input type="radio" name="discountType" value="yakap">
                <span class="discount-option-label">
                    <i class="fas fa-heart"></i> YAKAP (30%)
                </span>
            </label>
        </div>
    `;
    
    discountContainer.innerHTML = discountHTML;
    
    document.querySelectorAll('input[name="discountType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentDiscountType = e.target.value;
            currentDiscount = currentDiscountType === 'none' ? 0 : DISCOUNT_RATES[currentDiscountType];
            updateCartDisplay();
            if (document.getElementById('checkoutModal').style.display === 'block') {
                updateCheckoutModal();
            }
            
            if (currentDiscountType === 'seniorPWD') {
                showNotification('Senior/PWD discount applied (20%)', 'info');
            } else if (currentDiscountType === 'yakap') {
                showNotification('YAKAP discount applied (30%)', 'info');
            }
        });
    });
}

// ==================== SELL EXPIRING FIRST TOGGLE ====================

function setupSellExpiringToggle() {
    const cartHeader = document.querySelector('.cart-header');
    if (cartHeader && !document.getElementById('sellExpiringToggle')) {
        const toggleHTML = `
            <div class="sell-expiring-toggle" id="sellExpiringToggle">
                <label class="toggle-label">
                    <input type="checkbox" id="sellExpiringCheckbox" checked>
                    <span class="toggle-text">
                        <i class="fas fa-clock"></i> Sell Expiring First
                    </span>
                </label>
                <span class="toggle-info" title="When enabled, items that expire soon will be sold first (FEFO - First Expiry First Out)">
                    <i class="fas fa-info-circle"></i>
                </span>
            </div>
        `;
        cartHeader.insertAdjacentHTML('afterend', toggleHTML);
        
        document.getElementById('sellExpiringCheckbox').addEventListener('change', (e) => {
            sellExpiringFirst = e.target.checked;
            showNotification(sellExpiringFirst ? 'Sell Expiring First enabled' : 'Sell Expiring First disabled', 'info');
        });
    }
}

// Optimized function to get stock items with caching
async function getStockItemsWithCache(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && stockItemsCache && (now - lastStockFetch) < STOCK_CACHE_DURATION) {
        return stockItemsCache;
    }
    
    const snapshot = await getDocs(collection(db, "stock_items"));
    stockItemsCache = snapshot;
    lastStockFetch = now;
    return snapshot;
}

// ==================== POS FUNCTIONS WITH EXPIRY WARNINGS ====================

function loadProducts() {
    try {
        const productsGrid = document.getElementById('productsGrid');
        if (!productsGrid) return;
        
        productsGrid.innerHTML = '<div class="loading">Loading products...</div>';
        
        if (unsubscribeProducts) {
            unsubscribeProducts();
        }
        
        const productsRef = collection(db, "products");
        
        // Use a debounced update to prevent too frequent renders
        let updateTimeout;
        unsubscribeProducts = onSnapshot(productsRef, async (snapshot) => {
            if (updateTimeout) clearTimeout(updateTimeout);
            
            updateTimeout = setTimeout(async () => {
                products = [];
                
                if (snapshot.empty) {
                    productsGrid.innerHTML = '<p class="no-data">No products available</p>';
                    return;
                }
                
                // Get stock items with cache
                const stockItemsSnapshot = await getStockItemsWithCache();
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const thirtyDaysFromNow = new Date(today);
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                
                // Create expiry map in one pass
                const expiryMap = new Map();
                
                stockItemsSnapshot.forEach(doc => {
                    const item = doc.data();
                    if (item.expiryDate && item.status === 'available') {
                        const expiryDate = item.expiryDate.toDate();
                        expiryDate.setHours(0, 0, 0, 0);
                        
                        if (expiryDate <= thirtyDaysFromNow) {
                            const productId = item.productId;
                            if (!expiryMap.has(productId)) {
                                expiryMap.set(productId, {
                                    count: 0,
                                    earliestExpiry: expiryDate,
                                    items: []
                                });
                            }
                            const productExpiry = expiryMap.get(productId);
                            productExpiry.count++;
                            productExpiry.items.push({
                                id: doc.id,
                                expiryDate: expiryDate,
                                batchNumber: item.batchNumber,
                                serialNumber: item.serialNumber
                            });
                            if (expiryDate < productExpiry.earliestExpiry) {
                                productExpiry.earliestExpiry = expiryDate;
                            }
                        }
                    }
                });
                
                // Build products array
                snapshot.forEach(doc => {
                    const product = { id: doc.id, ...doc.data() };
                    if (expiryMap.has(product.id)) {
                        product.expiringCount = expiryMap.get(product.id).count;
                        product.earliestExpiry = expiryMap.get(product.id).earliestExpiry;
                        product.expiringItems = expiryMap.get(product.id).items;
                    } else {
                        product.expiringCount = 0;
                        product.expiringItems = [];
                    }
                    products.push(product);
                });
                
                // Clear filters
                document.getElementById('posSearch').value = '';
                document.getElementById('posCategoryFilter').value = '';
                
                displayProducts(products);
                updateCartDisplay();
            }, 300); // Debounce updates
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
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Use document fragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    
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
        
        const brandName = product.brand || product.name || 'Unnamed';
        const genericName = product.generic ? `<small class="generic-name">${product.generic}</small>` : '';
        
        let expiryWarning = '';
        if (product.expiringCount > 0) {
            const daysUntil = Math.ceil((product.earliestExpiry - today) / (1000 * 60 * 60 * 24));
            let expiryClass = 'expiry-warning';
            let expiryText = `${product.expiringCount} expiring soon`;
            
            if (daysUntil <= 7) {
                expiryClass = 'expiry-critical';
                expiryText = `⚠️ ${product.expiringCount} expiring in ${daysUntil} days!`;
            } else {
                expiryText = `⏰ ${product.expiringCount} expiring in ${daysUntil} days`;
            }
            
            expiryWarning = `
                <div class="${expiryClass}" title="${product.expiringCount} item(s) expiring soon. Earliest: ${product.earliestExpiry.toLocaleDateString()}">
                    <i class="fas fa-clock"></i> ${expiryText}
                </div>
            `;
        }
        
        productCard.innerHTML = `
            <div class="product-image">
                <i class="fas fa-pills"></i>
            </div>
            <h4>${brandName}</h4>
            ${genericName}
            <p class="product-price">₱${(product.price || 0).toFixed(2)}</p>
            <p class="product-stock ${isOutOfStock ? 'text-danger' : ''}">Stock: ${product.stock || 0}</p>
            ${discountBadge}
            ${expiryWarning}
            ${isOutOfStock ? '<span class="out-of-stock-label">OUT OF STOCK</span>' : ''}
            <button class="add-to-cart" ${isOutOfStock ? 'disabled' : ''} 
                    data-id="${product.id}">
                ${isOutOfStock ? 'Unavailable' : 'Add to Cart'}
            </button>
        `;
        fragment.appendChild(productCard);
    });
    
    productsGrid.appendChild(fragment);
    
    document.querySelectorAll('.add-to-cart:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => addToCart(btn.dataset.id));
    });
}

// Filter functions with debounce
const posSearch = document.getElementById('posSearch');
if (posSearch) {
    posSearch.addEventListener('input', debounce(() => filterPOSProducts(), 300));
}

const posCategoryFilter = document.getElementById('posCategoryFilter');
if (posCategoryFilter) {
    posCategoryFilter.addEventListener('change', () => filterPOSProducts());
}

function filterPOSProducts() {
    const searchTerm = document.getElementById('posSearch')?.value.toLowerCase().trim() || '';
    const categoryFilter = document.getElementById('posCategoryFilter')?.value || '';
    
    let filteredProducts = products;
    
    if (categoryFilter) {
        filteredProducts = filteredProducts.filter(p => 
            p.category?.toLowerCase() === categoryFilter.toLowerCase()
        );
    }
    
    if (searchTerm) {
        filteredProducts = filteredProducts.filter(p => 
            (p.brand?.toLowerCase().includes(searchTerm) || 
             p.generic?.toLowerCase().includes(searchTerm) ||
             p.code?.toLowerCase().includes(searchTerm))
        );
    }
    
    displayProducts(filteredProducts);
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Cart Functions
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
    
    // Check if product has expiring items and show warning
    if (product.expiringCount > 0) {
        const today = new Date();
        const daysUntil = Math.ceil((product.earliestExpiry - today) / (1000 * 60 * 60 * 24));
        const brandName = product.brand || product.name || 'Product';
        if (daysUntil <= 7) {
            showNotification(`⚠️ Warning: ${brandName} has ${product.expiringCount} item(s) expiring in ${daysUntil} days!`, 'warning');
        } else {
            showNotification(`Note: ${brandName} has ${product.expiringCount} item(s) expiring in ${daysUntil} days`, 'info');
        }
    }
    
    const existingItem = cart.find(item => item.id === productId);
    const brandName = product.brand || product.name || 'Product';
    
    if (existingItem) {
        if (existingItem.quantity + 1 > product.stock) {
            showNotification(`Only ${product.stock} item(s) available in stock!`, 'error');
            return;
        }
        existingItem.quantity++;
        showNotification(`Added another ${brandName} to cart`, 'success');
    } else {
        cart.push({
            id: product.id,
            brand: product.brand || product.name,
            generic: product.generic,
            price: product.price,
            quantity: 1,
            stock: product.stock,
            discountable: product.discountable !== false,
            expiringCount: product.expiringCount,
            earliestExpiry: product.earliestExpiry,
            expiringItems: product.expiringItems || []
        });
        showNotification(`${brandName} added to cart`, 'success');
    }
    
    updateCartDisplay();
}

function updateCartDisplay() {
    const cartItems = document.getElementById('cartItems');
    const subtotalEl = document.getElementById('subtotal');
    const grandTotalEl = document.getElementById('grandTotal');
    const discountInfoEl = document.getElementById('discountInfo');
    
    if (!cartItems) return;
    
    // Clear cart first
    cartItems.innerHTML = '';
    let subtotal = 0;
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="empty-cart">Cart is empty</p>';
        if (subtotalEl) subtotalEl.textContent = '₱0.00';
        if (grandTotalEl) grandTotalEl.textContent = '₱0.00';
        if (discountInfoEl) discountInfoEl.innerHTML = '';
        return;
    }
    
    // Update discount info
    if (discountInfoEl) {
        if (currentDiscountType !== 'none') {
            const discountName = currentDiscountType === 'seniorPWD' ? 'Senior/PWD' : 'YAKAP';
            discountInfoEl.innerHTML = `
                <div class="discount-info-badge ${currentDiscountType}">
                    <i class="fas fa-${currentDiscountType === 'seniorPWD' ? 'id-card' : 'heart'}"></i>
                    ${discountName} Discount (${currentDiscount}%)
                </div>
            `;
        } else {
            discountInfoEl.innerHTML = '';
        }
    }
    
    // Use fragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    const today = new Date();
    
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
        
        const genericDisplay = item.generic ? `<small class="generic-cart">${item.generic}</small>` : '';
        
        let expiryWarning = '';
        if (item.expiringCount > 0) {
            const daysUntil = Math.ceil((item.earliestExpiry - today) / (1000 * 60 * 60 * 24));
            let warningClass = daysUntil <= 7 ? 'expiry-critical-text' : 'expiry-warning-text';
            expiryWarning = `<small class="${warningClass}">⚠️ ${item.expiringCount} expiring in ${daysUntil} days</small>`;
        }
        
        cartItem.innerHTML = `
            <div class="cart-item-info">
                <h4>${item.brand} ${discountableBadge}</h4>
                ${genericDisplay}
                <p>₱${item.price.toFixed(2)} x ${item.quantity}</p>
                <small class="${item.quantity > currentStock ? 'text-danger' : ''}">
                    Available: ${currentStock}
                </small>
                ${expiryWarning}
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
        fragment.appendChild(cartItem);
    });
    
    cartItems.appendChild(fragment);
    
    // Add event listeners
    document.querySelectorAll('.decrease-qty').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            if (cart[index].quantity > 1) {
                cart[index].quantity--;
            } else {
                cart.splice(index, 1);
            }
            updateCartDisplay();
        });
    });
    
    document.querySelectorAll('.increase-qty').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            const item = cart[index];
            const product = products.find(p => p.id === item.id);
            
            if (product && item.quantity < product.stock) {
                item.quantity++;
            } else {
                showNotification(`Only ${product?.stock} items available!`, 'error');
            }
            updateCartDisplay();
        });
    });
    
    document.querySelectorAll('.remove-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            cart.splice(index, 1);
            updateCartDisplay();
        });
    });
    
    // Calculate totals
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
    
    const discountAmount = discountableSubtotal * (currentDiscount / 100);
    const grandTotal = discountableSubtotal + nonDiscountableSubtotal - discountAmount;
    
    if (subtotalEl) subtotalEl.textContent = `₱${(discountableSubtotal + nonDiscountableSubtotal).toFixed(2)}`;
    if (grandTotalEl) grandTotalEl.textContent = `₱${grandTotal.toFixed(2)}`;
}

// ==================== DEDUCT STOCK WITH EXPIRY PRIORITY ====================

async function deductStockWithExpiryPriority(productId, quantityToDeduct) {
    try {
        const stockItemsQuery = query(
            collection(db, "stock_items"),
            where("productId", "==", productId),
            where("status", "==", "available")
        );
        
        const stockItemsSnapshot = await getDocs(stockItemsQuery);
        
        if (stockItemsSnapshot.empty) {
            return false;
        }
        
        // Convert to array and sort
        const stockItems = [];
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            let expiryDate = null;
            if (item.expiryDate) {
                expiryDate = item.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
            }
            
            stockItems.push({
                id: doc.id,
                ...item,
                expiryDate: expiryDate
            });
        });
        
        // Sort based on setting
        if (sellExpiringFirst) {
            stockItems.sort((a, b) => {
                if (a.expiryDate && b.expiryDate) return a.expiryDate - b.expiryDate;
                if (a.expiryDate && !b.expiryDate) return -1;
                if (!a.expiryDate && b.expiryDate) return 1;
                return 0;
            });
        } else {
            stockItems.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        }
        
        let remainingToDeduct = quantityToDeduct;
        const batch = writeBatch(db);
        
        for (const stockItem of stockItems) {
            if (remainingToDeduct <= 0) break;
            
            const stockItemRef = doc(db, "stock_items", stockItem.id);
            batch.update(stockItemRef, {
                status: 'sold',
                soldDate: Timestamp.now(),
                soldBy: loggedInUserId
            });
            
            remainingToDeduct--;
        }
        
        if (remainingToDeduct > 0) {
            return false;
        }
        
        await batch.commit();
        
        // Invalidate stock cache
        stockItemsCache = null;
        
        return true;
        
    } catch (error) {
        console.error("Error deducting stock:", error);
        throw error;
    }
}

// Checkout Functions
const checkoutBtn = document.getElementById('checkoutBtn');
if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
        if (cart.length === 0) {
            showNotification('Cart is empty!', 'error');
            return;
        }
        
        const expiringItems = cart.filter(item => item.expiringCount > 0);
        if (expiringItems.length > 0 && sellExpiringFirst) {
            if (!confirm('Sell Expiring First is enabled. These expiring items will be prioritized in the sale. Continue?')) return;
        } else if (expiringItems.length > 0) {
            if (!confirm('Some items in your cart have products that are expiring soon. Do you want to continue?')) return;
        }
        
        for (const item of cart) {
            const product = products.find(p => p.id === item.id);
            if (!product || product.stock < item.quantity) {
                showNotification(`Insufficient stock for ${item.brand}!`, 'error');
                return;
            }
        }
        
        document.getElementById('checkoutModal').style.display = 'block';
        updateCheckoutModal();
    });
}

const clearCartBtn = document.getElementById('clearCartBtn');
if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
        if (cart.length > 0 && confirm('Are you sure you want to clear the cart?')) {
            cart = [];
            currentDiscountType = 'none';
            currentDiscount = 0;
            const noneRadio = document.querySelector('input[name="discountType"][value="none"]');
            if (noneRadio) noneRadio.checked = true;
            updateCartDisplay();
            showNotification('Cart cleared', 'info');
        }
    });
}

function updateCheckoutModal() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutSubtotal = document.getElementById('checkoutSubtotal');
    const checkoutDiscount = document.getElementById('checkoutDiscount');
    const checkoutDiscountAmount = document.getElementById('checkoutDiscountAmount');
    const checkoutTotal = document.getElementById('checkoutTotal');
    const checkoutDiscountType = document.getElementById('checkoutDiscountType');
    
    if (!checkoutItems) return;
    
    let discountableSubtotal = 0;
    let nonDiscountableSubtotal = 0;
    checkoutItems.innerHTML = '';
    
    const fragment = document.createDocumentFragment();
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        if (item.discountable !== false) {
            discountableSubtotal += itemTotal;
        } else {
            nonDiscountableSubtotal += itemTotal;
        }
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checkout-item';
        
        let expiryNote = '';
        if (item.expiringCount > 0 && sellExpiringFirst) {
            expiryNote = '<small class="expiry-checkout-note">(Expiring items prioritized)</small>';
        }
        
        const displayName = item.generic ? `${item.brand} (${item.generic})` : item.brand;
        
        itemDiv.innerHTML = `
            <div class="checkout-product-info">
                <span class="product-name">${displayName}</span>
                <span class="product-detail">₱${item.price.toFixed(2)} x ${item.quantity}</span>
                ${expiryNote}
            </div>
            <span class="product-total">₱${itemTotal.toFixed(2)}</span>
        `;
        fragment.appendChild(itemDiv);
    });
    
    checkoutItems.appendChild(fragment);
    
    const discountPercentage = currentDiscount;
    const discountAmount = discountableSubtotal * (discountPercentage / 100);
    const subtotal = discountableSubtotal + nonDiscountableSubtotal;
    const grandTotal = subtotal - discountAmount;
    
    if (checkoutDiscountType) {
        if (currentDiscountType !== 'none') {
            const discountName = currentDiscountType === 'seniorPWD' ? 'Senior/PWD' : 'YAKAP';
            checkoutDiscountType.innerHTML = `
                <span class="discount-type-badge ${currentDiscountType}">
                    <i class="fas fa-${currentDiscountType === 'seniorPWD' ? 'id-card' : 'heart'}"></i>
                    ${discountName}
                </span>
            `;
        } else {
            checkoutDiscountType.innerHTML = '<span class="discount-type-badge">No Discount</span>';
        }
    }
    
    if (checkoutSubtotal) checkoutSubtotal.textContent = `₱${subtotal.toFixed(2)}`;
    if (checkoutDiscount) checkoutDiscount.textContent = discountPercentage > 0 ? `${discountPercentage}%` : '0%';
    if (checkoutDiscountAmount) checkoutDiscountAmount.textContent = `-₱${discountAmount.toFixed(2)}`;
    if (checkoutTotal) checkoutTotal.textContent = `₱${grandTotal.toFixed(2)}`;
    
    const paymentSection = document.querySelector('.payment-section');
    if (paymentSection) {
        const existingNote = document.getElementById('checkoutExpiryNote');
        if (existingNote) existingNote.remove();
        
        const expiryNote = document.createElement('div');
        expiryNote.id = 'checkoutExpiryNote';
        expiryNote.className = 'checkout-expiry-note';
        expiryNote.innerHTML = `
            <i class="fas fa-${sellExpiringFirst ? 'check-circle' : 'clock'}"></i>
            ${sellExpiringFirst ? 
                '<span>Sell Expiring First is <strong>ENABLED</strong> - Expiring items will be sold first</span>' : 
                '<span>Sell Expiring First is <strong>DISABLED</strong> - Normal FIFO ordering</span>'}
        `;
        paymentSection.insertBefore(expiryNote, paymentSection.firstChild);
    }
}

const amountTendered = document.getElementById('amountTendered');
if (amountTendered) {
    amountTendered.addEventListener('input', updateChangeAmount);
}

function updateChangeAmount() {
    const amount = parseFloat(document.getElementById('amountTendered').value) || 0;
    const total = parseFloat(document.getElementById('checkoutTotal').textContent.replace('₱', ''));
    const change = amount - total;
    document.getElementById('changeAmount').textContent = `₱${change >= 0 ? change.toFixed(2) : '0.00'}`;
}

const processPaymentBtn = document.getElementById('processPaymentBtn');
if (processPaymentBtn) {
    processPaymentBtn.addEventListener('click', async () => {
        if (isProcessingPayment) {
            showNotification('Payment is already being processed...', 'info');
            return;
        }
        
        const paymentMethod = document.getElementById('paymentMethod').value;
        const amount = parseFloat(document.getElementById('amountTendered').value) || 0;
        const total = parseFloat(document.getElementById('checkoutTotal').textContent.replace('₱', ''));
        
        if (amount < total) {
            showNotification('Insufficient amount!', 'error');
            return;
        }
        
        isProcessingPayment = true;
        processPaymentBtn.disabled = true;
        processPaymentBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        
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
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thirtyDaysFromNow = new Date(today);
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            
            const processedItems = cart.map(item => {
                let wasExpiring = false;
                
                if (item.expiringItems && item.expiringItems.length > 0) {
                    wasExpiring = true;
                } else if (item.earliestExpiry) {
                    const daysUntil = Math.ceil((item.earliestExpiry - today) / (1000 * 60 * 60 * 24));
                    wasExpiring = daysUntil <= 30;
                } else if (item.expiringCount > 0) {
                    wasExpiring = true;
                }
                
                const itemOriginalTotal = item.price * item.quantity;
                
                let itemDiscountedTotal = itemOriginalTotal;
                let itemDiscountAmount = 0;
                
                if (item.discountable !== false && discountPercentage > 0) {
                    const itemShare = itemOriginalTotal / discountableSubtotal;
                    itemDiscountAmount = discountAmount * itemShare;
                    itemDiscountedTotal = itemOriginalTotal - itemDiscountAmount;
                }
                
                return {
                    productId: item.id,
                    brand: item.brand,
                    generic: item.generic,
                    price: item.price,
                    quantity: item.quantity,
                    originalTotal: itemOriginalTotal,
                    discountAmount: itemDiscountAmount,
                    subtotal: itemDiscountedTotal,
                    discountable: item.discountable !== false,
                    wasExpiring: wasExpiring,
                    expiryCount: item.expiringCount || 0
                };
            });
            
            const saleData = {
                invoiceNumber: invoiceNumber,
                discountType: currentDiscountType,
                discountRate: discountPercentage,
                items: processedItems,
                subtotal: subtotal,
                discountableSubtotal: discountableSubtotal,
                nonDiscountableSubtotal: nonDiscountableSubtotal,
                discountPercentage: discountPercentage,
                discountAmount: discountAmount,
                total: totalAmount,
                paymentMethod: paymentMethod,
                amountTendered: amount,
                change: amount - totalAmount,
                date: Timestamp.now(),
                cashierId: loggedInUserId,
                cashierName: cashierName,
                sellExpiringFirst: sellExpiringFirst,
                hadExpiringItems: cart.some(item => item.expiringCount > 0)
            };
            
            // Save sale and update stock in parallel
            await Promise.all([
                addDoc(collection(db, "sales"), saleData),
                ...cart.map(item => updateProductStock(item))
            ]);
            
            let discountText = '';
            if (currentDiscountType === 'seniorPWD') {
                discountText = ' (Senior/PWD 20%)';
            } else if (currentDiscountType === 'yakap') {
                discountText = ' (YAKAP 30%)';
            }
            
            let modeText = sellExpiringFirst ? ' (FEFO - Expiring first)' : ' (FIFO)';
            await addDoc(collection(db, "activities"), {
                type: 'sale',
                description: `Sale #${invoiceNumber}: ${cart.length} items for ₱${totalAmount.toFixed(2)}${discountText}${modeText}`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
            
            showNotification(`Payment successful! Invoice #${invoiceNumber}${discountText}`, 'success');
            
            // Reset cart
            cart = [];
            currentDiscountType = 'none';
            currentDiscount = 0;
            const noneRadio = document.querySelector('input[name="discountType"][value="none"]');
            if (noneRadio) noneRadio.checked = true;
            updateCartDisplay();
            
            document.getElementById('checkoutModal').style.display = 'none';
            document.getElementById('amountTendered').value = '';
            document.getElementById('changeAmount').textContent = '₱0.00';
            
            const checkoutNote = document.getElementById('checkoutExpiryNote');
            if (checkoutNote) checkoutNote.remove();
            
        } catch (error) {
            console.error("Error processing payment:", error);
            showNotification('Error processing payment: ' + error.message, 'error');
        } finally {
            isProcessingPayment = false;
            processPaymentBtn.disabled = false;
            processPaymentBtn.textContent = 'Process Payment';
        }
    });
}

// Helper function to update product stock
async function updateProductStock(item) {
    const productRef = doc(db, "products", item.id);
    const productDoc = await getDoc(productRef);
    
    if (productDoc.exists()) {
        const currentStock = productDoc.data().stock;
        const newStock = currentStock - item.quantity;
        
        const deductionSuccess = await deductStockWithExpiryPriority(item.id, item.quantity);
        
        if (!deductionSuccess) {
            throw new Error(`Failed to deduct stock for ${item.brand}`);
        }
        
        await updateDoc(productRef, {
            stock: newStock,
            lastUpdated: Timestamp.now()
        });
        
        await addDoc(collection(db, "activities"), {
            type: 'stock',
            description: `${item.brand} stock updated: ${currentStock} → ${newStock} (${sellExpiringFirst ? 'FEFO' : 'FIFO'} mode)`,
            timestamp: Timestamp.now(),
            userId: loggedInUserId
        });
        
        if (newStock === 0) {
            await addDoc(collection(db, "activities"), {
                type: 'stock',
                description: `${item.brand} is now out of stock`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
        }
    }
}

async function generateInvoiceNumber() {
    try {
        const today = new Date();
        const year = today.getFullYear().toString().slice(-2);
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        
        const startOfDay = new Date(today);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);
        
        const salesQuery = query(
            collection(db, "sales"),
            where("date", ">=", Timestamp.fromDate(startOfDay)),
            where("date", "<=", Timestamp.fromDate(endOfDay))
        );
        
        const salesSnapshot = await getDocs(salesQuery);
        const count = salesSnapshot.size + 1;
        
        return `INV-${year}${month}${day}-${count.toString().padStart(4, '0')}`;
    } catch (error) {
        console.error("Error generating invoice number:", error);
        return `INV-${Date.now()}`;
    }
}

// Exchange Functions
const exchangeButton = document.getElementById('exchangeButton');
if (exchangeButton) {
    exchangeButton.addEventListener('click', () => {
        openExchangeModal();
    });
}

async function openExchangeModal(saleId = null) {
    const modal = document.getElementById('exchangeModal');
    if (!modal) {
        showNotification('Exchange feature is being set up', 'info');
        return;
    }
    
    document.getElementById('exchangeSearch').value = '';
    document.getElementById('exchangeSearchResults').innerHTML = '';
    document.getElementById('selectedExchangeInfo').style.display = 'none';
    
    await loadNewProducts();
    
    const saleInfoDiv = document.getElementById('exchangeSaleInfo');
    saleInfoDiv.innerHTML = '<h3>Search for a sale to process exchange</h3><p class="policy-note"><i class="fas fa-clock"></i> Exchanges only allowed within 24 hours of purchase</p>';
    
    modal.style.display = 'block';
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
                const option = document.createElement('option');
                option.value = doc.id;
                option.dataset.price = product.price || 0;
                option.dataset.brand = product.brand || product.name || 'Unnamed';
                option.dataset.generic = product.generic || '';
                option.dataset.stock = product.stock || 0;
                option.dataset.expiringCount = product.expiringCount || 0;
                
                const displayName = product.generic ? 
                    `${product.brand || product.name} (${product.generic})` : 
                    (product.brand || product.name);
                
                option.textContent = `${displayName} - ₱${(product.price || 0).toFixed(2)} (Stock: ${product.stock})`;
                select.appendChild(option);
            }
        });
    } catch (error) {
        console.error("Error loading new products:", error);
    }
}

// Utility Functions
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

function setupEventListeners() {
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').style.display = 'none';
        });
    });
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });
}

// Return function
window.returnSoldItem = async function(stockItemId) {
    if (!confirm('Return this item to available stock? This will undo the sale.')) return;
    
    try {
        const stockItemRef = doc(db, "stock_items", stockItemId);
        const stockItemDoc = await getDoc(stockItemRef);
        
        if (!stockItemDoc.exists()) {
            showNotification('Stock item not found', 'error');
            return;
        }
        
        const stockItem = stockItemDoc.data();
        
        if (stockItem.status !== 'sold') {
            showNotification('This item is not marked as sold', 'error');
            return;
        }
        
        const batch = writeBatch(db);
        
        batch.update(stockItemRef, {
            status: 'available',
            soldDate: null,
            soldBy: null,
            returnedAt: Timestamp.now(),
            returnedBy: loggedInUserId
        });
        
        if (stockItem.productId) {
            const availableStockQuery = query(
                collection(db, "stock_items"),
                where("productId", "==", stockItem.productId),
                where("status", "==", "available")
            );
            const availableStockSnapshot = await getDocs(availableStockQuery);
            
            const productRef = doc(db, "products", stockItem.productId);
            const productDoc = await getDoc(productRef);
            
            if (productDoc.exists()) {
                batch.update(productRef, {
                    stock: availableStockSnapshot.size,
                    lastUpdated: Timestamp.now()
                });
            }
        }
        
        const returnRef = doc(collection(db, "returns"));
        batch.set(returnRef, {
            stockItemId: stockItemId,
            productId: stockItem.productId,
            productName: stockItem.productName,
            serialNumber: stockItem.serialNumber,
            wasExpiring: stockItem.expiryDate ? true : false,
            expiryDate: stockItem.expiryDate || null,
            date: Timestamp.now(),
            returnedBy: loggedInUserId
        });
        
        await batch.commit();
        
        // Invalidate stock cache
        stockItemsCache = null;
        
        showNotification('Item returned to inventory successfully', 'success');
        
        if (typeof loadInventory === 'function') {
            loadInventory();
        }
        
        const modal = document.getElementById('stockItemsModal');
        if (modal && modal.style.display === 'block') {
            modal.style.display = 'none';
        }
        
    } catch (error) {
        console.error("Error returning item:", error);
        showNotification('Error returning item: ' + error.message, 'error');
    }
};