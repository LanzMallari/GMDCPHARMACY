import { db, collection, addDoc, getDocs, getDoc, query, where, orderBy, updateDoc, deleteDoc, doc, Timestamp, writeBatch } from './firebase-config.js';
import { fetchUserData } from './auth.js';

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

// Cache for stock items to reduce Firestore reads
let stockItemsCache = null;
let productsCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 seconds cache

// Notification state
let notificationBadge = null;
let notificationPopup = null;
let notificationInterval = null;
let lastPopupDismissed = 0;
const NOTIFICATION_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const POPUP_DISMISS_DURATION = 60 * 60 * 1000; // 1 hour

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeInventory();
    setupEventListeners();
    initializeNotifications();
});

async function initializeInventory() {
    await loadUserData();
    updateDateTime();
    await loadInventory();
    setupSidebar();
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
        
        // Add animation keyframes (same as in pos.js)
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

// Helper function to determine low stock threshold based on category
function getLowStockThreshold(category) {
    const categoryLower = (category || '').toLowerCase();
    
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

// Optimized function to fetch stock items with caching
async function getStockItemsWithCache(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && stockItemsCache && (now - lastFetchTime) < CACHE_DURATION) {
        return stockItemsCache;
    }
    
    const snapshot = await getDocs(collection(db, "stock_items"));
    stockItemsCache = snapshot;
    lastFetchTime = now;
    return snapshot;
}

// Optimized function to fetch products with caching
async function getProductsWithCache(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && productsCache && (now - lastFetchTime) < CACHE_DURATION) {
        return productsCache;
    }
    
    const snapshot = await getDocs(collection(db, "products"));
    productsCache = snapshot;
    lastFetchTime = now;
    return snapshot;
}

// ==================== INVENTORY FUNCTIONS ====================
async function loadInventory(forceRefresh = false) {
    try {
        console.log("%c🔍 LOADING INVENTORY WITH EXPIRY CHECK", "color: blue; font-size: 14px; font-weight: bold");
        
        // Show loading indicator
        const tableBody = document.getElementById('inventoryTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '<tr><td colspan="8" class="loading">Loading inventory...</td></tr>';
        
        // Use Promise.all for parallel fetching
        const [productsSnapshot, stockItemsSnapshot] = await Promise.all([
            getProductsWithCache(forceRefresh),
            getDocs(collection(db, "stock_items"))
        ]);
        
        tableBody.innerHTML = '';
        
        // If no products found, load from stock_items
        if (productsSnapshot.empty) {
            console.log("%c⚠️ No products found. Loading from stock_items...", "color: orange; font-size: 14px; font-weight: bold");
            await loadInventoryFromStockItems(stockItemsSnapshot);
            return;
        }
        
        // Create a map of productId -> available stock count and expiry info
        const stockMap = new Map();
        const expiryMap = new Map();
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        thirtyDaysFromNow.setHours(23, 59, 59, 999);
        
        // Process all stock items in one pass
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            const productId = item.productId;
            const status = item.status;
            
            if (!productId) return;
            
            // Count available stock
            if (status === 'available') {
                stockMap.set(productId, (stockMap.get(productId) || 0) + 1);
                
                // Check expiry
                if (item.expiryDate) {
                    const expiryDate = item.expiryDate.toDate();
                    expiryDate.setHours(0, 0, 0, 0);
                    
                    if (expiryDate <= thirtyDaysFromNow) {
                        const expiringInfo = expiryMap.get(productId) || { count: 0, items: [] };
                        expiringInfo.count++;
                        expiringInfo.items.push({
                            serial: item.serialNumber,
                            expiry: expiryDate.toLocaleDateString(),
                            daysLeft: Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24))
                        });
                        expiryMap.set(productId, expiringInfo);
                    }
                }
            }
        });
        
        // Process each product
        const rows = [];
        productsSnapshot.forEach(doc => {
            const product = { id: doc.id, ...doc.data() };
            
            const availableStock = stockMap.get(product.id) || 0;
            const expiringInfo = expiryMap.get(product.id) || { count: 0, items: [] };
            
            // Determine stock status class based on category-specific threshold
            const isLow = isLowStock(availableStock, product.category);
            const stockClass = availableStock === 0 ? 'out-of-stock' : (isLow ? 'low-stock' : '');
            const stockStatus = availableStock === 0 ? 'Out of Stock' : availableStock;
            
            // Add tooltip for low stock to show threshold
            let stockTooltip = '';
            if (isLow) {
                const threshold = getLowStockThreshold(product.category);
                stockTooltip = ` title="Low stock threshold: less than ${threshold} units (Current: ${availableStock})"`;
            }
            
            // Discount status badge
            const discountStatus = product.discountable === false ? 
                '<span class="non-discount-badge-table"><i class="fas fa-ban"></i> No Discount</span>' : 
                '<span class="discount-badge-table"><i class="fas fa-tag"></i> Discountable</span>';
            
            // Expiry display
            let expiryDisplay = '<span class="no-expiry">—</span>';
            
            if (expiringInfo.count > 0) {
                expiryDisplay = `<span class="expiry-badge expiring-soon" title="${expiringInfo.count} item(s) expiring within 30 days\n${expiringInfo.items.map(i => `${i.serial}: ${i.expiry} (${i.daysLeft} days)`).join('\n')}">
                    <i class="fas fa-exclamation-triangle"></i> ${expiringInfo.count}
                </span>`;
            }
            
            // Display brand name and generic name
            const brandName = product.brand || product.name || 'N/A';
            const genericName = product.generic || 'N/A';
            
            // Format category for display
            let displayCategory = product.category || 'N/A';
            if (displayCategory === 'rx') displayCategory = 'RX';
            else if (displayCategory === 'over the counter') displayCategory = 'Over the Counter';
            else if (displayCategory === 'food') displayCategory = 'Food';
            else if (displayCategory === 'general merchandise') displayCategory = 'General Merchandise';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${product.code || 'N/A'}</td>
                <td>${brandName}</td>
                <td>${genericName}</td>
                <td>${displayCategory}</td>
                <td>₱${(product.price || 0).toFixed(2)}</td>
                <td class="${stockClass}"${stockTooltip}>${stockStatus}</td>
                <td>${expiryDisplay}</td>
                <td>
                    <button class="btn-icon view-stock-items" title="View Individual Stock Items" data-id="${product.id}" data-name="${brandName}"><i class="fas fa-list"></i></button>
                    <button class="btn-icon edit-product" title="Edit Product" data-id="${product.id}"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon delete-product" title="Delete Product" data-id="${product.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            rows.push(row);
        });
        
        // Append all rows at once
        rows.forEach(row => tableBody.appendChild(row));
        
        // Add mobile data labels
        document.querySelectorAll('#inventoryTableBody tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            const labels = ['Code', 'Brand', 'Generic', 'Category', 'Price', 'Stock', 'Expiring Soon', 'Actions'];
            cells.forEach((cell, index) => {
                cell.setAttribute('data-label', labels[index]);
            });
        });
        
        // Add event listeners
        document.querySelectorAll('.edit-product').forEach(btn => {
            btn.addEventListener('click', () => editProduct(btn.dataset.id));
        });

        document.querySelectorAll('.delete-product').forEach(btn => {
            btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
        });

        document.querySelectorAll('.view-stock-items').forEach(btn => {
            btn.addEventListener('click', () => viewStockItems(btn.dataset.id, btn.dataset.name));
        });
        
        setupInventoryFilters();
        
        console.log("%c✅ INVENTORY LOAD COMPLETE", "color: green; font-size: 14px; font-weight: bold");
        
    } catch (error) {
        console.error("Error loading inventory:", error);
        showNotification('Error loading inventory', 'error');
        document.getElementById('inventoryTableBody').innerHTML = '<tr><td colspan="8" class="error">Error loading inventory</td></tr>';
    }
}

