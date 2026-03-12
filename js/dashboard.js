import { auth, db, doc, getDoc, collection, getDocs, query, where, orderBy, Timestamp, limit } from './firebase-config.js';
import { fetchUserData } from './auth.js';

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

// Cache for dashboard data
let dashboardCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 seconds cache

// Notification state
let notificationBadge = null;
let notificationList = null;
let notificationPopup = null;
let notificationInterval = null;
let lastNotificationCheck = 0;
let lastPopupDismissed = 0;
const NOTIFICATION_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const POPUP_DISMISS_DURATION = 60 * 60 * 1000; // 1 hour before showing popup again

// Helper function to determine low stock threshold based on category
function getLowStockThreshold(category) {
    const categoryLower = (category || '').toLowerCase();
    
    // Updated category thresholds matching inventory.js
    if (categoryLower === 'rx' || categoryLower === 'rx medicine') {
        return 50; // RX Medicines - less than 50 is low stock
    } else if (categoryLower === 'over the counter' || categoryLower === 'otc' || categoryLower === 'over-the-counter') {
        return 30; // Over the Counter - less than 30 is low stock
    } else if (categoryLower === 'food' || categoryLower === 'foods' || categoryLower === 'food items') {
        return 5; // Food items - less than 5 is low stock
    } else if (categoryLower === 'general merchandise' || categoryLower === 'merchandise' || categoryLower === 'general') {
        return 2; // General Merchandise - less than 2 is low stock
    } else {
        return 10; // Default threshold for other categories
    }
}

// Helper function to determine if stock is low
function isLowStock(stock, category) {
    if (stock === 0) return false; // Out of stock is handled separately
    const threshold = getLowStockThreshold(category);
    return stock < threshold;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeDashboard();
    setupEventListeners();
    initializeNotifications();
});

async function initializeDashboard() {
    await loadUserData();
    updateDateTime();
    await loadDashboardStats();
    setupSidebar();
    setupNotificationSystem();
}

async function loadUserData() {
    const userData = await fetchUserData(loggedInUserId);
    if (userData) {
        const fullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email?.split('@')[0] || 'User';
        updateUserDisplay(fullName, userData.email);
    }
}

function updateUserDisplay(fullName, email) {
    const sidebarNameElement = document.getElementById('sidebarUserName');
    const sidebarEmailElement = document.getElementById('sidebarUserEmail');
    const welcomeNameElement = document.getElementById('welcomeUserName');
    
    if (sidebarNameElement) sidebarNameElement.textContent = fullName;
    if (sidebarEmailElement) sidebarEmailElement.textContent = email || '';
    if (welcomeNameElement) welcomeNameElement.textContent = fullName.split(' ')[0] || 'User';
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
    // Create notification elements
    createNotificationElements();
    
    // Check for notifications immediately
    checkNotifications();
    
    // Set up interval to check every hour
    if (notificationInterval) {
        clearInterval(notificationInterval);
    }
    notificationInterval = setInterval(checkNotifications, NOTIFICATION_CHECK_INTERVAL);
}

function createNotificationElements() {
    // Get existing notification container
    const notificationContainer = document.querySelector('.notification');
    if (!notificationContainer) return;
    
    // Redesign the notification logo
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
            
            /* Custom scrollbar for notifications */
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
    
    // Check if popup was dismissed within the last hour
    const now = Date.now();
    if (now - lastPopupDismissed < POPUP_DISMISS_DURATION) {
        console.log("Popup was recently dismissed, skipping auto-show");
        return;
    }
    
    notificationPopup.style.display = 'block';
    loadNotificationDetails();
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
        if (notificationPopup && notificationPopup.style.display === 'block') {
            notificationPopup.style.display = 'none';
        }
    }, 10000);
}

