import { db, collection, addDoc, getDocs, getDoc, query, where, orderBy, updateDoc, deleteDoc, doc, Timestamp, writeBatch } from './firebase-config.js';
import { fetchUserData } from './auth.js';

// Check if user is logged in
const loggedInUserId = localStorage.getItem('loggedInUserId');
if (!loggedInUserId) {
    window.location.href = 'index.html';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeInventory();
    setupEventListeners();
});

async function initializeInventory() {
    await loadUserData();
    updateDateTime();
    loadInventory();
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

// ==================== INVENTORY FUNCTIONS ====================
async function loadInventory() {
    try {
        console.log("%c🔍 LOADING INVENTORY WITH EXPIRY CHECK", "color: blue; font-size: 14px; font-weight: bold");
        
        const productsSnapshot = await getDocs(collection(db, "products"));
        const tableBody = document.getElementById('inventoryTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        // If no products found, load from stock_items
        if (productsSnapshot.empty) {
            console.log("%c⚠️ No products found. Loading from stock_items...", "color: orange; font-size: 14px; font-weight: bold");
            await loadInventoryFromStockItems();
            return;
        }
        
        // For each product, calculate expiring count
        for (const productDoc of productsSnapshot.docs) {
            const product = { id: productDoc.id, ...productDoc.data() };
            
            // Get available stock items
            let availableStock = 0;
            let expiringCount = 0;
            let expiringItems = [];
            
            try {
                // Query all available stock items for this product
                const stockItemsQuery = query(
                    collection(db, "stock_items"),
                    where("productId", "==", product.id),
                    where("status", "==", "available")
                );
                
                const stockItemsSnapshot = await getDocs(stockItemsQuery);
                availableStock = stockItemsSnapshot.size;
                
                // Calculate expiring soon count (within 30 days)
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const thirtyDaysFromNow = new Date(today);
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                thirtyDaysFromNow.setHours(23, 59, 59, 999);
                
                console.log(`%c📦 Product: ${product.brand || product.name} (ID: ${product.id})`, "color: purple; font-weight: bold");
                console.log(`📅 Today: ${today.toLocaleDateString()}`);
                console.log(`📅 30 days from now (inclusive): ${thirtyDaysFromNow.toLocaleDateString()}`);
                console.log(`🔢 Total available items: ${stockItemsSnapshot.size}`);
                
                // Check each stock item for expiry
                stockItemsSnapshot.forEach(itemDoc => {
                    const item = itemDoc.data();
                    
                    if (item.expiryDate) {
                        const expiryDate = item.expiryDate.toDate();
                        expiryDate.setHours(0, 0, 0, 0);
                        
                        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                        
                        // Check if expiry date is within the next 30 days
                        if (expiryDate <= thirtyDaysFromNow) {
                            expiringCount++;
                            expiringItems.push({
                                serial: item.serialNumber,
                                expiry: expiryDate.toLocaleDateString(),
                                daysLeft: daysUntilExpiry
                            });
                            console.log(`   ✅ EXPIRING SOON: ${item.serialNumber} - Expires: ${expiryDate.toLocaleDateString()} (${daysUntilExpiry} days left)`);
                        } else {
                            console.log(`   ❌ NOT EXPIRING SOON: ${item.serialNumber} - Expires: ${expiryDate.toLocaleDateString()} (${daysUntilExpiry} days left)`);
                        }
                    } else {
                        console.log(`   ℹ️ NO EXPIRY DATE: ${item.serialNumber}`);
                    }
                });
                
                console.log(`📊 Expiring count for ${product.brand}: ${expiringCount}`);
                if (expiringItems.length > 0) {
                    console.log("Expiring items details:", expiringItems);
                }
                console.log("---");
                
            } catch (error) {
                console.log("Error getting stock items:", error);
                availableStock = product.stock || 0;
            }
            
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
            
            if (expiringCount > 0) {
                expiryDisplay = `<span class="expiry-badge expiring-soon" title="${expiringCount} item(s) expiring within 30 days\n${expiringItems.map(i => `${i.serial}: ${i.expiry} (${i.daysLeft} days)`).join('\n')}">
                    <i class="fas fa-exclamation-triangle"></i> ${expiringCount}
                </span>`;
            }
            
            // Display brand name and generic name
            const brandName = product.brand || product.name || 'N/A';
            const genericName = product.generic || 'N/A';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${product.code || 'N/A'}</td>
                <td>${brandName}</td>
                <td>${genericName}</td>
                <td>${product.category || 'N/A'}</td>
                <td>₱${(product.price || 0).toFixed(2)}</td>
                <td class="${stockClass}"${stockTooltip}>${stockStatus}</td>
                <td>${expiryDisplay}</td>
                <td>
                    <button class="btn-icon view-stock-items" title="View Individual Stock Items" data-id="${product.id}" data-name="${brandName}"><i class="fas fa-list"></i></button>
                    <button class="btn-icon edit-product" title="Edit Product" data-id="${product.id}"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon delete-product" title="Delete Product" data-id="${product.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(row);
        }
        
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
    }
}

// New function to load inventory directly from stock_items
async function loadInventoryFromStockItems() {
    try {
        console.log("%c📦 Loading inventory from stock_items collection...", "color: purple; font-size: 14px; font-weight: bold");
        
        const stockItemsSnapshot = await getDocs(collection(db, "stock_items"));
        const tableBody = document.getElementById('inventoryTableBody');
        
        if (stockItemsSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="8" class="no-data">No stock items found</td></tr>';
            return;
        }
        
        // Group stock items by product
        const productGroups = new Map();
        
        stockItemsSnapshot.forEach(doc => {
            const item = { id: doc.id, ...doc.data() };
            
            // Create a unique key for this product (use productId or combination of name+generic)
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
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    
                    const expiryDate = item.expiryDate.toDate();
                    expiryDate.setHours(0, 0, 0, 0);
                    
                    const thirtyDaysFromNow = new Date(today);
                    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                    thirtyDaysFromNow.setHours(23, 59, 59, 999);
                    
                    if (expiryDate <= thirtyDaysFromNow) {
                        group.expiringCount++;
                    }
                }
            }
        });
        
        console.log(`Found ${productGroups.size} unique product groups from stock items`);
        
        // Display each product group
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
            
            // Discount status (default to discountable for stock items)
            const discountStatus = '<span class="discount-badge-table"><i class="fas fa-tag"></i> Discountable</span>';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${productCode}</td>
                <td>${group.brand}</td>
                <td>${group.generic}</td>
                <td>${group.category}</td>
                <td>₱${(price).toFixed(2)}</td>
                <td class="${stockClass}"${stockTooltip}>${stockStatus}</td>
                <td>${expiryDisplay}</td>
                <td>
                    <button class="btn-icon view-stock-items" title="View Individual Stock Items" data-product-key="${key}" data-brand="${group.brand}"><i class="fas fa-list"></i></button>
                    <button class="btn-icon create-product" title="Create Product from Stock" data-product-key="${key}" data-brand="${group.brand}" data-generic="${group.generic}" data-price="${price}"><i class="fas fa-plus-circle"></i></button>
                    <button class="btn-icon delete-group" title="Delete All Items" data-product-key="${key}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tableBody.appendChild(row);
        }
        
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

// Function to view stock items by product key
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
        
        // Refresh views
        loadInventory();
        
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
        
        // Refresh views
        loadInventory();
        
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
        loadInventory();
        
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
    
    if (searchInput) searchInput.addEventListener('input', filterFunction);
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
        document.getElementById('productCategory').value = product.category || '';
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
            loadInventory();
            
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
            
            const productData = {
                code: document.getElementById('productCode')?.value || '',
                brand: document.getElementById('productBrand')?.value || '',
                generic: document.getElementById('productGeneric')?.value || '',
                category: document.getElementById('productCategory')?.value || '',
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
            
            loadInventory();
            
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
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'product-result-item';
                    resultDiv.dataset.productId = product.id;
                    resultDiv.innerHTML = `
                        <div class="product-result-name">${product.brand || 'Unnamed'}</div>
                        <div class="product-result-details">
                            <span class="product-result-code">Code: ${product.code || 'N/A'}</span>
                            <span>Generic: ${product.generic || 'N/A'}</span>
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
                
                loadInventory();
                
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
    await loadInventory();
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