// Optimized function to load inventory directly from stock_items
async function loadInventoryFromStockItems(stockItemsSnapshot) {
    try {
        console.log("%c📦 Loading inventory from stock_items collection...", "color: purple; font-size: 14px; font-weight: bold");
        
        const tableBody = document.getElementById('inventoryTableBody');
        
        if (stockItemsSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="8" class="no-data">No stock items found</td></tr>';
            return;
        }
        
        // Group stock items by product
        const productGroups = new Map();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        thirtyDaysFromNow.setHours(23, 59, 59, 999);
        
        stockItemsSnapshot.forEach(doc => {
            const item = { id: doc.id, ...doc.data() };
            
            // Create a unique key for this product
            const productKey = item.productId || `${item.productName}-${item.productGeneric}`;
            
            if (!productGroups.has(productKey)) {
                productGroups.set(productKey, {
                    key: productKey,
                    id: item.productId || `temp-${Date.now()}-${productGroups.size}`,
                    code: item.productCode || `STK-${productKey.slice(0,6)}`,
                    brand: item.productName || 'Unknown Product',
                    generic: item.productGeneric || 'Unknown Generic',
                    category: item.productCategory || 'Uncategorized',
                    price: item.productPrice || 0,
                    stockItems: [],
                    availableCount: 0,
                    expiringCount: 0
                });
            }
            
            const group = productGroups.get(productKey);
            group.stockItems.push(item);
            
            if (item.status === 'available') {
                group.availableCount++;
                
                // Check for expiring soon
                if (item.expiryDate) {
                    const expiryDate = item.expiryDate.toDate();
                    expiryDate.setHours(0, 0, 0, 0);
                    
                    if (expiryDate <= thirtyDaysFromNow) {
                        group.expiringCount++;
                    }
                }
            }
        });
        
        console.log(`Found ${productGroups.size} unique product groups from stock items`);
        
        // Display each product group
        const rows = [];
        for (const [key, group] of productGroups) {
            // Get a sample item for additional data
            const sampleItem = group.stockItems[0] || {};
            
            // Determine stock status class based on category-specific threshold
            const isLow = isLowStock(group.availableCount, group.category);
            const stockClass = group.availableCount === 0 ? 'out-of-stock' : (isLow ? 'low-stock' : '');
            const stockStatus = group.availableCount === 0 ? 'Out of Stock' : group.availableCount;
            
            // Add tooltip for low stock to show threshold
            let stockTooltip = '';
            if (isLow) {
                const threshold = getLowStockThreshold(group.category);
                stockTooltip = ` title="Low stock threshold: less than ${threshold} units (Current: ${group.availableCount})"`;
            }
            
            // Generate product code from serial number if available
            let productCode = group.code;
            if (sampleItem.serialNumber) {
                const codeMatch = sampleItem.serialNumber.match(/^([A-Z0-9-]+)/);
                if (codeMatch) {
                    productCode = codeMatch[1];
                }
            }
            
            // Expiry display
            let expiryDisplay = '<span class="no-expiry">—</span>';
            if (group.expiringCount > 0) {
                expiryDisplay = `<span class="expiry-badge expiring-soon" title="${group.expiringCount} item(s) expiring within 30 days">
                    <i class="fas fa-exclamation-triangle"></i> ${group.expiringCount}
                </span>`;
            }
            
            // Price display
            const price = group.price || sampleItem.productPrice || 0;
            
            // Format category for display
            let displayCategory = group.category || 'Uncategorized';
            if (displayCategory.toLowerCase() === 'rx') displayCategory = 'RX';
            else if (displayCategory.toLowerCase() === 'over the counter') displayCategory = 'Over the Counter';
            else if (displayCategory.toLowerCase() === 'food') displayCategory = 'Food';
            else if (displayCategory.toLowerCase() === 'general merchandise') displayCategory = 'General Merchandise';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${productCode}</td>
                <td>${group.brand}</td>
                <td>${group.generic}</td>
                <td>${displayCategory}</td>
                <td>₱${(price).toFixed(2)}</td>
                <td class="${stockClass}"${stockTooltip}>${stockStatus}</td>
                <td>${expiryDisplay}</td>
                <td>
                    <button class="btn-icon view-stock-items" title="View Individual Stock Items" data-product-key="${key}" data-brand="${group.brand}"><i class="fas fa-list"></i></button>
                    <button class="btn-icon create-product" title="Create Product from Stock" data-product-key="${key}" data-brand="${group.brand}" data-generic="${group.generic}" data-price="${price}"><i class="fas fa-plus-circle"></i></button>
                    <button class="btn-icon delete-group" title="Delete All Items" data-product-key="${key}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            rows.push(row);
        }
        
        // Append all rows at once
        rows.forEach(row => tableBody.appendChild(row));
        
        // Add mobile data labels
        addMobileLabels();
        
        // Add event listeners for the new buttons
        document.querySelectorAll('.view-stock-items').forEach(btn => {
            btn.addEventListener('click', () => {
                const productKey = btn.dataset.productKey;
                const brand = btn.dataset.brand;
                viewStockItemsByProductKey(productKey, brand);
            });
        });

        document.querySelectorAll('.create-product').forEach(btn => {
            btn.addEventListener('click', () => {
                const productKey = btn.dataset.productKey;
                const brand = btn.dataset.brand;
                const generic = btn.dataset.generic;
                const price = btn.dataset.price;
                createProductFromStockGroup(productKey, brand, generic, price);
            });
        });

        document.querySelectorAll('.delete-group').forEach(btn => {
            btn.addEventListener('click', () => deleteProductGroup(btn.dataset.productKey));
        });
        
        setupInventoryFilters();
        
        console.log("%c✅ INVENTORY LOAD FROM STOCK ITEMS COMPLETE", "color: green; font-size: 14px; font-weight: bold");
        
    } catch (error) {
        console.error("Error loading inventory from stock items:", error);
        showNotification('Error loading inventory from stock items', 'error');
    }
}

