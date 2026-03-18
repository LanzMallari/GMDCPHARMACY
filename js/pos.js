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
let hasPrescription = false;

// Enhanced caching system
let productsCache = {
    data: null,
    timestamp: 0,
    expiryMap: null
};
let stockItemsCache = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 60000;
const STOCK_CACHE_DURATION = 60000;

// Notification state
let notificationBadge = null;
let notificationPopup = null;
let notificationInterval = null;
let lastPopupDismissed = 0;
const NOTIFICATION_CHECK_INTERVAL = 60 * 60 * 1000;
const POPUP_DISMISS_DURATION = 60 * 60 * 1000;

// Discount rates
const DISCOUNT_RATES = {
    seniorPWD: 20,
    yakap: 30
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializePOS();
    setupEventListeners();
    initializeNotifications();
});

async function initializePOS() {
    await Promise.all([
        loadUserData(),
        updateDateTime()
    ]);
    await loadProducts();
    setupSidebar();
    setupSellExpiringToggle();
    setupDiscountOptions();
    setupPrescriptionCheckbox();
}

async function loadUserData() {
    try {
        const userData = await fetchUserData(loggedInUserId);
        if (userData) {
            const fullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email?.split('@')[0] || 'User';
            const sidebarUserName = document.getElementById('sidebarUserName');
            const sidebarUserEmail = document.getElementById('sidebarUserEmail');
            const welcomeUserName = document.getElementById('welcomeUserName');
            
            if (sidebarUserName) sidebarUserName.textContent = fullName;
            if (sidebarUserEmail) sidebarUserEmail.textContent = userData.email || '';
            if (welcomeUserName) welcomeUserName.textContent = fullName.split(' ')[0] || 'User';
        }
    } catch (error) {
        console.error("Error loading user data:", error);
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
            if (icon) {
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-times');
            }
            
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
            const sidebar = document.querySelector('.sidebar');
            const burgerBtn = document.getElementById('burgerBtn');
            if (sidebar) sidebar.classList.remove('active');
            if (burgerBtn) {
                const icon = burgerBtn.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            }
            overlay.remove();
        });
    }
}

function removeOverlay() {
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.remove();
}

// ==================== PRESCRIPTION CHECKBOX ====================

function setupPrescriptionCheckbox() {
    const discountContainer = document.querySelector('.discount-container');
    if (!discountContainer) return;
    
    if (document.getElementById('prescriptionCheckbox')) return;
    
    const prescriptionHTML = `
        <div class="prescription-checkbox-container" style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #3498db;">
            <label class="prescription-label" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="checkbox" id="prescriptionCheckbox" style="width: 18px; height: 18px; cursor: pointer;">
                <span style="font-weight: 500; color: #2c3e50;">
                    <i class="fas fa-prescription" style="color: #3498db; margin-right: 8px;"></i>
                    With Valid Prescription (Required for discount on prescription-only items)
                </span>
            </label>
            <small style="display: block; margin-top: 5px; color: #7f8c8d; font-size: 12px;">
                <i class="fas fa-info-circle"></i> Check this box if the customer has a valid medical prescription. 
                Some items marked as "Prescription Required" can only be discounted with a prescription.
            </small>
        </div>
    `;
    
    discountContainer.insertAdjacentHTML('beforeend', prescriptionHTML);
    
    document.getElementById('prescriptionCheckbox').addEventListener('change', (e) => {
        hasPrescription = e.target.checked;
        
        if (hasPrescription && currentDiscountType !== 'none') {
            showNotification('Prescription verified. Discount will be applied to eligible prescription items.', 'success');
        } else if (!hasPrescription && currentDiscountType !== 'none') {
            const hasPrescriptionOnlyItems = cart.some(item => item.prescriptionRequired === true);
            if (hasPrescriptionOnlyItems) {
                showNotification('Prescription items will be sold at full price. Regular items still get discount.', 'info');
            }
        }
        
        updateCartDisplay();
        if (document.getElementById('checkoutModal') && document.getElementById('checkoutModal').style.display === 'block') {
            updateCheckoutModal();
        }
    });
}

// ==================== NOTIFICATION SYSTEM ====================

function initializeNotifications() {
    createNotificationElements();
    setTimeout(() => checkNotifications(), 2000);
    
    if (notificationInterval) {
        clearInterval(notificationInterval);
    }
    notificationInterval = setInterval(checkNotifications, NOTIFICATION_CHECK_INTERVAL);
}