async function checkNotifications(forceRefresh = false) {
    try {
        console.log("Checking for notifications...");
        
        // Get all products and stock items
        const [productsSnapshot, stockItemsSnapshot] = await Promise.all([
            getDocs(collection(db, "products")),
            getDocs(collection(db, "stock_items"))
        ]);
        
        // Create maps for quick lookup
        const productsMap = new Map();
        productsSnapshot.forEach(doc => {
            productsMap.set(doc.id, doc.data());
        });
        
        // Check for expiring items
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const threeDaysFromNow = new Date(today);
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
        
        const sevenDaysFromNow = new Date(today);
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        
        let expiringUrgent = 0;
        let expiringWarning = 0;
        let lowStockCount = 0;
        
        // Track unique products for notifications
        const expiringProducts = []; // Array for all expiring items
        const lowStockProducts = []; // Array for all low stock items
        
        // Process stock items for expiry
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            if (item.expiryDate && item.status === 'available') {
                const expiryDate = item.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
                
                // Get product name
                let productName = item.productName || 'Unknown';
                let productBrand = '';
                if (item.productId && productsMap.has(item.productId)) {
                    const product = productsMap.get(item.productId);
                    productBrand = product.brand || product.name || '';
                    productName = productBrand || productName;
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
                    threshold: threshold,
                    category: product.category
                });
            }
        });
        
        // Sort notifications by urgency
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
            
            // Change color based on urgency
            if (expiringUrgent > 0) {
                notificationBadge.style.background = '#e74c3c';
                notificationBadge.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px #e74c3c';
            } else if (expiringWarning > 0 || lowStockCount > 0) {
                notificationBadge.style.background = '#f39c12';
                notificationBadge.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px #f39c12';
            }
            
            // Add pulse animation for urgent notifications
            if (expiringUrgent > 0) {
                notificationBadge.style.animation = 'pulse 2s infinite';
                
                // Add pulse animation keyframes
                const style = document.createElement('style');
                style.textContent = `
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
            }
        }
        
        // Store notification data for later display
        window.notificationData = {
            expiringUrgent,
            expiringWarning,
            lowStockCount,
            expiringProducts,
            lowStockProducts,
            lastCheck: new Date()
        };
        
        // Update last check time
        const lastCheckSpan = document.getElementById('lastNotificationCheck');
        if (lastCheckSpan) {
            lastCheckSpan.textContent = formatTimeAgo(new Date());
        }
        
        console.log("Notification check complete:", window.notificationData);
        
        // Show popup if there are notifications
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
        // Urgent expiring items section
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
        
        // Warning expiring items section
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
        
        // Low stock items section
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

// ==================== DASHBOARD FUNCTIONS ====================

async function loadDashboardStats(forceRefresh = false) {
    try {
        // Show loading indicators
        document.getElementById('totalProducts').textContent = '...';
        document.getElementById('lowStockCount').textContent = '...';
        document.getElementById('todaySales').textContent = '₱...';
        document.getElementById('expiringCount').textContent = '...';
        
        // Check cache
        const now = Date.now();
        if (!forceRefresh && dashboardCache && (now - lastFetchTime) < CACHE_DURATION) {
            updateDashboardUI(dashboardCache);
            await loadRecentActivities();
            return;
        }
        
        // Use Promise.all for parallel fetching
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const [productsSnapshot, stockItemsSnapshot, salesSnapshot] = await Promise.all([
            getDocs(collection(db, "products")),
            getDocs(query(collection(db, "stock_items"), where("status", "==", "available"))),
            getDocs(query(
                collection(db, "sales"),
                where("date", ">=", Timestamp.fromDate(today)),
                where("date", "<", Timestamp.fromDate(tomorrow))
            ))
        ]);
        
        // Process stock items map
        const availableStockMap = new Map();
        const productsMap = new Map();
        
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            const productId = item.productId;
            if (productId) {
                availableStockMap.set(productId, (availableStockMap.get(productId) || 0) + 1);
            }
        });
        
        // Process products map
        productsSnapshot.forEach(doc => {
            productsMap.set(doc.id, doc.data());
        });
        
        // Calculate low stock count using updated thresholds
        let lowStock = 0;
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            const productId = doc.id;
            const actualStock = availableStockMap.get(productId) || 0;
            
            // Only count if actualStock > 0 AND it's low stock according to category threshold
            if (actualStock > 0 && isLowStock(actualStock, product.category)) {
                lowStock++;
            }
        });
        
        // Calculate total sales
        let totalSales = 0;
        salesSnapshot.forEach(doc => totalSales += doc.data().total || 0);
        
        // Calculate expiring count
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        thirtyDaysFromNow.setHours(0, 0, 0, 0);
        
        let expiringCount = 0;
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            if (item.expiryDate) {
                const expiryDate = item.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
                
                if (expiryDate <= thirtyDaysFromNow) {
                    expiringCount++;
                }
            }
        });
        
        // Create cache object
        dashboardCache = {
            totalProducts: productsSnapshot.size,
            lowStockCount: lowStock,
            todaySales: totalSales,
            expiringCount: expiringCount
        };
        lastFetchTime = now;
        
        // Update UI
        updateDashboardUI(dashboardCache);
        
        // Make cards clickable
        setupClickableCards();
        
        // Load recent activities (can be slower, load after)
        setTimeout(() => loadRecentActivities(), 100);
        
        // Check notifications in background
        setTimeout(() => checkNotifications(), 500);
        
    } catch (error) {
        console.error("Error loading dashboard stats:", error);
        // Show error but don't break the UI
        document.getElementById('totalProducts').textContent = '0';
        document.getElementById('lowStockCount').textContent = '0';
        document.getElementById('todaySales').textContent = '₱0.00';
        document.getElementById('expiringCount').textContent = '0';
    }
}

function updateDashboardUI(data) {
    document.getElementById('totalProducts').textContent = data.totalProducts;
    document.getElementById('lowStockCount').textContent = data.lowStockCount;
    document.getElementById('todaySales').textContent = `₱${data.todaySales.toFixed(2)}`;
    document.getElementById('expiringCount').textContent = data.expiringCount;
}

function setupClickableCards() {
    const statCards = document.querySelectorAll('.stat-card');
    if (statCards.length >= 4) {
        // Total Products card - click to go to inventory
        statCards[0].style.cursor = 'pointer';
        statCards[0].onclick = () => window.location.href = 'inventory.html';
        
        // Low Stock card (2nd card)
        statCards[1].style.cursor = 'pointer';
        statCards[1].onclick = () => openLowStockModal();
        
        // Today's Sales card (3rd card)
        statCards[2].style.cursor = 'pointer';
        statCards[2].onclick = () => openTodaySalesModal();
        
        // Expiring Soon card (4th card)
        statCards[3].style.cursor = 'pointer';
        statCards[3].onclick = () => openExpiringModal();
    }
}

// ==================== EXPIRING ITEMS MODAL ====================

async function openExpiringModal() {
    try {
        // Create modal if it doesn't exist
        if (!document.getElementById('expiringModal')) {
            createExpiringModal();
        }
        
        const modal = document.getElementById('expiringModal');
        const modalBody = document.getElementById('expiringModalBody');
        
        modalBody.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading expiring items...</p></div>';
        modal.style.display = 'block';
        
        // Use Promise.all for parallel fetching
        const [stockItemsSnapshot, productsSnapshot] = await Promise.all([
            getDocs(collection(db, "stock_items")),
            getDocs(collection(db, "products"))
        ]);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        thirtyDaysFromNow.setHours(23, 59, 59, 999);
        
        // Create products map
        const productsMap = new Map();
        productsSnapshot.forEach(doc => {
            productsMap.set(doc.id, doc.data());
        });
        
        // Process expiring items in one pass
        const expiringItems = [];
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            if (item.expiryDate && item.status === 'available') {
                const expiryDate = item.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
                
                if (expiryDate <= thirtyDaysFromNow) {
                    let productBrand = '';
                    let productGeneric = '';
                    let productName = item.productName || 'Unknown Product';
                    
                    if (item.productId && productsMap.has(item.productId)) {
                        const product = productsMap.get(item.productId);
                        productBrand = product.brand || '';
                        productGeneric = product.generic || '';
                        if (productBrand) {
                            productName = productBrand;
                        }
                    }
                    
                    expiringItems.push({
                        id: doc.id,
                        ...item,
                        productName: productName,
                        productBrand: productBrand,
                        productGeneric: productGeneric,
                        expiryDate: expiryDate
                    });
                }
            }
        });
        
        // Sort and group
        expiringItems.sort((a, b) => a.expiryDate - b.expiryDate);
        
        const groupedByProduct = {};
        expiringItems.forEach(item => {
            const displayName = item.productBrand || item.productName || 'Unknown Product';
            if (!groupedByProduct[displayName]) {
                groupedByProduct[displayName] = {
                    items: [],
                    count: 0,
                    productId: item.productId,
                    brand: item.productBrand,
                    generic: item.productGeneric
                };
            }
            groupedByProduct[displayName].items.push(item);
            groupedByProduct[displayName].count++;
        });
        
        // Calculate stats
        const criticalCount = expiringItems.filter(item => {
            const daysUntil = Math.ceil((item.expiryDate - today) / (1000 * 60 * 60 * 24));
            return daysUntil <= 7;
        }).length;
        
        let html = '';
        
        if (expiringItems.length === 0) {
            html = `
                <div class="modal-empty">
                    <i class="fas fa-check-circle" style="font-size: 48px; color: #27ae60;"></i>
                    <p>No items expiring soon!</p>
                    <p style="font-size: 14px; color: #7f8c8d; margin-top: 10px;">All items have expiry dates beyond 30 days.</p>
                </div>
            `;
        } else {
            html = `
                <div class="modal-stats-summary">
                    <div class="modal-stat">
                        <span class="modal-stat-label">Total Expiring:</span>
                        <span class="modal-stat-value">${expiringItems.length}</span>
                    </div>
                    <div class="modal-stat">
                        <span class="modal-stat-label">Critical (≤7 days):</span>
                        <span class="modal-stat-value critical">${criticalCount}</span>
                    </div>
                </div>
                <div class="modal-items-container">
            `;
            
            for (const [productName, data] of Object.entries(groupedByProduct)) {
                const earliestExpiry = new Date(Math.min(...data.items.map(i => i.expiryDate.getTime())));
                const daysUntilEarliest = Math.ceil((earliestExpiry - today) / (1000 * 60 * 60 * 24));
                
                let statusClass = 'warning-stock';
                let statusText = '';
                
                if (daysUntilEarliest < 0) {
                    statusClass = 'critical-stock';
                    statusText = 'EXPIRED';
                } else if (daysUntilEarliest <= 7) {
                    statusClass = 'critical-stock';
                    statusText = `CRITICAL (${daysUntilEarliest} days)`;
                } else {
                    statusText = `${daysUntilEarliest} days remaining`;
                }
                
                const displayName = data.generic ? `${productName} (${data.generic})` : productName;
                const safeProductId = productName.replace(/[^a-zA-Z0-9]/g, '');
                
                html += `
                    <div class="modal-item product-group" onclick="toggleExpiringDetails('${safeProductId}')">
                        <div class="modal-item-info">
                            <div class="modal-item-name">
                                <strong>${displayName}</strong>
                                <span class="item-count">${data.count} items</span>
                            </div>
                            <div class="modal-item-details">
                                <span class="item-expiry ${statusClass}">
                                    <i class="fas fa-clock"></i> Earliest: ${earliestExpiry.toLocaleDateString()} (${statusText})
                                </span>
                            </div>
                        </div>
                        <div class="modal-item-stock ${statusClass}">
                            <span class="stock-badge">${data.count} expiring</span>
                            <button class="btn-icon-small" onclick="event.stopPropagation(); toggleExpiringDetails('${safeProductId}')" title="Toggle Details">
                                <i class="fas fa-chevron-down"></i>
                            </button>
                        </div>
                    </div>
                    <div class="expiring-subitems" id="subitems-${safeProductId}" style="display: none;">
                `;
                
                data.items.forEach(item => {
                    const daysUntil = Math.ceil((item.expiryDate - today) / (1000 * 60 * 60 * 24));
                    let itemStatus = '';
                    if (daysUntil < 0) itemStatus = 'expired';
                    else if (daysUntil <= 7) itemStatus = 'critical';
                    else itemStatus = 'warning';
                    
                    html += `
                        <div class="expiring-subitem ${itemStatus}">
                            <div><i class="fas fa-barcode"></i> Serial: ${item.serialNumber || 'N/A'}</div>
                            <div><i class="fas fa-calendar-alt"></i> Expires: ${item.expiryDate.toLocaleDateString()} (${daysUntil} days)</div>
                            <div><i class="fas fa-tag"></i> Batch: ${item.batchNumber || 'N/A'}</div>
                        </div>
                    `;
                });
                
                html += `</div>`;
            }
            
            html += `</div>`;
        }
        
        html += `
            <div class="modal-footer">
                <button class="btn-primary" onclick="window.location.href='inventory.html'">
                    <i class="fas fa-pills"></i> Go to Inventory
                </button>
            </div>
        `;
        
        modalBody.innerHTML = html;
        
    } catch (error) {
        console.error("Error loading expiring items:", error);
        const modalBody = document.getElementById('expiringModalBody');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="modal-error">
                    <i class="fas fa-exclamation-circle" style="font-size: 48px; color: #e74c3c;"></i>
                    <p>Error loading expiring items</p>
                    <p style="font-size: 12px; color: #7f8c8d; margin-top: 10px;">${error.message}</p>
                    <button class="btn-primary" onclick="closeModal('expiringModal')" style="margin-top: 20px;">Close</button>
                </div>
            `;
        }
    }
}