// Function to view stock items by product key (optimized)
async function viewStockItemsByProductKey(productKey, brandName) {
    try {
        // Get all stock items
        const stockItemsSnapshot = await getDocs(collection(db, "stock_items"));
        
        // Filter items that belong to this product group
        const productItems = [];
        stockItemsSnapshot.forEach(doc => {
            const item = { id: doc.id, ...doc.data() };
            const itemProductKey = item.productId || `${item.productName}-${item.productGeneric}`;
            
            if (itemProductKey === productKey) {
                productItems.push(item);
            }
        });
        
        if (!document.getElementById('stockItemsModal')) {
            createStockItemsModal();
        }
        
        const modal = document.getElementById('stockItemsModal');
        const modalBody = document.getElementById('stockItemsModalBody');
        
        modal.style.display = 'block';
        
        let html = `
            <div class="stock-items-header">
                <h3><i class="fas fa-boxes"></i> ${brandName} - Individual Stock Items</h3>
                <p>Total Items: ${productItems.length}</p>
            </div>
            <div class="stock-items-list">
        `;
        
        if (productItems.length === 0) {
            html += '<p class="no-data">No individual stock items found</p>';
        } else {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thirtyDaysFromNow = new Date(today);
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            thirtyDaysFromNow.setHours(23, 59, 59, 999);
            
            // Sort by expiry date (soonest first)
            productItems.sort((a, b) => {
                if (a.expiryDate && b.expiryDate) {
                    return a.expiryDate.toDate() - b.expiryDate.toDate();
                } else if (a.expiryDate && !b.expiryDate) {
                    return -1;
                } else if (!a.expiryDate && b.expiryDate) {
                    return 1;
                }
                return 0;
            });
            
            productItems.forEach(item => {
                const expiryDate = item.expiryDate ? item.expiryDate.toDate() : null;
                
                let statusClass = '';
                let statusText = '';
                let expiryStatusClass = '';
                let daysUntilExpiry = null;
                let isExpiringSoon = false;
                
                if (expiryDate) {
                    expiryDate.setHours(0, 0, 0, 0);
                    daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                    isExpiringSoon = expiryDate <= thirtyDaysFromNow && item.status === 'available';
                    
                    if (daysUntilExpiry < 0) {
                        statusClass = 'expired';
                        statusText = 'Expired';
                        expiryStatusClass = 'expired';
                    } else if (daysUntilExpiry <= 7) {
                        statusClass = 'expiring-critical';
                        statusText = `Critical (${daysUntilExpiry} days)`;
                        expiryStatusClass = 'expiring-critical';
                    } else if (daysUntilExpiry <= 30) {
                        statusClass = 'expiring-soon';
                        statusText = `Expiring Soon (${daysUntilExpiry} days)`;
                        expiryStatusClass = 'expiring-soon';
                    }
                }
                
                const statusBadge = item.status === 'sold' ? 
                    '<span class="sold-badge">Sold</span>' : 
                    `<span class="status-badge available">Available</span>`;
                
                const expiringBadge = isExpiringSoon ? 
                    '<span class="expiring-badge">⚠️ Expires in ' + daysUntilExpiry + ' days</span>' : '';
                
                html += `
                    <div class="stock-item-card ${item.status} ${statusClass}">
                        <div class="stock-item-header">
                            <span class="stock-batch"><i class="fas fa-tag"></i> ${item.batchNumber || 'No Batch'}</span>
                            ${statusBadge}
                            ${expiringBadge}
                        </div>
                        <div class="stock-item-details">
                            <div><i class="fas fa-barcode"></i> <strong>Serial:</strong> ${item.serialNumber || 'N/A'}</div>
                            <div><i class="fas fa-calendar-plus"></i> <strong>Added:</strong> ${item.createdAt?.toDate().toLocaleDateString() || 'N/A'}</div>
                            ${expiryDate ? `
                                <div><i class="fas fa-hourglass-end"></i> <strong>Expires:</strong> ${expiryDate.toLocaleDateString()} 
                                <span class="expiry-status ${expiryStatusClass}">${statusText}</span>
                                </div>
                            ` : '<div><i class="fas fa-hourglass-end"></i> <strong>Expires:</strong> No expiry date</div>'}
                        </div>
                        ${item.status === 'available' ? `
                            <div class="stock-item-actions">
                                <button class="btn-icon mark-sold" onclick="markStockAsSold('${item.id}')" title="Mark as Sold"><i class="fas fa-check-circle"></i> Mark Sold</button>
                                <button class="btn-icon delete-stock" onclick="deleteStockItem('${item.id}')" title="Delete"><i class="fas fa-trash"></i> Delete</button>
                            </div>
                        ` : ''}
                    </div>
                `;
            });
        }
        
        html += '</div>';
        
        // Add summary
        const availableCount = productItems.filter(item => item.status === 'available').length;
        const soldCount = productItems.filter(item => item.status === 'sold').length;
        const expiringCount = productItems.filter(item => {
            if (item.status === 'available' && item.expiryDate) {
                const expiryDate = item.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const thirtyDaysFromNow = new Date(today);
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                thirtyDaysFromNow.setHours(23, 59, 59, 999);
                return expiryDate <= thirtyDaysFromNow;
            }
            return false;
        }).length;
        
        html += `
            <div class="stock-summary">
                <h4><i class="fas fa-chart-pie"></i> Summary</h4>
                <div class="summary-stats">
                    <div class="summary-stat">
                        <span class="stat-label">Available:</span>
                        <span class="stat-value available">${availableCount}</span>
                    </div>
                    <div class="summary-stat">
                        <span class="stat-label">Sold:</span>
                        <span class="stat-value sold">${soldCount}</span>
                    </div>
                    <div class="summary-stat">
                        <span class="stat-label">Expiring ≤30 days:</span>
                        <span class="stat-value expiring">${expiringCount}</span>
                    </div>
                </div>
            </div>
        `;
        
        modalBody.innerHTML = html;
        
    } catch (error) {
        console.error("Error loading stock items:", error);
        showNotification('Error loading stock items', 'error');
    }
}

