import { auth, db, doc, getDoc, collection, getDocs, query, where, orderBy, Timestamp, limit } from './firebase-config.js';
import { fetchUserData } from './auth.js';

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

// Helper function to determine low stock threshold based on category
function getLowStockThreshold(category) {
    const categoryLower = (category || '').toLowerCase();
    if (categoryLower === 'medicines' || categoryLower === 'medicine') {
        return 100; // Medicines threshold - less than 100 is low stock
    } else if (categoryLower === 'drinks' || categoryLower === 'beverages') {
        return 20; // Drinks threshold - less than 20 is low stock
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
});

async function initializeDashboard() {
    await loadUserData();
    updateDateTime();
    loadDashboardStats();
    setupSidebar();
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

// ==================== DASHBOARD FUNCTIONS ====================

async function loadDashboardStats() {
    try {
        // Get total products
        const productsSnapshot = await getDocs(collection(db, "products"));
        document.getElementById('totalProducts').textContent = productsSnapshot.size;
        
        // Get all available stock items
        const stockItemsQuery = query(
            collection(db, "stock_items"),
            where("status", "==", "available")
        );
        const stockItemsSnapshot = await getDocs(stockItemsQuery);
        
        // Create a map of productId -> count of available stock
        const availableStockMap = new Map();
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            const productId = item.productId;
            if (productId) {
                availableStockMap.set(productId, (availableStockMap.get(productId) || 0) + 1);
            }
        });
        
        // Create a map of productId -> product data for quick access
        const productsMap = new Map();
        productsSnapshot.forEach(doc => {
            productsMap.set(doc.id, doc.data());
        });
        
        // Get low stock count based on category-specific thresholds
        let lowStock = 0;
        productsSnapshot.forEach(doc => {
            const productId = doc.id;
            const product = doc.data();
            const actualStock = availableStockMap.get(productId) || 0;
            
            // Use the same threshold logic as inventory.js
            if (actualStock > 0 && isLowStock(actualStock, product.category)) {
                lowStock++;
            }
        });
        document.getElementById('lowStockCount').textContent = lowStock;
        
        // Get today's sales
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
        
        let totalSales = 0;
        salesSnapshot.forEach(doc => totalSales += doc.data().total || 0);
        document.getElementById('todaySales').textContent = `₱${totalSales.toFixed(2)}`;
        
        // ===== GET EXPIRING ITEMS COUNT =====
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
        
        document.getElementById('expiringCount').textContent = expiringCount;
        
        // Make cards clickable
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
        
        await loadRecentActivities();
        
    } catch (error) {
        console.error("Error loading dashboard stats:", error);
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
        
        // Get all stock items
        const stockItemsSnapshot = await getDocs(collection(db, "stock_items"));
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        thirtyDaysFromNow.setHours(23, 59, 59, 999);
        
        const expiringItems = [];
        const productsMap = new Map(); // To store product details
        
        // First, get all products to have their names
        const productsSnapshot = await getDocs(collection(db, "products"));
        productsSnapshot.forEach(doc => {
            productsMap.set(doc.id, doc.data());
        });
        
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            if (item.expiryDate && item.status === 'available') {
                // Convert Timestamp to Date
                let expiryDate;
                if (item.expiryDate.toDate) {
                    expiryDate = item.expiryDate.toDate();
                } else {
                    expiryDate = new Date(item.expiryDate);
                }
                expiryDate.setHours(0, 0, 0, 0);
                
                if (expiryDate <= thirtyDaysFromNow) {
                    // Get product name from products map or from item
                    let productName = item.productName || 'Unknown Product';
                    let productBrand = '';
                    let productGeneric = '';
                    
                    // If we have the productId, try to get it from productsMap
                    if (item.productId && productsMap.has(item.productId)) {
                        const product = productsMap.get(item.productId);
                        productBrand = product.brand || '';
                        productGeneric = product.generic || '';
                        // Use brand as product name if available
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
                        expiryDate: expiryDate // This is now a proper Date object
                    });
                }
            }
        });
        
        // Sort by expiry date (closest first)
        expiringItems.sort((a, b) => a.expiryDate - b.expiryDate);
        
        // Group by product
        const groupedByProduct = {};
        expiringItems.forEach(item => {
            // Use brand name if available, otherwise use productName
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
        let criticalCount = 0;
        expiringItems.forEach(item => {
            const daysUntil = Math.ceil((item.expiryDate - today) / (1000 * 60 * 60 * 24));
            if (daysUntil <= 7) criticalCount++;
        });
        
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
            
            // Display each product group
            for (const [productName, data] of Object.entries(groupedByProduct)) {
                // Find earliest expiry in this group
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
                
                // Create display name with generic if available
                const displayName = data.generic ? `${productName} (${data.generic})` : productName;
                
                // Create a safe ID for the product
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
                
                // Add individual items
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
    // Check if modal already exists
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
        if (subitems.style.display === 'none') {
            subitems.style.display = 'block';
        } else {
            subitems.style.display = 'none';
        }
    }
};

// ==================== LOW STOCK MODAL - FIXED ====================

async function openLowStockModal() {
    try {
        // Create modal if it doesn't exist
        if (!document.getElementById('lowStockModal')) {
            createLowStockModal();
        }
        
        const modal = document.getElementById('lowStockModal');
        const modalBody = document.getElementById('lowStockModalBody');
        
        modalBody.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading low stock products...</p></div>';
        modal.style.display = 'block';
        
        // Get all products
        const productsSnapshot = await getDocs(collection(db, "products"));
        
        // Get all available stock items to count actual available stock
        const stockItemsQuery = query(
            collection(db, "stock_items"),
            where("status", "==", "available")
        );
        const stockItemsSnapshot = await getDocs(stockItemsQuery);
        
        // Create a map of productId -> count of available stock
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
            
            // Get actual available stock from stock_items
            const actualStock = availableStockMap.get(productId) || 0;
            
            // Check if product has low stock based on category-specific threshold
            if (actualStock > 0 && isLowStock(actualStock, product.category)) {
                lowStockProducts.push({ 
                    id: doc.id, 
                    ...product,
                    actualStock: actualStock // Use actual stock from stock_items
                });
            }
        });
        
        lowStockProducts.sort((a, b) => a.actualStock - b.actualStock);
        
        if (lowStockProducts.length === 0) {
            modalBody.innerHTML = '<div class="modal-empty"><i class="fas fa-check-circle" style="font-size: 48px; color: #27ae60;"></i><p>No low stock products found!</p></div>';
            return;
        }
        
        // Calculate critical count (stock < 5 for any category)
        const criticalCount = lowStockProducts.filter(p => p.actualStock < 5).length;
        
        let html = `
            <div class="modal-stats-summary">
                <div class="modal-stat">
                    <span class="modal-stat-label">Total Low Stock:</span>
                    <span class="modal-stat-value">${lowStockProducts.length}</span>
                </div>
                <div class="modal-stat">
                    <span class="modal-stat-label">Critical (Stock < 5):</span>
                    <span class="modal-stat-value critical">${criticalCount}</span>
                </div>
            </div>
            <div class="modal-items-container">
        `;
        
        lowStockProducts.forEach(product => {
            const stockClass = product.actualStock < 5 ? 'critical-stock' : 'warning-stock';
            
            // Use brand as product name, and show generic if available
            const productName = product.brand || product.name || 'Unnamed Product';
            const genericDisplay = product.generic ? ` (${product.generic})` : '';
            const displayName = productName + genericDisplay;
            
            // Add threshold info to tooltip
            const threshold = getLowStockThreshold(product.category);
            
            html += `
                <div class="modal-item">
                    <div class="modal-item-info">
                        <div class="modal-item-name">
                            <strong>${displayName}</strong>
                            ${product.code ? `<span class="item-code">${product.code}</span>` : ''}
                        </div>
                        <div class="modal-item-details">
                            <span><i class="fas fa-tag"></i> ${product.category || 'N/A'}</span>
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
        // Create modal if it doesn't exist
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
        
        activitiesList.innerHTML = '<div class="loading">Loading activities...</div>';
        
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
            activitiesList.appendChild(activityElement);
        });
        
    } catch (error) {
        console.error("Error loading activities:", error);
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
            // Use brand and generic for display
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