function createExpiringModal() {
    if (document.getElementById('expiringModal')) return;
    
    const modalHTML = `
        <div id="expiringModal" class="modal">
            <div class="modal-content dashboard-modal">
                <div class="modal-header">
                    <h2><i class="fas fa-clock" style="color: #f39c12;"></i> Items Expiring Soon (≤30 days)</h2>
                    <span class="close" onclick="closeModal('expiringModal')">&times;</span>
                </div>
                <div class="modal-body" id="expiringModalBody"></div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// Toggle function for expiring details
window.toggleExpiringDetails = function(productId) {
    const subitems = document.getElementById(`subitems-${productId}`);
    if (subitems) {
        subitems.style.display = subitems.style.display === 'none' ? 'block' : 'none';
    }
};

// ==================== LOW STOCK MODAL ====================

async function openLowStockModal() {
    try {
        if (!document.getElementById('lowStockModal')) {
            createLowStockModal();
        }
        
        const modal = document.getElementById('lowStockModal');
        const modalBody = document.getElementById('lowStockModalBody');
        
        modalBody.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading low stock products...</p></div>';
        modal.style.display = 'block';
        
        // Use Promise.all for parallel fetching
        const [productsSnapshot, stockItemsSnapshot] = await Promise.all([
            getDocs(collection(db, "products")),
            getDocs(query(collection(db, "stock_items"), where("status", "==", "available")))
        ]);
        
        // Create available stock map
        const availableStockMap = new Map();
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            const productId = item.productId;
            if (productId) {
                availableStockMap.set(productId, (availableStockMap.get(productId) || 0) + 1);
            }
        });
        
        const lowStockProducts = [];
        
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            const productId = doc.id;
            const actualStock = availableStockMap.get(productId) || 0;
            
            // Only include if actualStock > 0 AND it's low stock according to category threshold
            if (actualStock > 0 && isLowStock(actualStock, product.category)) {
                lowStockProducts.push({ 
                    id: doc.id, 
                    ...product,
                    actualStock: actualStock
                });
            }
        });
        
        lowStockProducts.sort((a, b) => a.actualStock - b.actualStock);
        
        if (lowStockProducts.length === 0) {
            modalBody.innerHTML = '<div class="modal-empty"><i class="fas fa-check-circle" style="font-size: 48px; color: #27ae60;"></i><p>No low stock products found!</p></div>';
            return;
        }
        
        // Calculate critical count based on new thresholds
        const criticalCount = lowStockProducts.filter(p => {
            // Products with stock less than 20% of threshold are critical
            const threshold = getLowStockThreshold(p.category);
            return p.actualStock < (threshold * 0.2);
        }).length;
        
        let html = `
            <div class="modal-stats-summary">
                <div class="modal-stat">
                    <span class="modal-stat-label">Total Low Stock:</span>
                    <span class="modal-stat-value">${lowStockProducts.length}</span>
                </div>
                <div class="modal-stat">
                    <span class="modal-stat-label">Critical Stock:</span>
                    <span class="modal-stat-value critical">${criticalCount}</span>
                </div>
            </div>
            <div class="modal-items-container">
        `;
        
        lowStockProducts.forEach(product => {
            const threshold = getLowStockThreshold(product.category);
            const stockClass = product.actualStock < (threshold * 0.2) ? 'critical-stock' : 'warning-stock';
            
            const productName = product.brand || product.name || 'Unnamed Product';
            const genericDisplay = product.generic ? ` (${product.generic})` : '';
            const displayName = productName + genericDisplay;
            
            // Format category for display
            let displayCategory = product.category || 'N/A';
            if (displayCategory === 'rx') displayCategory = 'RX';
            else if (displayCategory === 'over the counter') displayCategory = 'Over the Counter';
            else if (displayCategory === 'food') displayCategory = 'Food';
            else if (displayCategory === 'general merchandise') displayCategory = 'General Merchandise';
            
            html += `
                <div class="modal-item">
                    <div class="modal-item-info">
                        <div class="modal-item-name">
                            <strong>${displayName}</strong>
                            ${product.code ? `<span class="item-code">${product.code}</span>` : ''}
                        </div>
                        <div class="modal-item-details">
                            <span><i class="fas fa-tag"></i> ${displayCategory}</span>
                            <span><i class="fas fa-dollar-sign"></i> ₱${(product.price || 0).toFixed(2)}</span>
                            <span class="threshold-info" title="Low stock threshold: less than ${threshold} units">⚠️ Threshold: ${threshold}</span>
                        </div>
                    </div>
                    <div class="modal-item-stock ${stockClass}">
                        <span class="stock-badge">Stock: ${product.actualStock}</span>
                        <button class="btn-icon-small" onclick="window.location.href='inventory.html'" title="Restock">
                            <i class="fas fa-plus-circle"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        
        html += `</div>`;
        modalBody.innerHTML = html;
        
    } catch (error) {
        console.error("Error loading low stock:", error);
        const modalBody = document.getElementById('lowStockModalBody');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="modal-error">
                    <i class="fas fa-exclamation-circle" style="font-size: 48px; color: #e74c3c;"></i>
                    <p>Error loading low stock products</p>
                    <p style="font-size: 12px; color: #7f8c8d; margin-top: 10px;">${error.message}</p>
                    <button class="btn-primary" onclick="closeModal('lowStockModal')" style="margin-top: 20px;">Close</button>
                </div>
            `;
        }
    }
}

function createLowStockModal() {
    const modalHTML = `
        <div id="lowStockModal" class="modal">
            <div class="modal-content dashboard-modal">
                <div class="modal-header">
                    <h2><i class="fas fa-exclamation-triangle" style="color: #f39c12;"></i> Low Stock Products</h2>
                    <span class="close" onclick="closeModal('lowStockModal')">&times;</span>
                </div>
                <div class="modal-body" id="lowStockModalBody"></div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// ==================== TODAY'S SALES MODAL ====================

async function openTodaySalesModal() {
    try {
        if (!document.getElementById('todaySalesModal')) {
            createTodaySalesModal();
        }
        
        const modal = document.getElementById('todaySalesModal');
        const modalBody = document.getElementById('todaySalesModalBody');
        
        modalBody.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading today\'s sales...</p></div>';
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
        
        const salesSnapshot = await getDocs(salesQuery);
        
        if (salesSnapshot.empty) {
            modalBody.innerHTML = '<div class="modal-empty"><i class="fas fa-shopping-cart" style="font-size: 48px; color: #3498db;"></i><p>No sales today yet!</p></div>';
            return;
        }
        
        let totalSales = 0;
        const transactions = [];
        
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            totalSales += sale.total || 0;
            transactions.push({ id: doc.id, ...sale });
        });
        
        let html = `
            <div class="modal-stats-summary">
                <div class="modal-stat">
                    <span class="modal-stat-label">Transactions:</span>
                    <span class="modal-stat-value">${transactions.length}</span>
                </div>
                <div class="modal-stat highlight">
                    <span class="modal-stat-label">Total Sales:</span>
                    <span class="modal-stat-value">₱${totalSales.toFixed(2)}</span>
                </div>
            </div>
            <div class="modal-items-container">
        `;
        
        transactions.forEach(sale => {
            const saleDate = sale.date?.toDate?.() || new Date();
            const timeStr = saleDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            
            html += `
                <div class="modal-item sale-item" onclick="viewSaleDetails('${sale.id}')">
                    <div class="modal-item-info">
                        <div class="modal-item-name">
                            <strong>${sale.invoiceNumber || '#' + sale.id.slice(-8)}</strong>
                            <span class="sale-time">${timeStr}</span>
                        </div>
                        <div class="modal-item-details">
                            <span><i class="fas fa-user"></i> ${sale.cashierName || 'Unknown'}</span>
                            <span><i class="fas fa-credit-card"></i> ${sale.paymentMethod || 'Cash'}</span>
                        </div>
                    </div>
                    <div class="modal-item-amount">
                        <span class="sale-amount">₱${(sale.total || 0).toFixed(2)}</span>
                    </div>
                </div>
            `;
        });
        
        html += `</div>`;
        modalBody.innerHTML = html;
        
    } catch (error) {
        console.error("Error loading today's sales:", error);
    }
}