// Function to create a product from a stock group
async function createProductFromStockGroup(productKey, brand, generic, price) {
    if (!confirm(`Create a product record for "${brand}" from existing stock items?`)) return;
    
    try {
        // Get all stock items for this group
        const stockItemsSnapshot = await getDocs(collection(db, "stock_items"));
        const groupItems = [];
        
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            const itemProductKey = item.productId || `${item.productName}-${item.productGeneric}`;
            if (itemProductKey === productKey) {
                groupItems.push({ id: doc.id, ...item });
            }
        });
        
        if (groupItems.length === 0) {
            showNotification('No stock items found for this group', 'error');
            return;
        }
        
        // Count available items
        const availableCount = groupItems.filter(item => item.status === 'available').length;
        
        // Create the product
        const productData = {
            code: `PROD-${Date.now()}`,
            brand: brand,
            generic: generic,
            category: 'Uncategorized',
            price: parseFloat(price) || 0,
            stock: availableCount,
            discountable: true,
            description: `Created from stock items on ${new Date().toLocaleDateString()}`,
            createdAt: Timestamp.now(),
            lastUpdated: Timestamp.now()
        };
        
        const productRef = await addDoc(collection(db, "products"), productData);
        
        // Update all stock items with the new productId
        const batch = writeBatch(db);
        groupItems.forEach(item => {
            const stockItemRef = doc(db, "stock_items", item.id);
            batch.update(stockItemRef, {
                productId: productRef.id,
                productName: productData.brand,
                productGeneric: productData.generic
            });
        });
        
        await batch.commit();
        
        showNotification(`Product "${brand}" created successfully with ${availableCount} stock items`, 'success');
        
        // Reload inventory
        loadInventory();
        
    } catch (error) {
        console.error("Error creating product from stock group:", error);
        showNotification('Error creating product: ' + error.message, 'error');
    }
}

// Function to delete entire product group
async function deleteProductGroup(productKey) {
    if (!confirm('Are you sure you want to delete ALL stock items in this group? This action cannot be undone.')) return;
    
    try {
        // Get all stock items for this group
        const stockItemsSnapshot = await getDocs(collection(db, "stock_items"));
        const batch = writeBatch(db);
        let deleteCount = 0;
        
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            const itemProductKey = item.productId || `${item.productName}-${item.productGeneric}`;
            if (itemProductKey === productKey) {
                batch.delete(doc.ref);
                deleteCount++;
            }
        });
        
        if (deleteCount > 0) {
            await batch.commit();
            showNotification(`Successfully deleted ${deleteCount} stock items`, 'success');
        } else {
            showNotification('No items found to delete', 'info');
        }
        
        // Reload inventory
        loadInventory();
        
    } catch (error) {
        console.error("Error deleting product group:", error);
        showNotification('Error deleting items: ' + error.message, 'error');
    }
}

