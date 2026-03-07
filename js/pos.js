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
let currentDiscountType = 'none'; // 'seniorPWD', 'yakap', or 'none'
let isProcessingPayment = false;
let unsubscribeProducts = null;
let sellExpiringFirst = true; // Default to true to prioritize expiring items

// Discount rates
const DISCOUNT_RATES = {
    seniorPWD: 20, // 20% discount for Senior/PWD
    yakap: 10      // 10% discount for YAKAP
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializePOS();
    setupEventListeners();
});

async function initializePOS() {
    await loadUserData();
    updateDateTime();
    loadProducts();
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

// ==================== DISCOUNT OPTIONS SETUP ====================

function setupDiscountOptions() {
    const discountContainer = document.querySelector('.discount-container');
    if (!discountContainer) return;
    
    // Replace the existing select with radio buttons
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
                    <i class="fas fa-heart"></i> YAKAP (10%)
                </span>
            </label>
        </div>
    `;
    
    discountContainer.innerHTML = discountHTML;
    
    // Add event listeners to radio buttons
    document.querySelectorAll('input[name="discountType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentDiscountType = e.target.value;
            if (currentDiscountType === 'none') {
                currentDiscount = 0;
            } else {
                currentDiscount = DISCOUNT_RATES[currentDiscountType];
            }
            updateCartDisplay();
            if (document.getElementById('checkoutModal').style.display === 'block') {
                updateCheckoutModal();
            }
            
            // Show notification
            if (currentDiscountType === 'seniorPWD') {
                showNotification('Senior/PWD discount applied (20%)', 'info');
            } else if (currentDiscountType === 'yakap') {
                showNotification('YAKAP discount applied (10%)', 'info');
            }
        });
    });
}

// ==================== SELL EXPIRING FIRST TOGGLE ====================

function setupSellExpiringToggle() {
    // Create toggle if it doesn't exist
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
        
        unsubscribeProducts = onSnapshot(productsRef, async (snapshot) => {
            products = [];
            
            if (snapshot.empty) {
                productsGrid.innerHTML = '<p class="no-data">No products available</p>';
                return;
            }
            
            // Get all stock items to check expiry
            const stockItemsSnapshot = await getDocs(collection(db, "stock_items"));
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thirtyDaysFromNow = new Date(today);
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            
            // Create a map of product expiry info
            const expiryMap = new Map();
            
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
                        const productId = item.productId;
                        if (!expiryMap.has(productId)) {
                            expiryMap.set(productId, {
                                count: 0,
                                earliestExpiry: expiryDate,
                                items: [] // Store individual expiring items
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
            
            snapshot.forEach(doc => {
                const product = { id: doc.id, ...doc.data() };
                // Add expiry info to product
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
        
        // Display brand and generic names
        const brandName = product.brand || product.name || 'Unnamed';
        const genericName = product.generic ? `<small class="generic-name">${product.generic}</small>` : '';
        
        // Add expiry warning if product has items expiring soon
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
        productsGrid.appendChild(productCard);
    });
    
    document.querySelectorAll('.add-to-cart:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => addToCart(btn.dataset.id));
    });
}

// Filter functions
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
            p.brand?.toLowerCase().includes(searchTerm) || 
            p.generic?.toLowerCase().includes(searchTerm) ||
            p.code?.toLowerCase().includes(searchTerm)
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

// Cart Functions with Expiry Warnings
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
    
    cartItems.innerHTML = '';
    let subtotal = 0;
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="empty-cart">Cart is empty</p>';
        if (subtotalEl) subtotalEl.textContent = '₱0.00';
        if (grandTotalEl) grandTotalEl.textContent = '₱0.00';
        if (discountInfoEl) discountInfoEl.innerHTML = '';
        return;
    }
    
    // Add discount info display
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
        
        // Add generic name if available
        const genericDisplay = item.generic ? `<small class="generic-cart">${item.generic}</small>` : '';
        
        // Add expiry warning in cart if item has expiring items
        let expiryWarning = '';
        if (item.expiringCount > 0) {
            const today = new Date();
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
        cartItems.appendChild(cartItem);
    });
    
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
    
    // Calculate totals with discount
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
    
    if (subtotalEl) subtotalEl.textContent = `₱${(discountableSubtotal + nonDiscountableSubtotal).toFixed(2)}`;
    if (grandTotalEl) grandTotalEl.textContent = `₱${grandTotal.toFixed(2)}`;
}

// ==================== DEDUCT STOCK WITH EXPIRY PRIORITY ====================

async function deductStockWithExpiryPriority(productId, quantityToDeduct) {
    try {
        console.log(`Deducting ${quantityToDeduct} units from product ${productId}`);
        
        // Get all available stock items for this product
        const stockItemsQuery = query(
            collection(db, "stock_items"),
            where("productId", "==", productId),
            where("status", "==", "available")
        );
        
        const stockItemsSnapshot = await getDocs(stockItemsQuery);
        
        if (stockItemsSnapshot.empty) {
            console.log(`No stock items found for product ${productId}`);
            return false;
        }
        
        console.log(`Found ${stockItemsSnapshot.size} available stock items`);
        
        // Convert to array and sort by expiry date
        const stockItems = [];
        stockItemsSnapshot.forEach(doc => {
            const item = doc.data();
            let expiryDate = null;
            if (item.expiryDate) {
                if (item.expiryDate.toDate) {
                    expiryDate = item.expiryDate.toDate();
                } else {
                    expiryDate = new Date(item.expiryDate);
                }
                expiryDate.setHours(0, 0, 0, 0);
            }
            
            stockItems.push({
                id: doc.id,
                ...item,
                expiryDate: expiryDate
            });
        });
        
        // Sort based on sellExpiringFirst setting
        if (sellExpiringFirst) {
            // FEFO: Items with expiry date first (earliest first), then items without expiry
            stockItems.sort((a, b) => {
                if (a.expiryDate && b.expiryDate) {
                    return a.expiryDate - b.expiryDate;
                } else if (a.expiryDate && !b.expiryDate) {
                    return -1; // a has expiry, b doesn't - a comes first
                } else if (!a.expiryDate && b.expiryDate) {
                    return 1; // b has expiry, a doesn't - b comes first
                } else {
                    return 0; // both have no expiry
                }
            });
            
            console.log(`FEFO mode: Deducting expiring items first`);
        } else {
            // FIFO: Sort by creation date (oldest first)
            stockItems.sort((a, b) => {
                if (a.createdAt && b.createdAt) {
                    return a.createdAt.seconds - b.createdAt.seconds;
                }
                return 0;
            });
            console.log(`FIFO mode: Deducting oldest items first`);
        }
        
        let remainingToDeduct = quantityToDeduct;
        const batch = writeBatch(db);
        const deductedItems = [];
        
        for (const stockItem of stockItems) {
            if (remainingToDeduct <= 0) break;
            
            // Each stock_items document represents 1 item
            const stockItemRef = doc(db, "stock_items", stockItem.id);
            
            // Mark this stock item as sold
            batch.update(stockItemRef, {
                status: 'sold',
                soldDate: Timestamp.now(),
                soldBy: loggedInUserId
            });
            
            deductedItems.push({
                id: stockItem.id,
                expiryDate: stockItem.expiryDate,
                batchNumber: stockItem.batchNumber,
                serialNumber: stockItem.serialNumber
            });
            
            remainingToDeduct--;
        }
        
        if (remainingToDeduct > 0) {
            console.warn(`Could not fully deduct ${quantityToDeduct} units. Remaining: ${remainingToDeduct}`);
            return false;
        }
        
        // Execute all batch updates
        await batch.commit();
        
        // Log which items were deducted (for debugging)
        if (deductedItems.length > 0) {
            const expiringDeducted = deductedItems.filter(i => i.expiryDate).length;
            console.log(`Successfully deducted ${deductedItems.length} items (${expiringDeducted} with expiry dates)`);
            
            // Show notification about expiring items sold if applicable
            if (sellExpiringFirst && expiringDeducted > 0) {
                showNotification(`Sold ${expiringDeducted} expiring item(s) first`, 'info');
            }
        }
        
        return true;
        
    } catch (error) {
        console.error("Error deducting stock with expiry priority:", error);
        throw error;
    }
}

// Checkout Functions with Expiry Priority
const checkoutBtn = document.getElementById('checkoutBtn');
if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
        if (cart.length === 0) {
            showNotification('Cart is empty!', 'error');
            return;
        }
        
        // Check for expiring items before checkout
        const expiringItems = cart.filter(item => item.expiringCount > 0);
        if (expiringItems.length > 0 && sellExpiringFirst) {
            const confirmCheckout = confirm('Sell Expiring First is enabled. These expiring items will be prioritized in the sale. Continue?');
            if (!confirmCheckout) return;
        } else if (expiringItems.length > 0) {
            const confirmCheckout = confirm('Some items in your cart have products that are expiring soon. Do you want to continue?');
            if (!confirmCheckout) return;
        }
        
        let hasStockIssue = false;
        for (const item of cart) {
            const product = products.find(p => p.id === item.id);
            if (!product || product.stock < item.quantity) {
                hasStockIssue = true;
                showNotification(`Insufficient stock for ${item.brand}!`, 'error');
                break;
            }
        }
        
        if (!hasStockIssue) {
            document.getElementById('checkoutModal').style.display = 'block';
            updateCheckoutModal();
        }
    });
}

const clearCartBtn = document.getElementById('clearCartBtn');
if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
        if (cart.length > 0 && confirm('Are you sure you want to clear the cart?')) {
            cart = [];
            currentDiscountType = 'none';
            currentDiscount = 0;
            // Reset radio buttons
            document.querySelector('input[name="discountType"][value="none"]').checked = true;
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
        
        // Show both brand and generic in checkout
        const displayName = item.generic ? `${item.brand} (${item.generic})` : item.brand;
        
        itemDiv.innerHTML = `
            <div class="checkout-product-info">
                <span class="product-name">${displayName}</span>
                <span class="product-detail">₱${item.price.toFixed(2)} x ${item.quantity}</span>
                ${expiryNote}
            </div>
            <span class="product-total">₱${itemTotal.toFixed(2)}</span>
        `;
        checkoutItems.appendChild(itemDiv);
    });
    
    const discountPercentage = currentDiscount;
    const discountAmount = discountableSubtotal * (discountPercentage / 100);
    const subtotal = discountableSubtotal + nonDiscountableSubtotal;
    const grandTotal = subtotal - discountAmount;
    
    // Display discount type
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
    
    // Add toggle status to checkout modal
    const paymentSection = document.querySelector('.payment-section');
    if (paymentSection) {
        // Remove existing note if any
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
            
            // Calculate totals first
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
            
            // Calculate which items were expiring at time of sale
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thirtyDaysFromNow = new Date(today);
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            
            // Process items with proper discount calculation
            const processedItems = cart.map(item => {
                // Check if this item has expiring stock
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
                
                // Calculate discounted price for this item if it's discountable
                let itemDiscountedTotal = itemOriginalTotal;
                let itemDiscountAmount = 0;
                
                if (item.discountable !== false && discountPercentage > 0) {
                    // Apply discount proportionally based on the item's contribution to discountable subtotal
                    const itemShare = itemOriginalTotal / discountableSubtotal;
                    itemDiscountAmount = discountAmount * itemShare;
                    itemDiscountedTotal = itemOriginalTotal - itemDiscountAmount;
                }
                
                return {
                    productId: item.id,
                    brand: item.brand,
                    generic: item.generic,
                    price: item.price, // Original unit price
                    quantity: item.quantity,
                    originalTotal: itemOriginalTotal, // Total before discount
                    discountAmount: itemDiscountAmount, // Discount applied to this item
                    subtotal: itemDiscountedTotal, // Total after discount
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
            
            console.log("Sale Data being saved:", saleData); // Debug log
            
            // First, save the sale
            await addDoc(collection(db, "sales"), saleData);
            
            // Then update stock using expiry priority based on toggle
            for (const item of cart) {
                const productRef = doc(db, "products", item.id);
                const productDoc = await getDoc(productRef);
                
                if (productDoc.exists()) {
                    const currentStock = productDoc.data().stock;
                    const newStock = currentStock - item.quantity;
                    
                    // Deduct from stock_items with expiry priority
                    const deductionSuccess = await deductStockWithExpiryPriority(item.id, item.quantity);
                    
                    if (!deductionSuccess) {
                        throw new Error(`Failed to deduct stock for ${item.brand}`);
                    }
                    
                    // Update product total stock
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
            
            let discountText = '';
            if (currentDiscountType === 'seniorPWD') {
                discountText = ' (Senior/PWD 20%)';
            } else if (currentDiscountType === 'yakap') {
                discountText = ' (YAKAP 10%)';
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
            // Reset radio buttons
            const noneRadio = document.querySelector('input[name="discountType"][value="none"]');
            if (noneRadio) noneRadio.checked = true;
            updateCartDisplay();
            
            document.getElementById('checkoutModal').style.display = 'none';
            document.getElementById('amountTendered').value = '';
            document.getElementById('changeAmount').textContent = '₱0.00';
            
            // Remove checkout expiry note
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

// Function to return a sold item back to inventory
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
        
        // Refresh views
        if (typeof loadInventory === 'function') {
            loadInventory();
        }
        
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