function createTodaySalesModal() {
    const modalHTML = `
        <div id="todaySalesModal" class="modal">
            <div class="modal-content dashboard-modal">
                <div class="modal-header">
                    <h2><i class="fas fa-chart-line" style="color: #27ae60;"></i> Today's Sales</h2>
                    <span class="close" onclick="closeModal('todaySalesModal')">&times;</span>
                </div>
                <div class="modal-body" id="todaySalesModalBody"></div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// ==================== RECENT ACTIVITIES ====================

async function loadRecentActivities() {
    try {
        const activitiesList = document.getElementById('recentActivities');
        if (!activitiesList) return;
        
        const activitiesQuery = query(
            collection(db, "activities"),
            orderBy("timestamp", "desc"),
            limit(10)
        );
        
        const activitiesSnapshot = await getDocs(activitiesQuery);
        
        activitiesList.innerHTML = '';
        
        if (activitiesSnapshot.empty) {
            activitiesList.innerHTML = '<p class="no-data">No recent activities</p>';
            return;
        }
        
        const fragment = document.createDocumentFragment();
        
        activitiesSnapshot.forEach(doc => {
            const activity = doc.data();
            const activityElement = document.createElement('div');
            activityElement.className = 'activity-item';
            
            const timestamp = activity.timestamp?.toDate?.() || new Date();
            const timeAgo = getTimeAgo(timestamp);
            
            activityElement.innerHTML = `
                <div class="activity-icon"><i class="fas ${getActivityIcon(activity.type)}"></i></div>
                <div class="activity-details">
                    <p>${activity.description || 'System activity'}</p>
                    <small>${timeAgo}</small>
                </div>
            `;
            fragment.appendChild(activityElement);
        });
        
        activitiesList.appendChild(fragment);
        
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
    return timestamp.toLocaleDateString();
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

// ==================== SALE DETAILS ====================

window.viewSaleDetails = async function(saleId) {
    try {
        if (!document.getElementById('saleDetailsModal')) {
            createSaleDetailsModal();
        }
        
        const modal = document.getElementById('saleDetailsModal');
        const panelBody = document.getElementById('salePanelBody');
        
        panelBody.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading sale details...</p></div>';
        modal.style.display = 'block';
        
        const saleRef = doc(db, "sales", saleId);
        const saleDoc = await getDoc(saleRef);
        
        if (!saleDoc.exists()) {
            panelBody.innerHTML = '<div class="modal-error">Sale not found</div>';
            return;
        }
        
        const sale = saleDoc.data();
        const saleDate = sale.date?.toDate?.() || new Date();
        const formattedDate = saleDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit'
        });
        
        let itemsHtml = '';
        sale.items.forEach(item => {
            const displayName = item.brand || item.name || 'Unknown';
            const genericDisplay = item.generic ? ` (${item.generic})` : '';
            itemsHtml += `
                <div class="item-row">
                    <div class="item-info">
                        <div class="item-name">${displayName}${genericDisplay}</div>
                        <div class="item-meta">
                            <span>Qty: ${item.quantity}</span>
                        </div>
                    </div>
                    <div class="item-price">₱${(item.price * item.quantity).toFixed(2)}</div>
                </div>`;
        });
        
        panelBody.innerHTML = `
            <div class="invoice-card">
                <div class="invoice-header">
                    <div class="invoice-number">${sale.invoiceNumber || 'N/A'}</div>
                    <div class="payment-badge">PAID</div>
                </div>
                <div class="invoice-details">
                    <div class="detail-row"><i class="fas fa-calendar-alt"></i> <strong>Date:</strong> <span>${formattedDate}</span></div>
                    <div class="detail-row"><i class="fas fa-user"></i> <strong>Cashier:</strong> <span>${sale.cashierName || 'Unknown'}</span></div>
                </div>
            </div>
            
            <div class="items-card">
                <div class="items-header"><i class="fas fa-shopping-cart"></i><h3>Items Purchased</h3></div>
                <div class="item-list">${itemsHtml}</div>
            </div>
            
            <div class="summary-card">
                <div class="summary-row"><span class="summary-label">Subtotal:</span><span class="summary-value">₱${sale.subtotal.toFixed(2)}</span></div>
                ${sale.discountPercentage > 0 ? `
                <div class="summary-row"><span class="summary-label">Discount (${sale.discountPercentage}%):</span><span class="summary-value discount">-₱${sale.discountAmount.toFixed(2)}</span></div>
                ` : ''}
                <div class="summary-row total-row"><span class="total-label">Total:</span><span class="total-value">₱${sale.total.toFixed(2)}</span></div>
            </div>
            
            <div class="payment-card">
                <div class="payment-header"><i class="fas fa-credit-card"></i><h3>Payment Details</h3></div>
                <div class="payment-grid">
                    <div class="payment-item"><div class="label">Method</div><div class="value">${sale.paymentMethod || 'Cash'}</div></div>
                    <div class="payment-item"><div class="label">Tendered</div><div class="value cash">₱${sale.amountTendered.toFixed(2)}</div></div>
                    <div class="payment-item"><div class="label">Change</div><div class="value change">₱${sale.change.toFixed(2)}</div></div>
                </div>
            </div>
            
            <div class="panel-actions">
                <button class="panel-btn close-btn" onclick="closeModal('saleDetailsModal')"><i class="fas fa-times"></i> Close</button>
            </div>
        `;
        
    } catch (error) {
        console.error("Error viewing sale details:", error);
    }
};

function createSaleDetailsModal() {
    const modalHTML = `
        <div id="saleDetailsModal" class="modal">
            <div class="modal-content sale-panel">
                <div class="sale-panel-header">
                    <h2><i class="fas fa-receipt"></i> Sale Details</h2>
                    <span class="close" onclick="closeModal('saleDetailsModal')">&times;</span>
                </div>
                <div class="sale-panel-body" id="salePanelBody"></div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// ==================== UTILITY FUNCTIONS ====================

window.closeModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
};

function setupEventListeners() {
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });
}

// Make functions globally available
window.openExpiringModal = openExpiringModal;
window.openLowStockModal = openLowStockModal;
window.openTodaySalesModal = openTodaySalesModal;
window.viewSaleDetails = viewSaleDetails;
window.closeModal = closeModal;
window.toggleExpiringDetails = toggleExpiringDetails;

// Optional: Auto-refresh dashboard every 5 minutes
setInterval(() => {
    loadDashboardStats(true);
}, 300000); // 5 minutes