// ==================== VIEW INDIVIDUAL STOCK ITEMS ====================
async function viewStockItems(productId, productName) {
    try {
        if (!document.getElementById('stockItemsModal')) {
            createStockItemsModal();
        }
        
        const modal = document.getElementById('stockItemsModal');
        const modalBody = document.getElementById('stockItemsModalBody');
        
        modal.style.display = 'block';
        modalBody.innerHTML = '<div class="loading">Loading stock items...</div>';
        
        const stockItemsQuery = query(
            collection(db, "stock_items"),
            where("productId", "==", productId),
            orderBy("createdAt", "desc")
        );
        
        const stockItemsSnapshot = await getDocs(stockItemsQuery);
        
        let html = `
            <div class="stock-items-header">
                <h3><i class="fas fa-boxes"></i> ${productName} - Individual Stock Items</h3>
                <p>Total Items: ${stockItemsSnapshot.size}</p>
            </div>
            <div class="stock-items-list">
        `;
        
        if (stockItemsSnapshot.empty) {
            html += '<p class="no-data">No individual stock items found</p>';
        } else {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thirtyDaysFromNow = new Date(today);
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            thirtyDaysFromNow.setHours(23, 59, 59, 999);
            
            stockItemsSnapshot.forEach(itemDoc => {
                const item = itemDoc.data();
                const expiryDate = item.expiryDate ? item.expiryDate.toDate() : null;
                
                let statusClass = '';
                let statusText = '';
                let expiryStatusClass = '';
                let daysUntilExpiry = null;
                let isExpiringSoon = false;
                
                if (expiryDate) {
                    expiryDate.setHours(0, 0, 0, 0);
                    daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                    isExpiringSoon = expiryDate <= thirtyDaysFromNow && item.status === 'available';
                    
                    if (daysUntilExpiry < 0) {
                        statusClass = 'expired';
                        statusText = 'Expired';
                        expiryStatusClass = 'expired';
                    } else if (daysUntilExpiry <= 7) {
                        statusClass = 'expiring-critical';
                        statusText = `Critical (${daysUntilExpiry} days)`;
                        expiryStatusClass = 'expiring-critical';
                    } else if (daysUntilExpiry <= 30) {
                        statusClass = 'expiring-soon';
                        statusText = `Expiring Soon (${daysUntilExpiry} days)`;
                        expiryStatusClass = 'expiring-soon';
                    }
                }
                
                const statusBadge = item.status === 'sold' ? 
                    '<span class="sold-badge">Sold</span>' : 
                    `<span class="status-badge available">Available</span>`;
                
                const expiringBadge = (isExpiringSoon && item.status === 'available') ? 
                    '<span class="expiring-badge">⚠️ Expires in ' + daysUntilExpiry + ' days</span>' : '';
                
                const genericDisplay = item.productGeneric ? 
                    `<div><i class="fas fa-capsules"></i> <strong>Generic:</strong> ${item.productGeneric}</div>` : '';
                
                html += `
                    <div class="stock-item-card ${item.status} ${statusClass}">
                        <div class="stock-item-header">
                            <span class="stock-batch"><i class="fas fa-tag"></i> ${item.batchNumber || 'No Batch'}</span>
                            ${statusBadge}
                            ${expiringBadge}
                        </div>
                        <div class="stock-item-details">
                            <div><i class="fas fa-barcode"></i> <strong>Serial:</strong> ${item.serialNumber || 'N/A'}</div>
                            ${genericDisplay}
                            <div><i class="fas fa-calendar-plus"></i> <strong>Added:</strong> ${item.createdAt?.toDate().toLocaleDateString() || 'N/A'}</div>
                            ${expiryDate ? `
                                <div><i class="fas fa-hourglass-end"></i> <strong>Expires:</strong> ${expiryDate.toLocaleDateString()} 
                                <span class="expiry-status ${expiryStatusClass}">${statusText}</span>
                                </div>
                            ` : '<div><i class="fas fa-hourglass-end"></i> <strong>Expires:</strong> No expiry date</div>'}
                            ${item.soldDate ? `<div><i class="fas fa-check-circle"></i> <strong>Sold:</strong> ${item.soldDate.toDate().toLocaleDateString()}</div>` : ''}
                        </div>
                        <div class="stock-item-actions">
                            ${item.status === 'available' ? `
                                <button class="btn-icon mark-sold" onclick="markStockAsSold('${itemDoc.id}')" title="Mark as Sold">
                                    <i class="fas fa-check-circle"></i> Mark Sold
                                </button>
                            ` : `
                                <button class="btn-icon return-stock" onclick="returnSoldItem('${itemDoc.id}')" title="Return to Stock">
                                    <i class="fas fa-undo-alt"></i> Return
                                </button>
                            `}
                            <button class="btn-icon delete-stock" onclick="deleteStockItem('${itemDoc.id}')" title="Delete">
                                <i class="fas fa-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                `;
            });
        }
        
        html += '</div>';
        
        if (stockItemsSnapshot.size > 0) {
            const availableCount = Array.from(stockItemsSnapshot.docs).filter(d => d.data().status === 'available').length;
            const soldCount = Array.from(stockItemsSnapshot.docs).filter(d => d.data().status === 'sold').length;
            
            // Calculate expiring count
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thirtyDaysFromNow = new Date(today);
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            thirtyDaysFromNow.setHours(23, 59, 59, 999);
            
            let expiringCount = 0;
            stockItemsSnapshot.forEach(itemDoc => {
                const item = itemDoc.data();
                if (item.expiryDate && item.status === 'available') {
                    const expiryDate = item.expiryDate.toDate();
                    expiryDate.setHours(0, 0, 0, 0);
                    if (expiryDate <= thirtyDaysFromNow) {
                        expiringCount++;
                    }
                }
            });
            
            html += `
                <div class="stock-summary">
                    <h4><i class="fas fa-chart-pie"></i> Summary</h4>
                    <div class="summary-stats">
                        <div class="summary-stat">
                            <span class="stat-label">Available:</span>
                            <span class="stat-value available">${availableCount}</span>
                        </div>
                        <div class="summary-stat">
                            <span class="stat-label">Sold:</span>
                            <span class="stat-value sold">${soldCount}</span>
                        </div>
                        <div class="summary-stat">
                            <span class="stat-label">Expiring ≤30 days:</span>
                            <span class="stat-value expiring">${expiringCount}</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        modalBody.innerHTML = html;
        
    } catch (error) {
        console.error("Error loading stock items:", error);
        showNotification('Error loading stock items', 'error');
    }
}

// Add the return function
window.returnSoldItem = async function(stockItemId) {
    if (!confirm('Return this item to available stock? This will undo the sale.')) return;
    
    try {
        console.log(`Returning item: ${stockItemId}`);
        
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
        
        // Return the item to available
        batch.update(stockItemRef, {
            status: 'available',
            soldDate: null,
            soldBy: null,
            returnedAt: Timestamp.now(),
            returnedBy: loggedInUserId
        });
        
        // Update product stock if product exists
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
        
        // Create return record
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
        
        showNotification('Item returned to inventory successfully', 'success');
        
        // Refresh views - use force refresh to bypass cache
        await loadInventory(true);
        
        // Close modal if open
        const modal = document.getElementById('stockItemsModal');
        if (modal && modal.style.display === 'block') {
            modal.style.display = 'none';
        }
        
    } catch (error) {
        console.error("Error returning item:", error);
        showNotification('Error returning item: ' + error.message, 'error');
    }
};

// ==================== CREATE MODALS ====================
function createStockItemsModal() {
    const modalHTML = `
        <div id="stockItemsModal" class="modal">
            <div class="modal-content" style="max-width: 700px;">
                <div class="modal-header">
                    <h2><i class="fas fa-boxes"></i> Individual Stock Items</h2>
                    <span class="close" onclick="closeModal('stockItemsModal')">&times;</span>
                </div>
                <div class="modal-body" id="stockItemsModalBody"></div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// ==================== STOCK ITEM ACTIONS ====================
window.markStockAsSold = async function(stockItemId) {
    if (!confirm('Mark this item as sold?')) return;
    
    try {
        const stockItemRef = doc(db, "stock_items", stockItemId);
        const stockItemDoc = await getDoc(stockItemRef);
        
        if (!stockItemDoc.exists()) {
            showNotification('Stock item not found', 'error');
            return;
        }
        
        const stockItem = stockItemDoc.data();
        
        await updateDoc(stockItemRef, {
            status: 'sold',
            soldDate: Timestamp.now(),
            soldBy: loggedInUserId
        });
        
        // Update product total stock count if product exists
        if (stockItem.productId) {
            try {
                const availableStockQuery = query(
                    collection(db, "stock_items"),
                    where("productId", "==", stockItem.productId),
                    where("status", "==", "available")
                );
                const availableStockSnapshot = await getDocs(availableStockQuery);
                
                const productRef = doc(db, "products", stockItem.productId);
                const productDoc = await getDoc(productRef);
                
                if (productDoc.exists()) {
                    await updateDoc(productRef, {
                        stock: availableStockSnapshot.size,
                        lastUpdated: Timestamp.now()
                    });
                }
            } catch (error) {
                console.log("Product may not exist, skipping update");
            }
        }
        
        await addDoc(collection(db, "activities"), {
            type: 'stock',
            description: `Stock item #${stockItemId.slice(-6)} marked as sold`,
            timestamp: Timestamp.now(),
            userId: loggedInUserId
        });
        
        showNotification('Stock item marked as sold', 'success');
        
        // Refresh views with force refresh
        await loadInventory(true);
        
        // Close modal if open
        const modal = document.getElementById('stockItemsModal');
        if (modal && modal.style.display === 'block') {
            modal.style.display = 'none';
        }
        
    } catch (error) {
        console.error("Error marking stock as sold:", error);
        showNotification('Error marking stock as sold', 'error');
    }
};

window.deleteStockItem = async function(stockItemId) {
    if (!confirm('Are you sure you want to delete this stock item?')) return;
    
    try {
        const stockItemRef = doc(db, "stock_items", stockItemId);
        const stockItemDoc = await getDoc(stockItemRef);
        
        if (!stockItemDoc.exists()) {
            showNotification('Stock item not found', 'error');
            return;
        }
        
        const stockItem = stockItemDoc.data();
        
        await deleteDoc(stockItemRef);
        
        // Update product total stock if product exists
        if (stockItem.productId) {
            try {
                const availableStockQuery = query(
                    collection(db, "stock_items"),
                    where("productId", "==", stockItem.productId),
                    where("status", "==", "available")
                );
                const availableStockSnapshot = await getDocs(availableStockQuery);
                
                const productRef = doc(db, "products", stockItem.productId);
                const productDoc = await getDoc(productRef);
                
                if (productDoc.exists()) {
                    await updateDoc(productRef, {
                        stock: availableStockSnapshot.size,
                        lastUpdated: Timestamp.now()
                    });
                }
            } catch (error) {
                console.log("Product may not exist, skipping update");
            }
        }
        
        showNotification('Stock item deleted', 'success');
        
        // Refresh views with force refresh
        await loadInventory(true);
        
        // Close modal if open
        const modal = document.getElementById('stockItemsModal');
        if (modal && modal.style.display === 'block') {
            modal.style.display = 'none';
        }
        
    } catch (error) {
        console.error("Error deleting stock item:", error);
        showNotification('Error deleting stock item', 'error');
    }
};

// ==================== HELPER FUNCTIONS ====================
function addMobileLabels() {
    document.querySelectorAll('#inventoryTableBody tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        const labels = ['Code', 'Brand', 'Generic', 'Category', 'Price', 'Stock', 'Expiring Soon', 'Actions'];
        cells.forEach((cell, index) => {
            cell.setAttribute('data-label', labels[index]);
        });
    });
}

function addEventListeners() {
    document.querySelectorAll('.edit-product').forEach(btn => {
        btn.addEventListener('click', () => editProduct(btn.dataset.id));
    });

    document.querySelectorAll('.delete-product').forEach(btn => {
        btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
    });

    document.querySelectorAll('.view-stock-items').forEach(btn => {
        if (btn.dataset.id) {
            btn.addEventListener('click', () => viewStockItems(btn.dataset.id, btn.dataset.name));
        }
    });
}

// ==================== FILTERS ====================
function setupInventoryFilters() {
    const searchInput = document.getElementById('inventorySearch');
    const categoryFilter = document.getElementById('categoryFilter');
    const stockFilter = document.getElementById('stockFilter');
    
    // Debounce search input to improve performance
    let searchTimeout;
    
    const filterFunction = () => {
        const searchTerm = searchInput?.value.toLowerCase().trim() || '';
        const category = categoryFilter?.value || '';
        const stock = stockFilter?.value || '';
        
        const rows = document.querySelectorAll('#inventoryTableBody tr');
        
        rows.forEach(row => {
            let show = true;
            const text = row.textContent.toLowerCase();
            
            if (searchTerm && !text.includes(searchTerm)) show = false;
            
            if (show && category) {
                const rowCategory = row.querySelector('td:nth-child(4)')?.textContent || '';
                if (rowCategory.toLowerCase() !== category.toLowerCase()) show = false;
            }
            
            if (show && stock) {
                const stockText = row.querySelector('td:nth-child(6)')?.textContent || '';
                const stockValue = parseInt(stockText) || 0;
                
                if (stock === 'low' && (stockValue >= 10 || stockValue === 0)) show = false;
                if (stock === 'out' && stockValue !== 0) show = false;
            }
            
            row.style.display = show ? '' : 'none';
        });
    };
    
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(filterFunction, 300);
        });
    }
    
    if (categoryFilter) categoryFilter.addEventListener('change', filterFunction);
    if (stockFilter) stockFilter.addEventListener('change', filterFunction);
}