function createNotificationElements() {
    const notificationContainer = document.querySelector('.notification');
    if (!notificationContainer) return;
    
    notificationContainer.innerHTML = `
        <div class="notification-wrapper" style="position: relative; cursor: pointer;">
            <div class="notification-icon" style="width: 45px; height: 45px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
                <i class="fas fa-bell" style="color: white; font-size: 20px;"></i>
            </div>
            <span class="badge" style="position: absolute; top: -8px; right: -8px; background: #e74c3c; color: white; font-size: 12px; padding: 4px 8px; border-radius: 20px; min-width: 24px; text-align: center; font-weight: 600; border: 2px solid white; display: none; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">0</span>
        </div>
    `;
    
    notificationBadge = notificationContainer.querySelector('.badge');
    
    const notificationIcon = notificationContainer.querySelector('.notification-icon');
    if (notificationIcon) {
        notificationIcon.addEventListener('mouseenter', () => {
            notificationIcon.style.transform = 'scale(1.05)';
            notificationIcon.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
        });
        
        notificationIcon.addEventListener('mouseleave', () => {
            notificationIcon.style.transform = 'scale(1)';
            notificationIcon.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.3)';
        });
    }
    
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
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .notification-item { transition: all 0.2s ease; border: 1px solid transparent; margin-bottom: 8px; }
            .notification-item:hover { transform: translateX(-3px); border-color: rgba(0,0,0,0.05); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .notification-refresh-btn:hover, .notification-close-btn:hover { background: rgba(255,255,255,0.3) !important; transform: rotate(90deg); }
            .view-all-notifications:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); }
            #notificationPopupBody::-webkit-scrollbar { width: 6px; }
            #notificationPopupBody::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 10px; }
            #notificationPopupBody::-webkit-scrollbar-thumb { background: #cbd5e0; border-radius: 10px; }
            #notificationPopupBody::-webkit-scrollbar-thumb:hover { background: #a0aec0; }
            @keyframes pulse { 0% { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #e74c3c; } 50% { box-shadow: 0 0 0 2px #fff, 0 0 0 8px #e74c3c; } 100% { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #e74c3c; } }
        `;
        document.head.appendChild(style);
        
        notificationContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleNotificationPopup();
        });
        
        const closeBtn = popup.querySelector('.notification-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                hideNotificationPopup();
                lastPopupDismissed = Date.now();
            });
        }
        
        const refreshBtn = popup.querySelector('.notification-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                checkNotifications(true);
            });
        }
        
        const viewAllBtn = popup.querySelector('.view-all-notifications');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = 'reports.html';
            });
        }
        
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
    if (notificationPopup) notificationPopup.style.display = 'none';
}

function showNotificationPopup() {
    if (!notificationPopup) return;
    const now = Date.now();
    if (now - lastPopupDismissed < POPUP_DISMISS_DURATION) return;
    
    notificationPopup.style.display = 'block';
    loadNotificationDetails();
    
    setTimeout(() => {
        if (notificationPopup && notificationPopup.style.display === 'block') {
            notificationPopup.style.display = 'none';
        }
    }, 10000);
}

function getLowStockThreshold(category, subcategory) {
    const categoryLower = (category || '').toLowerCase();
    const subcategoryLower = (subcategory || '').toLowerCase();
    
    if (categoryLower === 'rx' || categoryLower === 'rx medicine') {
        if (subcategoryLower === 'syrup') return 5;
        return 50;
    }
    if (categoryLower === 'over the counter' || categoryLower === 'otc') {
        if (subcategoryLower === 'syrup') return 5;
        return 30;
    }
    if (categoryLower === 'food' || categoryLower === 'foods') return 5;
    if (categoryLower === 'general merchandise' || categoryLower === 'merchandise') return 2;
    return 10;
}

function isLowStock(stock, category, subcategory) {
    if (stock === 0) return false;
    const threshold = getLowStockThreshold(category, subcategory);
    return stock < threshold;
}

async function checkNotifications(forceRefresh = false) {
    try {
        const [productsSnapshot, stockItemsSnapshot] = await Promise.all([
            getDocs(collection(db, "products")),
            getDocs(collection(db, "stock_items"))
        ]);
        
        const productsMap = new Map();
        productsSnapshot.forEach(doc => productsMap.set(doc.id, doc.data()));
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const threeDaysFromNow = new Date(today); threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
        const sevenDaysFromNow = new Date(today); sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        
        let expiringUrgent = 0, expiringWarning = 0, lowStockCount = 0;
        const expiringProducts = [], lowStockProducts = [];
        
        const availableStockMap = new Map();
        
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            if (item.status === 'available' && item.productId) {
                availableStockMap.set(item.productId, (availableStockMap.get(item.productId) || 0) + 1);
                
                if (item.expiryDate) {
                    const expiryDate = item.expiryDate.toDate();
                    expiryDate.setHours(0, 0, 0, 0);
                    
                    let productName = item.productName || 'Unknown';
                    let productSubcategory = '';
                    if (item.productId && productsMap.has(item.productId)) {
                        const product = productsMap.get(item.productId);
                        productName = product.brand || product.name || productName;
                        productSubcategory = product.subcategory || '';
                    }
                    
                    if (expiryDate <= threeDaysFromNow) {
                        expiringUrgent++;
                        expiringProducts.push({
                            name: productName,
                            serial: item.serialNumber,
                            expiryDate,
                            type: 'urgent',
                            daysLeft: Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24)),
                            subcategory: productSubcategory
                        });
                    } else if (expiryDate <= sevenDaysFromNow) {
                        expiringWarning++;
                        expiringProducts.push({
                            name: productName,
                            serial: item.serialNumber,
                            expiryDate,
                            type: 'warning',
                            daysLeft: Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24)),
                            subcategory: productSubcategory
                        });
                    }
                }
            }
        });
        
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            const actualStock = availableStockMap.get(doc.id) || 0;
            
            if (actualStock > 0 && isLowStock(actualStock, product.category, product.subcategory)) {
                lowStockCount++;
                const productName = product.brand || product.name || 'Unknown';
                const threshold = getLowStockThreshold(product.category, product.subcategory);
                const subcategoryText = product.subcategory ? ` (${product.subcategory})` : '';
                const syrupBadge = product.subcategory === 'syrup' ? ' SYRUP - ' : '';
                
                lowStockProducts.push({
                    name: syrupBadge + productName + subcategoryText,
                    stock: actualStock,
                    threshold,
                    category: product.category,
                    subcategory: product.subcategory
                });
            }
        });
        
        expiringProducts.sort((a, b) => {
            if (a.type === 'urgent' && b.type !== 'urgent') return -1;
            if (a.type !== 'urgent' && b.type === 'urgent') return 1;
            return a.daysLeft - b.daysLeft;
        });
        
        lowStockProducts.sort((a, b) => (a.stock / a.threshold) - (b.stock / b.threshold));
        
        const totalNotifications = expiringUrgent + expiringWarning + lowStockCount;
        
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
        
        window.notificationData = { expiringUrgent, expiringWarning, lowStockCount, expiringProducts, lowStockProducts, lastCheck: new Date() };
        
        const lastCheckSpan = document.getElementById('lastNotificationCheck');
        if (lastCheckSpan) lastCheckSpan.textContent = formatTimeAgo(new Date());
        
        if (totalNotifications > 0) showNotificationPopup();
        
    } catch (error) {
        console.error("Error checking notifications:", error);
    }
}

function formatTimeAgo(date) {
    const now = new Date();
    const diffMins = Math.floor((now - date) / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

function formatExpiryDate(date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays < 0) return 'Expired';
    return `in ${diffDays} days`;
}

async function loadNotificationDetails() {
    const popupBody = document.getElementById('notificationPopupBody');
    if (!popupBody) return;
    
    const data = window.notificationData || { expiringUrgent: 0, expiringWarning: 0, lowStockCount: 0, expiringProducts: [], lowStockProducts: [] };
    
    if (data.expiringUrgent === 0 && data.expiringWarning === 0 && data.lowStockCount === 0) {
        popupBody.innerHTML = `<div class="no-notifications" style="text-align: center; padding: 60px 20px;"><div style="width: 80px; height: 80px; background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;"><i class="fas fa-check-circle" style="font-size: 40px; color: #0284c7;"></i></div><h4 style="margin: 0 0 10px; color: #2c3e50; font-size: 18px;">All Clear!</h4><p style="margin: 0; color: #7f8c8d; font-size: 14px;">No notifications at this time.</p></div>`;
        return;
    }
    
    let html = '';
    
    const urgentItems = data.expiringProducts.filter(p => p.type === 'urgent');
    if (urgentItems.length > 0) {
        html += `<div style="margin-bottom: 20px;"><div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 5px;"><div style="display: flex; align-items: center; gap: 8px;"><div style="width: 8px; height: 8px; background: #e74c3c; border-radius: 50%;"></div><h4 style="margin: 0; font-size: 14px; color: #e74c3c; font-weight: 600;">URGENT - Expiring Soon</h4></div><span style="background: #fdf3f2; color: #e74c3c; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;">${urgentItems.length} items</span></div>`;
        urgentItems.forEach(p => {
            const expiryText = formatExpiryDate(p.expiryDate);
            html += `<div class="notification-item urgent" style="background: #fdf3f2; border-left: 4px solid #e74c3c; border-radius: 10px; padding: 15px; margin-bottom: 8px; cursor: pointer;" onclick="window.location.href='inventory.html'"><div style="display: flex; align-items: flex-start; gap: 12px;"><div style="width: 36px; height: 36px; background: rgba(231, 76, 60, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;"><i class="fas fa-exclamation-triangle" style="color: #e74c3c; font-size: 16px;"></i></div><div style="flex: 1;"><div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">${p.name}</div><div style="font-size: 12px; color: #7f8c8d; display: flex; gap: 15px; flex-wrap: wrap;"><span><i class="fas fa-barcode"></i> ${p.serial || 'N/A'}</span><span><i class="far fa-clock"></i> Expires ${expiryText}</span></div></div></div></div>`;
        });
        html += `</div>`;
    }
    
    const warningItems = data.expiringProducts.filter(p => p.type === 'warning');
    if (warningItems.length > 0) {
        html += `<div style="margin-bottom: 20px;"><div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 5px;"><div style="display: flex; align-items: center; gap: 8px;"><div style="width: 8px; height: 8px; background: #f39c12; border-radius: 50%;"></div><h4 style="margin: 0; font-size: 14px; color: #f39c12; font-weight: 600;">Expiring Soon</h4></div><span style="background: #fef9e7; color: #f39c12; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;">${warningItems.length} items</span></div>`;
        warningItems.forEach(p => {
            const expiryText = formatExpiryDate(p.expiryDate);
            html += `<div class="notification-item warning" style="background: #fef9e7; border-left: 4px solid #f39c12; border-radius: 10px; padding: 15px; margin-bottom: 8px; cursor: pointer;" onclick="window.location.href='inventory.html'"><div style="display: flex; align-items: flex-start; gap: 12px;"><div style="width: 36px; height: 36px; background: rgba(243, 156, 18, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;"><i class="fas fa-clock" style="color: #f39c12; font-size: 16px;"></i></div><div style="flex: 1;"><div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">${p.name}</div><div style="font-size: 12px; color: #7f8c8d; display: flex; gap: 15px; flex-wrap: wrap;"><span><i class="fas fa-barcode"></i> ${p.serial || 'N/A'}</span><span><i class="far fa-clock"></i> Expires ${expiryText}</span></div></div></div></div>`;
        });
        html += `</div>`;
    }
    
    if (data.lowStockProducts.length > 0) {
        const syrupItems = data.lowStockProducts.filter(p => p.name.includes('SYRUP'));
        const otherItems = data.lowStockProducts.filter(p => !p.name.includes('SYRUP'));
        
        if (syrupItems.length > 0) {
            html += `<div style="margin-bottom: 20px;"><div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 5px;"><div style="display: flex; align-items: center; gap: 8px;"><div style="width: 8px; height: 8px; background: #9b59b6; border-radius: 50%;"></div><h4 style="margin: 0; font-size: 14px; color: #9b59b6; font-weight: 600;"><i class="fas fa-flask"></i> SYRUP Low Stock Alert</h4></div><span style="background: #f3e5f5; color: #9b59b6; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;">${syrupItems.length} items</span></div>`;
            syrupItems.forEach(product => {
                const percentRemaining = Math.round((product.stock / product.threshold) * 100);
                const barColor = percentRemaining < 20 ? '#e74c3c' : (percentRemaining < 50 ? '#f39c12' : '#9b59b6');
                html += `<div class="notification-item low-stock" style="background: #f3e5f5; border-left: 4px solid #9b59b6; border-radius: 10px; padding: 15px; margin-bottom: 8px; cursor: pointer;" onclick="window.location.href='inventory.html'"><div style="display: flex; align-items: flex-start; gap: 12px;"><div style="width: 36px; height: 36px; background: rgba(155, 89, 182, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;"><i class="fas fa-flask" style="color: #9b59b6; font-size: 16px;"></i></div><div style="flex: 1;"><div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;"><span style="font-weight: 600; color: #2c3e50;">${product.name.replace(' SYRUP - ', '')}</span><span style="background: ${barColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600;">${percentRemaining}%</span></div><div style="font-size: 12px; color: #7f8c8d; margin-bottom: 8px;">Stock: ${product.stock} / ${product.threshold} units (Syrup threshold: 5)</div><div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;"><div style="width: ${percentRemaining}%; height: 100%; background: ${barColor}; border-radius: 3px; transition: width 0.3s ease;"></div></div></div></div></div>`;
            });
            html += `</div>`;
        }
        
        if (otherItems.length > 0) {
            html += `<div style="margin-bottom: 20px;"><div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 5px;"><div style="display: flex; align-items: center; gap: 8px;"><div style="width: 8px; height: 8px; background: #3498db; border-radius: 50%;"></div><h4 style="margin: 0; font-size: 14px; color: #3498db; font-weight: 600;">Low Stock Alert</h4></div><span style="background: #e8f4fd; color: #3498db; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;">${otherItems.length} items</span></div>`;
            otherItems.forEach(product => {
                const percentRemaining = Math.round((product.stock / product.threshold) * 100);
                const barColor = percentRemaining < 20 ? '#e74c3c' : (percentRemaining < 50 ? '#f39c12' : '#3498db');
                html += `<div class="notification-item low-stock" style="background: #e8f4fd; border-left: 4px solid #3498db; border-radius: 10px; padding: 15px; margin-bottom: 8px; cursor: pointer;" onclick="window.location.href='inventory.html'"><div style="display: flex; align-items: flex-start; gap: 12px;"><div style="width: 36px; height: 36px; background: rgba(52, 152, 219, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;"><i class="fas fa-boxes" style="color: #3498db; font-size: 16px;"></i></div><div style="flex: 1;"><div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;"><span style="font-weight: 600; color: #2c3e50;">${product.name}</span><span style="background: ${barColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600;">${percentRemaining}%</span></div><div style="font-size: 12px; color: #7f8c8d; margin-bottom: 8px;">Stock: ${product.stock} / ${product.threshold} units</div><div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;"><div style="width: ${percentRemaining}%; height: 100%; background: ${barColor}; border-radius: 3px; transition: width 0.3s ease;"></div></div></div></div></div>`;
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
    
    discountContainer.innerHTML = `
        <div class="discount-options">
            <label class="discount-option">
                <input type="radio" name="discountType" value="none" checked>
                <span class="discount-option-label">No Discount</span>
            </label>
            <label class="discount-option">
                <input type="radio" name="discountType" value="seniorPWD">
                <span class="discount-option-label"><i class="fas fa-id-card"></i> Senior / PWD (20%)</span>
            </label>
            <label class="discount-option">
                <input type="radio" name="discountType" value="yakap">
                <span class="discount-option-label"><i class="fas fa-heart"></i> YAKAP (30%)</span>
            </label>
        </div>
    `;
    
    const radioButtons = document.querySelectorAll('input[name="discountType"]');
    radioButtons.forEach(radio => {
        radio.addEventListener('change', handleDiscountChange);
    });
}

function handleDiscountChange(e) {
    const newDiscountType = e.target.value;
    
    if (cart.length === 0) {
        showNotification('Add items to cart first', 'info');
        document.querySelector('input[name="discountType"][value="none"]').checked = true;
        return;
    }
    
    if (newDiscountType !== 'none') {
        const nonDiscountableItems = cart.filter(item => item.discountable === false);
        const prescriptionRequiredItems = cart.filter(item => item.prescriptionRequired === true);
        
        if (nonDiscountableItems.length > 0) {
            const names = nonDiscountableItems.map(item => item.brand).join(', ');
            showNotification(`Note: ${names} ${nonDiscountableItems.length === 1 ? 'is' : 'are'} not eligible for discount`, 'info');
        }
        
        if (prescriptionRequiredItems.length > 0 && !hasPrescription) {
            const names = prescriptionRequiredItems.map(item => item.brand).join(', ');
            showNotification(`Prescription required for: ${names}. These items will be sold at full price. Regular items will get discount.`, 'info');
        }
    }
    
    currentDiscountType = newDiscountType;
    currentDiscount = newDiscountType === 'none' ? 0 : DISCOUNT_RATES[newDiscountType];
    
    updateCartDisplay();
    if (document.getElementById('checkoutModal') && 
        document.getElementById('checkoutModal').style.display === 'block') {
        updateCheckoutModal();
    }
    
    if (newDiscountType === 'seniorPWD') {
        showNotification('Senior/PWD discount applied (20%)', 'success');
    } else if (newDiscountType === 'yakap') {
        showNotification('YAKAP discount applied (30%)', 'success');
    } else {
        showNotification('Discount removed', 'info');
    }
}

// ==================== SELL EXPIRING FIRST TOGGLE ====================

function setupSellExpiringToggle() {
    const cartHeader = document.querySelector('.cart-header');
    if (cartHeader && !document.getElementById('sellExpiringToggle')) {
        const toggleHTML = `
            <div class="sell-expiring-toggle" id="sellExpiringToggle">
                <label class="toggle-label">
                    <input type="checkbox" id="sellExpiringCheckbox" checked>
                    <span class="toggle-text"><i class="fas fa-clock"></i> Sell Expiring First</span>
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

async function getStockItemsWithCache(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && stockItemsCache.data && (now - stockItemsCache.timestamp) < STOCK_CACHE_DURATION) {
        return stockItemsCache.data;
    }
    
    const snapshot = await getDocs(collection(db, "stock_items"));
    stockItemsCache = { data: snapshot, timestamp: now };
    return snapshot;
}

// ==================== PRODUCT LOADING ====================

function loadProducts() {
    try {
        const productsGrid = document.getElementById('productsGrid');
        if (!productsGrid) return;
        
        productsGrid.innerHTML = '<div class="loading">Loading products...</div>';
        
        if (unsubscribeProducts) unsubscribeProducts();
        
        const productsRef = collection(db, "products");
        let updateTimeout;
        
        unsubscribeProducts = onSnapshot(productsRef, async (snapshot) => {
            if (updateTimeout) clearTimeout(updateTimeout);
            
            updateTimeout = setTimeout(async () => {
                if (snapshot.empty) {
                    productsGrid.innerHTML = '<p class="no-data">No products available</p>';
                    return;
                }
                
                const stockItemsSnapshot = await getStockItemsWithCache();
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const thirtyDaysFromNow = new Date(today); thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                
                const expiryMap = new Map();
                
                stockItemsSnapshot.forEach(doc => {
                    const item = doc.data();
                    if (item.expiryDate && item.status === 'available' && item.productId) {
                        const expiryDate = item.expiryDate.toDate();
                        expiryDate.setHours(0, 0, 0, 0);
                        
                        if (expiryDate <= thirtyDaysFromNow) {
                            if (!expiryMap.has(item.productId)) {
                                expiryMap.set(item.productId, {
                                    count: 0,
                                    earliestExpiry: expiryDate,
                                    items: []
                                });
                            }
                            const productExpiry = expiryMap.get(item.productId);
                            productExpiry.count++;
                            productExpiry.items.push({
                                id: doc.id,
                                expiryDate,
                                batchNumber: item.batchNumber,
                                serialNumber: item.serialNumber
                            });
                            if (expiryDate < productExpiry.earliestExpiry) {
                                productExpiry.earliestExpiry = expiryDate;
                            }
                        }
                    }
                });
                
                products = [];
                snapshot.forEach(doc => {
                    const product = { id: doc.id, ...doc.data() };
                    if (expiryMap.has(product.id)) {
                        const expData = expiryMap.get(product.id);
                        product.expiringCount = expData.count;
                        product.earliestExpiry = expData.earliestExpiry;
                        product.expiringItems = expData.items;
                    } else {
                        product.expiringCount = 0;
                        product.expiringItems = [];
                    }
                    products.push(product);
                });
                
                const searchInput = document.getElementById('posSearch');
                const filterSelect = document.getElementById('posCategoryFilter');
                if (searchInput) searchInput.value = '';
                if (filterSelect) filterSelect.value = '';
                
                displayProducts(products);
                updateCartDisplay();
            }, 300);
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
    
    const fragment = document.createDocumentFragment();
    
    productsToShow.forEach(product => {
        const isOutOfStock = (product.stock || 0) <= 0;
        const discountStatus = product.discountable === false ? 'non-discountable' : '';
        
        const productCard = document.createElement('div');
        productCard.className = `product-card ${isOutOfStock ? 'out-of-stock' : ''} ${discountStatus}`;
        productCard.dataset.productId = product.id;
        
        let discountBadge = '';
        if (product.discountable === false) {
            discountBadge = '<span class="non-discount-badge"><i class="fas fa-ban"></i> No Discount</span>';
        } else if (product.discountable === 'prescription') {
            discountBadge = '<span class="prescription-badge"><i class="fas fa-prescription"></i> Rx Required</span>';
        }
        
        const brandName = product.brand || product.name || 'Unnamed';
        const genericName = product.generic ? `<small class="generic-name">${product.generic}</small>` : '';
        
        const syrupBadge = product.subcategory === 'syrup' ? '<span class="syrup-badge"> Syrup</span>' : '';
        
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
            
            expiryWarning = `<div class="${expiryClass}" title="${product.expiringCount} item(s) expiring soon. Earliest: ${product.earliestExpiry.toLocaleDateString()}"><i class="fas fa-clock"></i> ${expiryText}</div>`;
        }
        
        productCard.innerHTML = `
            <div class="product-image"><i class="fas fa-pills"></i></div>
            <h4>${brandName} ${syrupBadge}</h4>
            ${genericName}
            <p class="product-price">₱${(product.price || 0).toFixed(2)}</p>
            <p class="product-stock ${isOutOfStock ? 'text-danger' : ''}">Stock: ${product.stock || 0}</p>
            ${discountBadge}
            ${expiryWarning}
            ${isOutOfStock ? '<span class="out-of-stock-label">OUT OF STOCK</span>' : ''}
            <button class="add-to-cart" ${isOutOfStock ? 'disabled' : ''} data-id="${product.id}">
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

const posSearch = document.getElementById('posSearch');
if (posSearch) {
    posSearch.addEventListener('input', debounce(filterPOSProducts, 300));
}

const posCategoryFilter = document.getElementById('posCategoryFilter');
if (posCategoryFilter) {
    posCategoryFilter.addEventListener('change', filterPOSProducts);
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
    
    if (!product) { showNotification('Product not found', 'error'); return; }
    if ((product.stock || 0) <= 0) { showNotification('This product is out of stock!', 'error'); return; }
    
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
    
    if (currentDiscountType !== 'none') {
        if (product.discountable === false) {
            showNotification(`${product.brand} is not eligible for any discount`, 'info');
        } else if (product.discountable === 'prescription' && !hasPrescription) {
            showNotification(`${product.brand} requires prescription for discount. Will be sold at full price.`, 'info');
        }
    }
    
    const existingItem = cart.find(item => item.id === productId);
    const brandName = product.brand || product.name || 'Product';
    
    if (existingItem) {
        if (existingItem.quantity + 1 > (product.stock || 0)) {
            showNotification(`Only ${product.stock} item(s) available in stock!`, 'error');
            return;
        }
        existingItem.quantity++;
        showNotification(`Added another ${brandName} to cart`, 'success');
    } else {
        cart.push({
            id: product.id || '',
            brand: product.brand || product.name || 'Unknown',
            generic: product.generic || '',
            price: product.price || 0,
            quantity: 1,
            stock: product.stock || 0,
            discountable: product.discountable !== false,
            prescriptionRequired: product.discountable === 'prescription',
            subcategory: product.subcategory || '',
            expiringCount: product.expiringCount || 0,
            earliestExpiry: product.earliestExpiry || null,
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
    
    cartItems.innerHTML = '';
    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="empty-cart">Cart is empty</p>';
        if (subtotalEl) subtotalEl.textContent = '₱0.00';
        if (grandTotalEl) grandTotalEl.textContent = '₱0.00';
        if (discountInfoEl) discountInfoEl.innerHTML = '';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    const today = new Date();
    
    cart.forEach((item, index) => {
        const itemTotal = (item.price || 0) * (item.quantity || 0);
        const product = products.find(p => p.id === item.id);
        const currentStock = product ? (product.stock || 0) : 0;
        
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        
        let discountableBadge = '';
        if (item.discountable === false) {
            discountableBadge = '<span class="non-discount-badge-small"><i class="fas fa-ban"></i> No Discount</span>';
        } else if (item.prescriptionRequired) {
            if (hasPrescription) {
                discountableBadge = '<span class="prescription-badge-small verified"><i class="fas fa-prescription"></i> Rx Verified - Discount Applied</span>';
            } else {
                discountableBadge = '<span class="prescription-badge-small required"><i class="fas fa-exclamation-circle"></i> Rx Required - Full Price</span>';
            }
        }
        
        const genericDisplay = item.generic ? `<small class="generic-cart">${item.generic}</small>` : '';
        const syrupBadge = item.subcategory === 'syrup' ? '<span class="syrup-badge-small">Syrup</span>' : '';
        
        let expiryWarning = '';
        if (item.expiringCount > 0 && item.earliestExpiry) {
            const daysUntil = Math.ceil((item.earliestExpiry - today) / (1000 * 60 * 60 * 24));
            const warningClass = daysUntil <= 7 ? 'expiry-critical-text' : 'expiry-warning-text';
            expiryWarning = `<small class="${warningClass}">⚠️ ${item.expiringCount} expiring in ${daysUntil} days</small>`;
        }
        
        cartItem.innerHTML = `
            <div class="cart-item-info">
                <h4>${item.brand || 'Unknown'} ${syrupBadge} ${discountableBadge}</h4>
                ${genericDisplay}
                <p>₱${(item.price || 0).toFixed(2)} x ${item.quantity || 0}</p>
                <small class="${item.quantity > currentStock ? 'text-danger' : ''}">Available: ${currentStock}</small>
                ${expiryWarning}
            </div>
            <div class="cart-item-actions">
                <span>₱${itemTotal.toFixed(2)}</span>
                <button class="quantity-btn decrease-qty" data-index="${index}"><i class="fas fa-minus"></i></button>
                <span class="quantity">${item.quantity || 0}</span>
                <button class="quantity-btn increase-qty" data-index="${index}" ${item.quantity >= currentStock ? 'disabled' : ''}><i class="fas fa-plus"></i></button>
                <button class="remove-item" data-index="${index}"><i class="fas fa-trash"></i></button>
            </div>
        `;
        fragment.appendChild(cartItem);
    });
    
    cartItems.appendChild(fragment);
    
    document.querySelectorAll('.decrease-qty').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            if (cart[index] && cart[index].quantity > 1) {
                cart[index].quantity--;
            } else if (cart[index]) {
                cart.splice(index, 1);
            }
            updateCartDisplay();
        });
    });
    
    document.querySelectorAll('.increase-qty').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            const item = cart[index];
            if (item) {
                const product = products.find(p => p.id === item.id);
                if (product && item.quantity < (product.stock || 0)) {
                    item.quantity++;
                } else {
                    showNotification(`Only ${product?.stock || 0} items available!`, 'error');
                }
                updateCartDisplay();
            }
        });
    });
    
    document.querySelectorAll('.remove-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            if (cart[index]) {
                cart.splice(index, 1);
                updateCartDisplay();
            }
        });
    });
    
    // Calculate totals with proper discount handling
    let discountableSubtotal = 0;
    let nonDiscountableSubtotal = 0;
    let prescriptionWithoutRxSubtotal = 0;

    cart.forEach(item => {
        const itemTotal = (item.price || 0) * (item.quantity || 0);
        
        if (item.discountable === false) {
            nonDiscountableSubtotal += itemTotal;
        } else if (item.prescriptionRequired) {
            if (hasPrescription) {
                discountableSubtotal += itemTotal;
            } else {
                prescriptionWithoutRxSubtotal += itemTotal;
            }
        } else {
            discountableSubtotal += itemTotal;
        }
    });

    const discountAmount = discountableSubtotal * ((currentDiscount || 0) / 100);
    const grandTotal = discountableSubtotal + nonDiscountableSubtotal + prescriptionWithoutRxSubtotal - discountAmount;

    if (subtotalEl) {
        subtotalEl.textContent = `₱${(discountableSubtotal + nonDiscountableSubtotal + prescriptionWithoutRxSubtotal).toFixed(2)}`;
    }
    if (grandTotalEl) {
        grandTotalEl.textContent = `₱${grandTotal.toFixed(2)}`;
    }

    if (discountInfoEl) {
        if (currentDiscountType !== 'none') {
            const discountName = currentDiscountType === 'seniorPWD' ? 'Senior/PWD' : 'YAKAP';
            const nonDiscountableCount = cart.filter(item => item.discountable === false).length;
            const prescriptionWithoutRxCount = cart.filter(item => 
                item.prescriptionRequired === true && !hasPrescription
            ).length;
            
            let discountHtml = `<div class="discount-info-badge ${currentDiscountType}">
                <i class="fas fa-${currentDiscountType === 'seniorPWD' ? 'id-card' : 'heart'}"></i> 
                ${discountName} Discount (${currentDiscount || 0}%)
            `;
            
            if (nonDiscountableCount > 0) {
                discountHtml += `<br><small style="font-size: 11px;">${nonDiscountableCount} item(s) not eligible for discount</small>`;
            }
            
            if (prescriptionWithoutRxCount > 0) {
                discountHtml += `<br><small style="font-size: 11px; color: #e67e22;"><i class="fas fa-prescription"></i> ${prescriptionWithoutRxCount} prescription item(s) without Rx - no discount applied</small>`;
            }
            
            if (hasPrescription && cart.some(item => item.prescriptionRequired)) {
                discountHtml += `<br><small style="font-size: 11px; color: #27ae60;"><i class="fas fa-check-circle"></i> Prescription verified for eligible items</small>`;
            }
            
            discountHtml += `</div>`;
            discountInfoEl.innerHTML = discountHtml;
        } else {
            discountInfoEl.innerHTML = '';
        }
    }
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
        if (stockItemsSnapshot.empty) return false;
        
        const stockItems = [];
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            let expiryDate = null;
            if (item.expiryDate) {
                expiryDate = item.expiryDate.toDate();
                expiryDate.setHours(0, 0, 0, 0);
            }
            stockItems.push({ id: doc.id, ...item, expiryDate });
        });
        
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
            batch.update(doc(db, "stock_items", stockItem.id), { 
                status: 'sold', 
                soldDate: Timestamp.now(), 
                soldBy: loggedInUserId || '' 
            });
            remainingToDeduct--;
        }
        
        if (remainingToDeduct > 0) return false;
        
        await batch.commit();
        stockItemsCache = { data: null, timestamp: 0 };
        
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
        
        // Check stock availability
        for (const item of cart) {
            const product = products.find(p => p.id === item.id);
            if (!product || (product.stock || 0) < (item.quantity || 0)) {
                showNotification(`Insufficient stock for ${item.brand || 'item'}!`, 'error');
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
            hasPrescription = false;
            
            const prescriptionCheckbox = document.getElementById('prescriptionCheckbox');
            if (prescriptionCheckbox) prescriptionCheckbox.checked = false;
            
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
    let prescriptionWithoutRxSubtotal = 0;
    
    checkoutItems.innerHTML = '';
    
    const fragment = document.createDocumentFragment();
    
    cart.forEach(item => {
        const itemTotal = (item.price || 0) * (item.quantity || 0);
        
        if (item.discountable === false) {
            nonDiscountableSubtotal += itemTotal;
        } else if (item.prescriptionRequired) {
            if (hasPrescription) {
                discountableSubtotal += itemTotal;
            } else {
                prescriptionWithoutRxSubtotal += itemTotal;
            }
        } else {
            discountableSubtotal += itemTotal;
        }
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checkout-item';
        
        let discountStatusBadge = '';
        if (item.discountable === false) {
            discountStatusBadge = '<span class="non-discount-tag">No Discount</span>';
        } else if (item.prescriptionRequired) {
            if (hasPrescription) {
                discountStatusBadge = '<span class="prescription-tag verified">Rx Verified - Discount Applied</span>';
            } else {
                discountStatusBadge = '<span class="prescription-tag required">Rx Required - Full Price</span>';
            }
        }
        
        let expiryNote = '';
        if (item.expiringCount > 0 && sellExpiringFirst) {
            expiryNote = '<small class="expiry-checkout-note">(Expiring items prioritized)</small>';
        }
        
        const displayName = item.generic ? `${item.brand || 'Unknown'} (${item.generic})` : (item.brand || 'Unknown');
        const syrupBadge = item.subcategory === 'syrup' ? ' Syrup' : '';
        
        let priceDisplay = `₱${(item.price || 0).toFixed(2)} x ${item.quantity || 0}`;
        if (item.prescriptionRequired && !hasPrescription) {
            priceDisplay += ` (Full Price - Rx Required)`;
        }
        
        itemDiv.innerHTML = `
            <div class="checkout-product-info">
                <span class="product-name">${displayName}${syrupBadge} ${discountStatusBadge}</span>
                <span class="product-detail">${priceDisplay}</span>
                ${expiryNote}
            </div>
            <span class="product-total">₱${itemTotal.toFixed(2)}</span>
        `;
        fragment.appendChild(itemDiv);
    });
    
    checkoutItems.appendChild(fragment);
    
    const discountPercentage = currentDiscount || 0;
    const discountAmount = discountableSubtotal * (discountPercentage / 100);
    const subtotal = discountableSubtotal + nonDiscountableSubtotal + prescriptionWithoutRxSubtotal;
    const grandTotal = subtotal - discountAmount;
    
    if (checkoutDiscountType) {
        if (currentDiscountType !== 'none' && discountableSubtotal > 0) {
            const discountName = currentDiscountType === 'seniorPWD' ? 'Senior/PWD' : 'YAKAP';
            let prescriptionNote = '';
            
            if (cart.some(item => item.prescriptionRequired)) {
                if (hasPrescription) {
                    prescriptionNote = ' (Rx Verified - All Eligible Items)';
                } else {
                    prescriptionNote = ' (Rx Required Items at Full Price)';
                }
            }
            
            checkoutDiscountType.innerHTML = `<span class="discount-type-badge ${currentDiscountType}"><i class="fas fa-${currentDiscountType === 'seniorPWD' ? 'id-card' : 'heart'}"></i> ${discountName}${prescriptionNote}</span>`;
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
        expiryNote.innerHTML = `<i class="fas fa-${sellExpiringFirst ? 'check-circle' : 'clock'}"></i> ${sellExpiringFirst ? '<span>Sell Expiring First is <strong>ENABLED</strong> - Expiring items will be sold first</span>' : '<span>Sell Expiring First is <strong>DISABLED</strong> - Normal FIFO ordering</span>'}`;
        paymentSection.insertBefore(expiryNote, paymentSection.firstChild);
    }
}

const amountTendered = document.getElementById('amountTendered');
if (amountTendered) {
    amountTendered.addEventListener('input', updateChangeAmount);
}

function updateChangeAmount() {
    const amount = parseFloat(document.getElementById('amountTendered').value) || 0;
    const totalEl = document.getElementById('checkoutTotal');
    if (totalEl) {
        const total = parseFloat(totalEl.textContent.replace('₱', ''));
        const change = amount - total;
        const changeEl = document.getElementById('changeAmount');
        if (changeEl) {
            changeEl.textContent = `₱${change >= 0 ? change.toFixed(2) : '0.00'}`;
        }
    }
}

// ==================== PROCESS PAYMENT ====================

const processPaymentBtn = document.getElementById('processPaymentBtn');
if (processPaymentBtn) {
    processPaymentBtn.addEventListener('click', async () => {
        if (isProcessingPayment) { 
            showNotification('Payment is already being processed...', 'info'); 
            return; 
        }
        
        const paymentMethod = document.getElementById('paymentMethod')?.value || 'cash';
        const amount = parseFloat(document.getElementById('amountTendered')?.value) || 0;
        const totalEl = document.getElementById('checkoutTotal');
        if (!totalEl) return;
        const total = parseFloat(totalEl.textContent.replace('₱', ''));
        
        if (amount < total) { 
            showNotification('Insufficient amount!', 'error'); 
            return; 
        }
        
        // Validate cart items
        if (cart.length === 0) {
            showNotification('Cart is empty!', 'error');
            return;
        }
        
        isProcessingPayment = true;
        processPaymentBtn.disabled = true;
        processPaymentBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        
        try {
            const invoiceNumber = await generateInvoiceNumber();
            const cashierName = document.getElementById('sidebarUserName')?.textContent || 'Unknown';
            
            // Calculate totals with proper handling for all item types
            let discountableSubtotal = 0;
            let nonDiscountableSubtotal = 0;
            let prescriptionWithoutRxSubtotal = 0;
            
            cart.forEach(item => {
                const itemTotal = (item.price || 0) * (item.quantity || 0);
                
                if (item.discountable === false) {
                    nonDiscountableSubtotal += itemTotal;
                } else if (item.prescriptionRequired) {
                    if (hasPrescription) {
                        discountableSubtotal += itemTotal;
                    } else {
                        prescriptionWithoutRxSubtotal += itemTotal;
                    }
                } else {
                    discountableSubtotal += itemTotal;
                }
            });
            
            const discountPercentage = currentDiscount || 0;
            const discountAmount = discountableSubtotal * (discountPercentage / 100);
            const subtotal = discountableSubtotal + nonDiscountableSubtotal + prescriptionWithoutRxSubtotal;
            const totalAmount = subtotal - discountAmount;
            
            const today = new Date(); 
            today.setHours(0, 0, 0, 0);
            
            // Process items with safe values
            const processedItems = cart.map(item => {
                // Safely determine if item was expiring
                let wasExpiring = false;
                if (item.expiringItems && item.expiringItems.length > 0) {
                    wasExpiring = true;
                } else if (item.earliestExpiry) {
                    const daysUntil = Math.ceil((item.earliestExpiry - today) / (1000 * 60 * 60 * 24));
                    wasExpiring = daysUntil <= 30;
                } else if (item.expiringCount && item.expiringCount > 0) {
                    wasExpiring = true;
                }
                
                const itemOriginalTotal = (item.price || 0) * (item.quantity || 0);
                let itemDiscountedTotal = itemOriginalTotal;
                let itemDiscountAmount = 0;
                
                // Determine if this specific item gets discount
                let isDiscountable = false;
                if (item.discountable === false) {
                    isDiscountable = false;
                } else if (item.prescriptionRequired) {
                    isDiscountable = hasPrescription;
                } else {
                    isDiscountable = true;
                }
                
                // Calculate item discount safely
                if (isDiscountable && discountPercentage > 0 && discountableSubtotal > 0) {
                    if (discountableSubtotal > 0) {
                        const itemShare = itemOriginalTotal / discountableSubtotal;
                        itemDiscountAmount = discountAmount * itemShare;
                        itemDiscountedTotal = itemOriginalTotal - itemDiscountAmount;
                    }
                }
                
                return {
                    productId: item.id || '',
                    brand: item.brand || 'Unknown',
                    generic: item.generic || '',
                    subcategory: item.subcategory || '',
                    price: item.price || 0,
                    quantity: item.quantity || 0,
                    originalTotal: itemOriginalTotal || 0,
                    discountAmount: itemDiscountAmount || 0,
                    subtotal: itemDiscountedTotal || 0,
                    discountable: item.discountable !== false,
                    prescriptionRequired: item.prescriptionRequired || false,
                    prescriptionVerified: item.prescriptionRequired ? hasPrescription : false,
                    wasExpiring: wasExpiring || false,
                    expiryCount: item.expiringCount || 0
                };
            });
            
            // Prepare sale data with all fields defined
            const saleData = {
                invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
                discountType: currentDiscountType || 'none',
                discountRate: discountPercentage || 0,
                discountPercentage: discountPercentage || 0,
                discountAmount: discountAmount || 0,
                items: processedItems,
                subtotal: subtotal || 0,
                discountableSubtotal: discountableSubtotal || 0,
                nonDiscountableSubtotal: nonDiscountableSubtotal || 0,
                prescriptionWithoutRxSubtotal: prescriptionWithoutRxSubtotal || 0,
                total: totalAmount || 0,
                paymentMethod: paymentMethod || 'cash',
                amountTendered: amount || 0,
                change: (amount - totalAmount) || 0,
                date: Timestamp.now(),
                cashierId: loggedInUserId || '',
                cashierName: cashierName || 'Unknown',
                sellExpiringFirst: sellExpiringFirst || false,
                hadExpiringItems: cart.some(item => item.expiringCount > 0) || false,
                prescriptionVerified: hasPrescription || false,
                hadPrescriptionRequiredItems: cart.some(item => item.prescriptionRequired === true) || false
            };
            
            // Process payment and update stock
            await Promise.all([
                addDoc(collection(db, "sales"), saleData),
                ...cart.map(item => updateProductStock(item))
            ]);
            
            // Log activity
            let discountText = '';
            if (currentDiscountType === 'seniorPWD') discountText = ' (Senior/PWD 20%)';
            else if (currentDiscountType === 'yakap') discountText = ' (YAKAP 30%)';
            
            if (hasPrescription) discountText += ' [Rx Verified]';
            
            let modeText = sellExpiringFirst ? ' (FEFO - Expiring first)' : ' (FIFO)';
            
            await addDoc(collection(db, "activities"), {
                type: 'sale',
                description: `Sale #${invoiceNumber}: ${cart.length} items for ₱${totalAmount.toFixed(2)}${discountText}${modeText}`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId || ''
            });
            
            showNotification(`Payment successful! Invoice #${invoiceNumber}${discountText}`, 'success');
            
            // Reset cart and state
            cart = [];
            currentDiscountType = 'none';
            currentDiscount = 0;
            hasPrescription = false;
            
            // Reset UI
            const noneRadio = document.querySelector('input[name="discountType"][value="none"]');
            if (noneRadio) noneRadio.checked = true;
            
            const prescriptionCheckbox = document.getElementById('prescriptionCheckbox');
            if (prescriptionCheckbox) prescriptionCheckbox.checked = false;
            
            updateCartDisplay();
            
            // Close modal and reset payment fields
            const checkoutModal = document.getElementById('checkoutModal');
            if (checkoutModal) checkoutModal.style.display = 'none';
            
            const amountTendered = document.getElementById('amountTendered');
            if (amountTendered) amountTendered.value = '';
            
            const changeAmount = document.getElementById('changeAmount');
            if (changeAmount) changeAmount.textContent = '₱0.00';
            
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

async function updateProductStock(item) {
    try {
        if (!item || !item.id) return;
        
        const productRef = doc(db, "products", item.id);
        const productDoc = await getDoc(productRef);
        
        if (productDoc.exists()) {
            const currentStock = productDoc.data().stock || 0;
            const newStock = Math.max(0, currentStock - (item.quantity || 0));
            
            const deductionSuccess = await deductStockWithExpiryPriority(item.id, item.quantity || 0);
            if (!deductionSuccess) {
                throw new Error(`Failed to deduct stock for ${item.brand || 'item'}`);
            }
            
            await updateDoc(productRef, { 
                stock: newStock, 
                lastUpdated: Timestamp.now() 
            });
            
            await addDoc(collection(db, "activities"), {
                type: 'stock',
                description: `${item.brand || 'Item'} stock updated: ${currentStock} → ${newStock} (${sellExpiringFirst ? 'FEFO' : 'FIFO'} mode)`,
                timestamp: Timestamp.now(),
                userId: loggedInUserId || ''
            });
            
            if (newStock === 0) {
                await addDoc(collection(db, "activities"), {
                    type: 'stock',
                    description: `${item.brand || 'Item'} is now out of stock`,
                    timestamp: Timestamp.now(),
                    userId: loggedInUserId || ''
                });
            }
        }
    } catch (error) {
        console.error("Error updating product stock:", error);
        throw error;
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

const exchangeButton = document.getElementById('exchangeButton');
if (exchangeButton) {
    exchangeButton.addEventListener('click', () => {
        showNotification('Exchange feature is being set up', 'info');
    });
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

// Add CSS for new badges and improved UI
const style = document.createElement('style');
style.textContent = `
    .discount-options {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 12px;
        margin-bottom: 15px;
    }
    
    .discount-option {
        display: flex;
        align-items: center;
        padding: 12px 15px;
        background: white;
        border: 2px solid #e9ecef;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .discount-option:hover {
        border-color: #3498db;
        transform: translateY(-2px);
        box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    }
    
    .discount-option input[type="radio"] {
        width: 18px;
        height: 18px;
        margin-right: 12px;
        cursor: pointer;
        accent-color: #3498db;
    }
    
    .discount-option-label {
        font-size: 14px;
        font-weight: 500;
        color: #2c3e50;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .discount-option-label i {
        color: #3498db;
        font-size: 16px;
    }
    
    .discount-info-badge {
        padding: 12px 15px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 15px;
        animation: slideIn 0.3s ease;
    }
    
    .discount-info-badge.seniorPWD {
        background: linear-gradient(135deg, #e8f4fd 0%, #d4e6f1 100%);
        color: #2874a6;
        border-left: 4px solid #3498db;
    }
    
    .discount-info-badge.yakap {
        background: linear-gradient(135deg, #fef9e7 0%, #fef5e7 100%);
        color: #b85e00;
        border-left: 4px solid #f39c12;
    }
    
    .discount-info-badge.warning {
        background: #fff3cd;
        color: #856404;
        border-left: 4px solid #ffc107;
    }
    
    .syrup-badge {
        display: inline-block;
        background: #9b59b6;
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 5px;
    }
    
    .syrup-badge-small {
        display: inline-block;
        background: #9b59b6;
        color: white;
        font-size: 8px;
        padding: 2px 4px;
        border-radius: 3px;
        margin-left: 3px;
    }
    
    .prescription-badge {
        background: #e3f2fd;
        color: #0d47a1;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 10px;
        display: inline-block;
    }
    
    .prescription-badge-small {
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 9px;
        display: inline-block;
    }
    
    .prescription-badge-small.verified {
        background: #d4edda;
        color: #155724;
    }
    
    .prescription-badge-small.required {
        background: #fff3cd;
        color: #856404;
    }
    
    .prescription-tag {
        font-size: 9px;
        padding: 2px 4px;
        border-radius: 4px;
        margin-left: 5px;
    }
    
    .prescription-tag.verified {
        background: #d4edda;
        color: #155724;
    }
    
    .prescription-tag.required {
        background: #fff3cd;
        color: #856404;
    }
    
    .non-discount-tag {
        background: #fed7d7;
        color: #742a2a;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 9px;
        margin-left: 5px;
    }
    
    .non-discount-badge-small {
        background: #fed7d7;
        color: #742a2a;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 9px;
        display: inline-block;
        margin-left: 5px;
    }
    
    .checkout-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        border-bottom: 1px solid #eef2f6;
        transition: background 0.2s;
    }
    
    .checkout-item:hover {
        background: #f8fafc;
    }
    
    .checkout-product-info {
        flex: 1;
    }
    
    .product-name {
        font-weight: 600;
        color: #2c3e50;
        font-size: 14px;
        display: block;
        margin-bottom: 4px;
    }
    
    .product-detail {
        font-size: 12px;
        color: #7f8c8d;
        display: block;
    }
    
    .product-total {
        font-weight: 600;
        color: #2c3e50;
        font-size: 14px;
        margin-left: 15px;
    }
    
    .expiry-checkout-note {
        display: block;
        font-size: 10px;
        color: #e67e22;
        margin-top: 4px;
    }
    
    .discount-type-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 500;
    }
    
    .discount-type-badge.seniorPWD {
        background: #e8f4fd;
        color: #2874a6;
    }
    
    .discount-type-badge.yakap {
        background: #fef9e7;
        color: #b85e00;
    }
    
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
`;
document.head.appendChild(style);