// ==================== PRODUCT CRUD ====================
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
        document.getElementById('productBrand').value = product.brand || '';
        document.getElementById('productGeneric').value = product.generic || '';
        
        // Handle category display
        let categoryValue = product.category || '';
        if (categoryValue === 'rx') categoryValue = 'rx';
        else if (categoryValue === 'over the counter') categoryValue = 'over the counter';
        else if (categoryValue === 'food') categoryValue = 'food';
        else if (categoryValue === 'general merchandise') categoryValue = 'general merchandise';
        
        document.getElementById('productCategory').value = categoryValue;
        document.getElementById('productPrice').value = product.price || 0;
        document.getElementById('productStock').value = product.stock || 0;
        
        const discountableYes = document.getElementById('discountableYes');
        const discountableNo = document.getElementById('discountableNo');
        
        if (discountableYes && discountableNo) {
            if (product.discountable === false) {
                discountableNo.checked = true;
            } else {
                discountableYes.checked = true;
            }
        }
        
        document.getElementById('productExpiry').value = '';
        document.getElementById('productDescription').value = product.description || '';
        
        document.querySelector('#productModal .modal-header h2').textContent = 'Edit Product';
        document.querySelector('#productForm button[type="submit"]').textContent = 'Update Product';
        document.getElementById('productForm').dataset.editId = productId;
        
        document.getElementById('productModal').style.display = 'block';
        
    } catch (error) {
        console.error("Error loading product for edit:", error);
        showNotification('Error loading product', 'error');
    }
}

async function deleteProduct(productId) {
    if (confirm('Are you sure you want to delete this product and all its stock items?')) {
        try {
            // Delete all stock items for this product
            const stockItemsQuery = query(
                collection(db, "stock_items"),
                where("productId", "==", productId)
            );
            const stockItemsSnapshot = await getDocs(stockItemsQuery);
            
            const batch = writeBatch(db);
            stockItemsSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            
            // Delete the product
            const productRef = doc(db, "products", productId);
            batch.delete(productRef);
            
            await batch.commit();
            
            await addDoc(collection(db, "activities"), {
                type: 'product',
                description: `Product and all stock items deleted`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId
            });
            
            showNotification('Product and all stock items deleted successfully', 'success');
            
            // Clear cache and reload
            productsCache = null;
            stockItemsCache = null;
            await loadInventory(true);
            
        } catch (error) {
            console.error("Error deleting product:", error);
            showNotification('Error deleting product', 'error');
        }
    }
}

// ==================== PRODUCT FORM SUBMISSION ====================
const productForm = document.getElementById('productForm');
if (productForm) {
    productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const editId = productForm.dataset.editId;
        
        try {
            const discountableYes = document.getElementById('discountableYes');
            const discountable = discountableYes && discountableYes.checked ? true : false;
            
            const stockQuantity = parseInt(document.getElementById('productStock')?.value) || 0;
            const expiryDateInput = document.getElementById('productExpiry')?.value;
            
            // Get category value
            let category = document.getElementById('productCategory')?.value || '';
            
            // Ensure category is stored in consistent format
            if (category === 'rx') category = 'rx';
            else if (category === 'over the counter') category = 'over the counter';
            else if (category === 'food') category = 'food';
            else if (category === 'general merchandise') category = 'general merchandise';
            
            const productData = {
                code: document.getElementById('productCode')?.value || '',
                brand: document.getElementById('productBrand')?.value || '',
                generic: document.getElementById('productGeneric')?.value || '',
                category: category,
                price: parseFloat(document.getElementById('productPrice')?.value) || 0,
                stock: stockQuantity,
                discountable: discountable,
                description: document.getElementById('productDescription')?.value || '',
                lastUpdated: Timestamp.now()
            };
            
            if (editId) {
                // Update existing product
                const productRef = doc(db, "products", editId);
                
                // Get current stock items count
                const stockItemsQuery = query(
                    collection(db, "stock_items"),
                    where("productId", "==", editId),
                    where("status", "==", "available")
                );
                const stockItemsSnapshot = await getDocs(stockItemsQuery);
                productData.stock = stockItemsSnapshot.size;
                
                await updateDoc(productRef, productData);
                
                await addDoc(collection(db, "activities"), {
                    type: 'product',
                    description: `Product updated: ${productData.brand}`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
                
                showNotification('Product updated successfully!', 'success');
            } else {
                // Add new product
                productData.createdAt = Timestamp.now();
                productData.stock = 0;
                const productRef = await addDoc(collection(db, "products"), productData);
                
                // Create individual stock items with expiry dates
                if (stockQuantity > 0) {
                    const batch = writeBatch(db);
                    
                    for (let i = 0; i < stockQuantity; i++) {
                        const serialNumber = `${productData.code || 'PROD'}-${Date.now()}-${i + 1}`;
                        const stockItemRef = doc(collection(db, "stock_items"));
                        
                        const stockItemData = {
                            productId: productRef.id,
                            productName: productData.brand,
                            productGeneric: productData.generic,
                            productCategory: productData.category,
                            batchNumber: `BATCH-${new Date().toISOString().slice(0,10)}`,
                            serialNumber: serialNumber,
                            status: 'available',
                            createdAt: Timestamp.now(),
                            createdBy: loggedInUserId
                        };
                        
                        // Add expiry date if provided
                        if (expiryDateInput && expiryDateInput.trim() !== '') {
                            const expiryDate = new Date(expiryDateInput);
                            expiryDate.setHours(0, 0, 0, 0);
                            stockItemData.expiryDate = Timestamp.fromDate(expiryDate);
                        }
                        
                        batch.set(stockItemRef, stockItemData);
                    }
                    
                    await batch.commit();
                    
                    // Update product stock count
                    await updateDoc(productRef, {
                        stock: stockQuantity
                    });
                }
                
                await addDoc(collection(db, "activities"), {
                    type: 'product',
                    description: `New product added: ${productData.brand} (${productData.generic}) with ${stockQuantity} stock items`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
                
                showNotification(`Product added successfully with ${stockQuantity} stock items!`, 'success');
            }
            
            document.getElementById('productModal').style.display = 'none';
            productForm.reset();
            productForm.dataset.editId = '';
            document.getElementById('discountableYes').checked = true;
            
            // Clear cache and reload
            productsCache = null;
            stockItemsCache = null;
            await loadInventory(true);
            
        } catch (error) {
            console.error("Error saving product:", error);
            showNotification('Error saving product. Please try again.', 'error');
        }
    });
}

// ==================== PRODUCT TYPE SELECTION ====================
document.addEventListener('DOMContentLoaded', () => {
    const addProductBtn = document.getElementById('addProductBtn');
    const productTypeModal = document.getElementById('productTypeModal');
    const selectExistingBtn = document.getElementById('selectExistingProduct');
    const addNewBtn = document.getElementById('addNewProduct');
    
    if (addProductBtn) {
        addProductBtn.addEventListener('click', () => {
            productTypeModal.style.display = 'block';
        });
    }
    
    if (addNewBtn) {
        addNewBtn.addEventListener('click', () => {
            productTypeModal.style.display = 'none';
            
            document.getElementById('productForm').reset();
            document.getElementById('productForm').dataset.editId = '';
            document.getElementById('discountableYes').checked = true;
            document.getElementById('productExpiry').disabled = false;
            document.getElementById('productExpiry').value = '';
            
            document.querySelector('#productModal .modal-header h2').textContent = 'Add New Product';
            document.querySelector('#productForm button[type="submit"]').textContent = 'Add Product';
            
            document.getElementById('productModal').style.display = 'block';
        });
    }
    
    if (selectExistingBtn) {
        selectExistingBtn.addEventListener('click', () => {
            productTypeModal.style.display = 'none';
            document.getElementById('addExistingProductModal').style.display = 'block';
        });
    }
    
    // Existing product search
    const existingProductSearch = document.getElementById('existingProductSearch');
    if (existingProductSearch) {
        existingProductSearch.addEventListener('input', debounce(async (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            
            if (searchTerm.length < 2) {
                document.getElementById('existingProductResults').innerHTML = '';
                return;
            }
            
            document.getElementById('existingProductResults').innerHTML = '<div class="loading-search">Searching...</div>';
            
            try {
                const productsRef = collection(db, "products");
                const productsSnapshot = await getDocs(productsRef);
                
                const results = [];
                productsSnapshot.forEach(doc => {
                    const product = { id: doc.id, ...doc.data() };
                    if (product.brand?.toLowerCase().includes(searchTerm) || 
                        product.generic?.toLowerCase().includes(searchTerm) ||
                        product.code?.toLowerCase().includes(searchTerm)) {
                        results.push(product);
                    }
                });
                
                if (results.length === 0) {
                    document.getElementById('existingProductResults').innerHTML = '<div class="no-results">No products found</div>';
                    return;
                }
                
                const resultsDiv = document.getElementById('existingProductResults');
                resultsDiv.innerHTML = '';
                
                results.slice(0, 10).forEach(product => {
                    // Format category for display
                    let displayCategory = product.category || 'N/A';
                    if (displayCategory === 'rx') displayCategory = 'RX';
                    else if (displayCategory === 'over the counter') displayCategory = 'Over the Counter';
                    else if (displayCategory === 'food') displayCategory = 'Food';
                    else if (displayCategory === 'general merchandise') displayCategory = 'General Merchandise';
                    
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'product-result-item';
                    resultDiv.dataset.productId = product.id;
                    resultDiv.innerHTML = `
                        <div class="product-result-name">${product.brand || 'Unnamed'}</div>
                        <div class="product-result-details">
                            <span class="product-result-code">Code: ${product.code || 'N/A'}</span>
                            <span>Generic: ${product.generic || 'N/A'}</span>
                            <span>Category: ${displayCategory}</span>
                            <span>Stock: ${product.stock || 0}</span>
                            <span>Price: ₱${(product.price || 0).toFixed(2)}</span>
                        </div>
                    `;
                    
                    resultDiv.addEventListener('click', () => selectProductForStock(product));
                    resultsDiv.appendChild(resultDiv);
                });
                
            } catch (error) {
                console.error("Error searching products:", error);
                document.getElementById('existingProductResults').innerHTML = '<div class="error">Error searching</div>';
            }
        }, 300));
    }
    
    // Confirm add stock
    const confirmAddStockBtn = document.getElementById('confirmAddStockBtn');
    if (confirmAddStockBtn) {
        confirmAddStockBtn.addEventListener('click', async () => {
            const selectedProduct = window.selectedProductForStock;
            if (!selectedProduct) {
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
                const batch = writeBatch(db);
                
                // Create individual stock items with expiry dates
                for (let i = 0; i < quantity; i++) {
                    const serialNumber = `${selectedProduct.code || 'PROD'}-${Date.now()}-${i + 1}`;
                    const stockItemRef = doc(collection(db, "stock_items"));
                    
                    const stockItemData = {
                        productId: selectedProduct.id,
                        productName: selectedProduct.brand,
                        productGeneric: selectedProduct.generic,
                        productCategory: selectedProduct.category,
                        batchNumber: `BATCH-${new Date().toISOString().slice(0,10)}`,
                        serialNumber: serialNumber,
                        status: 'available',
                        createdAt: Timestamp.now(),
                        createdBy: loggedInUserId
                    };
                    
                    // Add expiry date if provided
                    if (newExpiry && newExpiry.trim() !== '') {
                        const expiryDate = new Date(newExpiry);
                        expiryDate.setHours(0, 0, 0, 0);
                        stockItemData.expiryDate = Timestamp.fromDate(expiryDate);
                    }
                    
                    batch.set(stockItemRef, stockItemData);
                }
                
                await batch.commit();
                
                // Update product stock count
                const availableStockQuery = query(
                    collection(db, "stock_items"),
                    where("productId", "==", selectedProduct.id),
                    where("status", "==", "available")
                );
                const availableStockSnapshot = await getDocs(availableStockQuery);
                
                const productRef = doc(db, "products", selectedProduct.id);
                await updateDoc(productRef, {
                    stock: availableStockSnapshot.size,
                    lastUpdated: Timestamp.now()
                });
                
                await addDoc(collection(db, "activities"), {
                    type: 'stock',
                    description: `Added ${quantity} stock items to ${selectedProduct.brand}`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId
                });
                
                showNotification(`Successfully added ${quantity} stock items to ${selectedProduct.brand}`, 'success');
                
                document.getElementById('addExistingProductModal').style.display = 'none';
                document.getElementById('selectedProductInfo').style.display = 'none';
                document.getElementById('existingProductSearch').value = '';
                document.getElementById('existingProductResults').innerHTML = '';
                window.selectedProductForStock = null;
                
                // Clear cache and reload
                productsCache = null;
                stockItemsCache = null;
                await loadInventory(true);
                
            } catch (error) {
                console.error("Error adding stock items:", error);
                showNotification('Error adding stock items: ' + error.message, 'error');
            }
        });
    }
});

// ==================== HELPER FUNCTIONS ====================
function selectProductForStock(product) {
    window.selectedProductForStock = product;
    
    document.querySelectorAll('.product-result-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    const selectedElement = Array.from(document.querySelectorAll('.product-result-item')).find(
        el => el.dataset.productId === product.id
    );
    if (selectedElement) {
        selectedElement.classList.add('selected');
    }
    
    document.getElementById('selectedProductName').textContent = product.brand || 'N/A';
    document.getElementById('selectedGenericName').textContent = product.generic || 'N/A';
    document.getElementById('selectedCurrentStock').textContent = product.stock || 0;
    document.getElementById('selectedProductPrice').textContent = (product.price || 0).toFixed(2);
    
    document.getElementById('addStockQuantity').value = 1;
    document.getElementById('newExpiryDate').value = '';
    
    document.getElementById('selectedProductInfo').style.display = 'block';
    document.getElementById('existingProductResults').innerHTML = '';
    document.getElementById('existingProductSearch').value = '';
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
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

// ==================== DEBUG FUNCTIONS ====================
window.debugInventory = async function() {
    console.clear();
    console.log("%c🔍 FORCING INVENTORY RELOAD WITH DEBUG...", "color: blue; font-size: 16px; font-weight: bold");
    // Clear cache and force refresh
    productsCache = null;
    stockItemsCache = null;
    await loadInventory(true);
};

window.checkExpiryData = async function() {
    try {
        console.clear();
        console.log("%c🔍 CHECKING EXPIRY DATA...", "color: blue; font-size: 16px; font-weight: bold");
        
        const stockItemsSnapshot = await getDocs(collection(db, "stock_items"));
        
        console.log(`📦 Total stock items: ${stockItemsSnapshot.size}`);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        thirtyDaysFromNow.setHours(23, 59, 59, 999);
        
        console.log(`📅 Today: ${today.toLocaleDateString()}`);
        console.log(`📅 30 days from now: ${thirtyDaysFromNow.toLocaleDateString()}`);
        console.log("");
        
        let expiringCount = 0;
        let withExpiry = 0;
        let withoutExpiry = 0;
        
        console.log("%c📋 INDIVIDUAL ITEMS:", "font-weight: bold");
        console.log("===================");
        
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            const hasExpiry = item.expiryDate ? true : false;
            
            if (hasExpiry) {
                withExpiry++;
                const expiryDate = item.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
                const daysUntil = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                
                const isExpiringSoon = expiryDate <= thirtyDaysFromNow;
                const willBeCounted = (isExpiringSoon && item.status === 'available');
                
                if (willBeCounted) {
                    expiringCount++;
                }
                
                console.log({
                    id: doc.id.slice(-6),
                    product: item.productName,
                    status: item.status,
                    expiry: expiryDate.toLocaleDateString(),
                    daysUntil: daysUntil,
                    isExpiringSoon: isExpiringSoon ? "✅ YES" : "❌ NO",
                    willBeCounted: willBeCounted ? "✅ YES" : "❌ NO"
                });
            } else {
                withoutExpiry++;
                console.log({
                    id: doc.id.slice(-6),
                    product: item.productName,
                    status: item.status,
                    expiry: "NO EXPIRY DATE"
                });
            }
        });
        
        console.log("");
        console.log("%c📊 SUMMARY:", "font-weight: bold");
        console.log("===========");
        console.log(`✅ Items WITH expiry date: ${withExpiry}`);
        console.log(`❌ Items WITHOUT expiry date: ${withoutExpiry}`);
        console.log(`%c⚠️ Available items expiring within 30 days: ${expiringCount}`, "color: orange; font-weight: bold");
        
        alert(`Found ${stockItemsSnapshot.size} stock items.\n` +
              `- With expiry: ${withExpiry}\n` +
              `- Without expiry: ${withoutExpiry}\n` +
              `- Available items expiring ≤30 days: ${expiringCount}\n\n` +
              `Check console for details.`);
    } catch (error) {
        console.error("Error checking expiry data:", error);
        alert("Error checking expiry data: " + error.message);
    }
};